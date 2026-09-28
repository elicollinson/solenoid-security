---
name: add-eval-dataset
description: Add or revise a security evaluation dataset, its source adapter, labels, and test cohorts in solenoid-security. Use for new benchmark data or false-positive sets, not for changing an inference engine.
---

# Add an evaluation dataset

Work in `evals/`. Read `evals/README.md`, `evals/src/types.ts`, `evals/src/datasets.ts`, an existing `evals/datasets/*.json` manifest, and the target suite before editing.

1. Decide whether the request adds a **dataset** (cases, source turns, labels, facets) or a **test** (case selection and metrics). A dataset may contain both positive and negative cases; tests can select either class or all cases. Do not encode false-positive testing as a separate engine or assume every dataset is single-class.
2. Record source provenance, license or access limits, visibility, expected case count, revision, and source SHA-256 in a versioned manifest. Put nonpublic source material under ignored `evals/private/`; keep raw case content and case-level outputs out of tracked reports. Never invent labels or treat an attack-attempt label as proof of attack success.
3. Normalize each case to stable IDs, source turns with origin, annotations, facets, and text hashes. Prefer `canonical-jsonl` for a new shape; add an adapter in `evals/src/datasets.ts` only if needed. Preserve multi-turn structure when it matters. Validate IDs, labels, hashes, counts, and malformed input.
4. Add or update `EvalTest` entries in a versioned suite. Choose `caseSelector` and metrics from the question the test answers; use `all` and both detection and false-positive metrics for mixed labels. Keep dataset revision and annotation key aligned with the manifest.
5. Add focused tests for loading, class selection, and any new adapter. Run `bun run eval:typecheck`, `bun run eval:test`, and a dry run of the affected suite condition. A dry run estimates work; run live provider calls only when the task includes executing the evaluation.

Report the dataset and test IDs, class counts, provenance, validation result, and any label limitations.
