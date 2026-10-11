# Chunking varies by model and document task

The same full-input versus preserved 512-word-window comparison is available for two different LongPIBench tasks. Each completed row contains 20 source documents, three attack variants per document and one clean sibling. Engine identity is checked across tasks; payload targets and text lengths differ, so this does not isolate domain or length causally.

| Model | Task | Attack flags: full / windows / coverage | Clean flags: full / windows | Families improved / worse / unchanged net | Paired change | Empirical family-resampling range |
|---|---|---:|---:|---:|---:|---:|
| E2B Q4 | paper | 37 / 47 / 45 of 60 | 0 / 1 of 20 | 9 / 0 / 11 | +16.7 pp | [+8.3, +25.0] pp |
| E2B Q4 | email | 37 / 34 / 30 of 60 | 0 / 0 of 20 | 2 / 5 / 13 | -5.0 pp | [-16.7, +6.7] pp |
| E4B Q4 | paper | 43 / 53 / 52 of 60 | 0 / 0 of 20 | 11 / 1 / 8 | +16.7 pp | [+8.3, +25.0] pp |
| E4B Q4 | email | 60 / 58 / 56 of 60 | 0 / 0 of 20 | 0 / 2 / 18 | -3.3 pp | [-8.3, +0.0] pp |
| Gemma26 MLX8 | paper | 40 / 50 / 47 of 60 | 0 / 0 of 20 | 10 / 0 / 10 | +16.7 pp | [+10.0, +23.3] pp |
| Gemma26 MLX8 | email | 60 / 60 / 60 of 60 | 0 / 0 of 20 | 0 / 0 / 20 | +0.0 pp | [+0.0, +0.0] pp |

Exact empirical family bootstrap: resample 20 source families with replacement, preserving all three attack variants. 2.5th/97.5th percentiles from integer-weight convolution; no random seed or simulation.

Descriptive sensitivity conditional on these 20 ordered families and fixed templates; not a representative-population confidence interval. Paper and email families are distinct, not paired across domains. Zero variation in a ceiling cohort yields a degenerate interval and does not establish zero population effect. No pooled architecture comparison.

An unchanged net family can contain both gained and lost detections. These counts are descriptive, not independent replications of each attack variant. The primary case-level comparisons and all raw outputs remain in the individual reports.

The E2B paper gain includes one case supported only by a clean-source window that also produces a clean false positive. Conversely, all ten E2B email losses retain at least one window containing the entire appended payload. These audits limit a simple claim that chunking always helps by exposing attacks. Gemma26 is at the email ceiling; its zero effect there does not demonstrate equivalence outside this cohort.

Coverage excludes redundant terminal windows using captured outputs. Resampling adds no inference calls and changes no threshold or primary result. Source-prefix hashes and per-family outcomes are retained in `evals/runs/lmstudio-long-email-2026-10-04/domain-family-comparison.json` ([published copy](../analysis/lmstudio-long-email-2026-10-04/results/domain-family-comparison.json)).
