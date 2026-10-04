# LM Studio research progress

Updated 2026-10-04T04:55:08.248Z. 10 validated complete cells; 3 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|
| longpi-paper | gemma4-e4b-q4-thinking1024-full | 207/300 | 0/100 | 16.32 |
| benign-false-positives | gemma4-e2b-q4-thinking1024-full | 0/0 | 10/339 | 3.27 |
| benign-false-positives | gemma4-e4b-q4-thinking1024-full | 0/0 | 24/339 | 6.33 |
| benign-false-positives | gemma4-e2b-q4-thinking1024-preserve512 | 0/0 | 10/339 | 3.27 |
| benign-false-positives | gemma4-e4b-q4-thinking1024-preserve512 | 0/0 | 24/339 | 6.33 |
| longpi-code | gemma4-e4b-q4-thinking1024-full | 200/300 | 0/100 | 7.43 |
| bipia-email-mixed | gemma4-e2b-q4-thinking1024-full | 11/78 | 0/78 | 5.18 |
| bipia-email-mixed | gemma4-e4b-q4-thinking1024-full | 29/78 | 0/78 | 8.75 |
| bipia-email-mixed | gemma4-e2b-q4-thinking1024-preserve512 | 11/78 | 0/78 | 5.17 |
| bipia-email-mixed | gemma4-e4b-q4-thinking1024-preserve512 | 29/78 | 0/78 | 8.61 |

## Unfinished or abstaining cohorts

These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.

| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |
|---|---|---:|---|---:|---:|
| longpi-paper | gemma4-e2b-q4-thinking1024-full | 80/400 | {"scored":80,"unattempted":320} | 37/300 (240 unscored) | 0/100 (80 unscored) |
| longpi-paper | gemma4-e2b-q4-thinking1024-preserve512 | 1097/4717 | {"scored":80,"unattempted":320} | 47/300 (240 unscored) | 1/100 (80 unscored) |
| longpi-paper | gemma4-e4b-q4-thinking1024-preserve512 | 1097/4717 | {"scored":80,"unattempted":320} | 53/300 (240 unscored) | 0/100 (80 unscored) |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| longpi-paper | gemma4-e2b-q4-thinking1024-full | 80 | 0 | 8589.5 | 443.4 | 420.4 (80/80) | 7.15 | {"stop":80} |
| longpi-paper | gemma4-e4b-q4-thinking1024-full | 400 | 0 | 6966.7 | 407.6 | 386.6 (400/400) | 16.09 | {"stop":400} |
| longpi-paper | gemma4-e2b-q4-thinking1024-preserve512 | 279 | 818 | 754.5 | 344.1 | 321.1 (279/279) | 4.85 | {"stop":279} |
| longpi-paper | gemma4-e4b-q4-thinking1024-preserve512 | 279 | 818 | 753.5 | 305.8 | 284.6 (279/279) | 7.92 | {"stop":279} |
| benign-false-positives | gemma4-e2b-q4-thinking1024-full | 339 | 0 | 90.8 | 247.6 | 224.9 (339/339) | 3.08 | {"stop":339} |
| benign-false-positives | gemma4-e4b-q4-thinking1024-full | 339 | 0 | 89.8 | 232.5 | 211.9 (339/339) | 6.15 | {"stop":339} |
| benign-false-positives | gemma4-e2b-q4-thinking1024-preserve512 | 0 | 339 | unknown | unknown | unknown (0/0) | unknown | {} |
| benign-false-positives | gemma4-e4b-q4-thinking1024-preserve512 | 0 | 339 | unknown | unknown | unknown (0/0) | unknown | {} |
| longpi-code | gemma4-e4b-q4-thinking1024-full | 400 | 0 | 1740.7 | 234.3 | 213.1 (400/400) | 7.24 | {"stop":400} |
| bipia-email-mixed | gemma4-e2b-q4-thinking1024-full | 156 | 0 | 233.0 | 387.1 | 364.2 (156/156) | 4.99 | {"stop":156} |
| bipia-email-mixed | gemma4-e4b-q4-thinking1024-full | 156 | 0 | 232.0 | 320.1 | 298.8 (156/156) | 8.56 | {"stop":156} |
| bipia-email-mixed | gemma4-e2b-q4-thinking1024-preserve512 | 4 | 154 | 620.3 | 299.0 | 276.5 (4/4) | 4.08 | {"stop":4} |
| bipia-email-mixed | gemma4-e4b-q4-thinking1024-preserve512 | 4 | 154 | 619.3 | 313.8 | 293.3 (4/4) | 4.33 | {"stop":4} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
