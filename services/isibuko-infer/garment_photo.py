"""Handcrafted measurements of a real product photograph.

This is not a neural encoder. It does not name a material from pixels and it does not paint a person.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from PIL import Image

TRAINING = {
    "garmentPartHead": {
        "status": "not-trained",
        "data": "Product photographs plus part labels owned by Isibuko or under a commercial licence. Research-only try-on sets stay out.",
        "gpu": "A frozen DINOv2-small backbone is apache-2.0 and was not downloaded. Training a head on it is not approved and would still not be virtual try-on.",
    },
    "productIdentity": {
        "status": "not-trained",
        "data": "The sku and the sha256 of the merchant file. No embedding has been fit.",
        "gpu": "Not required for the hash. An embedding would be a later approved run.",
    },
    "bodyDeformation": {
        "status": "not-trained",
        "data": "Paired frames of the same person and the same sku, with a commercial right to train. Landmark correspondence is not this dataset.",
        "gpu": "Required before any learned warp is claimed.",
    },
    "temporalAppearance": {
        "status": "not-trained",
        "data": "Video of a worn garment with a stable sku. No such clips are in this repo.",
        "gpu": "Required. A text-to-video model is not a substitute.",
    },
}


def _runs(row: np.ndarray, minimum: int) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    start = None
    for x, value in enumerate(row):
        if value and start is None:
            start = x
        elif not value and start is not None:
            if x - start >= minimum:
                found.append((start, x - 1))
            start = None
    if start is not None and len(row) - start >= minimum:
        found.append((start, len(row) - 1))
    return found


def measure_photo(path: Path, sku: str, material: str, colours: list[str]) -> dict:
    """Read one merchant file. `material` and `colours` come from the product record, not from the pixels."""
    raw = path.read_bytes()
    asset_hash = hashlib.sha256(raw).hexdigest()
    image = np.asarray(Image.open(path).convert("RGBA"))
    foreground = image[:, :, 3] > 16
    if int(foreground.sum()) < 100:
        raise ValueError(f"{path.name} has no garment pixels")
    ys, xs = np.nonzero(foreground)
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    span = max(1, y1 - y0)

    def at(frac: float) -> int:
        return y0 + int(span * frac)

    top = _runs(foreground[at(0.08)], 8)
    top_width = sum(b - a + 1 for a, b in top)
    mid_width = int(foreground[at(0.45)].sum())
    straps = len(top) == 2 and all(b - a < 50 for a, b in top)
    collar = (not straps) and len(top) == 1 and top_width < 0.75 * max(1, mid_width)

    sleeve_rows = 0
    side_widths: list[int] = []
    for frac in np.linspace(0.62, 0.95, 12):
        parts = _runs(foreground[at(float(frac))], 20)
        if len(parts) == 3 and (parts[1][1] - parts[1][0]) > (parts[0][1] - parts[0][0]) and (parts[1][1] - parts[1][0]) > (parts[2][1] - parts[2][0]):
            sleeve_rows += 1
            side_widths.extend((parts[0][1] - parts[0][0] + 1, parts[2][1] - parts[2][0] + 1))
    sleeves_separated = sleeve_rows >= 3

    leg_rows = 0
    for frac in np.linspace(0.4, 0.92, 14):
        parts = _runs(foreground[at(float(frac))], 30)
        if len(parts) == 2 and abs((parts[0][1] - parts[0][0]) - (parts[1][1] - parts[1][0])) < 40:
            leg_rows += 1
    legs_separated = leg_rows >= 8 and not sleeves_separated

    cloth = image[:, :, :3][foreground].astype(np.float32)
    median = np.median(cloth, axis=0)
    luminance = image[:, :, :3].astype(np.float32).mean(axis=2)
    gradient = np.abs(np.diff(luminance, axis=1))
    inside = foreground[:, 1:] & foreground[:, :-1]
    texture = float(gradient[inside].mean()) if inside.any() else 0.0
    # Boundary: a garment pixel with a non-garment 4-neighbour.
    padded = np.pad(foreground, 1, constant_values=False)
    boundary = foreground & (
        ~padded[:-2, 1:-1] | ~padded[2:, 1:-1] | ~padded[1:-1, :-2] | ~padded[1:-1, 2:]
    )
    height, width = foreground.shape
    return {
        "sku": sku,
        "assetHash": asset_hash,
        "file": path.name,
        "learned": False,
        "method": "handcrafted-photograph",
        "modelExecuted": None,
        "deformation": "not-trained",
        "pixels": int(foreground.sum()),
        "boundaryPixels": int(boundary.sum()),
        "geometry": {
            "bounds": [x0, y0, x1, y1],
            "aspect": round((y1 - y0) / max(1, x1 - x0), 3),
            "collar": collar,
            "straps": straps,
            "sleevesSeparated": sleeves_separated,
            "legsSeparated": legs_separated,
            "sideWidthPx": None if not side_widths else round(float(np.median(side_widths)), 1),
            "hemY": int(ys.max()),
            "topWidthOverMid": round(top_width / max(1, mid_width), 3),
        },
        "appearance": {
            "medianRgb": [round(float(channel), 1) for channel in median],
            "chroma": round(float(median.max() - median.min()), 1),
            "textureEnergy": round(texture, 2),
            "pattern": None,
            "logo": None,
        },
        "product": {
            "materialFromRecord": material,
            "coloursFromRecord": list(colours),
            "normalized": True,
            "origin": [round(x0 / width, 4), round(y0 / height, 4)],
            "size": [round((x1 - x0) / width, 4), round((y1 - y0) / height, 4)],
        },
    }
