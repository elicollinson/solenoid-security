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
  140 files are `verbatim`. 22 scripts are `path-adjusted`: they found their run directory from their own location or
  a hard-coded absolute path. The only change is that line, which now reads `RUN_DIR` (default
  `evals/runs/<run-id>`), and it is marked `published copy`. Nothing else was edited. Four later files were never in a
  run directory and have `-` for the original path and hash: `studio-baseline-t4096-2026-10-07/analyze-baseline.ts`
  (`authored`) and its output `results/baseline-results.json` (`generated`), plus
  `abliteration-pilot-2026-10/make-pilot-plan.ts` and `supplement-pilot.ts` (`authored`). The LLaDA2.2 pilot adds one
  `authored` script and its `generated` output, three `verbatim` progress logs, and three `host-redacted` files (two run
  scripts and the console log). Those three passed the private tailnet endpoint to `--base-url`. The published copy
  replaces that URL with the placeholder `$LLADA_BASE_URL`, and nothing else differs. The original SHA-256 is of the
  unredacted file.

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

### `abliteration-pilot-2026-10/`

The pre-registered [abliteration pilot](../reports/abliteration-pilot-plan-2026-10.md) (F7, #23), run on 2026-10-12
([results](../reports/abliteration-pilot-results-2026-10.md), `FINDINGS.md` O53, research log L150). These are the
original tracked scripts. The ones copied into `evals/runs/abliteration-pilot-2026-10/` at launch are byte-identical,
and `PROVENANCE.tsv` records them as `verbatim`.

| File | Computes |
|---|---|
| `make-pilot-plan.ts` | Freezes the seeded case subsets, writes the pilot suite and `pilot-plan.json`, verifies vanilla input hashes and estimates runtime. |
| `run-chain.sh`, `run-queue.sh`, `queue-pilot.txt` | Chain and queue orchestration: drift check, then heretic, then huihui. |
| `gate.ts`, `summarize-pilot.ts`, `pilot-rows.ts` | The drift and qualification gates, `MODEL_DONE` progress lines and read-only checkpoint extraction. |
| `compare-pilot.ts` | The pre-registered three-way comparison on identical cases: per-test and band metrics, paired McNemar flips and probe score shifts (`comparison.json`, `comparison.md`). |
| `supplement-pilot.ts` | **Authored after the run.** Holm over the two primary tests, H1/H2 thresholds, attack strata, paired accuracy intervals, escalation-rule checks, and a post-hoc descriptive keyword screen of reasoning on newly missed attacks (counts only) (`supplement.json`). |
| `results/` | `comparison.json`, `comparison.md`, `supplement.json`: counts, rates, scores, token/timing statistics and case IDs only. |

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

### `llada-pilot-2026-10/`

The LLaDA2.2 text-diffusion pilot ([#38](https://github.com/elicollinson/solenoid-security/issues/38)), run on
2026-10-18 ([report](../reports/llada-pilot-2026-10.md), `FINDINGS.md` O61, research log L153). Three MLX builds
served by an OpenAI-compatible MLX port (the `openai_compatible` engine) were run on the abliteration pilot's 998
cases. The run directory was `evals/runs/llada-pilot-2026-10-18/`. Checkpoints are under
`evals/runs/prompt-injection-openai-compat-llada22-{mini,variants}-pilot-v1/`.

| File | Computes |
|---|---|
| `analyze-llada-pilot.ts` | **Authored here, not copied from the run directory.** Audits all 108 cells (3 LLaDA builds + 9 comparators × 9 tests) through the abliteration pilot's `extractCheckpoint` and `auditPartialCheckpoint`, and checks identical labels and input hashes with `assertIdenticalCases`. It then writes `results/llada-pilot-results.json`: per model × test n, scored, abstentions, TPR, FPR/TNR, BA and AUROC; mean BA; pooled exact McNemar against Gemma26 and Qwen3.8 (Holm over 6) and per test; pre-screen recall, clearance and a simulated cascade into Gemma26; server timing statistics; the shapes of abstained outputs (counts only); and score-value distributions. Run with `DATA_ROOT` pointing at a checkout that holds `evals/runs` and the dataset sources. |
| `run-pilot.sh`, `run-variant.sh` | Serial cell loops for the 6-bit mini suite and the variants suite (`$1` = condition). `host-redacted`: set `LLADA_BASE_URL` to the server's `/v1` URL. The header comment of `run-variant.sh` was copied from `run-pilot.sh` and still says 6-bit. |
| `progress.log`, `progress-pilot-llada22-*-4bit-t128-full.log`, `console.log` | `START`/`CELL`/`PILOT_DONE` lines per condition and the runner's console output (`console.log` is `host-redacted`). The 6-bit feasibility-24 cell ran before `run-pilot.sh` and has no progress line. |
| `results/` | `llada-pilot-results.json`: counts, rates, scores and timings only (`PROVENANCE.tsv` marks it `generated`). It has no case IDs, case text, model output or endpoint URLs. |

### `llada-window-sweep-2026-10/`

**Exploratory** LLaDA2.2 window sweep ([#38](https://github.com/elicollinson/solenoid-security/issues/38)), run on
2026-10-18 ([report](../reports/llada-window-sweep-2026-10.md), `FINDINGS.md` O62, research log L154). Window size
{64, 128, 256, 512} × overlap {0, 50, 75%}, plus 512/384, was run on Flash 4-bit, and three configs on mini 6-bit.
Eight content types were covered, with offline aggregation, abstention-policy, coverage-only and cascade replays.
The folder also holds the first 512/384 window test's runner and logs. See the folder's own `README.md` for the file
table. Scripts are `verbatim`, `path-adjusted` (default output path only) or `host-redacted` (console logs), as
listed in `PROVENANCE.tsv`. `results/` is `generated`.

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

The Studio Q8 full-text baseline: the superseded 1,024-token attempt and the completed 4,096-token one
([baseline report](../reports/studio-baseline-q8-t4096-2026-10.md), `FINDINGS.md` O48–O52 and Appendix A).

| File | Computes |
|---|---|
| `make-baseline-plan.py` | Freezes roster, protocol and runtime estimate (`baseline-plan.json`, `queue-baseline.txt`). |
| `qualification-audit.py`, `run-qualification.sh` | First-6 qualification per candidate (`qualification-summary.json`). |
| `summarize-model.ts`, `summarize-model-rerun1.ts` | Read-only per-model summary (mean balanced accuracy, abstentions) appended to `progress.log` after each model (the `MODEL_DONE` lines). The rerun1 copy differs only in reading Gemma31's encoding-benign-controls rerun (L148). |
| `analyze-baseline.ts` | **Authored here, not copied from the run directory.** Final offline analysis of the 4,096-token baseline: re-audits all 7 × 21 checkpoints with `auditPartialCheckpoint` (Gemma31 rerun1 substitution; the failed attempt is recorded by hash and excluded), cross-checks every `MODEL_DONE` line, and writes `results/baseline-results.json` (per cell n, scored, abstentions by kind, TPR/FPR/TNR with Wilson intervals, balanced accuracy; per-type means; MoE vs dense; native speed stats; Laguna's abstentions; the per-pair policy audit). Run with `RUN_DIR` pointing at the checkpoints and `DATA_ROOT` at a checkout holding `evals/private`. |
| `run-baseline-chain.sh`, `run-baseline-queue.sh` / `run-chain.sh`, `run-chain-resume.sh`, `run-chain-rerun1.sh`, `run-queue.sh`, `run-queue-rerun1.sh`, `queue-*.txt` | Chain and queue orchestration (resume after the Qwen3.6 27B deferral, L147; rerun1 after the Gemma31 LM Link failure, L148). The rerun1 cell uses suite `evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-rerun1-v1.json`. |
| `results/` | `baseline-plan.json`, `qualification-summary.json` (plus `SUPERSEDED.json` for the 1,024-token attempt). For the 4,096-token run, these were re-checked after completion and are byte-identical to the final run files (the plan was frozen before inference). Also `QWEN36-27B-DEFERRED.json` and `baseline-results.json` (generated by `analyze-baseline.ts`; `PROVENANCE.tsv` marks it `generated`). |

## Not published

- **Outputs that keep text:** `attack-following-evidence-2026-10-04/local-output-anomalies.json` (raw wire response
  bodies), `lmstudio-qwen38-full-2026-10-04/bipia-first-length-abstention.json` and `bipia-length-abstentions.json`
  (case text and reasoning), `bipia-translation-diagnostic-2026-10-04/comparison.json` (model rationales quoting
  payloads) and `lmstudio-thinking1024-2026-10-03/bipia-payload-inspection.json`.
- **Scratch and logs:** `lmstudio-thinking1024-2026-10-03/inspect-e2b-paper-false-positive.ts` and
  `inspect-email-window-plan.ts` (one-off debugging that prints case segments), `lmstudio-studio-2026-10-05/brief.sh`
  (console one-liner), and all `*.log` except the `llada-pilot-2026-10/` and `llada-window-sweep-2026-10/` logs above, `driver.ndjson` and LM Studio inventory snapshots.
- **Third-party code:** `research-literature-2026-10-03/` (vendored upstream benchmark code from the literature scan).
- **Run checkpoints** (`*.jsonl` with native responses) and anything under `evals/private/`.
