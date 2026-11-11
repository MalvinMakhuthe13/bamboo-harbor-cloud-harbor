"""Measurements of the catalog photographs. Not a learned model and not a worn image."""

import unittest
from pathlib import Path

from garment_photo import TRAINING, measure_photo

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "public" / "catalog"


def read(name: str, sku: str, material: str, colours: list[str]) -> dict:
    return measure_photo(CATALOG / name, sku, material, colours)


class PhotographTests(unittest.TestCase):
    def test_catalog_garments_are_measured_and_not_learned(self):
        linen = read("shirt-linen.png", "shirt-linen", "linen", ["sand"])
        silk = read("shirt-silk.png", "shirt-silk", "silk", ["black"])
        jacket = read("jacket-camel.png", "jacket-camel", "wool", ["camel"])
        dress = read("dress-slip.png", "dress-slip", "satin", ["black"])
        pants = read("pants-charcoal.png", "pants-charcoal", "wool", ["charcoal"])

        for record in (linen, silk, jacket, dress, pants):
            self.assertFalse(record["learned"])
            self.assertEqual(record["method"], "handcrafted-photograph")
            self.assertIsNone(record["modelExecuted"])
            self.assertEqual(record["deformation"], "not-trained")
            self.assertIsNone(record["appearance"]["logo"])
            self.assertIsNone(record["appearance"]["pattern"])
            self.assertEqual(len(record["assetHash"]), 64)
            self.assertGreater(record["pixels"], 1000)
            self.assertGreater(record["boundaryPixels"], 100)
            self.assertEqual(record["product"]["materialFromRecord"] != "", True)

        self.assertNotEqual(linen["assetHash"], silk["assetHash"])
        self.assertTrue(linen["geometry"]["collar"] and linen["geometry"]["sleevesSeparated"])
        self.assertFalse(linen["geometry"]["straps"])
        self.assertTrue(silk["geometry"]["collar"] and silk["geometry"]["sleevesSeparated"])
        self.assertGreater(linen["appearance"]["medianRgb"][0], 180)
        self.assertLess(max(silk["appearance"]["medianRgb"]), 40)
        self.assertGreater(linen["appearance"]["textureEnergy"], silk["appearance"]["textureEnergy"])

        self.assertTrue(jacket["geometry"]["collar"])
        self.assertFalse(jacket["geometry"]["sleevesSeparated"])
        self.assertGreater(jacket["appearance"]["medianRgb"][0], 140)
        self.assertLess(jacket["appearance"]["medianRgb"][2], 100)

        self.assertTrue(dress["geometry"]["straps"])
        self.assertFalse(dress["geometry"]["collar"])
        self.assertFalse(dress["geometry"]["sleevesSeparated"])

        self.assertTrue(pants["geometry"]["legsSeparated"])
        self.assertFalse(pants["geometry"]["collar"])
        self.assertFalse(pants["geometry"]["sleevesSeparated"])

        self.assertEqual(TRAINING["bodyDeformation"]["status"], "not-trained")
        self.assertIn("commercial", TRAINING["garmentPartHead"]["data"])
        self.assertIn("not downloaded", TRAINING["garmentPartHead"]["gpu"])


if __name__ == "__main__":
    unittest.main()
