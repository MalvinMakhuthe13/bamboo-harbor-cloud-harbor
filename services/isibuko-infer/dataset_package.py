"""Turn an annotation session into a dataset ZIP and import it without auto-approval."""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

from PIL import Image

from annotation_studio import export_row
from dataset_gate import admit, approve, file_hash, problems
from feature_extract import extract_spatial

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


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
    if not name or name.endswith("/"):
        raise RuntimeError(f"Path traversal rejected: {name}")
    if "\\" in name or name.startswith("/"):
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
    for sample in session.get("samples", []):
        sample_id = sample.get("sampleId")
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
            if not image_target.exists() or image_target.read_bytes() != source_bytes:
                image_target.write_bytes(source_bytes)
            digest = file_hash(image_target)
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
            row["provenance"] = {"source": "annotation-studio", "acquired": "annotator", "origin": relative_image}
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


def extract_zip(zip_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            target = locate(dest, info.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as handle:
                shutil.copyfileobj(source, handle)


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


def _prepare_package(extracted: Path, dataset: Path) -> list[dict]:
    if (extracted / "manifest.jsonl").is_file() and not dataset.exists():
        shutil.copytree(extracted, dataset)
        return []
    if dataset.exists():
        errors = dataset / "package-errors.json"
        return json.loads(errors.read_text(encoding="utf-8")) if errors.is_file() else []
    session_path = extracted / "session.json"
    if not session_path.is_file():
        raise FileNotFoundError("The ZIP has neither manifest.jsonl nor session.json.")
    session = json.loads(session_path.read_text(encoding="utf-8"))
    for sample in session.get("samples", []):
        relative = sample.get("imageFile") or package_image_name(sample.get("sampleId", ""), sample.get("imageName", ""))
        sample["imagePath"] = str(locate(extracted, relative))
        sample["imageName"] = Path(relative).name
    _rows, failures = build_package(session, dataset)
    return failures


def import_dataset(zip_path: Path, dest: Path) -> dict:
    """Extract safely, verify files, and report the existing gate. This does not approve rows."""
    incoming = dest / "incoming"
    dataset = dest / "dataset"
    extract_zip(zip_path, incoming)
    failures = _prepare_package(incoming, dataset)
    manifest_path = dataset / "manifest.jsonl"
    rows = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    ledger_path = dest / "import-ledger.json"
    ledger = _load_ledger(ledger_path)
    samples = []
    for row in rows:
        reasons = verify_row(dataset, row)
        previous = ledger["samples"].get(row["sampleId"])
        if previous and previous.get("assetHash") == row.get("assetHash") and previous.get("status") == "verified" and not reasons:
            samples.append({**_public(row), "status": "reused", "reasons": [], "admitted": False})
            continue
        if previous and previous.get("assetHash") != row.get("assetHash"):
            reasons = reasons + ["This sample was already imported with a different image hash."]
        status = "rejected" if reasons else "verified"
        if status == "verified":
            ledger["samples"][row["sampleId"]] = {"assetHash": row["assetHash"], "status": "verified"}
            _save_ledger(ledger_path, ledger)
        samples.append({**_public(row), "status": status, "reasons": reasons, "admitted": False})
    samples.extend(failures)
    verified_rows = [_absolute_row(dataset, row) for row, item in zip(rows, samples) if item["status"] in {"verified", "reused"} and not item["reasons"]]
    admission_notes = []
    for row in verified_rows:
        _approved, errors = approve(row, str(row.get("reviewer") or ""))
        if errors:
            admission_notes.append({"sampleId": row["sampleId"], "reasons": errors, "admitted": False})
        elif row.get("review") != "approved":
            admission_notes.append({"sampleId": row["sampleId"], "reasons": ["Not approved. The importer does not auto-approve."], "admitted": False})
    approved_rows = []
    for row in verified_rows:
        if row.get("review") == "approved" and str(row.get("reviewer") or "") not in {"", str(row.get("annotator") or "")}:
            approved_rows.append(row)
    admission = admit(approved_rows) if approved_rows else {"admitted": [], "rows": []}
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


def _public(row: dict) -> dict:
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
