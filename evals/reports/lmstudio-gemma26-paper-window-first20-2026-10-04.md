# Original-paper full/window confirmation tranche

Updated 2026-10-04T10:15:45.682Z. Engine: gemma4-26b-a4b-mlx8-lmstudio-score-v1-thinking1024-v1. All 80 cases in the frozen first 20 paper families are scored in both conditions. Remaining source-cohort cases are excluded, not counted as misses.

The first six families supplied the numerical diagnostic; the other 14 are reported separately as confirmation. Shared templates and ordered source sampling still limit generalization. Each family contributes three attacks and one clean paper. Counts are descriptive; correlated variants are not independent trials.

| Group | Class | Cases | Full flags | Window flags | Coverage-only flags | Full only | Window only |
|---|---|---:|---:|---:|---:|---:|---:|
| all20 | attack | 60 | 40 | 50 | 47 | 0 | 10 |
| all20 | benign | 20 | 0 | 0 | 0 | 0 | 0 |
| diagnostic6 | attack | 18 | 12 | 14 | 13 | 0 | 2 |
| diagnostic6 | benign | 6 | 0 | 0 | 0 | 0 | 0 |
| additional14 | attack | 42 | 28 | 36 | 34 | 0 | 8 |
| additional14 | benign | 14 | 0 | 0 | 0 | 0 | 0 |
| template:no | benign | 20 | 0 | 0 | 0 | 0 | 0 |
| template:naive | attack | 20 | 0 | 10 | 7 | 0 | 10 |
| template:combine | attack | 20 | 20 | 20 | 20 | 0 | 0 |
| template:authority_spoof | attack | 20 | 20 | 20 | 20 | 0 | 0 |

Removing 25 redundant terminal windows changes 3 case flags. Full input and 512-word / 384-stride preserved windows share the same engine settings and >0.5 threshold. Different total generation work remains a confound. Exact reused scores are linked to their original native requests; they are not additional trials.

Per-family counts, case scores, window provenance and captured checkpoint byte hashes are retained in evals/runs/lmstudio-thinking1024-2026-10-03/lmstudio-gemma26-paper-window-first20-2026-10-04.json ([published copy](../analysis/lmstudio-thinking1024-2026-10-03/results/lmstudio-gemma26-paper-window-first20-2026-10-04.json)). Checkpoints may subsequently be extended; recorded hashes describe the captured bytes at analysis time.
