# LM Studio research progress

Updated 2026-10-03T22:39:21.045Z. 3 validated complete cells; 4 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|
| benign-false-positives | gemma4-e2b-q4-full | 0/0 | 2/339 | 0.70 |
| longpi-code | gemma4-e2b-q4-full | 0/300 | 0/100 | 0.89 |
| bipia-email-mixed | gemma4-e2b-q4-full | 2/78 | 0/78 | 0.70 |

## Unfinished or abstaining cohorts

These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.

| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |
|---|---|---:|---|---:|---:|
| longpi-paper | gemma4-e2b-q4-full | 399/400 | {"scored":399,"output_abstention":1} | 0/300 (1 unscored) | 0/100 (0 unscored) |
| longpi-paper | gemma4-e2b-q4-windows512 | 256/4717 | {"scored":17,"partially_scored":1,"unattempted":382} | 0/300 (288 unscored) | 0/100 (95 unscored) |
| benign-false-positives | gemma4-e4b-q4-full | 0/339 | {"length_abstention":1,"unattempted":338} | 0/0 (0 unscored) | 0/339 (339 unscored) |
| longpi-code | gemma4-e2b-q4-windows512 | 256/820 | {"scored":122,"unattempted":278} | 1/300 (209 unscored) | 0/100 (69 unscored) |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---|
| longpi-paper | gemma4-e2b-q4-full | 400 | 6965.7 | 17.9 | 0.0 (400/400) | 1.48 | {"stop":400} |
| longpi-paper | gemma4-e2b-q4-windows512 | 256 | 804.1 | 19.0 | 0.0 (256/256) | 0.56 | {"stop":256} |
| benign-false-positives | gemma4-e4b-q4-full | 1 | 81.0 | 64.0 | 61.0 (1/1) | 1.35 | {"length":1} |
| benign-false-positives | gemma4-e2b-q4-full | 339 | 88.8 | 19.0 | 0.0 (339/339) | 0.51 | {"stop":339} |
| longpi-code | gemma4-e2b-q4-full | 400 | 1739.7 | 18.9 | 0.0 (400/400) | 0.70 | {"stop":400} |
| longpi-code | gemma4-e2b-q4-windows512 | 256 | 910.7 | 18.8 | 0.0 (256/256) | 0.59 | {"stop":256} |
| bipia-email-mixed | gemma4-e2b-q4-full | 156 | 231.0 | 19.0 | 0.0 (156/156) | 0.52 | {"stop":156} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
