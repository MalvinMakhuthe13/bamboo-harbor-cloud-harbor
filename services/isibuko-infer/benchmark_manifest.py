"""Fail-closed checker for the Isibuko category benchmark.

The checker never approves a row, never assigns a split, and never reads a
Reviewer names are self-reported metadata. Comparing them is not identity verification.
A calculated perceptual hash is a local difference hash: the image is resized to 9 by 8,
each bit says whether one pixel is darker than the pixel to its right, and the mean colour
is kept. Two images are near-duplicates when the bit distance is at most 4 and the colour
distance is at most 36. That comparison runs only when both image files can be decoded.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, UnidentifiedImageError

BENCHMARK_LABELS = (
    "wig",
    "shirt",
    "jacket",
    "dress",
    "trousers",
    "skirt",
    "hat",
    "glasses",
    "nails",
    "earrings",
    "necklace",
    "bracelet",
    "ring",
    "watch",
    "none",
)
POSITIVE_LABELS = tuple(label for label in BENCHMARK_LABELS if label != "none")
WIG_FAMILIES = ("braids", "coils", "afro", "twists", "locs", "straight", "wavy")
SPLITS = ("selection", "evaluation")
ROLES = ("positive", "negative")
DIFFICULTIES = ("standard", "obscured", "cropped", "low-quality", "blank")
RIGHTS_BASES = ("isibuko-owned", "commercially-licensed")
FIELDS = (
    "imageId",
    "sha256",
    "pixelSha256",
    "sourceGroupId",
    "verifiedCategory",
    "catalogueCategory",
    "style",
    "length",
    "colour",
    "source",
    "rightsBasis",
    "rightsHolder",
    "licenceRef",
    "commercialEval",
    "acquiredOn",
    "reviewerA",
    "reviewerB",
    "reviewerACategory",
    "reviewerBCategory",
    "reviewedOn",
    "split",
    "role",
    "difficulty",
    "listingId",
    "listingUrl",
    "sku",
    "perceptualHash",
    "imagePath",
)
POSITIVE_MINIMUM = {"wig": 40, **{label: 30 for label in POSITIVE_LABELS if label != "wig"}}
WIG_FAMILY_MINIMUM = 4
WIG_LENGTH_MINIMUM = 8
PERCEPTUAL_HAMMING = 4
PERCEPTUAL_COLOR_DISTANCE = 36
CALCULATED_PERCEPTUAL_SUPPORTED = True
NEGATIVE_EVALUATION = {
    "non-target objects": 40,
    "blank or solid frames": 10,
    "partially hidden products": 20,
    "cropped or low-resolution products": 20,
}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CATALOGUE_NOTE = "Catalogue category pants is not a benchmark label. The benchmark label for that garment is trousers."


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pixel_sha256(path: Path) -> str:
    image = Image.open(path).convert("RGBA")
    return hashlib.sha256(image.tobytes()).hexdigest()


def _text(row: dict, key: str) -> str:
    value = row.get(key, "")
    return value.strip() if isinstance(value, str) else ""


def valid_date(value: object) -> bool:
    if not isinstance(value, str) or DATE.fullmatch(value) is None:
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _date(value: object) -> bool:
    return valid_date(value)


def normalize_reviewer_name(value: object) -> str:
    """Compare self-reported names. This is not an identity check."""
    if not isinstance(value, str):
        return ""
    cleaned = value.casefold().replace(".", " ").replace(",", " ")
    return " ".join(cleaned.split())


def _person(value: object) -> str:
    return normalize_reviewer_name(value)


def perceptual_fingerprint(path: Path) -> tuple[int, tuple[int, int, int]] | None:
    try:
        image = Image.open(path).convert("RGB").resize((9, 8), Image.Resampling.BOX)
        pixels = list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())
    except (UnidentifiedImageError, OSError):
        return None
    bits = 0
    for y in range(8):
        row = pixels[y * 9 : (y + 1) * 9]
        for x in range(8):
            left = row[x]
            right = row[x + 1]
            darker = (left[0] + left[1] + left[2]) < (right[0] + right[1] + right[2])
            bits = (bits << 1) | int(darker)
    count = max(1, len(pixels))
    mean = tuple(sum(pixel[channel] for pixel in pixels) // count for channel in range(3))
    return bits, mean


def perceptual_near(left: tuple[int, tuple[int, int, int]], right: tuple[int, tuple[int, int, int]]) -> bool:
    distance = (left[0] ^ right[0]).bit_count()
    colour = sum(abs(a - b) for a, b in zip(left[1], right[1]))
    return distance <= PERCEPTUAL_HAMMING and colour <= PERCEPTUAL_COLOR_DISTANCE


def _same(left: dict, right: dict, key: str) -> bool:
    first = _text(left, key)
    second = _text(right, key)
    return bool(first) and first == second


def row_problems(row: dict, dataset_dir: Path | None = None) -> list[str]:
    reasons: list[str] = []
    if not _text(row, "imageId"):
        reasons.append("imageId is required.")
    if HEX64.fullmatch(_text(row, "sha256")) is None:
        reasons.append("sha256 must be 64 lowercase hex characters.")
    if HEX64.fullmatch(_text(row, "pixelSha256")) is None:
        reasons.append("pixelSha256 must be 64 lowercase hex characters.")
    if not _text(row, "sourceGroupId"):
        reasons.append("sourceGroupId is required.")
    verified = _text(row, "verifiedCategory")
    catalogue = _text(row, "catalogueCategory")
    if verified not in BENCHMARK_LABELS:
        reasons.append("verifiedCategory is not a benchmark label. A catalogue field is not a visual label.")
    if catalogue == "pants" and verified == "pants":
        reasons.append(CATALOGUE_NOTE)
    if row.get("role") not in ROLES:
        reasons.append("role must be positive or negative.")
    elif row.get("role") == "positive" and verified == "none":
        reasons.append("A positive row cannot have verifiedCategory none.")
    if row.get("split") not in SPLITS:
        reasons.append("Split must be selection or evaluation. The benchmark has no training split.")
    if row.get("difficulty") not in DIFFICULTIES:
        reasons.append("difficulty is not a recognised value.")
    elif row.get("difficulty") == "blank" and verified not in ("", "none"):
        reasons.append("A blank frame cannot carry a product category.")
    if row.get("ambiguous") is True or verified == "ambiguous" or row.get("difficulty") == "ambiguous":
        reasons.append("Ambiguous rows are excluded.")
    elif row.get("role") == "positive":
        if verified not in POSITIVE_LABELS:
            reasons.append("A positive row must use one of the 14 product categories.")
        if row.get("difficulty") != "standard":
            reasons.append("A positive row must use difficulty standard. Degraded frames cannot fill a category minimum.")
    elif row.get("role") == "negative":
        if verified != "none":
            reasons.append("A negative row must use verifiedCategory none.")
        elif row.get("difficulty") not in ("standard", "blank", "obscured", "cropped", "low-quality"):
            reasons.append("Negative difficulty does not match a negative type.")
    if row.get("rightsBasis") not in RIGHTS_BASES:
        reasons.append("rightsBasis must be isibuko-owned or commercially-licensed.")
    if not _text(row, "rightsHolder") or not _text(row, "licenceRef") or not _text(row, "source"):
        reasons.append("Rights evidence is missing. Unknown permission is excluded.")
    reference = _text(row, "licenceRef")
    if reference.startswith("EXAMPLE-ONLY"):
        reasons.append("The permission reference is an example placeholder, not evidence.")
    elif reference.startswith(("http://", "https://")):
        reasons.append("A public URL is not permission evidence.")
    if row.get("commercialEval") is not True:
        reasons.append("commercialEval must be true.")
    if not _date(row.get("acquiredOn")) or not _date(row.get("reviewedOn")):
        reasons.append("acquiredOn and reviewedOn must be real YYYY-MM-DD dates.")
    if _date(row.get("acquiredOn")) and _date(row.get("reviewedOn")) and str(row.get("reviewedOn")) < str(row.get("acquiredOn")):
        reasons.append("reviewedOn cannot be earlier than acquiredOn.")
    reviewer_a = _person(row.get("reviewerA"))
    reviewer_b = _person(row.get("reviewerB"))
    if not reviewer_a or not reviewer_b:
        reasons.append("Both reviewers are required.")
    elif reviewer_a == reviewer_b:
        reasons.append("The two reviewers must be different people. Name spelling is not identity verification.")
    seen_a = _text(row, "reviewerACategory")
    seen_b = _text(row, "reviewerBCategory")
    if seen_a not in BENCHMARK_LABELS or seen_b not in BENCHMARK_LABELS:
        reasons.append("Each reviewer must record a benchmark label.")
    elif seen_a != seen_b or seen_a != verified or seen_b != verified:
        reasons.append("The reviewers do not agree on the visual category.")
    if verified == "wig" and row.get("role") == "positive":
        if _text(row, "style") not in WIG_FAMILIES:
            reasons.append("A wig needs a style of braids, coils, afro, twists, locs, straight, or wavy.")
        if _text(row, "length") not in ("short", "long"):
            reasons.append("A wig needs length short or long.")
        if not _text(row, "colour"):
            reasons.append("A wig needs a recorded colour.")
        style_a = _text(row, "reviewerAStyle")
        style_b = _text(row, "reviewerBStyle")
        if style_a not in WIG_FAMILIES or style_b not in WIG_FAMILIES:
            reasons.append("Both reviewers must record the wig style.")
        elif style_a != style_b or style_a != _text(row, "style"):
            reasons.append("The reviewers do not agree on the wig style.")
    path, path_error = _image_path(row, dataset_dir)
    if path_error:
        reasons.append(path_error)
    elif path is not None:
        if not path.is_file():
            reasons.append("Image path is missing or is not a file.")
        else:
            if file_sha256(path) != _text(row, "sha256"):
                reasons.append("Recorded sha256 does not match the image file.")
            try:
                decoded = pixel_sha256(path)
            except (UnidentifiedImageError, OSError):
                reasons.append("Image could not be decoded for the pixel hash.")
            else:
                if decoded != _text(row, "pixelSha256"):
                    reasons.append("pixelSha256 does not match the decoded image.")
    return reasons


def _image_path(row: dict, dataset_dir: Path | None) -> tuple[Path | None, str | None]:
    raw = row.get("imagePath")
    if not isinstance(raw, str) or not raw.strip():
        return None, None
    path = Path(raw)
    if dataset_dir is None:
        return path, None
    root = dataset_dir.resolve()
    candidate = path if path.is_absolute() else (dataset_dir / path)
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(root)
    except ValueError:
        return None, "Image path escapes the dataset directory."
    return resolved, None


def _leak_pairs(rows: list[dict], dataset_dir: Path | None = None) -> dict[int, list[str]]:
    extra: dict[int, list[str]] = {index: [] for index in range(len(rows))}
    keys = (
        ("sha256", "The same file hash appears in both splits."),
        ("pixelSha256", "The same pixel hash appears in both splits."),
        ("sourceGroupId", "A source group crosses selection and evaluation."),
        ("listingId", "The same seller listing id crosses splits."),
        ("listingUrl", "The same listing URL crosses splits."),
        ("sku", "The same SKU crosses splits."),
        ("perceptualHash", "A known perceptual near-duplicate crosses splits."),
    )
    fingerprints: list[tuple[int, tuple[int, int, int]] | None] = []
    for row in rows:
        path, path_error = _image_path(row, dataset_dir)
        fingerprints.append(None if path_error or path is None or not path.is_file() else perceptual_fingerprint(path))
    for left in range(len(rows)):
        for right in range(left + 1, len(rows)):
            if rows[left].get("split") == rows[right].get("split"):
                continue
            if rows[left].get("split") not in SPLITS or rows[right].get("split") not in SPLITS:
                continue
            for key, message in keys:
                if _same(rows[left], rows[right], key):
                    extra[left].append(message)
                    extra[right].append(message)
            if fingerprints[left] is not None and fingerprints[right] is not None and perceptual_near(fingerprints[left], fingerprints[right]):
                message = "Calculated perceptual near-duplicate crosses splits."
                extra[left].append(message)
                extra[right].append(message)
    return extra


def _negative_name(row: dict) -> str | None:
    if row.get("role") != "negative" or row.get("verifiedCategory") != "none":
        return None
    if row.get("difficulty") == "standard":
        return "non-target objects"
    if row.get("difficulty") == "blank":
        return "blank or solid frames"
    if row.get("difficulty") == "obscured":
        return "partially hidden products"
    if row.get("difficulty") in ("cropped", "low-quality"):
        return "cropped or low-resolution products"
    return None


def _counts(ok_rows: list[dict]) -> dict[str, dict[str, int]]:
    positives = {label: 0 for label in POSITIVE_LABELS}
    family_groups = {family: set() for family in WIG_FAMILIES}
    family_images = {family: 0 for family in WIG_FAMILIES}
    length_groups = {"short": set(), "long": set()}
    negative_selection = {name: 0 for name in NEGATIVE_EVALUATION}
    negative_evaluation = {name: 0 for name in NEGATIVE_EVALUATION}
    for row in ok_rows:
        if row.get("role") == "positive" and row.get("verifiedCategory") in positives:
            positives[row["verifiedCategory"]] += 1
            if row["verifiedCategory"] == "wig":
                family = _text(row, "style")
                group = _text(row, "sourceGroupId")
                if family in family_groups and group:
                    family_groups[family].add(group)
                    family_images[family] += 1
                if _text(row, "length") in length_groups and group:
                    length_groups[_text(row, "length")].add(group)
        bucket = _negative_name(row)
        if bucket is None:
            continue
        if row.get("split") == "selection":
            negative_selection[bucket] += 1
        elif row.get("split") == "evaluation":
            negative_evaluation[bucket] += 1
    return {
        "positives": positives,
        "wigFamilies": {family: len(groups) for family, groups in family_groups.items()},
        "wigFamilyImages": family_images,
        "wigLengthGroups": {length: len(groups) for length, groups in length_groups.items()},
        "negativeSelection": negative_selection,
        "negativeEvaluation": negative_evaluation,
    }


def coverage_gaps(counts: dict[str, dict[str, int]]) -> list[str]:
    gaps: list[str] = []
    for label, minimum in POSITIVE_MINIMUM.items():
        found = counts["positives"][label]
        if found < minimum:
            gaps.append(f"{label} has {found} of {minimum} required positive images.")
    for family in WIG_FAMILIES:
        found = counts["wigFamilies"][family]
        if found < WIG_FAMILY_MINIMUM:
            gaps.append(f"wig family {family} has {found} distinct source groups of {WIG_FAMILY_MINIMUM}.")
    for length in ("short", "long"):
        found = counts["wigLengthGroups"][length]
        if found < WIG_LENGTH_MINIMUM:
            gaps.append(f"{length} wigs have {found} distinct source groups of {WIG_LENGTH_MINIMUM}.")
    for name, minimum in NEGATIVE_EVALUATION.items():
        found = counts["negativeEvaluation"][name]
        if found < minimum:
            gaps.append(f"evaluation negatives for {name}: {found} of {minimum}.")
    return gaps


def check_manifest(rows: list[dict], dataset_dir: Path | None = None) -> dict:
    """Report problems. The input rows and their splits are not modified."""
    leaks = _leak_pairs(rows, dataset_dir)
    seen: dict[str, int] = {}
    report_rows = []
    ok_rows: list[dict] = []
    for index, row in enumerate(rows):
        reasons = row_problems(row, dataset_dir)
        image_id = _text(row, "imageId")
        if image_id:
            if image_id in seen:
                reasons.append("Duplicate imageId.")
            else:
                seen[image_id] = index
        reasons.extend(leaks[index])
        ok = not reasons
        if ok:
            ok_rows.append(row)
        report_rows.append({
            "imageId": image_id,
            "ok": ok,
            "admitted": False,
            "split": row.get("split"),
            "reasons": reasons,
        })
    counts = _counts(ok_rows)
    gaps = coverage_gaps(counts)
    return {
        "ready": not gaps and all(item["ok"] for item in report_rows) and bool(rows),
        "admitted": False,
        "rows": report_rows,
        "counts": counts,
        "gaps": gaps,
    }
