# Generation settings and small-model detection

Completed 2026-10-04T03:23:49.824Z. Frozen cohort: benign-false-positives; all 339 cases scored in each configuration at >0.5.

E2B fast and E2B thinking1024 hold the model artifact fixed while jointly changing reasoning mode and output allowance (64 to 1,024 tokens). E2B/E4B thinking1024 use the same nominal generation settings but different models. This separates those comparisons without isolating reasoning mode from token allowance or establishing a causal model-size effect.

| Configuration | Attack flags | Benign flags | Mean request seconds |
|---|---:|---:|---:|
| E2B fast | — | 2/339 | 0.696 |
| E2B thinking1024 | — | 10/339 | 3.268 |
| E4B thinking1024 | — | 24/339 | 6.334 |

| Paired comparison A → B | Attack A only | Attack B only | Benign A only | Benign B only |
|---|---:|---:|---:|---:|
| E2B fast → E2B thinking1024 | 0 | 0 | 1 | 9 |
| E2B fast → E4B thinking1024 | 0 | 0 | 0 | 22 |
| E2B thinking1024 → E4B thinking1024 | 0 | 0 | 3 | 17 |

| Subgroup | Cases | E2B fast flags | E2B thinking flags | E4B thinking flags |
|---|---:|---:|---:|---:|
| class:benign | 339 | 2 | 10 | 24 |
| category:Technique Queries:benign | 87 | 2 | 8 | 17 |
| split:NotInject_one:benign | 113 | 0 | 0 | 5 |
| category:Multilingual:benign | 84 | 0 | 1 | 0 |
| category:Common Queries:benign | 126 | 0 | 1 | 5 |
| category:Virtual Creation:benign | 42 | 0 | 0 | 2 |
| split:NotInject_two:benign | 113 | 0 | 1 | 2 |
| split:NotInject_three:benign | 113 | 2 | 9 | 17 |

Subgroups are descriptive and correlated. These benchmark counts do not estimate deployment prevalence. Do not pool NotInject and clean emails: they test different benign distributions. Mean request time includes LM Link and placement checks; no energy measurement is claimed. Complete aggregates, intervals and paired case identities are retained in the source JSON.
