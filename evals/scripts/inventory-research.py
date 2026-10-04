"""Hash retained research artifacts after live processes finish; no network access."""
import hashlib
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='evals/runs/research-final-2026-09-29/artifact-inventory.json')
    output = (ROOT / parser.parse_args().output).resolve()
    if not output.is_relative_to(ROOT / 'evals/runs'):
        raise ValueError('Inventory must remain under ignored evals/runs')
    output.parent.mkdir(parents=True, exist_ok=True)
    sidecar = output.with_name('inventory-result.json')
    entries = []
    for name in ['evals/private', 'evals/runs']:
        for path in sorted((ROOT / name).rglob('*')):
            if not path.is_file() or path in (output, sidecar) or '.git' in path.parts or '__pycache__' in path.parts:
                continue
            # Artifact inventory follows ordinary files only; never chase symlinks.
            if path.is_symlink():
                continue
            digest = hashlib.sha256()
            with path.open('rb') as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(block)
            entries.append({'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': digest.hexdigest()})
    result = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'Retained evals/private and evals/runs ordinary files, excluding git internals, Python caches, this inventory and its inventory-result.json sidecar. Raw content remains local and ignored.', 'files': len(entries), 'totalBytes': sum(e['bytes'] for e in entries), 'artifacts': entries}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'output': str(output.relative_to(ROOT)), 'files': result['files'], 'bytes': result['totalBytes'], 'inventorySha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
