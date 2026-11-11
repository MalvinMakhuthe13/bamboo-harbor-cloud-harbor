"""Frozen spatial features. This does not fit a head and does not download weights."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from dinov2_experiment import load_feature_images


def require_spatial(tokens) -> np.ndarray:
    array = np.asarray(tokens)
    if array.ndim != 2 or array.shape[0] < 2:
        raise RuntimeError("Spatial patch tokens are required. A pooled embedding was refused.")
    return array


def local_dinov2_encoder(weight_dir: Path):
    """Load a local facebook/dinov2-small folder. Missing files are not downloaded."""
    missing = [name for name in ("config.json", "preprocessor_config.json", "model.safetensors") if not (weight_dir / name).is_file()]
    if missing:
        raise RuntimeError(f"Local DINOv2 weights are missing: {', '.join(missing)}. Refusing to download.")

    def encode(image):
        import torch
        from transformers import AutoImageProcessor, AutoModel

        processor = AutoImageProcessor.from_pretrained(weight_dir)
        model = AutoModel.from_pretrained(weight_dir)
        model.eval()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(device)
        batch = processor(images=image, return_tensors="pt")
        batch = {key: value.to(device) for key, value in batch.items()}
        with torch.no_grad():
            hidden = model(**batch).last_hidden_state
        return require_spatial(hidden[:, 1:, :].squeeze(0).detach().cpu().numpy())

    return encode


def _load_store(path: Path) -> dict[str, np.ndarray]:
    if not path.exists():
        return {}
    with np.load(path) as handle:
        return {key: handle[key] for key in handle.files}


def _write_meta(path: Path, samples: list[dict], gpu: dict) -> dict:
    report = {
        "samples": samples,
        "sampleCount": len(samples),
        "trainCount": sum(1 for item in samples if item["split"] == "train"),
        "valCount": sum(1 for item in samples if item["split"] == "val"),
        "testCount": 0,
        "testImagesOpened": False,
        "gpu": gpu,
        "trained": False,
        "headFitted": False,
        "learned": False,
        "segmentationLearned": False,
        "readyForLive": False,
    }
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def extract_spatial(rows: list[dict], dest: Path, encode, open_image, gpu_probe=None) -> dict:
    """Encode admitted train and validation rows. Test images are never opened."""
    admitted = [row for row in rows if row.get("admitted") is True]
    selected, _images = load_feature_images(admitted, lambda path: path)
    dest.mkdir(parents=True, exist_ok=True)
    meta_path = dest / "features-meta.json"
    store_path = dest / "tokens.npz"
    done = {}
    if meta_path.exists():
        previous = json.loads(meta_path.read_text(encoding="utf-8"))
        done = {item["sampleId"]: item for item in previous.get("samples", [])}
    arrays = _load_store(store_path)
    gpu = gpu_probe() if gpu_probe else {"measured": False, "reason": "GPU memory was not measured."}
    for row in selected:
        if row["sampleId"] in done:
            continue
        if row.get("split") == "test":
            raise RuntimeError("Test split reached feature extraction.")
        image = open_image(row["imagePath"])
        tokens = require_spatial(encode(image))
        key = "id_" + "".join(character if character.isalnum() else "_" for character in row["sampleId"])
        arrays[key] = tokens
        np.savez_compressed(store_path, **arrays)
        done[row["sampleId"]] = {
            "sampleId": row["sampleId"],
            "sku": row["sku"],
            "assetHash": row["assetHash"],
            "split": row["split"],
            "shape": list(tokens.shape),
            "key": key,
        }
        _write_meta(meta_path, list(done.values()), gpu)
    return _write_meta(meta_path, list(done.values()), gpu)
