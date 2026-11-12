#!/usr/bin/env python3
"""Read-only hardware and dependency preflight for Isibuko VTON experiments.

This script deliberately does not download weights, install packages, read API
keys, upload images, or start a paid GPU. Run it in an approved Kaggle GPU
notebook before choosing a model experiment.
"""
from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import sys
from pathlib import Path


def gb(value) -> float:
    return round(float(value) / (1024 ** 3), 2)


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def main() -> int:
    report: dict[str, object] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "working_directory": str(Path.cwd()),
        "model_downloads_enabled": False,
        "model_execution_enabled": False,
        "paid_gpu_started": False,
        "modules": {
            name: module_available(name)
            for name in (
                "torch", "transformers", "peft", "qwen_vl_utils",
                "trimesh", "PIL", "cv2", "psutil"
            )
        },
    }

    try:
        import torch  # type: ignore

        report["torch"] = torch.__version__
        report["torch_cuda_build"] = torch.version.cuda
        report["cuda_available"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            free_bytes, total_bytes = torch.cuda.mem_get_info(0)
            report["gpu"] = {
                "name": props.name,
                "compute_capability": list(torch.cuda.get_device_capability(0)),
                "total_vram_gb": gb(total_bytes),
                "free_vram_gb": gb(free_bytes),
                "bf16_supported": bool(torch.cuda.is_bf16_supported()),
                "fp16_supported": tuple(torch.cuda.get_device_capability(0)) >= (5, 3),
            }
        else:
            report["gpu"] = None
    except Exception as exc:  # report diagnostics without crashing preflight
        report["torch_error"] = f"{type(exc).__name__}: {exc}"

    roots = [Path.cwd(), Path("/kaggle/working"), Path("/workspace")]
    disk_report = {}
    for root in roots:
        if root.exists():
            usage = shutil.disk_usage(root)
            disk_report[str(root)] = {
                "free_gb": gb(usage.free),
                "total_gb": gb(usage.total),
            }
    report["disk"] = disk_report

    # Report only whether paths exist; never print credentials or file contents.
    candidate_paths = {
        "design2garmentcode_repo": os.environ.get("D2GC_REPO"),
        "design2garmentcode_lora": os.environ.get("D2GC_LORA_DIR"),
        "qwen2vl_model": os.environ.get("QWEN2VL_MODEL_DIR"),
        "fashn_repo": os.environ.get("FASHN_REPO"),
        "fashn_weights": os.environ.get("FASHN_WEIGHTS_DIR"),
    }
    report["candidate_paths"] = {
        key: {
            "configured": bool(value),
            "exists": bool(value and Path(value).exists()),
        }
        for key, value in candidate_paths.items()
    }

    print(json.dumps(report, indent=2))
    print("\nPreflight only: no model was downloaded or executed.")
    print("Do not install into an existing FUMOCA environment; use an isolated notebook/environment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
