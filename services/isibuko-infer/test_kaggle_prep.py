"""Kaggle preparation. No GPU is claimed and the catalog is not admitted."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from dataset_gate import admit, approve, catalog_drafts, correct, problems, set_rights, write_manifest
from dinov2_experiment import load_checkpoint, run_experiment, save_checkpoint
from garment_intel import PARTS
from kaggle_setup import build_report, clone_plan, main, prepare_checkout

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "ghp_thisisnotarealtoken"


def owned(sample_id: str, digest: str, split: str = "train") -> dict:
    return {
        "sampleId": sample_id,
        "sku": "sku-1" if split == "train" else "sku-2",
        "assetHash": digest,
        "byteSize": 1200,
        "provenance": {"source": "isibuko-studio", "acquired": "2026-11-11", "origin": "studio"},
        "category": "shirt",
        "licence": "isibuko-owned",
        "commercialUse": True,
        "consent": {"consentId": "c1", "rights": "isibuko-owned", "allowsTraining": True, "allowsPersonImagery": False},
        "parts": {name: {"present": name in ("collar", "sleeve", "hem"), "box": None} for name in PARTS},
        "garmentMask": {"sha256": "d" * 64, "foregroundPixels": 90},
        "bodyMask": None,
        "personCapturePermitted": False,
        "confidence": 0.95,
        "review": "corrected",
        "annotator": "ada",
        "reviewer": "lin",
        "split": split,
        "pattern": None,
        "fabric": "linen",
        "colours": ["sand"],
        "admitted": False,
    }


class KagglePrepTests(unittest.TestCase):
    def test_catalog_is_rejected_and_a_reviewed_row_can_be_admitted(self):
        catalog = admit(catalog_drafts())
        self.assertEqual(catalog["rejected"], 5)
        self.assertEqual(catalog["admitted"], [])
        self.assertFalse(catalog["readyForExperiment"])
        self.assertTrue(any("Licence" in reason for row in catalog["rows"] for reason in row["reasons"]))

        row, rights_errors = set_rights(
            catalog_drafts()[0],
            "isibuko-owned",
            {"consentId": "c1", "rights": "isibuko-owned", "allowsTraining": True, "allowsPersonImagery": False},
            True,
            "lin",
        )
        self.assertEqual(rights_errors, [])
        blocked, edit_errors = correct(row, {"licence": "research-only"}, "lin")
        self.assertTrue(edit_errors)
        self.assertEqual(blocked["licence"], "isibuko-owned")

        good = owned("owned-1", "a" * 64)
        self.assertEqual(problems(good), [])
        approved, approval_errors = approve(good, "lin")
        self.assertEqual(approval_errors, [])
        same_person, same_errors = approve(good, "ada")
        self.assertTrue(any("different person" in error for error in same_errors))
        self.assertFalse(same_person.get("admitted"))

        body = dict(good)
        body["bodyMask"] = {"sha256": "e" * 64, "pixels": 10}
        _, body_errors = approve(body, "lin")
        self.assertTrue(any("person imagery" in error for error in body_errors))

        other = owned("owned-2", "b" * 64, "val")
        report = admit([approved, approve(other, "lin")[0]])
        self.assertEqual(len(report["admitted"]), 2)
        self.assertFalse(report["readyForExperiment"])
        duplicate = admit([approved, dict(approved, sampleId="copy", split="val")])
        self.assertEqual(duplicate["admitted"], [])
        self.assertTrue(any("Duplicate image hash" in reason for row in duplicate["rows"] for reason in row["reasons"]))

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.jsonl"
            write_manifest(path, report)
            result = run_experiment(path, {})
        self.assertFalse(result["started"])
        self.assertFalse(result["downloaded"])
        self.assertFalse(result["trained"])
        self.assertTrue(result["reasons"])

    def test_checkpoint_roundtrip_and_gpu_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "head.npz"
            save_checkpoint(path, {"w1": np.ones((2, 2), np.float32)}, {"trained": False, "kind": "untrained-init"})
            loaded = load_checkpoint(path)
            self.assertFalse(loaded["metadata"]["trained"])
            self.assertEqual(loaded["weights"]["w1"].shape, (2, 2))
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                load_checkpoint(path)
            np.savez_compressed(Path(tmp) / "broken.npz", w1=np.ones((2, 2), np.float32))
            with self.assertRaises(ValueError):
                load_checkpoint(Path(tmp) / "broken.npz")
            with self.assertRaises(ValueError):
                save_checkpoint(Path(tmp) / "nope.npz", {"w1": np.ones((1, 1), np.float32)}, {"trained": True, "kind": "untrained-init"})

        code = main(["--require-gpu"])
        self.assertEqual(code, 2)
        report = build_report({"ISIBUKO_REQUIRE_GIT_TOKEN": "1", "ISIBUKO_GIT_TOKEN": TOKEN})
        encoded = json.dumps(report)
        self.assertNotIn(TOKEN, encoded)
        self.assertTrue(report["credentialPresent"])
        self.assertFalse(report["gpu"]["cudaAvailable"])
        self.assertFalse(report["gpu"]["measured"])
        self.assertIn("not", report["gpu"]["reason"].lower())
        missing = build_report({"ISIBUKO_REQUIRE_GIT_TOKEN": "1"})
        self.assertTrue(missing["errors"])
        self.assertNotIn("ghp_", json.dumps(missing))

    def test_clone_plan_does_not_log_a_credential(self):
        plan = clone_plan(TOKEN)
        self.assertNotIn(TOKEN, plan["log"])
        self.assertIn("ai/isibuko-generative-foundation", plan["log"])
        dest = Path(tempfile.mkdtemp()) / "repo"
        dest.mkdir()

        def fake(argv, check, capture_output, text):
            return subprocess.CompletedProcess(argv, 1, "", "fatal")

        with self.assertRaises(RuntimeError) as caught:
            prepare_checkout(dest, TOKEN, run=fake)
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertFalse(dest.exists())
        notebook = (ROOT / "kaggle" / "isibuko-gpu-setup.ipynb").read_text(encoding="utf-8")
        self.assertIn("ai/isibuko-generative-foundation", notebook)
        self.assertNotIn(TOKEN, notebook)
        self.assertNotIn("ISIBUKO_APPROVE_DINOV2_DOWNLOAD=1", notebook)
        self.assertIn("--require-gpu", notebook)


if __name__ == "__main__":
    unittest.main()
