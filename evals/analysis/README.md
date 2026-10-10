# Published analysis scripts and results

The research runs wrote their checkpoints, ad hoc analysis scripts and derived summaries under git-ignored
`evals/runs/<run-id>/`. This directory publishes the scripts that produced numbers cited in tracked docs, the
orchestration scripts that record how each run was executed, and the aggregate result files a reviewer needs to check
those numbers without rerunning inference. Folder names mirror the original run ids.

- **`<run-id>/*.ts|py|sh|txt`** are copies of the scripts and queue files from `evals/runs/<run-id>/`.
- **`<run-id>/results/`** holds derived JSON/Markdown outputs, copied byte for byte. Each was inspected before
  publishing: it holds counts, rates, scores, token and timing statistics, case IDs and SHA-256 hashes. It holds no
  case text, prompt text or model rationale. The only model output kept is the score-only final answer
  (`{"concernScore":0.2}`) in a few audit files.
- **[`PROVENANCE.tsv`](PROVENANCE.tsv)** maps every published file to its original path and original SHA-256.
  125 files are `verbatim`. 21 scripts are `path-adjusted`: they found their run directory from their own location or
  a hard-coded absolute path. The only change is that line, which now reads `RUN_DIR` (default
  `evals/runs/<run-id>`), and it is marked `published copy`. Nothing else was edited.

## Running them

Every script is offline: it reads saved checkpoints and never calls a model. Run from the repository root:

```sh
bun evals/analysis/<run-id>/<script>.ts         # TypeScript
python3 evals/analysis/<run-id>/<script>.py     # Python
```

Inputs are the run checkpoints under `evals/runs/<run-id>/` (and sometimes other runs), which are not in git, plus
the canonical dataset sources each manifest names. Public sources can be rebuilt with `bun run eval:fetch-public`,
`bun run eval:fetch-bipia` and the `evals/scripts/import-*.py` adapters. LLMail, PIDS and other restricted sources
stay in `evals/private/` and are not distributed. Without the checkpoints, use the `results/` copies. For example,
the Studio chunking tables render straight from the published summary:

```sh
RUN_DIR=evals/analysis/lmstudio-studio-2026-10-05/results python3 evals/analysis/lmstudio-studio-2026-10-05/render-chunking-tables.py
```

Most scripts write their output back into `evals/runs/<run-id>/`. The 16 scripts that name a path under
`evals/reports/` also regenerate the tracked report they feed (`grep -l evals/reports` lists them). A rerun on the same checkpoints should reproduce the
committed report except for timestamps. The `*.sh` files and `queue-*.txt` step files are records of procedure. They
drive LM Studio through `bun run eval:local`, cd into the original checkout path, and call sibling scripts in
`evals/runs/<run-id>/` where they originally ran. They are published as-is and are not meant to be rerun from here.

## Index

The research log is [`evals/reports/research-log-2026-09-29.md`](../reports/research-log-2026-09-29.md). Unless noted,
each script below is named in it.

### `attack-following-evidence-2026-10-04/`

Cited by [injection-following findings](../reports/injection-following-findings-2026-10-04.md) and `FINDINGS.md`.

| File | Computes |
|---|---|
| `audit-sources.ts` | Re-hashes every source checkpoint behind `sample-set.json` and writes `source-audit.json`. |
| `results/sample-set.json`, `case-index.jsonl`, `case-appendix.md`, `source-audit.json` | The 72-case attack-following evidence set (IDs, hashes, score-only outputs) and its source audit. Built by tracked `evals/scripts/build-attack-following-evidence.py`. |

### `bipia-score-distribution-2026-10-04/`

| File | Computes |
|---|---|
| `analyze.py` | Post-hoc BIPIA score distributions, AUC and illustrative threshold sensitivity from `lmstudio-available-panel-2026-10-04/bipia-full-comparison.json`. Writes `comparison.json` and [the report](../reports/lmstudio-bipia-score-distribution-2026-10-04.md). |
| `results/comparison.json` | Its output. |

