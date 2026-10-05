# Dense and MoE models: full-input baselines

Updated 2026-10-05T19:55:10.636Z. New chunking runs are deferred under the user's full-input-first instruction.

Qualified panel (log L119): MoE = Gemma26 (MLX8 and GGUF Q8_0 builds of the same model), Ornith1.5, Laguna XS2.1; dense = Muse Glimmer Q4, Qwen3.8 27B Q8, Gemma 4 31B-it Q8. Nemotron 3.5 Lightning failed qualification and is shown only as not started / partial. Group-level comparison and confounds are in the [MoE-vs-dense panel report](lmstudio-moe-dense-panel-2026-10-05.md); this page reports per-model counts only.

All rows use complete last-external input, the same versioned score-only detector prompt, requested high reasoning / 1,024-token cap, and score >0.5. Actual reasoning, backend, quantization and drafting differ. Raw here means full input, not an unprompted model or equal-compute experiment. Counts below are released only when every selected case is scored or has an explicitly retained output abstention.

## NotInject

Complete 339-case benign cohort.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":338,"length_abstention":1} | — | 15/338 | 1 | 25.78 | 253 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":335,"length_abstention":4} | — | 3/335 | 4 | 16.33 | 163 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":339} | — | 23/339 | 0 | 0.62 | 0 (339) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":339} | — | 16/339 | 0 | 3.37 | 147 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":335,"length_abstention":4} | — | 20/335 | 4 | 5.32 | 209 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":334,"length_abstention":5} | — | 7/334 | 5 | 9.66 | 2 (330) |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":338,"length_abstention":1} | — | 22/338 | 1 | 23.81 | 189 (0) |

## Numerical attack-following probe

Complete 72-case post-hoc diagnostic, six source families.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":70,"length_abstention":2} | 45/52 | 0/18 | 2 | 49.91 | 441 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":67,"length_abstention":5} | 48/49 | 0/18 | 5 | 48.06 | 400 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":72} | 38/54 | 0/18 | 0 | 1.51 | 0 (72) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":71,"length_abstention":1} | 46/53 | 4/18 | 1 | 11.20 | 457 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":72} | 54/54 | 0/18 | 0 | 11.83 | 355 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":68,"length_abstention":4} | 13/50 | 0/18 | 4 | 5.81 | 248 (37) |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":72} | 54/54 | 0/18 | 0 | 49.96 | 334 (0) |

| Model | Exact paired target tracking | Low→high decision flips |
|---|---:|---:|
| Muse Glimmer Q4 | 0/16 | 1/16 |
| Qwen3.8 27B Q8 | 0/15 | 0/15 |
| Gemma26 MLX8 | 0/18 | 2/18 |
| Ornith1.5 Q8 | 0/18 | 2/18 |

A high detector score may reflect the injected rating. No exact endpoint match is not proof of resistance. See the [attack-following write-up](injection-following-findings-2026-10-04.md) and its case appendix.

## LongPI emails

Frozen first 20 ordered families / 80 of 400 source cases.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":80} | 59/60 | 0/20 | 0 | 36.49 | 311 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 29.07 | 203 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 1.24 | 0 (80) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 7.05 | 242 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 7.70 | 259 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":79,"length_abstention":1} | 39/59 | 0/20 | 1 | 4.39 | 162 (52) |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 33.47 | 218 (0) |

## BIPIA paired emails

Complete 78 attack / clean pairs.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":154,"length_abstention":2} | 43/76 | 0/78 | 2 | 44.68 | 459 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":153,"length_abstention":3} | 18/75 | 0/78 | 3 | 26.06 | 257 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":156} | 60/78 | 0/78 | 0 | 0.72 | 0 (156) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":156} | 49/78 | 0/78 | 0 | 4.89 | 214 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":151,"length_abstention":5} | 62/73 | 0/78 | 5 | 7.76 | 315 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":156} | 3/78 | 0/78 | 0 | 7.28 | 0 (156) |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":156} | 62/78 | 0/78 | 0 | 31.64 | 248 (0) |

## LongPI code review

Complete 400-case cohort: 100 source families, one clean and three attack variants (naive, combine, authority) each; per-template counts in lmstudio-full-code-baselines-2026-10-04.md.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":400} | 207/300 | 0/100 | 0 | 30.22 | 342 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":398,"length_abstention":2} | 271/298 | 0/100 | 2 | 27.22 | 275 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":400} | 198/300 | 0/100 | 0 | 1.22 | 0 (400) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":400} | 288/300 | 0/100 | 0 | 5.10 | 205 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":353,"length_abstention":47} | 244/253 | 0/100 | 47 | 8.73 | 393 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":396,"length_abstention":4} | 64/300 | 1/96 | 4 | 1.84 | 47 (354) |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":386,"length_abstention":14} | 225/286 | 0/100 | 14 | 36.64 | 286 (0) |

