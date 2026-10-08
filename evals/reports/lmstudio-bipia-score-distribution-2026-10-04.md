# BIPIA score overlap and threshold sensitivity

Updated 2026-10-04T14:21:18.578262+00:00. Offline post-hoc analysis of finished full-input cohorts; no new inference or changes to the fixed >0.5 baseline.

Qwen3.8 has both low positive scores and exact-zero attack scores. Its poor detection at the fixed threshold cannot be understood solely as an inability to rank attacks above clean emails, but lowering the threshold alone does not separate every attack from clean data. These concern scores are not established calibrated probabilities.

| Configuration | Valid attacks / abstentions | Zero-scored attacks | Zero-scored clean | Empirical AUC on valid scores |
|---|---:|---:|---:|---:|
| E2B Q4 | 78 / 0 | 48 | 78/78 | 0.692 |
| E4B Q4 | 78 / 0 | 38 | 78/78 | 0.756 |
| Qwen3.8 Q8 | 75 / 3 | 26 | 75/78 | 0.814 |
| Gemma26 MLX8 | 78 / 0 | 9 | 78/78 | 0.942 |
| Ornith1.5 Q8 | 78 / 0 | 15 | 75/78 | 0.899 |

AUC compares every valid attack score with every valid clean score, giving ties half credit. It excludes abstentions, is descriptive for this cohort, and does not measure operational precision or deployment accuracy. A stronger AUC need not imply stronger detection at a particular low false-alarm rate. Shared sources and templates are not independent trials.

| Configuration | Strict cutoff | Attack flags / valid | Clean flags / valid |
|---|---:|---:|---:|
| E2B Q4 | >0 | 30/78 | 0/78 |
| E2B Q4 | >0.1 | 21/78 | 0/78 |
| E2B Q4 | >0.5 | 11/78 | 0/78 |
| E4B Q4 | >0 | 40/78 | 0/78 |
| E4B Q4 | >0.1 | 34/78 | 0/78 |
| E4B Q4 | >0.5 | 29/78 | 0/78 |
| Qwen3.8 Q8 | >0 | 49/75 | 3/78 |
| Qwen3.8 Q8 | >0.1 | 30/75 | 0/78 |
| Qwen3.8 Q8 | >0.5 | 18/75 | 0/78 |
| Gemma26 MLX8 | >0 | 69/78 | 0/78 |
| Gemma26 MLX8 | >0.1 | 62/78 | 0/78 |
| Gemma26 MLX8 | >0.5 | 60/78 | 0/78 |
| Ornith1.5 Q8 | >0 | 63/78 | 3/78 |
| Ornith1.5 Q8 | >0.1 | 53/78 | 0/78 |
| Ornith1.5 Q8 | >0.5 | 49/78 | 0/78 |

These illustrative cutoffs were examined after seeing the results. They are not new evaluation conditions or a threshold chosen on held-out calibration data. Keep the original >0.5 result as the baseline. In particular, the >0 results should not be presented as a validated improvement; the benign distribution is small, and NotInject represents a different false-positive challenge.

| Configuration | Attack score higher than paired clean | Equal | Lower |
|---|---:|---:|---:|
| E2B Q4 | 30 | 48 | 0 |
| E4B Q4 | 40 | 38 | 0 |
| Qwen3.8 Q8 | 49 | 26 | 0 |
| Gemma26 MLX8 | 69 | 9 | 0 |
| Ornith1.5 Q8 | 63 | 15 | 0 |

| Configuration | AUC on identical jointly valid cases |
|---|---:|
| E2B Q4 | 0.687 |
| E4B Q4 | 0.747 |
| Qwen3.8 Q8 | 0.814 |
| Gemma26 MLX8 | 0.947 |
| Ornith1.5 Q8 | 0.895 |

The common set contains75 attacks and78 clean cases. On these identical inputs, Qwen ranks attacks above clean scores better in aggregate than E4B, despite detecting fewer attacks at the fixed >0.5 threshold. This illustrates protocol-dependent score calibration; it does not establish a deployable threshold or general model superiority. The three excluded attack failures may be nonrandom.

These paired comparisons require both cases to have valid scores; Qwen's three attack abstentions remain excluded and listed in the full comparison. A positive score difference is evidence of score sensitivity to inserted text, not proof of attack recognition or successful resistance to instructions.

The next live work remains the numerical hijack diagnostic and matched raw model baselines. A future calibration experiment needs disjoint source families and broader benign controls, with its threshold frozen before test evaluation. Exact-zero overlaps also motivate testing the detector's definition of an attempted redirection, rather than treating every miss as a threshold issue.

[Source-linked analysis](../runs/bipia-score-distribution-2026-10-04/comparison.json) retains histograms, native checkpoint hashes, paired case IDs and configuration identities. [Full BIPIA results](lmstudio-panel-bipia-2026-10-04.md) retain coverage and abstentions.
