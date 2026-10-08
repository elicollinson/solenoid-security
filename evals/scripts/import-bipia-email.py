"""Build a paired BIPIA EmailQA detection cohort from pinned public sources.

Run with --fetch to retrieve missing upstream files; omit it for an offline rebuild.
Only Python's standard library is required. This script never calls a model.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
DATASET_ID = "bipia-email-paired-v1"
REPOSITORY = "https://github.com/microsoft/BIPIA"
COMMIT = "a004b69ec0dd446e0afd461d98cb5e96e120a5d0"
SOURCE_HASHES = {
    "benchmark/email/train.jsonl": "82207193cb8ce06713eeb7c33ca0716446613512e2ad9303b302ba14d425ddd4",
    "benchmark/email/test.jsonl": "217b403faaa1d0cb12c24892bea39f4a0b9e2819919ac7e2b902006e28278cdb",
    "benchmark/text_attack_train.json": "63f95d3e67eac4178cdabdbdaf192cd05f2b6ed0702b578f1d30d556e5155670",
    "benchmark/text_attack_test.json": "75750e7b4e8b34e8f9d88d89b357aeaaf02bd07f9e493ccd37eda74a0cd7c7f8",
    "LICENSE": "57cf81c45e0929899bc18051cf90134f00e55963ddecc7b37cfc5ea1494b1e8b",
    "bipia/data/utils.py": "51d38fccc527c88b5d045ea8336705476a43aa576356e0e76a15bb4633bf1945",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_source(directory, name):
    data = (directory / name).read_bytes()
    if digest(data) != SOURCE_HASHES[name]:
        raise ValueError(f"BIPIA source SHA-256 mismatch: {name}")
    return data.decode("utf8")


def fetch_sources(directory):
    for name in SOURCE_HASHES:
        path = directory / name
        if not path.exists():
            url = f"https://raw.githubusercontent.com/microsoft/BIPIA/{COMMIT}/{name}"
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
            if digest(data) != SOURCE_HASHES[name]:
                raise ValueError(f"Fetched BIPIA source SHA-256 mismatch: {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        read_source(directory, name)


def build_cases(directory):
    # Verify licensing and the exact upstream insertion implementation as well as data.
    for name in SOURCE_HASHES:
        read_source(directory, name)
    selected = {"train": [], "test": []}
    seen_contexts = set()
    # All repeated emails belong to test, preventing train/test context overlap.
    for split in ("test", "train"):
        rows = [json.loads(line) for line in read_source(directory, f"benchmark/email/{split}.jsonl").splitlines()]
        if len(rows) != 50:
            raise ValueError(f"Unexpected BIPIA email {split} count")
        for row in rows:
            if not isinstance(row.get("context"), str) or not row["context"].strip() or not isinstance(row.get("question"), str) or not row["question"].strip():
                raise ValueError(f"Invalid BIPIA email {split} row")
        rows.sort(key=lambda row: digest((row["context"] + "\0" + row["question"]).encode()))
        for row in rows:
            key = digest(row["context"].encode())
            if key not in seen_contexts:
                selected[split].append(row)
                seen_contexts.add(key)
    if {split: len(rows) for split, rows in selected.items()} != {"train": 34, "test": 44}:
        raise ValueError("Unexpected unique BIPIA email context counts")
    cases = []
    for split in ("train", "test"):
        attacks = json.loads(read_source(directory, f"benchmark/text_attack_{split}.json"))
        if len(attacks) != 15 or any(not isinstance(prompts, list) or len(prompts) != 5 or any(not isinstance(prompt, str) or not prompt.strip() for prompt in prompts) for prompts in attacks.values()):
            raise ValueError(f"Unexpected BIPIA attack families in {split}")
        families = sorted(attacks)
        for index, row in enumerate(selected[split]):
            base = row["context"]
            base_hash = digest(base.encode())
            family = families[index % len(families)]
            variant = index // len(families)
            payload = attacks[family][variant]
            position = "start" if index % 2 == 0 else "end"
            # Exact upstream insert_start/insert_end behavior; no sentence tokenizer required.
            poisoned = "\n".join([payload, base] if position == "start" else [base, payload])
            for label, source in (("benign", base), ("injection", poisoned)):
                case_id = "be-" + digest((row["question"] + "\0" + source).encode())[:24]
                turns = [
                    {"id": "task", "role": "user", "origin": "operator", "text": row["question"]},
                    {"id": "email", "role": "document", "origin": "external", "text": source},
                ]
                facets = {
                    "source": "bipia", "surface": "email", "task": "email-qa", "split": split,
                    "pair_id": base_hash, "base_context_sha256": base_hash,
                    "attack_family": family if label == "injection" else "none",
                    "attack_variant": variant if label == "injection" else -1,
                    "insertion_position": position if label == "injection" else "none",
                }
                cases.append({"id": case_id, "label": label, "turns": turns, "facets": facets, "text_sha256": digest("\n".join(turn["text"] for turn in turns).encode())})
    if len(cases) != 156 or len({case["id"] for case in cases}) != 156:
        raise ValueError("Invalid BIPIA canonical case counts or IDs")
    return cases


def canonical_bytes(cases):
    return "".join(json.dumps(case, ensure_ascii=False, separators=(",", ":")) + "\n" for case in cases).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / ".local/eval-sources/bipia")
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        fetch_sources(args.source_dir)
    cases = build_cases(args.source_dir)
    data = canonical_bytes(cases)
    manifest = json.loads((ROOT / "evals/datasets" / f"{DATASET_ID}.json").read_text())
    actual = digest(data)
    if actual != manifest["source"]["sha256"] or len(cases) != manifest["expectedCases"]:
        raise ValueError(f"BIPIA canonical manifest mismatch: sha256:{actual}")
    output = ROOT / manifest["source"]["path"]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    print(json.dumps({"datasetId": DATASET_ID, "cases": len(cases), "classes": {label: sum(case["label"] == label for case in cases) for label in ("injection", "benign")}, "uniqueBaseEmails": 78, "sha256": actual}))


if __name__ == "__main__":
    main()