## Original-paper protocol tranche

First six families / 24 of 400 source cases; protocol check, not a full benchmark.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds | Mean reasoning tokens (zero) |
|---|---|---|---:|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":24} | 16/18 | 0/6 | 0 | 54.21 | 362 (0) |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 54.68 | 312 (0) |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":24} | 12/18 | 0/6 | 0 | 3.87 | 0 (24) |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 13.17 | 395 (0) |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 8.20 | 320 (0) |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":24} | 2/18 | 0/6 | 0 | 8.08 | 287 (7) |
| Nemotron3.5 Lightning Q8 | MoE | in progress / partial: {"scored":2,"length_abstention":1,"unattempted":21} | — | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 57.37 | 284 (0) |

## Supplemental comparison on jointly valid cases

These counts restrict each finished cohort to cases with a valid score from every qualified model. This makes the input set identical, but excludes failures that may be nonrandom; it is conditional performance, not a replacement for the primary counts and abstentions above. The snapshot retains excluded IDs, reasons, and every pairwise disagreement. Equal counts do not imply the same detected cases.

| Cohort | Jointly valid / selected | Model | Attack flags / valid | Clean flags / valid |
|---|---:|---|---:|---:|
| NotInject | 326/339 | Muse Glimmer Q4 | — | 13/326 |
| NotInject | 326/339 | Qwen3.8 27B Q8 | — | 2/326 |
| NotInject | 326/339 | Gemma26 MLX8 | — | 19/326 |
| NotInject | 326/339 | Ornith1.5 Q8 | — | 13/326 |
| NotInject | 326/339 | Gemma26 GGUF Q8 | — | 19/326 |
| NotInject | 326/339 | Laguna XS2.1 Q8 | — | 6/326 |
| NotInject | 326/339 | Gemma31-it Q8 | — | 19/326 |
| Numerical attack-following probe | 63/72 | Muse Glimmer Q4 | 41/45 | 0/18 |
| Numerical attack-following probe | 63/72 | Qwen3.8 27B Q8 | 44/45 | 0/18 |
| Numerical attack-following probe | 63/72 | Gemma26 MLX8 | 35/45 | 0/18 |
| Numerical attack-following probe | 63/72 | Ornith1.5 Q8 | 41/45 | 4/18 |
| Numerical attack-following probe | 63/72 | Gemma26 GGUF Q8 | 45/45 | 0/18 |
| Numerical attack-following probe | 63/72 | Laguna XS2.1 Q8 | 13/45 | 0/18 |
| Numerical attack-following probe | 63/72 | Gemma31-it Q8 | 45/45 | 0/18 |
| LongPI emails | 79/80 | Muse Glimmer Q4 | 58/59 | 0/20 |
| LongPI emails | 79/80 | Qwen3.8 27B Q8 | 59/59 | 0/20 |
| LongPI emails | 79/80 | Gemma26 MLX8 | 59/59 | 0/20 |
| LongPI emails | 79/80 | Ornith1.5 Q8 | 59/59 | 0/20 |
| LongPI emails | 79/80 | Gemma26 GGUF Q8 | 59/59 | 0/20 |
| LongPI emails | 79/80 | Laguna XS2.1 Q8 | 39/59 | 0/20 |
| LongPI emails | 79/80 | Gemma31-it Q8 | 59/59 | 0/20 |
| BIPIA paired emails | 146/156 | Muse Glimmer Q4 | 40/68 | 0/78 |
| BIPIA paired emails | 146/156 | Qwen3.8 27B Q8 | 18/68 | 0/78 |
| BIPIA paired emails | 146/156 | Gemma26 MLX8 | 53/68 | 0/78 |
| BIPIA paired emails | 146/156 | Ornith1.5 Q8 | 45/68 | 0/78 |
| BIPIA paired emails | 146/156 | Gemma26 GGUF Q8 | 57/68 | 0/78 |
| BIPIA paired emails | 146/156 | Laguna XS2.1 Q8 | 2/68 | 0/78 |
| BIPIA paired emails | 146/156 | Gemma31-it Q8 | 54/68 | 0/78 |
| LongPI code review | 339/400 | Muse Glimmer Q4 | 202/243 | 0/96 |
| LongPI code review | 339/400 | Qwen3.8 27B Q8 | 230/243 | 0/96 |
| LongPI code review | 339/400 | Gemma26 MLX8 | 198/243 | 0/96 |
| LongPI code review | 339/400 | Ornith1.5 Q8 | 238/243 | 0/96 |
| LongPI code review | 339/400 | Gemma26 GGUF Q8 | 237/243 | 0/96 |
| LongPI code review | 339/400 | Laguna XS2.1 Q8 | 63/243 | 1/96 |
| LongPI code review | 339/400 | Gemma31-it Q8 | 213/243 | 0/96 |
| Original-paper protocol tranche | 24/24 | Muse Glimmer Q4 | 16/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Qwen3.8 27B Q8 | 18/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Gemma26 MLX8 | 12/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Ornith1.5 Q8 | 18/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Gemma26 GGUF Q8 | 18/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Laguna XS2.1 Q8 | 2/18 | 0/6 |
| Original-paper protocol tranche | 24/24 | Gemma31-it Q8 | 18/18 | 0/6 |

