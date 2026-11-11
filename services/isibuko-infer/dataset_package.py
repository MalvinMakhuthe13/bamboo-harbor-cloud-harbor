"""Turn an annotation session into a dataset ZIP and import it without auto-approval."""

from __future__ import annotations

import json
import shutil
import stat
import zipfile
from pathlib import Path

from PIL import Image

from annotation_studio import export_row
from dataset_gate import admit, approve, file_hash, problems
from feature_extract import extract_spatial
from rights_contract import admission_status

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
LIMITS = {"entries": 2000, "entry_bytes": 32 * 1024 * 1024, "total_bytes": 512 * 1024 * 1024, "ratio": 100}


def safe_id(value: str) -> str:
    cleaned = "".join(character if character.isalnum() or character in "-_" else "_" for character in str(value))
    cleaned = cleaned.strip("._") or "sample"
    return cleaned[:80]


def package_image_name(sample_id: str, image_name: str) -> str:
    suffix = Path(str(image_name)).suffix.lower()
    if suffix not in IMAGE_SUFFIXES:
        suffix = ".png"
    return f"images/{safe_id(sample_id)}{suffix}"


def safe_member(name: str) -> Path:
    if not isinstance(name, str) or not name or name.endswith("/") or name.endswith("\\"):
        raise RuntimeError(f"Path traversal rejected: {name}")
    if "\x00" in name or "\\" in name or name.startswith("/") or ":" in name:
        raise RuntimeError(f"Path traversal rejected: {name}")
    parts = Path(name).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise RuntimeError(f"Path traversal rejected: {name}")
    return Path(*parts)


def locate(root: Path, relative: str) -> Path:
    member = safe_member(relative)
    root_resolved = root.resolve()
    target = (root_resolved / member).resolve()
    if root_resolved != target and root_resolved not in target.parents:
        raise RuntimeError(f"Path traversal rejected: {relative}")
    return target


def _decoded_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        image.load()
        return image.size


def _foreground(path: Path) -> int:
    with Image.open(path) as image:
        image.load()
        return sum(1 for value in image.get_flattened_data() if value > 0)


