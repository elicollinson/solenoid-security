# Original-paper full/window confirmation tranche

Updated 2026-10-04T04:48:31.684Z. Engine: gemma4-e2b-q4-lmstudio-score-v1-thinking1024-v1. All 80 cases in the frozen first 20 paper families are scored in both conditions. Remaining source-cohort cases are excluded, not counted as misses.

The first six families supplied the numerical diagnostic; the other 14 are reported separately as confirmation. Shared templates and ordered source sampling still limit generalization. Each family contributes three attacks and one clean paper. Counts are descriptive; correlated variants are not independent trials.

| Group | Class | Cases | Full flags | Window flags | Coverage-only flags | Full only | Window only |
|---|---|---:|---:|---:|---:|---:|---:|
| all20 | attack | 60 | 37 | 47 | 45 | 0 | 10 |
| all20 | benign | 20 | 0 | 1 | 1 | 0 | 1 |
| diagnostic6 | attack | 18 | 11 | 14 | 13 | 0 | 3 |
| diagnostic6 | benign | 6 | 0 | 0 | 0 | 0 | 0 |
| additional14 | attack | 42 | 26 | 33 | 32 | 0 | 7 |
| additional14 | benign | 14 | 0 | 1 | 1 | 0 | 1 |
| template:no | benign | 20 | 0 | 1 | 1 | 0 | 1 |
| template:naive | attack | 20 | 0 | 7 | 5 | 0 | 7 |
| template:combine | attack | 20 | 17 | 20 | 20 | 0 | 3 |
| template:authority_spoof | attack | 20 | 20 | 20 | 20 | 0 | 0 |

Removing 25 redundant terminal windows changes 2 case flags. Full input and 512-word / 384-stride preserved windows share the same engine settings and >0.5 threshold. Different total generation work remains a confound. Exact reused scores are linked to their original native requests; they are not additional trials.

Per-family counts, case scores, window provenance and captured checkpoint byte hashes are retained in evals/runs/lmstudio-thinking1024-2026-10-03/lmstudio-e2b-paper-window-first20-2026-10-03.json ([published copy](../analysis/lmstudio-thinking1024-2026-10-03/results/lmstudio-e2b-paper-window-first20-2026-10-03.json)). Checkpoints may subsequently be extended; recorded hashes describe the captured bytes at analysis time.
