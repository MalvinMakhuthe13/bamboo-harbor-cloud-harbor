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

from isolated_runner import inspect_checkout, run_flatlay
from parser_adapter import plan_parser

MODEL_ID = "fashn-vton-1.5"
MODEL_VERSION = "1.5"
REQUIRED_WEIGHT = "model.safetensors"
POSE_FILES = ("dwpose/yolox_l.onnx", "dwpose/dw-ll_ucoco_384.onnx")


def weights_dir() -> Path:
    raw = os.environ.get("ISIBUKO_WEIGHTS", "").strip() or "weights"
    return Path(raw)


def inputs_root() -> Path:
    raw = os.environ.get("ISIBUKO_INPUTS", "").strip() or "inputs"
    return Path(raw).resolve()


def checkout_dir() -> Path:
    raw = os.environ.get("ISIBUKO_FASHN_SRC", "").strip()
    return Path(raw) if raw else Path("third_party/fashn-vton-1.5")


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
        "recommendedRoute": plan_parser("none", True, "flat-lay"),
    }
    if not present:
        base["code"] = "WEIGHTS_MISSING"
        base["message"] = "FASHN VTON v1.5 weights are not installed. No image was generated."
        return base
    missing_pose = [rel for rel in POSE_FILES if not (root / rel).is_file() or (root / rel).stat().st_size <= 0]
    if missing_pose:
        base["code"] = "POSE_WEIGHTS_MISSING"
        base["message"] = "DWPose ONNX files are not installed. The human parser was not downloaded. No image was generated."
        return base
    if os.environ.get("ISIBUKO_ALLOW_FASHN") != "1":
        base["code"] = "RUNTIME_MISSING"
        base["message"] = "Weights are on disk, but the third-party pipeline is not approved to run. No image was generated."
        return base
    inspection = inspect_checkout(checkout_dir())
    if not inspection["ok"]:
        base["code"] = inspection["code"]
        base["message"] = inspection["message"]
        return base
    base["code"] = "INFRA_READY"
    base["message"] = "Weights and a parser-free checkout are present. No image has been generated."
    return base


def contained(root: Path, relative: str) -> Path:
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        raise ValueError("Input path must stay inside the approved inputs directory.")
    candidate = (root / relative).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Input path escapes the approved inputs directory.")
    return candidate


def generate(
    person_rel: str,
    garment_rel: str,
    category: str,
    garment_photo_type: str,
    segmentation_free: bool,
    parser_id: str,
) -> dict[str, Any]:
    if category not in {"tops", "bottoms", "one-pieces"}:
        return _refused("UNSUPPORTED_CATEGORY", "FASHN v1.5 categories are tops, bottoms, and one-pieces. No image was generated.")
    if garment_photo_type not in {"flat-lay", "model"} or parser_id.strip() == "":
        return _refused("INVALID_INPUT", "garmentPhotoType (flat-lay or model) and parserId are required. No image was generated.")
    plan = plan_parser(parser_id, segmentation_free, garment_photo_type)
    if not plan["run"]:
        body = _refused(plan["code"], plan["message"])
        body["parserPlan"] = plan
        return body
    status = assess()
    if status["code"] != "INFRA_READY":
        status["parserPlan"] = plan
        return status
    root = inputs_root()
    person = contained(root, person_rel)
    garment = contained(root, garment_rel)
    if not person.is_file() or not garment.is_file():
        return _refused("INVALID_INPUT", "The person or garment file is not in the approved inputs directory. No image was generated.")
    if plan["code"] != "PARSER_SKIPPED":
        return _refused("PARSER_NOT_WIRED", "A cleared masked parser is registered, but only the flat-lay runner is implemented. No image was generated.")
    out = Path(os.environ.get("ISIBUKO_OUTPUTS", "outputs")) / "tryon.png"
    result = run_flatlay(
        checkout=checkout_dir(),
        weights=weights_dir(),
        person=person,
        garment=garment,
        category=category,
        output=out,
    )
    result.setdefault("modelId", MODEL_ID)
    result.setdefault("modelVersion", MODEL_VERSION)
    result.setdefault("weightsPresent", True)
    result["parserPlan"] = plan
    return result


def _refused(code: str, message: str) -> dict[str, Any]:
    present = (weights_dir() / REQUIRED_WEIGHT).is_file()
    return {
        "ok": False,
        "generated": False,
        "image": None,
        "code": code,
        "message": message,
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "weightsPresent": present,
        "runtimeVerified": False,
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
            body = generate(
                str(payload.get("person", "")),
                str(payload.get("garment", "")),
                str(payload.get("category", "tops")),
                str(payload.get("garmentPhotoType", "")),
                payload.get("segmentationFree") is True,
                str(payload.get("parserId", "")),
            )
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
