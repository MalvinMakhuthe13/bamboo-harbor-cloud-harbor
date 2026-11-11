"""Spatial feature extraction. No download and no prediction-head fitting."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from feature_extract import extract_spatial, local_dinov2_encoder


def row(sample_id, split, admitted=True):
    return {
        "sampleId": sample_id,
        "sku": f"sku-{sample_id}",
        "assetHash": "a" * 64,
        "split": split,
        "admitted": admitted,
        "imagePath": f"/images/{sample_id}.png",
    }


class FeatureExtractTests(unittest.TestCase):
    def test_spatial_tokens_resume_and_test_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            opened = []
            calls = {"n": 0}

            def open_image(path):
                opened.append(path)
                if "held-out" in path:
                    raise AssertionError("test image opened")
                return path

            def encode(image):
                calls["n"] += 1
                if calls["n"] == 2:
                    raise RuntimeError("interrupted")
                return np.ones((4, 6), np.float32) + (1 if "train" in image else 0)

            rows = [row("train-a", "train"), row("val-b", "val"), row("held-out", "test")]
            with self.assertRaises(RuntimeError):
                extract_spatial(rows, dest, encode, open_image)
            self.assertNotIn("/images/held-out.png", opened)
            self.assertTrue((dest / "tokens.npz").exists())

            def encode_rest(image):
                opened.append("encode:" + image)
                if image.endswith("train-a.png"):
                    raise AssertionError("completed sample was encoded again")
                return np.arange(8, dtype=np.float32).reshape(4, 2)

            report = extract_spatial(rows, dest, encode_rest, open_image)
            self.assertNotIn("/images/train-a.png", opened[1:])
            self.assertEqual(report["sampleCount"], 2)
            self.assertEqual(report["trainCount"], 1)
            self.assertEqual(report["valCount"], 1)
            self.assertEqual(report["testCount"], 0)
            self.assertFalse(report["testImagesOpened"])
            self.assertFalse(report["trained"])
            self.assertFalse(report["headFitted"])
            self.assertFalse(report["readyForLive"])
            self.assertEqual(report["samples"][0]["sku"], "sku-train-a")
            self.assertEqual(len(report["samples"][0]["assetHash"]), 64)

            def pooled(_image):
                return np.ones((6,), np.float32)

            with self.assertRaises(RuntimeError) as pooled_error:
                extract_spatial([row("new", "train")], Path(tmp) / "other", pooled, open_image)
            self.assertIn("pooled", str(pooled_error.exception))

        with self.assertRaises(RuntimeError) as missing:
            local_dinov2_encoder(Path(tmp) / "missing-weights")
        self.assertIn("Refusing to download", str(missing.exception))
        source = Path(__file__).with_name("feature_extract.py").read_text(encoding="utf-8")
        self.assertNotIn("hf_hub_download", source)
        self.assertNotIn("GarmentHead", source)
        self.assertIn("[:, 1:", source)


if __name__ == "__main__":
    unittest.main()
