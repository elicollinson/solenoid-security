# Small-model benign specificity comparison

Completed 2026-10-03T22:51:38.547Z. All 339 NotInject cases scored in both configurations, at the frozen >0.5 threshold.

**E2B fast:** 2/339 false positives. **E4B thinking1024:** 24/339 false positives. This changes both model size and generation mode; it does not isolate either effect. NotInject is a constructed benchmark, not a deployment prevalence sample.

| Source split | Cases | E2B fast flags | E4B thinking flags | Both flag |
|---|---:|---:|---:|---:|
| NotInject_one | 113 | 0 | 5 | 0 |
| NotInject_two | 113 | 0 | 2 | 0 |
| NotInject_three | 113 | 2 | 17 | 2 |

| Category | Cases | E2B fast flags | E4B thinking flags | Both flag |
|---|---:|---:|---:|---:|
| Technique Queries | 87 | 2 | 17 | 2 |
| Multilingual | 84 | 0 | 0 | 0 |
| Common Queries | 126 | 0 | 5 | 0 |
| Virtual Creation | 42 | 0 | 2 | 0 |

The later source split contributes most E4B flags. Qualitative inspection finds benign imperatives containing adversarial-looking words; this is a candidate error pattern rather than proof of a model-internal mechanism. Attack cohorts are still running. Keep the threshold fixed until recall is available; any subsequent threshold exploration must be labeled post-hoc. The saved paired analysis and uncertainty intervals are in the ignored run directory.
