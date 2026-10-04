"""Import public, nonempty PIDS-Bench stress rows without changing upstream labels.

Clone https://github.com/ShirePyDev/Prompt-Injection-Detection-System at COMMIT
into evals/private/upstream/pids-bench first. This offline importer verifies hashes.
"""
import csv
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "caa329e1cd9fc3a7fb448fa6f413420d9885f4a1"
SOURCES = {
    "hard-benign-public": ("hard_benign_test.csv", "e3ddb1e6e9e04e1097b7bcf9a6f5e05b0a8d73e8d71b8d867f7ed85b89472cee", 1472, 808, "0"),
    "obfuscated": ("obfuscated_attacks.csv", "b151322f05ef83922c734c589804fc7eab53331b61b5ad153c72aaf683f7c691", 405, 405, "1"),
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def build(source_dir, name):
    filename, expected_hash, total, available, label = SOURCES[name]
    raw = (source_dir / filename).read_bytes()
    if digest(raw) != expected_hash:
        raise ValueError("PIDS upstream SHA-256 mismatch")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf8"))))
    if len(rows) != total or any(row["label"] != label for row in rows):
        raise ValueError("PIDS upstream count/label mismatch")
    cases = []
    for ordinal, row in enumerate(rows):
        text = row["text"]
        if not text.strip():
            if row["source"] not in ("lmsys", "lmsys_ai_adjacent"):
                raise ValueError("Unexpected missing non-LMSYS text")
            continue
        # Opaque identifiers and neutral source names never convey the expected class.
        identity = digest((filename + "\0" + str(ordinal) + "\0" + text).encode())
        cases.append({
            "id": "pids-" + identity[:24],
            "label": "injection" if label == "1" else "benign",
            "turns": [{"id": "source", "role": "document", "origin": "external", "text": text}],
            "text_sha256": digest(text.encode()),
            "facets": {key: row[key] for key in ("parent_seed_id", "source", "attack_type", "language", "generator_model", "paraphrase_round", "source_type", "obfuscation")},
        })
    if len(cases) != available or len({x["id"] for x in cases}) != available:
        raise ValueError("PIDS available count/identity mismatch")
    return cases


def main():
    source_dir = ROOT / "evals/private/upstream/pids-bench/data/pids_bench_v3/eval_subsets"
    for name, (filename, source_hash, total, available, label) in SOURCES.items():
        cases = build(source_dir, name)
        data = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in cases).encode()
        dataset_id = f"pids-{name}-v1"
        path = f"evals/private/sources/{dataset_id}.jsonl"
        (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / path).write_bytes(data)
        manifest = {
            "schemaVersion": "security-eval-dataset/v1", "id": dataset_id,
            "revision": "sha256:" + digest(data),
            "source": {"path": path, "sha256": digest(data), "format": "canonical-jsonl", "visibility": "public"},
            "expectedCases": available, "annotationKey": "prompt_injection_attempt",
            "positiveValues": ["injection"], "negativeValues": ["benign"],
            "provenance": {
                "repository": "https://github.com/ShirePyDev/Prompt-Injection-Detection-System", "commit": COMMIT,
                "sourceFile": "data/pids_bench_v3/eval_subsets/" + filename, "sourceSha256": source_hash,
                "upstreamRows": total, "excludedUnavailableRows": total - available,
                "license": "Inherited source terms; research/noncommercial only overall. See pinned upstream DATA_LICENSES.md. Curated templates MIT, OASST/deepset Apache-2.0, Dolly CC BY-SA 3.0, SPML MIT, Qualifire CC BY-NC 4.0. No withheld LMSYS text is reconstructed.",
                "selection": "Every nonempty publicly released row, original order and exact text; no model-driven selection or relabeling. Preserve source and seed family facets. Not a complete PIDS-Bench reproduction.",
                "labelMeaning": "Upstream gateway injection/benign labels, not measured compromise. External-source detector semantics may differ for legitimate imperative requests. Obfuscated rows derive from upstream test split; do not pool with that split as independent evidence.",
            },
        }
        (ROOT / f"evals/datasets/{dataset_id}.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(dataset_id, available, digest(data))


if __name__ == "__main__":
    main()
