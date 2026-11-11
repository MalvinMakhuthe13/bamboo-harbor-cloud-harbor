"""Kaggle preparation. GPU cases are mocked so a CUDA session and this machine both pass."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from dataset_gate import admit, approve, catalog_drafts, content_id, correct, file_hash, problems, set_rights, write_manifest
from dinov2_experiment import extract_patch_features, fit_splits, load_checkpoint, load_feature_images, run_experiment, save_checkpoint
from install_isolated import install
from garment_intel import PARTS
from gpu_probe import probe_gpu
from kaggle_setup import BRANCH, REPO, build_report, clone_plan, main, prepare_checkout, read_git_token

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "ghp_thisisnotarealtoken"
COMMIT = "0123456789abcdef"


def absent_gpu():
    return {
        "cudaAvailable": False,
        "gpuName": None,
        "vramMb": None,
        "torchVersion": None,
        "cudaVersion": None,
        "measured": False,
        "reason": "CUDA is unavailable. Refusing a silent CPU fallback.",
    }


def present_gpu():
    return {
        "cudaAvailable": True,
        "gpuName": "Tesla T4",
        "vramMb": 16384,
        "torchVersion": "test",
        "cudaVersion": "12",
        "measured": True,
        "reason": "",
    }


def spatial_parts(width: int, height: int) -> dict:
    polygon = {"present": True, "kind": "polygon", "polygon": [[1, 1], [width - 2, 1], [width - 2, height - 2], [1, height - 2]]}
    absent = {"present": False, "kind": "absent"}
    return {"collar": dict(polygon), "sleeve": dict(polygon), "hem": dict(polygon), "straps": dict(absent), "legs": dict(absent)}


def make_row(folder: Path, sample_id: str, color, split: str, sku: str, size=(32, 32), capture=None) -> dict:
    image_path = folder / f"{sample_id}.png"
    mask_path = folder / f"{sample_id}-mask.png"
    Image.new("RGB", size, color).save(image_path)
    Image.new("L", size, 255).save(mask_path)
    row = {
        "sampleId": sample_id,
        "sku": sku,
        "assetHash": file_hash(image_path),
        "byteSize": image_path.stat().st_size,
        "imagePath": str(image_path),
        "imageWidth": size[0],
        "imageHeight": size[1],
        "provenance": {"source": "isibuko-studio", "acquired": "2026-11-11", "origin": "studio"},
        "category": "shirt",
        "licence": "isibuko-owned",
        "commercialUse": True,
        "consent": {"consentId": "c1", "rights": "isibuko-owned", "allowsTraining": True, "allowsPersonImagery": False},
        "parts": spatial_parts(*size),
        "garmentMask": {
            "path": str(mask_path),
            "sha256": file_hash(mask_path),
            "width": size[0],
            "height": size[1],
            "foregroundPixels": size[0] * size[1],
        },
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
        "proportions": [1.0, 0.2, 0.8],
        "captureId": capture,
        "admitted": False,
    }
    approved, errors = approve(row, "lin")
    if errors:
        raise AssertionError(errors)
    return approved


class KagglePrepTests(unittest.TestCase):
    def test_catalog_annotations_and_duplicates(self):
        catalog = admit(catalog_drafts())
        self.assertEqual(catalog["rejected"], 5)
        self.assertEqual(catalog["admitted"], [])
        self.assertFalse(catalog["readyForExperiment"])
        self.assertTrue(catalog["nearDuplicateDetection"])
        self.assertTrue(any("Licence" in reason for row in catalog["rows"] for reason in row["reasons"]))

        blocked, edit_errors = correct(catalog_drafts()[0], {"licence": "research-only"}, "lin")
        self.assertTrue(edit_errors)
        self.assertEqual(blocked["licence"], "unreviewed")

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            good = make_row(folder, "owned-1", (180, 140, 90), "train", "sku-1")
            self.assertEqual(problems(good), [])
            _, same_errors = approve({**good, "review": "corrected"}, "ada")
            self.assertTrue(any("different person" in error for error in same_errors))

            flags = {**good, "parts": {name: {"present": True} for name in PARTS}}
            self.assertTrue(any("not a part annotation" in error for error in problems(flags)))
            mismatched = {**good, "assetHash": "b" * 64}
            self.assertTrue(any("does not match the image file" in error for error in problems(mismatched)))
            missing = {**good, "imagePath": str(folder / "missing.png")}
            self.assertTrue(any("missing" in error.lower() for error in problems(missing)))
            outside = {**good, "parts": {**good["parts"], "collar": {"present": True, "kind": "polygon", "polygon": [[100, 100], [120, 100], [120, 110]]}}}
            self.assertTrue(any("outside" in error for error in problems(outside)))

            body = {**good, "bodyMask": {"sha256": "e" * 64}}
            self.assertTrue(any("person imagery" in error for error in problems(body)))

            copy = make_row(folder, "owned-2", (20, 40, 180), "val", "sku-2")
            copy = {**copy, "assetHash": good["assetHash"], "imagePath": good["imagePath"], "byteSize": good["byteSize"]}
            duplicate = admit([good, copy])
            self.assertEqual(duplicate["admitted"], [])
            self.assertTrue(any("Duplicate image hash" in reason for row in duplicate["rows"] for reason in row["reasons"]))

            png = folder / "plain.png"
            bmp = folder / "plain.bmp"
            Image.new("RGB", (32, 32), (12, 80, 40)).save(png)
            Image.new("RGB", (32, 32), (12, 80, 40)).save(bmp)
            self.assertNotEqual(file_hash(png), file_hash(bmp))
            self.assertEqual(content_id(png), content_id(bmp))
            reencoded = [
                make_row(folder, "re-a", (12, 80, 40), "train", "sku-re"),
                make_row(folder, "re-b", (12, 80, 40), "val", "sku-re", size=(48, 48)),
            ]
            reencoded_report = admit(reencoded)
            self.assertEqual(reencoded_report["admitted"], [])
            self.assertTrue(any("re-encoding" in reason or "resizing" in reason for row in reencoded_report["rows"] for reason in row["reasons"]))

            shifted = make_row(folder, "shift", (12, 80, 40), "val", "sku-re")
            image = Image.open(shifted["imagePath"])
            image.putpixel((0, 0), (14, 82, 42))
            image.save(shifted["imagePath"])
            shifted["assetHash"] = file_hash(Path(shifted["imagePath"]))
            shifted["byteSize"] = Path(shifted["imagePath"]).stat().st_size
            shifted, shift_errors = approve(shifted, "lin")
            self.assertEqual(shift_errors, [])
            base = make_row(folder, "base", (12, 80, 40), "train", "sku-re")
            leaked = admit([base, shifted])
            self.assertEqual(leaked["admitted"], [])
            self.assertTrue(any("Near-duplicate" in reason or "re-encoding" in reason or "resizing" in reason for row in leaked["rows"] for reason in row["reasons"]))

            capture_rows = [
                make_row(folder, "cap-a", (200, 20, 20), "train", "sku-cap", capture="session-9"),
                make_row(folder, "cap-b", (20, 20, 200), "test", "sku-cap", capture="session-9"),
            ]
            capture_report = admit(capture_rows)
            self.assertEqual(capture_report["admitted"], [])
            self.assertTrue(any("leaks across splits" in reason for row in capture_report["rows"] for reason in row["reasons"]))

            distinct = [
                make_row(folder, "red", (220, 20, 20), "train", "sku-red"),
                make_row(folder, "blue", (20, 20, 220), "train", "sku-blue"),
            ]
            distinct_report = admit(distinct)
            self.assertEqual([row["sku"] for row in distinct_report["admitted"]], ["sku-red", "sku-blue"])
            self.assertEqual(distinct_report["notes"], [])

            with (folder / "manifest.jsonl").open("w", encoding="utf-8") as handle:
                write_manifest(folder / "manifest.jsonl", distinct_report)
            result = run_experiment(folder / "manifest.jsonl", {})
            self.assertFalse(result["started"])
            self.assertFalse(result["downloaded"])
            self.assertFalse(result["trained"])
            self.assertTrue(result["notGenerativeTryOn"])
            self.assertTrue(result["notPixelSegmentation"])
            self.assertTrue(result["notLiveVideo"])
            self.assertTrue(result["notDeformation"])
            self.assertFalse(result["readyForLive"])

    def test_decoded_dimensions_foreground_and_held_out_images(self):
        import dinov2_experiment as experiment

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            train = make_row(folder, "tr", (10, 20, 30), "train", "s1")
            val = make_row(folder, "va", (30, 20, 10), "val", "s2")
            held = make_row(folder, "held-out", (1, 2, 3), "test", "s3")
            seen = []

            def opener(path):
                seen.append(Path(path).name)
                if "held-out" in Path(path).name:
                    raise AssertionError("test image opened")
                return path

            selected, _images = load_feature_images([train, val, held], opener)
            self.assertEqual([row["split"] for row in selected], ["train", "val"])

            def stop(images, weight_dir):
                del images, weight_dir
                raise RuntimeError("encoder stopped before any weights")

            original = experiment._encode_images
            experiment._encode_images = stop
            try:
                with self.assertRaises(RuntimeError):
                    extract_patch_features([train, val, held], folder / "weights", open_image=opener)
            finally:
                experiment._encode_images = original
            self.assertNotIn("held-out.png", seen)

            wrong_size = {**train, "imageWidth": train["imageWidth"] + 5}
            self.assertTrue(any("decoded image" in error for error in problems(wrong_size)))
            wrong_count = {**train, "garmentMask": {**train["garmentMask"], "foregroundPixels": 1}}
            self.assertTrue(any("foreground count" in error for error in problems(wrong_count)))
            wrong_mask = {**train, "garmentMask": {**train["garmentMask"], "width": 2, "height": 2}}
            self.assertTrue(any("decoded mask" in error for error in problems(wrong_mask)))

    def test_install_stays_inside_the_venv(self):
        calls = []

        def fake(argv, check, capture_output, text):
            del check, capture_output, text
            calls.append(list(argv))
            return subprocess.CompletedProcess(argv, 0, "", "")

        venv = Path(tempfile.mkdtemp()) / "venv"
        ready = install(venv, run=fake, probe=lambda: {"numpy": True, "pillow": True})
        self.assertFalse(ready["pipCalled"])
        self.assertTrue(ready["torchUntouched"])
        self.assertTrue(any("--system-site-packages" in command for command in calls))
        self.assertFalse(any("torch" in part for command in calls for part in command))
        calls.clear()
        missing = install(venv, run=fake, probe=lambda: {"numpy": True, "pillow": False})
        pip = [command for command in calls if "install" in command and "--no-deps" in command]
        self.assertEqual(len(pip), 1)
        self.assertIn("pillow==12.3.0", pip[0])
        self.assertIn(str(venv), pip[0][0])
        self.assertNotIn("torch", " ".join(pip[0]))
        self.assertTrue(missing["pipCalled"])

        notebook = json.loads((ROOT / "kaggle" / "isibuko-gpu-setup.ipynb").read_text(encoding="utf-8"))
        code = ["".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code"]
        self.assertIn("install_isolated.py", code[1])
        self.assertNotIn("requirements-kaggle.txt", code[1])
        self.assertNotIn("SystemExit", code[-1])
        self.assertIn("--require-gpu", code[-1])
        self.assertIn("RuntimeError", code[-1])

    def test_train_step_never_sees_validation_or_test(self):
        rows = []
        for split, sku in (("train", "a"), ("train", "a"), ("val", "only-val"), ("test", "only-test")):
            rows.append(
                {
                    "split": split,
                    "sku": sku,
                    "category": "shirt",
                    "proportions": [1.0, 0.0, 0.0],
                    "parts": {name: {"present": False} for name in PARTS},
                }
            )
        seen = []

        def step(indices, features, category, parts, proportions, sku):
            del features, category, parts, proportions, sku
            seen.extend(indices)

        summary = fit_splits(np.zeros((4, 3), np.float32), rows, step, steps=6)
        self.assertEqual(summary["trainCount"], 2)
        self.assertEqual(summary["valCount"], 1)
        self.assertEqual(summary["testCount"], 1)
        self.assertTrue(seen)
        self.assertTrue(all(index in summary["trainIndex"] for index in seen))
        self.assertNotIn(2, seen)
        self.assertNotIn(3, seen)
        self.assertNotIn("only-val", summary["skuMap"])
        self.assertNotIn("only-test", summary["skuMap"])

    def test_gpu_requirement_is_mocked_both_ways(self):
        self.assertEqual(main(["--require-gpu"], probe=absent_gpu, env={}), 2)
        self.assertEqual(main(["--require-gpu"], probe=present_gpu, env={}), 0)
        live = probe_gpu()
        self.assertIsInstance(live["cudaAvailable"], bool)
        self.assertIn("measured", live)
        report = build_report({"ISIBUKO_REQUIRE_GIT_TOKEN": "1", "ISIBUKO_GIT_TOKEN": TOKEN}, probe=present_gpu)
        self.assertNotIn(TOKEN, json.dumps(report))
        self.assertTrue(report["credentialPresent"])
        self.assertTrue(report["gpu"]["cudaAvailable"])
        missing = build_report({"ISIBUKO_REQUIRE_GIT_TOKEN": "1"}, probe=absent_gpu)
        self.assertTrue(missing["errors"])
        self.assertNotIn("ghp_", json.dumps(missing))

    def test_checkpoint_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "head.npz"
            save_checkpoint(path, {"w1": np.ones((2, 2), np.float32)}, {"trained": False, "kind": "untrained-init"})
            loaded = load_checkpoint(path)
            self.assertFalse(loaded["metadata"]["trained"])
            self.assertEqual(loaded["weights"]["w1"].shape, (2, 2))
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                load_checkpoint(path)
            with self.assertRaises(ValueError):
                save_checkpoint(Path(tmp) / "nope.npz", {"w1": np.ones((1, 1), np.float32)}, {"trained": True, "kind": "untrained-init"})

    def test_clone_success_failure_and_secret_redaction(self):
        dest = Path(tempfile.mkdtemp()) / "repo"
        seen = []

        def fake(argv, check, capture_output, text):
            del check, capture_output, text
            seen.append(list(argv))
            if argv[1] == "clone":
                self.assertIn(BRANCH, argv)
                self.assertEqual(argv[-1], str(dest))
                Path(argv[-1]).mkdir(parents=True)
                return subprocess.CompletedProcess(argv, 0, "", "")
            if "set-url" in argv:
                self.assertNotIn(TOKEN, " ".join(argv))
                self.assertIn(REPO, argv)
                return subprocess.CompletedProcess(argv, 0, "", "")
            if "--abbrev-ref" in argv:
                return subprocess.CompletedProcess(argv, 0, BRANCH + "\n", "")
            if "rev-parse" in argv:
                return subprocess.CompletedProcess(argv, 0, COMMIT + "\n", "")
            return subprocess.CompletedProcess(argv, 1, "", "unexpected")

        cloned = prepare_checkout(dest, TOKEN, run=fake)
        self.assertEqual(cloned["commit"], COMMIT)
        self.assertEqual(cloned["branch"], BRANCH)
        self.assertNotIn(TOKEN, cloned["log"])
        self.assertIn(str(dest), cloned["log"])
        self.assertTrue(any("set-url" in command for command in seen))
        self.assertTrue(dest.is_dir())

        failed = Path(tempfile.mkdtemp()) / "failed"
        failed.mkdir()

        def fail(argv, check, capture_output, text):
            del check, capture_output, text
            return subprocess.CompletedProcess(argv, 1, "", "fatal")

        with self.assertRaises(RuntimeError) as caught:
            prepare_checkout(failed, TOKEN, run=fail)
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertFalse(failed.exists())
        self.assertIn(str(failed), clone_plan(TOKEN, failed)["argv"])
        self.assertNotIn(TOKEN, clone_plan(TOKEN, failed)["log"])

        class SecretClient:
            def get_secret(self, name):
                if name != "ISIBUKO_GIT_TOKEN":
                    raise KeyError(name)
                return TOKEN

        self.assertEqual(read_git_token(environ={}, client=SecretClient()), TOKEN)
        self.assertEqual(read_git_token(environ={"ISIBUKO_GIT_TOKEN": ""}, client=SecretClient()), TOKEN)
        self.assertEqual(read_git_token(environ={"ISIBUKO_GIT_TOKEN": "env-token-value"}, client=SecretClient()), "env-token-value")

        class Missing:
            def get_secret(self, name):
                raise RuntimeError("secret not set")

        self.assertEqual(read_git_token(environ={}, client=Missing()), "")
        self.assertEqual(read_git_token(environ={}, load_client=lambda: (_ for _ in ()).throw(ImportError("no kaggle"))), "")

        notebook = (ROOT / "kaggle" / "isibuko-gpu-setup.ipynb").read_text(encoding="utf-8")
        self.assertIn("UserSecretsClient", notebook)
        self.assertIn(BRANCH, notebook)
        self.assertNotIn(TOKEN, notebook)
        self.assertNotIn("ISIBUKO_APPROVE_DINOV2_DOWNLOAD=1", notebook)
        self.assertIn("--require-gpu", notebook)
        self.assertIn("not a generative try-on model", notebook)


if __name__ == "__main__":
    unittest.main()
