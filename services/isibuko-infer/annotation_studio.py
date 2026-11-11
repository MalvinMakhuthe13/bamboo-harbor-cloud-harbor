"""Garment annotation drafts. A drawn mask is not a learned segmentation model."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

from dataset_gate import admit, approve, file_hash, problems
from garment_intel import CATEGORIES, CONFIDENCE_MIN, PARTS

FUTURE_CATEGORIES = ("skirt", "shoes", "bag", "wig", "jewellery", "glasses", "accessory")
SESSION_VERSION = 1


def new_session() -> dict:
    return {"version": SESSION_VERSION, "samples": []}


def save_session(path: Path, session: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, indent=2) + "\n", encoding="utf-8")


def load_session(path: Path) -> dict:
    session = json.loads(path.read_text(encoding="utf-8"))
    if session.get("version") != SESSION_VERSION or not isinstance(session.get("samples"), list):
        raise ValueError("Annotation session is not readable.")
    return session


def import_image(session: dict, path: Path, sku: str, sample_id: str | None = None) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path.name)
    with Image.open(path) as image:
        image.load()
        width, height = image.size
    sample = {
        "sampleId": sample_id or path.stem,
        "sku": sku,
        "imagePath": str(path),
        "assetHash": file_hash(path),
        "byteSize": path.stat().st_size,
        "imageWidth": width,
        "imageHeight": height,
        "category": None,
        "futureCategory": None,
        "trainingLabel": False,
        "licence": None,
        "commercialUse": False,
        "consent": None,
        "annotator": "",
        "reviewer": "",
        "confidence": 0,
        "split": "train",
        "captureId": None,
        "merchant": {
            "fabric": "",
            "colours": [],
            "pattern": None,
            "source": "merchant-record",
            "visuallyDetected": False,
        },
        "visual": {"logosDetected": False, "patternDetected": False, "materialDetected": False},
        "garmentPolygon": None,
        "parts": {name: {"present": None, "kind": None, "confidence": None} for name in PARTS},
    }
    session["samples"].append(sample)
    return sample


def set_category(sample: dict, name: str) -> None:
    if name in CATEGORIES:
        sample["category"] = name
        sample["futureCategory"] = None
        sample["trainingLabel"] = True
        return
    if name in FUTURE_CATEGORIES:
        sample["category"] = None
        sample["futureCategory"] = name
        sample["trainingLabel"] = False
        return
    raise ValueError(f"{name} is not a known category.")


def _inside(point, width: int, height: int) -> bool:
    return (
        isinstance(point, (list, tuple))
        and len(point) == 2
        and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in point)
        and 0 <= point[0] < width
        and 0 <= point[1] < height
    )


def set_part(sample: dict, name: str, present: bool, geometry: dict | None, confidence: float, side: str | None = None) -> None:
    if name not in PARTS:
        raise ValueError(f"{name} is not a garment part.")
    if not isinstance(present, bool):
        raise ValueError(f"{name} must be explicitly present or absent.")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        raise ValueError(f"{name} needs a confidence value.")
    if present is False:
        if geometry:
            raise ValueError(f"{name} is absent and cannot keep geometry.")
        sample["parts"][name] = {"present": False, "kind": "absent", "confidence": confidence, "side": None}
        return
    if not isinstance(geometry, dict):
        raise ValueError(f"{name} is present and needs a polygon or box.")
    kind = geometry.get("kind")
    width, height = sample["imageWidth"], sample["imageHeight"]
    if kind == "polygon":
        polygon = geometry.get("polygon")
        if not isinstance(polygon, list) or len(polygon) < 3 or any(not _inside(point, width, height) for point in polygon):
            raise ValueError(f"{name} polygon is missing or outside the image.")
    elif kind == "box":
        box = geometry.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            raise ValueError(f"{name} box is missing.")
        x, y, box_width, box_height = box
        if box_width <= 0 or box_height <= 0 or x < 0 or y < 0 or x + box_width > width or y + box_height > height:
            raise ValueError(f"{name} box is outside the image.")
    else:
        raise ValueError(f"{name} needs a polygon or box. A present flag is not geometry.")
    if side not in (None, "left", "right", "both"):
        raise ValueError("Side must be left, right, both, or empty.")
    sample["parts"][name] = {
        "present": True,
        "kind": kind,
        "polygon": geometry.get("polygon"),
        "box": geometry.get("box"),
        "confidence": confidence,
        "side": side,
        "sides": geometry.get("sides"),
    }


def set_merchant(sample: dict, fabric: str, colours: list[str], pattern: str | None) -> None:
    sample["merchant"] = {
        "fabric": fabric,
        "colours": list(colours),
        "pattern": pattern,
        "source": "merchant-record",
        "visuallyDetected": False,
    }
    sample["visual"] = {"logosDetected": False, "patternDetected": False, "materialDetected": False}


def rasterize(sample: dict, mask_path: Path) -> dict:
    width, height = sample["imageWidth"], sample["imageHeight"]
    polygon = sample.get("garmentPolygon")
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValueError("A garment polygon is required before a mask can be written.")
    if any(not _inside(point, width, height) for point in polygon):
        raise ValueError("Garment polygon is outside the image.")
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).polygon([tuple(point) for point in polygon], fill=255)
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    mask.save(mask_path)
    foreground = sum(1 for value in mask.get_flattened_data() if value > 0)
    if foreground <= 0:
        raise ValueError("Rasterized mask foreground is empty.")
    return {
        "path": str(mask_path),
        "sha256": file_hash(mask_path),
        "width": width,
        "height": height,
        "foregroundPixels": foreground,
    }


def export_row(sample: dict, mask_path: Path) -> dict:
    if sample.get("trainingLabel") is not True or sample.get("category") not in CATEGORIES:
        raise ValueError("This category is not a current training label and was not exported as one.")
    mask = rasterize(sample, mask_path)
    parts = {}
    for name in PARTS:
        part = sample["parts"][name]
        if part.get("present") is True and part.get("kind") == "polygon":
            parts[name] = {"present": True, "kind": "polygon", "polygon": part["polygon"]}
        elif part.get("present") is True and part.get("kind") == "box":
            parts[name] = {"present": True, "kind": "box", "box": part["box"]}
        elif part.get("present") is False and part.get("kind") == "absent":
            parts[name] = {"present": False, "kind": "absent"}
        else:
            raise ValueError(f"{name} is neither present geometry nor an explicit absence.")
    merchant = sample["merchant"]
    if merchant.get("visuallyDetected") is not False:
        raise ValueError("Merchant fabric, colour, and pattern were not visually detected.")
    return {
        "sampleId": sample["sampleId"],
        "sku": sample["sku"],
        "assetHash": sample["assetHash"],
        "byteSize": sample["byteSize"],
        "imagePath": sample["imagePath"],
        "imageWidth": sample["imageWidth"],
        "imageHeight": sample["imageHeight"],
        "provenance": {"source": "annotation-studio", "acquired": "annotator", "origin": sample["imagePath"]},
        "category": sample["category"],
        "licence": sample.get("licence"),
        "commercialUse": sample.get("commercialUse") is True,
        "consent": sample.get("consent"),
        "parts": parts,
        "garmentMask": mask,
        "bodyMask": None,
        "personCapturePermitted": False,
        "confidence": sample.get("confidence"),
        "review": "corrected",
        "annotator": sample.get("annotator") or "",
        "reviewer": sample.get("reviewer") or "",
        "split": sample.get("split"),
        "pattern": merchant.get("pattern"),
        "fabric": merchant.get("fabric") or "",
        "colours": merchant.get("colours") or [],
        "captureId": sample.get("captureId"),
        "admitted": False,
        "trainingLabel": True,
        "merchantVisuallyDetected": False,
        "logosDetected": False,
    }


def dataset_report(samples: list[dict], rows: list[dict]) -> dict:
    """Explain every rejection. Admission still goes through the existing gate."""
    incomplete = []
    future = []
    for sample in samples:
        if sample.get("futureCategory"):
            future.append({"sampleId": sample["sampleId"], "reasons": [f"{sample['futureCategory']} is not a current training label."]})
            continue
        missing = [name for name in PARTS if not isinstance(sample.get("parts", {}).get(name), dict) or sample["parts"][name].get("present") is None]
        if missing or not sample.get("garmentPolygon"):
            incomplete.append({"sampleId": sample.get("sampleId"), "reasons": [f"Missing geometry for {', '.join(missing) or 'the garment outline'}."]})
    reviewed = []
    reviewer_rejected = []
    rights_rejected = []
    for row in rows:
        reasons = problems(row)
        rights = [reason for reason in reasons if "Licence" in reason or "Commercial" in reason or "consent" in reason or "person imagery" in reason]
        if rights:
            rights_rejected.append({"sampleId": row.get("sampleId"), "reasons": rights})
        approved, errors = approve(row, str(row.get("reviewer") or ""))
        if errors:
            reviewer_rejected.append({"sampleId": row.get("sampleId"), "reasons": errors})
            continue
        reviewed.append(approved)
    admission = admit(reviewed)
    rejected_rows = [item for item in admission["rows"] if not item["admitted"]]
    balance: dict[str, int] = {name: 0 for name in CATEGORIES}
    for row in admission["admitted"]:
        balance[row["category"]] = balance.get(row["category"], 0) + 1
    missing_parts = []
    for row in rows:
        parts = row.get("parts") if isinstance(row.get("parts"), dict) else {}
        absent = [name for name in PARTS if not isinstance(parts.get(name), dict) or parts[name].get("kind") not in ("polygon", "box", "absent")]
        if absent:
            missing_parts.append({"sampleId": row.get("sampleId"), "parts": absent})
    duplicate_rejections = [item for item in rejected_rows if any("Duplicate" in reason or "Near-duplicate" in reason or "re-encoding" in reason or "resizing" in reason or "leaks" in reason for reason in item["reasons"])]
    return {
        "imported": len(samples),
        "annotated": len(rows),
        "incomplete": incomplete,
        "futureCategories": future,
        "rightsRejected": rights_rejected,
        "reviewerRejected": reviewer_rejected,
        "admittedTrain": sum(1 for row in admission["admitted"] if row["split"] == "train"),
        "admittedVal": sum(1 for row in admission["admitted"] if row["split"] == "val"),
        "admittedTest": sum(1 for row in admission["admitted"] if row["split"] == "test"),
        "duplicateRejections": duplicate_rejections,
        "otherRejections": [item for item in rejected_rows if item not in duplicate_rejections],
        "categoryBalance": balance,
        "missingPartAnnotations": missing_parts,
        "readyForExperiment": admission["readyForExperiment"],
        "minimums": {"train": 40, "val": 10},
        "learnedSegmentation": False,
        "readyForLive": False,
        "reasons": incomplete + future + rights_rejected + reviewer_rejected + rejected_rows,
    }
