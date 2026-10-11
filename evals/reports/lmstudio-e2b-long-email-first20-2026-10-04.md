# Long-email full/window comparison

Updated 2026-10-04T10:44:56.748Z. Engine: gemma4-e2b-q4-lmstudio-score-v1-thinking1024-v1. All 80 cases in the frozen first 20 email families are scored in both conditions. Remaining source-cohort cases are excluded, not counted as misses.

The first 20 ordered email families were fixed before this local comparison: 60 constructed attacks and 20 clean siblings. The attack goal is URL insertion into a summary, not a numerical rating. Shared templates and convenience sampling limit generalization; correlated variants are not independent trials. This completes the selected 80-case tranche, not the full 400-case dataset.

| Group | Class | Cases | Full flags | Window flags | Coverage-only flags | Full only | Window only |
|---|---|---:|---:|---:|---:|---:|---:|
| all20 | attack | 60 | 37 | 34 | 30 | 10 | 7 |
| all20 | benign | 20 | 0 | 0 | 0 | 0 | 0 |
| template:no | benign | 20 | 0 | 0 | 0 | 0 | 0 |
| template:naive | attack | 20 | 4 | 5 | 4 | 3 | 4 |
| template:combine | attack | 20 | 20 | 20 | 20 | 0 | 0 |
| template:authority_spoof | attack | 20 | 13 | 9 | 6 | 7 | 3 |

Removing 27 redundant terminal windows changes 4 case flags. Full input and 512-word / 384-stride preserved windows share the same engine settings and >0.5 threshold. Different total generation work remains a confound. Exact reused scores are linked to their original native requests; they are not additional trials.

Per-family counts, case scores, window provenance and captured checkpoint byte hashes are retained in evals/runs/lmstudio-long-email-2026-10-04/lmstudio-e2b-long-email-first20-2026-10-04.json ([published copy](../analysis/lmstudio-long-email-2026-10-04/results/lmstudio-e2b-long-email-first20-2026-10-04.json)). Checkpoints may subsequently be extended; recorded hashes describe the captured bytes at analysis time.