### `bipia-translation-diagnostic-2026-10-04/`

| File | Computes |
|---|---|
| `compare.ts` | Outcome-selected comparison of the five translation-task attacks across saved protocols. Writes [the report](../reports/lmstudio-bipia-translation-diagnostic-2026-10-04.md). Its `comparison.json` is **not** published because it keeps model rationales that quote attack text. |

### `lmstudio-available-panel-2026-10-04/`

| File | Computes |
|---|---|
| `summarize-full-baselines.ts` | Full-input panel table across cohorts and models (`full-baseline-comparison.json`, [dense/MoE baselines](../reports/lmstudio-dense-moe-full-baselines-2026-10-04.md)). |
| `compare-bipia.ts` | BIPIA full-input comparison (`bipia-full-comparison.json`, [panel BIPIA](../reports/lmstudio-panel-bipia-2026-10-04.md)). |
| `compare-notinject.ts` | NotInject benign false-positive comparison (`notinject-comparison.json`, [panel NotInject](../reports/lmstudio-panel-notinject-2026-10-04.md)). |
| `compare-numeric-probes.ts` | Numeric score-counterfactual probe comparison (`numeric-probe-comparison.json`, [numeric probes](../reports/lmstudio-panel-numeric-probes-2026-10-04.md)). |
| `compare-armor-numeric-reference.ts` | Re-audits the retained Model Armor numeric reference (`numeric-probe-armor-reference.json`). |
| `compare-first6-protocol.ts` | Larger-model protocol check on the first six paper families (`first6-protocol-comparison.json`). |
| `audit-first6-work.py` | Native work accounting for the identical 24-case tranche (`first6-native-work-audit.json`, [native work](../reports/lmstudio-native-work-2026-10-04.md)). |
| `audit-full-cohort.ts` | Independent source-linked audit of one full-input checkpoint (args: checkpoint, manifest, expected cases, output). |
| `audit-gemma26-notinject.ts`, `audit-muse-notinject.ts` | Independent native-score recounts plus input equivalence for NotInject. |
| `audit-gemma26-paper-first20.py`, `audit-gemma26-paper-window-attribution.ts` | Gemma26 paper first-20 audit and attack-span window overlap. |
| `audit-domain-window-coverage.ts` | Preserved-window coverage of the frozen domains. |
| `plan-gemma26-paper-reuse.ts` | Exact-input reuse plan for the Gemma26 paper window run. |
| `results/` | `bipia-full-comparison.json`, `notinject-comparison.json`, `numeric-probe-comparison.json`, `numeric-probe-armor-reference.json`, `first6-protocol-comparison.json`, `first6-native-work-audit.json`. |

### `lmstudio-code-panel-2026-10-04/`

| File | Computes |
|---|---|
| `prepare.ts` | Freezes the 400-case code-review cohort and audits prior model cells (`full-code-plan.json`). |
| `compare-full-code.ts` | Code-review baselines, including Model Armor (`full-code-comparison.json`, [code baselines](../reports/lmstudio-full-code-baselines-2026-10-04.md)). |
| `results/` | `full-code-plan.json`, `full-code-comparison.json`. |

### `lmstudio-hosted-transfer-2026-10-04/`

| File | Computes |
|---|---|
| `compare-gemma26.ts` | Hosted DeepInfra FP8 vs local MLX 8-bit Gemma26 on matched inputs (`comparison.json`, [hosted transfer](../reports/lmstudio-hosted-transfer-2026-10-04.md)). Not named in the research log. |
| `results/comparison.json` | Its output. |

### `lmstudio-long-email-2026-10-04/`

