# Local long-email panel

Updated 2026-10-04T11:38:22.435Z. Frozen first 20 ordered families: 60 constructed injection attempts and 20 clean siblings. All models use the same source bytes, requested high/1024 protocol and max score >0.5; actual reasoning work differs. Only complete selected pairs have numerical results below. This is an 80-case convenience tranche of a 400-case dataset.

New window runs are deferred under the user’s full-input-first instruction. Completed pairs below remain historical evidence. See [full-input baselines](lmstudio-dense-moe-full-baselines-2026-10-04.md) for the active model comparison.

| Model | Status | Attack flags: full / windows / coverage | Clean flags: full / windows / coverage | Window-only / full-only attacks | Native service-time ratio |
|---|---|---:|---:|---:|---:|
| E2B Q4 | complete selected pair | 37 / 34 / 30 of 60 | 0 / 0 / 0 of 20 | 7 / 10 | 1.66x |
| E4B Q4 | complete selected pair | 60 / 58 / 56 of 60 | 0 / 0 / 0 of 20 | 0 / 2 | 1.61x |
| Muse Q4 | windows deferred; full-input stage active | — | — | — | — |
| Gemma26 MLX8 | complete selected pair | 60 / 60 / 60 of 60 | 0 / 0 / 0 of 20 | 0 / 0 | 1.83x |
| Ornith1.5 Q8 | windows deferred; full-input stage active | — | — | — | — |

Coverage removes redundant terminal windows using already captured scores. Timings sum native observation durations, including relay and placement checks, with exact within-run reuse; they exclude model loading. Ratios are not energy or uncached deployment costs. Raw scores, source hashes, family outcomes and all windows remain in the individual pair reports and checkpoints.

The email template asks for a fixed URL in a summary. Domain, length and target differ from the paper-rating task, so cross-domain differences do not isolate a single cause. Shared templates and within-family variants limit generalization; no architecture or expert-routing causality is inferred.

| Historical Model Armor full-input alias | Attack flags / 60 | Clean flags / 20 |
|---|---:|---:|
| base | 20/60 | 0/20 |
| high | 20/60 | 0/20 |
| low | 3/60 | 0/20 |

The retained Armor calls were made September 30, 2026. All 80 selected input hashes match this cohort. These are binary service verdicts, not numerical scores or fresh calls. Template contents and immutable backend versions were unavailable; alias names do not establish verified thresholds. Historical normalized-window calls are not substituted for the preserved-window condition.
