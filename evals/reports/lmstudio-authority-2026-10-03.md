# LM Studio research progress

Updated 2026-10-03T22:39:20.742Z. 0 validated complete cells; 4 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|

## Unfinished or abstaining cohorts

These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.

| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |
|---|---|---:|---|---:|---:|
| longpi-paper | gemma4-e2b-q4-authority-full | 12/400 | {"scored":12,"output_abstention":12,"unattempted":376} | 4/300 (294 unscored) | 0/100 (94 unscored) |
| benign-false-positives | gemma4-e2b-q4-authority-full | 24/339 | {"scored":24,"unattempted":315} | 0/0 (0 unscored) | 0/339 (315 unscored) |
| longpi-code | gemma4-e2b-q4-authority-full | 23/400 | {"scored":23,"output_abstention":1,"unattempted":376} | 10/300 (282 unscored) | 2/100 (95 unscored) |
| bipia-email-mixed | gemma4-e2b-q4-authority-full | 24/156 | {"scored":24,"unattempted":132} | 1/78 (66 unscored) | 0/78 (66 unscored) |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---|
| longpi-paper | gemma4-e2b-q4-authority-full | 24 | 8875.8 | 16.8 | 0.0 (24/24) | 1.57 | {"stop":24} |
| benign-false-positives | gemma4-e2b-q4-authority-full | 24 | 224.9 | 19.0 | 0.0 (24/24) | 0.52 | {"stop":24} |
| longpi-code | gemma4-e2b-q4-authority-full | 24 | 1635.4 | 18.9 | 0.0 (24/24) | 0.63 | {"stop":24} |
| bipia-email-mixed | gemma4-e2b-q4-authority-full | 24 | 438.8 | 19.0 | 0.0 (24/24) | 0.54 | {"stop":24} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
