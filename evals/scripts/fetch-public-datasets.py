"""Fetch pinned public sources and rebuild ignored canonical evaluation JSONL files.

Run from any directory: python3 evals/scripts/fetch-public-datasets.py
Pass all three --*-repo paths to use existing pinned checkouts without network.
Requires Git and Python 3 standard library; never calls a model provider.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = (
    ("in-page-wild-sample-v1", "web", "web_repo"),
    ("agent-injection-bench-v1", "aib", "aib_repo"),
    ("agentdojo-travel-v1", "dojo", "dojo_repo"),
)


def git(*args, check=True):
    return subprocess.run(["git", *map(str, args)], check=check, capture_output=True, text=True)


def pinned_checkout(name, alias, override, cache_dir):
    manifest = json.loads((ROOT / "evals" / "datasets" / f"{name}.json").read_text())
    expected = manifest["provenance"]["commit"]
    repository = manifest["provenance"]["repository"]
    path = override.resolve() if override else cache_dir / alias
    created = not path.exists()
    if override and created:
        raise ValueError(f"Provided source checkout does not exist: {path}")
    if created:
        path.parent.mkdir(parents=True, exist_ok=True)
        git("clone", "--quiet", "--filter=blob:none", "--no-checkout", repository, path)
    if not (path / ".git").exists():
        raise ValueError(f"Not a Git checkout: {path}")
    if not override:
        origin = git("-C", path, "remote", "get-url", "origin").stdout.strip()
        if origin != repository:
            raise ValueError(f"Cached source remote differs for {name}: {path}")
        if git("-C", path, "rev-parse", "--verify", f"{expected}^{{commit}}", check=False).returncode:
            git("-C", path, "fetch", "--quiet", "origin", expected)
        head = git("-C", path, "rev-parse", "HEAD", check=False)
        # --no-checkout can already put HEAD at the pinned commit while leaving
        # both the index and worktree empty, including after an interrupted fetch.
        empty_checkout = not git("-C", path, "ls-files", "-z").stdout and not any(entry.name != ".git" for entry in path.iterdir())
        if created or empty_checkout or head.returncode or head.stdout.strip() != expected:
            if not created and not empty_checkout and git("-C", path, "status", "--porcelain").stdout.strip():
                raise ValueError(f"Cached source has local changes; inspect before checkout: {path}")
            git("-C", path, "checkout", "--quiet", "--detach", expected)
    head = git("-C", path, "rev-parse", "HEAD").stdout.strip()
    if head != expected:
        raise ValueError(f"Wrong upstream commit for {name}: expected {expected}, found {head}")
    missing_sources = [source for source in manifest["provenance"].get("sourceFiles", {}) if not (path / source).is_file()]
    if missing_sources:
        raise ValueError(f"Missing pinned source files for {name}: {missing_sources}; inspect checkout before retrying: {path}")
    return path, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".local" / "eval-sources")
    parser.add_argument("--web-repo", type=Path)
    parser.add_argument("--aib-repo", type=Path)
    parser.add_argument("--dojo-repo", type=Path)
    args = parser.parse_args()
    checkouts = {}
    manifests = {}
    for name, alias, argument in DATASETS:
        checkouts[alias], manifests[name] = pinned_checkout(name, alias, getattr(args, argument), args.cache_dir.resolve())
    subprocess.run([
        sys.executable, str(ROOT / "evals" / "scripts" / "import-public-datasets.py"),
        "--web-repo", str(checkouts["web"]),
        "--aib-repo", str(checkouts["aib"]),
        "--dojo-repo", str(checkouts["dojo"]),
    ], check=True)
    for name, _, _ in DATASETS:
        path = ROOT / "evals" / "datasets" / f"{name}.jsonl"
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        expected = manifests[name]["source"]["sha256"]
        if actual != expected:
            raise ValueError(f"Generated dataset SHA mismatch for {name}: {actual}")
        print(f"Verified {name}: sha256:{actual}")


if __name__ == "__main__":
    main()
