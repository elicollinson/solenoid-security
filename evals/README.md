# Security evaluations

This workspace is separate from the published screening SDK. It keeps the **data**, **test**, **inference engine**, **input strategy**, and **decision rule** independently versioned. A condition binds one engine to one strategy and rule. Conditions can differ by engine and by test; there is no assumption that Jev, Gemma, and Model Armor share an ideal chunk size or threshold.

Validate with `bun run eval:typecheck` and `bun run eval:test`. The test command
uses the explicit path `bun test ./evals/tests`: keep the leading `./`. An
unprefixed argument is a discovery filter and can scan the retained artifact
tree, causing macOS subprocess `EBADF` failures in Bun ([upstream issue](https://github.com/oven-sh/bun/issues/32067)).

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
- The [varied prompt-injection cohorts](datasets/PUBLIC_SOURCES.md#varied-prompt-injection-cohorts-2026-10-08) add 14 datasets: BIPIA TableQA/CodeQA, BrowseSafe, Nemotron IPI, all AgentDojo suites, RepoGuardBench, Inj-SQuAD/TriviaQA, an LLMail payload pool, and constructed subtle-template and authorized-instruction cohorts on LongPIBench documents. They are tested together in `suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json`, which uses the running Studio baseline's engines and conditions.
- [`WEB_SMALL_CHUNKS.md`](WEB_SMALL_CHUNKS.md) records the 7/14/21-word in-page web chunk plans, runnable suites, and the distinct Gemma score-only protocol used for complete chunked comparisons.
- [`reports/public-detector-comparison-2026-09-28.md`](reports/public-detector-comparison-2026-09-28.md) contains aggregate findings from the completed runs; raw observations and generated inputs remain ignored.

The suite model also supports a dataset with both positive and benign labels: use `caseSelector: "all"` and request both detection and false-positive metrics. Facets such as technique, category, split, or future attack surface remain case metadata rather than new engine types.

## Historical migration

[`archive/`](archive/) contains copies of the assistant's tracked research datasets, reports, and legacy evaluation scripts. The scripts are retained for audit and refer to assistant modules; use the original assistant checkout and commit to execute them exactly. The private positive source is copied to `evals/private/sources/`, and raw event logs and case-level summaries are copied to `evals/runs/assistant-2026-09/`. Both directories are gitignored. The original files were left intact for safety.

`bun evals/scripts/import-assistant-2026-09.ts` converts the historical artifacts into **52,335** canonical segment observations under ignored `evals/runs/migrated-2026-09/`. The importer checks every historical chunk against its source and recorded segmentation, then replays the decision rule and verifies all **14** condition-by-test totals against the reports. Its output preserves raw numeric Jev/Gemma scores and binary Model Armor verdicts. No provider calls are made.

## New evaluations

Check the OpenRouter key budget before and after paid experiments:

```sh
bun run eval:budget
```

Run from the repository root; Bun loads the ignored `.env`, or you can supply `OPENROUTER_API_KEY` through the environment. This reads `/api/v1/key` using the eval runner's credential and prints budget fields only. It makes no inference calls. The key limit covers this key rather than the whole account; a null limit does not mean unlimited credit. Checkpointed research batches check this budget between conditions and retain a reserve for retries. Model Armor billing is separate from OpenRouter.

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

## Research rounds

The ongoing [research log](reports/research-log-2026-09-29.md) records branch inventory, experiment choices, budget use, findings, and limitations. The matched round-1 suite crosses Jev, Gemma 3 4B, Ministral 3 3B, Gemma 4 31B, and three Model Armor templates with full last-external text and the runtime's 96-word sliding windows at 64-word stride across five existing datasets. Separate suites test paired [BIPIA emails](datasets/BIPIA_EMAIL.md), all-external source coverage, and a trusted-task protocol with neutral source references. Historical task-context v1 passed label-bearing IDs to the provider; its results cannot establish a clean context benefit.

```sh
bun run eval:research                         # dry run, no inference
bun run eval:research --execute --max-spend=6 --reserve=10 --concurrency=64
bun run eval:research-analyze --run-dir=evals/runs/research-round1-2026-09-29 --comparisons
```

The matrix records a budget ledger and checkpoints each condition. Endpoint prices are snapshots; actual response costs and the key's reported balance govern spending. OpenRouter charges and Google billing are separate. Gemma 3 uses a lower concurrency after observed endpoint throttling. The offline research analyzer verifies dataset/suite hashes, raw response linkage, and full coverage before emitting aggregate metrics, confidence intervals, and fixed threshold/aggregation sensitivity analyses. Replays are exploratory rather than held-out calibration.

## Agent workflows

Repository skills guide additions to the eval framework: [`add-eval-dataset`](../.agents/skills/add-eval-dataset/SKILL.md), [`add-eval-model`](../.agents/skills/add-eval-model/SKILL.md), and [`add-eval-technique`](../.agents/skills/add-eval-technique/SKILL.md). Codex discovers them under `.agents/skills/`; Claude Code discovers links to the same files under `.claude/skills/`.

## Current-model research continuation

The [current aggregate report](reports/current-model-research-2026-09-29.md) and [running decision log](reports/research-log-2026-09-29.md) supersede the older coverage snapshot. The active matrix targets eight detectors across eight cohorts with full text and 96-word/64-stride windows, plus controlled present/withheld-task comparisons on the three task-bearing cohorts. Added candidates are Gemma4 26B-A4B, Qwen3.5 9B, and Qwen3.6 35B-A3B through pinned OpenRouter endpoints with thinking explicitly disabled. Hosted precision and memory feasibility are documented; no local model is downloaded or run.

Start with [the research findings](reports/research-findings-2026-09-29.md) for conclusions and limitations. After live work stops, `python3 -B evals/scripts/inventory-research.py` creates an ignored SHA-256 inventory of retained raw artifacts. The explicit single-condition `--continue-after-length-errors` option allows completing the other inputs after a recorded token-limit abstention; it never scores that failed output or marks the overall run complete. Normal runs remain fail-stop.

The two new PIDS cohorts are SHA-pinned public stress subsets. Clone the upstream commit recorded in their manifests into `evals/private/upstream/pids-bench`, then rebuild with `python3 -B evals/scripts/import-pids.py`. Its hard-benign subset excludes 664 withheld LMSYS rows and inherits source licensing restrictions. It is not a reproduction of the full PIDS benchmark.

```sh
bun evals/scripts/run-research-matrix.ts --suite=evals/suites/prompt-injection-current-models-v1.json
bun evals/scripts/run-research-matrix.ts --suite=evals/suites/prompt-injection-pids-v1.json
bun evals/scripts/run-research-matrix.ts --suite=evals/suites/prompt-injection-context-ablation-v1.json
bun evals/scripts/summarize-current-research.ts
```

These matrix commands are dry runs unless `--execute` is present. Resume using the original output directory and explicit missing conditions. Derived checkpoints cannot be resumed as live inference: exclude them with condition/test filters. Keep their original source checkpoints intact. The summary validates completed full-cohort checkpoints, reports the active coverage ledger, disaggregates PIDS transforms/provenance, compares paired task ablations, and isolates identical-input score instability from actual segmentation changes. Incomplete retired cells are preserved and excluded from performance claims.

Research authorization: remaining OpenRouter key balance at clarification was $19.638763714; Model Armor has a separate $30 ceiling. The matrix ledger covers OpenRouter only. The aggregate summary conservatively accounts current Model Armor dispatches using full-case byte counts and the published token price; this is not cloud billing telemetry. Native successful Model Armor response capture was added during this phase; earlier checkpoints retain normalized assessments only. All raw source data, responses, failed checkpoints, endpoint snapshots, and analysis JSON stay under ignored `evals/private/` and `evals/runs/`.

## Extended continuous research

The later studies are documented in [extended comparisons](reports/extended-research-2026-09-29.md), [LongPIBench results](reports/longpibench-research-2026-09-29.md), [decoded previews](reports/decoded-preview-research-2026-09-29.md), and the running log above. These add synthetic long documents, observed AgentDyn tool exposures, reversible encoded benign controls, and Skill-Inject policy pairs. Gemma31 FP8 and Qwen3.6 27B are distinct pinned endpoint conditions; older engine outputs remain intact. Counts are screening outcomes under explicit labels, not end-to-end agent compromise rates.

Rebuild only offline summaries with `bun evals/scripts/summarize-extended-research.ts`, `bun evals/scripts/summarize-longpi.ts`, and `bun evals/scripts/summarize-decoded.ts`. `derive-longpi-coverage.ts` reuses exact captured window responses to remove redundant tails; it makes no API calls. The partial auditor validates saved observations but emits null for unscored cases. It never promotes an incomplete checkpoint into complete-cohort accuracy.

`run-suite.ts --max-new-segments=N` limits this invocation's unfinished work while preserving the original full-cohort identity. It emits a checkpointed-tranche status without a completion marker. Unlike `--limit`, it is resumable into the same full cohort. Inspect failed dispatches before authorizing `--retry-uncertain`; `--continue-after-length-errors` preserves malformed capped outputs as abstentions. All newly received non-429 HTTP bodies are retained on failures, including concurrent failures after another worker has stopped dispatch.

Model Armor now reserves a conservative allowance before each call in ignored `evals/runs/armor-budget-2026-09-29.jsonl`, with a single-writer lock and a separate $30 ceiling. It carries forward the earlier conservative allowance and prices new requests using the published non-whitespace character rule; it is not an invoice. Do not add OpenRouter per-batch usage deltas across simultaneous batches, since they overlap on the same key.

After all provider processes stop, `python3 -B evals/scripts/inventory-research.py` hashes retained ordinary source/run files into the final inventory directory. The earlier cycle's inventory remains preserved. PNG/SVG research figures are generated from validated aggregates by `plot-research.py` with Matplotlib; the plotting environment is not a runtime dependency of the SDK.

Final budget-exhausted findings and preservation details are in the [full research report](reports/research-full-report-2026-09-29.md); the [coverage ledger](reports/research-coverage-2026-09-29.md) lists complete, abstaining and budget-limited cells.

## LM Studio / LM Link research backend

LM Studio is an optional transport on the existing `llm_score_json` and neutral
`task_context_llm` protocols. The `lmStudio` engine field pins a loopback API URL,
remote device identifier, indexed artifact identifier, format, quantization,
file size, context length, parallel capacity and timeout. Use a distinct engine
ID for each artifact/load configuration. API credentials, if enabled, come only
from `LM_STUDIO_API_KEY`; the OpenRouter key is never sent to the local service.

The current downloaded-model suite is `suites/prompt-injection-lmstudio-v1.json`.
It records eight selected endpoints on the linked MacBook Pro, with 65,536-token
context, parallel capacity one, temperature zero, 64 output tokens and
`reasoning_effort: "none"`. Its full-text and 512-word/384-stride strategies use
the existing shared SDK segmentation. Registration is not evidence that every
model has passed its smoke test or completed every cohort.

```sh
# Read-only inventory and dry run:
lms link status
lms ls --json
bun run eval:local --conditions=gemma4-e2b-q4-full --tests=benign-false-positives

# Start the loopback relay, then run/resume the same full cohort:
lms server start --bind 127.0.0.1 --port 1234
bun run eval:local --execute --conditions=gemma4-e2b-q4-full --tests=benign-false-positives
```

The serial driver checks inventory, selects the pinned preferred device, loads
one model, validates completed cells before skipping them, and unloads only its
owned instance afterward. It refuses to evict user-loaded models. The
driver log retains failed CLI commands with exit code, stdout and stderr, including
model-load failures that occur before an inference checkpoint can be created. A
lock at `evals/runs/lmstudio-device.lock` prevents two local matrix drivers from
competing. After an ungraceful process loss, inspect the recorded PID, device and
partial checkpoint before removing a stale lock. `--max-new-segments=N` bounds
new work while retaining full-cohort identity; `--limit=N` instead creates a
separate, limited cohort. Never use the paid `eval:research` driver for local
engines; it explicitly rejects them.

Every inference checks `lms ps --json` before and after the response for the exact
instance, device, artifact, quantization and load settings. Native responses are
retained unchanged inside a `lmstudio-provenance/v1` envelope with those snapshots;
offline analysis validates them again. Empty, malformed, wrong-model and
length-limited outputs remain failures/abstentions, never fabricated scores.
The input must fit a conservative UTF-8-byte bound plus 1,280 tokens of
format/output allowance; this deliberately rejects some inputs that could fit
when tokenized, instead of relying on silent server truncation. A larger context
requires a new engine version. No auto-download or cloud fallback is performed.

For a separately versioned local score-only protocol experiment,
`parameters.request_json_schema: false` omits the API `response_format` field.
The score-only prompt, final-answer JSON parsing, numeric range and provenance
validation still apply. Omitted or true uses the existing strict wire schema.
Record a distinct engine ID for this setting; it can change generation behavior
and must not be applied retroactively to existing outputs. Reasoning-channel JSON
is not substituted for an empty final answer.

Local durations include the relay and per-request provenance checks; they are
not pure model-generation latency. API costs remain unknown/null rather than
pretending to measure electricity or hardware cost. LM Link inventory does not
provide a weight-file SHA or the remote inference-runtime build in these CLI
snapshots; file identity/size/quantization are checked, but cannot establish
byte-identical weights or a pinned remote runtime. Do not equate these runs with
hosted FP8/BF16 results or compare nominal precision in isolation from runtime.

**Native-v0 transport (speed stats).** An engine may set `lmStudio.endpoint: "native-v0"`
to post the same request body to `/api/v0/chat/completions` instead of `/v1`. The
native body is the same OpenAI-shaped completion plus server-measured `stats`
(`time_to_first_token`, `tokens_per_second`, `generation_time`, `stop_reason`) and
`model_info`; it is retained verbatim in an `lmstudio-provenance/v2` envelope that
also records the wire path and client HTTP wall time. Observations then carry
`speed: {ttftS, tokensPerSecond, generationTimeS, stopReason, clientWallMs}`, which
the analyzer re-derives from the body. `model_info.quant` must match the pinned
quantization (`context_length` is not checked: MLX reports its maximum). Omitting
`endpoint` keeps `/v1` and the v1 envelope, so earlier engine identities are
unchanged. A 12-case Studio check gave byte-identical outputs on both paths (log
L127). `generation_time` includes TTFT on llama.cpp but not on MLX; derive decode
seconds as completion tokens / `tokens_per_second`.

Hub-artifact variants (`google/gemma-4-26b-a4b@q8_0`) appear only in
`lms ls --variants --json`, and `lms load` cannot select them. The matrix driver
pins variants from that listing and loads them with `@lmstudio/sdk`
(`client.llm.load(variantKey, …)`), then validates `lms ps` as usual.
`--require-device=<id>` refuses engines pinned elsewhere and any loaded instance
placed on another device.

References: [LM Link API](https://lmstudio.ai/docs/developer/core/lmlink),
[structured outputs](https://lmstudio.ai/docs/developer/openai-compat/structured-output),
[model management API](https://lmstudio.ai/docs/developer/rest).

For inspected invalid **local completion outputs**, pass
`--continue-after-output-errors` to retain them as abstentions and continue the
remaining cases. This never retries a completed invalid output for a better
score, and does not bypass placement, identity or transport failures. Cohorts
with abstentions retain partial coverage and never receive a fully scored
completion marker. `bun evals/scripts/summarize-lmstudio.ts` reports these
separately, including observed flags and unscored denominators.

The initial E4B preset is deferred: its first response reasoned despite the
requested reasoning-off setting. The LFM2 preset is also deferred pending a
32K-native versus 128K-inventory context discrepancy. Registration is not a
claim that an endpoint has passed protocol validation. Preserve the v1 suite
unchanged after any run; revised configurations belong in new suite versions.

A separate `prompt-injection-lmstudio-thinking1024-v1.json` suite requests high
reasoning and a 1,024-token output cap for the two small Gemmas. These engines
have distinct IDs and must not be pooled with the 64-token fast protocol.
Reasoning usage and validity must be checked on native responses: an accepted
API parameter alone does not establish that the runtime honored it.

### Whitespace-preserving window control

`prompt-injection-lmstudio-preserve-windows-v1.json` binds the same two
thinking1024 engines and `max-score-gt-05-v1` rule to
`sliding-preserve-words-512-stride384-v1` on NotInject, paired BIPIA email,
LongPI paper/code, and the paper numeric counterfactual. Registration does not
mean live inference has run. The shared SDK kind is
`sliding_word_window_preserve_v1`, with `windowWords: 512`, `strideWords: 384`
and eval turn selection `last_external`.

The new kind keeps exactly the legacy word boundaries and terminal overlapping
windows, but slices the original text instead of joining words with spaces.
Whitespace belongs to the following word, with trailing whitespace retained at
end of source. A window covering the whole source is byte-identical to full
text. Shorter-than-window inputs can still have a redundant tail when their
word count exceeds the stride; removing tails is a separate coverage control.
Nonoverlapping preserved windows concatenate to the exact original source.

This separates formatting changes from context reduction. Existing normalized
window strategies and captured outputs stay unchanged. Reuse observations only
when engine, source, task context and exact segment text match. The current
`derive-equivalent-run.ts` supports whole-cohort equivalence. For mixed
saved/new inputs, `run-suite.ts --reuse-from=evals/runs/.../source.jsonl` seeds
exact matches from a fully scored, pure live, full-text checkpoint on the same
cohort and engine. The source hash, native bodies and observation links remain
in the new checkpoint under `exact-full-input-reuse/v1`. A new dispatch that
duplicates a reusable source input is rejected. Invalid, incomplete, limited,
changed-engine or recursively reused sources cannot seed this path.

The local matrix forwards `--reuse-from` only for a single selected cell;
pass the same option on resume. Use the single-condition runner's dry run to
see planned new calls and reused observations before executing. New-segment
bounds apply only to new work. Mixed summaries separate native responses and
reused scores, count only new dispatches/costs as incremental, and label combined
source/live latency; that combined latency is not elapsed time for the new run.
Threshold changes still replay offline; changed segment text requires new inference.

For repeated inputs within a new local score-only run, use
`--deduplicate-inputs` on `eval:local` or `run-suite.ts`. This records
`exact-input/v1` in checkpoint metadata and evaluates the first occurrence of
each exact input once. Later cases retain their own labels and segment/turn
identities, with an explicit link and hash back to the native observation and
response. The independent auditor rejects altered sources, recursive reuse and
new dispatches for duplicate inputs. Whitespace differences remain different
inputs. Reused outputs are not independent model draws.

This mode requires serial local inference and cannot be combined with
`--reuse-from` or error-continuation flags. An invalid output stops the run for
inspection and remains unscored; it is never copied as a score. Resume with the
same flag. The new-segment bound counts unique new requests, so compute its
value from unique inputs when budgeting a complete-family tranche. Native
response summaries measure actual new token/timing work; case-level aggregate
token and duration totals include reused source work and must not be interpreted
as incremental compute. Existing checkpoints and their inference behavior are
unchanged unless this option is explicitly selected for a new run.

To extend an exact-input cache across local studies, additionally pass
`--reuse-inputs-from=evals/runs/<complete-source>.jsonl`. This explicit option
requires `--deduplicate-inputs`; the local matrix accepts one full-cohort cell.
It accepts a complete native or within-run-deduplicated checkpoint with exactly
the same pinned engine, prompt and generation configuration. Only original
native observations seed the cache. A completed limited cohort can seed exact
inputs when expanding to the full cohort; the remaining inputs still require
inference. This does not establish whole-cohort equivalence. Sources with
external reuse, task context or incomplete selected-cohort results are rejected.
Cross-study targets retain
their own case labels and source-turn identities; inference and native response
provenance remain linked to the original request. Both the complete source file
hash and source observation hash are audited. This is reuse of the same model
input, not evidence that the studies are statistically independent.

Use the single-condition runner's dry run to count genuinely new inputs and
resume with the identical source option. Changing the source bytes invalidates
the captured source binding. Tranche limits count only new native requests;
exact cached observations can be populated without consuming that limit.
External cache chains are deliberately unsupported.
