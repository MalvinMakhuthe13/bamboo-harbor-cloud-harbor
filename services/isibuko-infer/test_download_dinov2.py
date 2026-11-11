"""Download-only checks. No network and no training."""

import hashlib
import unittest
from pathlib import Path

from download_dinov2 import (
    ALLOWLIST,
    LICENCE,
    REPO_ID,
    REVISION,
    file_url,
    main,
    run_download,
    select_files,
)

BODY = b"abcd"
SPEC = {
    "config.json": {"size": len(BODY), "sha256": hashlib.sha256(BODY).hexdigest()},
    "preprocessor_config.json": {"size": len(BODY), "sha256": hashlib.sha256(BODY).hexdigest()},
    "model.safetensors": {"size": len(BODY), "sha256": hashlib.sha256(BODY).hexdigest()},
}


def identity(licence=LICENCE, sha=REVISION):
    return {"modelId": REPO_ID, "author": "facebook", "sha": sha, "cardData": {"license": licence}}


def tree():
    entries = []
    for name, spec in SPEC.items():
        entry = {"path": name, "size": spec["size"]}
        if name == "model.safetensors":
            entry["lfs"] = {"oid": spec["sha256"], "size": spec["size"]}
        entries.append(entry)
    return entries


def fetch_json(url, payload=None):
    def inner(requested):
        if payload is not None and requested == url:
            return payload
        if requested.endswith(REVISION):
            return tree()
        return identity()
    return inner


def full_stream(url, headers):
    del url, headers
    return 200, {}, BODY


class DownloadOnlyTests(unittest.TestCase):
    def test_allowlist_is_the_official_three_files(self):
        self.assertEqual(set(ALLOWLIST), {"config.json", "preprocessor_config.json", "model.safetensors"})
        self.assertEqual(ALLOWLIST["config.json"]["size"], 547)
        self.assertEqual(ALLOWLIST["preprocessor_config.json"]["size"], 436)
        self.assertEqual(ALLOWLIST["model.safetensors"]["size"], 88249960)
        self.assertEqual(ALLOWLIST["model.safetensors"]["sha256"], "ae1e99fcefd534ed978cdeb8326f08030c96e28b7a81ffcbc98a857c84d14be1")
        self.assertNotIn("pytorch_model.bin", ALLOWLIST)
        with self.assertRaises(RuntimeError):
            select_files(["pytorch_model.bin"])
        with self.assertRaises(RuntimeError):
            file_url("pytorch_model.bin")
        source = Path(__file__).with_name("download_dinov2.py").read_text(encoding="utf-8")
        self.assertNotIn("run_experiment", source)
        self.assertNotIn("GarmentHead", source)
        self.assertNotIn("fit_splits", source)
        self.assertNotIn("huggingface_hub", source)
        self.assertNotIn("transformers", source)

    def test_verified_download_does_not_train(self):
        dest = Path(self._tmp())
        seen = []

        def open_stream(url, headers):
            seen.append(url)
            self.assertIn("/facebook/dinov2-small/resolve/", url)
            self.assertTrue(url.endswith(("config.json", "preprocessor_config.json", "model.safetensors")))
            return full_stream(url, headers)

        report = run_download(dest, fetch_json(""), open_stream, specs=SPEC)
        self.assertEqual(len(seen), 3)
        self.assertTrue(report["verified"])
        self.assertFalse(report["trained"])
        self.assertFalse(report["learned"])
        self.assertFalse(report["readyForLive"])
        self.assertFalse(report["predictionHeadFitted"])
        self.assertEqual(report["licence"], "apache-2.0")
        self.assertEqual(report["bytes"], 12)

    def test_sha256_interruption_corruption_and_reuse(self):
        dest = Path(self._tmp())
        state = {"calls": 0}

        def open_stream(url, headers):
            state["calls"] += 1
            if state["calls"] == 1:
                def chunks():
                    yield b"ab"
                    raise ConnectionError("reset")
                return 200, {}, chunks()
            start = int(headers["Range"].split("=")[1].split("-")[0]) if headers.get("Range") else 0
            return (206 if start else 200), {}, BODY[start:]

        with self.assertRaises(RuntimeError) as interrupted:
            run_download(dest, fetch_json(""), open_stream, names=["config.json"], specs=SPEC)
        self.assertIn("Interrupted", str(interrupted.exception))
        self.assertEqual((dest / "config.json.partial").read_bytes(), b"ab")
        report = run_download(dest, fetch_json(""), open_stream, names=["config.json"], specs=SPEC)
        self.assertEqual(report["files"][0]["status"], "downloaded")
        self.assertEqual((dest / "config.json").read_bytes(), BODY)

        (dest / "config.json").write_bytes(b"zzzz")
        replaced = run_download(dest, fetch_json(""), open_stream, names=["config.json"], specs=SPEC)
        self.assertEqual(replaced["files"][0]["status"], "downloaded")
        self.assertEqual((dest / "config.json").read_bytes(), BODY)
        self.assertTrue((dest / "config.json.corrupt").exists())

        def explode(url, headers):
            raise AssertionError("valid weights were downloaded again")

        reused = run_download(dest, fetch_json(""), explode, names=["config.json"], specs=SPEC)
        self.assertEqual(reused["files"][0]["status"], "reused")
        self.assertEqual((dest / "config.json").read_bytes(), BODY)

        def wrong(url, headers):
            del url, headers
            return 200, {}, b"zzzz"

        fresh = Path(self._tmp())
        with self.assertRaises(RuntimeError) as corrupt:
            run_download(fresh, fetch_json(""), wrong, names=["config.json"], specs=SPEC)
        self.assertIn("Corrupted", str(corrupt.exception))
        self.assertFalse((fresh / "config.json").exists())

    def test_network_failure_and_unapproved_files(self):
        dest = Path(self._tmp())

        def fail(url):
            raise TimeoutError(f"offline {url}")

        with self.assertRaises(RuntimeError) as caught:
            run_download(dest, fail, full_stream, specs=SPEC)
        self.assertIn("Network failure", str(caught.exception))
        self.assertFalse((dest / "model.safetensors").exists())

        def bad_identity(url):
            if url.endswith(REVISION):
                return tree()
            return identity(licence="cc-by-nc-sa-4.0")

        with self.assertRaises(RuntimeError) as licence:
            run_download(dest, bad_identity, full_stream, specs=SPEC)
        self.assertIn("apache-2.0", str(licence.exception))
        with self.assertRaises(RuntimeError):
            run_download(dest, fetch_json(""), full_stream, names=["README.md"], specs=SPEC)
        self.assertEqual(main([]), 2)

    def _tmp(self) -> str:
        import tempfile

        return tempfile.mkdtemp()


if __name__ == "__main__":
    unittest.main()
