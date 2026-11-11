"""Annotation studio and dataset report. Drawn masks are not a learned model."""

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from annotation_studio import (
    dataset_report,
    export_row,
    import_image,
    load_session,
    new_session,
    save_session,
    set_category,
    set_merchant,
    set_part,
)
from dataset_gate import problems
from garment_intel import PARTS

POLYGON = [[1, 1], [28, 1], [28, 28], [1, 28]]


def paint(folder: Path, name: str, color=(180, 140, 90)) -> Path:
    path = folder / name
    Image.new("RGB", (32, 32), color).save(path)
    return path


def owned(folder: Path, name: str, sku: str) -> dict:
    session = new_session()
    sample = import_image(session, paint(folder, name), sku)
    set_category(sample, "shirt")
    sample["licence"] = "isibuko-owned"
    sample["commercialUse"] = True
    sample["consent"] = {"consentId": "c1", "rights": "isibuko-owned", "allowsTraining": True, "allowsPersonImagery": False}
    sample["annotator"] = "ada"
    sample["reviewer"] = "lin"
    sample["confidence"] = 0.95
    sample["split"] = "train"
    sample["provenance"] = {"source": "merchant-file", "acquired": "2026-11-11", "origin": name}
    sample["garmentPolygon"] = POLYGON
    set_merchant(sample, "linen", ["sand"], None)
    for part in PARTS:
        if part in ("collar", "sleeve", "hem"):
            geometry = {"kind": "polygon", "polygon": POLYGON, "sides": {"left": POLYGON} if part == "sleeve" else None}
            set_part(sample, part, True, geometry, 0.95, "left" if part == "sleeve" else None)
        else:
            set_part(sample, part, False, None, 0.95)
    return sample


class AnnotationStudioTests(unittest.TestCase):
    def test_edit_persist_validate_and_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            sample = owned(folder, "shirt.png", "sku-1")
            session = {"version": 1, "samples": [sample]}
            path = folder / "session.json"
            save_session(path, session)
            loaded = load_session(path)
            self.assertEqual(loaded["samples"][0]["sku"], "sku-1")
            self.assertEqual(loaded["samples"][0]["assetHash"], sample["assetHash"])
            self.assertFalse(loaded["samples"][0]["merchant"]["visuallyDetected"])
            self.assertFalse(loaded["samples"][0]["visual"]["logosDetected"])

            row = export_row(loaded["samples"][0], folder / "shirt-mask.png")
            self.assertEqual(problems(row), [])
            self.assertEqual(row["sku"], "sku-1")
            self.assertGreater(row["garmentMask"]["foregroundPixels"], 0)
            self.assertEqual(row["parts"]["straps"]["kind"], "absent")
            self.assertFalse(row["logosDetected"])

            outside = dict(loaded["samples"][0])
            with self.assertRaises(ValueError):
                set_part(outside, "collar", True, {"kind": "polygon", "polygon": [[100, 100], [110, 100], [110, 110]]}, 0.9)
            with self.assertRaises(ValueError):
                set_part(outside, "hem", False, {"kind": "polygon", "polygon": POLYGON}, 0.9)

            future = import_image(new_session(), paint(folder, "skirt.png"), "sku-skirt")
            set_category(future, "skirt")
            self.assertFalse(future["trainingLabel"])
            with self.assertRaises(ValueError):
                export_row(future, folder / "skirt-mask.png")

            copy = owned(folder, "copy.png", "sku-2")
            copy["assetHash"] = sample["assetHash"]
            copy["imagePath"] = sample["imagePath"]
            copy["byteSize"] = sample["byteSize"]
            copy["split"] = "val"
            second = export_row(copy, folder / "copy-mask.png")
            report = dataset_report([loaded["samples"][0], copy, future], [row, second])
            self.assertEqual(report["imported"], 3)
            self.assertEqual(report["admittedTrain"], 0)
            self.assertTrue(report["duplicateRejections"])
            self.assertTrue(report["futureCategories"])
            self.assertFalse(report["learnedSegmentation"])
            self.assertFalse(report["readyForLive"])
            self.assertEqual(report["minimums"], {"train": 40, "val": 10})

            same = dict(row)
            same["reviewer"] = "ada"
            rejected = dataset_report([], [same])
            self.assertTrue(any("different person" in reason for item in rejected["reviewerRejected"] for reason in item["reasons"]))

            blocked = dict(row)
            blocked["licence"] = "unreviewed"
            blocked["commercialUse"] = False
            blocked["consent"] = None
            rights = dataset_report([], [blocked])
            self.assertTrue(rights["rightsRejected"])
            self.assertTrue(rights["reasons"])


if __name__ == "__main__":
    unittest.main()
