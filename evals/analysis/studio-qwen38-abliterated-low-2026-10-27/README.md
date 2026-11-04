# Abliterated Qwen3.8 27B builds at `reasoning_effort: "low"` on the full Studio suites (2026-10-27/30)

Issue [#23](https://github.com/elicollinson/solenoid-security/issues/23), stage 1.
- [Pre-registration](../../reports/studio-qwen38-abliterated-low-plan-2026-10.md): commit `3688376`, pushed before the
  first call, with amendments 1–4.
- [Report](../../reports/studio-qwen38-abliterated-low-2026-10.md). `FINDINGS.md` O68. Research log L159.

The chain ran from the feature worktree. Its git-ignored `evals/runs`, `evals/private`, datasets and `node_modules` are
symlinks into the main checkout, so outputs and the device lock are the main ones. Checkpoints and per-case
intermediates live in the git-ignored `evals/runs/studio-qwen38-abliterated-low-2026-10-27/`; `work/` holds case IDs
and scores, not text. Everything published here is an aggregate, a script, the plan or the progress log.

| File | Role |
|---|---|
| `make-suites.ts` → `evals/suites/…-qwen38-abliterated-low-v2.json` (baseline, extension) | Copies vanilla-low's tests, strategy and rule unchanged. Swaps in each build's identity, plus (v2) the load-time `low` template in `templates/`. |
| `make-retry-suites.ts` → `…-extension-…-v3/v4/v5.json`, `retry-suites.json` | Fresh-condition rerun suites (amendment 2). Only the suite and condition IDs change. |
| `make-plan.py` → `plan.json` | Suite hashes, per-test case counts and the estimate. |
| `probe/` | The probe showing LM Studio does not forward `reasoning_effort` to these GGUFs (amendment 1). |
| `rows.ts` | Per-case extraction through `auditPartialCheckpoint`. It analyzes the newest rerun checkpoint of a cohort; superseded partials are excluded. |
| `gate.ts`, `cell.ts`, `summarize-model.ts` | Drift gate, per-cell checks (completion, `prompt_tokens` = vanilla-low, identity, abstention excess) and `MODEL_DONE` lines. |
| `run-chain.sh`, `run-queue.sh`, `queue.txt`, `queue-restart-1*.txt` | Orchestration. caffeinate, LM Link guard, preflight, cap, and automatic transport reruns (amendment 2). The restart queues are documented in their headers. |
| `progress.log` | The run's progress log, verbatim. |
| `extract.ts` | Per-case rows (vanilla-low and both builds, both suites) to `work/cases.json`. **Not published.** |
| `analyze.py` → `results/abliterated-low-results.json` | The pre-registered analysis, described below. |

`analyze.py` covers:
- per dataset and group: BA, TPR, FPR, abstentions and AUROC;
- paired exact McNemar with Holm, and a bootstrap ΔBA;
- H1–H3 verdicts, heretic-ara vs huihui, O53 replication detail and covariates.

Reproduce (from the main checkout):

```sh
A=evals/analysis/studio-qwen38-abliterated-low-2026-10-27
DATA_ROOT=$PWD bun $A/extract.ts
uv run --no-project --python 3.12 --with numpy --with scipy $A/analyze.py
```

The vanilla-low columns reproduce O67: baseline 0.9117, extension 0.8997.

**Excluded checkpoints (kept on disk, untouched):**
- `bipia-email-mixed/baseline-qwen38-heretic-ara-q8-low-t4096-full.jsonl`: the v1 drift failure, run at xhigh;
- `repoguard-mixed/baseline-qwen38-heretic-ara-q8-lowtmpl-t4096-full.jsonl`: the 79/575 transport-halted partial,
  replaced by `…-lowtmpl-v3-t4096-full`.
