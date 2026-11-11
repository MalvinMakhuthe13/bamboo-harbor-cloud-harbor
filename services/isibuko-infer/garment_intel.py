"""Trainable garment-part head.

The catalog photographs are not a training set. The only weights this module can
produce are from a synthetic smoke run, and those weights are not a product model.
No pretrained backbone is loaded.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

CATEGORIES = ("shirt", "jacket", "dress", "pants")
PARTS = ("collar", "sleeve", "hem", "straps", "legs")
MIN_TRAIN = 40
MIN_VAL = 10
CONFIDENCE_MIN = 0.8
RIGHTS_OK = ("isibuko-owned", "commercially-licensed")

BACKBONES = (
    {
        "id": "facebook/dinov2-small",
        "licence": "apache-2.0",
        "checked": "Hugging Face card on 11 November 2026. The card says License: apache-2.0.",
        "downloaded": False,
        "executed": False,
        "featureExtraction": True,
        "patchTokensForParts": True,
        "partDetectionOutOfBox": False,
        "segmentation": False,
        "productIdentity": "A feature vector only. It does not replace a sku or a sha256.",
        "role": "Intended frozen backbone for the part head, once a download is approved. Not loaded.",
    },
    {
        "id": "Marqo/marqo-fashionSigLIP",
        "licence": "apache-2.0",
        "checked": "Hugging Face card on 11 November 2026. The card says License: apache-2.0 and 0.2B parameters. No non-commercial clause was on the card.",
        "downloaded": False,
        "executed": False,
        "featureExtraction": True,
        "patchTokensForParts": False,
        "partDetectionOutOfBox": False,
        "segmentation": False,
        "productIdentity": "A retrieval embedding. Similarity is not garment geometry and is not a hash.",
        "role": "Candidate for product similarity later. Not a part model and not loaded.",
    },
    {
        "id": "google/siglip2-base-patch16-224",
        "licence": "apache-2.0",
        "checked": "Hugging Face card on 11 November 2026. The card says License: apache-2.0. Intended use is zero-shot classification, retrieval, and dense features.",
        "downloaded": False,
        "executed": False,
        "featureExtraction": True,
        "patchTokensForParts": True,
        "partDetectionOutOfBox": False,
        "segmentation": False,
        "productIdentity": "A general visual embedding, not a merchant sku.",
        "role": "Larger than DINOv2-small and not fashion-specific. Not selected and not loaded.",
    },
    {
        "id": "fashn-human-parser",
        "licence": "NVIDIA non-commercial",
        "checked": "Refused in the earlier licence review.",
        "downloaded": False,
        "executed": False,
        "featureExtraction": False,
        "patchTokensForParts": False,
        "partDetectionOutOfBox": False,
        "segmentation": False,
        "productIdentity": "Not a product encoder.",
        "role": "Refused.",
    },
)


def validate_annotation(row: dict) -> list[str]:
    errors: list[str] = []
    for key in ("sampleId", "sku", "assetHash", "category", "licence", "source", "annotator"):
        if not str(row.get(key, "")).strip():
            errors.append(f"{key} is required.")
    if row.get("licence") not in RIGHTS_OK:
        errors.append("Only isibuko-owned or commercially-licensed rows can be trained on.")
    if row.get("category") not in CATEGORIES:
        errors.append("Category is not one of the training labels.")
    if not isinstance(row.get("assetHash"), str) or len(row.get("assetHash", "")) != 64:
        errors.append("assetHash must be the sha256 of the merchant file.")
    confidence = row.get("confidence")
    if not isinstance(confidence, (int, float)) or confidence < CONFIDENCE_MIN:
        errors.append("Annotation confidence is below 0.8.")
    mask = row.get("mask")
    if not isinstance(mask, dict) or int(mask.get("foregroundPixels", 0)) < 16:
        errors.append("A garment segmentation mask is required.")
    parts = row.get("parts")
    if not isinstance(parts, dict) or any(name not in parts for name in PARTS):
        errors.append("Collar, sleeve, hem, straps, and legs must each be annotated.")
    if row.get("split") not in ("train", "val", "test"):
        errors.append("Split must be train, val, or test.")
    if not str(row.get("fabric", "")).strip() or not row.get("colours"):
        errors.append("Fabric metadata and colour names come from the product record.")
    pattern = row.get("pattern", None)
    if pattern is not None and not isinstance(pattern, str):
        errors.append("Pattern is a string or null.")
    return errors


def training_batch_errors(rows: list[dict]) -> list[str]:
    errors: list[str] = []
    seen: dict[str, str] = {}
    eligible = []
    for row in rows:
        errors.extend(f"{row.get('sampleId', '?')}: {item}" for item in validate_annotation(row))
        digest = row.get("assetHash")
        split = row.get("split")
        if isinstance(digest, str) and digest in seen and seen[digest] != split:
            errors.append(f"Asset {digest[:12]} is in more than one split.")
        if isinstance(digest, str) and isinstance(split, str):
            seen[digest] = split
        if not validate_annotation(row):
            eligible.append(row)
    train = [row for row in eligible if row["split"] == "train"]
    val = [row for row in eligible if row["split"] == "val"]
    if len(train) < MIN_TRAIN or len(val) < MIN_VAL:
        errors.append(f"Need at least {MIN_TRAIN} train and {MIN_VAL} val rows. Have {len(train)} and {len(val)}.")
    return errors


def catalog_rows() -> list[dict]:
    """The five photographs. They have no part mask and no training licence, so they stay out."""
    root = Path(__file__).resolve().parents[2] / "public" / "catalog"
    names = (
        "shirt-linen.png",
        "shirt-silk.png",
        "jacket-camel.png",
        "dress-slip.png",
        "pants-charcoal.png",
    )
    rows = []
    for name in names:
        digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
        stem = name.replace(".png", "")
        category = "shirt" if stem.startswith("shirt") else "jacket" if stem.startswith("jacket") else "dress" if stem.startswith("dress") else "pants"
        rows.append(
            {
                "sampleId": name,
                "sku": stem,
                "assetHash": digest,
                "category": category,
                "licence": "unreviewed",
                "source": "catalog-file",
                "annotator": "",
                "confidence": 0,
                "mask": None,
                "parts": None,
                "fabric": "",
                "colours": [],
                "pattern": None,
                "split": "train",
            }
        )
    return rows


def _shift(mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    dy, dx = int(rng.integers(-1, 2)), int(rng.integers(-1, 2))
    return np.roll(np.roll(mask, dy, axis=0), dx, axis=1)


def draw_synthetic(category: str, sku_mark: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A rights-cleared drawing we generated. Not a catalog photograph."""
    mask = np.zeros((24, 16), np.float32)
    if category == "shirt":
        mask[6:20, 4:12] = 1
        mask[4:7, 6:10] = 1
        mask[8:18, 1:4] = 1
        mask[8:18, 12:15] = 1
        parts = np.array([1, 1, 1, 0, 0], np.float32)
    elif category == "jacket":
        mask[5:22, 3:13] = 1
        mask[3:6, 6:10] = 1
        parts = np.array([1, 0, 1, 0, 0], np.float32)
    elif category == "dress":
        mask[3:5, 5:7] = 1
        mask[3:5, 9:11] = 1
        mask[5:22, 5:11] = 1
        parts = np.array([0, 0, 1, 1, 0], np.float32)
    else:
        mask[2:8, 4:12] = 1
        mask[8:22, 4:7] = 1
        mask[8:22, 9:12] = 1
        parts = np.array([0, 0, 1, 0, 1], np.float32)
    if sku_mark:
        mask[2:4, 2:4] = 1
    mask = _shift(mask, rng)
    ys, xs = np.nonzero(mask > 0)
    aspect = (ys.max() - ys.min() + 1) / max(1, xs.max() - xs.min() + 1)
    side = float(mask[:, :3].sum() + mask[:, -3:].sum()) / max(1.0, float(mask.sum()))
    hem = float(ys.max()) / mask.shape[0]
    proportions = np.array([aspect, side, hem], np.float32)
    return mask, parts, proportions


