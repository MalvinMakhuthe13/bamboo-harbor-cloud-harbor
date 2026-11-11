"""Download facebook/dinov2-small only. This does not train or fit a prediction head.

The weights are a frozen public backbone. Downloading them does not mean Isibuko has learned anything.
readyForLive stays false.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

REPO_ID = "facebook/dinov2-small"
REVISION = "ed25f3a31f01632728cabb09d1542f84ab7b0056"
LICENCE = "apache-2.0"
DEFAULT_DEST = Path("/kaggle/working/isibuko-weights/dinov2-small")
ALLOWLIST = {
    "config.json": {
        "size": 547,
        "sha256": "1809f83e3bdb1609a501a610ad4a742f4fd8ae44d72ca4aa0df52d1f2ac8628d",
    },
    "preprocessor_config.json": {
        "size": 436,
        "sha256": "14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828",
    },
    "model.safetensors": {
        "size": 88249960,
        "sha256": "ae1e99fcefd534ed978cdeb8326f08030c96e28b7a81ffcbc98a857c84d14be1",
    },
}


def identity_url() -> str:
    return "https://huggingface.co/api/models/facebook/dinov2-small"


def tree_url() -> str:
    return f"https://huggingface.co/api/models/facebook/dinov2-small/tree/{REVISION}"


def file_url(name: str) -> str:
    if name not in ALLOWLIST:
        raise RuntimeError(f"Unapproved file requested: {name}. Only the three pinned DINOv2-small files are allowed.")
    return f"https://huggingface.co/facebook/dinov2-small/resolve/{REVISION}/{name}"


def select_files(names: list[str] | None) -> list[str]:
    if names is None:
        return list(ALLOWLIST)
    refused = [name for name in names if name not in ALLOWLIST]
    if refused:
        raise RuntimeError(
            "Unapproved file requested: "
            + ", ".join(refused)
            + ". Only config.json, preprocessor_config.json, and model.safetensors are allowed."
        )
    return list(names)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def matches(path: Path, spec: dict) -> bool:
    return path.is_file() and path.stat().st_size == spec["size"] and sha256_file(path) == spec["sha256"]


def verify_identity(payload: dict) -> None:
    if payload.get("modelId") != REPO_ID or payload.get("author") != "facebook":
        raise RuntimeError("Refusing a repository that is not the official facebook/dinov2-small model.")
    licence = (payload.get("cardData") or {}).get("license")
    if licence != LICENCE:
        raise RuntimeError(f"Refusing licence {licence!r}. The pinned metadata is apache-2.0.")
    if payload.get("sha") != REVISION:
        raise RuntimeError("Refusing a revision other than the pinned facebook/dinov2-small commit.")


def verify_tree(entries: list[dict], specs: dict | None = None) -> None:
    chosen = specs or ALLOWLIST
    found = {entry.get("path"): entry for entry in entries}
    for name, spec in chosen.items():
        entry = found.get(name)
        if entry is None:
            raise RuntimeError(f"The official file list is missing {name}.")
        if int(entry.get("size") or -1) != spec["size"]:
            raise RuntimeError(f"The official size of {name} does not match the pinned size.")
        lfs_oid = (entry.get("lfs") or {}).get("oid")
        if name == "model.safetensors" and lfs_oid != spec["sha256"]:
            raise RuntimeError("The official model.safetensors hash does not match the pinned SHA-256.")


def _chunks(body):
    if hasattr(body, "read"):
        while True:
            block = body.read(1024 * 1024)
            if not block:
                break
            yield block
        return
    if isinstance(body, (bytes, bytearray)):
        yield bytes(body)
        return
    yield from body


def _write_partial(partial: Path, url: str, expected_size: int, open_stream) -> None:
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > expected_size:
        partial.unlink()
        offset = 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    try:
        status, _response_headers, body = open_stream(url, headers)
    except Exception as exc:
        raise RuntimeError(f"Network failure downloading {partial.name}. Any partial file was kept. {exc}") from exc
    mode = "ab" if status == 206 and offset else "wb"
    try:
        with partial.open(mode) as handle:
            for block in _chunks(body):
                handle.write(block)
    except Exception as exc:
        raise RuntimeError(f"Interrupted download of {partial.name}. The partial file was kept for recovery. {exc}") from exc


def _place_file(name: str, dest: Path, open_stream, replace_valid: bool, specs: dict) -> dict:
    spec = specs[name]
    target = dest / name
    if target.exists() and matches(target, spec):
        if not replace_valid:
            return {"name": name, "bytes": spec["size"], "sha256": spec["sha256"], "status": "reused", "verified": True}
        target.replace(dest / f"{name}.previous")
    elif target.exists():
        target.replace(dest / f"{name}.corrupt")
    partial = dest / f"{name}.partial"
    if partial.exists() and partial.stat().st_size == spec["size"]:
        if sha256_file(partial) == spec["sha256"]:
            partial.replace(target)
            return {"name": name, "bytes": spec["size"], "sha256": spec["sha256"], "status": "recovered", "verified": True}
        partial.unlink()
    _write_partial(partial, file_url(name), spec["size"], open_stream)
    if not matches(partial, spec):
        raise RuntimeError(f"Corrupted or incomplete download for {name}. It was not accepted.")
    partial.replace(target)
    return {"name": name, "bytes": target.stat().st_size, "sha256": spec["sha256"], "status": "downloaded", "verified": True}


def run_download(dest: Path, fetch_json, open_stream, names: list[str] | None = None, replace_valid: bool = False, specs: dict | None = None) -> dict:
    """Verify the official repository, then download only the allowlisted files. Never trains."""
    chosen = specs or ALLOWLIST
    selected = select_files(names)
    if any(name not in chosen for name in selected):
        raise RuntimeError("Unapproved file requested.")
    try:
        identity = fetch_json(identity_url())
        entries = fetch_json(tree_url())
    except Exception as exc:
        raise RuntimeError(f"Network failure before any weight was accepted. {exc}") from exc
    verify_identity(identity)
    verify_tree(entries, chosen)
    dest.mkdir(parents=True, exist_ok=True)
    files = [_place_file(name, dest, open_stream, replace_valid, chosen) for name in selected]
    report = {
        "repo": REPO_ID,
        "revision": REVISION,
        "licence": LICENCE,
        "destination": str(dest),
        "bytes": sum(item["bytes"] for item in files),
        "files": files,
        "verified": all(item["verified"] for item in files),
        "trained": False,
        "learned": False,
        "readyForLive": False,
        "predictionHeadFitted": False,
    }
    (dest / "download-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def _urlopen_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def _urlopen_stream(url: str, headers: dict):
    request = urllib.request.Request(url, headers=headers)
    response = urllib.request.urlopen(request, timeout=120)
    return getattr(response, "status", 200), dict(response.headers), response


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", default=str(DEFAULT_DEST))
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--replace-valid", action="store_true")
    args = parser.parse_args(argv)
    if not args.download_only:
        sys.stderr.write("Refusing to download without --download-only. This command does not train.\n")
        return 2
    report = run_download(Path(args.dest), _urlopen_json, _urlopen_stream, replace_valid=args.replace_valid)
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    return 0 if report["verified"] and report["trained"] is False else 2


if __name__ == "__main__":
    raise SystemExit(main())
