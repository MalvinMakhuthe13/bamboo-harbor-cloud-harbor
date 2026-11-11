"""Install dataset packages into a venv. Never replace the image torch or use the system pip."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PINS = {"numpy": "numpy==2.2.6", "pillow": "pillow==12.3.0"}


def _venv_python(venv: Path) -> str:
    return str(venv / "bin" / "python")


def _reject_system_pip(venv: Path, argv: list[str]) -> None:
    if not argv or argv[0] != _venv_python(venv):
        raise RuntimeError("Refusing to run pip with anything other than the venv Python.")
    if argv[0] == sys.executable:
        raise RuntimeError("Refusing to use the system pip.")


def pip_module_ready(venv: Path, run) -> bool:
    python = _venv_python(venv)
    _reject_system_pip(venv, [python])
    completed = run([python, "-m", "pip", "--version"], check=False, capture_output=True, text=True)
    return completed.returncode == 0


def ensure_venv_pip(venv: Path, run, ready=None) -> dict:
    """Bootstrap pip inside the venv. A failure stops here and does not touch the system pip."""
    is_ready = ready if ready is not None else (lambda: pip_module_ready(venv, run))
    if is_ready():
        return {"bootstrapped": False}
    command = [_venv_python(venv), "-m", "ensurepip", "--upgrade"]
    _reject_system_pip(venv, command)
    completed = run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0 or not is_ready():
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(
            "pip is missing in the venv and ensurepip failed. The system pip was not used."
            + (f" {detail}" if detail else "")
        )
    return {"bootstrapped": True}


def install(venv: Path, run=subprocess.run, probe=None, pip_ready=None) -> dict:
    python = _venv_python(venv)
    created = run(
        [sys.executable, "-m", "venv", str(venv), "--system-site-packages", "--clear"],
        check=False,
        capture_output=True,
        text=True,
    )
    if created.returncode != 0 and not Path(python).exists():
        raise RuntimeError("Could not create the isolated venv. The system environment was not changed.")
    available = probe() if probe is not None else _probe(Path(python), run)
    packages = [PINS[name] for name in ("numpy", "pillow") if not available.get(name)]
    if any(package.startswith("torch") for package in packages):
        raise RuntimeError("Refusing to install torch.")
    if not packages:
        return {"installed": [], "pipCalled": False, "bootstrapped": False, "torchUntouched": True, "venv": str(venv)}
    pip_state = ensure_venv_pip(venv, run, pip_ready)
    command = [python, "-m", "pip", "install", "--no-deps", *packages]
    _reject_system_pip(venv, command)
    if "torch" in command:
        raise RuntimeError("Refusing to install torch.")
    completed = run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError("Isolated install failed. The system pip was not used and torch was not installed.")
    return {
        "installed": packages,
        "pipCalled": True,
        "bootstrapped": pip_state["bootstrapped"],
        "torchUntouched": True,
        "venv": str(venv),
    }


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
