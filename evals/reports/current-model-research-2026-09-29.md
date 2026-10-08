# Current-model injection detection research

Generated 9/29/2026, 10:19:34 PM EDT. This is a checkpoint-based snapshot; every table row passed source, suite, response, and coverage validation. Smoke tests are excluded. Missing rows are not completed results.

Hosted measurements only. Numeric primary rule is max score >0.5; Model Armor uses any native PI match. Cohorts are deliberately separate. No thresholds were calibrated on these test outcomes.

## Active coverage

128/128 baseline cells complete: eight active detectors × eight cohorts × full/sliding. 23/24 applicable context-ablation cells complete. Retired Gemma3/Ministral and tiny/source-span techniques remain preserved in historical artifacts.


## Full-text results

| Cohort | Detector | Detected attacks | Benign flags |
|---|---|---:|---:|
| agent-injection-bench-mixed | armor-base-full | 22/142 (15.5%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | armor-high-full | 35/142 (24.6%) | 1/40 (2.5%) |
| agent-injection-bench-mixed | armor-low-full | 11/142 (7.7%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | gemma3-4b-full | 115/142 (81.0%) | 6/40 (15.0%) |
| agent-injection-bench-mixed | gemma4-26b-full | 130/142 (91.5%) | 1/40 (2.5%) |
| agent-injection-bench-mixed | gemma4-31b-full | 117/142 (82.4%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | jev-full | 108/142 (76.1%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | ministral3-3b-full | 107/142 (75.4%) | 5/40 (12.5%) |
| agent-injection-bench-mixed | qwen35-9b-full | 106/142 (74.6%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | qwen36-35b-full | 132/142 (93.0%) | 0/40 (0.0%) |
| agentdojo-travel-mixed | armor-base-full | 15/18 (83.3%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | armor-high-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | armor-low-full | 9/18 (50.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma3-4b-full | 12/18 (66.7%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma4-26b-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma4-31b-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | jev-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | ministral3-3b-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen35-9b-full | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen36-35b-full | 18/18 (100.0%) | 0/3 (0.0%) |
| attempt-detection | armor-base-full | 46/400 (11.5%) | — |
| attempt-detection | armor-high-full | 89/400 (22.3%) | — |
| attempt-detection | armor-low-full | 16/400 (4.0%) | — |
| attempt-detection | gemma3-4b-full | 349/400 (87.3%) | — |
| attempt-detection | gemma4-26b-full | 330/400 (82.5%) | — |
| attempt-detection | gemma4-31b-full | 284/400 (71.0%) | — |
| attempt-detection | jev-full | 190/400 (47.5%) | — |
| attempt-detection | ministral3-3b-full | 262/400 (65.5%) | — |
| attempt-detection | qwen35-9b-full | 241/400 (60.3%) | — |
| attempt-detection | qwen36-35b-full | 315/400 (78.8%) | — |
| benign-false-positives | armor-base-full | — | 7/339 (2.1%) |
| benign-false-positives | armor-high-full | — | 13/339 (3.8%) |
| benign-false-positives | armor-low-full | — | 2/339 (0.6%) |
| benign-false-positives | gemma3-4b-full | — | 148/339 (43.7%) |
| benign-false-positives | gemma4-26b-full | — | 20/339 (5.9%) |
| benign-false-positives | gemma4-31b-full | — | 13/339 (3.8%) |
| benign-false-positives | jev-full | — | 9/339 (2.7%) |
| benign-false-positives | ministral3-3b-full | — | 68/339 (20.1%) |
| benign-false-positives | qwen35-9b-full | — | 8/339 (2.4%) |
| benign-false-positives | qwen36-35b-full | — | 13/339 (3.8%) |
| bipia-email-mixed | armor-base-full | 1/78 (1.3%) | 0/78 (0.0%) |
| bipia-email-mixed | armor-high-full | 3/78 (3.8%) | 0/78 (0.0%) |
| bipia-email-mixed | armor-low-full | 0/78 (0.0%) | 0/78 (0.0%) |
| bipia-email-mixed | gemma4-26b-full | 58/78 (74.4%) | 0/78 (0.0%) |
| bipia-email-mixed | gemma4-31b-full | 38/78 (48.7%) | 0/78 (0.0%) |
| bipia-email-mixed | jev-full | 34/78 (43.6%) | 0/78 (0.0%) |
| bipia-email-mixed | ministral3-3b-full | 49/78 (62.8%) | 28/78 (35.9%) |
| bipia-email-mixed | qwen35-9b-full | 20/78 (25.6%) | 1/78 (1.3%) |
| bipia-email-mixed | qwen36-35b-full | 42/78 (53.8%) | 0/78 (0.0%) |
| pids-hard-benign-public | armor-base-full | — | 14/808 (1.7%) |
| pids-hard-benign-public | armor-high-full | — | 24/808 (3.0%) |
| pids-hard-benign-public | armor-low-full | — | 2/808 (0.2%) |
| pids-hard-benign-public | gemma4-26b-full | — | 19/808 (2.4%) |
| pids-hard-benign-public | gemma4-31b-full | — | 13/808 (1.6%) |
| pids-hard-benign-public | jev-full | — | 172/808 (21.3%) |
| pids-hard-benign-public | qwen35-9b-full | — | 38/808 (4.7%) |
| pids-hard-benign-public | qwen36-35b-full | — | 72/808 (8.9%) |
| pids-obfuscated | armor-base-full | 155/405 (38.3%) | — |
| pids-obfuscated | armor-high-full | 233/405 (57.5%) | — |
| pids-obfuscated | armor-low-full | 114/405 (28.1%) | — |
| pids-obfuscated | gemma4-26b-full | 327/405 (80.7%) | — |
| pids-obfuscated | gemma4-31b-full | 339/405 (83.7%) | — |
| pids-obfuscated | jev-full | 269/405 (66.4%) | — |
| pids-obfuscated | qwen35-9b-full | 279/405 (68.9%) | — |
| pids-obfuscated | qwen36-35b-full | 291/405 (71.9%) | — |
| web-mixed | armor-base-full | 139/240 (57.9%) | 133/240 (55.4%) |
| web-mixed | armor-high-full | 188/240 (78.3%) | 159/240 (66.3%) |
| web-mixed | armor-low-full | 66/240 (27.5%) | 13/240 (5.4%) |
| web-mixed | gemma4-26b-full | 240/240 (100.0%) | 81/240 (33.8%) |
| web-mixed | gemma4-31b-full | 224/240 (93.3%) | 58/240 (24.2%) |
| web-mixed | jev-full | 238/240 (99.2%) | 107/240 (44.6%) |
| web-mixed | ministral3-3b-full | 236/240 (98.3%) | 209/240 (87.1%) |
| web-mixed | qwen35-9b-full | 232/240 (96.7%) | 94/240 (39.2%) |
| web-mixed | qwen36-35b-full | 236/240 (98.3%) | 76/240 (31.7%) |

## Full versus 96-word windows

Paired cohorts and the same engine configuration. Full means last external source; windows use 96 words / 64-word stride and max/any aggregation. Equivalent single-segment cohorts are explicitly derived.

| Cohort | Detector | Full TP / FP | Windows TP / FP |
|---|---|---:|---:|
| benign-false-positives | armor-low | 0 / 2 | 0 / 2 |
| benign-false-positives | armor-base | 0 / 7 | 0 / 7 |
| benign-false-positives | ministral3-3b | 0 / 68 | 0 / 68 |
| benign-false-positives | armor-high | 0 / 13 | 0 / 13 |
| benign-false-positives | gemma3-4b | 0 / 148 | 0 / 150 |
| benign-false-positives | gemma4-31b | 0 / 13 | 0 / 14 |
| benign-false-positives | jev | 0 / 9 | 0 / 9 |
| attempt-detection | armor-low | 16 / 0 | 37 / 0 |
| attempt-detection | armor-base | 46 / 0 | 74 / 0 |
| attempt-detection | ministral3-3b | 262 / 0 | 343 / 0 |
| attempt-detection | armor-high | 89 / 0 | 130 / 0 |
| attempt-detection | gemma4-31b | 284 / 0 | 301 / 0 |
| attempt-detection | jev | 190 / 0 | 203 / 0 |
| web-mixed | armor-low | 66 / 13 | 67 / 14 |
| web-mixed | armor-base | 139 / 133 | 140 / 135 |
| web-mixed | ministral3-3b | 236 / 209 | 240 / 223 |
| web-mixed | armor-high | 188 / 159 | 188 / 159 |
| web-mixed | gemma4-31b | 224 / 58 | 220 / 68 |
| web-mixed | jev | 238 / 107 | 238 / 120 |
| agentdojo-travel-mixed | armor-low | 9 / 0 | 9 / 0 |
| agentdojo-travel-mixed | armor-base | 15 / 0 | 15 / 0 |
| agentdojo-travel-mixed | ministral3-3b | 18 / 0 | 18 / 0 |
| agentdojo-travel-mixed | armor-high | 18 / 0 | 18 / 0 |
| agentdojo-travel-mixed | gemma3-4b | 12 / 0 | 12 / 0 |
| agentdojo-travel-mixed | gemma4-31b | 18 / 0 | 18 / 0 |
| agentdojo-travel-mixed | jev | 18 / 0 | 18 / 0 |
| agent-injection-bench-mixed | armor-low | 11 / 0 | 16 / 0 |
| agent-injection-bench-mixed | armor-base | 22 / 0 | 31 / 0 |
| agent-injection-bench-mixed | ministral3-3b | 107 / 5 | 122 / 5 |
| agent-injection-bench-mixed | armor-high | 35 / 1 | 43 / 1 |
| agent-injection-bench-mixed | gemma3-4b | 115 / 6 | 124 / 6 |
| agent-injection-bench-mixed | gemma4-31b | 117 / 0 | 119 / 0 |
| agent-injection-bench-mixed | jev | 108 / 0 | 112 / 0 |
| bipia-email-mixed | armor-low | 0 / 0 | 1 / 0 |
| bipia-email-mixed | armor-base | 1 / 0 | 1 / 0 |
| bipia-email-mixed | ministral3-3b | 49 / 28 | 51 / 37 |
| bipia-email-mixed | armor-high | 3 / 0 | 4 / 0 |
| bipia-email-mixed | gemma4-31b | 38 / 0 | 36 / 0 |
| bipia-email-mixed | jev | 34 / 0 | 33 / 0 |
| benign-false-positives | gemma4-26b | 0 / 20 | 0 / 20 |
| benign-false-positives | qwen35-9b | 0 / 8 | 0 / 8 |
| benign-false-positives | qwen36-35b | 0 / 13 | 0 / 13 |
| attempt-detection | gemma4-26b | 330 / 0 | 341 / 0 |
| attempt-detection | qwen35-9b | 241 / 0 | 260 / 0 |
| attempt-detection | qwen36-35b | 315 / 0 | 317 / 0 |
| web-mixed | gemma4-26b | 240 / 81 | 240 / 92 |
| web-mixed | qwen35-9b | 232 / 94 | 233 / 122 |
| web-mixed | qwen36-35b | 236 / 76 | 235 / 86 |
| agentdojo-travel-mixed | gemma4-26b | 18 / 0 | 18 / 0 |
| agentdojo-travel-mixed | qwen35-9b | 18 / 0 | 18 / 0 |
| agentdojo-travel-mixed | qwen36-35b | 18 / 0 | 18 / 0 |
| bipia-email-mixed | gemma4-26b | 58 / 0 | 58 / 0 |
| bipia-email-mixed | qwen35-9b | 20 / 1 | 29 / 2 |
| bipia-email-mixed | qwen36-35b | 42 / 0 | 44 / 0 |
| agent-injection-bench-mixed | gemma4-26b | 130 / 1 | 132 / 0 |
| agent-injection-bench-mixed | qwen35-9b | 106 / 0 | 111 / 0 |
| agent-injection-bench-mixed | qwen36-35b | 132 / 0 | 131 / 0 |
| pids-obfuscated | armor-low | 114 / 0 | 123 / 0 |
| pids-obfuscated | armor-base | 155 / 0 | 162 / 0 |
| pids-obfuscated | armor-high | 233 / 0 | 238 / 0 |
| pids-obfuscated | gemma4-31b | 339 / 0 | 342 / 0 |
| pids-obfuscated | jev | 269 / 0 | 305 / 0 |
| pids-hard-benign-public | armor-low | 0 / 2 | 0 / 2 |
| pids-hard-benign-public | armor-base | 0 / 14 | 0 / 14 |
| pids-hard-benign-public | armor-high | 0 / 24 | 0 / 25 |
| pids-hard-benign-public | gemma4-31b | 0 / 13 | 0 / 14 |
| pids-hard-benign-public | jev | 0 / 172 | 0 / 176 |
| pids-obfuscated | gemma4-26b | 327 / 0 | 357 / 0 |
| pids-obfuscated | qwen35-9b | 279 / 0 | 306 / 0 |
| pids-obfuscated | qwen36-35b | 291 / 0 | 319 / 0 |
| pids-hard-benign-public | gemma4-26b | 0 / 19 | 0 / 17 |
| pids-hard-benign-public | qwen35-9b | 0 / 38 | 0 / 38 |
| pids-hard-benign-public | qwen36-35b | 0 / 72 | 0 / 70 |

### Identical-input stability control

Separate changed segmentation from repeated identical inputs. Temperature zero does not guarantee identical hosted outputs. Derived comparisons contain reused observations and are not stability replications.

| Cohort | Model | Identical-input cases | Changed flags on identical inputs | Attack delta on changed inputs | Benign delta on changed inputs |
|---|---|---:|---:|---:|---:|
| notinject-benign-339 | ministral3-3b | 339 | 8 | 0 | 0 |
| notinject-benign-339 | gemma3-4b | 339 | 4 | 0 | 0 |
| notinject-benign-339 | gemma4-31b | 339 | 1 | 0 | 0 |
| notinject-benign-339 | jev | 339 | 2 | 0 | 0 |
| in-page-wild-sample-v1 | gemma4-31b | 153 | 2 | -2 | 10 |
| agent-injection-bench-v1 | gemma4-31b | 51 | 2 | 0 | 0 |
| bipia-email-paired-v1 | ministral3-3b | 16 | 1 | 2 | 8 |
| in-page-wild-sample-v1 | gemma4-26b | 153 | 1 | 0 | 12 |
| in-page-wild-sample-v1 | qwen36-35b | 153 | 3 | 0 | 10 |
| agent-injection-bench-v1 | gemma4-26b | 51 | 1 | 2 | 0 |
| agent-injection-bench-v1 | qwen36-35b | 51 | 1 | 0 | 0 |
| pids-obfuscated-v1 | gemma4-31b | 139 | 4 | 3 | 0 |
| pids-hard-benign-public-v1 | jev | 785 | 13 | 0 | 1 |
| pids-obfuscated-v1 | gemma4-26b | 139 | 2 | 28 | 0 |
| pids-obfuscated-v1 | qwen35-9b | 139 | 3 | 24 | 0 |
| pids-obfuscated-v1 | qwen36-35b | 139 | 4 | 30 | 0 |
| pids-hard-benign-public-v1 | gemma4-26b | 785 | 1 | 0 | -1 |
| pids-hard-benign-public-v1 | qwen35-9b | 785 | 5 | 0 | 1 |
| pids-hard-benign-public-v1 | qwen36-35b | 785 | 12 | 0 | 2 |

## Context ablation

Only the legitimateTask field changes: actual trusted task versus null, with the same rationale prompt and output cap. Present Gemma4 31B rows reuse previously validated observations. Rows are paired; source-family dependencies still apply.

| Cohort | Model/condition | Detected attacks | Benign flags |
|---|---|---:|---:|
| agent-injection-bench-mixed | gemma4-26b-present | 132/142 (93.0%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | gemma4-26b-withheld | 128/142 (90.1%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | gemma4-31b-present | 127/142 (89.4%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | gemma4-31b-withheld | 126/142 (88.7%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | qwen35-9b-present | 105/142 (73.9%) | 0/40 (0.0%) |
| agent-injection-bench-mixed | qwen35-9b-withheld | 102/142 (71.8%) | 1/40 (2.5%) |
| agent-injection-bench-mixed | qwen36-35b-present | 136/142 (95.8%) | 1/40 (2.5%) |
| agent-injection-bench-mixed | qwen36-35b-withheld | 136/142 (95.8%) | 1/40 (2.5%) |
| agentdojo-travel-mixed | gemma4-26b-present | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma4-26b-withheld | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma4-31b-present | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | gemma4-31b-withheld | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen35-9b-present | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen35-9b-withheld | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen36-35b-present | 18/18 (100.0%) | 0/3 (0.0%) |
| agentdojo-travel-mixed | qwen36-35b-withheld | 18/18 (100.0%) | 0/3 (0.0%) |
| bipia-email-mixed | gemma4-26b-present | 61/78 (78.2%) | 0/78 (0.0%) |
| bipia-email-mixed | gemma4-26b-withheld | 63/78 (80.8%) | 0/78 (0.0%) |
| bipia-email-mixed | gemma4-31b-present | 58/78 (74.4%) | 0/78 (0.0%) |
| bipia-email-mixed | gemma4-31b-withheld | 61/78 (78.2%) | 0/78 (0.0%) |
| bipia-email-mixed | qwen35-9b-present | 34/78 (43.6%) | 0/78 (0.0%) |
| bipia-email-mixed | qwen36-35b-present | 53/78 (67.9%) | 0/78 (0.0%) |
| bipia-email-mixed | qwen36-35b-withheld | 61/78 (78.2%) | 0/78 (0.0%) |

## PIDS obfuscation breakdown

| Detector | Transform | Detections | Seed families |
|---|---|---:|---:|
| armor-low-full | zero_width | 20/53 | 52 |
| armor-low-full | homoglyph | 17/55 | 54 |
| armor-low-full | spacing_jitter | 16/61 | 60 |
| armor-low-full | base64_wrap | 0/50 | 49 |
| armor-low-full | rot13_wrap | 19/38 | 38 |
| armor-low-full | unicode_confusables | 24/90 | 86 |
| armor-low-full | markdown_split | 18/58 | 57 |
| armor-base-full | zero_width | 25/53 | 52 |
| armor-base-full | homoglyph | 19/55 | 54 |
| armor-base-full | spacing_jitter | 22/61 | 60 |
| armor-base-full | base64_wrap | 0/50 | 49 |
| armor-base-full | rot13_wrap | 32/38 | 38 |
| armor-base-full | unicode_confusables | 32/90 | 86 |
| armor-base-full | markdown_split | 25/58 | 57 |
| armor-high-full | zero_width | 29/53 | 52 |
| armor-high-full | homoglyph | 24/55 | 54 |
| armor-high-full | spacing_jitter | 28/61 | 60 |
| armor-high-full | base64_wrap | 43/50 | 49 |
| armor-high-full | rot13_wrap | 36/38 | 38 |
| armor-high-full | unicode_confusables | 40/90 | 86 |
| armor-high-full | markdown_split | 33/58 | 57 |
| armor-base-windows96 | zero_width | 24/53 | 52 |
| armor-base-windows96 | homoglyph | 19/55 | 54 |
| armor-base-windows96 | spacing_jitter | 26/61 | 60 |
| armor-base-windows96 | base64_wrap | 0/50 | 49 |
| armor-base-windows96 | rot13_wrap | 37/38 | 38 |
| armor-base-windows96 | unicode_confusables | 31/90 | 86 |
| armor-base-windows96 | markdown_split | 25/58 | 57 |
| gemma4-31b-full | zero_width | 44/53 | 52 |
| gemma4-31b-full | homoglyph | 41/55 | 54 |
| gemma4-31b-full | spacing_jitter | 52/61 | 60 |
| gemma4-31b-full | base64_wrap | 50/50 | 49 |
| gemma4-31b-full | rot13_wrap | 38/38 | 38 |
| gemma4-31b-full | unicode_confusables | 66/90 | 86 |
| gemma4-31b-full | markdown_split | 48/58 | 57 |
| armor-low-windows96 | zero_width | 20/53 | 52 |
| armor-low-windows96 | homoglyph | 17/55 | 54 |
| armor-low-windows96 | spacing_jitter | 18/61 | 60 |
| armor-low-windows96 | base64_wrap | 0/50 | 49 |
| armor-low-windows96 | rot13_wrap | 25/38 | 38 |
| armor-low-windows96 | unicode_confusables | 24/90 | 86 |
| armor-low-windows96 | markdown_split | 19/58 | 57 |
| jev-windows96 | zero_width | 41/53 | 52 |
| jev-windows96 | homoglyph | 42/55 | 54 |
| jev-windows96 | spacing_jitter | 47/61 | 60 |
| jev-windows96 | base64_wrap | 38/50 | 49 |
| jev-windows96 | rot13_wrap | 38/38 | 38 |
| jev-windows96 | unicode_confusables | 54/90 | 86 |
| jev-windows96 | markdown_split | 45/58 | 57 |
| jev-full | zero_width | 34/53 | 52 |
| jev-full | homoglyph | 38/55 | 54 |
| jev-full | spacing_jitter | 37/61 | 60 |
| jev-full | base64_wrap | 37/50 | 49 |
| jev-full | rot13_wrap | 38/38 | 38 |
| jev-full | unicode_confusables | 46/90 | 86 |
| jev-full | markdown_split | 39/58 | 57 |
| armor-high-windows96 | zero_width | 30/53 | 52 |
| armor-high-windows96 | homoglyph | 25/55 | 54 |
| armor-high-windows96 | spacing_jitter | 31/61 | 60 |
| armor-high-windows96 | base64_wrap | 43/50 | 49 |
| armor-high-windows96 | rot13_wrap | 37/38 | 38 |
| armor-high-windows96 | unicode_confusables | 39/90 | 86 |
| armor-high-windows96 | markdown_split | 33/58 | 57 |
| gemma4-31b-windows96 | zero_width | 44/53 | 52 |
| gemma4-31b-windows96 | homoglyph | 44/55 | 54 |
| gemma4-31b-windows96 | spacing_jitter | 51/61 | 60 |
| gemma4-31b-windows96 | base64_wrap | 50/50 | 49 |
| gemma4-31b-windows96 | rot13_wrap | 37/38 | 38 |
| gemma4-31b-windows96 | unicode_confusables | 67/90 | 86 |
| gemma4-31b-windows96 | markdown_split | 49/58 | 57 |
| qwen36-35b-windows96 | zero_width | 42/53 | 52 |
| qwen36-35b-windows96 | homoglyph | 43/55 | 54 |
| qwen36-35b-windows96 | spacing_jitter | 53/61 | 60 |
| qwen36-35b-windows96 | base64_wrap | 49/50 | 49 |
| qwen36-35b-windows96 | rot13_wrap | 29/38 | 38 |
| qwen36-35b-windows96 | unicode_confusables | 60/90 | 86 |
| qwen36-35b-windows96 | markdown_split | 43/58 | 57 |
| gemma4-26b-windows96 | zero_width | 47/53 | 52 |
| gemma4-26b-windows96 | homoglyph | 48/55 | 54 |
| gemma4-26b-windows96 | spacing_jitter | 54/61 | 60 |
| gemma4-26b-windows96 | base64_wrap | 50/50 | 49 |
| gemma4-26b-windows96 | rot13_wrap | 38/38 | 38 |
| gemma4-26b-windows96 | unicode_confusables | 71/90 | 86 |
| gemma4-26b-windows96 | markdown_split | 49/58 | 57 |
| qwen35-9b-windows96 | zero_width | 34/53 | 52 |
| qwen35-9b-windows96 | homoglyph | 39/55 | 54 |
| qwen35-9b-windows96 | spacing_jitter | 46/61 | 60 |
| qwen35-9b-windows96 | base64_wrap | 50/50 | 49 |
| qwen35-9b-windows96 | rot13_wrap | 38/38 | 38 |
| qwen35-9b-windows96 | unicode_confusables | 59/90 | 86 |
| qwen35-9b-windows96 | markdown_split | 40/58 | 57 |
| gemma4-26b-full | zero_width | 41/53 | 52 |
| gemma4-26b-full | homoglyph | 42/55 | 54 |
| gemma4-26b-full | spacing_jitter | 51/61 | 60 |
| gemma4-26b-full | base64_wrap | 50/50 | 49 |
| gemma4-26b-full | rot13_wrap | 38/38 | 38 |
| gemma4-26b-full | unicode_confusables | 61/90 | 86 |
| gemma4-26b-full | markdown_split | 44/58 | 57 |
| qwen35-9b-full | zero_width | 29/53 | 52 |
| qwen35-9b-full | homoglyph | 36/55 | 54 |
| qwen35-9b-full | spacing_jitter | 36/61 | 60 |
| qwen35-9b-full | base64_wrap | 50/50 | 49 |
| qwen35-9b-full | rot13_wrap | 38/38 | 38 |
| qwen35-9b-full | unicode_confusables | 50/90 | 86 |
| qwen35-9b-full | markdown_split | 40/58 | 57 |
| qwen36-35b-full | zero_width | 38/53 | 52 |
| qwen36-35b-full | homoglyph | 40/55 | 54 |
| qwen36-35b-full | spacing_jitter | 44/61 | 60 |
| qwen36-35b-full | base64_wrap | 48/50 | 49 |
| qwen36-35b-full | rot13_wrap | 26/38 | 38 |
| qwen36-35b-full | unicode_confusables | 53/90 | 86 |
| qwen36-35b-full | markdown_split | 42/58 | 57 |

## Exploratory paired ensembles

Fixed AND/OR rules over saved full-text >0.5 or native binary decisions; no additional model calls. These are post hoc exploration, not held-out model selection. Counts are TP / FP; use the full-text table for cohort denominators.

| Cohort | Pair | AND TP / FP | OR TP / FP |
|---|---|---:|---:|
| notinject-benign-339 | qwen35-9b + gemma4-26b | 0 / 4 | 0 / 24 |
| llmail-phase2-positive-400 | qwen35-9b + gemma4-26b | 231 / 0 | 340 / 0 |
| in-page-wild-sample-v1 | qwen35-9b + gemma4-26b | 232 / 72 | 240 / 103 |
| agentdojo-travel-v1 | qwen35-9b + gemma4-26b | 18 / 0 | 18 / 0 |
| bipia-email-paired-v1 | qwen35-9b + gemma4-26b | 19 / 0 | 59 / 1 |
| agent-injection-bench-v1 | qwen35-9b + gemma4-26b | 104 / 0 | 132 / 1 |
| pids-obfuscated-v1 | qwen35-9b + gemma4-26b | 270 / 0 | 336 / 0 |
| pids-hard-benign-public-v1 | qwen35-9b + gemma4-26b | 0 / 8 | 0 / 49 |
| notinject-benign-339 | gemma4-26b + gemma4-31b | 0 / 9 | 0 / 24 |
| llmail-phase2-positive-400 | gemma4-26b + gemma4-31b | 274 / 0 | 340 / 0 |
| in-page-wild-sample-v1 | gemma4-26b + gemma4-31b | 224 / 57 | 240 / 82 |
| agentdojo-travel-v1 | gemma4-26b + gemma4-31b | 18 / 0 | 18 / 0 |
| bipia-email-paired-v1 | gemma4-26b + gemma4-31b | 36 / 0 | 60 / 0 |
| agent-injection-bench-v1 | gemma4-26b + gemma4-31b | 116 / 0 | 131 / 1 |
| pids-obfuscated-v1 | gemma4-26b + gemma4-31b | 309 / 0 | 357 / 0 |
| pids-hard-benign-public-v1 | gemma4-26b + gemma4-31b | 0 / 13 | 0 / 19 |
| notinject-benign-339 | gemma4-26b + qwen36-35b | 0 / 10 | 0 / 23 |
| llmail-phase2-positive-400 | gemma4-26b + qwen36-35b | 287 / 0 | 358 / 0 |
| in-page-wild-sample-v1 | gemma4-26b + qwen36-35b | 236 / 74 | 240 / 83 |
| agentdojo-travel-v1 | gemma4-26b + qwen36-35b | 18 / 0 | 18 / 0 |
| bipia-email-paired-v1 | gemma4-26b + qwen36-35b | 40 / 0 | 60 / 0 |
| agent-injection-bench-v1 | gemma4-26b + qwen36-35b | 128 / 0 | 134 / 1 |
| pids-obfuscated-v1 | gemma4-26b + qwen36-35b | 285 / 0 | 333 / 0 |
| pids-hard-benign-public-v1 | gemma4-26b + qwen36-35b | 0 / 13 | 0 / 78 |
| notinject-benign-339 | gemma4-31b + armor-high | 0 / 3 | 0 / 23 |
| llmail-phase2-positive-400 | gemma4-31b + armor-high | 84 / 0 | 289 / 0 |
| in-page-wild-sample-v1 | gemma4-31b + armor-high | 181 / 42 | 231 / 175 |
| agentdojo-travel-v1 | gemma4-31b + armor-high | 18 / 0 | 18 / 0 |
| agent-injection-bench-v1 | gemma4-31b + armor-high | 34 / 0 | 118 / 1 |
| bipia-email-paired-v1 | gemma4-31b + armor-high | 3 / 0 | 38 / 0 |
| pids-obfuscated-v1 | gemma4-31b + armor-high | 223 / 0 | 349 / 0 |
| pids-hard-benign-public-v1 | gemma4-31b + armor-high | 0 / 0 | 0 / 37 |

## Incomplete retained checkpoints

Coverage counts below are diagnostics only, not validated performance metrics. Retired legacy conditions remain preserved.

| Checkpoint | Attempted segments | Scored segments | Expected segments | Recorded errors |
|---|---:|---:|---:|---:|
| evals/runs/research-round1-2026-09-29/attempt-detection/gemma3-4b-windows96.jsonl | 687 | 668 | 1796 | 1 |
| evals/runs/research-round1-2026-09-29/web-mixed/gemma3-4b-full.jsonl | 480 | 465 | 480 | 2 |
| evals/runs/research-round1-2026-09-29/web-mixed/gemma3-4b-windows96.jsonl | 554 | 529 | 677 | 1 |
| evals/runs/research-context-ablation-2026-09-29/bipia-email-mixed/qwen35-9b-withheld.jsonl | 156 | 155 | 156 | 2 |

## Captured inference failures

These complete cells required recovery after recorded failures. Valid scores are conditional on the stated recovery policy; errors remain in raw checkpoints and are not scored as benign. Incomplete cells remain in the missing-coverage list.

| Cohort | Condition | Recorded errors | Rate-limit responses |
|---|---|---:|---:|
| web-mixed | gemma4-31b-full | 1 | 22 |
| web-mixed | armor-low-windows96 | 1 | 62 |
| benign-false-positives | qwen35-9b-full | 1 | 0 |
| pids-obfuscated | gemma4-26b-full | 1 | 10 |

## Interpretation and preservation

- PIDS hard-benign public subset: 808 available rows, 664 withheld LMSYS rows excluded. Its 600 curated and 208 externally sourced inputs are not representative of production traffic. Upstream labels describe gateway detection; legitimate user imperatives may differ from external-source instructions. Data inherits research/noncommercial restrictions.
- PIDS obfuscated attacks: 405 rows derived from upstream test seeds. Transform and seed-family dependence invalidate treating all rows as independent evidence. See facet counts and paired results in the ignored summary JSON.
- BIPIA has 78 paired email contexts; labels indicate an inserted attack attempt, not observed compromise. Dojo has only 18 attacks and 3 clean probes.
- Native Model Armor filter-version metadata: 11811 responses: {"filterVersion":"v3","filterVersionAlias":"FILTER_VERSION_ALIAS_STABLE","releaseDate":{"year":2026,"month":5,"day":25},"projectedDeprecationDate":{}}. This does not identify template threshold settings.
- Model Armor template reads returned 403; aliases are preserved without claiming verified filter settings. Older checkpoints retain normalized assessments only. New capture also retains native successful response bodies; neither missing historical bodies nor template snapshots are fabricated.
- Raw sources, responses, partial runs, endpoint snapshots, and analysis JSON are retained in ignored evals/private and evals/runs. Exact reuse is explicitly marked; it is not fresh replication.
- Model Armor conservative allowance for the selected directories: $5.1062 for 22777 dispatches, charging one token per full-case UTF-8 byte plus 1024 overhead at $0.10/million and ignoring the free tier. This is an intentionally conservative planning estimate, not a billing statement.

Sources: [PIDS paper](https://arxiv.org/abs/2609.15017), [pinned PIDS repository](https://github.com/ShirePyDev/Prompt-Injection-Detection-System/tree/caa329e1cd9fc3a7fb448fa6f413420d9885f4a1), [Gemma memory planning](https://ai.google.dev/gemma/docs/core), [Model Armor pricing](https://cloud.google.com/security/products/model-armor).
