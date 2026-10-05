# Local model false alarms on NotInject

Updated 2026-10-05T12:42:31.833Z. Frozen cohort: 339 benign cases; full last external input; score >0.5 flags. Missing or abstaining cases never count as successful benign decisions.

| Configuration | Status | Valid scores / 339 | False alarms / valid |
|---|---|---:|---:|
| E2B Q4 none/64 | complete | 339/339 | 2/339 |
| E2B Q4 high/1024 | complete | 339/339 | 10/339 |
| E4B Q4 high/1024 | complete | 339/339 | 24/339 |
| Muse Q4 high/1024 | partial_or_abstaining | 338/339 | 15/338 |
| Qwen3.8 Q8 high/1024 | partial_or_abstaining | 335/339 | 3/335 |
| Gemma26 MLX8 high/1024 | complete | 339/339 | 23/339 |
| Ornith1.5 Q8 high/1024 | complete | 339/339 | 16/339 |
| Gemma26 GGUF Q8 high/1024 | partial_or_abstaining | 335/339 | 20/335 |
| Laguna XS2.1 Q8 high/1024 | partial_or_abstaining | 334/339 | 7/334 |
| Nemotron3.5 Lightning Q8 high/1024 | not_started | 0/339 | — |
| Gemma31-it Q8 high/1024 | partial_or_abstaining | 338/339 | 22/338 |

| Configuration | Timed valid scores | Mean seconds | Median seconds | p95 seconds | Generated tokens |
|---|---:|---:|---:|---:|---:|
| E2B Q4 none/64 | 339 | 0.696 | 0.687 | 0.806 | 6442 |
| E2B Q4 high/1024 | 339 | 3.268 | 3.206 | 4.692 | 83953 |
| E4B Q4 high/1024 | 339 | 6.334 | 6.138 | 9.289 | 78801 |
| Muse Q4 high/1024 | 338 | 25.775 | 22.837 | 46.094 | 91691 |
| Qwen3.8 Q8 high/1024 | 335 | 16.333 | 13.284 | 33.909 | 55234 |
| Gemma26 MLX8 high/1024 | 339 | 0.625 | 0.590 | 0.734 | 2799 |
| Ornith1.5 Q8 high/1024 | 339 | 3.371 | 3.068 | 6.138 | 54195 |
| Gemma26 GGUF Q8 high/1024 | 335 | 5.316 | 4.514 | 12.310 | 73843 |
| Laguna XS2.1 Q8 high/1024 | 334 | 9.659 | 9.626 | 9.972 | 155724 |
| Gemma31-it Q8 high/1024 | 338 | 23.813 | 22.669 | 44.388 | 69906 |

Timing uses captured observation.durationMs for valid scores only, including placement checks, local relay and remote request time. Abstaining requests and model load/unload time are excluded. Generated tokens include reported reasoning where applicable. Models ran sequentially at different times and differ in runtime and quantization; these are observed service times, not isolated architecture speed or energy measurements.


