# LM Studio research progress

Updated 2026-10-04T02:33:29.546Z. 1 validated complete cells; 0 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|
| paper-score-counterfactual | gemma4-e4b-q4-thinking1024-preserve512 | 45/54 | 0/18 | 8.70 |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| paper-score-counterfactual | gemma4-e4b-q4-thinking1024-preserve512 | 174 | 855 | 646.4 | 331.1 | 309.7 (174/174) | 8.99 | {"stop":174} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
