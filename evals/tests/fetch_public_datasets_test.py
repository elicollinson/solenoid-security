"""Offline regression tests for pinned public-source checkout recovery."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/fetch-public-datasets.py"
spec = importlib.util.spec_from_file_location("fetch_public_datasets", SCRIPT)
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


def git(*args):
    return subprocess.run(["git", *map(str, args)], check=True, capture_output=True, text=True)


class PinnedCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="solenoid-fetch-")
        self.root = Path(self.temp.name)
        self.source = self.root / "upstream"
        self.source.mkdir()
        git("init", "--quiet", self.source)
        (self.source / "source.txt").write_text("pinned source\n")
        git("-C", self.source, "add", "source.txt")
        git("-C", self.source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "source")
        self.commit = git("-C", self.source, "rev-parse", "HEAD").stdout.strip()
        self.previous_root = fetch.ROOT
        fetch.ROOT = self.root
        manifests = self.root / "evals/datasets"
        manifests.mkdir(parents=True)
        (manifests / "fixture.json").write_text(json.dumps({"provenance": {"repository": str(self.source), "commit": self.commit, "sourceFiles": {"source.txt": "fixture"}}}))
        self.cache = self.root / "cache"

    def tearDown(self):
        fetch.ROOT = self.previous_root
        self.temp.cleanup()

    def checkout(self):
        return fetch.pinned_checkout("fixture", "upstream", None, self.cache)[0]

    def test_new_clone_checks_out_when_head_already_matches(self):
        path = self.checkout()
        self.assertEqual((path / "source.txt").read_text(), "pinned source\n")
        self.assertEqual(git("-C", path, "rev-parse", "HEAD").stdout.strip(), self.commit)

    def test_recovers_cached_no_checkout_clone(self):
        self.cache.mkdir()
        path = self.cache / "upstream"
        git("clone", "--quiet", "--no-checkout", self.source, path)
        self.assertFalse((path / "source.txt").exists())
        self.assertEqual(self.checkout(), path)
        self.assertEqual((path / "source.txt").read_text(), "pinned source\n")

    def test_preserves_local_changes_before_revision_switch(self):
        path = self.checkout()
        (self.source / "source.txt").write_text("next source\n")
        git("-C", self.source, "add", "source.txt")
        git("-C", self.source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "next")
        next_commit = git("-C", self.source, "rev-parse", "HEAD").stdout.strip()
        manifests = self.root / "evals/datasets"
        (manifests / "fixture.json").write_text(json.dumps({"provenance": {"repository": str(self.source), "commit": next_commit}}))
        (path / "source.txt").write_text("local changes\n")
        with self.assertRaisesRegex(ValueError, "local changes"):
            self.checkout()
        self.assertEqual((path / "source.txt").read_text(), "local changes\n")

    def test_rejects_interrupted_clone_with_untracked_files(self):
        self.cache.mkdir()
        path = self.cache / "upstream"
        git("clone", "--quiet", "--no-checkout", self.source, path)
        (path / "notes.txt").write_text("preserve me\n")
        with self.assertRaisesRegex(ValueError, "Missing pinned source files"):
            self.checkout()
        self.assertEqual((path / "notes.txt").read_text(), "preserve me\n")
        self.assertFalse((path / "source.txt").exists())

    def test_does_not_restore_user_deleted_tracked_files(self):
        path = self.checkout()
        (path / "source.txt").unlink()
        with self.assertRaisesRegex(ValueError, "Missing pinned source files"):
            self.checkout()
        self.assertFalse((path / "source.txt").exists())


if __name__ == "__main__":
    unittest.main()