## Gemma26: MLX8 versus GGUF Q8_0 (same model, two formats)

Both rows are Gemma 4 26B-A4B-it under the identical prompt, cap, requested reasoning and threshold. They differ in weight format/quantizer (lmstudio-community MLX 8-bit vs GGUF Q8_0) and LM Studio engine (MLX vs llama.cpp). The MLX build reports zero reasoning tokens on every response in every cohort; the GGUF build reports reasoning on every response (the last column counts all responses for selected cases, including abstentions). Every GGUF abstention is an empty or truncated final answer after the 1,024-token cap; the MLX build has none. The contrast therefore bundles format, runtime and actual reasoning; it is not a quantization-only or reasoning-only effect.

| Cohort | MLX8 attack flags / valid | GGUF attack flags / valid | MLX8 clean flags / valid | GGUF clean flags / valid | Joint attacks: both / MLX only / GGUF only / neither | Joint clean: MLX only / GGUF only | Mean s MLX / GGUF | Mean reasoning tokens MLX / GGUF (zero-reasoning responses) |
|---|---:|---:|---:|---:|---|---|---|---|
| NotInject | — | — | 23/339 | 20/335 | — | 4 / 4 | 0.62 / 5.32 | 0 (339/339) / 209 (0/339) |
| Numerical attack-following probe | 38/54 | 54/54 | 0/18 | 0/18 | 38 / 0 / 16 / 0 | 0 / 0 | 1.51 / 11.83 | 0 (72/72) / 355 (0/72) |
| LongPI emails | 60/60 | 60/60 | 0/20 | 0/20 | 60 / 0 / 0 / 0 | 0 / 0 | 1.24 / 7.70 | 0 (80/80) / 259 (0/80) |
| BIPIA paired emails | 60/78 | 62/73 | 0/78 | 0/78 | 53 / 4 / 9 / 7 | 0 / 0 | 0.72 / 7.76 | 0 (156/156) / 315 (0/156) |
| LongPI code review | 198/300 | 244/253 | 0/100 | 0/100 | 198 / 0 / 46 / 9 | 0 / 0 | 1.22 / 8.73 | 0 (400/400) / 393 (0/400) |
| Original-paper protocol tranche | 12/18 | 18/18 | 0/6 | 0/6 | 12 / 0 / 6 / 0 | 0 / 0 | 3.87 / 8.20 | 0 (24/24) / 320 (0/24) |

Case IDs for every disagreement are in `gemma26FormatPairs` of the snapshot JSON.


Timing includes relay and placement checks for valid scores; abstaining requests and model loading are excluded. Source cases, native responses, captured-prefix hashes and configuration identities remain in the snapshot JSON. In-progress rows show coverage only, avoiding an apparent leaderboard based on different completed prefixes.

The first-six paper selection and first-twenty email selection are convenience tranches with shared attack templates, not complete source benchmarks. The numerical probe shares the six paper families. Do not pool cohorts as independent trials or as deployment accuracy. Small-model references remain in the linked per-cohort reports; their outputs will not be repeated.

Every abstention is retained as a length abstention (empty or truncated final answer after the 1,024-token cap); none is retried or counted as a miss or a clean decision. Laguna XS2.1 reasoning-token means on the short-prompt cohorts (BIPIA, NotInject) understate generated work: those responses report ~300–470 completion tokens that appear in neither content nor reasoning_content and are not counted as reasoning (log L123). For v2 numeric pair diagnostics (exact endpoint pairs, low→high flips) see the numeric report. Keep new chunking calls deferred.
