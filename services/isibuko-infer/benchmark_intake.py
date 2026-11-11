"""Local intake for the category benchmark.

Storage is the gitignored benchmark-data directory, or a root passed explicitly
by the caller. Arbitrary directories are rejected. Reviewer names are
self-reported and are not identity checks. A completed rights checklist is
evidence for a person to review. It is not a legal approval and it does not
admit the row.

Image limits: 8 MiB on disk, 4096 pixels on the longer edge, and 8,000,000
decoded pixels. Calculated perceptual comparison runs only when both image
files open. The rule is a bit distance of 4 and a colour distance of 36.
Concurrent publication is serialised with a lock and an exclusive link.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import stat
import warnings
from pathlib import Path

import fcntl
from PIL import Image, UnidentifiedImageError

import benchmark_manifest as gate

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STORAGE = REPO_ROOT / "benchmark-data"
FORMATS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
EXAMPLE_PERMISSION = "EXAMPLE-ONLY-NOT-A-REAL-PERMISSION"
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_EDGE = 4096
MAX_PIXELS = 8_000_000
_OPEN_FLAGS = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
_LOCK_FLAGS = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)


def manifest_template() -> dict:
    """Blank entry. Every checker field is present and nothing is pre-approved."""
    entry = {field: "" for field in gate.FIELDS}
    entry.update({
        "commercialEval": None,
        "identifiablePerson": None,
        "personImageryPermission": None,
        "personImageryRef": "",
        "reviewerAStyle": "",
        "reviewerBStyle": "",
        "reviewerALength": "",
        "reviewerBLength": "",
        "reviewerAColour": "",
        "reviewerBColour": "",
        "originalFilename": "",
        "status": "incomplete",
        "admitted": False,
        "approved": False,
        "splitConfirmedBy": "",
        "duplicate": False,
    })
    return entry


def synthetic_example() -> dict:
    """Shape example. The permission string is a placeholder and cannot be evidence."""
    entry = manifest_template()
    entry.update({
        "imageId": "example-not-a-real-image",
        "sha256": "0" * 64,
        "pixelSha256": "1" * 64,
        "sourceGroupId": "example-group",
        "verifiedCategory": "",
        "catalogueCategory": "",
        "source": "synthetic-fixture",
        "rightsBasis": "",
        "rightsHolder": "EXAMPLE-NOT-A-REAL-HOLDER",
        "licenceRef": EXAMPLE_PERMISSION,
        "commercialEval": None,
        "acquiredOn": "",
        "status": "example-only",
        "admitted": False,
        "approved": False,
    })
    return entry


def _limit(requested: int | None, ceiling: int) -> int:
    if requested is None:
        return ceiling
    if not isinstance(requested, int) or requested < 1:
        raise ValueError("A limit must be a positive integer.")
    return min(requested, ceiling)


def _lstat(path: Path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def _storage_root(storage_root: Path | None) -> Path:
    root = DEFAULT_STORAGE if storage_root is None else Path(storage_root)
    if root.is_symlink():
        raise ValueError("The benchmark storage directory is a symlink.")
    info = _lstat(root)
    if info is None or not stat.S_ISDIR(info.st_mode):
        raise ValueError("The benchmark storage directory does not exist.")
    return root


def _directory_inside(root: Path, destination: Path) -> Path:
    lexical = destination if destination.is_absolute() else root / destination
    try:
        lexical.resolve(strict=False).relative_to(root.resolve(strict=True))
        parts = lexical.relative_to(root).parts
    except ValueError as exc:
        raise ValueError("Destination escapes the benchmark storage directory.") from exc
    current = root
    for part in parts:
        if part in ("", "."):
            continue
        if part == "..":
            raise ValueError("Destination escapes the benchmark storage directory.")
        current = current / part
        info = _lstat(current)
        if info is not None and stat.S_ISLNK(info.st_mode):
            raise ValueError("A symlink is inside the benchmark destination.")
        if info is None:
            current.mkdir(mode=0o700)
            continue
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError("The destination is not a directory.")
    return current


def _read_limited(path: Path, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    with path.open("rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > limit:
                raise ValueError("The image exceeds the byte limit.")
            chunks.append(block)
    return b"".join(chunks)


def _decode_image(data: bytes, edge_limit: int, pixel_limit: int) -> str:
    previous = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = pixel_limit
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    image_format = image.format
                    width, height = image.size
            except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                raise ValueError("The image exceeds the pixel limit.") from exc
            except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
                raise ValueError("The file is not a supported image.") from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous
    if image_format not in FORMATS:
        raise ValueError("Only PNG, JPEG, and WebP images can be intake.")
    if width > edge_limit or height > edge_limit or width * height > pixel_limit:
        raise ValueError("The image exceeds the pixel limit.")
    if width < 1 or height < 1:
        raise ValueError("The image has no pixels.")
    return image_format


def _cleanup(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.lstat()
    except FileNotFoundError:
        return
    path.unlink()


def _publish(directory: Path, filename: str, data: bytes) -> None:
    temporary = directory / f".intake-{secrets.token_hex(8)}.partial"
    handle = None
    try:
        handle = os.open(temporary, _OPEN_FLAGS, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(handle, data[offset:])
            if written <= 0:
                raise OSError("The temporary image could not be written.")
            offset += written
        os.fsync(handle)
    except Exception:
        if handle is not None:
            os.close(handle)
        _cleanup(temporary)
        raise
    os.close(handle)
    if hashlib.sha256(temporary.read_bytes()).hexdigest() != hashlib.sha256(data).hexdigest():
        _cleanup(temporary)
        raise RuntimeError("The temporary image did not match the source bytes.")
    final = directory / filename
    try:
        os.link(temporary, final)
    except Exception:
        _cleanup(temporary)
        raise
    _cleanup(temporary)


def _locked(root: Path):
    class _Lock:
        def __enter__(self):
            if (root / ".intake.lock").is_symlink():
                raise ValueError("The intake lock is a symlink.")
            self.fd = os.open(root / ".intake.lock", _LOCK_FLAGS, 0o600)
            fcntl.flock(self.fd, fcntl.LOCK_EX)
            return self

        def __exit__(self, exc_type, exc, traceback):
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            return False

    return _Lock()


def rights_gaps(entry: dict) -> list[str]:
    gaps: list[str] = []
    if entry.get("rightsBasis") not in gate.RIGHTS_BASES:
        gaps.append("Rights basis is missing.")
    if not str(entry.get("rightsHolder") or "").strip():
        gaps.append("Rights holder is missing.")
    reference = str(entry.get("licenceRef") or "").strip()
    if not reference:
        gaps.append("Permission reference is missing.")
    elif reference.startswith("EXAMPLE-ONLY"):
        gaps.append("The permission reference is an example placeholder, not evidence.")
    elif reference.startswith(("http://", "https://")):
        gaps.append("A public URL is not permission evidence.")
    if entry.get("commercialEval") is not True:
        gaps.append("Commercial evaluation permission is not granted.")
    if not gate.valid_date(entry.get("acquiredOn")):
        gaps.append("Acquisition date is missing or is not a real calendar date.")
    if entry.get("reviewedOn") not in ("", None) and not gate.valid_date(entry.get("reviewedOn")):
        gaps.append("Review date is not a real calendar date.")
    person = entry.get("identifiablePerson")
    if person is None:
        gaps.append("Person-imagery status is unknown.")
    elif person is True and entry.get("personImageryPermission") is not True:
        gaps.append("Identifiable people require person-imagery permission.")
    elif person is True and not str(entry.get("personImageryRef") or "").strip():
        gaps.append("Person-imagery permission reference is missing.")
    return gaps


def intake_file(
    source: Path,
    destination: Path,
    source_group: str,
    identifiable_person: bool | None,
    storage_root: Path | None = None,
    max_file_bytes: int | None = None,
    max_edge: int | None = None,
    max_pixels: int | None = None,
) -> dict:
    """Copy original bytes into the approved root. The source file is not rewritten."""
    if not str(source_group).strip():
        raise ValueError("A source group must be supplied. It is not read from the filename.")
    if identifiable_person not in (True, False):
        raise ValueError("Person-imagery status must be explicitly true or false.")
    file_limit = _limit(max_file_bytes, MAX_FILE_BYTES)
    edge_limit = _limit(max_edge, MAX_EDGE)
    pixel_limit = _limit(max_pixels, MAX_PIXELS)
    root = _storage_root(storage_root)
    directory = _directory_inside(root, destination)
    before = hashlib.sha256(_read_limited(source, file_limit)).hexdigest()
    data = _read_limited(source, file_limit)
    if hashlib.sha256(data).hexdigest() != before:
        raise RuntimeError("The source photograph changed during intake and was not accepted.")
    image_format = _decode_image(data, edge_limit, pixel_limit)
    filename = "img-" + hashlib.sha256(data).hexdigest()[:20] + FORMATS[image_format]
    final = directory / filename
    with _locked(root):
        info = _lstat(final)
        if info is not None:
            if stat.S_ISLNK(info.st_mode):
                raise ValueError("The destination file is a symlink and was not followed.")
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("The destination exists and is not a regular file.")
            existing = final.read_bytes()
            if existing == data:
                raise FileExistsError("Duplicate submission. The existing image was not overwritten.")
            raise FileExistsError("That image id already exists with different bytes. The existing file was not overwritten.")
        _publish(directory, filename, data)
        if hashlib.sha256(source.read_bytes()).hexdigest() != before:
            _cleanup(final)
            raise RuntimeError("The source photograph changed during intake and was not accepted.")
    entry = manifest_template()
    entry.update({
        "imageId": filename.split(".")[0],
        "sha256": gate.file_sha256(final),
        "pixelSha256": gate.pixel_sha256(final),
        "sourceGroupId": source_group.strip(),
        "imagePath": str(final),
        "originalFilename": source.name,
        "verifiedCategory": "",
        "catalogueCategory": "",
        "identifiablePerson": identifiable_person,
        "status": "rights-excluded",
        "admitted": False,
        "approved": False,
        "split": "",
        "role": "",
        "difficulty": "",
        "duplicate": False,
    })
    return entry


class LedgerError(ValueError):
    """A ledger record is incomplete, corrupted, or does not match its seal."""


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _record_seal(record: dict) -> str:
    body = {key: record[key] for key in ("seq", "kind", "reviewRef", "prev", "body")}
    return hashlib.sha256(_canonical(body)).hexdigest()


class ReviewLedger:
    """Append-only local review log.

    Review references are random. Image ids stay in the private record and are
    not returned to a reviewer. Names are self-reported. The seal detects torn
    writes and edits that break the chain. It is not a signature and it does
    not authenticate a reviewer. Rights are not stored here.
    """

    def __init__(self, storage: Path) -> None:
        self.root = Path(storage)
        if self.root.is_symlink():
            raise ValueError("The review ledger directory is a symlink.")
        parent = self.root.parent
        if parent.is_symlink() or not parent.is_dir():
            raise ValueError("The review ledger directory cannot be created safely.")
        if not self.root.exists():
            os.mkdir(self.root, 0o700)
        os.chmod(self.root, 0o700)
        self._sessions: dict[str, dict] = {}
        self._head = "0" * 64
        self._next_seq = 1
        self.recovered: list[str] = []
        with self._lock():
            self._recover_locked()
            self._load_locked()

    def open_review(self, entry: dict) -> str:
        ref = secrets.token_hex(16)
        private = {
            "imageId": str(entry.get("imageId") or ""),
            "imagePath": str(entry.get("imagePath") or ""),
            "sha256": str(entry.get("sha256") or ""),
        }
        with self._lock():
            self._load_locked()
            while ref in self._sessions:
                ref = secrets.token_hex(16)
            self._append_locked("session", ref, private)
        return ref

    def blind_view(self, ref: str) -> dict:
        with self._lock():
            self._load_locked()
            self._require(ref)
        return {
            "reviewRef": ref,
            "choices": list(gate.BENCHMARK_LABELS),
            "wigStyles": list(gate.WIG_FAMILIES),
            "lengths": ["short", "long"],
        }

    def review_bytes(self, ref: str) -> bytes:
        with self._lock():
            self._load_locked()
            record = self._require(ref)
            path = Path(record["imagePath"])
        if path.is_symlink() or not path.is_file():
            raise ValueError("The review image is not available.")
        return path.read_bytes()

    def submit_review(self, ref: str, slot: str, name: str, category: str, style: str = "", length: str = "", colour: str = "") -> dict:
        if slot not in ("A", "B"):
            raise ValueError("Review slot must be A or B.")
        if not str(name).strip():
            raise ValueError("A self-reported reviewer name is required. It does not prove identity.")
        if category not in gate.BENCHMARK_LABELS:
            raise ValueError("The review label must be one of the 14 categories or none.")
        own = {
            "name": name.strip(),
            "category": category,
            "style": style if category == "wig" else "",
            "length": length if category == "wig" else "",
            "colour": colour if category == "wig" else "",
        }
        with self._lock():
            self._load_locked()
            session = self._require(ref)
            if slot in session["reviews"]:
                raise FileExistsError("That review slot already has a submission. It was not replaced.")
            person = gate.normalize_reviewer_name(own["name"])
            image_key = session["sha256"] or session["imageId"]
            for other in self._sessions.values():
                if (other["sha256"] or other["imageId"]) != image_key:
                    continue
                for review in other["reviews"].values():
                    if gate.normalize_reviewer_name(review["name"]) == person:
                        raise FileExistsError("This reviewer has already submitted for this image. The submission was not recorded.")
            self._append_locked("review", ref, {"slot": slot, **own})
        return {
            "reviewRef": ref,
            "slot": slot,
            "category": own["category"],
            "style": own["style"],
            "length": own["length"],
            "colour": own["colour"],
            "recorded": True,
            "admitted": False,
            "approved": False,
            "identityVerified": False,
        }

    def apply_agreement(self, entry: dict, ref: str, reviewed_on: str = "") -> dict:
        with self._lock():
            self._load_locked()
            session = self._require(ref)
            if session["conclusion"] is not None:
                stored = session["conclusion"]
                updated = self._agreement(entry, session, stored.get("reviewedOn") or reviewed_on)
                updated["status"] = stored["status"]
                updated["reason"] = stored["reason"]
                if stored["status"] != "reviewed":
                    updated["verifiedCategory"] = ""
                return updated
            updated = self._agreement(entry, session, reviewed_on)
            if updated["status"] != "awaiting-second-review":
                self._append_locked("conclusion", ref, {
                    "status": updated["status"],
                    "reason": updated["reason"],
                    "reviewedOn": updated.get("reviewedOn", ""),
                })
            return updated

    def backup(self, destination: Path) -> Path:
        if destination.exists() or destination.is_symlink():
            raise ValueError("The backup destination already exists.")
        if destination.parent.is_symlink() or not destination.parent.is_dir():
            raise ValueError("The backup destination cannot be created safely.")
        os.mkdir(destination, 0o700)
        with self._lock():
            self._load_locked()
            for source in self._record_paths():
                self._atomic_write(destination / source.name, source.read_bytes())
            manifest = {"head": self._head, "records": len(self._record_paths()), "authenticated": False}
            self._atomic_write(destination / "backup.json", _canonical(manifest) + b"\n")
        os.chmod(destination, 0o700)
        return destination

    def restore(self, backup_dir: Path) -> None:
        if backup_dir.is_symlink() or not backup_dir.is_dir():
            raise ValueError("The backup is not a real directory.")
        with self._lock():
            self._load_locked()
            if self._record_paths():
                raise ValueError("The ledger already has records and was not overwritten.")
            files = self._record_paths(backup_dir)
            self._verify_files(files)
            for source in files:
                self._atomic_write(self.root / source.name, source.read_bytes())
            self._load_locked()

    def _agreement(self, entry: dict, session: dict, reviewed_on: str) -> dict:
        updated = dict(entry)
        updated["admitted"] = False
        updated["approved"] = False
        updated["reason"] = ""
        reviews = session["reviews"]
        if "A" not in reviews or "B" not in reviews:
            updated["status"] = "awaiting-second-review"
            updated["verifiedCategory"] = ""
            updated["reason"] = "A second independent review is missing."
            return updated
        left = reviews["A"]
        right = reviews["B"]
        updated["reviewerA"] = left["name"]
        updated["reviewerB"] = right["name"]
        updated["reviewerACategory"] = left["category"]
        updated["reviewerBCategory"] = right["category"]
        updated["reviewerAStyle"] = left["style"]
        updated["reviewerBStyle"] = right["style"]
        updated["reviewerALength"] = left["length"]
        updated["reviewerBLength"] = right["length"]
        updated["reviewerAColour"] = left["colour"]
        updated["reviewerBColour"] = right["colour"]
        if gate.normalize_reviewer_name(left["name"]) == gate.normalize_reviewer_name(right["name"]):
            updated["status"] = "excluded-same-reviewer"
            updated["verifiedCategory"] = ""
            updated["reason"] = "The normalised reviewer names match. This is not an identity check."
            return updated
        if left["category"] != right["category"]:
            updated["status"] = "excluded-disagreement"
            updated["verifiedCategory"] = ""
            updated["reason"] = "The reviewers do not agree on the visual category."
            return updated
        if left["category"] == "wig":
            for key in ("style", "length", "colour"):
                if not left[key] or left[key] != right[key]:
                    updated["status"] = "excluded-disagreement"
                    updated["verifiedCategory"] = ""
                    updated["reason"] = "The reviewers do not agree on the wig description."
                    return updated
            updated["style"] = left["style"]
            updated["length"] = left["length"]
            updated["colour"] = left["colour"]
        else:
            updated["style"] = ""
            updated["length"] = ""
            updated["colour"] = ""
        if not gate.valid_date(reviewed_on):
            updated["status"] = "awaiting-second-review"
            updated["verifiedCategory"] = ""
            updated["reason"] = "A real review date is required."
            return updated
        updated["reviewedOn"] = reviewed_on
        updated["verifiedCategory"] = left["category"]
        updated["status"] = "reviewed"
        updated["reason"] = "The reviewers agree. The row is not approved."
        return updated

    def _require(self, ref: str) -> dict:
        try:
            return self._sessions[ref]
        except KeyError as exc:
            raise ValueError("The review reference is unknown.") from exc

    def _lock(self):
        ledger = self

        class _Guard:
            def __enter__(self):
                path = ledger.root / ".ledger.lock"
                if path.is_symlink():
                    raise ValueError("The ledger lock is a symlink.")
                self.fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
                fcntl.flock(self.fd, fcntl.LOCK_EX)
                return self

            def __exit__(self, exc_type, exc, traceback):
                fcntl.flock(self.fd, fcntl.LOCK_UN)
                os.close(self.fd)
                return False

        return _Guard()

    def _record_paths(self, directory: Path | None = None) -> list[Path]:
        root = self.root if directory is None else directory
        found = []
        for path in root.iterdir():
            if path.is_symlink() or not path.is_file():
                continue
            name = path.name
            if len(name) == 30 and name.endswith(".json"):
                seq, token = name[:-5].split("-", 1)
                if seq.isdigit() and len(seq) == 8 and len(token) == 16 and all(character in "0123456789abcdef" for character in token):
                    found.append(path)
        return sorted(found, key=lambda item: item.name)

    def _recover_locked(self) -> None:
        quarantine = self.root / "quarantine"
        for path in list(self.root.iterdir()):
            if path.is_symlink():
                raise ValueError("A symlink is inside the review ledger.")
            if path.name.endswith(".partial") or path.name.endswith(".tmp"):
                self._quarantine(path, quarantine)

    def _quarantine(self, path: Path, quarantine: Path) -> None:
        if not quarantine.exists():
            os.mkdir(quarantine, 0o700)
        target = quarantine / path.name
        if target.exists():
            target = quarantine / f"{path.name}-{secrets.token_hex(4)}"
        os.rename(path, target)
        os.chmod(target, 0o600)
        self.recovered.append(path.name)

    def _load_locked(self) -> None:
        self._sessions = {}
        self._head = "0" * 64
        self._next_seq = 1
        files = self._record_paths()
        verified = []
        for index, path in enumerate(files):
            raw = path.read_bytes()
            try:
                record = json.loads(raw)
                if record.get("seal") != _record_seal(record):
                    raise LedgerError("A ledger seal does not match its record.")
                if record.get("prev") != self._head or record.get("seq") != self._next_seq:
                    raise LedgerError("The ledger chain does not match.")
            except (json.JSONDecodeError, LedgerError, KeyError, TypeError) as exc:
                if index == len(files) - 1 and isinstance(exc, json.JSONDecodeError):
                    self._quarantine(path, self.root / "quarantine")
                    break
                if isinstance(exc, LedgerError):
                    raise
                raise LedgerError("A ledger record is corrupted.") from exc
            verified.append(record)
            self._head = hashlib.sha256(raw).hexdigest()
            self._next_seq += 1
            self._remember(record)

    def _verify_files(self, files: list[Path]) -> None:
        head = "0" * 64
        seq = 1
        for path in files:
            raw = path.read_bytes()
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise LedgerError("A backup record is corrupted.") from exc
            if record.get("seal") != _record_seal(record) or record.get("prev") != head or record.get("seq") != seq:
                raise LedgerError("A backup record does not match its seal.")
            head = hashlib.sha256(raw).hexdigest()
            seq += 1

    def _remember(self, record: dict) -> None:
        ref = record["reviewRef"]
        body = record["body"]
        if record["kind"] == "session":
            self._sessions[ref] = {
                "imageId": body.get("imageId", ""),
                "imagePath": body.get("imagePath", ""),
                "sha256": body.get("sha256", ""),
                "reviews": {},
                "conclusion": None,
            }
        elif record["kind"] == "review":
            self._sessions[ref]["reviews"][body["slot"]] = {
                "name": body["name"],
                "category": body["category"],
                "style": body.get("style", ""),
                "length": body.get("length", ""),
                "colour": body.get("colour", ""),
            }
        elif record["kind"] == "conclusion":
            self._sessions[ref]["conclusion"] = body

    def _append_locked(self, kind: str, ref: str, body: dict) -> None:
        record = {"seq": self._next_seq, "kind": kind, "reviewRef": ref, "prev": self._head, "body": body}
        record["seal"] = _record_seal(record)
        raw = _canonical(record) + b"\n"
        filename = f"{self._next_seq:08d}-{secrets.token_hex(8)}.json"
        self._atomic_write(self.root / filename, raw)
        self._head = hashlib.sha256(raw).hexdigest()
        self._next_seq += 1
        self._remember(record)

    def _atomic_write(self, final: Path, raw: bytes) -> None:
        temporary = final.parent / f".{final.name}.{secrets.token_hex(4)}.partial"
        handle = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            offset = 0
            while offset < len(raw):
                written = os.write(handle, raw[offset:])
                if written <= 0:
                    raise OSError("The ledger record could not be written.")
                offset += written
            os.fsync(handle)
        except Exception:
            os.close(handle)
            _cleanup(temporary)
            raise
        os.close(handle)
        os.chmod(temporary, 0o600)
        try:
            os.link(temporary, final)
        except Exception:
            _cleanup(temporary)
            raise
        _cleanup(temporary)
        os.chmod(final, 0o600)



def record_rights(entry: dict, rights: dict) -> dict:
    updated = dict(entry)
    for key in ("rightsBasis", "rightsHolder", "licenceRef", "commercialEval", "acquiredOn", "reviewedOn", "personImageryPermission", "personImageryRef", "identifiablePerson"):
        if key in rights:
            updated[key] = rights[key]
    updated["admitted"] = False
    updated["approved"] = False
    if rights_gaps(updated):
        updated["status"] = "rights-excluded"
    elif updated.get("status") in ("rights-excluded", "incomplete", "example-only", "", None):
        updated["status"] = "rights-recorded"
    return updated


def record_split(entry: dict, split: str, confirmed_by: str) -> tuple[dict, list[str]]:
    if not str(confirmed_by).strip():
        return dict(entry), ["A person must explicitly confirm the split."]
    if split not in gate.SPLITS:
        return dict(entry), ["Split must be selection or evaluation."]
    if entry.get("split") in gate.SPLITS:
        return dict(entry), ["The split is already set and was not moved."]
    updated = dict(entry)
    updated["split"] = split
    updated["splitConfirmedBy"] = confirmed_by.strip()
    updated["admitted"] = False
    updated["approved"] = False
    return updated, []


def record_observation(entry: dict, role: str, difficulty: str) -> tuple[dict, list[str]]:
    if role not in gate.ROLES or difficulty not in gate.DIFFICULTIES:
        return dict(entry), ["Role and difficulty must be chosen explicitly."]
    updated = dict(entry)
    updated["role"] = role
    updated["difficulty"] = difficulty
    updated["admitted"] = False
    updated["approved"] = False
    return updated, []


def _workflow_gaps(entry: dict) -> list[str]:
    gaps = rights_gaps(entry)
    if entry.get("status") in ("excluded-disagreement", "excluded-same-reviewer"):
        gaps.append("Reviewers disagree or are the same person. The row is excluded.")
    elif not entry.get("verifiedCategory"):
        gaps.append("Visual category is not agreed.")
    if entry.get("split") not in gate.SPLITS:
        gaps.append("Split has not been explicitly confirmed.")
    if entry.get("role") not in gate.ROLES or entry.get("difficulty") not in gate.DIFFICULTIES:
        gaps.append("Role or difficulty has not been explicitly recorded.")
    return gaps


def _leakage_reason(reason: str) -> bool:
    markers = (
        "The same file hash",
        "The same pixel hash",
        "A source group crosses",
        "seller listing",
        "listing URL",
        "The same SKU",
        "near-duplicate",
    )
    return any(marker in reason for marker in markers)


def progress_report(entries: list[dict], dataset_dir: Path | None = None) -> dict:
    """Readiness comes only from the checker. Nothing in this report is an approval."""
    checked = gate.check_manifest(entries, dataset_dir)
    ok_ids = {item["imageId"] for item in checked["rows"] if item["ok"]}
    leakage_ids = set()
    missing_files = []
    invalid_hashes = []
    for item in checked["rows"]:
        for reason in item["reasons"]:
            if _leakage_reason(reason):
                leakage_ids.add(item["imageId"])
            if "not a file" in reason or "escapes the dataset" in reason:
                missing_files.append({"imageId": item["imageId"], "reason": reason})
            if "does not match" in reason:
                invalid_hashes.append({"imageId": item["imageId"], "reason": reason})
    groups = {label: set() for label in gate.POSITIVE_LABELS}
    positive_selection = {label: 0 for label in gate.POSITIVE_LABELS}
    positive_evaluation = {label: 0 for label in gate.POSITIVE_LABELS}
    counts = {
        "imported": len(entries),
        "rightsExcluded": 0,
        "rightsCleared": 0,
        "reviewIncomplete": 0,
        "disagreementExcluded": 0,
        "manifestValid": 0,
        "benchmarkEligible": 0,
        "leakageRejected": len(leakage_ids),
    }
    missing = []
    disagreements = []
    for entry in entries:
        image_id = str(entry.get("imageId") or "")
        gaps = _workflow_gaps(entry)
        if gaps:
            missing.append({"imageId": image_id, "gaps": gaps})
        if rights_gaps(entry):
            counts["rightsExcluded"] += 1
        else:
            counts["rightsCleared"] += 1
        if entry.get("status") in ("excluded-disagreement", "excluded-same-reviewer"):
            counts["disagreementExcluded"] += 1
            disagreements.append(image_id)
        elif not entry.get("reviewerACategory") or not entry.get("reviewerBCategory") or not entry.get("verifiedCategory"):
            counts["reviewIncomplete"] += 1
        if image_id in ok_ids:
            counts["manifestValid"] += 1
            eligible = image_id not in leakage_ids and not gaps
            if eligible:
                counts["benchmarkEligible"] += 1
            label = entry.get("verifiedCategory")
            if entry.get("role") == "positive" and label in groups:
                groups[label].add(entry.get("sourceGroupId"))
                if entry.get("split") == "selection":
                    positive_selection[label] += 1
                elif entry.get("split") == "evaluation":
                    positive_evaluation[label] += 1
    ready = bool(checked["ready"]) and not missing and not leakage_ids
    return {
        "ready": ready,
        "approved": False,
        "admitted": False,
        "checkerReady": bool(checked["ready"]),
        "counts": counts,
        "positives": checked["counts"]["positives"],
        "positiveSelection": positive_selection,
        "positiveEvaluation": positive_evaluation,
        "sourceGroups": {label: len(values) for label, values in groups.items()},
        "wigFamilies": checked["counts"]["wigFamilies"],
        "wigFamilyImages": checked["counts"]["wigFamilyImages"],
        "wigLengthGroups": checked["counts"]["wigLengthGroups"],
        "negativeSelection": checked["counts"]["negativeSelection"],
        "negativeEvaluation": checked["counts"]["negativeEvaluation"],
        "missing": missing,
        "missingFiles": missing_files,
        "invalidHashes": invalid_hashes,
        "rightsExclusions": counts["rightsExcluded"],
        "disagreements": disagreements,
        "leakage": sorted(leakage_ids),
        "remaining": [] if ready else list(checked["gaps"]),
        "perceptualComparison": {
            "calculated": gate.CALCULATED_PERCEPTUAL_SUPPORTED,
            "requiresBothImageFiles": True,
            "maxHamming": gate.PERCEPTUAL_HAMMING,
            "maxColourDistance": gate.PERCEPTUAL_COLOR_DISTANCE,
            "declaredHashStillChecked": True,
            "skippedWhenAFileIsMissing": True,
            "notACalibratedProbability": True,
        },
        "rightsClearedMeans": "The checklist fields are present. The licence has not been legally verified.",
    }
