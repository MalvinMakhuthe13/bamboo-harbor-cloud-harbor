"""Admit or reject garment training rows.

A present flag is not a part annotation. The five catalog photographs are not admitted.
Near-duplicates are rejected with a reason. Different products are not merged.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

from garment_intel import CATEGORIES, CONFIDENCE_MIN, MIN_TRAIN, MIN_VAL, PARTS, RIGHTS_OK

CATALOG = (
    "shirt-linen.png",
    "shirt-silk.png",
    "jacket-camel.png",
    "dress-slip.png",
    "pants-charcoal.png",
)
REQUIRED_PRESENT = {
    "shirt": ("collar", "sleeve", "hem"),
    "jacket": ("collar", "sleeve", "hem"),
    "dress": ("straps", "hem"),
    "pants": ("legs", "hem"),
}
EDITABLE = {
    "parts",
    "category",
    "fabric",
    "colours",
    "pattern",
    "confidence",
    "split",
    "garmentMask",
    "bodyMask",
    "personCapturePermitted",
    "annotator",
    "imagePath",
    "captureId",
}
NEAR_HAMMING = 4
COLOR_DISTANCE = 36


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def content_id(path: Path) -> str:
    """Identity of the pixels after a fixed resize. Re-encoding or resizing the same picture matches."""
    image = Image.open(path).convert("RGB").resize((32, 32), Image.Resampling.BOX)
    return hashlib.sha256(image.tobytes()).hexdigest()


def perceptual_fingerprint(path: Path) -> tuple[int, tuple[int, int, int]]:
    image = Image.open(path).convert("RGB").resize((9, 8), Image.Resampling.BOX)
    pixels = list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
    bits = 0
    for y in range(8):
        row = pixels[y * 9 : (y + 1) * 9]
        for x in range(8):
            left = row[x]
            right = row[x + 1]
            luminance_left = left[0] + left[1] + left[2]
            luminance_right = right[0] + right[1] + right[2]
            bits = (bits << 1) | int(luminance_left < luminance_right)
    count = max(1, len(pixels))
    mean = tuple(sum(pixel[channel] for pixel in pixels) // count for channel in range(3))
    return bits, mean


def _near(left: tuple[int, tuple[int, int, int]], right: tuple[int, tuple[int, int, int]]) -> bool:
    distance = (left[0] ^ right[0]).bit_count()
    color = sum(abs(a - b) for a, b in zip(left[1], right[1]))
    return distance <= NEAR_HAMMING and color <= COLOR_DISTANCE


def catalog_drafts() -> list[dict]:
    root = Path(__file__).resolve().parents[2] / "public" / "catalog"
    drafts = []
    for name in CATALOG:
        path = root / name
        with Image.open(path) as image:
            width, height = image.size
        stem = name.replace(".png", "")
        category = "shirt" if stem.startswith("shirt") else "jacket" if stem.startswith("jacket") else "dress" if stem.startswith("dress") else "pants"
        drafts.append(
            {
                "sampleId": name,
                "sku": stem,
                "assetHash": file_hash(path),
                "byteSize": path.stat().st_size,
                "imagePath": str(path),
                "imageWidth": width,
                "imageHeight": height,
                "provenance": {"source": "repository-catalog", "acquired": "unreviewed", "origin": f"public/catalog/{name}"},
                "category": category,
                "licence": "unreviewed",
                "commercialUse": False,
                "consent": None,
                "parts": None,
                "garmentMask": None,
                "bodyMask": None,
                "personCapturePermitted": False,
                "confidence": 0,
                "review": "draft",
                "annotator": "",
                "reviewer": "",
                "split": "train",
                "pattern": None,
                "fabric": "",
                "colours": [],
                "admitted": False,
            }
        )
    return drafts


def _inside(point, width: int, height: int) -> bool:
    return (
        isinstance(point, (list, tuple))
        and len(point) == 2
        and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in point)
        and 0 <= point[0] < width
        and 0 <= point[1] < height
    )


def _decoded_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        image.load()
        return image.size


def _decoded_mask(path: Path) -> tuple[int, int, int]:
    with Image.open(path) as image:
        gray = image.convert("L")
        gray.load()
        width, height = gray.size
        pixels = gray.get_flattened_data() if hasattr(gray, "get_flattened_data") else gray.getdata()
        foreground = sum(1 for value in pixels if value > 0)
    return width, height, foreground


def _mask_errors(mask, width: int, height: int, label: str) -> list[str]:
    if not isinstance(mask, dict):
        return [f"{label} mask file is missing."]
    path = mask.get("path")
    if not path or not Path(str(path)).is_file():
        return [f"{label} mask file is missing."]
    file = Path(str(path))
    if file_hash(file) != mask.get("sha256"):
        return [f"{label} mask hash does not match the file."]
    try:
        decoded_width, decoded_height, foreground = _decoded_mask(file)
    except Exception:
        return [f"{label} mask could not be decoded."]
    reasons = []
    if decoded_width != int(mask.get("width") or -1) or decoded_height != int(mask.get("height") or -1):
        reasons.append(f"{label} mask dimensions do not match the decoded mask.")
    if foreground != int(mask.get("foregroundPixels") or -1):
        reasons.append(f"{label} mask foreground count does not match the decoded mask.")
    if decoded_width != width or decoded_height != height:
        reasons.append(f"{label} mask dimensions do not match the image.")
    return reasons


def _part_errors(name: str, part, width: int, height: int) -> list[str]:
    if not isinstance(part, dict) or not isinstance(part.get("present"), bool):
        return [f"{name} must be explicitly present or absent."]
    if part["present"] is False:
        if part.get("kind") != "absent":
            return [f"{name} is absent but was not recorded as absent."]
        if part.get("polygon") or part.get("box") or part.get("mask"):
            return [f"{name} is marked absent but still has geometry."]
        return []
    kind = part.get("kind")
    if kind == "polygon":
        polygon = part.get("polygon")
        if not isinstance(polygon, list) or len(polygon) < 3 or any(not _inside(point, width, height) for point in polygon):
            return [f"{name} polygon is missing or outside the image."]
        return []
    if kind == "box":
        box = part.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            return [f"{name} box is missing."]
        x, y, box_width, box_height = box
        if box_width <= 0 or box_height <= 0 or x < 0 or y < 0 or x + box_width > width or y + box_height > height:
            return [f"{name} box is outside the image."]
        return []
    if kind == "mask":
        return _mask_errors(part.get("mask"), width, height, name)
    return [f"{name} needs a polygon, box, or mask. A present flag is not a part annotation."]


def problems(row: dict) -> list[str]:
    reasons: list[str] = []
    if not str(row.get("sampleId", "")).strip() or not str(row.get("sku", "")).strip():
        reasons.append("sampleId and sku are required.")
    image_path = row.get("imagePath")
    width = int(row.get("imageWidth") or 0)
    height = int(row.get("imageHeight") or 0)
    if not image_path or not Path(str(image_path)).is_file():
        reasons.append("Image path is missing or is not a file.")
    elif width < 1 or height < 1:
        reasons.append("Image width and height are required.")
    else:
        file = Path(str(image_path))
        if file_hash(file) != row.get("assetHash"):
            reasons.append("Recorded sha256 does not match the image file.")
        if file.stat().st_size != int(row.get("byteSize") or -1):
            reasons.append("byteSize does not match the image file.")
        try:
            decoded_width, decoded_height = _decoded_size(file)
        except Exception:
            reasons.append("Image could not be decoded.")
        else:
            if decoded_width != width or decoded_height != height:
                reasons.append("Manifest image dimensions do not match the decoded image.")
            width, height = decoded_width, decoded_height
    provenance = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
    if not str(provenance.get("source", "")).strip() or not str(provenance.get("acquired", "")).strip():
        reasons.append("Provenance needs a source and an acquired date.")
    if row.get("licence") not in RIGHTS_OK:
        reasons.append("Licence is not isibuko-owned or commercially-licensed.")
    if row.get("commercialUse") is not True:
        reasons.append("Commercial use is not granted.")
    consent = row.get("consent") if isinstance(row.get("consent"), dict) else None
    if consent is None or consent.get("allowsTraining") is not True:
        reasons.append("A consent record that allows training is missing.")
    elif consent.get("rights") != row.get("licence"):
        reasons.append("Consent rights do not match the licence.")
    if row.get("category") not in CATEGORIES:
        reasons.append("Category is not a training label.")
    if not str(row.get("fabric", "")).strip() or not row.get("colours"):
        reasons.append("Fabric metadata and colour names are required.")
    confidence = row.get("confidence")
    if not isinstance(confidence, (int, float)) or confidence < CONFIDENCE_MIN:
        reasons.append("Annotation confidence is below 0.8.")
    if not str(row.get("annotator", "")).strip():
        reasons.append("An annotator is required.")
    parts = row.get("parts")
    if not isinstance(parts, dict) or any(name not in parts for name in PARTS):
        reasons.append("Collar, sleeve, hem, straps, and legs must each be explicitly present or absent.")
    elif width > 0 and height > 0:
        for name in PARTS:
            reasons.extend(_part_errors(name, parts[name], width, height))
        required = REQUIRED_PRESENT.get(row.get("category"), ())
        for name in required:
            if isinstance(parts.get(name), dict) and parts[name].get("present") is not True:
                reasons.append(f"{row.get('category')} requires a spatial annotation for {name}.")
    garment = row.get("garmentMask")
    if width > 0 and height > 0:
        reasons.extend(_mask_errors(garment, width, height, "Garment"))
    body = row.get("bodyMask")
    if body is not None:
        if row.get("personCapturePermitted") is not True or consent is None or consent.get("allowsPersonImagery") is not True:
            reasons.append("A person or body mask is present without permission to use person imagery.")
        elif width > 0 and height > 0:
            reasons.extend(_mask_errors(body, width, height, "Body"))
    if row.get("split") not in ("train", "val", "test"):
        reasons.append("Split must be train, val, or test.")
    return reasons


def correct(row: dict, changes: dict, reviewer: str) -> tuple[dict, list[str]]:
    if not str(reviewer).strip():
        return row, ["A reviewer is required to record a correction."]
    blocked = [key for key in changes if key not in EDITABLE]
    if blocked:
        return row, [f"{', '.join(blocked)} cannot be edited here. Rights go through set_rights."]
    updated = dict(row)
    updated.update(changes)
    updated["review"] = "corrected"
    updated["reviewer"] = reviewer
    updated["admitted"] = False
    return updated, []


def set_rights(row: dict, licence: str, consent: dict, commercial_use: bool, reviewer: str) -> tuple[dict, list[str]]:
    if not str(reviewer).strip():
        return row, ["A reviewer is required to record rights."]
    updated = dict(row)
    updated["licence"] = licence
    updated["consent"] = consent
    updated["commercialUse"] = commercial_use
    updated["review"] = "corrected"
    updated["reviewer"] = reviewer
    updated["admitted"] = False
    return updated, []


def approve(row: dict, reviewer: str) -> tuple[dict, list[str]]:
    reasons = problems(row)
    if not str(reviewer).strip():
        reasons.append("A reviewer is required.")
    elif reviewer.strip() == str(row.get("annotator", "")).strip():
        reasons.append("The reviewer must be a different person from the annotator.")
    if reasons:
        return row, reasons
    approved = dict(row)
    approved["review"] = "approved"
    approved["reviewer"] = reviewer
    approved["admitted"] = False
    return approved, []


def _pair_reasons(rows: list[dict]) -> dict[int, list[str]]:
    extra: dict[int, list[str]] = {index: [] for index in range(len(rows))}
    fingerprints = []
    contents = []
    for row in rows:
        path = Path(str(row["imagePath"]))
        fingerprints.append(perceptual_fingerprint(path))
        contents.append(content_id(path))
    for left in range(len(rows)):
        for right in range(left + 1, len(rows)):
            same_file = rows[left].get("assetHash") == rows[right].get("assetHash")
            same_pixels = contents[left] == contents[right]
            same_capture = rows[left].get("captureId") and rows[left].get("captureId") == rows[right].get("captureId")
            different_split = rows[left].get("split") != rows[right].get("split")
            if same_file:
                reason = "Duplicate image hash across the batch. The same file cannot sit in two splits."
            elif same_pixels:
                reason = "Same pixels after resizing or re-encoding. The rows were not merged."
            elif same_capture and different_split:
                reason = f"Capture {rows[left]['captureId']} leaks across splits."
            elif different_split and _near(fingerprints[left], fingerprints[right]):
                if rows[left].get("sku") != rows[right].get("sku"):
                    reason = "Near-duplicate across splits of a different sku. The products were not merged."
                else:
                    reason = "Near-duplicate of the same sku leaks across splits."
            else:
                continue
            extra[left].append(reason)
            extra[right].append(reason)
    return extra


def admit(rows: list[dict]) -> dict:
    """Accept approved rows. Exact copies, re-encodes, and cross-split leaks are rejected."""
    candidates = []
    report_rows = []
    for index, row in enumerate(rows):
        reasons = []
        if row.get("review") != "approved":
            reasons.append("Review status is not approved.")
        reasons.extend(problems(row))
        if reasons:
            report_rows.append((index, {"sampleId": row.get("sampleId"), "sku": row.get("sku"), "admitted": False, "reasons": reasons}))
        else:
            candidates.append(index)
    extra = _pair_reasons([rows[index] for index in candidates]) if candidates else {}
    admitted = []
    notes = []
    candidate_report = {}
    for position, index in enumerate(candidates):
        reasons = list(dict.fromkeys(extra.get(position, [])))
        if reasons:
            candidate_report[index] = {"sampleId": rows[index].get("sampleId"), "sku": rows[index].get("sku"), "admitted": False, "reasons": reasons}
            continue
        kept = dict(rows[index])
        kept["admitted"] = True
        admitted.append(kept)
        candidate_report[index] = {"sampleId": kept["sampleId"], "sku": kept["sku"], "admitted": True, "reasons": []}
    for left_pos, left in enumerate(candidates):
        if not candidate_report[left]["admitted"]:
            continue
        for right_pos in range(left_pos + 1, len(candidates)):
            right = candidates[right_pos]
            if not candidate_report[right]["admitted"]:
                continue
            if rows[left].get("split") != rows[right].get("split") or rows[left].get("sku") == rows[right].get("sku"):
                continue
            left_print = perceptual_fingerprint(Path(str(rows[left]["imagePath"])))
            right_print = perceptual_fingerprint(Path(str(rows[right]["imagePath"])))
            if _near(left_print, right_print):
                notes.append(
                    {
                        "sampleId": rows[left]["sampleId"],
                        "other": rows[right]["sampleId"],
                        "reason": "Similar pictures of different skus stayed separate. They were not merged.",
                    }
                )
    ordered = []
    for index in range(len(rows)):
        found = next((item for item_index, item in report_rows if item_index == index), None)
        ordered.append(found if found is not None else candidate_report[index])
    train = sum(1 for row in admitted if row["split"] == "train")
    val = sum(1 for row in admitted if row["split"] == "val")
    return {
        "admitted": admitted,
        "rejected": len(rows) - len(admitted),
        "rows": ordered,
        "notes": notes,
        "train": train,
        "val": val,
        "readyForExperiment": train >= MIN_TRAIN and val >= MIN_VAL,
        "duplicatePolicy": "sha256, canonical pixels, perceptual hash, and capture id",
        "nearDuplicateDetection": True,
    }


def write_manifest(path: Path, report: dict) -> None:
    for row in report["admitted"]:
        if row.get("admitted") is not True:
            raise ValueError("Refusing to write a row that was not admitted.")
    lines = [json.dumps(row, sort_keys=True) for row in report["admitted"]]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def load_manifest(path: Path) -> list[dict]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
