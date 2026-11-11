"""Install dataset packages into a venv. Never replace the image torch or its numpy and pillow."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PINS = {"numpy": "numpy==2.2.6", "pillow": "pillow==12.3.0"}


def install(venv: Path, run=subprocess.run, probe=None) -> dict:
    venv_python = venv / "bin" / "python"
    created = run(
        [sys.executable, "-m", "venv", str(venv), "--system-site-packages", "--clear"],
        check=False,
        capture_output=True,
        text=True,
    )
    if created.returncode != 0 and not venv_python.exists():
        raise RuntimeError("Could not create the isolated venv. The system environment was not changed.")
    available = probe() if probe is not None else _probe(venv_python, run)
    packages = [PINS[name] for name in ("numpy", "pillow") if not available.get(name)]
    if any(package.startswith("torch") for package in packages):
        raise RuntimeError("Refusing to install torch.")
    if not packages:
        return {"installed": [], "pipCalled": False, "torchUntouched": True, "venv": str(venv)}
    command = [str(venv / "bin" / "pip"), "install", "--no-deps", *packages]
    if command[0] == str(Path(sys.executable).parent / "pip"):
        raise RuntimeError("Refusing to pip install into the system environment.")
    completed = run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError("Isolated install failed. torch was not part of the command.")
    return {"installed": packages, "pipCalled": True, "torchUntouched": True, "venv": str(venv)}


def _probe(python: Path, run) -> dict:
    code = (
        "import json\n"
        "mods={'numpy': True, 'pillow': True}\n"
        "try:\n import numpy\nexcept Exception:\n mods['numpy']=False\n"
        "try:\n import PIL\nexcept Exception:\n mods['pillow']=False\n"
        "print(json.dumps(mods))\n"
    )
    completed = run([str(python), "-c", code], check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        return {"numpy": False, "pillow": False}
    return json.loads(completed.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--venv", required=True)
    args = parser.parse_args(argv)
    report = install(Path(args.venv))
    sys.stdout.write(json.dumps(report) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
