#!/usr/bin/env python3
"""Read the synthetic cut-out row. Do not train and do not download weights."""
import json
import os
import sys
from pathlib import Path

SAMPLE = Path(__file__).resolve().parents[1] / "synthetic" / "product-cutout.jsonl"


def main() -> int:
    loaded = [json.loads(line) for line in SAMPLE.read_text().splitlines() if line.strip()]
    print(f"synthetic cut-out rows readable: {len(loaded)}")
    print("category guess on the fixture is low confidence. It is not a classifier.")
    if os.environ.get("ISIBUKO_APPROVE_GPU_RUN") != "1":
        print("refused: ISIBUKO_APPROVE_GPU_RUN is not set. No fine-tune and no download.")
        return 0
    print("refused: the cut-out stub has no fine-tune loop.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
