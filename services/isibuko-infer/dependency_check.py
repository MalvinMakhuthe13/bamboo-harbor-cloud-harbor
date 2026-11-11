"""Check the current interpreter. This never installs or upgrades a package."""

from __future__ import annotations

import json
import sys

REQUIRED = ("numpy", "PIL", "torch")


def check_dependencies(import_module=None) -> dict:
    importer = import_module or __import__
    missing = []
    versions = {}
    errors = {}
    for name in REQUIRED:
        try:
            module = importer(name)
        except Exception as exc:
            missing.append(name)
            errors[name] = f"{type(exc).__name__}: {exc}"
            continue
        versions[name] = getattr(module, "__version__", "imported")
    torch_info = {
        "imported": "torch" not in missing,
        "cudaAvailable": False,
        "cudaVersion": None,
        "gpuName": None,
        "vramMb": None,
    }
    if torch_info["imported"]:
        module = importer("torch")
        torch_info["cudaVersion"] = getattr(getattr(module, "version", None), "cuda", None)
        cuda = getattr(module, "cuda", None)
        available = bool(callable(getattr(cuda, "is_available", None)) and cuda.is_available())
        torch_info["cudaAvailable"] = available
        if available:
            torch_info["gpuName"] = cuda.get_device_name(0)
            props = cuda.get_device_properties(0)
            torch_info["vramMb"] = int(props.total_memory / (1024 * 1024))
    return {
        "interpreter": sys.executable,
        "missing": missing,
        "versions": versions,
        "errors": errors,
        "torch": torch_info,
        "installed": False,
        "ok": not missing,
    }


def diagnostic(report: dict) -> str:
    if report["ok"]:
        torch_info = report["torch"]
        return (
            f"Interpreter {report['interpreter']}. "
            f"numpy {report['versions'].get('numpy')}, Pillow {report['versions'].get('PIL')}, "
            f"torch {report['versions'].get('torch')}. "
            f"CUDA available: {torch_info['cudaAvailable']}. CUDA version: {torch_info['cudaVersion']}. "
            f"GPU: {torch_info['gpuName']}. VRAM MB: {torch_info['vramMb']}."
        )
    lines = ["Missing dependencies. Nothing was installed."]
    for name in report["missing"]:
        lines.append(f"{name}: {report['errors'].get(name, 'not importable')}")
    lines.append("The notebook will not run pip, ensurepip, or create a virtual environment.")
    return "\n".join(lines)


def main(import_module=None) -> int:
    report = check_dependencies(import_module)
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    sys.stdout.write(diagnostic(report) + "\n")
    if report["ok"]:
        return 0
    sys.stderr.write(diagnostic(report) + "\n")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
