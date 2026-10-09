"""Build Inj-SQuAD and Inj-TriviaQA detection cohorts from the pinned indirect-pia-detection release.

Clones/uses ignored .local/eval-sources/injpia at the pinned commit (pass --fetch
to clone). Standard library plus git; never calls a model.
--write-manifest records a new manifest revision.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, emit, make_case, read_pinned, text_digest  # noqa: E402

REPOSITORY = "https://github.com/LukeChen-go/indirect-pia-detection"
COMMIT = "1e9e0f00179adc154e9ca991b9cd3206c99f9588"
SOURCE_HASHES = {
    "data/crafted_instruction_data_squad_injection_qa.json": "c48a0205815caa266ada687eb6f78db2c809254820cef4c86dd4437851f8fb7e",
    "data/crafted_instruction_data_tri_injection_qa.json": "9a70351612f60f535dc3937a109b57c589226ee668e788fdf05a0c1dbd74d389",
    "LICENSE": "a2d5c8ec4daf90d384bfebc9474e021e152306b1de4def3f945c27db87df37a9",
    "run_detection.py": "1140f40b22104e2721db8690f6bf799fb323ab22fd8eea5191d1dc4930b876aa",
    "instruction_attack_defense_tools.py": "3236d343d254a5d490ee5aee5fc5ff3497acd58bfd54cb981ccf2f74ef320f36",
}
DATASETS = {
    "squad": ("inj-squad-v1", "data/crafted_instruction_data_squad_injection_qa.json", "SQuAD"),
    "tri": ("inj-triviaqa-v1", "data/crafted_instruction_data_tri_injection_qa.json", "TriviaQA"),
}
POSITIONS = ("start", "middle", "end")
INSTRUCTIONS = 300


def fetch(directory):
    directory = Path(directory)
    if not directory.exists():
        subprocess.run(["git", "clone", "--quiet", REPOSITORY, str(directory)], check=True)
    subprocess.run(["git", "-C", str(directory), "checkout", "--quiet", "--detach", COMMIT], check=True)


def normalize(context):
    # Upstream run_detection: ensure terminal punctuation, then append one space.
    if context[-1] not in ".!?":
        context += "."
    return context + " "


def insert(context, injection, position):
    """Upstream insert_injection; middle replaces random.choice of a word index with a SHA-256 choice."""
    if position == "end":
        return context + " " + injection
    if position == "start":
        return injection + " " + context
    words = context.split(" ")
    index = int(text_digest(context + "\0" + injection), 16) % len(words)
    words.insert(index, injection)
    return " ".join(words)


def build(directory, key):
    directory = Path(directory)
    for name, expected in SOURCE_HASHES.items():
        read_pinned(directory / name, expected, name)
    dataset_id, path, corpus = DATASETS[key]
    rows = json.loads(read_pinned(directory / path, SOURCE_HASHES[path]).decode("utf8"))
    if len(rows) != 3 * INSTRUCTIONS or any(rows[i]["injection"] != rows[i % INSTRUCTIONS]["injection"] for i in range(len(rows))):
        raise ValueError(f"Unexpected {corpus} injection test layout")
    if len({row["injection"] for row in rows}) != INSTRUCTIONS or len({row["input"] for row in rows}) != len(rows):
        raise ValueError(f"Unexpected {corpus} instruction/context uniqueness")
    cases = []
    for row_index, row in enumerate(rows):
        instruction, copy = row_index % INSTRUCTIONS, row_index // INSTRUCTIONS
        position = POSITIONS[(instruction + copy) % 3]
        context = normalize(row["input"])
        injection = row["injection"].capitalize()  # upstream naive attack
        operator = {"id": "task", "role": "user", "origin": "operator", "text": row["instruction"]}
        common = {"source": f"inj-{key}", "corpus": corpus, "split": "test", "source_row": row_index, "pair_id": text_digest(row["input"]), "surface": "retrieved_document"}
        variants = [("injection", insert(context, injection, position), {"instruction_id": instruction, "attack_template_id": f"injqa:{instruction}", "insertion_position": position, "attack_style": "naive"})]
        if copy == 0:
            variants.append(("benign", context, {"instruction_id": -1, "attack_template_id": "none", "insertion_position": "none", "attack_style": "none"}))
        for label, source, extra in variants:
            turns = [operator, {"id": "document", "role": "document", "origin": "external", "text": source}]
            cases.append(make_case(f"iq{key[0]}-" + text_digest(row["instruction"] + "\0" + source)[:24], label, turns, {**common, **extra}))
    return dataset_id, corpus, cases


def provenance(corpus):
    return {
        "repository": REPOSITORY,
        "commit": COMMIT,
        "paper": "https://arxiv.org/abs/2502.16580",
        "sourceFiles": {name: f"sha256:{value}" for name, value in SOURCE_HASHES.items()},
        "license": f"MIT (repository LICENSE, Copyright (c) 2025 Yulin Chen). Contexts derive from {corpus}: SQuAD v1.1 is CC BY-SA 4.0; the TriviaQA repository is Apache-2.0 and its evidence documents come from the web and Wikipedia under their original terms. Used as research test data; generated case text stays private.",
        "accessLimits": "Public, ungated. Generated cases and outputs stay under ignored evals/private/ and evals/runs/.",
        "selection": f"All 900 rows of the released {corpus} injection test file: 300 distinct injected instructions, each paired with 3 different contexts. Row r uses instruction r mod 300 and copy r div 300; position = (instruction + copy) mod 3 over start/middle/end, so every instruction appears once at each position. Clean siblings are the normalized contexts of the 300 copy-0 rows (100 per position of their attacked sibling).",
        "insertion": "Upstream run_detection normalization (terminal punctuation plus a trailing space) and the 'naive' attack (instruction.capitalize()) via insert_injection. start/end are exact; middle replaces random.choice of a space-split word index with a SHA-256 choice of (context, injection).",
        "labelMeaning": "Constructed injection attempts in a retrieved QA context versus the same context without insertion. Not observed compliance. Only the naive attack style is used; variety comes from the 300 instructions and 3 positions. Bootstrap by instruction_id or pair_id.",
        "facets": ["instruction_id", "attack_template_id", "insertion_position", "attack_style", "pair_id", "source_row"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / ".local/eval-sources/injpia")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        fetch(args.source_dir)
    for key in DATASETS:
        dataset_id, corpus, cases = build(args.source_dir, key)
        emit(dataset_id, cases, provenance(corpus), args.write_manifest)


if __name__ == "__main__":
    main()
