"""Synthetic rows only. No photographs are accepted as a real benchmark."""

import hashlib
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import benchmark_manifest as gate

FAMILIES = ("braids", "coils", "afro", "twists", "locs", "straight", "wavy")


def _row(number: int, **overrides) -> dict:
    row = {
        "imageId": f"img-{number:04d}",
        "sha256": f"{number:064x}",
        "pixelSha256": f"{number + 10_000:064x}",
        "sourceGroupId": f"group-{number:04d}",
        "verifiedCategory": "shirt",
        "catalogueCategory": "shirt",
        "style": "",
        "length": "",
        "colour": "",
        "source": "isibuko-studio-table",
        "rightsBasis": "isibuko-owned",
        "rightsHolder": "Isibuko",
        "licenceRef": f"permission-{number:04d}",
        "commercialEval": True,
        "acquiredOn": "2026-11-01",
        "reviewerA": "Ada",
        "reviewerB": "Bo",
        "reviewerACategory": "shirt",
        "reviewerBCategory": "shirt",
        "reviewedOn": "2026-11-02",
        "split": "evaluation",
        "role": "positive",
        "difficulty": "standard",
        "listingId": "",
        "listingUrl": "",
        "sku": "",
        "perceptualHash": "",
    }
    row.update(overrides)
    if "verifiedCategory" in overrides and "reviewerACategory" not in overrides:
        row["reviewerACategory"] = overrides["verifiedCategory"]
        row["reviewerBCategory"] = overrides["verifiedCategory"]
    if row["verifiedCategory"] == "wig":
        if "reviewerAStyle" not in overrides:
            row["reviewerAStyle"] = row["style"]
        if "reviewerBStyle" not in overrides:
            row["reviewerBStyle"] = row["style"]
    return row


def _ready_manifest() -> list[dict]:
    rows: list[dict] = []
    number = 1
    styles = [family for family in FAMILIES for _ in range(4)] + ["braids"] * 12
    for index, style in enumerate(styles):
        rows.append(_row(
            number,
            verifiedCategory="wig",
            catalogueCategory="wig",
            style=style,
            length="short" if index % 2 == 0 else "long",
            colour="black",
            split="selection" if index < 10 else "evaluation",
        ))
        number += 1
    for label in gate.POSITIVE_LABELS:
        if label == "wig":
            continue
        catalogue = "pants" if label == "trousers" else label
        for index in range(30):
            rows.append(_row(
                number,
                verifiedCategory=label,
                catalogueCategory=catalogue,
                split="selection" if index < 10 else "evaluation",
            ))
            number += 1
    for _index in range(40):
        rows.append(_row(number, verifiedCategory="none", catalogueCategory="", role="negative", difficulty="standard", split="evaluation"))
        number += 1
    for _index in range(10):
        rows.append(_row(number, verifiedCategory="none", catalogueCategory="", role="negative", difficulty="blank", split="evaluation"))
        number += 1
    for _index in range(20):
        rows.append(_row(number, verifiedCategory="none", catalogueCategory="", role="negative", difficulty="obscured", split="evaluation"))
        number += 1
    for index in range(20):
        rows.append(_row(number, verifiedCategory="none", catalogueCategory="", role="negative", difficulty="cropped" if index < 10 else "low-quality", split="evaluation"))
        number += 1
    return rows


