"""Offline CLIP category probe.

This scores one product photograph against five fixed text prompts.
The score is a cosine similarity. It is not a probability and it is not stored on a product.
and it is not written to the wardrobe or the merchant review store.
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

# The prompt is the category text itself. No template was added.
PROMPTS: tuple[tuple[str, str], ...] = (
    ("shirt", "shirt"),
    ("jacket", "jacket"),
    ("dress", "dress"),
    ("trousers", "trousers"),
    ("none of these", "none of these"),
)

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
