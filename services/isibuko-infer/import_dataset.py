"""Import an annotation ZIP. This does not approve rows, download weights, or train."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dataset_package import import_dataset


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--dest", required=True)
    args = parser.parse_args(argv)
    report = import_dataset(Path(args.zip), Path(args.dest))
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
