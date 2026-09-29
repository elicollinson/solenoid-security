# Security evaluations

This workspace is separate from the published screening SDK. It keeps the **data**, **test**, **inference engine**, **input strategy**, and **decision rule** independently versioned. A condition binds one engine to one strategy and rule. Conditions can differ by engine and by test; there is no assumption that Jev, Gemma, and Model Armor share an ideal chunk size or threshold.

| Layer | Owns | Example |
| --- | --- | --- |
| Dataset | Inputs, turn structure, source hashes, labels, facets | LLMail-Inject attack attempts; NotInject benign cases |
| Test | Which cases and labels answer a question; metrics | Attempt detection; benign false positives; a future mixed test |
| Engine | Provider, model/template, prompt/question, protocol | TypeSafe Jev 1.13; DeepInfra Gemma 4; Model Armor high template |
| Input strategy | What text the engine sees and how it is segmented | Full original text; nonoverlapping word chunks with seed and max words |
| Decision rule | How saved raw outputs become a case flag | `max(rawScore) > 0.5`; any binary PI match |
| Observation | One actual provider inference on one segment | Raw score or raw verdict, model/provider, IDs, usage, timing, status |

The score threshold is recorded with the decision rule, even when it is tuned alongside a chunk size. This lets us replay 0.3, 0.5, or 0.7 over the **same provider responses** without paying for a new run. The input strategy owns chunk size, overlap, seed, and turn selection. A condition relates these dials to a specific engine. Model Armor's PI match is a binary verdict, **not** a calibrated probability; its observations use `rawVerdict` and leave `rawScore` null.

`EvalCase.turns` describes turns in the material being screened (for example, a retrieved message thread). `requestTurn` and response IDs on an observation describe turns made by an inference engine while judging a segment. Keeping them distinct lets later tests evaluate multi-turn attacks without losing model-call provenance. Each observation also records the dataset revision, case/segment IDs, source turn IDs, input hash, engine/strategy hashes, raw output, resolved provider/model, response IDs, usage, and failure status. Raw provider bodies are checkpointed in the ignored run log; aggregate metrics are derived later.

## Current datasets and suite

- [`datasets/llmail-phase2-positive-400.json`](datasets/llmail-phase2-positive-400.json) points to a private, ignored 400-case attack-attempt source. Its labels do not verify attack success.
- [`datasets/notinject-benign-339.json`](datasets/notinject-benign-339.json) points to the 339-case public [NotInject](https://huggingface.co/datasets/leolee99/NotInject) snapshot, whose dataset card marks it MIT licensed. It contributes false-positive observations.
- [`suites/prompt-injection-baselines.json`](suites/prompt-injection-baselines.json) describes the **historical** engine versions, both historical chunk plans, full text, and threshold 0.5. The two chunked datasets used different case-seed derivations; the distinction is explicit in the suite.
- [`suites/prompt-injection-direct-chat-v1.json`](suites/prompt-injection-direct-chat-v1.json) is a **new** runnable protocol for Gemma. Its direct chat prompt and tool-call protocol are versioned separately from the assistant's historical Agent protocol. Do not merge their results as if the prompts were identical.
- [`datasets/PUBLIC_SOURCES.md`](datasets/PUBLIC_SOURCES.md) documents the three public detection cohorts. Run `bun run eval:fetch-public` to retrieve pinned upstream sources and build their ignored JSONL inputs before running those suites.
- [`WEB_SMALL_CHUNKS.md`](WEB_SMALL_CHUNKS.md) records the 7/14/21-word in-page web chunk plans, runnable suites, and the distinct Gemma score-only protocol used for complete chunked comparisons.
- [`reports/public-detector-comparison-2026-09-28.md`](reports/public-detector-comparison-2026-09-28.md) contains aggregate findings from the completed runs; raw observations and generated inputs remain ignored.

The suite model also supports a dataset with both positive and benign labels: use `caseSelector: "all"` and request both detection and false-positive metrics. Facets such as technique, category, split, or future attack surface remain case metadata rather than new engine types.

## Historical migration

[`archive/`](archive/) contains copies of the assistant's tracked research datasets, reports, and legacy evaluation scripts. The scripts are retained for audit and refer to assistant modules; use the original assistant checkout and commit to execute them exactly. The private positive source is copied to `evals/private/sources/`, and raw event logs and case-level summaries are copied to `evals/runs/assistant-2026-09/`. Both directories are gitignored. The original files were left intact for safety.

`bun evals/scripts/import-assistant-2026-09.ts` converts the historical artifacts into **52,335** canonical segment observations under ignored `evals/runs/migrated-2026-09/`. The importer checks every historical chunk against its source and recorded segmentation, then replays the decision rule and verifies all **14** condition-by-test totals against the reports. Its output preserves raw numeric Jev/Gemma scores and binary Model Armor verdicts. No provider calls are made.

## New evaluations

First inspect the planned volume without making provider calls:

```sh
bun evals/scripts/run-suite.ts --suite=evals/suites/prompt-injection-direct-chat-v1.json --test=benign-false-positives --condition=jev-full
```

To run a condition, add `--execute`. For a smoke test, `--limit=N` takes the first N selected cases and writes a separate `-limitN` checkpoint that `analyze-run.ts` replays over the same N cases. Live runs require the relevant `OPENROUTER_API_KEY` or Model Armor Google credentials and project settings. They checkpoint each dispatch, raw response, and observation in ignored `evals/runs/`. A previously dispatched segment without a scored result requires inspection and an explicit `--retry-uncertain` choice before resending. The runner caps dispatches and records explicit HTTP 429 retries.

After a run, replay one or more score thresholds without network calls:

```sh
bun evals/scripts/analyze-run.ts --input=evals/runs/RUN.jsonl --thresholds=0.3,0.5,0.7
```

For a new dataset, add a SHA-pinned dataset manifest and a source adapter or canonical JSONL source, then add tests specifying the annotation and selected cohort. For a new engine or segmentation method, implement it behind the engine or strategy interface and give it a new versioned ID. Keep private inputs, provider responses, and case-level scores in ignored paths. Commit aggregate reports only after validating coverage and provenance.

## Agent workflows

Repository skills guide additions to the eval framework: [`add-eval-dataset`](../.agents/skills/add-eval-dataset/SKILL.md), [`add-eval-model`](../.agents/skills/add-eval-model/SKILL.md), and [`add-eval-technique`](../.agents/skills/add-eval-technique/SKILL.md). Codex discovers them under `.agents/skills/`; Claude Code discovers links to the same files under `.claude/skills/`.
