# Qwen3.8 reasoning-effort ablation and Muse threshold fit (2026-10-20/21)

Issue [#33](https://github.com/elicollinson/solenoid-security/issues/33). [Pre-registration](../../reports/qwen38-effort-ablation-plan-2026-10.md)
(commit `7091f85`, pushed before the main run). [Report](../../reports/qwen38-effort-ablation-2026-10.md). `FINDINGS.md`
O65 and O66. Research log L157.

Every script was run in place from this directory, against the main checkout that holds the data and checkpoints
(`cwd` = repo root). Checkpoints and per-case intermediates go to the git-ignored
`evals/runs/qwen38-effort-ablation-2026-10/` (`work/` holds case IDs and scores, not text). Everything published here
is an aggregate, a script, the plan, or the synthetic probe.

| File | Role |
|---|---|
| `probe/probe-effort-mechanism.ts`, `probe/probe-results.ndjson` | Step 0 mechanism probe. It loads the frozen Q8_0 Qwen3.8 under a probe identifier and sends synthetic requests under each candidate effort mechanism (request fields, a `--chat-template-kwargs` load override, a patched template), recording `prompt_tokens`, reasoning tokens and a hash of the reasoning. Notes on the log: the 20:54 and 20:58:31–20:58:41 runs used max_tokens 16, and the 20:58:55 runs used 4096. The entries whose `loadConfig` contains a space (`"template-xhigh-noinstr 4096"`, `"kwargs-medium 16"`, `"default-full 4096"`) came from a shell quoting mistake. The two with an invalid effort string failed to start llama-server (the template raises on an unknown effort when it renders at load). `"default-full 4096"` fell through to the short request list. All three were rerun correctly. |
| `make-plan.ts` → `plan.json`, `evals/suites/prompt-injection-lmstudio-studio-qwen38-effort-ablation-q8-t4096-v1.json` | Freezes engines (the frozen Qwen3.8 engine with only `reasoning_effort` and `effort_mechanism` changed), the seeded subsets (`caseIds`), the frozen-input-hash check and the estimate. |
| `rows.ts` | Shared per-case extraction through `auditPartialCheckpoint`, plus prompt, reasoning and wall time. |
| `gate.ts`, `cell.ts` | Queue gates (drift, mechanism) and per-cell `CELL` progress lines. `cell.ts` was fixed mid-run (see deviations). |
| `run-chain.sh`, `run-queue.sh`, `queue.txt`, `queue-resume1.txt` | Orchestration: caffeinate, LM Link wait guard, preflight dry run of every cell, 8 h cap, `progress.log` lines. |
| `progress.log` | The run's progress log, verbatim. |
| `extract-frozen.ts` | Audits the frozen baseline and extension checkpoints (per `MODELS`) into `work/frozen-cases.json`. **Not published.** |
| `extract-ablation.ts` | Per-case rows for the frozen xhigh arm, the drift re-run and the medium and low arms, written to `work/ablation-cases.json`. **Not published.** |
| `analyze.py` → `results/ablation-results.json` | The pre-registered analysis: drift, mechanism, per-dataset and group BA, AUROC and score bands, primary and Holm-family exact McNemar with paired bootstrap ΔBA and ΔAUROC, the out-of-sample threshold, and cost (Wilcoxon). |
| `muse-threshold.py` → `results/muse-threshold.json` | Step 3: O55's threshold method applied to Muse, with Qwen3.8 recomputed as a check, plus a bootstrap interval on the out-of-sample gain. |
| `comparators.py` → `results/comparators.json` | Context only, not pre-registered: frozen Qwen3.6 35B-A3B, Gemma26 and Muse on the identical case IDs. |

Reproduce (from the main checkout):

```sh
A=.claude/worktrees/qwen38-effort/evals/analysis/qwen38-effort-ablation-2026-10   # or evals/analysis/... once merged
MODELS=qwen38-q8gguf,muse-q8,qwen36-35b-a3b-q8,gemma26-q8 bun $A/extract-frozen.ts
bun $A/extract-ablation.ts
uv run --no-project --python 3.12 --with numpy --with scipy $A/analyze.py
uv run --no-project --python 3.12 --with numpy $A/muse-threshold.py
uv run --no-project --python 3.12 --with numpy $A/comparators.py
```

**Deviations from the plan.**

1. `cell.ts` first required a checkpoint's `complete` marker. A cell that finishes with abstentions has none (the
   frozen runs behave the same way, and the driver treats such a cell as finished). The queue therefore halted at
   22:05:40 UTC after `bipia-table-mixed` at medium, which had 3 length abstentions. The fix accepts "every case ID
   finished, scored or abstained". The queue resumed 47 s later from `queue-resume1.txt`, starting at that cell's CELL
   step, so the drift tranche did not re-run. No data was affected.
2. The O55 threshold candidates were the union of three models' scores. `muse-threshold.py` uses each model's own
   scores. The Qwen3.8 recomputation reproduces O55 exactly (0.15; 0.8646 → 0.8905).
