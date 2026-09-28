# Full-text Jev and Gemma baseline on 400 attack attempts and 339 benign cases

Run: 2026-09-27. This is a paired, research-only comparison with the existing seven-word chunk evaluations: [LLMail-Inject positives](llmail-phase2-positive-400-results-v1.md) and [NotInject benign cases](jev-notinject-fixed-provider-v1.md). The source texts, labels, model prompts, structured score schema, provider pins, and decision threshold were held fixed. Each backend received **one complete original text per case**. Thus the production-style `max(chunk scores) > 0.5` decision reduces to **the single raw score > 0.5**. No production screening setting changed.

The positive source SHA-256 was `46d0267fc7f555161eb22e7ec67ec994ac931b6cbf679b146b5aa212def16d51`; the benign source SHA-256 was `f8d28adfb5895e33a6e28270fe13c21c3739b5a6fb02f565bf71c4756d9cca61`. Jev used `typesafe/jev-1.13` pinned to TypeSafe with fallback disabled and the same question as the chunked run. Gemma used the production safety prompt/schema with `google/gemma-4-31b-it` pinned to DeepInfra turbo, also without fallback. The validator confirmed **739/739 full-text scores per backend**, **1,478 dispatches**, **zero provider errors**, and **zero HTTP 429 responses**. It checked every numeric score, threshold decision, source hash, and response provenance; each Gemma score was linked to a captured response. The maximum source length was 14,972 characters.

## Primary results

| Backend and input | Attack attempts flagged / 400 | Benign false positives / 339 |
| --- | ---: | ---: |
| Jev, full text | **190 (47.5%)** | **10 (2.9%)** |
| Jev, seven-word chunks | 204 (51.0%) | 78 (23.0%) |
| Gemma, full text | **340 (85.0%)** | **16 (4.7%)** |
| Gemma, seven-word chunks | 269 (67.25%) | 43 (12.7%) |

These are attack-**attempt** labels, not verified successful attacks. The benign cases are from a separate benchmark. These two samples do not establish deployment precision or real-world attack prevalence.

| Positive technique (100 each) | Jev full | Jev chunked | Gemma full | Gemma chunked |
| --- | ---: | ---: | ---: | ---: |
| `api_triggered` | 57 | 40 | 89 | 68 |
| `direct instructions` | 52 | 48 | 89 | 70 |
| `obfuscation` | 61 | 78 | 91 | 80 |
| `social engineering` | 20 | 38 | 71 | 51 |

The case decisions changed in both directions. For Jev positives, 135 were flagged by both input methods, 55 only by full text, and 69 only by chunks. For Gemma positives, the corresponding counts were 240, 100, and 29. On benign cases, Jev had 10 flags shared with chunking, zero full-text-only flags, and 68 chunk-only flags. Gemma had 11 shared, 5 full-text-only, and 32 chunk-only benign flags. The full-text result is therefore not a simple subset or superset of the chunked result.

## Combined decisions with saved Model Armor results

The Jev-or-Gemma rule using full texts flags **342/400** attack attempts and **21/339** benign cases. Using seven-word chunks it flags **296/400** and **88/339**. The following rules reuse each previously saved **whole-text** Model Armor template result and replace only Jev/Gemma's chunked decisions with their new full-text decisions:

| Armor template | Any of three positives / 400 | Any of three benign flags / 339 | At least two positives / 400 | At least two benign flags / 339 |
| --- | ---: | ---: | ---: | ---: |
| High sensitivity | 345 | 29 | 202 | 8 |
| Medium (`base-detector`) | 343 | 23 | 193 | 8 |
| Low intensity | 343 | 21 | 189 | 6 |

For comparison, the original **chunked Jev/Gemma plus medium Armor** rule flagged 297/400 positives and 89/339 benign cases with any-of-three, or 183/400 and 37/339 with at-least-two. The large benign reduction with full texts is consistent with the max-over-many-fragments rule amplifying isolated high scores in this sample; the experiment also changes the information each screener sees, so this is an observed input-method effect rather than a calibrated threshold recommendation.

## Raw scores and reproducibility

Each `score` event in the ignored `artifacts/evals/unchunked-safety-400-339-events-v1.jsonl` contains the **unrounded numeric score** returned for one full text, the `> 0.5` flag, provider/model identity, response ID, and usage. Gemma response bodies are checkpointed there for provenance. The ignored `artifacts/evals/unchunked-safety-400-339-summary-v1.json` preserves both raw scores and both binary decisions per case, paired to the earlier chunked decisions. These local artifacts may contain nonpublic case information and are not committed. The positive source also remains ignored.

Reproduce the aggregate validation with `bun scripts/summarize-unchunked-safety.ts --positive=<local phase2-positive-400.jsonl path>`. Provider-reported usage for this run was **$0.01694 Jev** and **$0.06311 Gemma** across all 1,478 top-level calls, about **$0.08005** combined. These costs exclude the previously completed Model Armor calls.
