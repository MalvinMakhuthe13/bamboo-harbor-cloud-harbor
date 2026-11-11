"""Frozen DINOv2-small experiment. It does not download or train unless every gate is open.

The synthetic drawing run in garment_intel.py is not this experiment and is not a garment model.
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
        "expectedKaggleGpu": "Unobserved. Free Kaggle sessions often expose a T4 or P100 with 16 GB. The notebook records the actual device.",
        "diskNote": "The notebook measures free space. The weight figure is 22.1M parameters times 4 bytes, not a downloaded file size.",
        "trained": False,
        "syntheticSmokeIsThisModel": False,
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
    }


def download_backbone(dest: Path) -> None:
    from huggingface_hub import hf_hub_download

    dest.mkdir(parents=True, exist_ok=True)
    for filename in ("config.json", "preprocessor_config.json", "model.safetensors"):
        hf_hub_download(repo_id="facebook/dinov2-small", filename=filename, local_dir=str(dest))


def extract_patch_features(image_paths: list[Path], weight_dir: Path):
    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, AutoModel

    processor = AutoImageProcessor.from_pretrained(weight_dir)
    model = AutoModel.from_pretrained(weight_dir)
    model.eval()
    model.to("cuda")
    rows = []
    for path in image_paths:
        image = Image.open(path).convert("RGB")
        batch = processor(images=image, return_tensors="pt")
        batch = {key: value.to("cuda") for key, value in batch.items()}
        with torch.no_grad():
            tokens = model(**batch).last_hidden_state
        rows.append(tokens[:, 1:, :].mean(dim=1).squeeze(0).detach().cpu().numpy())
    return np.stack(rows)


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
    features = extract_patch_features([Path(row["imagePath"]) for row in rows], weights)
    from garment_intel import CATEGORIES, PARTS, GarmentHead, evaluate

    category = np.array([CATEGORIES.index(row["category"]) for row in rows], np.int64)
    parts = np.array([[1.0 if row["parts"][name]["present"] else 0.0 for name in PARTS] for row in rows], np.float32)
    proportions = np.array([row["proportions"] for row in rows], np.float32)
    skus = sorted({row["sku"] for row in rows})
    sku = np.array([skus.index(row["sku"]) for row in rows], np.int64)
    head = GarmentHead(in_dim=features.shape[1], hidden=128, identity=16, seed=4)
    rng = np.random.default_rng(4)
    for _ in range(200):
        pick = rng.choice(features.shape[0], size=min(16, features.shape[0]), replace=False)
        head.step(features[pick], category[pick], parts[pick], proportions[pick], sku[pick], 0.05)
    val_index = np.array([row["split"] == "val" for row in rows])
    metrics = evaluate(head, features[val_index], {"category": category[val_index], "parts": parts[val_index], "proportions": proportions[val_index], "sku": sku[val_index]})
    checkpoint = Path(env["ISIBUKO_CHECKPOINT"])
    save_trained_checkpoint(checkpoint, head, {**metrics, "rows": len(rows)})
    return {**decision, "started": True, "downloaded": True, "trained": True, "willDownload": True, "willTrain": True, "metrics": metrics, "checkpoint": checkpoint.name, "readyForLive": False}


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

