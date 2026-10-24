# Qwen3.8 27B at `reasoning_effort: "low"` on the full Studio suites (2026-10-22/24)

Issue [#33](https://github.com/elicollinson/solenoid-security/issues/33).
[Pre-registration](../../reports/studio-qwen38-low-plan-2026-10.md) (commit `d77b6f4`, pushed before the first call).
[Report](../../reports/studio-qwen38-low-2026-10.md). `FINDINGS.md` O67. Research log L158.

Every script ran in place from this directory against the main checkout, which holds the data and checkpoints
(`cwd` = repo root). Checkpoints and per-case intermediates go to the git-ignored
`evals/runs/studio-qwen38-low-2026-10-22/`; `work/` holds case IDs and scores, not text. Everything published here is
an aggregate, a script, the plan or the progress log.

| File | Role |
|---|---|
| `make-suites.ts` → `evals/suites/…-t4096-qwen38low-v1.json`, `…-t4096-extension-qwen38low-v1.json` | Copies the frozen baseline (21) and extension (14) tests, strategy and rule unchanged. Adds one engine, #49's low engine byte-for-byte, and one condition, `baseline-qwen38-q8gguf-low-t4096-full`. Checks that the engine differs from the frozen one only in effort, effort note, ID and loaded identifier. |
| `make-plan.py` → `plan.json` | Suite hashes, per-test case counts from offline dry runs, and the estimate: frozen xhigh spans × 0.82, 20.9 h. |
| `rows.ts` | Per-case extraction through `auditPartialCheckpoint`, the same as #49's `rows.ts`. |
| `gate.ts`, `cell.ts`, `summarize-model.ts` | The gates: drift against #49's low arm, extension mechanism, and a per-cell completion and −12 `prompt_tokens` check. `summarize-model.ts` writes the `MODEL_DONE` line for each suite. |
| `run-chain.sh`, `run-queue.sh`, `queue.txt` | Orchestration. caffeinate, an LM Link wait guard, a dry-run preflight of all 35 cells, a 25 h cap, and `CELL`/`MODEL_DONE`/`HALTED` lines in `progress.log`. |
| `progress.log` | The run's progress log, verbatim. |
| `extract.ts` | Per-case rows (low and frozen xhigh, both suites) to `work/cases.json`. **Not published.** |
| `analyze.py` → `results/low-results.json` | The pre-registered analysis. Per dataset and group: BA, FPR, abstentions and AUROC. Paired exact McNemar with Holm and a bootstrap ΔBA. The O55 threshold fit on the baseline, applied to the extension. The profile rule, and cost. |

Reproduce (from the main checkout):

```sh
A=.claude/worktrees/qwen38-low-full/evals/analysis/studio-qwen38-low-2026-10-22   # or evals/analysis/... once merged
bun $A/extract.ts
uv run --no-project --python 3.12 --with numpy --with scipy $A/analyze.py
```

The xhigh columns in `low-results.json` reproduce the published frozen rows: baseline 0.8951, extension 0.8646, groups,
pooled FPR 43/1,973, and the O55 threshold of 0.15 (0.865 → 0.891). There were no deviations from the plan.
