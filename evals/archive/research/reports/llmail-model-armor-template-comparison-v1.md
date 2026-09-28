# LLMail-Inject phase-two Model Armor template comparison

Run: 2026-09-27. The same 400 full original attack-attempt texts used in [the three-screener evaluation](llmail-phase2-positive-400-results-v1.md), and the same 339 benign NotInject texts used for its false-positive baseline, were screened once each with the newly created `high-sensitivity` and `low-intensity` Model Armor templates. The previous `base-detector` result serves as the medium-confidence comparison. Positive source SHA-256: `46d0267fc7f555161eb22e7ec67ec994ac931b6cbf679b146b5aa212def16d51`; benign source SHA-256: `f8d28adfb5895e33a6e28270fe13c21c3739b5a6fb02f565bf71c4756d9cca61`.

The checkpoint validators confirmed **400/400 positive and 339/339 benign conclusive prompt-injection verdicts for each new template**, **1,478 total dispatches**, and **zero provider errors**. Each request used `sanitizeUserPrompt` on the complete original text. The prompt-injection/jailbreak filter's `MATCH_FOUND` state is the positive decision. No production template setting was changed.

## Detection on attack-attempt labels

| Model Armor template | Detected / 400 | Rate | Missed |
| --- | ---: | ---: | ---: |
| `high-sensitivity` | 89 | 22.25% | 311 |
| Current medium (`base-detector`) | 46 | 11.5% | 354 |
| `low-intensity` | 16 | 4.0% | 384 |

| Technique (100 each) | High | Medium | Low |
| --- | ---: | ---: | ---: |
| `api_triggered` | 21 | 8 | 1 |
| `direct instructions` | 26 | 14 | 3 |
| `obfuscation` | 33 | 20 | 10 |
| `social engineering` | 9 | 4 | 2 |

All **46 medium detections** were also caught by high; high found **43 additional** cases. All **16 low detections** were also caught by medium; medium found **30 additional** cases. The nested results are consistent with the intended sensitivity ordering on this sample. `social engineering` remained the least detected technique even at high sensitivity (9/100).

Keeping the previously scored seven-word Jev and Gemma chunks fixed and substituting only the Model Armor template changes the combined positive counts as follows:

| Armor template with Jev and Gemma | Any of three / 400 | At least two / 400 | All three / 400 |
| --- | ---: | ---: | ---: |
| High | 304 | 195 | 63 |
| Medium | 297 | 183 | 39 |
| Low | 297 | 177 | 15 |

High adds **7** detections to the any-of-three rule relative to medium. Low contributes no unique detection beyond Jev or Gemma on this sample. The 400 labels identify attack attempts; they do not verify attack success or prevention.

## False positives on 339 benign cases

| Model Armor template | False positives / 339 | Rate | True negatives |
| --- | ---: | ---: | ---: |
| `high-sensitivity` | 13 | 3.8% | 326 |
| Current medium (`base-detector`) | 7 | 2.1% | 332 |
| `low-intensity` | 2 | 0.6% | 337 |

All **7 medium false positives** were also flagged by high; high added **6**. Both low false positives were also flagged by medium. Nine of high's 13 benign flags came from the 87 `Technique Queries` cases, four from the 126 `Common Queries` cases, and none from the 84 `Multilingual` or 42 `Virtual Creation` cases. Both low flags came from `Technique Queries`.

Keeping the saved benign Jev and Gemma decisions fixed gives the following false-positive counts for combined rules:

| Armor template with Jev and Gemma | Any of three / 339 | At least two / 339 | All three / 339 |
| --- | ---: | ---: | ---: |
| High | 94 | 38 | 2 |
| Medium | 89 | 37 | 2 |
| Low | 88 | 34 | 1 |

Relative to medium, high's any-of-three rule catches **7 more labeled attack attempts** (304 versus 297) while flagging **5 more benign cases** (94 versus 89). Low's any-of-three rule catches the same **297** labeled attack attempts and flags **1 fewer benign case** (88 versus 89). The positive and benign sets were collected separately and do not establish deployment precision or real-world attack prevalence.

The positive raw source and per-case event checkpoint remain ignored at `artifacts/evals/llmail-model-armor-templates-v1.jsonl`; its validated case-level summary remains ignored at `artifacts/evals/llmail-model-armor-templates-summary-v1.json`. The benign source is the committed `research/datasets/notinject-source-v1.json`, while its new per-case checkpoint and summary remain ignored at `artifacts/evals/notinject-model-armor-templates-v1.jsonl` and `artifacts/evals/notinject-model-armor-templates-summary-v1.json`. Reproduce the aggregates with `bun scripts/summarize-llmail-model-armor-templates.ts --source=<local phase2-positive-400.jsonl path>` and `bun scripts/summarize-notinject-model-armor-templates.ts`. This committed report contains no new source text, response body, or case identifier.
