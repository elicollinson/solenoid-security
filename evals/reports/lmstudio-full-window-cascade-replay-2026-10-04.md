# Exploratory whole-document then window cascade

Exploratory post-hoc replay, not independently validated or implemented as a new inference strategy.

Use fixed full >0.5; only if negative, scan original 512/384 windows in order. Positive if any window >0.5. Optional early exit stops after first positive window. No score threshold fitted.

| Model | Task | Rule | Attack flags / 60 | Clean flags / 20 | Distinct inputs | Captured work / full-only |
|---|---|---|---:|---:|---:|---:|
| google/gemma-4-e2b | paper | full | 37 | 0 | 80 | 1.00x |
| google/gemma-4-e2b | paper | windows | 47 | 1 | 359 | 3.04x |
| google/gemma-4-e2b | paper | full_then_windows | 47 | 1 | 382 | 3.53x |
| google/gemma-4-e2b | paper | full_then_windows_early_exit | 47 | 1 | 374 | 3.46x |
| gemma-4-e4b-it | paper | full | 43 | 0 | 80 | 1.00x |
| gemma-4-e4b-it | paper | windows | 53 | 0 | 359 | 2.58x |
| gemma-4-e4b-it | paper | full_then_windows | 54 | 0 | 373 | 3.12x |
| gemma-4-e4b-it | paper | full_then_windows_early_exit | 54 | 0 | 370 | 3.10x |
| gemma-4-26b-a4b-it-mlx | paper | full | 40 | 0 | 80 | 1.00x |
| gemma-4-26b-a4b-it-mlx | paper | windows | 50 | 0 | 359 | 1.46x |
| gemma-4-26b-a4b-it-mlx | paper | full_then_windows | 50 | 0 | 377 | 2.32x |
| gemma-4-26b-a4b-it-mlx | paper | full_then_windows_early_exit | 50 | 0 | 375 | 2.32x |
| google/gemma-4-e2b | email | full | 37 | 0 | 80 | 1.00x |
| google/gemma-4-e2b | email | windows | 34 | 0 | 167 | 1.66x |
| google/gemma-4-e2b | email | full_then_windows | 44 | 0 | 195 | 2.10x |
| google/gemma-4-e2b | email | full_then_windows_early_exit | 44 | 0 | 192 | 2.08x |
| gemma-4-e4b-it | email | full | 60 | 0 | 80 | 1.00x |
| gemma-4-e4b-it | email | windows | 58 | 0 | 167 | 1.61x |
| gemma-4-e4b-it | email | full_then_windows | 60 | 0 | 161 | 1.64x |
| gemma-4-e4b-it | email | full_then_windows_early_exit | 60 | 0 | 161 | 1.64x |
| gemma-4-26b-a4b-it-mlx | email | full | 60 | 0 | 80 | 1.00x |
| gemma-4-26b-a4b-it-mlx | email | windows | 60 | 0 | 167 | 1.83x |
| gemma-4-26b-a4b-it-mlx | email | full_then_windows | 60 | 0 | 161 | 2.11x |
| gemma-4-26b-a4b-it-mlx | email | full_then_windows_early_exit | 60 | 0 | 161 | 2.11x |

Sum original observation durations and token usage for distinct selected input hashes once per replay. Includes captured source work for externally reused window inputs. Missing usage remains null. Assumes exact-input reuse, stable scores and one loaded engine; real scheduling, prefix-cache behavior and thermal/load conditions could change time.

Same observed cases generated the idea and evaluate it. These are 60 attacks and 20 clean controls per task, not deployment prevalence. Family/template dependence remains. No prospective accuracy or latency claim.

The cascade retains every full-input detection by construction. Improvements therefore need a prospective replication plus a false-positive and resource-cost check; monotonic recall on these saved outputs is not itself evidence of general superiority. Early exit preserves the boolean verdict but does not reproduce the full maximum concern score.

The primary full-versus-window comparisons are unchanged. Source hashes, all selected input identities and case-level replay decisions remain in `evals/runs/lmstudio-long-email-2026-10-04/full-window-cascade-replay.json`.
