"""Offline CLIP category probe.

This scores one product photograph against five fixed text prompts.
The score is a cosine similarity. It is not a probability, and it is not written to the wardrobe or the merchant review store.
The model files are read from a local directory. This module does not download them.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import time
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image

REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
REPOSITORY = "Xenova/clip-vit-base-patch32"
DEFAULT_MODEL_DIR = Path(f"/tmp/isibuko-clip-weights/xenova-clip-vit-base-patch32/{REVISION}")

# The historical five-way prompts. They are not a 14-way category test.
PROMPTS: tuple[tuple[str, str], ...] = (
    ("shirt", "shirt"),
    ("jacket", "jacket"),
    ("dress", "dress"),
    ("trousers", "trousers"),
    ("none of these", "none of these"),
)

# Frozen before this run. A score must not add, remove, or rewrite one.
FROZEN_TEMPLATES: tuple[str, ...] = (
    "{label}",
    "a photograph of a {label}",
    "an isolated {label} product photograph",
)

VISUAL_LABELS: tuple[str, ...] = (
    "wig",
    "shirt",
    "jacket",
    "dress",
    "trousers",
    "skirt",
    "hat",
    "glasses",
    "nails",
    "earrings",
    "necklace",
    "bracelet",
    "ring",
    "watch",
)

# The catalogue field for pants-charcoal is "pants". Prompts use "trousers". The catalogue is not edited.
CATALOGUE_LABEL_NOTE = "Catalogue category pants is prompted as trousers. No catalogue category is changed."

# Phase 4D.2, commit 83d6450579a84b5ae73ae7e0e49832ecea119c18.
# Five bare labels, including "none of these". Not rerun. Not the 14-label template.
HISTORICAL_BASELINE: dict[str, object] = {
    "run": "phase-4d2",
    "commit": "83d6450579a84b5ae73ae7e0e49832ecea119c18",
    "template": "{label}",
    "closedSet": ("shirt", "jacket", "dress", "trousers", "none of these"),
    "scoreKind": "cosine-similarity",
    "rows": (
        {"catalogueId": "shirt-linen", "catalogueCategory": "shirt", "filename": "shirt-linen.png", "top": "shirt", "topScore": 0.2707, "runnerUp": "jacket", "runnerUpScore": 0.2603, "margin": 0.0104},
        {"catalogueId": "shirt-silk", "catalogueCategory": "shirt", "filename": "shirt-silk.png", "top": "jacket", "topScore": 0.2703, "runnerUp": "shirt", "runnerUpScore": 0.2560, "margin": 0.0143},
        {"catalogueId": "jacket-camel", "catalogueCategory": "jacket", "filename": "jacket-camel.png", "top": "jacket", "topScore": 0.2848, "runnerUp": "dress", "runnerUpScore": 0.2607, "margin": 0.0241},
        {"catalogueId": "dress-slip", "catalogueCategory": "dress", "filename": "dress-slip.png", "top": "dress", "topScore": 0.2792, "runnerUp": "trousers", "runnerUpScore": 0.2590, "margin": 0.0202},
        {"catalogueId": "pants-charcoal", "catalogueCategory": "pants", "filename": "pants-charcoal.png", "top": "trousers", "topScore": 0.2885, "runnerUp": "jacket", "runnerUpScore": 0.2549, "margin": 0.0336},
        {"catalogueId": "wig-wave", "catalogueCategory": "wig", "filename": "wig-wave.png", "top": "dress", "topScore": 0.2259, "runnerUp": "trousers", "runnerUpScore": 0.2184, "margin": 0.0074},
        {"catalogueId": "wig-bob", "catalogueCategory": "wig", "filename": "wig-bob.png", "top": "jacket", "topScore": 0.2149, "runnerUp": "none of these", "runnerUpScore": 0.2148, "margin": 0.0000},
        {"catalogueId": "wig-braids", "catalogueCategory": "wig", "filename": "wig-braids.png", "top": "trousers", "topScore": 0.2552, "runnerUp": "shirt", "runnerUpScore": 0.2420, "margin": 0.0133},
        {"catalogueId": "hat-fedora", "catalogueCategory": "hat", "filename": "hat-fedora.png", "top": "trousers", "topScore": 0.2476, "runnerUp": "jacket", "runnerUpScore": 0.2329, "margin": 0.0147},
        {"catalogueId": "hat-cap", "catalogueCategory": "hat", "filename": "hat-cap.png", "top": "trousers", "topScore": 0.2345, "runnerUp": "shirt", "runnerUpScore": 0.2245, "margin": 0.0101},
        {"catalogueId": "glasses-cateye", "catalogueCategory": "glasses", "filename": "glasses-cateye.png", "top": "trousers", "topScore": 0.2207, "runnerUp": "shirt", "runnerUpScore": 0.2081, "margin": 0.0125},
        {"catalogueId": "glasses-gold", "catalogueCategory": "glasses", "filename": "glasses-gold.png", "top": "trousers", "topScore": 0.2237, "runnerUp": "none of these", "runnerUpScore": 0.2202, "margin": 0.0035},
        {"catalogueId": "earring-hoop", "catalogueCategory": "earrings", "filename": "earring-hoop.png", "top": "none of these", "topScore": 0.2153, "runnerUp": "dress", "runnerUpScore": 0.2124, "margin": 0.0029},
        {"catalogueId": "necklace-pendant", "catalogueCategory": "necklace", "filename": "necklace-pendant.png", "top": "dress", "topScore": 0.2255, "runnerUp": "jacket", "runnerUpScore": 0.2110, "margin": 0.0145},
        {"catalogueId": "watch-gold", "catalogueCategory": "watch", "filename": "watch-gold.png", "top": "none of these", "topScore": 0.2142, "runnerUp": "dress", "runnerUpScore": 0.2132, "margin": 0.0010},
        {"catalogueId": "ring-signet", "catalogueCategory": "ring", "filename": "ring-signet.png", "top": "none of these", "topScore": 0.2243, "runnerUp": "jacket", "runnerUpScore": 0.2107, "margin": 0.0136},
    ),
}

CUTOUTS: tuple[tuple[str, str, str], ...] = tuple(
    (str(row["catalogueId"]), str(row["catalogueCategory"]), str(row["filename"])) for row in HISTORICAL_BASELINE["rows"]  # type: ignore[index]
)

ASSET_SHA256 = {
    "onnx/vision_model_quantized.onnx": "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299",
    "onnx/text_model_quantized.onnx": "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a",
}

CATALOGUE: tuple[tuple[str, str], ...] = (
    ("shirt-linen.png", "shirt"),
    ("shirt-silk.png", "shirt"),
    ("jacket-camel.png", "jacket"),
    ("dress-slip.png", "dress"),
    ("pants-charcoal.png", "trousers"),
)

CONTEXT = 77
PATTERN = re.compile(r"<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[a-z0-9]+|[^a-z0-9\s]", re.IGNORECASE)
REFUSAL = "Camera frames, landmarks, measurements, and addresses are not accepted."


def rank_similarities(scores: dict[str, float]) -> dict[str, float | str | bool]:
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    top_name, top_score = ordered[0]
    runner_name, runner_score = ordered[1]
    return {
        "top": top_name,
        "topScore": float(top_score),
        "runnerUp": runner_name,
        "runnerUpScore": float(runner_score),
        "gap": float(top_score - runner_score),
        "calibrated": False,
        "scoreKind": "cosine-similarity",
    }


def _bytes_to_unicode() -> dict[int, str]:
    visible = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    missing = [value for value in range(256) if value not in set(visible)]
    characters = visible + [256 + index for index in range(len(missing))]
    return dict(zip(visible + missing, (chr(value) for value in characters)))


class ClipTokenizer:
    """CLIP byte-pair encoding for the local vocab. ASCII prompts only need this path."""

    def __init__(self, model_dir: Path) -> None:
        vocab = json.loads((model_dir / "vocab.json").read_text())
        merges = (model_dir / "merges.txt").read_text().splitlines()
        if merges and merges[0].startswith("#"):
            merges = merges[1:]
        ranks = {tuple(line.split()): index for index, line in enumerate(merges) if line.strip()}
        self.encoder = vocab
        self.ranks = ranks
        self.byte_encoder = _bytes_to_unicode()
        self.start = vocab["<|startoftext|>"]
        self.end = vocab["<|endoftext|>"]
        self.cache: dict[str, str] = {}

    def _bpe(self, token: str) -> str:
        cached = self.cache.get(token)
        if cached is not None:
            return cached
        word = tuple(token[:-1]) + (token[-1] + "</w>",)
        pairs = {(word[index], word[index + 1]) for index in range(len(word) - 1)}
        if not pairs:
            result = token + "</w>"
            self.cache[token] = result
            return result
        while pairs:
            bigram = min(pairs, key=lambda pair: self.ranks.get(pair, 10**12))
            if bigram not in self.ranks:
                break
            first, second = bigram
            rebuilt: list[str] = []
            index = 0
            while index < len(word):
                try:
                    found = word.index(first, index)
                except ValueError:
                    rebuilt.extend(word[index:])
                    break
                rebuilt.extend(word[index:found])
                index = found
                if index < len(word) - 1 and word[index] == first and word[index + 1] == second:
                    rebuilt.append(first + second)
                    index += 2
                else:
                    rebuilt.append(word[index])
                    index += 1
            word = tuple(rebuilt)
            if len(word) == 1:
                break
            pairs = {(word[index], word[index + 1]) for index in range(len(word) - 1)}
        result = " ".join(word)
        self.cache[token] = result
        return result

    def encode(self, text: str) -> list[int]:
        cleaned = unicodedata.normalize("NFKC", html.unescape(text)).strip().lower()
        cleaned = re.sub(r"\s+", " ", cleaned)
        ids: list[int] = []
        for token in PATTERN.findall(cleaned):
            piece = "".join(self.byte_encoder[byte] for byte in token.encode("utf-8"))
            ids.extend(self.encoder[part] for part in self._bpe(piece).split(" "))
        return ids

    def input_ids(self, text: str) -> np.ndarray:
        body = self.encode(text)[: CONTEXT - 2]
        ids = [self.start, *body, self.end]
        ids.extend([self.end] * (CONTEXT - len(ids)))
        return np.asarray([ids], dtype=np.int64)


def preprocess(image: Image.Image, processor: dict) -> np.ndarray:
    size = int(processor["size"]["shortest_edge"])
    crop = int(processor["crop_size"]["height"])
    converted = image.convert("RGB")
    width, height = converted.size
    if width < height:
        resized = (size, max(crop, int(round(height * size / width))))
    else:
        resized = (max(crop, int(round(width * size / height))), size)
    converted = converted.resize(resized, Image.Resampling.BICUBIC)
    left = (converted.width - crop) // 2
    top = (converted.height - crop) // 2
    converted = converted.crop((left, top, left + crop, top + crop))
    pixels = np.asarray(converted, dtype=np.float32) * float(processor["rescale_factor"])
    mean = np.asarray(processor["image_mean"], dtype=np.float32)
    std = np.asarray(processor["image_std"], dtype=np.float32)
    pixels = (pixels - mean) / std
    return np.transpose(pixels, (2, 0, 1))[None, ...]


def on_white(image: Image.Image) -> Image.Image | None:
    if "A" not in image.getbands():
        return None
    alpha = np.asarray(image.getchannel("A"))
    if int(alpha.min()) == 255:
        return None
    background = Image.new("RGB", image.size, (255, 255, 255))
    background.paste(image.convert("RGBA"), mask=image.getchannel("A"))
    return background


class ClipProbe:
    def __init__(self, model_dir: Path = DEFAULT_MODEL_DIR) -> None:
        self.model_dir = Path(model_dir)
        self._vision = None
        self._text = None
        self._text_matrix: np.ndarray | None = None
        self.tokenizer: ClipTokenizer | None = None
        self.processor: dict | None = None

    def load(self) -> None:
        import onnxruntime as ort

        available = ort.get_available_providers()
        if "CPUExecutionProvider" not in available:
            raise RuntimeError("CPU inference is not available. A GPU provider is not used.")
        vision_path = self.model_dir / "onnx" / "vision_model_quantized.onnx"
        text_path = self.model_dir / "onnx" / "text_model_quantized.onnx"
        if not vision_path.is_file() or not text_path.is_file():
            raise FileNotFoundError(f"The local CLIP files are missing in {self.model_dir}. This probe does not download them.")
        options = ort.SessionOptions()
        options.enable_mem_pattern = True
        self._vision = ort.InferenceSession(str(vision_path), options, providers=["CPUExecutionProvider"])
        self._text = ort.InferenceSession(str(text_path), options, providers=["CPUExecutionProvider"])
        if self._vision.get_providers() != ["CPUExecutionProvider"] or self._text.get_providers() != ["CPUExecutionProvider"]:
            raise RuntimeError("The session did not stay on CPU.")
        self.tokenizer = ClipTokenizer(self.model_dir)
        self.processor = json.loads((self.model_dir / "preprocessor_config.json").read_text())
        rows = []
        for _label, prompt in PROMPTS:
            ids = self.tokenizer.input_ids(prompt)
            embedding = self._text.run(None, {"input_ids": ids})[0][0]
            rows.append(embedding)
        matrix = np.stack(rows).astype(np.float32)
        self._text_matrix = matrix / np.linalg.norm(matrix, axis=1, keepdims=True)

    def score_image(self, image: Image.Image) -> dict:
        if self._vision is None or self._text_matrix is None or self.processor is None:
            self.load()
        assert self._vision is not None and self._text_matrix is not None and self.processor is not None
        pixels = preprocess(image, self.processor)
        started = time.perf_counter()
        embedding = self._vision.run(None, {"pixel_values": pixels})[0][0]
        elapsed = time.perf_counter() - started
        norm = float(np.linalg.norm(embedding))
        if norm == 0:
            raise RuntimeError("The image embedding has no magnitude.")
        cosine = (embedding / norm) @ self._text_matrix.T
        scores = {label: float(cosine[index]) for index, (label, _prompt) in enumerate(PROMPTS)}
        ranked = rank_similarities(scores)
        ranked["seconds"] = elapsed
        ranked["scores"] = scores
        return ranked

    def score_image_prompts(self, image: Image.Image, prompts: tuple[tuple[str, str], ...]) -> dict:
        if self._vision is None or self.tokenizer is None or self.processor is None or self._text is None:
            self.load()
        assert self._vision is not None and self.tokenizer is not None and self.processor is not None and self._text is not None
        rows = []
        for _label, text in prompts:
            embedding = self._text.run(None, {"input_ids": self.tokenizer.input_ids(text)})[0][0]
            rows.append(embedding)
        matrix = np.stack(rows).astype(np.float32)
        matrix = matrix / np.linalg.norm(matrix, axis=1, keepdims=True)
        embedding = self._vision.run(None, {"pixel_values": preprocess(image, self.processor)})[0][0]
        norm = float(np.linalg.norm(embedding))
        if norm == 0:
            raise RuntimeError("The image embedding has no magnitude.")
        cosine = (embedding / norm) @ matrix.T
        scores = {label: float(cosine[index]) for index, (label, _text) in enumerate(prompts)}
        ranked = rank_similarities(scores)
        ranked["scores"] = scores
        return ranked


def refuse_non_image(value: object) -> str | None:
    if isinstance(value, (bytes, bytearray)):
        return None
    if isinstance(value, Image.Image):
        return None
    if isinstance(value, dict):
        blocked = {"frame", "frames", "landmarks", "measurements", "stream", "pixels", "camera", "url", "path"}
        if blocked.intersection(value):
            return REFUSAL
        if "bytes" in value and isinstance(value["bytes"], (bytes, bytearray)) and set(value) == {"bytes"}:
            return None
    return REFUSAL


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prompts_for(template: str) -> tuple[tuple[str, str], ...]:
    if template not in FROZEN_TEMPLATES:
        raise ValueError("That template is not in the frozen set.")
    return tuple((label, template.replace("{label}", label)) for label in VISUAL_LABELS)


def templates_to_run() -> tuple[str, ...]:
    """The two templates that were not part of the historical five-way run."""
    return FROZEN_TEMPLATES[1:]


def verify_assets(model_dir: Path) -> None:
    root = Path(model_dir)
    for relative, expected in ASSET_SHA256.items():
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(f"Missing {relative}. This probe does not download it.")
        actual = file_sha256(path)
        if actual != expected:
            raise RuntimeError(f"Checksum mismatch for {relative}.")


def run_frozen_smoke(catalog_dir: Path, model_dir: Path = DEFAULT_MODEL_DIR) -> list[dict[str, object]]:
    verify_assets(model_dir)
    probe = ClipProbe(model_dir)
    probe.load()
    rows: list[dict[str, object]] = []
    for template in templates_to_run():
        prompts = prompts_for(template)
        for product_id, catalogue_category, filename in CUTOUTS:
            with Image.open(catalog_dir / filename) as image:
                ranked = probe.score_image_prompts(image, prompts)
            rows.append({
                "catalogueId": product_id,
                "catalogueCategory": catalogue_category,
                "filename": filename,
                "template": template,
                "top": ranked["top"],
                "topScore": ranked["topScore"],
                "runnerUp": ranked["runnerUp"],
                "runnerUpScore": ranked["runnerUpScore"],
                "margin": ranked["gap"],
                "calibrated": False,
            })
    return rows
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
