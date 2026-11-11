"""Synthetic rights fixtures. They are not a training set and must not be admitted."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from dataset_gate import admit, approve, file_hash, problems
from dataset_package import extract_zip
from rights_contract import admission_status
from test_kaggle_prep import make_row


def complete(folder: Path) -> dict:
    return make_row(folder, "fixture", (180, 140, 90), "train", "sku-fixture")


class RightsContractTests(unittest.TestCase):
    def test_missing_and_contradictory_rights_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            base = complete(folder)
            self.assertEqual(problems(base), [])
            self.assertEqual(admission_status(base)["label"], "Rejected")
            self.assertIn("Synthetic fixture", admission_status(base)["reasons"][0])
            self.assertEqual(admit([base])["admitted"], [])

            checks = {
                "rightsHolder": "A rights holder is missing.",
                "agreementReference": "A licence or agreement reference is missing.",
                "merchantName": "The merchant is missing.",
            }
            for field, expected in checks.items():
                broken = {**base, field: ""}
                self.assertTrue(any(expected in reason for reason in problems(broken)), field)

            product_use = {**base, "agreementScope": "product-use", "commercialUse": True}
            self.assertTrue(any("product-use licence" in reason for reason in problems(product_use)))
            missing_training = dict(base)
            del missing_training["commercialTraining"]
            self.assertTrue(any("not an AI-training grant" in reason for reason in problems(missing_training)))

            no_training = {**base, "consent": {**base["consent"], "allowsTraining": None}}
            self.assertTrue(any("Training consent" in reason for reason in problems(no_training)))
            no_person = {**base, "consent": {key: value for key, value in base["consent"].items() if key != "allowsPersonImagery"}}
            self.assertTrue(any("Person-imagery permission is missing" in reason for reason in problems(no_person)))
            contradiction = {**base, "consent": {**base["consent"], "rights": "commercially-licensed"}}
            self.assertTrue(any("do not match" in reason for reason in problems(contradiction)))
            no_provenance = {**base, "provenance": {"source": "", "acquired": "", "method": ""}}
            self.assertTrue(any("Provenance" in reason for reason in problems(no_provenance)))
            self.assertTrue(any("acquisition method" in reason for reason in problems({**base, "provenance": {**base["provenance"], "method": ""}})))

            unnamed = {**base, "recordKind": "real", "reviewer": "", "review": "corrected"}
            self.assertEqual(admission_status(unnamed)["label"], "Awaiting independent review")
            same_person = {**base, "recordKind": "real", "reviewer": base["annotator"], "review": "corrected"}
            self.assertEqual(admission_status(same_person)["label"], "Rejected")
            waiting = {**base, "recordKind": "real", "review": "corrected"}
            self.assertEqual(admission_status(waiting)["label"], "Awaiting independent review")
            approved, errors = approve(waiting, "lin")
            self.assertEqual(errors, [])
            self.assertEqual(admission_status(approved)["label"], "Eligible for admission")
            self.assertFalse(approved["admitted"])
            decision = admit([approved])
            self.assertEqual([row["sku"] for row in decision["admitted"]], ["sku-fixture"])
            self.assertEqual(admission_status(decision["admitted"][0])["label"], "Admitted")

            mismatched = {**base, "assetHash": "b" * 64}
            self.assertTrue(any("does not match" in reason for reason in problems(mismatched)))

    def test_archive_limits_and_repeat_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hostile = root / "hostile.zip"
            with zipfile.ZipFile(hostile, "w") as archive:
                archive.writestr("..\\secret.txt", b"no")
            with self.assertRaises(RuntimeError):
                extract_zip(hostile, root / "hostile")
            duplicate = root / "duplicate.zip"
            with zipfile.ZipFile(duplicate, "w") as archive:
                archive.writestr("a.txt", b"one")
                archive.writestr("a.txt", b"two")
            with self.assertRaises(RuntimeError):
                extract_zip(duplicate, root / "duplicate")
            huge = root / "huge.zip"
            with zipfile.ZipFile(huge, "w") as archive:
                archive.writestr("big.bin", b"A" * 40)
            with self.assertRaises(RuntimeError):
                extract_zip(huge, root / "huge", {"entry_bytes": 8, "total_bytes": 8})
            self.assertFalse((root / "secret.txt").exists())
            image = root / "pixels.png"
            Image.new("RGB", (8, 8), (1, 2, 3)).save(image)
            self.assertEqual(len(file_hash(image)), 64)


if __name__ == "__main__":
    unittest.main()
