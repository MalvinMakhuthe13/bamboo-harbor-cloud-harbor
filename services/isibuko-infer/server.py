"""Still-image try-on gate.

This service does not paint a composite and call it generation.
If FASHN VTON v1.5 weights or its runtime are absent, the response
says so and image is null.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL_ID = "fashn-vton-1.5"
MODEL_VERSION = "1.5"
REQUIRED_WEIGHT = "model.safetensors"


def weights_dir() -> Path:
    raw = os.environ.get("ISIBUKO_WEIGHTS", "").strip() or "weights"
    return Path(raw)


def inputs_root() -> Path:
    raw = os.environ.get("ISIBUKO_INPUTS", "").strip() or "inputs"
    return Path(raw).resolve()


def assess() -> dict[str, Any]:
    root = weights_dir()
    weight = root / REQUIRED_WEIGHT
    present = weight.is_file() and weight.stat().st_size > 0
    base: dict[str, Any] = {
        "ok": False,
        "generated": False,
        "image": None,
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "weightsPresent": present,
        "runtimeVerified": False,
    }
    if not present:
        base["code"] = "WEIGHTS_MISSING"
        base["message"] = "FASHN VTON v1.5 weights are not installed. No image was generated."
        return base
    if os.environ.get("ISIBUKO_ALLOW_FASHN") != "1":
        base["code"] = "RUNTIME_MISSING"
        base["message"] = "Weights are on disk, but the third-party pipeline is not approved to run. No image was generated."
        return base
    try:
        import fashn_vton  # type: ignore  # noqa: F401
    except Exception as exc:  # noqa: BLE001 — report the missing runtime, do not invent an image
        base["code"] = "RUNTIME_MISSING"
        base["message"] = f"fashn_vton is not importable ({type(exc).__name__}). No image was generated."
        return base
    base["code"] = "BENCHMARK_PAIR_MISSING"
    base["message"] = "The package imports, but no rights-cleared person and garment pair is mounted. Refusing to emit an image."
    return base


def contained(root: Path, relative: str) -> Path:
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        raise ValueError("Input path must stay inside the approved inputs directory.")
    candidate = (root / relative).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Input path escapes the approved inputs directory.")
    return candidate


def generate(person_rel: str, garment_rel: str, category: str) -> dict[str, Any]:
    status = assess()
    if status["code"] != "BENCHMARK_PAIR_MISSING":
        return status
    if category not in {"tops", "bottoms", "one-pieces"}:
        status["code"] = "UNSUPPORTED_CATEGORY"
        status["message"] = "FASHN v1.5 categories are tops, bottoms, and one-pieces. No image was generated."
        return status
    root = inputs_root()
    person = contained(root, person_rel)
    garment = contained(root, garment_rel)
    if not person.is_file() or not garment.is_file():
        status["code"] = "INVALID_INPUT"
        status["message"] = "The person or garment file is not in the approved inputs directory. No image was generated."
        return status
    # Reached only when weights, approval, and the package are all present.
    from fashn_vton import TryOnPipeline  # type: ignore

    pipeline = TryOnPipeline(weights_dir=str(weights_dir()))
    result = pipeline(str(person), str(garment), category=category)
    out_dir = Path(os.environ.get("ISIBUKO_OUTPUTS", "outputs"))
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "tryon.png"
    result.images[0].save(out)
    return {
        "ok": True,
        "generated": True,
        "code": "GENERATED",
        "image": str(out),
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "weightsPresent": True,
        "runtimeVerified": True,
        "message": "A still image was written by fashn_vton. This is not a live video frame.",
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/v1/status":
            self._send(404, {"ok": False, "generated": False, "code": "NOT_FOUND", "image": None, "modelId": MODEL_ID, "weightsPresent": False})
            return
        body = assess()
        self._send(200 if body["ok"] else 409, body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/v1/tryon":
            self._send(404, {"ok": False, "generated": False, "code": "NOT_FOUND", "image": None, "modelId": MODEL_ID, "weightsPresent": False})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode() or "{}")
            body = generate(str(payload.get("person", "")), str(payload.get("garment", "")), str(payload.get("category", "tops")))
        except ValueError as exc:
            body = assess()
            body["code"] = "INVALID_INPUT"
            body["message"] = str(exc)
        self._send(200 if body["ok"] else 409, body)

    def log_message(self, fmt: str, *args: object) -> None:
        return


def experiment_record(code_version: str) -> dict[str, Any]:
    """A reproducible record of this process. No quality scores without an image."""
    status = assess()
    return {
        "id": f"{MODEL_ID}-not-run",
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "codeVersion": code_version,
        "datasetVersion": "none",
        "hardware": "not-run",
        "generated": False,
        "outputPath": None,
        "failureCode": status["code"],
        "metrics": None,
        "conclusion": status["message"],
    }


def main() -> None:
    port = int(os.environ.get("ISIBUKO_INFER_PORT", "8099"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
