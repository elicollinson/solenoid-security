"""Build the LLMail-Inject payload pool and a constructed long-email cohort.

1. llmail-inject-payload-pool-v1: a deterministic, deduplicated, stratified sample
   of unique attack submissions from both phases of the full public release.
2. longpi-email-llmail-v1: each pooled payload body inserted once into a LongPIBench
   benign email (3 positions per email), with the clean email as sibling.

Download the pinned release files (see the pool manifest) into ignored
evals/private/upstream/llmail-inject/. Standard library only; never calls a model.
--write-manifest records new manifest revisions.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, emit, make_case, read_pinned, text_digest  # noqa: E402
import longpi_documents as lp  # noqa: E402

POOL_ID = "llmail-inject-payload-pool-v1"
COHORT_ID = "longpi-email-llmail-v1"
REPOSITORY = "https://huggingface.co/datasets/microsoft/llmail-inject-challenge"
REVISION = "1063bdf01ec8762b812d5e06ee768a06faa5a6f7"
SOURCE_HASHES = {
    "data/labelled_unique_submissions_phase1.json": "691dfa1595d2bd0e731069f233bd5448f7af1c0ebd9732bc6f12dd6cee446586",
    "data/labelled_unique_submissions_phase2.json": "f89af984e345430c3b357903890e30867bf4676f4ef10c138cc7bad218e890b8",
    "data/scenarios.json": "3d7c55fd04826dd29fa11b9f9912ae270fffb16a6c52a7eb2bff00457d378e4f",
    "data/levels_descriptions.json": "d1391d6fa8bb074b1603bb20699df6c1ada3c6add64db495e1a39faebc0cd400",
    "data/objectives_descriptions.json": "daed5cacc5126790073e1a8dfc650b8024c903c415f1e11a189a8171c0c0f183",
    "README.md": "d85767e349ab1abbaf43db9390c4e906e34954e5df3a1335c8f1516efa64e812",
}
SEED = "llmail-inject-payload-pool-v1"
REASONS = ("api_triggered", "judge")
PHASES = ("phase1", "phase2")
TERCILES = 3
PER_STRATUM = 25  # 2 phases x 2 reasons x 3 length terciles x 25 = 300
MIN_BODY, MAX_BODY = 40, 4000
PREFIX_CHARS = 120
SUBMISSION = re.compile(r"\ASubject of the email: (.*?)\.\s+Body: (.*)\Z", re.S)
EMAIL_POSITIONS = ("email_in_end", "attachment_middle", "attachment_end")


def normalized(text):
    return re.sub(r"\s+", " ", text).strip().casefold()


def select_pool(directory):
    directory = Path(directory)
    for name, expected in SOURCE_HASHES.items():
        read_pinned(directory / name, expected, name)
    candidates = []
    for phase in PHASES:
        name = f"data/labelled_unique_submissions_{phase}.json"
        rows = json.loads(read_pinned(directory / name, SOURCE_HASHES[name]).decode("utf8"))
        for submission, label in rows.items():
            # Only string "True" attack-attempt labels with a recorded reason; "Unclear"/"False"/malformed are excluded.
            if not isinstance(label, dict) or label.get("attack_attempt") != "True" or label.get("reason") not in REASONS:
                continue
            match = SUBMISSION.match(submission)
            if not match:
                continue
            subject, body = match.group(1).strip(), match.group(2).strip()
            if MIN_BODY <= len(body) <= MAX_BODY:
                candidates.append({"phase": phase, "reason": label["reason"], "subject": subject, "body": body, "submission_sha256": text_digest(submission)})
    # Deterministic order, then exact (normalized body) and near (normalized 120-char prefix) dedup across both phases.
    candidates.sort(key=lambda c: text_digest(f"{SEED}/{c['phase']}/{c['submission_sha256']}"))
    seen_body, seen_prefix, unique = set(), set(), []
    for candidate in candidates:
        norm = normalized(candidate["body"])
        if norm in seen_body or norm[:PREFIX_CHARS] in seen_prefix:
            continue
        seen_body.add(norm)
        seen_prefix.add(norm[:PREFIX_CHARS])
        unique.append(candidate)
    lengths = sorted(len(c["body"]) for c in unique)
    edges = [lengths[len(lengths) * k // TERCILES] for k in range(1, TERCILES)]
    pool = []
    for phase in PHASES:
        for reason in REASONS:
            for tercile in range(TERCILES):
                stratum = [c for c in unique if c["phase"] == phase and c["reason"] == reason and sum(len(c["body"]) >= e for e in edges) == tercile]
                if len(stratum) < PER_STRATUM:
                    raise ValueError(f"LLMail stratum too small: {phase}/{reason}/{tercile}")
                pool += [{**c, "length_tercile": tercile} for c in stratum[:PER_STRATUM]]
    stats = {"eligibleAttackAttempts": len(candidates), "afterDedup": len(unique), "lengthTercileEdgesChars": edges}
    return pool, stats


def pool_cases(pool):
    cases = []
    for index, payload in enumerate(pool):
        text = f"Subject: {payload['subject']}\n\n{payload['body']}"
        facets = {"source": "llmail-inject", "phase": payload["phase"], "judge_reason": payload["reason"], "length_tercile": payload["length_tercile"],
                  "pool_index": index, "submission_sha256": payload["submission_sha256"], "attack_template_id": "llmail:" + text_digest(normalized(payload["body"]))[:16], "surface": "email"}
        cases.append(make_case("lp-" + text_digest(text)[:24], "injection", [{"id": "email", "role": "document", "origin": "external", "text": text}], facets))
    return cases


def cohort_cases(pool):
    lp.assert_clean_matches_upstream("email")
    operator = {"id": "task", "role": "user", "origin": "operator", "text": lp.system_prompt("email")}
    cases = []
    for item in range(100):
        clean = lp.render("email", item)
        facets = {"source": "LongPIBench synthetic + LLMail-Inject payload", "domain": "email", "document_family": f"email/{item}", "source_item": item,
                  "insertion_position": "none", "pool_index": -1, "phase": "none", "judge_reason": "none", "attack_template_id": "none"}
        cases.append(make_case("le-" + text_digest(f"email/{item}/clean\0{clean}")[:24], "benign", [operator, {"id": "source", "role": "document", "origin": "external", "text": clean}], facets))
        for p_index, position in enumerate(EMAIL_POSITIONS):
            pool_index = p_index * 100 + item
            payload = pool[pool_index]
            text = lp.render("email", item, position, payload["body"])
            facets = {"source": "LongPIBench synthetic + LLMail-Inject payload", "domain": "email", "document_family": f"email/{item}", "source_item": item,
                      "insertion_position": position, "pool_index": pool_index, "phase": payload["phase"], "judge_reason": payload["reason"],
                      "attack_template_id": "llmail:" + text_digest(normalized(payload["body"]))[:16]}
            cases.append(make_case("le-" + text_digest(f"email/{item}/{pool_index}\0{text}")[:24], "injection", [operator, {"id": "source", "role": "document", "origin": "external", "text": text}], facets))
    return cases


LICENSE = "MIT (dataset card at the pinned revision). Credit: Sahar Abdelnabi et al., Microsoft, LLMail-Inject: A Dataset from a Realistic Adaptive Prompt Injection Challenge."


def pool_provenance(stats):
    return {
        "repository": REPOSITORY,
        "revision": REVISION,
        "sourceFiles": {name: f"sha256:{value}" for name, value in SOURCE_HASHES.items()},
        "license": LICENSE,
        "accessLimits": "Public, ungated. The 514 MB release and generated cases stay under ignored evals/private/.",
        "selection": f"Both phases' labelled unique submissions with attack_attempt == 'True' and reason in {list(REASONS)}, parsed as 'Subject of the email: <s>. Body: <b>', body {MIN_BODY}-{MAX_BODY} characters. Ordered by SHA-256 of '<seed>/<phase>/<sha256(submission)>', deduplicated by normalized body (whitespace-collapsed, casefolded) and by its first {PREFIX_CHARS} normalized characters. Strata: phase x judge reason x body-length tercile (edges over the deduplicated pool); first {PER_STRATUM} per stratum, 300 total.",
        "sampling": {"seed": SEED, **stats},
        "labelMeaning": "Upstream attack-attempt annotations (API call triggered, or LLM judge), not success against any defense. Attack-only: use caseSelector positive. The case text is Subject plus body as an email. May overlap the private llmail-phase2-positive-400 cohort; do not pool them as independent evidence.",
        "facets": ["phase", "judge_reason", "length_tercile", "pool_index", "submission_sha256", "attack_template_id"],
    }


def cohort_provenance():
    return {
        **lp.PROVENANCE_BASE,
        "payloadPool": {"datasetId": POOL_ID, "repository": REPOSITORY, "revision": REVISION},
        "license": f"LongPIBench synthetic emails MIT; LLMail-Inject payloads {LICENSE}",
        "accessLimits": "Generated case text stays under ignored evals/private/.",
        "selection": "All 100 LongPIBench emails as clean siblings. Email item i receives pool payloads i, 100+i and 200+i at email_in_end, attachment_middle and attachment_end respectively, so all 300 pooled payloads are used once and every email has three attacked siblings.",
        "construction": "Only the payload body is inserted (its subject is dropped). email_in_end and attachment_end append after a blank line; attachment_middle inserts at a paragraph break chosen by SHA-256. Clean rendering is asserted byte-identical to upstream prepare_example(attack='no'), and the clean siblings are byte-identical to longpibench-email-default-v1's clean cases.",
        "labelMeaning": "A real competition attack attempt placed inside a long benign business email versus the clean email. Attack attempts were written for the LLMail scenario (exfiltrate to contact@contact.com), not for this summarize-and-reply task. Not observed compliance. Group by document_family.",
        "facets": ["document_family", "insertion_position", "pool_index", "phase", "judge_reason", "attack_template_id"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "evals/private/upstream/llmail-inject")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    pool, stats = select_pool(args.source_dir)
    emit(POOL_ID, pool_cases(pool), pool_provenance(stats), args.write_manifest)
    emit(COHORT_ID, cohort_cases(pool), cohort_provenance(), args.write_manifest)


if __name__ == "__main__":
    main()
