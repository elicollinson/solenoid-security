# LM Studio research progress

Updated 2026-10-04T06:04:11.957Z. 0 validated complete cells; 2 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|

## Unfinished or abstaining cohorts

These rows retain unscored cases. Flags are observed counts, not full-cohort accuracy. No invalid output is retried for a better score.

| Cohort | Condition | Scored segments | Coverage by status | Observed attack flags / all attacks | Observed benign flags / all benign |
|---|---|---:|---|---:|---:|
| longpi-paper | granite42-30b-mlx8-none1024-full | 0/400 | {"output_abstention":1,"unattempted":399} | 0/300 (300 unscored) | 0/100 (100 unscored) |
| longpi-paper | granite42-30b-mlx8-promptjson-high1024-full | 1/400 | {"scored":1,"length_abstention":3,"unattempted":396} | 0/300 (300 unscored) | 0/100 (99 unscored) |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| longpi-paper | granite42-30b-mlx8-none1024-full | 1 | 0 | 10464.0 | 10.0 | 9.0 (1/1) | 82.16 | {"stop":1} |
| longpi-paper | granite42-30b-mlx8-promptjson-high1024-full | 4 | 0 | 10515.3 | 1000.5 | 997.8 (4/4) | 153.01 | {"stop":1,"length":3} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