def frozen_projector(width: int = 48, seed: int = 1) -> np.ndarray:
    """Fixed random projection. This is not DINOv2 and it is not trained."""
    rng = np.random.default_rng(seed)
    matrix = rng.normal(0, 1 / np.sqrt(24 * 16), size=(24 * 16, width)).astype(np.float32)
    return matrix


def featurize(masks: np.ndarray, projector: np.ndarray) -> np.ndarray:
    flat = masks.reshape(masks.shape[0], -1)
    return flat @ projector


class GarmentHead:
    """Small head: category, parts, proportions, and an identity vector."""

    def __init__(self, in_dim: int = 48, hidden: int = 32, identity: int = 8, seed: int = 2):
        rng = np.random.default_rng(seed)
        scale = 0.05
        self.w1 = rng.normal(0, scale, size=(in_dim, hidden)).astype(np.float32)
        self.b1 = np.zeros(hidden, np.float32)
        self.w_cat = rng.normal(0, scale, size=(hidden, len(CATEGORIES))).astype(np.float32)
        self.b_cat = np.zeros(len(CATEGORIES), np.float32)
        self.w_part = rng.normal(0, scale, size=(hidden, len(PARTS))).astype(np.float32)
        self.b_part = np.zeros(len(PARTS), np.float32)
        self.w_prop = rng.normal(0, scale, size=(hidden, 3)).astype(np.float32)
        self.b_prop = np.zeros(3, np.float32)
        self.w_id = rng.normal(0, scale, size=(hidden, identity)).astype(np.float32)
        self.b_id = np.zeros(identity, np.float32)

    def parameter_count(self) -> int:
        return int(sum(array.size for array in self._arrays()))

    def _arrays(self) -> list[np.ndarray]:
        return [self.w1, self.b1, self.w_cat, self.b_cat, self.w_part, self.b_part, self.w_prop, self.b_prop, self.w_id, self.b_id]

    def forward(self, features: np.ndarray) -> dict[str, np.ndarray]:
        hidden = np.maximum(0, features @ self.w1 + self.b1)
        return {
            "hidden": hidden,
            "category": hidden @ self.w_cat + self.b_cat,
            "parts": hidden @ self.w_part + self.b_part,
            "proportions": hidden @ self.w_prop + self.b_prop,
            "identity": hidden @ self.w_id + self.b_id,
        }

    def step(self, features: np.ndarray, category: np.ndarray, parts: np.ndarray, proportions: np.ndarray, sku: np.ndarray, lr: float) -> float:
        out = self.forward(features)
        n = features.shape[0]
        scores = out["category"] - out["category"].max(axis=1, keepdims=True)
        exp = np.exp(scores)
        prob = exp / exp.sum(axis=1, keepdims=True)
        target = np.zeros_like(prob)
        target[np.arange(n), category] = 1
        d_cat = (prob - target) / n
        part_prob = 1 / (1 + np.exp(-out["parts"]))
        d_part = (part_prob - parts) / n
        d_prop = np.sign(out["proportions"] - proportions) / n
        identity = out["identity"]
        identity = identity / np.maximum(1e-6, np.linalg.norm(identity, axis=1, keepdims=True))
        d_id = np.zeros_like(identity)
        id_loss = 0.0
        pairs = 0
        for i in range(n):
            for j in range(i + 1, n):
                cosine = float(identity[i] @ identity[j])
                if sku[i] == sku[j]:
                    id_loss += 1 - cosine
                    d_id[i] -= identity[j]
                    d_id[j] -= identity[i]
                else:
                    id_loss += max(0.0, cosine - 0.2)
                    if cosine > 0.2:
                        d_id[i] += identity[j]
                        d_id[j] += identity[i]
                pairs += 1
        if pairs:
            d_id /= pairs
            id_loss /= pairs
        d_id *= 0.05
        hidden = out["hidden"]
        d_hidden = d_cat @ self.w_cat.T + d_part @ self.w_part.T + d_prop @ self.w_prop.T + (d_id @ self.w_id.T) / n
        d_hidden *= hidden > 0
        self.w_cat -= lr * (hidden.T @ d_cat)
        self.b_cat -= lr * d_cat.sum(axis=0)
        self.w_part -= lr * (hidden.T @ d_part)
        self.b_part -= lr * d_part.sum(axis=0)
        self.w_prop -= lr * (hidden.T @ d_prop)
        self.b_prop -= lr * d_prop.sum(axis=0)
        self.w_id -= lr * (hidden.T @ d_id)
        self.b_id -= lr * d_id.sum(axis=0)
        self.w1 -= lr * (features.T @ d_hidden)
        self.b1 -= lr * d_hidden.sum(axis=0)
        ce = float(-(np.log(prob[np.arange(n), category] + 1e-8)).mean())
        return ce + id_loss