| Paired A → B | Scored in both | Shared false alarms | A only | B only |
|---|---:|---:|---:|---:|
| E2B Q4 none/64 → E2B Q4 high/1024 | 339 | 1 | 1 | 9 |
| E2B Q4 none/64 → E4B Q4 high/1024 | 339 | 2 | 0 | 22 |
| E2B Q4 none/64 → Muse Q4 high/1024 | 338 | 1 | 1 | 14 |
| E2B Q4 none/64 → Qwen3.8 Q8 high/1024 | 335 | 1 | 1 | 2 |
| E2B Q4 none/64 → Gemma26 MLX8 high/1024 | 339 | 1 | 1 | 22 |
| E2B Q4 none/64 → Ornith1.5 Q8 high/1024 | 339 | 1 | 1 | 15 |
| E2B Q4 none/64 → Gemma26 GGUF Q8 high/1024 | 335 | 1 | 1 | 19 |
| E2B Q4 none/64 → Laguna XS2.1 Q8 high/1024 | 334 | 0 | 2 | 7 |
| E2B Q4 none/64 → Gemma31-it Q8 high/1024 | 338 | 1 | 1 | 21 |
| E2B Q4 high/1024 → E4B Q4 high/1024 | 339 | 7 | 3 | 17 |
| E2B Q4 high/1024 → Muse Q4 high/1024 | 338 | 6 | 4 | 9 |
| E2B Q4 high/1024 → Qwen3.8 Q8 high/1024 | 335 | 3 | 7 | 0 |
| E2B Q4 high/1024 → Gemma26 MLX8 high/1024 | 339 | 7 | 3 | 16 |
| E2B Q4 high/1024 → Ornith1.5 Q8 high/1024 | 339 | 6 | 4 | 10 |
| E2B Q4 high/1024 → Gemma26 GGUF Q8 high/1024 | 335 | 6 | 4 | 14 |
| E2B Q4 high/1024 → Laguna XS2.1 Q8 high/1024 | 334 | 4 | 6 | 3 |
| E2B Q4 high/1024 → Gemma31-it Q8 high/1024 | 338 | 6 | 3 | 16 |
| E4B Q4 high/1024 → Muse Q4 high/1024 | 338 | 11 | 13 | 4 |
| E4B Q4 high/1024 → Qwen3.8 Q8 high/1024 | 335 | 2 | 22 | 1 |
| E4B Q4 high/1024 → Gemma26 MLX8 high/1024 | 339 | 14 | 10 | 9 |
| E4B Q4 high/1024 → Ornith1.5 Q8 high/1024 | 339 | 10 | 14 | 6 |
| E4B Q4 high/1024 → Gemma26 GGUF Q8 high/1024 | 335 | 13 | 10 | 7 |
| E4B Q4 high/1024 → Laguna XS2.1 Q8 high/1024 | 334 | 2 | 22 | 5 |
| E4B Q4 high/1024 → Gemma31-it Q8 high/1024 | 338 | 14 | 10 | 8 |
| Muse Q4 high/1024 → Qwen3.8 Q8 high/1024 | 334 | 3 | 12 | 0 |
| Muse Q4 high/1024 → Gemma26 MLX8 high/1024 | 338 | 10 | 5 | 13 |
| Muse Q4 high/1024 → Ornith1.5 Q8 high/1024 | 338 | 8 | 7 | 8 |
| Muse Q4 high/1024 → Gemma26 GGUF Q8 high/1024 | 334 | 9 | 5 | 11 |
| Muse Q4 high/1024 → Laguna XS2.1 Q8 high/1024 | 333 | 2 | 13 | 5 |
| Muse Q4 high/1024 → Gemma31-it Q8 high/1024 | 337 | 8 | 6 | 14 |
| Qwen3.8 Q8 high/1024 → Gemma26 MLX8 high/1024 | 335 | 3 | 0 | 20 |
| Qwen3.8 Q8 high/1024 → Ornith1.5 Q8 high/1024 | 335 | 3 | 0 | 13 |
| Qwen3.8 Q8 high/1024 → Gemma26 GGUF Q8 high/1024 | 331 | 3 | 0 | 17 |
| Qwen3.8 Q8 high/1024 → Laguna XS2.1 Q8 high/1024 | 331 | 2 | 1 | 5 |
| Qwen3.8 Q8 high/1024 → Gemma31-it Q8 high/1024 | 334 | 2 | 0 | 20 |
| Gemma26 MLX8 high/1024 → Ornith1.5 Q8 high/1024 | 339 | 10 | 13 | 6 |
| Gemma26 MLX8 high/1024 → Gemma26 GGUF Q8 high/1024 | 335 | 16 | 4 | 4 |
| Gemma26 MLX8 high/1024 → Laguna XS2.1 Q8 high/1024 | 334 | 3 | 19 | 4 |
| Gemma26 MLX8 high/1024 → Gemma31-it Q8 high/1024 | 338 | 17 | 5 | 5 |
| Ornith1.5 Q8 high/1024 → Gemma26 GGUF Q8 high/1024 | 335 | 7 | 7 | 13 |
| Ornith1.5 Q8 high/1024 → Laguna XS2.1 Q8 high/1024 | 334 | 3 | 13 | 4 |
| Ornith1.5 Q8 high/1024 → Gemma31-it Q8 high/1024 | 338 | 8 | 7 | 14 |
| Gemma26 GGUF Q8 high/1024 → Laguna XS2.1 Q8 high/1024 | 331 | 2 | 18 | 5 |
| Gemma26 GGUF Q8 high/1024 → Gemma31-it Q8 high/1024 | 334 | 15 | 4 | 4 |
| Laguna XS2.1 Q8 high/1024 → Gemma31-it Q8 high/1024 | 333 | 1 | 5 | 20 |

