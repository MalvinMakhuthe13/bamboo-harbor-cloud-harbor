"""Admit or reject garment training rows.

The five catalog photographs are not admitted. A row needs rights, consent,
a garment mask, part labels, and a reviewer who is not the annotator.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from garment_intel import CATEGORIES, CONFIDENCE_MIN, MIN_TRAIN, MIN_VAL, PARTS, RIGHTS_OK

CATALOG = (
    "shirt-linen.png",
    "shirt-silk.png",
    "jacket-camel.png",
    "dress-slip.png",
    "pants-charcoal.png",
)
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
}


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def catalog_drafts() -> list[dict]:
    root = Path(__file__).resolve().parents[2] / "public" / "catalog"
    drafts = []
    for name in CATALOG:
        path = root / name
        stem = name.replace(".png", "")
        category = "shirt" if stem.startswith("shirt") else "jacket" if stem.startswith("jacket") else "dress" if stem.startswith("dress") else "pants"
        drafts.append(
            {
                "sampleId": name,
                "sku": stem,
                "assetHash": file_hash(path),
                "byteSize": path.stat().st_size,
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


def problems(row: dict) -> list[str]:
    reasons: list[str] = []
    if not str(row.get("sampleId", "")).strip() or not str(row.get("sku", "")).strip():
        reasons.append("sampleId and sku are required.")
    digest = row.get("assetHash")
    if not isinstance(digest, str) or len(digest) != 64:
        reasons.append("assetHash must be the sha256 of the image file.")
    if int(row.get("byteSize") or 0) <= 0:
        reasons.append("byteSize must be the file size in bytes.")
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
        reasons.append("Collar, sleeve, hem, straps, and legs must each be annotated.")
    elif any(not isinstance(parts[name], dict) or not isinstance(parts[name].get("present"), bool) for name in PARTS):
        reasons.append("Each part needs present true or false.")
    elif row.get("category") == "pants" and parts["legs"].get("present") is not True:
        reasons.append("Trouser legs were marked absent on a pants sample.")
    mask = row.get("garmentMask")
    if not isinstance(mask, dict) or int(mask.get("foregroundPixels") or 0) < 16 or len(str(mask.get("sha256", ""))) != 64:
        reasons.append("A garment mask with a sha256 and foreground pixels is required.")
    body = row.get("bodyMask")
    if body is not None:
        if row.get("personCapturePermitted") is not True or consent is None or consent.get("allowsPersonImagery") is not True:
            reasons.append("A person or body mask is present without permission to use person imagery.")
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


def admit(rows: list[dict]) -> dict:
    """Accept approved rows. Duplicate file hashes are rejected in every split."""
    counts: dict[str, int] = {}
    for row in rows:
        digest = row.get("assetHash")
        if isinstance(digest, str):
            counts[digest] = counts.get(digest, 0) + 1
    report_rows = []
    admitted = []
    for row in rows:
        reasons = []
        if row.get("review") != "approved":
            reasons.append("Review status is not approved.")
        reasons.extend(problems(row))
        digest = row.get("assetHash")
        if isinstance(digest, str) and counts.get(digest, 0) > 1:
            reasons.append("Duplicate image hash across the batch. The same file cannot sit in two splits.")
        if reasons:
            report_rows.append({"sampleId": row.get("sampleId"), "sku": row.get("sku"), "admitted": False, "reasons": reasons})
            continue
        kept = dict(row)
        kept["admitted"] = True
        admitted.append(kept)
        report_rows.append({"sampleId": kept["sampleId"], "sku": kept["sku"], "admitted": True, "reasons": []})
    train = sum(1 for row in admitted if row["split"] == "train")
    val = sum(1 for row in admitted if row["split"] == "val")
    return {
        "admitted": admitted,
        "rejected": len(rows) - len(admitted),
        "rows": report_rows,
        "train": train,
        "val": val,
        "readyForExperiment": train >= MIN_TRAIN and val >= MIN_VAL,
        "duplicatePolicy": "sha256-exact",
        "nearDuplicateDetection": False,
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
