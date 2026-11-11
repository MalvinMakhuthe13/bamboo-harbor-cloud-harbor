"""Dataset ZIP handoff. Nothing is approved or sent to feature extraction."""

import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from annotation_studio import import_image, new_session, set_category, set_merchant, set_part
from dataset_gate import problems
from dataset_package import build_package, extract_zip, features_for_admitted, file_hash, import_dataset, verify_row, write_zip
from garment_intel import PARTS

POLYGON = [[1, 1], [28, 1], [28, 28], [1, 28]]


def paint(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    Image.new("RGB", (32, 32), (180, 140, 90)).save(path)
    return path


def annotated(folder: Path, name: str = "shirt.png", sku: str = "sku-1") -> dict:
    session = new_session()
    sample = import_image(session, paint(folder, name), sku)
    sample["imageName"] = name
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
            set_part(sample, part, True, {"kind": "polygon", "polygon": POLYGON}, 0.95, "left" if part == "sleeve" else None)
        else:
            set_part(sample, part, False, None, 0.95)
    session["samples"] = [sample]
    return session


class DatasetPackageTests(unittest.TestCase):
    def test_round_trip_resume_and_rejections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session = annotated(root)
            original = session["samples"][0]
            packaged = root / "package"
            rows, failures = build_package(session, packaged)
            self.assertEqual(failures, [])
            row = rows[0]
            self.assertEqual(row["assetHash"], original["assetHash"])
            self.assertEqual(row["byteSize"], original["byteSize"])
            self.assertEqual((row["imageWidth"], row["imageHeight"]), (32, 32))
            self.assertEqual(row["parts"]["sleeve"]["polygon"], POLYGON)
            self.assertGreater(row["garmentMask"]["foregroundPixels"], 0)
            self.assertEqual(row["review"], "corrected")
            self.assertFalse(row["admitted"])
            image = packaged / row["imagePath"]
            mask = packaged / row["garmentMask"]["path"]
            self.assertTrue(image.is_file())
            self.assertTrue(mask.is_file())
            archive = root / "dataset.zip"
            write_zip(packaged, archive)
            imported = import_dataset(archive, root / "import")
            self.assertEqual(imported["samples"][0]["status"], "verified")
            self.assertEqual(imported["samples"][0]["reasons"], [])
            self.assertEqual(imported["admitted"], [])
            self.assertFalse(imported["autoApproved"])
            self.assertFalse(imported["featureExtractionRan"])
            self.assertIn("does not auto-approve", imported["admission"][0]["reasons"][0])
            saved = json.loads((root / "import" / "dataset" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()[0])
            absolute = dict(saved)
            absolute["imagePath"] = str(root / "import" / "dataset" / saved["imagePath"])
            absolute["garmentMask"] = dict(saved["garmentMask"], path=str(root / "import" / "dataset" / saved["garmentMask"]["path"]))
            self.assertEqual(problems(absolute), [])
            self.assertEqual(saved["assetHash"], original["assetHash"])
            self.assertEqual(saved["sku"], "sku-1")
            self.assertEqual(saved["garmentMask"]["foregroundPixels"], row["garmentMask"]["foregroundPixels"])
            self.assertEqual(saved["provenance"], {"source": "merchant-file", "acquired": "2026-11-11", "origin": "shirt.png"})
            self.assertEqual(saved["licence"], "isibuko-owned")
            self.assertTrue(saved["commercialUse"])
            self.assertEqual(saved["consent"]["allowsTraining"], True)
            self.assertEqual(saved["consent"]["allowsPersonImagery"], False)
            self.assertEqual(saved["annotator"], "ada")
            self.assertEqual(saved["reviewer"], "lin")
            self.assertEqual(saved["review"], "corrected")
            self.assertEqual(saved["split"], "train")
            self.assertEqual(saved["parts"]["collar"]["kind"], "polygon")
            again = import_dataset(archive, root / "import")
            self.assertEqual(again["samples"][0]["status"], "reused")
            self.assertEqual(len(json.loads((root / "import" / "import-ledger.json").read_text(encoding="utf-8"))["samples"]), 1)

            blocked = annotated(root / "rights", "shirt.png", "sku-rights")
            blocked["samples"][0]["licence"] = "unreviewed"
            blocked["samples"][0]["commercialUse"] = False
            blocked["samples"][0]["consent"] = None
            blocked["samples"][0]["reviewer"] = "ada"
            rights_dir = root / "rights-package"
            build_package(blocked, rights_dir)
            write_zip(rights_dir, root / "rights.zip")
            rights = import_dataset(root / "rights.zip", root / "rights-import")
            self.assertEqual(rights["samples"][0]["status"], "rejected")
            self.assertTrue(any("Licence" in reason or "Commercial" in reason or "consent" in reason for reason in rights["samples"][0]["reasons"]))
            self.assertEqual(rights["admitted"], [])

            held = annotated(root / "held", "held.png", "sku-held")
            held["samples"][0]["split"] = "test"
            held["samples"][0]["sampleId"] = "held-out"
            train_session = annotated(root / "train-only", "train.png", "sku-train")
            train_rows, _train_failures = build_package(train_session, root / "train-package")
            _held_rows, _held_failures = build_package(held, root / "held-package")
            opened = []

            def open_image(path):
                opened.append(path)
                if "held-out" in path:
                    raise AssertionError("test image opened")
                return path

            train = dict(train_rows[0])
            train["admitted"] = True
            train["imagePath"] = str(root / "train-package" / train_rows[0]["imagePath"])
            test_row = dict(_held_rows[0])
            test_row["admitted"] = True
            test_row["imagePath"] = str(root / "held-package" / _held_rows[0]["imagePath"])
            features_for_admitted([train, test_row], root / "features", lambda _image: np.ones((4, 3), np.float32), open_image)
            self.assertTrue(opened)
            self.assertFalse(any("held-out" in path for path in opened))

    def test_path_traversal_and_studio_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hostile = root / "hostile.zip"
            with zipfile.ZipFile(hostile, "w") as archive:
                archive.writestr("../secret.txt", b"no")
            with self.assertRaises(RuntimeError):
                import_dataset(hostile, root / "hostile")
            self.assertFalse((root / "secret.txt").exists())
            nested = root / "nested.zip"
            with zipfile.ZipFile(nested, "w") as archive:
                archive.writestr("images/../../secret.txt", b"no")
            with self.assertRaises(RuntimeError):
                extract_zip(nested, root / "nested")
            self.assertFalse((root / "secret.txt").exists())

            script = r"""
import { storeZip } from "./src/lib/isibuko-gen/dataset-zip.ts";
import { writeFileSync } from "node:fs";
const session = new TextEncoder().encode("{\"version\":1,\"samples\":[]}");
writeFileSync(process.argv[1], storeZip([{ name: "session.json", data: session }]));
"""
            studio_zip = root / "studio.zip"
            subprocess.check_call(["node", "--experimental-strip-types", "--input-type=module", "-e", script, str(studio_zip)], cwd="/tmp/isibuko-ai")
            extract_zip(studio_zip, root / "studio")
            self.assertEqual(json.loads((root / "studio" / "session.json").read_text(encoding="utf-8"))["version"], 1)

    def test_limits_corruption_and_conflicts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            windows = root / "windows.zip"
            with zipfile.ZipFile(windows, "w") as archive:
                archive.writestr("images\\..\\secret.txt", b"no")
            with self.assertRaises(RuntimeError):
                extract_zip(windows, root / "windows")
            self.assertFalse((root / "secret.txt").exists())

            linked = root / "link.zip"
            with zipfile.ZipFile(linked, "w") as archive:
                info = zipfile.ZipInfo("escape")
                info.external_attr = 0o120777 << 16
                archive.writestr(info, b"/tmp/secret")
            with self.assertRaises(RuntimeError) as symlink_error:
                extract_zip(linked, root / "link")
            self.assertIn("Symlink", str(symlink_error.exception))
            self.assertFalse((root / "link" / "escape").is_symlink())

            huge = root / "huge.zip"
            with zipfile.ZipFile(huge, "w") as archive:
                archive.writestr("images/big.png", b"A" * 50)
            with self.assertRaises(RuntimeError):
                extract_zip(huge, root / "huge", {"entry_bytes": 10, "total_bytes": 10})
            self.assertFalse((root / "huge" / "images" / "big.png").exists())

            duplicate = root / "duplicate-name.zip"
            with zipfile.ZipFile(duplicate, "w") as archive:
                archive.writestr("session.json", b"{}")
                archive.writestr("session.json", b"{}")
            with self.assertRaises(RuntimeError) as duplicate_error:
                extract_zip(duplicate, root / "duplicate-name")
            self.assertIn("Duplicate ZIP filename", str(duplicate_error.exception))

            duplicated = annotated(root / "dup-src")
            duplicated["samples"].append(dict(duplicated["samples"][0]))
            _rows, failures = build_package(duplicated, root / "dup-package")
            self.assertTrue(any("Duplicate sample id" in reason for item in failures for reason in item["reasons"]))

            session = annotated(root / "good-src", "good.png", "sku-good")
            packaged = root / "good"
            rows, good_failures = build_package(session, packaged)
            self.assertEqual(good_failures, [])
            (packaged / rows[0]["imagePath"]).write_bytes(b"not-an-image")
            reasons = verify_row(packaged, rows[0])
            self.assertTrue(any("SHA-256" in reason or "decoded" in reason for reason in reasons))

            fresh = annotated(root / "fresh-src", "fresh.png", "sku-fresh")
            fresh_dir = root / "fresh-package"
            fresh_rows, _fresh_failures = build_package(fresh, fresh_dir)
            write_zip(fresh_dir, root / "fresh.zip")
            first = import_dataset(root / "fresh.zip", root / "resume")
            self.assertEqual(first["samples"][0]["status"], "verified")
            stored = (root / "resume" / "dataset" / fresh_rows[0]["imagePath"]).read_bytes()
            changed = annotated(root / "changed-src", "changed.png", "sku-fresh")
            path = Path(changed["samples"][0]["imagePath"])
            with Image.open(path) as image:
                changed_image = image.copy()
            changed_image.putpixel((0, 0), (1, 2, 3))
            changed_image.save(path)
            changed["samples"][0]["assetHash"] = file_hash(path)
            changed["samples"][0]["byteSize"] = path.stat().st_size
            changed["samples"][0]["sampleId"] = fresh_rows[0]["sampleId"]
            changed_dir = root / "changed-package"
            changed_rows, _changed_failures = build_package(changed, changed_dir)
            write_zip(changed_dir, root / "changed.zip")
            conflict = import_dataset(root / "changed.zip", root / "resume")
            self.assertEqual(conflict["samples"][0]["status"], "rejected")
            self.assertTrue(any("different hash" in reason for reason in conflict["samples"][0]["reasons"]))
            self.assertEqual((root / "resume" / "dataset" / fresh_rows[0]["imagePath"]).read_bytes(), stored)
            self.assertNotEqual(changed_rows[0]["assetHash"], fresh_rows[0]["assetHash"])

            missing = annotated(root / "missing-rights", "plain.png", "sku-missing")
            missing["samples"][0].pop("provenance")
            missing["samples"][0]["licence"] = None
            missing["samples"][0]["commercialUse"] = None
            missing["samples"][0]["consent"] = None
            missing_dir = root / "missing-package"
            build_package(missing, missing_dir)
            write_zip(missing_dir, root / "missing.zip")
            missing_report = import_dataset(root / "missing.zip", root / "missing-import")
            self.assertEqual(missing_report["samples"][0]["status"], "rejected")
            self.assertTrue(any("Provenance" in reason for reason in missing_report["samples"][0]["reasons"]))
            self.assertTrue(any("Licence" in reason for reason in missing_report["samples"][0]["reasons"]))
            self.assertEqual(missing_report["admitted"], [])
            self.assertNotEqual(json.loads((missing_dir / "manifest.jsonl").read_text().splitlines()[0])["review"], "approved")


if __name__ == "__main__":
    unittest.main()
