"""Synthetic intake only. No real photograph or permission is accepted."""

import hashlib
import os
import struct
import tempfile
import threading
import unittest
import zlib
from pathlib import Path

from PIL import Image

import benchmark_intake as intake
import benchmark_manifest as gate


def _png(folder: Path, name: str, size: tuple[int, int] = (4, 4), colour: tuple[int, int, int, int] = (20, 30, 40, 255)) -> Path:
    path = folder / name
    Image.new("RGBA", size, colour).save(path)
    return path


def _root(folder: Path) -> Path:
    root = folder / "storage"
    root.mkdir()
    return root


def _claim_png(width: int, height: int) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    body = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    chunk = b"IHDR" + body
    crc = zlib.crc32(chunk) & 0xFFFFFFFF
    ihdr = struct.pack(">I", 13) + chunk + struct.pack(">I", crc)
    end = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)
    return signature + ihdr + end


class IntakeTests(unittest.TestCase):
    def test_template_matches_the_checker_and_the_example_is_not_permission(self):
        template = intake.manifest_template()
        for field in gate.FIELDS:
            self.assertIn(field, template)
        self.assertFalse(template["admitted"])
        self.assertFalse(template["approved"])
        example = intake.synthetic_example()
        self.assertTrue(any("example placeholder" in gap for gap in intake.rights_gaps(example)))
        report = intake.progress_report([example])
        self.assertFalse(report["ready"])
        self.assertFalse(report["approved"])
        self.assertFalse(report["admitted"])
        self.assertEqual(report["counts"]["rightsExcluded"], 1)
        self.assertEqual(report["counts"]["benchmarkEligible"], 0)

    def test_intake_copies_bytes_without_guessing_a_category(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "wig-braids.png")
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            entry = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertEqual(entry["verifiedCategory"], "")
            self.assertFalse(entry["admitted"])
            self.assertFalse(entry["approved"])
            self.assertEqual(entry["split"], "")
            self.assertEqual(entry["status"], "rights-excluded")
            with self.assertRaises(FileExistsError) as caught:
                intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            self.assertIn("Duplicate submission", str(caught.exception))
            self.assertEqual(hashlib.sha256(Path(entry["imagePath"]).read_bytes()).hexdigest(), before)

    def test_arbitrary_and_symlinked_destinations_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            source = _png(base, "plain.png")
            loose = base / "loose"
            loose.mkdir()
            with self.assertRaises(ValueError):
                intake.intake_file(source, loose, "group-1", False)
            self.assertEqual(list(loose.glob("img-*")), [])
            root = _root(base)
            real = base / "real"
            real.mkdir()
            parent = root / "held"
            parent.symlink_to(real)
            with self.assertRaises(ValueError):
                intake.intake_file(source, parent, "group-1", False, storage_root=root)
            self.assertEqual(list(real.glob("img-*")), [])
            linked_root = base / "linked-root"
            linked_root.symlink_to(root)
            with self.assertRaises(ValueError):
                intake.intake_file(source, linked_root, "group-1", False, storage_root=linked_root)
            outside = base / "outside"
            outside.mkdir()
            data = source.read_bytes()
            image_id = "img-" + hashlib.sha256(data).hexdigest()[:20]
            held = root / "safe"
            held.mkdir()
            planted = held / f"{image_id}.png"
            planted.symlink_to(outside / "written.png")
            with self.assertRaises(ValueError) as caught:
                intake.intake_file(source, held, "group-1", False, storage_root=root)
            self.assertIn("symlink", str(caught.exception).lower())
            self.assertFalse((outside / "written.png").exists())
            self.assertTrue(planted.is_symlink())

    def test_existing_file_is_not_overwritten_and_failed_publish_is_cleaned(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "plain.png")
            data = source.read_bytes()
            image_id = "img-" + hashlib.sha256(data).hexdigest()[:20]
            held = root / "held"
            held.mkdir()
            existing = held / f"{image_id}.png"
            existing.write_bytes(b"different-bytes")
            with self.assertRaises(FileExistsError) as caught:
                intake.intake_file(source, held, "group-1", False, storage_root=root)
            self.assertIn("not overwritten", str(caught.exception))
            self.assertEqual(existing.read_bytes(), b"different-bytes")
            broken = root / "notes.txt"
            broken.write_bytes(b"not an image")
            with self.assertRaises(ValueError):
                intake.intake_file(broken, root / "other", "group-1", False, storage_root=root)
            self.assertEqual(list((root / "other").glob("img-*")), [])
            self.assertEqual(list(root.rglob(".intake-*.partial")), [])
            real_link = os.link
            def fail_link(*args, **kwargs):
                raise OSError("link failed")
            os.link = fail_link
            intake.os.link = fail_link
            try:
                with self.assertRaises(OSError):
                    intake.intake_file(source, root / "third", "group-1", False, storage_root=root)
            finally:
                os.link = real_link
                intake.os.link = real_link
            self.assertEqual(list(root.rglob(".intake-*.partial")), [])
            self.assertEqual(list((root / "third").glob("img-*")), [])

    def test_limits_reject_large_malformed_and_bomb_images_without_storing_them(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            wide = _png(base, "wide.png", size=(5000, 2))
            with self.assertRaises(ValueError):
                intake.intake_file(wide, root / "held", "group-1", False, storage_root=root)
            huge = base / "huge.bin"
            huge.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 80)
            with self.assertRaises(ValueError) as caught:
                intake.intake_file(huge, root / "held", "group-1", False, storage_root=root, max_file_bytes=40)
            self.assertIn("byte limit", str(caught.exception))
            bomb = base / "bomb.png"
            bomb.write_bytes(_claim_png(10000, 10000))
            with self.assertRaises(ValueError) as caught:
                intake.intake_file(bomb, root / "held", "group-1", False, storage_root=root, max_pixels=10)
            self.assertIn("pixel limit", str(caught.exception))
            warning = _png(base, "warn.png", size=(6, 6))
            with self.assertRaises(ValueError):
                intake.intake_file(warning, root / "held", "group-1", False, storage_root=root, max_pixels=20)
            truncated = base / "cut.png"
            truncated.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00")
            with self.assertRaises(ValueError):
                intake.intake_file(truncated, root / "held", "group-1", False, storage_root=root)
            self.assertEqual(list(root.rglob("img-*")), [])
            self.assertEqual(list(root.rglob(".intake-*.partial")), [])

    def test_concurrent_intake_keeps_one_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "same.png")
            other = _png(base, "other.png", colour=(1, 2, 3, 255))
            barrier = threading.Barrier(2)
            results: list[dict] = []
            errors: list[BaseException] = []

            def same_file() -> None:
                barrier.wait()
                try:
                    results.append(intake.intake_file(source, root / "held", "group-1", False, storage_root=root))
                except BaseException as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=same_file) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(len(results), 1)
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], FileExistsError)
            self.assertIn("Duplicate", str(errors[0]))
            stored = list((root / "held").glob("img-*"))
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0].read_bytes(), source.read_bytes())
            second = intake.intake_file(other, root / "held", "group-2", False, storage_root=root)
            self.assertNotEqual(second["imageId"], results[0]["imageId"])
            self.assertEqual(list(root.rglob(".intake-*.partial")), [])

    def test_reviews_hide_the_other_person_and_the_image_id(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "shirt.png")
            entry = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            ledger = intake.ReviewLedger(base / "reviews")
            first = ledger.open_review(entry)
            second = ledger.open_review(entry)
            self.assertNotEqual(first, second)
            self.assertNotIn(entry["imageId"], first)
            self.assertNotIn(entry["sha256"], ledger.blind_view(first).values())
            self.assertNotIn("imageId", ledger.blind_view(first))
            ledger.submit_review(first, "A", "Ada", "shirt")
            receipt = ledger.submit_review(first, "B", "Bo", "jacket")
            self.assertEqual(set(receipt), {"reviewRef", "slot", "category", "style", "length", "colour", "recorded", "admitted", "approved", "identityVerified"})
            self.assertEqual(receipt["category"], "jacket")
            self.assertNotIn("Ada", str(receipt))
            self.assertFalse(receipt["identityVerified"])
            self.assertFalse(receipt["admitted"])
            disagreed = ledger.apply_agreement(entry, first, "2026-11-02")
            self.assertEqual(disagreed["status"], "excluded-disagreement")
            self.assertEqual(disagreed["verifiedCategory"], "")
            same = intake.ReviewLedger(base / "reviews-same")
            ref = same.open_review(entry)
            same.submit_review(ref, "A", "Ada", "shirt")
            with self.assertRaises(FileExistsError) as caught:
                same.submit_review(ref, "B", "ada.", "shirt")
            self.assertIn("already submitted", str(caught.exception))
            self.assertEqual(same.apply_agreement(entry, ref, "2026-11-02")["status"], "awaiting-second-review")
            self.assertEqual(ledger.review_bytes(first), source.read_bytes())

    def test_rights_dates_urls_and_splits(self):
        entry = intake.manifest_template()
        entry["identifiablePerson"] = True
        self.assertTrue(any("Identifiable" in gap for gap in intake.rights_gaps(entry)))
        self.assertTrue(any("calendar" in gap for gap in intake.rights_gaps({**entry, "acquiredOn": "2026-02-31", "identifiablePerson": False})))
        self.assertTrue(any("public URL" in gap for gap in intake.rights_gaps({
            **entry,
            "rightsBasis": "isibuko-owned",
            "rightsHolder": "Isibuko",
            "licenceRef": "https://example.com/licence",
            "commercialEval": True,
            "acquiredOn": "2026-11-01",
            "identifiablePerson": False,
        })))
        recorded = intake.record_rights(entry, {
            "rightsBasis": "isibuko-owned",
            "rightsHolder": "Isibuko",
            "licenceRef": "written-permission-synthetic",
            "commercialEval": True,
            "acquiredOn": "2026-11-01",
            "identifiablePerson": False,
        })
        self.assertEqual(recorded["status"], "rights-recorded")
        self.assertFalse(recorded["approved"])
        placed, errors = intake.record_split(recorded, "evaluation", "Ada")
        self.assertEqual(errors, [])
        stayed, blocked = intake.record_split(placed, "selection", "Bo")
        self.assertEqual(stayed["split"], "evaluation")
        self.assertTrue(blocked)

    def test_progress_counts_missing_files_and_altered_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "shirt.png")
            entry = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            report = intake.progress_report([entry], dataset_dir=root)
            self.assertFalse(report["ready"])
            self.assertFalse(report["approved"])
            self.assertEqual(report["counts"]["imported"], 1)
            self.assertEqual(report["counts"]["rightsExcluded"], 1)
            self.assertEqual(report["counts"]["reviewIncomplete"], 1)
            self.assertEqual(report["counts"]["manifestValid"], 0)
            self.assertTrue(report["perceptualComparison"]["requiresBothImageFiles"])
            self.assertEqual(report["perceptualComparison"]["maxHamming"], 4)
            Path(entry["imagePath"]).unlink()
            missing = intake.progress_report([entry], dataset_dir=root)
            self.assertTrue(missing["missingFiles"])
            stored = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            path = Path(stored["imagePath"])
            path.write_bytes(path.read_bytes() + b"\x00")
            altered = intake.progress_report([stored], dataset_dir=root)
            self.assertTrue(altered["invalidHashes"])
            self.assertEqual(altered["counts"]["manifestValid"], 0)
            leaked = intake.progress_report([
                {**intake.manifest_template(), "imageId": "img-a", "sourceGroupId": "same", "split": "selection", "sha256": "a" * 64, "pixelSha256": "b" * 64},
                {**intake.manifest_template(), "imageId": "img-b", "sourceGroupId": "same", "split": "evaluation", "sha256": "c" * 64, "pixelSha256": "d" * 64},
                {**intake.manifest_template(), "imageId": "img-c", "sourceGroupId": "alone", "split": "train", "sha256": "e" * 64, "pixelSha256": "f" * 64},
            ])
            self.assertEqual(leaked["leakage"], ["img-a", "img-b"])
            self.assertEqual(leaked["counts"]["leakageRejected"], 2)
            self.assertFalse(any("training split" in item for item in leaked["leakage"]))

    def test_persistent_ledger_survives_restart_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "shirt.png")
            entry = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            entry["licenceRef"] = "secret-licence"
            entry["rightsHolder"] = "Secret Holder"
            ledger = intake.ReviewLedger(base / "ledger")
            ref = ledger.open_review(entry)
            other = ledger.open_review(entry)
            ledger.submit_review(ref, "A", "Ada", "shirt")
            with self.assertRaises(FileExistsError):
                ledger.submit_review(other, "B", "ada.", "jacket")
            ledger.submit_review(ref, "B", "Bo", "jacket")
            first = ledger.apply_agreement(entry, ref, "2026-11-02")
            self.assertEqual(first["status"], "excluded-disagreement")
            self.assertFalse(first["approved"])
            backup = ledger.backup(base / "backup")
            fresh = intake.ReviewLedger(base / "restored")
            fresh.restore(backup)
            self.assertEqual(fresh.apply_agreement(entry, ref)["status"], "excluded-disagreement")
            with self.assertRaises(ValueError):
                fresh.restore(backup)
            stored = "\n".join(path.read_text() for path in (base / "ledger").glob("*.json"))
            self.assertNotIn("secret-licence", stored)
            self.assertNotIn("rightsHolder", stored)
            self.assertNotIn(entry["imageId"], ledger.blind_view(ref).values())
            mode = os.stat(next((base / "ledger").glob("*.json"))).st_mode & 0o777
            self.assertEqual(mode, 0o600)
            restarted = intake.ReviewLedger(base / "ledger")
            again = restarted.apply_agreement(entry, ref, "2026-11-02")
            self.assertEqual(again["status"], "excluded-disagreement")
            self.assertEqual(again["verifiedCategory"], "")
            self.assertEqual(restarted.review_bytes(ref), source.read_bytes())
            partial = base / "ledger" / "torn-write.partial"
            partial.write_text("{")
            recovered = intake.ReviewLedger(base / "ledger")
            self.assertIn("torn-write.partial", recovered.recovered)
            self.assertFalse(partial.exists())
            self.assertEqual(recovered.apply_agreement(entry, ref)["status"], "excluded-disagreement")
            broken = base / "ledger" / "00000099-abcdefabcdefabcd.json"
            broken.write_text("{")
            quarantined = intake.ReviewLedger(base / "ledger")
            self.assertIn(broken.name, quarantined.recovered)
            self.assertFalse(broken.exists())
            target = next(path for path in (base / "ledger").glob("0*.json") if b"shirt" in path.read_bytes())
            target.write_bytes(target.read_bytes().replace(b"shirt", b"shirr", 1))
            with self.assertRaises(intake.LedgerError):
                intake.ReviewLedger(base / "ledger")

    def test_concurrent_review_submissions(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _root(base)
            source = _png(base, "shirt.png")
            entry = intake.intake_file(source, root / "held", "group-1", False, storage_root=root)
            ledger = intake.ReviewLedger(base / "ledger")
            ref = ledger.open_review(entry)
            barrier = threading.Barrier(2)
            errors: list[BaseException] = []

            def submit(slot: str, name: str, category: str) -> None:
                barrier.wait()
                try:
                    intake.ReviewLedger(base / "ledger").submit_review(ref, slot, name, category)
                except BaseException as exc:
                    errors.append(exc)

            threads = [
                threading.Thread(target=submit, args=("A", "Ada", "shirt")),
                threading.Thread(target=submit, args=("B", "Bo", "shirt")),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(errors, [])
            reloaded = intake.ReviewLedger(base / "ledger")
            agreed = reloaded.apply_agreement(entry, ref, "2026-11-02")
            self.assertEqual(agreed["status"], "reviewed")
            self.assertEqual(agreed["verifiedCategory"], "shirt")
            self.assertFalse(agreed["approved"])
            self.assertFalse(agreed["admitted"])


if __name__ == "__main__":
    unittest.main()
