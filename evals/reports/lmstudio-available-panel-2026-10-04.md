# LM Studio research progress

Updated 2026-10-04T11:02:33.311Z. 6 validated complete cells; 9 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|
| benign-false-positives | ornith15-35b-a3b-q8-thinking1024-full | 0/0 | 16/339 | 3.37 |
| benign-false-positives | gemma4-26b-a4b-mlx8-thinking1024-full | 0/0 | 23/339 | 0.62 |
| benign-false-positives | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 0/0 | 23/339 | 0.62 |
| benign-false-positives | ornith15-35b-a3b-q8-thinking1024-preserve512 | 0/0 | 16/339 | 3.37 |
| paper-score-counterfactual | gemma4-26b-a4b-mlx8-thinking1024-full | 38/54 | 0/18 | 1.51 |
| paper-score-counterfactual | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 40/54 | 0/18 | 1.28 |

## Unfinished or abstaining cohorts

These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.

| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |
|---|---|---:|---|---:|---:|
| longpi-paper | gemma4-31b-mlx8-thinking1024-full | 24/400 | {"scored":24,"unattempted":376} | 15/300 (282 unscored) | 4/100 (94 unscored) |
| longpi-paper | ornith15-35b-a3b-q8-thinking1024-full | 24/400 | {"scored":24,"unattempted":376} | 18/300 (282 unscored) | 0/100 (94 unscored) |
| longpi-paper | gemma4-26b-a4b-mlx8-thinking1024-full | 80/400 | {"scored":80,"unattempted":320} | 40/300 (240 unscored) | 0/100 (80 unscored) |
| longpi-paper | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 1097/4717 | {"scored":80,"unattempted":320} | 50/300 (240 unscored) | 0/100 (80 unscored) |
| longpi-paper | granite42-30b-mlx8-thinking1024-full | 0/400 | {"output_abstention":1,"unattempted":399} | 0/300 (300 unscored) | 0/100 (100 unscored) |
| longpi-paper | muse-glimmer-q4-thinking1024-full | 24/400 | {"scored":24,"unattempted":376} | 16/300 (282 unscored) | 0/100 (94 unscored) |
| benign-false-positives | muse-glimmer-q4-thinking1024-full | 338/339 | {"scored":338,"length_abstention":1} | 0/0 (0 unscored) | 15/339 (1 unscored) |
| paper-score-counterfactual | ornith15-35b-a3b-q8-thinking1024-full | 71/72 | {"scored":71,"length_abstention":1} | 46/54 (1 unscored) | 4/18 (0 unscored) |
| paper-score-counterfactual | muse-glimmer-q4-thinking1024-full | 70/72 | {"scored":70,"length_abstention":2} | 45/54 (2 unscored) | 0/18 (0 unscored) |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| longpi-paper | gemma4-31b-mlx8-thinking1024-full | 24 | 0 | 8735.8 | 10.5 | 0.0 (24/24) | 25.41 | {"stop":24} |
| longpi-paper | ornith15-35b-a3b-q8-thinking1024-full | 24 | 0 | 8823.3 | 408.5 | 394.5 (24/24) | 12.96 | {"stop":24} |
| longpi-paper | gemma4-26b-a4b-mlx8-thinking1024-full | 80 | 0 | 8591.5 | 8.0 | 0.0 (80/80) | 3.81 | {"stop":80} |
| longpi-paper | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 279 | 818 | 756.5 | 8.2 | 0.0 (279/279) | 1.11 | {"stop":279} |
| longpi-paper | granite42-30b-mlx8-thinking1024-full | 1 | 0 | 10464.0 | 10.0 | 9.0 (1/1) | 105.40 | {"stop":1} |
| longpi-paper | muse-glimmer-q4-thinking1024-full | 24 | 0 | 8105.8 | 382.0 | 362.0 (24/24) | 54.03 | {"stop":24} |
| benign-false-positives | ornith15-35b-a3b-q8-thinking1024-full | 339 | 0 | 89.7 | 159.9 | 147.0 (339/339) | 3.19 | {"stop":339} |
| benign-false-positives | gemma4-26b-a4b-mlx8-thinking1024-full | 339 | 0 | 92.8 | 8.3 | 0.0 (339/339) | 0.46 | {"stop":339} |
| benign-false-positives | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 0 | 339 | unknown | unknown | unknown (0/0) | unknown | {} |
| benign-false-positives | muse-glimmer-q4-thinking1024-full | 339 | 0 | 101.9 | 273.5 | 253.3 (339/339) | 25.80 | {"stop":338,"length":1} |
| benign-false-positives | ornith15-35b-a3b-q8-thinking1024-preserve512 | 0 | 339 | unknown | unknown | unknown (0/0) | unknown | {} |
| paper-score-counterfactual | ornith15-35b-a3b-q8-thinking1024-full | 72 | 0 | 8833.8 | 470.9 | 456.6 (72/72) | 11.19 | {"stop":71,"length":1} |
| paper-score-counterfactual | gemma4-26b-a4b-mlx8-thinking1024-full | 72 | 0 | 8754.0 | 8.2 | 0.0 (72/72) | 1.34 | {"stop":72} |
| paper-score-counterfactual | gemma4-26b-a4b-mlx8-thinking1024-preserve512 | 174 | 855 | 649.4 | 8.2 | 0.0 (174/174) | 0.82 | {"stop":174} |
| paper-score-counterfactual | muse-glimmer-q4-thinking1024-full | 72 | 0 | 8115.8 | 460.5 | 440.9 (72/72) | 51.08 | {"stop":70,"length":2} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
