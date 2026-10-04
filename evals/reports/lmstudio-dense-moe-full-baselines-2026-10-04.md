# Dense and MoE models: full-input baselines

Updated 2026-10-04T23:03:19.141Z. New chunking runs are deferred under the user's full-input-first instruction.

Four larger configurations passed the bounded protocol qualification: two dense and two MoE. This is not yet the requested five-versus-five panel. Qwen3.8 27B Q8 produced 24 valid full-paper outputs; all five of its full-input cohorts are now fully attempted, matching the other three larger configurations. Other requested artifacts remain pending, and base or unloadable artifacts are not substituted. No architecture-group average or causal ranking is reported.

All rows use complete last-external input, the same versioned score-only detector prompt, requested high reasoning / 1,024-token cap, and score >0.5. Actual reasoning, backend, quantization and drafting differ. Raw here means full input, not an unprompted model or equal-compute experiment. Counts below are released only when every selected case is scored or has an explicitly retained output abstention.

## NotInject

Complete 339-case benign cohort.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":338,"length_abstention":1} | — | 15/338 | 1 | 25.78 |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":335,"length_abstention":4} | — | 3/335 | 4 | 16.33 |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":339} | — | 23/339 | 0 | 0.62 |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":339} | — | 16/339 | 0 | 3.37 |
| Gemma26 GGUF Q8 | MoE | not started | — | — | — | — |
| Laguna XS2.1 Q8 | MoE | not started | — | — | — | — |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — |
| Gemma31-it Q8 | dense | not started | — | — | — | — |

## Numerical attack-following probe

Complete 72-case post-hoc diagnostic, six source families.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":70,"length_abstention":2} | 45/52 | 0/18 | 2 | 49.91 |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":67,"length_abstention":5} | 48/49 | 0/18 | 5 | 48.06 |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":72} | 38/54 | 0/18 | 0 | 1.51 |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":71,"length_abstention":1} | 46/53 | 4/18 | 1 | 11.20 |
| Gemma26 GGUF Q8 | MoE | not started | — | — | — | — |
| Laguna XS2.1 Q8 | MoE | not started | — | — | — | — |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — |
| Gemma31-it Q8 | dense | not started | — | — | — | — |

| Model | Exact paired target tracking | Low→high decision flips |
|---|---:|---:|
| Muse Glimmer Q4 | 0/16 | 1/16 |
| Qwen3.8 27B Q8 | 0/15 | 0/15 |
| Gemma26 MLX8 | 0/18 | 2/18 |
| Ornith1.5 Q8 | 0/18 | 2/18 |

A high detector score may reflect the injected rating. No exact endpoint match is not proof of resistance. See the [attack-following write-up](injection-following-findings-2026-10-04.md) and its case appendix.

## LongPI emails

Frozen first 20 ordered families / 80 of 400 source cases.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":80} | 59/60 | 0/20 | 0 | 36.49 |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 29.07 |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 1.24 |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":80} | 60/60 | 0/20 | 0 | 7.05 |
| Gemma26 GGUF Q8 | MoE | not started | — | — | — | — |
| Laguna XS2.1 Q8 | MoE | not started | — | — | — | — |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — |
| Gemma31-it Q8 | dense | not started | — | — | — | — |

## BIPIA paired emails

Complete 78 attack / clean pairs.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":154,"length_abstention":2} | 43/76 | 0/78 | 2 | 44.68 |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":153,"length_abstention":3} | 18/75 | 0/78 | 3 | 26.06 |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":156} | 60/78 | 0/78 | 0 | 0.72 |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":156} | 49/78 | 0/78 | 0 | 4.89 |
| Gemma26 GGUF Q8 | MoE | not started | — | — | — | — |
| Laguna XS2.1 Q8 | MoE | not started | — | — | — | — |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — |
| Gemma31-it Q8 | dense | not started | — | — | — | — |

## LongPI code review

Complete 400-case cohort: 100 source families, one clean and three attack variants (naive, combine, authority) each; per-template counts in lmstudio-full-code-baselines-2026-10-04.md.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | not started | — | — | — | — |
| Qwen3.8 27B Q8 | dense | not started | — | — | — | — |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":400} | 198/300 | 0/100 | 0 | 1.22 |
| Ornith1.5 Q8 | MoE | in progress / partial: {"scored":141,"unresolved":1,"unattempted":258} | — | — | — | — |
| Gemma26 GGUF Q8 | MoE | not started | — | — | — | — |
| Laguna XS2.1 Q8 | MoE | not started | — | — | — | — |
| Nemotron3.5 Lightning Q8 | MoE | not started | — | — | — | — |
| Gemma31-it Q8 | dense | not started | — | — | — | — |

