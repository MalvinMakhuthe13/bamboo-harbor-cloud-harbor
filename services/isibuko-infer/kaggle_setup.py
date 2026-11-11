"""Kaggle checkout and preflight. Secrets are redacted and a missing GPU is an error when required."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from dinov2_experiment import expected_resources
from gpu_probe import probe_gpu

REPO = "https://github.com/MalvinMakhuthe13/bamboo-harbor-cloud-harbor.git"
BRANCH = "ai/isibuko-generative-foundation"


def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret and len(secret) >= 6:
            text = text.replace(secret, "[redacted]")
    return text


def read_git_token(environ: dict | None = None, client=None, load_client=None) -> str:
    """Public clones need no token. A Kaggle secret is used only when one is set."""
    env = os.environ if environ is None else environ
    if env.get("ISIBUKO_GIT_TOKEN"):
        return env["ISIBUKO_GIT_TOKEN"]
    if client is None:
        if load_client is None:
            def load_client():
                from kaggle_secrets import UserSecretsClient

                return UserSecretsClient()
        try:
            client = load_client()
        except Exception:
            return ""
    try:
        value = client.get_secret("ISIBUKO_GIT_TOKEN")
    except Exception:
        return ""
    return value or ""


def clone_plan(token: str, dest: Path) -> dict:
    argv = ["git", "clone", "--branch", BRANCH, "--single-branch", "--depth", "1", REPO, str(dest)]
    if token:
        private = f"https://x-access-token:{token}@github.com/MalvinMakhuthe13/bamboo-harbor-cloud-harbor.git"
        argv = ["git", "clone", "--branch", BRANCH, "--single-branch", "--depth", "1", private, str(dest)]
    return {"argv": argv, "log": f"git clone --branch {BRANCH} --single-branch --depth 1 {REPO} {dest}", "usesCredential": bool(token)}


def _git(run, argv: list[str], token: str) -> str:
    completed = run(argv, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        detail = redact((completed.stdout or "") + (completed.stderr or ""), [token])
        raise RuntimeError(f"Git command failed with status {completed.returncode}. {detail}")
    return (completed.stdout or "").strip()


def prepare_checkout(dest: Path, token: str = "", run=subprocess.run) -> dict:
    """Delete dest and clone the branch into it. The returned log never contains the token."""
    if dest.exists():
        shutil.rmtree(dest)
    plan = clone_plan(token, dest)
    result = run(plan["argv"], check=False, capture_output=True, text=True)
    log = redact((result.stdout or "") + (result.stderr or ""), [token])
    if result.returncode != 0:
        raise RuntimeError(redact(f"Clone failed with status {result.returncode}. {log}", [token]))
    if token:
        _git(run, ["git", "-C", str(dest), "remote", "set-url", "origin", REPO], token)
    commit = _git(run, ["git", "-C", str(dest), "rev-parse", "HEAD"], token)
    branch = _git(run, ["git", "-C", str(dest), "rev-parse", "--abbrev-ref", "HEAD"], token)
    return {"commit": commit, "branch": branch, "log": plan["log"], "remote": REPO}


def build_report(env: dict, roots: list[Path] | None = None, probe=probe_gpu) -> dict:
    token = env.get("ISIBUKO_GIT_TOKEN", "")
    secrets = [token] if token else []
    errors = []
    if env.get("ISIBUKO_REQUIRE_GIT_TOKEN") == "1" and not token:
        errors.append("Git credential is missing. Set ISIBUKO_GIT_TOKEN in a Kaggle secret. The value is not printed.")
    disks = []
    for root in roots or [Path("/")]:
        if root.exists():
            usage = shutil.disk_usage(root)
            disks.append({"path": str(root), "freeBytes": usage.free, "totalBytes": usage.total})
    report = {
        "branch": BRANCH,
        "python": sys.version.split()[0],
        "gpu": probe(),
        "disk": disks,
        "resources": expected_resources(),
        "credentialPresent": bool(token),
        "errors": errors,
        "downloadedWeights": False,
        "trained": False,
    }
    encoded = redact(json.dumps(report), secrets)
    return json.loads(encoded)


def main(argv: list[str] | None = None, probe=probe_gpu, env: dict | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-gpu", action="store_true")
    args = parser.parse_args(argv)
    roots = [Path("/")]
    working = Path("/kaggle/working")
    if working.exists():
        roots.append(working)
    report = build_report(dict(os.environ) if env is None else env, roots, probe=probe)
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    if report["errors"]:
        return 3
    if args.require_gpu and not report["gpu"]["cudaAvailable"]:
        sys.stderr.write(report["gpu"]["reason"] + "\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
