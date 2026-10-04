# Mixed-reuse runner verification

This is a zero-inference mechanics test using previously captured NotInject scores. It verifies seeding, resume and summary accounting; it is not a new independent performance sample. The fetch function was disabled during execution.

Updated 2026-10-03T23:37:46.695Z. 1 validated complete cells; 0 partial cells.

All inference runs on the linked MacBook Pro. Full inputs and 512-word/384-stride windows use the same score-only prompt and >0.5 threshold. Local quantization and runtime differ from earlier hosted endpoints. Latency includes LM Link and before/after device checks. Costs are unmeasured, not estimated as zero. Complete-cohort results only; partial runs are listed in the raw summary with explicit unscored coverage.

| Cohort | Condition | Attacks detected | Benign flags | Mean request seconds |
|---|---|---:|---:|---:|
| benign-false-positives | gemma4-e4b-q4-thinking1024-preserve512 | 0/0 | 24/339 | 6.33 |

## Native completion work

All captured native completions are included, including invalid or token-limited outputs. Reused observations are listed separately and excluded from native request work. The complete-cohort latency table above includes source durations for reused observations; it is not elapsed time for a mixed run. Missing usage stays unknown; it is not zero. Means describe requests, not whole windowed documents. Dispatch-to-response timing includes local transport and placement checks; active requests and failures without a native response are excluded. Output tokens include reasoning where the runtime counts it that way. Known counts, totals and p95 values are retained in `summary.json`.

| Cohort | Condition | Native responses | Reused observations | Mean input tokens | Mean output tokens | Mean reasoning tokens (known) | Mean request seconds | Finish reasons |
|---|---|---:|---:|---:|---:|---:|---:|---|
| benign-false-positives | gemma4-e4b-q4-thinking1024-preserve512 | 0 | 339 | unknown | unknown | unknown (0/0) | unknown | {} |

Facet counts and paired disagreements are retained in the run directory’s `summary.json`. Repeated source families and templates are correlated; do not pool these cohorts into a deployment accuracy estimate.