def _batch(count: int, seed: int) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    masks, parts, props, cats, skus = [], [], [], [], []
    for index in range(count):
        category = CATEGORIES[index % len(CATEGORIES)]
        mark = (index // len(CATEGORIES)) % 2
        mask, part, prop = draw_synthetic(category, mark, rng)
        masks.append(mask)
        parts.append(part)
        props.append(prop)
        cats.append(CATEGORIES.index(category))
        skus.append(CATEGORIES.index(category) * 2 + mark)
    return {
        "masks": np.stack(masks),
        "parts": np.stack(parts),
        "proportions": np.stack(props),
        "category": np.array(cats, np.int64),
        "sku": np.array(skus, np.int64),
    }


def evaluate(head: GarmentHead, features: np.ndarray, batch: dict[str, np.ndarray]) -> dict[str, float]:
    out = head.forward(features)
    pred = out["category"].argmax(axis=1)
    category_accuracy = float((pred == batch["category"]).mean())
    part_pred = 1 / (1 + np.exp(-out["parts"])) >= 0.5
    part_accuracy = float((part_pred == (batch["parts"] >= 0.5)).mean())
    proportion_mae = float(np.abs(out["proportions"] - batch["proportions"]).mean())
    identity = out["identity"]
    identity = identity / np.maximum(1e-6, np.linalg.norm(identity, axis=1, keepdims=True))
    same, other = [], []
    sku = batch["sku"]
    for i in range(len(sku)):
        for j in range(i + 1, len(sku)):
            cosine = float(identity[i] @ identity[j])
            (same if sku[i] == sku[j] else other).append(cosine)
    return {
        "categoryAccuracy": category_accuracy,
        "partAccuracy": part_accuracy,
        "proportionMae": proportion_mae,
        "sameSkuCosine": float(np.mean(same)) if same else 0.0,
        "otherSkuCosine": float(np.mean(other)) if other else 0.0,
    }


def train_synthetic(steps: int = 160, lr: float = 0.35, seed: int = 3) -> dict:
    """CPU smoke training on drawings we made. Not the catalog and not a live try-on model."""
    projector = frozen_projector()
    train = _batch(64, seed)
    val = _batch(32, seed + 100)
    head = GarmentHead()
    train_x = featurize(train["masks"], projector)
    val_x = featurize(val["masks"], projector)
    before = evaluate(head, val_x, val)
    rng = np.random.default_rng(seed)
    losses = []
    for _ in range(steps):
        pick = rng.choice(train_x.shape[0], size=16, replace=False)
        loss = head.step(train_x[pick], train["category"][pick], train["parts"][pick], train["proportions"][pick], train["sku"][pick], lr)
        losses.append(loss)
    after = evaluate(head, val_x, val)
    train_after = evaluate(head, train_x, train)
    # Memorise noise labels. Validation on fresh noise must stay near chance.
    noise = np.random.default_rng(9)
    noise_x = noise.normal(size=(16, projector.shape[1])).astype(np.float32)
    noise_y = noise.integers(0, len(CATEGORIES), size=16)
    memo = GarmentHead(seed=5)
    for _ in range(40):
        memo.step(noise_x, noise_y, np.zeros((16, len(PARTS)), np.float32), np.zeros((16, 3), np.float32), noise_y, 0.5)
    fresh_x = noise.normal(size=(32, projector.shape[1])).astype(np.float32)
    fresh_y = noise.integers(0, len(CATEGORIES), size=32)
    memo_train = float((memo.forward(noise_x)["category"].argmax(1) == noise_y).mean())
    memo_val = float((memo.forward(fresh_x)["category"].argmax(1) == fresh_y).mean())
    return {
        "kind": "synthetic-smoke",
        "productModel": False,
        "backbone": "frozen-random-projection",
        "backboneDownloaded": False,
        "catalogImagesUsed": 0,
        "parameters": head.parameter_count(),
        "steps": steps,
        "lossStart": losses[0],
        "lossEnd": losses[-1],
        "before": before,
        "val": after,
        "train": train_after,
        "overfitTrainAccuracy": memo_train,
        "overfitValAccuracy": memo_val,
        "readyForLive": False,
        "head": head,
    }


INTENDED = {
    "backbone": "facebook/dinov2-small",
    "backboneLoaded": False,
    "headInput": 384,
    "headHidden": 128,
    "headParameters": 384 * 128 + 128 + 128 * 4 + 4 + 128 * 5 + 5 + 128 * 3 + 3 + 128 * 16 + 16,
    "losses": (
        "softmax cross-entropy on category",
        "binary cross-entropy on collar, sleeve, hem, straps, and legs",
        "L1 on proportions",
        "sku contrastive loss that cannot override the sha256",
    ),
    "minimumTrain": MIN_TRAIN,
    "minimumVal": MIN_VAL,
    "status": "not-trained",
    "gpu": "Not measured. The frozen backbone is the part that wants a GPU. The head is small enough to train on CPU after features exist.",
}


def live_slot(asset_hash: str) -> dict:
    """What the live engine would consume later. Nothing here is generated video."""
    return {
        "assetHash": asset_hash,
        "hashRemainsAuthoritative": True,
        "category": None,
        "parts": None,
        "identity": None,
        "readyForLive": False,
        "reason": "No rights-cleared product annotations have been trained. The synthetic smoke run does not condition the camera.",
    }
