"""The category probe is a local experiment. It does not write product facts."""

import ast
import unittest
from pathlib import Path

import category_probe


class ProbeContractTests(unittest.TestCase):
    def test_prompts_are_the_five_category_strings(self):
        self.assertEqual(
            category_probe.PROMPTS,
            (
                ("shirt", "shirt"),
                ("jacket", "jacket"),
                ("dress", "dress"),
                ("trousers", "trousers"),
                ("none of these", "none of these"),
            ),
        )

    def test_scores_are_not_described_as_probabilities(self):
        ranked = category_probe.rank_similarities({"shirt": 0.21, "jacket": 0.20, "dress": 0.10, "trousers": 0.05, "none of these": 0.01})
        self.assertEqual(ranked["top"], "shirt")
        self.assertEqual(ranked["runnerUp"], "jacket")
        self.assertAlmostEqual(ranked["gap"], 0.01)
        self.assertFalse(ranked["calibrated"])
        self.assertEqual(ranked["scoreKind"], "cosine-similarity")

    def test_camera_and_measurement_inputs_are_refused(self):
        for payload in (
            {"frame": b"jpeg"},
            {"landmarks": []},
            {"measurements": {"chestCm": 90}},
            {"stream": object()},
            {"pixels": [1, 2, 3]},
            {"url": "https://example.test/shirt.jpg"},
            {"path": "/tmp/shirt.png"},
        ):
            self.assertEqual(category_probe.refuse_non_image(payload), category_probe.REFUSAL)

    def test_the_module_does_not_download_or_write_product_state(self):
        source = Path(category_probe.__file__).read_text()
        tree = ast.parse(source)
        imports = [node.module for node in tree.body if isinstance(node, ast.ImportFrom)]
        imports += [alias.name for node in tree.body if isinstance(node, ast.Import) for alias in node.names]
        self.assertFalse(any(name in {"urllib", "requests", "huggingface_hub"} for name in imports if name))
        self.assertNotIn("isibuko.live.v1", source)
        self.assertNotIn("isibuko.visual-review.v1", source)
        self.assertNotIn("ProductFact", source)

    def test_missing_weights_do_not_trigger_a_download(self):
        probe = category_probe.ClipProbe(Path("/tmp/isibuko-clip-missing"))
        with self.assertRaises(FileNotFoundError):
            probe.load()


if __name__ == "__main__":
    unittest.main()
