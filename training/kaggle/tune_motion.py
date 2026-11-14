#!/usr/bin/env python3
"""Read the synthetic hair and cloth rows. Do not train and do not download weights."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / "synthetic" / "hair-motion.jsonl", ROOT / "synthetic" / "garment-drape.jsonl"]


def rows(path: Path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main() -> int:
    loaded = []
    for path in FILES:
        loaded.extend(rows(path))
    print(f"synthetic rows readable: {len(loaded)}")
    if os.environ.get("ISIBUKO_APPROVE_GPU_RUN") != "1":
        print("refused: ISIBUKO_APPROVE_GPU_RUN is not set. No training and no download.")
        return 0
    print("refused: the motion stub has no training loop. A later approved change would search spring and damping.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
