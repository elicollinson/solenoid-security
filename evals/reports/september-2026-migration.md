# September 2026 safety-evaluation migration

The Solenoid Assistant research artifacts have been copied into this repository's evaluation workspace. The public/synthetic historical snapshots and aggregate reports are in `evals/archive/`; the LLMail-Inject positive source and original raw checkpoints are under ignored `evals/private/` and `evals/runs/`. The original assistant files remain intact. No provider calls were made during migration.

The offline importer produced **52,335** canonical segment observations. It verified source hashes, IDs, labels, exact historical chunk text and boundaries, full-text inputs, raw score ranges, Model Armor verdicts, and case decisions. All **14** test/condition totals matched the previous reports:

| Engine/input condition | Attack attempts flagged / 400 | Benign false positives / 339 |
| --- | ---: | ---: |
| Jev, full text | 190 | 10 |
| Jev, maximum-seven-word chunks | 204 | 78 |
| Gemma, full text | 340 | 16 |
| Gemma, maximum-seven-word chunks | 269 | 43 |
| Model Armor, high-sensitivity | 89 | 13 |
| Model Armor, medium base-detector | 46 | 7 |
| Model Armor, low-intensity | 16 | 2 |

`evals/runs/migrated-2026-09/observations.jsonl` holds one record per historical inference. Jev and Gemma records retain the **raw numeric scores**; Model Armor records retain the binary PI match state without treating it as a probability. The ignored manifest beside that file records per-condition observation and case counts. These are attack-attempt labels, not verified successful attacks; the benign source is a separate dataset.

The schema separates dataset, test, engine, input strategy, and decision rule. That allows, for example, Jev to use a different chunk size and threshold from Gemma without changing either dataset. Threshold replay uses saved observations, while changing segmentation or an engine/prompt version requires new inference. The original Gemma runs used the assistant's Agent protocol; the new direct-chat adapter has its own versioned prompt and must be treated as a new condition.