| Configuration | Subgroup | Valid / expected | False alarms |
|---|---|---:|---:|
| E2B Q4 none/64 | category:Technique Queries | 87/87 | 2 |
| E2B Q4 none/64 | category:Multilingual | 84/84 | 0 |
| E2B Q4 none/64 | category:Common Queries | 126/126 | 0 |
| E2B Q4 none/64 | category:Virtual Creation | 42/42 | 0 |
| E2B Q4 none/64 | split:NotInject_one | 113/113 | 0 |
| E2B Q4 none/64 | split:NotInject_two | 113/113 | 0 |
| E2B Q4 none/64 | split:NotInject_three | 113/113 | 2 |
| E2B Q4 high/1024 | category:Technique Queries | 87/87 | 8 |
| E2B Q4 high/1024 | category:Multilingual | 84/84 | 1 |
| E2B Q4 high/1024 | category:Common Queries | 126/126 | 1 |
| E2B Q4 high/1024 | category:Virtual Creation | 42/42 | 0 |
| E2B Q4 high/1024 | split:NotInject_one | 113/113 | 0 |
| E2B Q4 high/1024 | split:NotInject_two | 113/113 | 1 |
| E2B Q4 high/1024 | split:NotInject_three | 113/113 | 9 |
| E4B Q4 high/1024 | category:Technique Queries | 87/87 | 17 |
| E4B Q4 high/1024 | category:Multilingual | 84/84 | 0 |
| E4B Q4 high/1024 | category:Common Queries | 126/126 | 5 |
| E4B Q4 high/1024 | category:Virtual Creation | 42/42 | 2 |
| E4B Q4 high/1024 | split:NotInject_one | 113/113 | 5 |
| E4B Q4 high/1024 | split:NotInject_two | 113/113 | 2 |
| E4B Q4 high/1024 | split:NotInject_three | 113/113 | 17 |
| Muse Q4 high/1024 | category:Technique Queries | 87/87 | 11 |
| Muse Q4 high/1024 | category:Multilingual | 84/84 | 0 |
| Muse Q4 high/1024 | category:Common Queries | 125/126 | 2 |
| Muse Q4 high/1024 | category:Virtual Creation | 42/42 | 2 |
| Muse Q4 high/1024 | split:NotInject_one | 113/113 | 1 |
| Muse Q4 high/1024 | split:NotInject_two | 113/113 | 2 |
| Muse Q4 high/1024 | split:NotInject_three | 112/113 | 12 |
| Qwen3.8 Q8 high/1024 | category:Technique Queries | 87/87 | 3 |
| Qwen3.8 Q8 high/1024 | category:Multilingual | 81/84 | 0 |
| Qwen3.8 Q8 high/1024 | category:Common Queries | 126/126 | 0 |
| Qwen3.8 Q8 high/1024 | category:Virtual Creation | 41/42 | 0 |
| Qwen3.8 Q8 high/1024 | split:NotInject_one | 112/113 | 0 |
| Qwen3.8 Q8 high/1024 | split:NotInject_two | 112/113 | 0 |
| Qwen3.8 Q8 high/1024 | split:NotInject_three | 111/113 | 3 |
| Gemma26 MLX8 high/1024 | category:Technique Queries | 87/87 | 13 |
| Gemma26 MLX8 high/1024 | category:Multilingual | 84/84 | 1 |
| Gemma26 MLX8 high/1024 | category:Common Queries | 126/126 | 5 |
| Gemma26 MLX8 high/1024 | category:Virtual Creation | 42/42 | 4 |
| Gemma26 MLX8 high/1024 | split:NotInject_one | 113/113 | 4 |
| Gemma26 MLX8 high/1024 | split:NotInject_two | 113/113 | 6 |
| Gemma26 MLX8 high/1024 | split:NotInject_three | 113/113 | 13 |
| Ornith1.5 Q8 high/1024 | category:Technique Queries | 87/87 | 11 |
| Ornith1.5 Q8 high/1024 | category:Multilingual | 84/84 | 0 |
| Ornith1.5 Q8 high/1024 | category:Common Queries | 126/126 | 4 |
| Ornith1.5 Q8 high/1024 | category:Virtual Creation | 42/42 | 1 |
| Ornith1.5 Q8 high/1024 | split:NotInject_one | 113/113 | 3 |
| Ornith1.5 Q8 high/1024 | split:NotInject_two | 113/113 | 3 |
| Ornith1.5 Q8 high/1024 | split:NotInject_three | 113/113 | 10 |
| Gemma26 GGUF Q8 high/1024 | category:Technique Queries | 87/87 | 14 |
| Gemma26 GGUF Q8 high/1024 | category:Multilingual | 83/84 | 0 |
| Gemma26 GGUF Q8 high/1024 | category:Common Queries | 124/126 | 3 |
| Gemma26 GGUF Q8 high/1024 | category:Virtual Creation | 41/42 | 3 |
| Gemma26 GGUF Q8 high/1024 | split:NotInject_one | 113/113 | 5 |
| Gemma26 GGUF Q8 high/1024 | split:NotInject_two | 113/113 | 3 |
| Gemma26 GGUF Q8 high/1024 | split:NotInject_three | 109/113 | 12 |
| Laguna XS2.1 Q8 high/1024 | category:Technique Queries | 87/87 | 5 |
| Laguna XS2.1 Q8 high/1024 | category:Multilingual | 79/84 | 1 |
| Laguna XS2.1 Q8 high/1024 | category:Common Queries | 126/126 | 1 |
| Laguna XS2.1 Q8 high/1024 | category:Virtual Creation | 42/42 | 0 |
| Laguna XS2.1 Q8 high/1024 | split:NotInject_one | 110/113 | 1 |
| Laguna XS2.1 Q8 high/1024 | split:NotInject_two | 112/113 | 1 |
| Laguna XS2.1 Q8 high/1024 | split:NotInject_three | 112/113 | 5 |
| Gemma31-it Q8 high/1024 | category:Technique Queries | 86/87 | 11 |
| Gemma31-it Q8 high/1024 | category:Multilingual | 84/84 | 3 |
| Gemma31-it Q8 high/1024 | category:Common Queries | 126/126 | 4 |
| Gemma31-it Q8 high/1024 | category:Virtual Creation | 42/42 | 4 |
| Gemma31-it Q8 high/1024 | split:NotInject_one | 113/113 | 2 |
| Gemma31-it Q8 high/1024 | split:NotInject_two | 113/113 | 3 |
| Gemma31-it Q8 high/1024 | split:NotInject_three | 112/113 | 17 |

These are benchmark false alarms, not deployment prevalence estimates. Numeric-fact paper controls and clean BIPIA emails are different distributions and are not pooled here. Models differ in artifact, quantization, runtime and observed generation behavior; this is not a causal architecture comparison. Per-case flags, subgroup denominators, exact captured checkpoint hashes and configuration provenance are retained in `notinject-comparison.json`. Earlier comparison snapshots are retained by their content SHA-256 in `notinject-comparison-snapshots/`.
