# LLMail-Inject phase-two positive sample: three-screener evaluation

Status: **complete**, 2026-09-26. This report contains aggregate results only. The raw sample, chunk texts, response bodies, and case-level outputs remain in ignored local paths. The source, pinning, chunk plan, and limits are documented in [the preflight](llmail-phase2-positive-400-preflight-v1.md).

The two newer Model Armor templates were evaluated on the same 400 full texts on 2026-09-27; see [the template comparison](llmail-model-armor-template-comparison-v1.md).

Jev and Gemma were subsequently evaluated once per complete text on these 400 cases and the 339 benign cases; see [the unchunked comparison](unchunked-jev-gemma-400-339-v1.md).

## Method and coverage

- Source SHA-256: `46d0267fc7f555161eb22e7ec67ec994ac931b6cbf679b146b5aa212def16d51`. All 400 records are distinct, text-hash-valid `injection` **attack-attempt labels**, with 100 each of `api_triggered`, `direct instructions`, `obfuscation`, and `social engineering`. These labels do not verify that an attack succeeded.
- Model Armor received each complete original text once: **400/400** conclusive assessments. Jev and Gemma each received the same seeded maximum-seven-word chunk plan: **23,005/23,005** scored chunks per backend. A chunked backend marks a case positive when its maximum chunk score exceeds 0.5. The offline validator found **400/400** complete cases.
- Jev was pinned to `typesafe/jev-1.13` / TypeSafe; Gemma to `google/gemma-4-31b-it` / DeepInfra turbo, with fallback disabled. The log records **46,026** OpenRouter dispatches for 46,010 scored chunks. Two Gemma provider/transport interruptions were resolved through checkpoint validation or explicit retry; they are not counted as classifier misses. There were **zero HTTP 429 responses**. This is a comparison of these exact inputs and settings, not an equal-context comparison: Armor saw full text, while Jev and Gemma saw seven-word chunks.

## Attack-attempt detection

| Screener/rule | Detected / 400 | Detection rate | Missed |
| --- | ---: | ---: | ---: |
| Model Armor | 46 | 11.5% | 354 |
| Jev | 204 | 51.0% | 196 |
| Gemma | 269 | 67.25% | 131 |
| Any of three | 297 | 74.25% | 103 |
| At least two of three | 183 | 45.75% | 217 |
| All three | 39 | 9.75% | 361 |

All denominators here are attack-attempt labels; the rates measure detection of that label, not prevention of a successful attack.

| Technique (100 each) | Armor | Jev | Gemma | Any of three | At least two |
| --- | ---: | ---: | ---: | ---: | ---: |
| `api_triggered` | 8 | 40 | 68 | 74 | 38 |
| `direct instructions` | 14 | 48 | 70 | 74 | 44 |
| `obfuscation` | 20 | 78 | 80 | 86 | 72 |
| `social engineering` | 4 | 38 | 51 | 63 | 29 |

`social engineering` was the least detected group under the any-of-three rule (63/100). `obfuscation` was the most detected (86/100). These are descriptive results for this balanced sample, not population estimates.

## Overlap and benign false positives

The pattern order is **Armor, Jev, Gemma**, where `1` means detected. Of 400 positives, **103** were missed by all three (`000`); **88** were caught only by Gemma (`001`), **25** only by Jev (`010`), and **1** only by Armor (`100`). The remaining detections were `011`: 138, `101`: 4, `110`: 2, and `111`: 39. Thus adding Armor to the Jev-or-Gemma rule caught one additional positive in this sample.

The previously completed, separate **339-benign-case** comparison gives this operational tradeoff at the same case rules:

| Screener/rule | False positives / 339 | False-positive rate |
| --- | ---: | ---: |
| Model Armor | 7 | 2.1% |
| Jev | 78 | 23.0% |
| Gemma | 43 | 12.7% |
| Any of three | 89 | 26.3% |
| At least two of three | 37 | 10.9% |
| All three | 2 | 0.6% |

The any-of-three rule has the highest detection in the positive sample and also flags 89 of 339 benign cases. The at-least-two rule reduces that benign count to 37 while detecting 183 of 400 attack attempts. These two datasets were collected separately; their mix does not establish deployment precision or the prevalence of attacks in real traffic.

## Reproducibility and scope

The ignored local event log is `artifacts/evals/llmail-inject-phase2-400-events-v1.jsonl`; the ignored validated case summary is `artifacts/evals/llmail-inject-phase2-400-summary-v1.json`. Reproduce the aggregate validation with `bun scripts/summarize-llmail-three-screeners.ts --source=<local phase2-positive-400.jsonl path>`. The committed report deliberately excludes source text, chunk text, response bodies, and case identifiers.

Provider-reported Jev cost for scored chunks was **$0.3063**. The Gemma response-body checkpoint began after the first part of the run, so its captured usage is incomplete and this report does not claim a total Gemma bill. Model Armor billing is also outside this report. No production setting or deployment changed.