| File | Computes |
|---|---|
| `summarize-long-email.ts` | Paired full vs window analysis of the first 20 long-email families (`lmstudio-{e2b,e4b,gemma26}-long-email-first20-*.json`, matching reports). |
| `summarize-email-panel.ts` | Assembles completed email pairs (`panel-comparison.json`). |
| `compare-domain-families.py` | Family bootstrap, paper vs email (`domain-family-comparison.json`, [domain comparison](../reports/lmstudio-chunking-domain-comparison-2026-10-04.md)). |
| `replay-full-window-cascade.py` | Post-hoc full-then-windows cascade replay (`full-window-cascade-replay.json`, [cascade replay](../reports/lmstudio-full-window-cascade-replay-2026-10-04.md)). |
| `audit-armor-email-reference.ts` | Historical Model Armor email reference (`armor-full-reference.json`). |
| `audit-email-first20.py`, `audit-gemma26-email-first20.py`, `audit-email-payload-coverage.ts` | Independent re-audits and payload-span coverage. |
| `results/` | The three first-20 summaries, `domain-family-comparison.json`, `full-window-cascade-replay.json`, `armor-full-reference.json`. |

### `lmstudio-new-panel-v2-2026-10-04/`

| File | Computes |
|---|---|
| `summarize-moe-dense.py` | MoE vs dense group summary (`moe-dense-panel-summary.json`, [MoE vs dense panel](../reports/lmstudio-moe-dense-panel-2026-10-05.md), `FINDINGS.md`). |
| `qualification-audit.py` | First-6 qualification audit per condition. |
| `run-queue.sh`, `queue-main.txt`, `queue-resume.txt` | Serial LM Link queue and its step files. |
| `results/` | `moe-dense-panel-summary.json`, `laguna-token-accounting-audit.json` (cited by `FINDINGS.md` and the panel report). |

### `lmstudio-qwen38-full-2026-10-04/`

| File | Computes |
|---|---|
| `audit-numeric-full.py` | Native-output audit of the Qwen3.8 numeric cohort (`numeric-full-audit.json`, cited by injection-following findings). |
| `audit-bipia-abstentions.py`, `audit-numeric-abstentions.py` | Retain and classify length abstentions. Their outputs are **not** published because they embed case text and reasoning. |
| `validate-next-cohorts.ts` | Validates the next cohorts against completed references. |
| `results/` | `numeric-full-audit.json`, `qualification-audit.json`, `bipia-full-audit.json`, `email-full-audit.json`, `notinject-full-audit.json`. |

### `lmstudio-studio-2026-10-05/`

Study A (chunking, MoE vs dense) and Study B planning on the Mac Studio. Cited by the
[Studio chunking study](../reports/lmstudio-studio-chunking-moe-dense-2026-10-06.md), `FINDINGS.md` O46 and the
[research index](../reports/lmstudio-research-index-2026-10-04.md).

| File | Computes |
|---|---|
| `make-chunking-plan.py` | Freezes the Study A plan before inference (`chunking-moe-dense-plan.json`). |
| `summarize-studio-chunking.ts` | Validates checkpoints and extracts paired full/window rows (`chunking-rows.json`). |
| `analyze-studio-chunking.py` | Study A statistics: bootstrap, permutation, cascade (`chunking-moe-dense-summary.json`). |
| `render-chunking-tables.py` | Markdown tables for the report from the summary. |
| `qualification-audit.py`, `diag-pass.py` | First-6 qualification audit and pass/fail gate (`qualification-summary.json`). |
| `compare-studio-macbook.py`, `compare-transport.py` | Studio vs MacBook and `/v1` vs `/api/v0` equivalence (`studio-vs-macbook-first6.json`, `transport-equivalence.json`). |
| `make-ladder-plan.py`, `make-batching-plan.py`, `decide-batching.py`, `qwen-quant-hook.py` | Study B plan amendment, batching check and quant hook (`study-b-plan-amendment-1.json`, `batching-plan.json`). |
| `summarize-quant-ladder.ts`, `summarize-ladder-chunking.ts` | Study B summaries (Study B is paused). |
| `run-*.sh`, `queue-study-*.txt` | Queue, chain, qualification and MLX diagnostic orchestration, including the paused and `.unpaused` copies cited in `FINDINGS.md`. |
| `results/` | `chunking-moe-dense-summary.json`, `chunking-moe-dense-plan.json`, `chunking-moe-dense-plan-amendment-1.json`, `study-b-plan-amendment-1.json`, `batching-plan.json`, `qualification-summary.json`, `transport-equivalence.json`, `studio-vs-macbook-first6.json`. |

