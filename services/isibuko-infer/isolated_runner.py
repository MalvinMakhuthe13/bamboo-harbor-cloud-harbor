"""Load FASHN's Apache try-on code without importing the human parser.

`import fashn_vton` executes pipeline.py, which imports fashn_human_parser.
This loader inserts a stub package first and only imports the modules the
flat-lay route needs. It does not copy those modules into Isibuko.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path
from typing import Any

FORBIDDEN = (
    "fashn_human_parser",
    "FashnHumanParser",
    "from .pipeline",
    "import pipeline",
    "from .agnostic",
)

REQUIRED = (
    "src/fashn_vton/tryon_mmdit.py",
    "src/fashn_vton/utils/__init__.py",
    "src/fashn_vton/dwpose/__init__.py",
    "src/fashn_vton/preprocessing/transforms.py",
)

SCAN_ROOTS = (
    "src/fashn_vton/utils",
    "src/fashn_vton/dwpose",
)


def inspect_checkout(root: Path) -> dict[str, Any]:
    """Read source text only. Do not import it."""
    missing = [rel for rel in REQUIRED if not (root / rel).is_file()]
    if missing:
        return {
            "ok": False,
            "code": "CHECKOUT_MISSING",
            "message": "The Apache FASHN checkout is incomplete. The parser package was not installed. No image was generated.",
            "missing": missing,
        }
    files = [root / rel for rel in REQUIRED]
    for scan_root in SCAN_ROOTS:
        files.extend((root / scan_root).rglob("*.py"))
    seen: set[Path] = set()
    for path in files:
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in FORBIDDEN:
            if token in text:
                return {
                    "ok": False,
                    "code": "PARSER_IMPORT_IN_STACK",
                    "message": f"{path.name} references {token}. Refusing to import a path that pulls in the NVIDIA parser.",
                }
    return {"ok": True, "code": "CHECKOUT_PRESENT", "message": "Checkout text does not reference the NVIDIA parser. It was not executed."}


def _stub(name: str, path: Path) -> None:
    if name in sys.modules:
        return
    module = types.ModuleType(name)
    module.__path__ = [str(path)]  # type: ignore[attr-defined]
    module.__package__ = name
    sys.modules[name] = module


def load_modules(root: Path) -> dict[str, Any]:
    """Import try-on, pose, and resize helpers. Never import pipeline.py."""
    inspection = inspect_checkout(root)
    if not inspection["ok"]:
        return inspection
    src = root / "src" / "fashn_vton"
    existing = sys.modules.get("fashn_vton")
    if existing is not None and getattr(existing, "__file__", None):
        return {
            "ok": False,
            "code": "RUNTIME_MISSING",
            "message": "fashn_vton was already imported through its stock package. Refusing to continue.",
        }
    _stub("fashn_vton", src)
    _stub("fashn_vton.preprocessing", src / "preprocessing")
    try:
        utils = importlib.import_module("fashn_vton.utils")
        dwpose = importlib.import_module("fashn_vton.dwpose")
        transforms = importlib.import_module("fashn_vton.preprocessing.transforms")
        model_mod = importlib.import_module("fashn_vton.tryon_mmdit")
    except Exception as exc:  # noqa: BLE001 — missing torch or a moved file is a refusal
        return {
            "ok": False,
            "code": "RUNTIME_MISSING",
            "message": f"Isolated import failed ({type(exc).__name__}). No image was generated.",
        }
    if "fashn_human_parser" in sys.modules or "fashn_vton.pipeline" in sys.modules:
        return {
            "ok": False,
            "code": "PARSER_IMPORT_IN_STACK",
            "message": "The isolated import pulled in the parser or TryOnPipeline. No image was generated.",
        }
    return {
        "ok": True,
        "code": "RUNTIME_IMPORTED",
        "utils": utils,
        "dwpose": dwpose,
        "transforms": transforms,
        "TryOnModel": model_mod.TryOnModel,
    }


def run_flatlay(
    *,
    checkout: Path,
    weights: Path,
    person: Path,
    garment: Path,
    category: str,
    output: Path,
) -> dict[str, Any]:
    """Run the published flat-lay, segmentation-free inputs. No parser.

    Returns generated=True only after TryOnModel writes a PNG.
    Tests do not call this. A missing GPU or a failed import is a refusal.
    """
    loaded = load_modules(checkout)
    if not loaded["ok"]:
        loaded["generated"] = False
        loaded["image"] = None
        return loaded
    try:
        import cv2
        import numpy as np
        import torch
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "generated": False,
            "image": None,
            "code": "RUNTIME_MISSING",
            "message": f"Torch or image libraries are not installed ({type(exc).__name__}). No image was generated.",
        }
    if not torch.cuda.is_available():
        return {
            "ok": False,
            "generated": False,
            "image": None,
            "code": "NO_GPU",
            "message": "No CUDA device is visible. The 972M model was not run on CPU.",
        }

    category_ids = {"tops": 1, "bottoms": 2, "one-pieces": 3}
    device = torch.device("cuda")
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
    try:
        model = loaded["TryOnModel"]()
        state = loaded["utils"].load_checkpoint(str(weights / "model.safetensors"), device=str(device))
        model.load_state_dict(state)
        model.to(device, dtype=dtype).eval()
        pose_model = loaded["dwpose"].DWposeDetector(checkpoints_dir=str(weights / "dwpose"), device="cuda:0")
        height, width = model.input_shape
        pre = loaded["transforms"].AspectPreserveResize(
            target_size=(max(height, width), max(height, width)),
            mode="fit",
            backend="pil",
        )
        resize_pad = loaded["transforms"].ResizePad((width, height), backend="opencv")
        person_image = pre(Image.open(person).convert("RGB"), allow_upsampling=False)
        garment_image = pre(Image.open(garment).convert("RGB"), allow_upsampling=False)
        person_np = np.array(person_image)
        garment_np = np.array(garment_image)
        person_pose = pose_model(person_np[..., ::-1])
        garment_pose = loaded["utils"].get_dummy_dw_keypoints()
        person_pose_img = loaded["dwpose"].draw_pose(person_pose, person_np.shape[0], person_np.shape[1], grayscale=True)
        garment_pose_img = loaded["dwpose"].draw_pose(garment_pose, garment_np.shape[0], garment_np.shape[1], grayscale=True)
        ca_image = resize_pad(person_np, mem_padding=True)
        garment_ready = resize_pad(garment_np)
        person_pose_img = resize_pad(person_pose_img, interpolation=cv2.INTER_NEAREST_EXACT)
        garment_pose_img = resize_pad(garment_pose_img, interpolation=cv2.INTER_NEAREST_EXACT)

        def prepare(image: np.ndarray) -> torch.Tensor:
            tensor = loaded["utils"].numpy_to_torch(image).unsqueeze(0)
            tensor = loaded["utils"].normalize_uint8_to_neg1_1(tensor)
            return tensor.to(device=device, dtype=dtype)

        torch.manual_seed(42)
        torch.cuda.manual_seed_all(42)
        noisy = torch.randn((1, model.channels_in, height, width), dtype=dtype, device=device)
        timesteps = loaded["utils"].get_rf_schedule(num_steps=30, mu=1.5)
        model_kwargs = {
            "person_poses": prepare(person_pose_img),
            "garment_poses": prepare(garment_pose_img),
            "ca_images": prepare(ca_image),
            "garment_images": prepare(garment_ready),
            "garment_categories": torch.tensor([category_ids[category]], device=device),
        }
        with torch.inference_mode():
            for step_idx, (t_curr, t_prev) in enumerate(zip(timesteps[:-1], timesteps[1:])):
                dt = t_prev - t_curr
                t_vec = torch.full((1,), t_curr, dtype=dtype, device=device)
                pred = model.forward_for_cfg(noisy, t_vec, **model_kwargs)
                guided = pred["v_c"] if step_idx >= 29 else pred["v_u"] + 1.5 * (pred["v_c"] - pred["v_u"])
                noisy = noisy + dt * guided
        image = loaded["utils"].tensor_to_pil(noisy[0].to(dtype=torch.float).clamp_(-1.0, 1.0), unnormalize=True)
        image = resize_pad.unpad(image)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output)
    except Exception as exc:  # noqa: BLE001 — a failed run must not look like a success
        if output.exists():
            output.unlink()
        return {
            "ok": False,
            "generated": False,
            "image": None,
            "code": "INFERENCE_FAILED",
            "message": f"The isolated runner failed ({type(exc).__name__}). No image was kept.",
        }
    if not output.is_file() or output.stat().st_size <= 0:
        return {
            "ok": False,
            "generated": False,
            "image": None,
            "code": "INFERENCE_FAILED",
            "message": "The runner finished without a PNG. No image was generated.",
        }
    return {
        "ok": True,
        "generated": True,
        "image": str(output),
        "code": "GENERATED",
        "message": "TryOnModel wrote tryon.png without the human parser. This is one still, not a camera frame.",
    }
