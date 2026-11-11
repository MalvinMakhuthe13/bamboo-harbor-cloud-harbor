"""The garment head trains only on synthetic drawings. The catalog is refused."""

import unittest

from garment_intel import BACKBONES, INTENDED, catalog_rows, live_slot, training_batch_errors, train_synthetic, validate_annotation


class IntelTests(unittest.TestCase):
    def test_catalog_cannot_train_and_smoke_is_not_a_product_model(self):
        rows = catalog_rows()
        self.assertEqual(len(rows), 5)
        self.assertTrue(training_batch_errors(rows))
        self.assertTrue(any("unreviewed" in error or "trained on" in error for error in training_batch_errors(rows)))
        for row in rows:
            self.assertTrue(validate_annotation(row))

        owned = {
            "sampleId": "drawn-1",
            "sku": "drawn-shirt",
            "assetHash": "a" * 64,
            "category": "shirt",
            "licence": "isibuko-owned",
            "source": "synthetic-drawing",
            "annotator": "generator",
            "confidence": 1,
            "mask": {"foregroundPixels": 80},
            "parts": {name: False for name in ("collar", "sleeve", "hem", "straps", "legs")},
            "fabric": "drawn",
            "colours": ["sand"],
            "pattern": None,
            "split": "train",
        }
        self.assertEqual(validate_annotation(owned), [])
        leaked = [{**owned, "sampleId": "drawn-1"}, {**owned, "sampleId": "drawn-2", "split": "val"}]
        self.assertTrue(any("more than one split" in error for error in training_batch_errors(leaked)))

        run = train_synthetic()
        self.assertFalse(run["productModel"])
        self.assertEqual(run["catalogImagesUsed"], 0)
        self.assertFalse(run["backboneDownloaded"])
        self.assertGreater(run["parameters"], 1000)
        self.assertLess(run["lossEnd"], run["lossStart"])
        self.assertGreater(run["val"]["categoryAccuracy"], 0.6)
        self.assertGreater(run["val"]["partAccuracy"], 0.8)
        self.assertGreater(run["val"]["sameSkuCosine"], run["val"]["otherSkuCosine"])
        self.assertGreater(run["overfitTrainAccuracy"], 0.9)
        self.assertLess(run["overfitValAccuracy"], 0.5)
        self.assertFalse(run["readyForLive"])
        slot = live_slot(rows[0]["assetHash"])
        self.assertTrue(slot["hashRemainsAuthoritative"])
        self.assertFalse(slot["readyForLive"])
        self.assertIsNone(slot["identity"])

        self.assertEqual(INTENDED["status"], "not-trained")
        self.assertFalse(INTENDED["backboneLoaded"])
        self.assertEqual(INTENDED["backbone"], "facebook/dinov2-small")
        self.assertGreater(INTENDED["headParameters"], 10_000)
        selected = [row for row in BACKBONES if row["role"].startswith("Intended")]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["id"], "facebook/dinov2-small")
        self.assertTrue(all(row["downloaded"] is False and row["executed"] is False for row in BACKBONES))
        self.assertTrue(any(row["id"] == "fashn-human-parser" and row["role"] == "Refused." for row in BACKBONES))


if __name__ == "__main__":
    unittest.main()
