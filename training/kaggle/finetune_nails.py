#!/usr/bin/env python3
"""Read the synthetic nail rows. Do not train and do not download weights."""
import json
import os
import sys
from pathlib import Path

SAMPLE = Path(__file__).resolve().parents[1] / "synthetic" / "nails.jsonl"


def main() -> int:
    loaded = [json.loads(line) for line in SAMPLE.read_text().splitlines() if line.strip()]
    sites = sorted({row.get("site") for row in loaded})
    print(f"synthetic nail rows readable: {len(loaded)} sites {sites}")
    print("Toe rows label the foot-index only. They are not a toe segmenter.")
    if os.environ.get("ISIBUKO_APPROVE_GPU_RUN") != "1":
        print("refused: ISIBUKO_APPROVE_GPU_RUN is not set. No fine-tune and no download.")
        return 0
    print("refused: the nail stub has no fine-tune loop.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