def build_package(session: dict, dest: Path) -> tuple[list[dict], list[dict]]:
    """Copy original images, rasterize masks, and write a relative manifest. Does not approve."""
    dest.mkdir(parents=True, exist_ok=True)
    rows = []
    failures = []
    seen_ids = set()
    for sample in session.get("samples", []):
        sample_id = sample.get("sampleId")
        if sample_id in seen_ids:
            failures.append({"sampleId": sample_id, "sku": sample.get("sku"), "status": "rejected", "reasons": ["Duplicate sample id."], "admitted": False})
            continue
        seen_ids.add(sample_id)
        try:
            if sample.get("trainingLabel") is not True:
                raise ValueError("This category is not a current training label and was not exported as one.")
            source = Path(str(sample.get("imagePath", "")))
            if not source.is_file():
                raise FileNotFoundError(f"Original image is missing for {sample_id}.")
            relative_image = package_image_name(sample_id, sample.get("imageName") or source.name)
            relative_mask = f"masks/{safe_id(sample_id)}.png"
            image_target = locate(dest, relative_image)
            image_target.parent.mkdir(parents=True, exist_ok=True)
            source_bytes = source.read_bytes()
            digest = file_hash(source)
            if image_target.exists() and file_hash(image_target) != digest:
                raise ValueError(f"Existing image for {sample_id} has a different hash and was not replaced.")
            if not image_target.exists() or file_hash(image_target) != digest:
                image_target.write_bytes(source_bytes)
            declared = sample.get("assetHash")
            if declared and declared != digest:
                raise ValueError(f"Image SHA-256 does not match the annotation for {sample_id}.")
            width, height = _decoded_size(image_target)
            annotated_width = sample.get("imageWidth", sample.get("width"))
            annotated_height = sample.get("imageHeight", sample.get("height"))
            if (width, height) != (annotated_width, annotated_height):
                raise ValueError(f"Decoded dimensions do not match the annotation for {sample_id}.")
            working = dict(sample)
            working["imagePath"] = str(image_target)
            working["imageWidth"] = width
            working["imageHeight"] = height
            working["byteSize"] = image_target.stat().st_size
            working["assetHash"] = digest
            row = export_row(working, locate(dest, relative_mask))
            row["imagePath"] = relative_image
            row["byteSize"] = image_target.stat().st_size
            row["assetHash"] = digest
            row["garmentMask"]["path"] = relative_mask
            if isinstance(row.get("provenance"), dict) and row["provenance"].get("origin"):
                row["provenance"] = dict(row["provenance"])
            row["review"] = "corrected"
            row["admitted"] = False
            rows.append(row)
        except (ValueError, FileNotFoundError, RuntimeError) as exc:
            failures.append({"sampleId": sample_id, "sku": sample.get("sku"), "status": "rejected", "reasons": [str(exc)], "admitted": False})
    (dest / "manifest.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    (dest / "session.json").write_text(json.dumps(session, indent=2) + "\n", encoding="utf-8")
    (dest / "package-errors.json").write_text(json.dumps(failures, indent=2) + "\n", encoding="utf-8")
    return rows, failures


def write_zip(source: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                relative = path.relative_to(source).as_posix()
                safe_member(relative)
                archive.write(path, relative)


def _entry_allowed(info: zipfile.ZipInfo, limits: dict) -> None:
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise RuntimeError(f"Symlink entries are rejected: {info.filename}")
    if info.file_size < 0 or info.file_size > limits["entry_bytes"]:
        raise RuntimeError(f"ZIP entry exceeds the {limits['entry_bytes']} byte limit: {info.filename}")
    if info.compress_size and info.file_size / info.compress_size > limits["ratio"] and info.file_size > 1_000_000:
        raise RuntimeError(f"ZIP compression ratio is not allowed: {info.filename}")


def extract_zip(zip_path: Path, dest: Path, limits: dict | None = None) -> None:
    bounds = dict(LIMITS if limits is None else {**LIMITS, **limits})
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        files = [info for info in archive.infolist() if not info.is_dir()]
        if len(files) > bounds["entries"]:
            raise RuntimeError(f"ZIP has more than {bounds['entries']} files.")
        seen = set()
        for info in files:
            if info.filename in seen:
                raise RuntimeError(f"Duplicate ZIP filename: {info.filename}")
            seen.add(info.filename)
            safe_member(info.filename)
            _entry_allowed(info, bounds)
        total = 0
        for info in files:
            target = locate(dest, info.filename)
            if target.is_symlink():
                raise RuntimeError(f"Refusing to write through a link: {info.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            written = 0
            with archive.open(info) as source, target.open("wb") as handle:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    total += len(chunk)
                    if written > bounds["entry_bytes"] or total > bounds["total_bytes"]:
                        handle.close()
                        target.unlink(missing_ok=True)
                        raise RuntimeError(f"ZIP entry exceeds the size limit: {info.filename}")
                    handle.write(chunk)


def _load_ledger(path: Path) -> dict:
    if not path.exists():
        return {"samples": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def _save_ledger(path: Path, ledger: dict) -> None:
    path.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")


def _absolute_row(root: Path, row: dict) -> dict:
    image = locate(root, row["imagePath"])
    mask = locate(root, row["garmentMask"]["path"])
    copied = dict(row)
    copied["imagePath"] = str(image)
    copied["garmentMask"] = dict(row["garmentMask"], path=str(mask))
    return copied


def verify_row(root: Path, row: dict) -> list[str]:
    reasons = []
    try:
        image = locate(root, row["imagePath"])
        mask = locate(root, row["garmentMask"]["path"])
    except RuntimeError as exc:
        return [str(exc)]
    if not image.is_file():
        reasons.append("Image file is missing from the package.")
    else:
        if file_hash(image) != row.get("assetHash"):
            reasons.append("Image SHA-256 does not match the manifest.")
        if image.stat().st_size != int(row.get("byteSize") or -1):
            reasons.append("Image byte size does not match the manifest.")
        try:
            decoded = _decoded_size(image)
        except Exception:
            reasons.append("Image could not be decoded.")
        else:
            if decoded != (row.get("imageWidth"), row.get("imageHeight")):
                reasons.append("Decoded image dimensions do not match the manifest.")
    if not mask.is_file():
        reasons.append("Garment mask is missing from the package.")
    else:
        if file_hash(mask) != row.get("garmentMask", {}).get("sha256"):
            reasons.append("Mask SHA-256 does not match the manifest.")
        try:
            decoded_mask = _decoded_size(mask)
            foreground = _foreground(mask)
        except Exception:
            reasons.append("Mask could not be decoded.")
        else:
            if decoded_mask != (row.get("garmentMask", {}).get("width"), row.get("garmentMask", {}).get("height")):
                reasons.append("Decoded mask dimensions do not match the manifest.")
            if foreground != row.get("garmentMask", {}).get("foregroundPixels"):
                reasons.append("Mask foreground count does not match the manifest.")
    if not reasons:
        reasons.extend(problems(_absolute_row(root, row)))
    return reasons


def import_dataset(zip_path: Path, dest: Path) -> dict:
    """Extract safely, verify files, and report the existing gate. This does not approve rows."""
    incoming = dest / "incoming"
    dataset = dest / "dataset"
    if incoming.exists():
        shutil.rmtree(incoming)
    extract_zip(zip_path, incoming)
    dataset.mkdir(parents=True, exist_ok=True)
    failures = []
    if (incoming / "manifest.jsonl").is_file():
        file_root = incoming
    elif (incoming / "session.json").is_file():
        staging = dest / "staging"
        if staging.exists():
            shutil.rmtree(staging)
        session = json.loads((incoming / "session.json").read_text(encoding="utf-8"))
        for sample in session.get("samples", []):
            relative = sample.get("imageFile") or package_image_name(sample.get("sampleId", ""), sample.get("imageName", ""))
            sample["imagePath"] = str(locate(incoming, relative))
            sample["imageName"] = Path(relative).name
        _rows, failures = build_package(session, staging)
        file_root = staging
    else:
        raise FileNotFoundError("The ZIP has neither manifest.jsonl nor session.json.")
    rows = [json.loads(line) for line in (file_root / "manifest.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    ledger_path = dest / "import-ledger.json"
    ledger = _load_ledger(ledger_path)
    samples = []
    seen_ids = set()
    for row in rows:
        if row.get("sampleId") in seen_ids:
            samples.append(_sample_report(row, "rejected", ["Duplicate sample id."]))
            continue
        seen_ids.add(row.get("sampleId"))
        reasons = _place_row(file_root, dataset, row)
        previous = ledger["samples"].get(row["sampleId"])
        if previous and previous.get("assetHash") != row.get("assetHash"):
            reasons = reasons + ["This sample was already imported with a different image hash."]
        if previous and previous.get("assetHash") == row.get("assetHash") and previous.get("status") == "verified" and not reasons:
            samples.append(_sample_report(row, "reused", [], dataset))
            continue
        status = "rejected" if reasons else "verified"
        if status == "verified":
            ledger["samples"][row["sampleId"]] = {"assetHash": row["assetHash"], "status": "verified"}
            _save_ledger(ledger_path, ledger)
        samples.append(_sample_report(row, status, reasons, dataset if not reasons else None))
    samples.extend(failures)
    verified_rows = [_absolute_row(dataset, row) for row in rows if any(item["sampleId"] == row.get("sampleId") and item["status"] in {"verified", "reused"} and not item["reasons"] for item in samples)]
    admission_notes = []
    for row in verified_rows:
        _approved, errors = approve(row, str(row.get("reviewer") or ""))
        if errors:
            admission_notes.append({"sampleId": row["sampleId"], "reasons": errors, "admitted": False})
        elif row.get("review") != "approved":
            admission_notes.append({"sampleId": row["sampleId"], "reasons": ["Not approved. The importer does not auto-approve."], "admitted": False})
    approved_rows = [row for row in verified_rows if row.get("review") == "approved" and str(row.get("reviewer") or "") not in {"", str(row.get("annotator") or "")}]
    admission = admit(approved_rows) if approved_rows else {"admitted": [], "rows": []}
    kept = [row for row in rows if any(item["sampleId"] == row.get("sampleId") and item["status"] in {"verified", "reused"} for item in samples)]
    (dataset / "manifest.jsonl").write_text("".join(json.dumps(row) + "\n" for row in kept), encoding="utf-8")
    report = {
        "samples": samples,
        "accepted": [item for item in samples if item["status"] in {"verified", "reused"}],
        "rejected": [item for item in samples if item["status"] == "rejected"],
        "admission": admission_notes,
        "admitted": admission["admitted"],
        "autoApproved": False,
        "trained": False,
        "featureExtractionRan": False,
        "readyForLive": False,
        "dataset": str(dataset),
    }
    (dest / "import-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def _place_row(source_root: Path, dataset: Path, row: dict) -> list[str]:
    try:
        source_image = locate(source_root, row["imagePath"])
        source_mask = locate(source_root, row["garmentMask"]["path"])
        target_image = locate(dataset, row["imagePath"])
        target_mask = locate(dataset, row["garmentMask"]["path"])
    except (RuntimeError, KeyError, TypeError) as exc:
        return [str(exc)]
    if target_image.exists() and file_hash(target_image) != row.get("assetHash"):
        return ["Existing image has a different hash and was not replaced."]
    if target_mask.exists() and file_hash(target_mask) != row.get("garmentMask", {}).get("sha256"):
        return ["Existing mask has a different hash and was not replaced."]
    if source_image.is_file() and (not target_image.exists()):
        target_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_image, target_image)
    if source_mask.is_file() and not target_mask.exists():
        target_mask.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_mask, target_mask)
    return verify_row(dataset, row)


def _public(row: dict) -> dict:
    return {
        "sampleId": row.get("sampleId"),
        "sku": row.get("sku"),
        "assetHash": row.get("assetHash"),
        "split": row.get("split"),
        "review": row.get("review"),
    }


def _sample_report(row: dict, status: str, reasons: list[str], dataset: Path | None = None) -> dict:
    checked = _absolute_row(dataset, row) if dataset is not None and not reasons else row
    verdict = admission_status(checked)
    return {
        **_public(row),
        "status": status,
        "reasons": reasons,
        "admitted": False,
        "admissionStatus": verdict["status"],
        "admissionLabel": verdict["label"],
        "admissionReasons": verdict["reasons"],
    }
    return {
        "sampleId": row.get("sampleId"),
        "sku": row.get("sku"),
        "assetHash": row.get("assetHash"),
        "split": row.get("split"),
        "review": row.get("review"),
    }


def features_for_admitted(rows: list[dict], dest: Path, encode, open_image) -> dict:
    """The test split is still excluded. Import does not call this."""
    return extract_spatial(rows, dest, encode, open_image)
