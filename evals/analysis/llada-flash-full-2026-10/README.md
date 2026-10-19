# LLaDA2.2-flash full run and confirmatory window test (PRE-REGISTERED, 2026-10-19)

This directory holds the scripts, queue, plan, logs and aggregate results for the pre-registered Flash run in
[#38](https://github.com/elicollinson/solenoid-security/issues/38). The pre-registration is
[`llada-flash-full-plan-2026-10.md`](../../reports/llada-flash-full-plan-2026-10.md) together with `plan.json`. Both
were committed and pushed before the first inference call. The results report is
[`llada-flash-full-2026-10.md`](../../reports/llada-flash-full-2026-10.md), and it is recorded as FINDINGS O63 and
research log L155.

**Where the data lives (all git-ignored).**

- Checkpoints use the default per-suite paths:
  - `evals/runs/prompt-injection-openai-compat-llada22-flash-baseline-v1/<test>/<condition>.jsonl`;
  - `evals/runs/prompt-injection-openai-compat-llada22-flash-extension-v1/<test>/<condition>.jsonl`.
- The logs were written to `evals/runs/llada-flash-full-2026-10-19/`.
- The suites here are byte-identical to the ones the checkpoints pin by SHA-256.

| File | What it is |
|---|---|
| `plan.json` | The machine-readable pre-registration: the cohort rule, window cohorts, hypotheses and families, policies, fallback, stopping rules and estimate. `analyze-flash.ts` reads its families from here. |
| `make-suites.ts` | Builds the two suites. Tests are copied verbatim from the Studio Q8 t4096 suites and the engine from the variants pilot. Window conditions are bound to the declared cohorts. It refuses to overwrite an existing suite. |
| `cohort-rule.ts` | Recomputes the window-cohort rule from the datasets and checks it against `plan.json`. It also prints the case counts, median words and window counts. |
| `queue.txt`, `run-queue.sh` | The 55 cells, run strictly serially. The runner can resume and retries transport failures (at most 3 per cell). It halts on any other failure and writes `START`/`BEGIN`/`CELL`/`ABST`/`RETRY`/`HALTED`/`DONE` lines. Set `LLADA_BASE_URL` to the server's `/v1` URL. |
| `check-cell.ts` | The post-cell abstention stop rule (10% on a declared window cohort). |
| `dryrun.tsv` | Planned calls per cell from dry runs (`run-suite.ts` without `--execute`). |
| `analyze-flash.ts` | Offline and read-only. It audits every checkpoint (`auditPartialCheckpoint`) and re-segments every case to check the window input hashes. It recomputes the 7 Q8 rows and cross-checks them against the published aggregates. It then runs H1–H3 exactly as declared, plus the exploratory analyses: position strata, which window fires, the cascade replay, abstentions, comparison with Gemma26 and Qwen3.8 on identical cases, latency, and determinism against the pilot and sweep. Run it with `DATA_ROOT` set to a checkout that holds `evals/runs` and the dataset sources. Optionally set `EXT_RESULTS` to the extension suite's `extension-results.json` (PR #37) for its cross-check. |
| `progress.log`, `console.log` | The run logs. The console log is `host-redacted`. |
| `results/flash-full-results.json`, `results/tables.md` | Aggregates only: counts, rates, p-values, intervals and timings. They contain no case IDs, case text, model output or endpoint URLs. |
