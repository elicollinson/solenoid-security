# NotInject benign chunk evaluation: pinned Jev and Gemma

Run: 2026-09-26. [Source snapshot](../datasets/notinject-source-v1.json), [complete scored dataset](../datasets/jev-notinject-fixed-provider-v1.json), and [complete generation audit](../datasets/jev-notinject-fixed-provider-generation-audit-v1.json). The source is the public [NotInject dataset](https://huggingface.co/datasets/leolee99/NotInject): 339 benchmark-labeled benign prompts, 113 from each of `NotInject_one`, `NotInject_two`, and `NotInject_three`. Production code was unchanged.

## Method and provenance

- One seeded chunk plan, maximum **7 words**, seed `20260926`, one iteration. The existing randomized `chunkWords` method produced 1,315 nonoverlapping chunks per backend. The same chunk text and boundaries were scored by both backends for each of 339 examples.
- Primary case decision: **maximum chunk score > 0.5**, the production aggregation and threshold. All 339 labels are benign, so every flagged case is a false positive. There are no positive examples from which to measure recall or false negatives.
- Jev: OpenRouter Decisions API, `typesafe/jev-1.13`, request-pinned `typesafe` provider with fallback disabled. All 1,315 responses identified `TypeSafe` and resolved model `typesafe/jev-1.13-20260917`.
- LLM: production safety prompt, Agent, and structured score schema routed for this experiment to OpenRouter `google/gemma-4-31b-it` on `deepinfra/turbo` with fallback disabled. All 1,315 responses identified `DeepInfra`; the separate read-only generation audit verified all 1,315 IDs as provider `DeepInfra` and resolved model `google/gemma-4-31b-it-20260402`.
- Dataset status `complete`: 678 case/backend rows, 1,315 scored chunks per backend, zero in-progress rows, **zero provider failures**. The raw dataset contains source text, labels, chunks, scores, response IDs, usage, and prompt/question hashes.

## Primary false positive rate

| Backend | False positives / benign cases | False positive rate | True negatives |
| --- | ---: | ---: | ---: |
| Jev | **78/339** | **23.0%** | 261 |
| Gemma/DeepInfra | **43/339** | **12.7%** | 296 |

Both flagged 33 examples; Jev alone flagged 45 and Gemma alone flagged 10. The paired false positive rate difference is **10.3 percentage points** on this dataset. The raw rows and the offline summarizer preserve the exact flagged case IDs; these are benchmark-labeled benign cases, not provider failures.

| NotInject split | Benign cases | Jev false positives | Gemma false positives |
| --- | ---: | ---: | ---: |
| `NotInject_one` | 113 | 13 (11.5%) | 7 (6.2%) |
| `NotInject_two` | 113 | 16 (14.2%) | 9 (8.0%) |
| `NotInject_three` | 113 | 49 (43.4%) | 27 (23.9%) |

| Source category | Benign cases | Jev false positives | Gemma false positives |
| --- | ---: | ---: | ---: |
| Common Queries | 126 | 20 (15.9%) | 8 (6.3%) |
| Multilingual | 84 | 0 (0.0%) | 1 (1.2%) |
| Technique Queries | 87 | 41 (47.1%) | 19 (21.8%) |
| Virtual Creation | 42 | 17 (40.5%) | 15 (35.7%) |

## Saved-score diagnostics

These replay the completed scores offline and add no provider calls. They are **not** proposed replacements for the primary rule: a stricter rule can reduce benign false positives while missing a short real attack. The small synthetic positive set in the [earlier fixed-provider report](jev-safety-fixed-provider-v1.md) showed substantial recall loss from adjacent or repeated-chunk corroboration.

| Diagnostic rule | Jev false positives | Gemma false positives | Denominator |
| --- | ---: | ---: | ---: |
| Production max > 0.5 | 78 | 43 | 339 |
| Nearest-rank p90 > 0.5 | 78 | 42 | 339 |
| Mean of two highest scores > 0.5 | 37 | 13 | 260 |
| Maximum adjacent-pair mean > 0.5 | 28 | 4 | 260 |
| Two consecutive chunks each > 0.5 | 8 | 0 | 339 |

The pair-mean diagnostics exclude 79 single-chunk cases per backend; their denominators are not directly comparable with 339-case rules. For max score thresholds 0.3, 0.5, 0.7, and 0.9, Jev flags 130, 78, 38, and 5 benign cases; Gemma flags 74, 43, 16, and 0. These are sensitivity checks on the same cases, not a threshold selection exercise.

## Cost and interpretation

The dataset reports **$0.017443** Jev cost (415,298 input and 28,930 output tokens). The generation audit reports **$0.072693** actual Gemma cost (882,266 input and 78,597 output tokens), for **$0.090136** combined. These are recorded provider costs for 2,630 scored chunk calls. The LLM cost is from [OpenRouter generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation), not a rate estimate.

This benign-only cohort exposes over-flagging that the earlier ten synthetic benign examples did not. It does not measure attack recall, establish calibration, or justify changing the production threshold. A decision about replacing the production classifier needs a larger held-out set containing both benign material and real injection attempts under the intended document lengths and chunk plan.

Reproduce offline: `bun scripts/summarize-jev-safety-chunks.ts --input=research/datasets/jev-notinject-fixed-provider-v1.json --output=artifacts/evals/jev-notinject-fixed-provider-aggregation.json`.
