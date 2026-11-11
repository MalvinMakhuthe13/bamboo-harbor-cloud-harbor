"""Frozen DINOv2-small features plus a small prediction head.

This is not a generative try-on model, not a pixel segmentation model,
not a live-video model, and not a garment deformation model.
readyForLive stays false. The synthetic drawing run is a different experiment.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from dataset_gate import load_manifest
from garment_intel import INTENDED, MIN_TRAIN, MIN_VAL
from gpu_probe import probe_gpu

WEIGHT_BYTES_ARITHMETIC = 22_100_000 * 4
DOWNSTREAM = (
    "Body and pose perception already produced by the mirror.",
    "Garment-to-body deformation. Not trained.",
    "Arm and hand occlusion.",
    "The sku and the sha256 stay authoritative over any embedding.",
    "Temporal consistency across frames. No generated frames exist.",
    "Streaming generation. No video model is attached.",
)


def expected_resources() -> dict:
    head = INTENDED["headParameters"]
    return {
        "backbone": "facebook/dinov2-small",
        "backboneLicence": "apache-2.0",
        "backboneLoaded": False,
        "weightBytesArithmetic": WEIGHT_BYTES_ARITHMETIC,
        "weightBytesMeasured": False,
        "headParameters": head,
        "headCheckpointBytes": head * 4,
        "optimizerStateBytes": head * 8,
        "vramArithmeticMeasured": False,
        "expectedKaggleGpu": "First preflight measured a Tesla T4 with 14911 MB, PyTorch 2.11.0+cu130, CUDA 13.0. This process has not repeated that measurement. The notebook records the live device.",
        "diskNote": "The notebook measures free space. The weight figure is 22.1M parameters times 4 bytes, not a downloaded file size.",
        "trained": False,
        "syntheticSmokeIsThisModel": False,
        "whatThisIs": "A frozen feature extractor plus a small prediction head.",
        "notGenerativeTryOn": True,
        "notPixelSegmentation": True,
        "notLiveVideo": True,
        "notDeformation": True,
        "readyForLive": False,
    }


def gate(manifest_path: Path, env: dict) -> dict:
    rows = load_manifest(manifest_path)
    train = sum(1 for row in rows if row.get("split") == "train" and row.get("admitted") is True)
    val = sum(1 for row in rows if row.get("split") == "val" and row.get("admitted") is True)
    gpu = probe_gpu()
    reasons = []
    if train < MIN_TRAIN or val < MIN_VAL:
        reasons.append(f"Admitted set has {train} train and {val} val rows. Need {MIN_TRAIN} and {MIN_VAL}. The catalog is not admitted.")
    for row in rows:
        if row.get("recordKind") == "synthetic-fixture":
            reasons.append(f"{row.get('sampleId', '?')} is a synthetic fixture and cannot enter a training run.")
        image = row.get("imagePath")
        if not image or not Path(str(image)).is_file():
            reasons.append(f"{row.get('sampleId', '?')} has no image file on this machine.")
        proportions = row.get("proportions")
        if not isinstance(proportions, list) or len(proportions) != 3:
            reasons.append(f"{row.get('sampleId', '?')} is missing three proportion targets.")
    if env.get("ISIBUKO_APPROVE_DINOV2_DOWNLOAD") != "1":
        reasons.append("DINOv2 download is not approved.")
    if env.get("ISIBUKO_APPROVE_GPU_RUN") != "1":
        reasons.append("GPU execution is not approved.")
    if not gpu["cudaAvailable"]:
        reasons.append(gpu["reason"] or "CUDA is unavailable.")
    return {
        "ok": not reasons,
        "reasons": reasons,
        "willDownload": False,
        "willTrain": False,
        "gpu": gpu,
        "train": train,
        "val": val,
        "downstream": DOWNSTREAM,
        "readyForLive": False,
        "modelClass": "frozen-feature-extractor-plus-prediction-head",
        "notGenerativeTryOn": True,
        "notPixelSegmentation": True,
        "notLiveVideo": True,
        "notDeformation": True,
    }


def download_backbone(dest: Path) -> None:
    from huggingface_hub import hf_hub_download

    dest.mkdir(parents=True, exist_ok=True)
    for filename in ("config.json", "preprocessor_config.json", "model.safetensors"):
        hf_hub_download(repo_id="facebook/dinov2-small", filename=filename, local_dir=str(dest))


def load_feature_images(rows: list[dict], open_image):
    """Open train and validation images only. A test row is never passed to open_image."""
    selected = [row for row in rows if row.get("split") in ("train", "val")]
    if any(row.get("split") == "test" for row in selected):
        raise RuntimeError("Test split reached feature loading.")
    return selected, [open_image(row["imagePath"]) for row in selected]


def extract_patch_features(rows: list[dict], weight_dir: Path, open_image=None):
    from PIL import Image

    def opener(path):
        return Image.open(path).convert("RGB")

    selected, images = load_feature_images(rows, open_image or opener)
    if not selected:
        raise ValueError("No train or validation images to encode. Test images are not loaded.")
    return _encode_images(images, weight_dir)


def _encode_images(images, weight_dir: Path):
    import torch
    from transformers import AutoImageProcessor, AutoModel

    processor = AutoImageProcessor.from_pretrained(weight_dir)
    model = AutoModel.from_pretrained(weight_dir)
    model.eval()
    model.to("cuda")
    encoded = []
    for image in images:
        batch = processor(images=image, return_tensors="pt")
        batch = {key: value.to("cuda") for key, value in batch.items()}
        with torch.no_grad():
            tokens = model(**batch).last_hidden_state
        encoded.append(tokens[:, 1:, :].mean(dim=1).squeeze(0).detach().cpu().numpy())
    return np.stack(encoded)


def fit_splits(features: np.ndarray, rows: list[dict], step, steps: int = 200, seed: int = 4) -> dict:
    """Train only on train rows. Validation is not sampled. The test split is not touched."""
    train = [index for index, row in enumerate(rows) if row.get("split") == "train"]
    val = [index for index, row in enumerate(rows) if row.get("split") == "val"]
    held = [index for index, row in enumerate(rows) if row.get("split") == "test"]
    if not train:
        raise ValueError("No train rows.")
    sku_map: dict[str, int] = {}
    for index in train:
        sku_map.setdefault(rows[index]["sku"], len(sku_map))
    from garment_intel import CATEGORIES, PARTS

    def arrays(indices: list[int]):
        category = np.array([CATEGORIES.index(rows[index]["category"]) for index in indices], np.int64)
        parts = np.array([[1.0 if rows[index]["parts"][name]["present"] else 0.0 for name in PARTS] for index in indices], np.float32)
        proportions = np.array([rows[index]["proportions"] for index in indices], np.float32)
        sku = np.array([sku_map.get(rows[index]["sku"], -1) for index in indices], np.int64)
        return category, parts, proportions, sku

    rng = np.random.default_rng(seed)
    train_index = np.array(train)
    for _ in range(steps):
        pick = rng.choice(train_index, size=min(16, len(train_index)), replace=False)
        picked = [int(index) for index in pick]
        category, parts, proportions, sku = arrays(picked)
        step(picked, features[pick], category, parts, proportions, sku)
    return {
        "trainCount": len(train),
        "valCount": len(val),
        "testCount": len(held),
        "trainIndex": train,
        "valIndex": val,
        "testIndex": held,
        "skuMap": sku_map,
        "valLabels": arrays(val) if val else None,
    }


def run_experiment(manifest_path: Path, env: dict | None = None) -> dict:
    """Refuse unless data, both approvals, and a measured GPU are present. A refusal does not download."""
    env = env or {}
    decision = gate(manifest_path, env)
    if not decision["ok"]:
        return {"started": False, "downloaded": False, "trained": False, **decision}
    if not env.get("ISIBUKO_WEIGHTS") or not env.get("ISIBUKO_CHECKPOINT"):
        return {
            "started": False,
            "downloaded": False,
            "trained": False,
            "reasons": ["ISIBUKO_WEIGHTS and ISIBUKO_CHECKPOINT must both be set."],
            **decision,
        }
    missing = []
    for name in ("huggingface_hub", "torch", "transformers"):
        try:
            __import__(name)
        except Exception:
            missing.append(name)
    if missing:
        return {
            "started": False,
            "downloaded": False,
            "trained": False,
            "reasons": [f"Install {', '.join(missing)} on the GPU session before the approved run. Nothing was downloaded."],
            **decision,
        }
    weights = Path(env["ISIBUKO_WEIGHTS"])
    download_backbone(weights)
    rows = load_manifest(manifest_path)
    features = extract_patch_features(rows, weights)
    batch = [row for row in rows if row.get("split") in ("train", "val")]
    from garment_intel import GarmentHead, evaluate

    head = GarmentHead(in_dim=features.shape[1], hidden=128, identity=16, seed=4)

    def step(indices, feats, category, parts, proportions, sku):
        del indices
        head.step(feats, category, parts, proportions, sku, 0.05)

    summary = fit_splits(features, batch, step)
    val = np.array(summary["valIndex"])
    category, parts, proportions, sku = summary["valLabels"]
    metrics = evaluate(head, features[val], {"category": category, "parts": parts, "proportions": proportions, "sku": sku})
    checkpoint = Path(env["ISIBUKO_CHECKPOINT"])
    save_trained_checkpoint(checkpoint, head, {**metrics, "rows": summary["valCount"]})
    return {
        **decision,
        "started": True,
        "downloaded": True,
        "trained": True,
        "willDownload": True,
        "willTrain": True,
        "metrics": metrics,
        "trainCount": summary["trainCount"],
        "valCount": summary["valCount"],
        "testCount": sum(1 for row in rows if row.get("split") == "test"),
        "testImagesLoaded": False,
        "checkpoint": checkpoint.name,
        "readyForLive": False,
    }


def save_trained_checkpoint(path: Path, head, metrics: dict) -> None:
    if not isinstance(metrics.get("categoryAccuracy"), float):
        raise ValueError("A trained checkpoint needs a measured validation accuracy.")
    metadata = {
        "trained": True,
        "kind": "dinov2-small-head",
        "syntheticSmoke": False,
        "valCategoryAccuracy": metrics["categoryAccuracy"],
        "readyForLive": False,
    }
    payload = {name: array for name, array in zip(("w1", "b1", "w_cat", "b_cat", "w_part", "b_part", "w_prop", "b_prop", "w_id", "b_id"), head._arrays(), strict=True)}
    payload["metadata"] = np.array(json.dumps(metadata))
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **payload)


def save_checkpoint(path: Path, arrays: dict[str, np.ndarray], metadata: dict) -> None:
    if metadata.get("trained") is not False:
        raise ValueError("This preparer can only save an untrained checkpoint.")
    if metadata.get("kind") != "untrained-init":
        raise ValueError("Checkpoint kind must be untrained-init.")
    payload = dict(arrays)
    payload["metadata"] = np.array(json.dumps(metadata))
    np.savez_compressed(path, **payload)


def load_checkpoint(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Checkpoint is missing: {path.name}")
    with np.load(path, allow_pickle=False) as handle:
        if "metadata" not in handle or "w1" not in handle:
            raise ValueError("Checkpoint is incomplete.")
        metadata = json.loads(str(handle["metadata"]))
        weights = {key: handle[key].copy() for key in handle.files if key != "metadata"}
    if metadata.get("trained") is True and not isinstance(metadata.get("valCategoryAccuracy"), float):
        raise ValueError("Refusing a checkpoint that claims training without a validation score.")
    if metadata.get("trained") not in (True, False):
        raise ValueError("Checkpoint training flag is missing.")
    return {"metadata": metadata, "weights": weights}


if __name__ == "__main__":
    import os
    import sys

    manifest = Path(os.environ.get("ISIBUKO_MANIFEST", "datasets/garments.jsonl"))
    result = run_experiment(manifest, dict(os.environ))
    sys.stdout.write(json.dumps(result, indent=2) + "\n")
    raise SystemExit(0 if result["started"] else 2)

