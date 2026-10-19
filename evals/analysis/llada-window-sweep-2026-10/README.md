# LLaDA2.2 window sweep (EXPLORATORY, 2026-10-18)

These are the scripts, queues, logs and aggregate results for the exploratory window sweep in
[#38](https://github.com/elicollinson/solenoid-security/issues/38). The report is
[`llada-window-sweep-2026-10.md`](../../reports/llada-window-sweep-2026-10.md), with `FINDINGS.md` O62 and research
log L154. **The sweep was not pre-registered and makes many comparisons on small subsamples.** See report §8 for the
confirmatory design.

The run directory was `evals/runs/llada-sweep-2026-10-18/`. Checkpoints are git-ignored. They are under
`evals/runs/prompt-injection-openai-compat-llada22-window-sweep-exploratory-v1/` for the sweep and
`evals/runs/prompt-injection-openai-compat-llada22-windows-pilot-v1/` for the first 512/384 test. Both suites are
byte-identical to the ones the checkpoints pin by SHA-256. The auditor resolves a suite by its id, so the file names
are the ids.

| File | What it is |
|---|---|
| `make-suite.ts` | Builds the sweep suite: seeded, label-balanced `selectSubset` draws from the pilot caseIds, the 13 window strategies, and Flash and mini 6-bit conditions. The engines are copied verbatim from the first window test suite. It refuses to overwrite an existing suite, because the checkpoints pin its hash. |
| `run-sweep.sh` | Strictly serial cell loop over a queue file (`<condition> <test>` lines), with `--continue-after-output-errors` and no dedup. It halts on any other failure. Set `LLADA_BASE_URL` to the server's `/v1` URL. |
| `queue-flash-short.txt`, `queue-flash-long.txt`, `queue-mini.txt` | The cells actually run, in order. |
| `dryrun-flash.txt` | Planned calls per Flash config × cohort from dry runs (`run-suite.ts` without `--execute`), used to trim the grid. |
| `analyze-sweep.ts` | Offline, read-only. Audits every checkpoint (`auditPartialCheckpoint`), re-segments each case and checks every window's input hash. It replays 7 decision rules × 3 abstention policies × raw/coverage-only windows on the window-level scores, plus the full-then-windows cascade. It pairs each cell with LLaDA full text (pilot checkpoints) and with Gemma26 and Qwen3.8 Q8 full text (exact McNemar), and runs a determinism check on byte-identical inputs. Writes `results/sweep-results.json`. Run with `DATA_ROOT` set to a checkout that holds `evals/runs` and the dataset sources. |
| `analyze-first-window.ts` | Recomputes the first window test (512/384, full pilot cohorts) against full text. Writes `results/first-window-results.json`. |
| `tables.py` | Markdown tables from `sweep-results.json` (`results/tables.md`). |
| `run-windows.sh`, `progress-windows.log`, `console-windows.log` | The first window test's runner and logs (from `evals/runs/llada-pilot-2026-10-18/`). |
| `progress-*.log`, `console-*.log` | `START`/`BEGIN`/`CELL`/`DONE` lines and runner console output. The console logs are `host-redacted`. |
| `results/` | Aggregates only: counts, rates, p-values and timings. They contain no case IDs, case text, model output or endpoint URLs. `sweep-results.json` stores `cells` and `latency` as `{columns, rows}`. |