### `lmstudio-thinking1024-2026-10-03/`

| File | Computes |
|---|---|
| `compare-generation.ts`, `compare-first20-full.ts`, `compare-bipia.ts` | Generation-setting comparisons for E2B/E4B (`lmstudio-generation-*.json`, `first20-full-generation-comparison.json`, `bipia-comparison.json`, [BIPIA comparison](../reports/lmstudio-bipia-comparison-2026-10-03.md)). |
| `audit-paper-first20.py`, `audit-paper-first20-e2b.py`, `audit-paper-window-attribution.ts` | Paper first-20 audits and attack-span overlap. |
| `audit-cross-study-reuse.ts`, `audit-cross-study-reuse-e2b.ts` | Cross-study exact-input window reuse audits. |
| `analyze-paper-baseline.ts`, `score-overlap.ts`, `inspect-generation-score-overlap.ts` | Paper baseline diagnostics and score-overlap threshold replays. `score-overlap.ts` also writes `bipia-payload-inspection.json`, which is **not** published because it keeps recovered payload text. |
| `results/` | The three paper-window first-20 summaries (cited by their reports), `benign-split-comparison.json`, `segment-equivalence-audit.json`, `bipia-comparison.json`, `first20-full-generation-comparison.json`, `cross-study-window-reuse-audit{,-e2b}.json`. |

### `reuse-verification-2026-10-03/`

| File | Computes |
|---|---|
| `verify-reuse.ts` | Zero-call reuse verification with a fetch guard ([reuse verification](../reports/reuse-verification-2026-10-03.md)). |
| `results/summary.json` | Its summary. |

### `studio-baseline-2026-10-07/` and `studio-baseline-t4096-2026-10-07/`

The Studio Q8 full-text baseline: the superseded 1,024-token attempt and the running 4,096-token one (README
"Now running", `FINDINGS.md` Appendix A).

| File | Computes |
|---|---|
| `make-baseline-plan.py` | Freezes roster, protocol and runtime estimate (`baseline-plan.json`, `queue-baseline.txt`). |
| `qualification-audit.py`, `run-qualification.sh` | First-6 qualification per candidate (`qualification-summary.json`). |
| `summarize-model.ts` | Read-only per-model summary (mean balanced accuracy, abstentions) appended to `progress.log` after each model. This is the source of the "Now running" numbers. |
| `run-baseline-chain.sh`, `run-baseline-queue.sh` / `run-chain.sh`, `run-chain-resume.sh`, `run-queue.sh`, `queue-*.txt` | Chain and queue orchestration. |
| `results/` | `baseline-plan.json`, `qualification-summary.json` (plus `SUPERSEDED.json` for the 1,024-token attempt). The 4,096-token plan is a snapshot taken while the baseline was still running. |

## Not published

- **Outputs that keep text:** `attack-following-evidence-2026-10-04/local-output-anomalies.json` (raw wire response
  bodies), `lmstudio-qwen38-full-2026-10-04/bipia-first-length-abstention.json` and `bipia-length-abstentions.json`
  (case text and reasoning), `bipia-translation-diagnostic-2026-10-04/comparison.json` (model rationales quoting
  payloads) and `lmstudio-thinking1024-2026-10-03/bipia-payload-inspection.json`.
- **Scratch and logs:** `lmstudio-thinking1024-2026-10-03/inspect-e2b-paper-false-positive.ts` and
  `inspect-email-window-plan.ts` (one-off debugging that prints case segments), `lmstudio-studio-2026-10-05/brief.sh`
  (console one-liner), and all `*.log`, `driver.ndjson` and LM Studio inventory snapshots.
- **Third-party code:** `research-literature-2026-10-03/` (vendored upstream benchmark code from the literature scan).
- **Run checkpoints** (`*.jsonl` with native responses) and anything under `evals/private/`.
