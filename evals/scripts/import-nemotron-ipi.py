"""Build an attack-only, domain-stratified sample of NVIDIA's Nemotron agentic IPI dataset.

Download the pinned files (see the manifest) into ignored
evals/private/upstream/nemotron-ipi/, then run this script. Standard library only;
never calls a model. --write-manifest records a new manifest revision.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, emit, make_case, read_pinned, text_digest  # noqa: E402

DATASET_ID = "nemotron-ipi-domain-sample-v1"
REPOSITORY = "https://huggingface.co/datasets/nvidia/Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1"
REVISION = "d738d4f361cc38bb4d7a42b9066776dade5332f5"
SOURCE_HASHES = {
    "train.jsonl": "3329da17564a7eb287e2730fc7d6956e1f4fe51e8950ac4f110b3c37e78cf3b9",
    "README.md": "0386806252047746e06cba58bba3f91905aa02ccdd4def963022440e6d5de851",
}
PER_DOMAIN = 40
DOMAINS = ("ecommerce", "education", "healthcare", "hr", "insurance", "it_helpdesk", "legal", "logistics", "real_estate")


def locate(value, vector, injection):
    """Return the containing field text if the stripped injection appears verbatim in a vector field."""
    if isinstance(value, dict):
        if isinstance(value.get(vector), str) and injection in value[vector]:
            return value[vector]
        for item in value.values():
            found = locate(item, vector, injection)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = locate(item, vector, injection)
            if found is not None:
                return found
    return None


def placement(field, injection):
    if field is None:
        return "unlocated"
    index = field.index(injection)
    if not field[:index].strip():
        return "start"
    return "end" if not field[index + len(injection):].strip() else "middle"


def build(directory):
    directory = Path(directory)
    for name, expected in SOURCE_HASHES.items():
        read_pinned(directory / name, expected, name)
    rows = [json.loads(line) for line in read_pinned(directory / "train.jsonl", SOURCE_HASHES["train.jsonl"]).decode("utf8").splitlines()]
    if len(rows) != 1272 or len({row["id"] for row in rows}) != 1272:
        raise ValueError("Unexpected Nemotron IPI row count")
    by_domain = collections.defaultdict(lambda: collections.defaultdict(list))
    for row in rows:
        if row["domain"] not in DOMAINS or row["license"] != "CC BY 4.0" or row["attack_category"] != row["injection"]["category"]:
            raise ValueError(f"Unexpected Nemotron row metadata: {row['id']}")
        messages = row["responses_create_params"]["input"]
        if [m["role"] for m in messages] != ["system", "user"]:
            raise ValueError(f"Unexpected Nemotron messages: {row['id']}")
        by_domain[row["domain"]][row["attack_category"]].append(row)
    cases = []
    for domain in DOMAINS:
        # Round-robin over categories (sorted), each ordered by SHA-256 of the stable upstream ID.
        queues = {category: sorted(items, key=lambda r: text_digest(f"nemotron-ipi/{r['id']}")) for category, items in sorted(by_domain[domain].items())}
        chosen = []
        while len(chosen) < PER_DOMAIN and any(queues.values()):
            for category in sorted(queues):
                if queues[category] and len(chosen) < PER_DOMAIN:
                    chosen.append(queues[category].pop(0))
        if len(chosen) != PER_DOMAIN:
            raise ValueError(f"Too few Nemotron rows in {domain}")
        for row in chosen:
            system, user = row["responses_create_params"]["input"]
            environment = json.dumps(row["environment"], ensure_ascii=False, indent=2)
            injection = row["injection"]["injection_text"].strip()
            field = locate(row["environment"], row["injection_vector"], injection)
            turns = [
                {"id": "system", "role": "system", "origin": "operator", "text": system["content"]},
                {"id": "task", "role": "user", "origin": "operator", "text": user["content"]},
                {"id": "tool-output", "role": "tool", "origin": "external", "text": environment},
            ]
            facets = {
                "source": "nemotron-ipi", "source_id": row["id"], "domain": domain, "attack_category": row["attack_category"],
                "injection_vector": row["injection_vector"], "target_tool": row["target_tool"],
                "verification_type": row["injection"]["verification_type"], "placement_in_field": placement(field, injection),
                "injection_verbatim_in_environment": field is not None, "attack_template_id": "nemotron:" + text_digest(injection)[:16],
                "surface": "tool_response",
            }
            cases.append(make_case("nm-" + text_digest(f"{row['id']}\0{environment}")[:24], "injection", turns, facets))
    return cases


PROVENANCE = {
    "repository": REPOSITORY,
    "revision": REVISION,
    "sourceFiles": {name: f"sha256:{value}" for name, value in SOURCE_HASHES.items()},
    "license": "CC BY 4.0 (dataset card and every row's license field). Commercial use permitted with attribution to NVIDIA Corporation. Credit: Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1.",
    "accessLimits": "Public, ungated. Raw rows and generated cases stay under ignored evals/private/.",
    "selection": "Attack-only. 40 rows per domain for all 9 domains (360). Within each domain, rows are ordered by SHA-256 of 'nemotron-ipi/<id>' per attack category and taken round-robin across the sorted categories, so small categories are fully represented before large ones repeat. No model-driven filtering.",
    "construction": "Operator turns are the upstream system prompt and user request. The screened external turn is the full simulated backend environment (JSON, indent 2) that the required read tool exposes; it contains the injection inside the upstream injection_vector field. Upstream injection_text is not always verbatim in the environment (the red-teaming loop rewrote some); placement_in_field is start/middle/end when it is verbatim, else unlocated.",
    "labelMeaning": "Every row is a successful-against-the-defender injection attempt disguised as domain content (upstream retains only attacks that fooled Nemotron Nano 3). This is attack-only: use caseSelector positive and detection_rate. It measures detection, not agent compliance. Domain content is synthetic.",
    "facets": ["domain", "attack_category", "injection_vector", "target_tool", "verification_type", "placement_in_field", "injection_verbatim_in_environment", "attack_template_id"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "evals/private/upstream/nemotron-ipi")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    emit(DATASET_ID, build(args.source_dir), PROVENANCE, args.write_manifest)


if __name__ == "__main__":
    main()