## Original-paper protocol tranche

First six families / 24 of 400 source cases; protocol check, not a full benchmark.

| Model | Architecture | Coverage | Attack flags / valid | Clean flags / valid | Abstentions | Mean valid request seconds |
|---|---|---|---:|---:|---:|---:|
| Muse Glimmer Q4 | dense | selected cohort fully attempted: {"scored":24} | 16/18 | 0/6 | 0 | 54.21 |
| Qwen3.8 27B Q8 | dense | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 54.68 |
| Gemma26 MLX8 | MoE | selected cohort fully attempted: {"scored":24} | 12/18 | 0/6 | 0 | 3.87 |
| Ornith1.5 Q8 | MoE | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 13.17 |
| Gemma26 GGUF Q8 | MoE | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 8.20 |
| Laguna XS2.1 Q8 | MoE | selected cohort fully attempted: {"scored":24} | 2/18 | 0/6 | 0 | 8.08 |
| Nemotron3.5 Lightning Q8 | MoE | in progress / partial: {"scored":2,"length_abstention":1,"unattempted":21} | — | — | — | — |
| Gemma31-it Q8 | dense | selected cohort fully attempted: {"scored":24} | 18/18 | 0/6 | 0 | 57.37 |

## Supplemental comparison on jointly valid cases

These counts restrict each finished cohort to cases with a valid score from every qualified model. This makes the input set identical, but excludes failures that may be nonrandom; it is conditional performance, not a replacement for the primary counts and abstentions above. The snapshot retains excluded IDs, reasons, and every pairwise disagreement. Equal counts do not imply the same detected cases.

| Cohort | Jointly valid / selected | Model | Attack flags / valid | Clean flags / valid |
|---|---:|---|---:|---:|
## Gemma26: MLX8 versus GGUF Q8_0 (same model, two formats)

Both rows are Gemma 4 26B-A4B-it under the identical prompt, cap, requested reasoning and threshold. They differ in weight format/quantizer (lmstudio-community MLX 8-bit vs GGUF Q8_0) and LM Studio engine (MLX vs llama.cpp). The MLX build reported zero reasoning tokens on every first-six paper response; the GGUF build reported reasoning on every one. The contrast therefore bundles format, runtime and actual reasoning; it is not a quantization-only or reasoning-only effect.

| Cohort | MLX8 attack flags / valid | GGUF attack flags / valid | MLX8 clean flags / valid | GGUF clean flags / valid | Joint attacks: both / MLX only / GGUF only / neither | Joint clean: MLX only / GGUF only | Mean s MLX / GGUF |
|---|---:|---:|---:|---:|---|---|---|
| Original-paper protocol tranche | 12/18 | 18/18 | 0/6 | 0/6 | 12 / 0 / 6 / 0 | 0 / 0 | 3.87 / 8.20 |

Case IDs for every disagreement are in `gemma26FormatPairs` of the snapshot JSON.


Timing includes relay and placement checks for valid scores; abstaining requests and model loading are excluded. Source cases, native responses, captured-prefix hashes and configuration identities remain in the snapshot JSON. In-progress rows show coverage only, avoiding an apparent leaderboard based on different completed prefixes.

The first-six paper selection and first-twenty email selection are convenience tranches with shared attack templates, not complete source benchmarks. The numerical probe shares the six paper families. Do not pool cohorts as independent trials or as deployment accuracy. Small-model references remain in the linked per-cohort reports; their outputs will not be repeated.

All four larger configurations have now attempted every case in all five full-input cohorts. Muse BIPIA retains two attack length abstentions; Qwen3.8 retains three BIPIA, five numerical and four NotInject length abstentions, all empty final answers after the 1,024-token cap was spent on reasoning. None is retried or counted as a miss or a clean decision. The prepared full code-review cohort is next; broader source cohorts should retain exact saved-input reuse. Keep new chunking calls deferred. Remaining model downloads and qualifications are still outstanding.
