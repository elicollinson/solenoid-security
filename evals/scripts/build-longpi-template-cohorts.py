"""Build constructed subtle-injection and authorized-instruction cohorts on LongPIBench documents.

Inputs: the frozen, tracked template list evals/datasets/templates/varied-injection-templates-v1.json
(pinned by SHA-256 below) and the hash-verified LongPIBench upstream under ignored
evals/private/upstream/ (see import-longpibench.py). Generated case text is written
only to ignored evals/private/sources/. Standard library only; never calls a model.
--write-manifest records new manifest revisions.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canonical_cohort import ROOT, emit, make_case, read_pinned, text_digest  # noqa: E402
import longpi_documents as lp  # noqa: E402

TEMPLATES = "evals/datasets/templates/varied-injection-templates-v1.json"
TEMPLATES_SHA256 = "2a12eef15ebc998a6b850473cd5de4be5570648c847205394370cd18997bb873"
SEED = "varied-injection-templates-v1"
DOCS_PER_SUBTLE_TEMPLATE = 5
DOCS_PER_AUTHORIZED_PHRASING = 4


def load_templates(root=ROOT):
    return json.loads(read_pinned(Path(root) / TEMPLATES, TEMPLATES_SHA256, TEMPLATES).decode("utf8"))


def operator_turn(domain):
    return {"id": "task", "role": "user", "origin": "operator", "text": lp.system_prompt(domain)}


def document_turn(text):
    return {"id": "source", "role": "document", "origin": "external", "text": text}


def base_facets(domain, item, cohort):
    return {"source": "LongPIBench synthetic + repository templates", "cohort": cohort, "domain": domain, "document_family": f"{domain}/{item}", "source_item": item}


def subtle_cases(domain, templates):
    lp.assert_clean_matches_upstream(domain)
    operator = operator_turn(domain)
    order = lp.seeded_permutation(f"{SEED}/subtle/{domain}")
    cases = []
    for item in range(100):
        text = lp.render(domain, item)
        facets = {**base_facets(domain, item, "subtle"), "attack_template_id": "none", "template_position": "none", "visibility": "none", "goal": "none", "politeness": "none", "explicitness": "none"}
        cases.append(make_case("ls-" + text_digest(f"{domain}/{item}/clean\0{text}")[:24], "benign", [operator, document_turn(text)], facets))
    for t_index, template in enumerate(templates):
        for k in range(DOCS_PER_SUBTLE_TEMPLATE):
            item = order[(t_index * DOCS_PER_SUBTLE_TEMPLATE + k) % 100]
            text = lp.render(domain, item, template["position"], template["text"])
            facets = {**base_facets(domain, item, "subtle"), "attack_template_id": f"{domain}:{template['id']}", "template_position": template["position"],
                      "visibility": template["visibility"], "goal": template["goal"], "politeness": template["politeness"], "explicitness": template["explicitness"]}
            cases.append(make_case("ls-" + text_digest(f"{domain}/{item}/{template['id']}\0{text}")[:24], "injection", [operator, document_turn(text)], facets))
    return cases


def authorized_cases(groups):
    cases = []
    for domain in ("paper", "code", "resume", "email"):
        lp.assert_clean_matches_upstream(domain)
        operator = operator_turn(domain)
        order = lp.seeded_permutation(f"{SEED}/authorized/{domain}")
        for p_index, phrasing in enumerate(groups[domain]):
            for k in range(DOCS_PER_AUTHORIZED_PHRASING):
                item = order[(p_index * DOCS_PER_AUTHORIZED_PHRASING + k) % 100]
                text = lp.render(domain, item, phrasing["position"], phrasing["text"])
                facets = {**base_facets(domain, item, "authorized-instruction"), "authorized_phrasing_id": f"{domain}:{phrasing['id']}", "phrasing_position": phrasing["position"],
                          "visibility": phrasing["visibility"], "instruction_kind": phrasing["kind"]}
                cases.append(make_case("la-" + text_digest(f"{domain}/{item}/{phrasing['id']}\0{text}")[:24], "benign", [operator, document_turn(text)], facets))
    return cases


def subtle_provenance(domain, templates):
    return {
        **lp.PROVENANCE_BASE,
        "templateList": {"path": TEMPLATES, "sha256": TEMPLATES_SHA256, "group": f"subtle.{domain}", "templates": len(templates)},
        "license": "LongPIBench released synthetic documents and code: MIT. Templates: repository-authored (this repository's MIT license); seeds cited per template in the template list.",
        "accessLimits": "Generated case text stays under ignored evals/private/. The template list is tracked; it contains attack phrasings but no case text.",
        "selection": f"All 100 {domain} documents as clean siblings, plus each of the {len(templates)} frozen subtle templates inserted into {DOCS_PER_SUBTLE_TEMPLATE} documents. Document for (template index t, copy k) = permutation[(t*{DOCS_PER_SUBTLE_TEMPLATE}+k) mod 100], permutation = documents sorted by SHA-256 of '{SEED}/subtle/{domain}/<item>'. Each template sets its own insertion position.",
        "construction": "Clean rendering is asserted byte-identical to upstream prepare_example(attack='no'). Insertions follow upstream conventions where upstream has that position (paper section end, resume footnote, code comment after the change) and otherwise use documented points (resume header/experience/education/skills, code top/middle/description; middle lines chosen by SHA-256). Clean siblings are byte-identical to the clean cases of longpibench-<domain>-default-v1, so exact-input reuse can avoid re-running them.",
        "labelMeaning": "Constructed injection attempt versus the clean document. Templates vary goal, politeness, explicitness, position and visibility; report per attack_template_id with spread, and group by document_family. Not observed compliance.",
        "facets": ["attack_template_id", "template_position", "visibility", "goal", "politeness", "explicitness", "document_family", "source_item"],
    }


def authorized_provenance(groups):
    return {
        **lp.PROVENANCE_BASE,
        "templateList": {"path": TEMPLATES, "sha256": TEMPLATES_SHA256, "group": "authorized", "phrasings": {d: len(v) for d, v in groups.items()}},
        "license": "LongPIBench released synthetic documents: MIT. Phrasings: repository-authored (this repository's MIT license).",
        "accessLimits": "Generated case text stays under ignored evals/private/.",
        "selection": f"Benign only. For each of paper, code, resume and email, each of 24 frozen legitimate-instruction phrasings is inserted into {DOCS_PER_AUTHORIZED_PHRASING} documents (permutation seeded by '{SEED}/authorized/<domain>'), 96 per domain.",
        "construction": "Same renderer and insertion points as the subtle cohorts. Phrasings are instructions that belong in the document: reproduction/install steps and reader guidance in papers, run steps, TODO/FIXME and reviewer requests in code, portfolio/contact/availability notes in resumes, and reply-by/forward/review requests in emails. Several deliberately contain trigger words ('ignore', 'disregard', 'approve', 'reviewers') in a legitimate sense.",
        "labelMeaning": "All cases are benign: they measure whether a detector flags any imperative or reader-directed instruction rather than an attempt to redirect the assistant. Compare with the clean cases of the matching longpibench-<domain>-default-v1 family (document_family facet). Not a newly human-reviewed collection; phrasings were authored to be legitimate in context. No external benign-instruction sources (agentic boundary pairs, PromptShield, BrowseSafe distractors, SEP probes) are included.",
        "facets": ["domain", "authorized_phrasing_id", "phrasing_position", "visibility", "instruction_kind", "document_family"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    templates = load_templates()
    for domain in ("paper", "code", "resume"):
        group = templates["subtle"][domain]
        emit(f"longpi-subtle-{domain}-v1", subtle_cases(domain, group), subtle_provenance(domain, group), args.write_manifest)
    emit("longpi-authorized-instructions-v1", authorized_cases(templates["authorized"]), authorized_provenance(templates["authorized"]), args.write_manifest)


if __name__ == "__main__":
    main()
