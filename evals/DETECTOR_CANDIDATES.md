# Detector candidates, version 1

These candidates live in the evaluation workspace. They do not change the published screening SDK. All scores remain exploratory until measured on source-disjoint positive and benign cases.

## Task-context judge

`task_context_llm` uses `security-eval-task-context-v1` (prompt SHA-256 exported from `engines.ts`) and `task-context-score-rationale-v1`. The configured small model is Google Gemma 3 4B (`google/gemma-3-4b-it`) through a single pinned DeepInfra provider on OpenRouter. The adapter sends temperature 0 and requires JSON Schema output with a native `concernScore` in `[0,1]`; it records the raw score, provider/model, response ID, usage, and raw response. The protocol sends a trusted operator/user task alongside a segment drawn only from external turns. Cases without both kinds of turns fail before a run begins. This score is an ordinal judgment, not a calibrated probability. No provider calls are made by tests or dry runs.

The model and endpoint were selected from [OpenRouter's Gemma 3 4B model listing](https://openrouter.ai/google/gemma-3-4b-it/pricing?sort=throughput) and [DeepInfra provider listing](https://openrouter.ai/provider/deepinfra). Endpoint availability and output support still require a live smoke test before a paid evaluation.

The runnable configuration is `suites/prompt-injection-detector-candidates-v1.json`, with the AgentInjectionBench and AgentDojo mixed cohorts. It binds both Jev and the task-context judge to the same source spans and exploratory `max(rawScore) > 0.5` rule. Run a condition without `--execute` to inspect volume. For example:

```sh
bun evals/scripts/run-suite.ts --suite=evals/suites/prompt-injection-detector-candidates-v1.json --test=agentdojo-travel-mixed --condition=gemma3-task-context-agentdojo
```

The dry run plans 21 calls for AgentDojo and 571 for AgentInjectionBench with this strategy. Live runs were not made. A threshold change can be replayed; prompt, task context, model, or segmentation changes need fresh inference. The dataset labels denote attempted injection, not observed agent compromise.

## Source-aware spans

`source_spans` segments every external turn independently. Each segment stores its source turn ID, local word start and end, index, and text hash. It never combines a trusted task with external data or crosses a source boundary. The proposed exploratory configuration is 96 words with a 64-word stride and `all_external` turn selection. Segmentation changes require fresh inference. Threshold changes can be replayed over saved observations.

## Action provenance monitor

`assessActionProvenance` is a separate action-level evaluation primitive. A caller supplies a proposed tool call, the approved tools, protected JSON-pointer arguments, and trusted source-turn provenance for those arguments. This provenance must come from trusted host instrumentation, never an agent's self-report. It flags an unapproved tool, missing/unknown provenance, or external influence over a protected argument. It does not infer provenance from strings or agent claims. A future agent harness must supply trustworthy argument lineage and action/ground-truth labels before this can yield a detection-rate benchmark. This monitor intentionally has no text-only suite condition.

## Encoder candidate

`solenoid-encoder-candidate-v1` is a non-runnable training stub. **TODO:** select an open-weight checkpoint or train an encoder using source/cluster-disjoint splits, then pin weights, tokenizer, preprocessing, label mapping, calibration cohort, and a decision rule. It throws instead of returning a fabricated score. Once these artifacts are available, add a new `EngineSpec` and benchmark it under its own ID.