class ManifestTests(unittest.TestCase):
    def test_a_complete_synthetic_manifest_is_ready_but_not_approved(self):
        rows = _ready_manifest()
        splits = [row["split"] for row in rows]
        result = gate.check_manifest(rows)
        self.assertEqual(result["gaps"], [])
        self.assertTrue(result["ready"])
        self.assertFalse(result["admitted"])
        self.assertTrue(all(item["admitted"] is False for item in result["rows"]))
        self.assertEqual([row["split"] for row in rows], splits)

    def test_pants_catalogue_is_not_treated_as_the_visual_label(self):
        accepted = gate.row_problems(_row(1, verifiedCategory="trousers", catalogueCategory="pants"))
        rejected = gate.row_problems(_row(1, verifiedCategory="pants", catalogueCategory="pants"))
        self.assertEqual(accepted, [])
        self.assertTrue(any("trousers" in reason for reason in rejected))

    def test_missing_rights_commercial_flag_and_reviewers(self):
        self.assertTrue(any("Rights evidence" in reason for reason in gate.row_problems(_row(1, licenceRef=""))))
        self.assertTrue(any("commercialEval" in reason for reason in gate.row_problems(_row(1, commercialEval=False))))
        self.assertTrue(any("Both reviewers" in reason for reason in gate.row_problems(_row(1, reviewerB=""))))
        disagreed = _row(1, reviewerBCategory="jacket")
        self.assertTrue(any("do not agree" in reason for reason in gate.row_problems(disagreed)))

    def test_invalid_category_and_training_split(self):
        self.assertTrue(any("benchmark label" in reason for reason in gate.row_problems(_row(1, verifiedCategory="coat"))))
        self.assertTrue(any("no training split" in reason for reason in gate.row_problems(_row(1, split="train"))))

    def test_duplicate_image_id_and_hash_mismatch(self):
        result = gate.check_manifest([_row(1), _row(1)])
        self.assertTrue(any("Duplicate imageId" in reason for item in result["rows"] for reason in item["reasons"]))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sample.png"
            Image.new("RGBA", (2, 2), (10, 20, 30, 255)).save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            pixels = gate.pixel_sha256(path)
            bad = _row(7, sha256=digest, pixelSha256=f"{1:064x}", imagePath=str(path))
            reasons = gate.row_problems(bad)
            self.assertTrue(any("pixelSha256" in reason for reason in reasons))
            missing = _row(8, sha256=f"{2:064x}", pixelSha256=pixels, imagePath=str(path))
            self.assertTrue(any("sha256" in reason for reason in gate.row_problems(missing)))

    def test_source_group_listing_and_sku_cannot_cross_splits(self):
        group = gate.check_manifest([
            _row(1, split="selection", sourceGroupId="same-shoot"),
            _row(2, split="evaluation", sourceGroupId="same-shoot"),
        ])
        self.assertTrue(any("source group" in reason for item in group["rows"] for reason in item["reasons"]))
        original = [
            _row(3, split="selection", listingId="listing-9", listingUrl="https://shop.example/9", sku="SKU-9", perceptualHash="abc"),
            _row(4, split="evaluation", listingId="listing-9", listingUrl="https://shop.example/9", sku="SKU-9", perceptualHash="abc"),
        ]
        before = [row["split"] for row in original]
        leaked = gate.check_manifest(original)
        self.assertEqual([row["split"] for row in original], before)
        text = " ".join(reason for item in leaked["rows"] for reason in item["reasons"])
        self.assertIn("listing id", text)
        self.assertIn("listing URL", text)
        self.assertIn("SKU", text)
        self.assertIn("near-duplicate", text)
        hashes = gate.check_manifest([
            _row(5, split="selection", sha256=f"{5:064x}", pixelSha256=f"{6:064x}"),
            _row(6, split="evaluation", sha256=f"{5:064x}", pixelSha256=f"{6:064x}"),
        ])
        hash_text = " ".join(reason for item in hashes["rows"] for reason in item["reasons"])
        self.assertIn("file hash", hash_text)
        self.assertIn("pixel hash", hash_text)

    def test_short_coverage_is_reported_and_not_repaired(self):
        rows = [_row(1, verifiedCategory="shirt")]
        before = rows[0]["split"]
        result = gate.check_manifest(rows)
        self.assertFalse(result["ready"])
        self.assertTrue(any("shirt has 1 of 30" in gap for gap in result["gaps"]))
        self.assertTrue(any("wig family braids" in gap for gap in result["gaps"]))
        self.assertTrue(any("non-target objects" in gap for gap in result["gaps"]))
        self.assertEqual(rows[0]["split"], before)

    def test_wig_families_and_negative_counts_block_readiness(self):
        rows = _ready_manifest()
        for row in rows:
            if row["verifiedCategory"] == "wig":
                row["style"] = "straight"
                row["reviewerAStyle"] = "straight"
                row["reviewerBStyle"] = "straight"
        straight = gate.check_manifest(rows)
        self.assertFalse(straight["ready"])
        self.assertTrue(any("wig family braids" in gap for gap in straight["gaps"]))
        thin = [row for row in _ready_manifest() if row["difficulty"] != "blank"]
        blank = gate.check_manifest(thin)
        self.assertFalse(blank["ready"])
        self.assertTrue(any("blank or solid" in gap for gap in blank["gaps"]))

    def test_wig_length_and_source_groups_are_not_inflated(self):
        short = _ready_manifest()
        for row in short:
            if row["verifiedCategory"] == "wig":
                row["length"] = "short"
        result = gate.check_manifest(short)
        self.assertFalse(result["ready"])
        self.assertTrue(any("long wigs have 0 distinct source groups of 8" in gap for gap in result["gaps"]))
        crowded = [
            _row(index, verifiedCategory="wig", catalogueCategory="wig", style="braids", length="long", colour="black", sourceGroupId="one-braid-product", split="evaluation")
            for index in range(1, 5)
        ]
        crowded_result = gate.check_manifest(crowded)
        self.assertEqual(crowded_result["counts"]["wigFamilies"]["braids"], 1)
        self.assertEqual(crowded_result["counts"]["wigFamilyImages"]["braids"], 4)
        self.assertTrue(all(row["sourceGroupId"] == "one-braid-product" for row in crowded))

    def test_negative_rows_cannot_fill_a_positive_category(self):
        mismatched = _row(1, role="negative", verifiedCategory="wig", style="braids", length="short", colour="black")
        self.assertTrue(any("verifiedCategory none" in reason for reason in gate.row_problems(mismatched)))
        degraded = _row(2, role="positive", difficulty="obscured")
        self.assertTrue(any("difficulty standard" in reason for reason in gate.row_problems(degraded)))
        ambiguous = _row(3, ambiguous=True)
        self.assertTrue(any("Ambiguous" in reason for reason in gate.row_problems(ambiguous)))
        hidden = _row(4, role="negative", verifiedCategory="none", difficulty="obscured")
        self.assertEqual(gate.row_problems(hidden), [])
        only_negatives = [_row(index, role="negative", verifiedCategory="none", difficulty="standard") for index in range(1, 31)]
        counted = gate.check_manifest(only_negatives)
        self.assertEqual(counted["counts"]["positives"]["wig"], 0)
        self.assertEqual(counted["counts"]["negativeEvaluation"]["non-target objects"], 30)
        self.assertEqual(counted["counts"]["negativeSelection"]["non-target objects"], 0)
        selection = [_row(index, role="negative", verifiedCategory="none", difficulty="standard", split="selection") for index in range(1, 41)]
        selected = gate.check_manifest(selection)
        self.assertEqual(selected["counts"]["negativeSelection"]["non-target objects"], 40)
        self.assertEqual(selected["counts"]["negativeEvaluation"]["non-target objects"], 0)
        self.assertTrue(any("non-target objects" in gap for gap in selected["gaps"]))

    def test_calculated_perceptual_hash_rejects_a_near_copy(self):
        self.assertTrue(gate.CALCULATED_PERCEPTUAL_SUPPORTED)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / "original.png"
            near = root / "near.png"
            other = root / "other.png"
            Image.new("RGB", (32, 32), (120, 120, 120)).save(original)
            changed = Image.new("RGB", (32, 32), (120, 120, 120))
            changed.putpixel((0, 0), (121, 120, 120))
            changed.save(near)
            Image.new("RGB", (32, 32), (0, 0, 0)).save(other)
            left = gate.perceptual_fingerprint(original)
            right = gate.perceptual_fingerprint(near)
            far = gate.perceptual_fingerprint(other)
            self.assertIsNotNone(left)
            assert left is not None and right is not None and far is not None
            self.assertTrue(gate.perceptual_near(left, right))
            self.assertFalse(gate.perceptual_near(left, far))
            rows = [
                _row(1, split="selection", imagePath=str(original), sha256=gate.file_sha256(original), pixelSha256=gate.pixel_sha256(original)),
                _row(2, split="evaluation", imagePath=str(near), sha256=gate.file_sha256(near), pixelSha256=gate.pixel_sha256(near)),
            ]
            found = gate.check_manifest(rows)
            self.assertTrue(any("Calculated perceptual near-duplicate" in reason for item in found["rows"] for reason in item["reasons"]))
            self.assertEqual([row["split"] for row in rows], ["selection", "evaluation"])

    def test_reviewer_name_variations_are_not_identity_checks(self):
        reasons = gate.row_problems(_row(1, reviewerB="ada."))
        self.assertTrue(any("not identity verification" in reason for reason in reasons))
        self.assertTrue(any("commercialEval" in reason for reason in gate.row_problems(_row(2, commercialEval=False))))
        self.assertTrue(any("Rights evidence" in reason for reason in gate.row_problems(_row(3, rightsHolder=""))))
        self.assertTrue(any("do not agree" in reason for reason in gate.row_problems(_row(4, reviewerACategory="jacket"))))
        self.assertTrue(any("YYYY-MM-DD" in reason for reason in gate.row_problems(_row(5, acquiredOn="2026-02-31"))))
        self.assertTrue(any("earlier" in reason for reason in gate.row_problems(_row(6, acquiredOn="2026-11-03", reviewedOn="2026-11-01"))))
        disagreed = _row(7, verifiedCategory="wig", style="braids", length="short", colour="black", reviewerBStyle="locs")
        self.assertTrue(any("wig style" in reason for reason in gate.row_problems(disagreed)))

    def test_image_path_cannot_escape_the_dataset_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            outside = root / "outside.png"
            Image.new("RGB", (2, 2), (1, 2, 3)).save(outside)
            reasons = gate.row_problems(_row(1, imagePath="../outside.png"), root / "dataset")
            self.assertTrue(any("escapes" in reason for reason in reasons))
            self.assertFalse(any("sha256" in reason and "match" in reason for reason in reasons))


if __name__ == "__main__":
    unittest.main()
