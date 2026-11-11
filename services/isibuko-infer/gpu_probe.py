"""GPU detection that refuses to describe a CPU as a GPU."""

from __future__ import annotations


def probe_gpu() -> dict:
    result = {
        "cudaAvailable": False,
        "gpuName": None,
        "vramMb": None,
        "torchVersion": None,
        "cudaVersion": None,
        "measured": False,
        "reason": "",
    }
    try:
        import torch
    except Exception:
        result["reason"] = "PyTorch is not installed. No CPU timing will be reported as GPU performance."
        return result
    result["torchVersion"] = torch.__version__
    result["cudaVersion"] = getattr(torch.version, "cuda", None)
    if not torch.cuda.is_available():
        result["reason"] = "CUDA is unavailable. Refusing a silent CPU fallback."
        return result
    result["cudaAvailable"] = True
    result["measured"] = True
    result["gpuName"] = torch.cuda.get_device_name(0)
    props = torch.cuda.get_device_properties(0)
    result["vramMb"] = int(props.total_memory / (1024 * 1024))
    result["reason"] = ""
    return result
