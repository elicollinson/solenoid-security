# Gemma26: hosted and local deployment agreement

Updated 2026-10-04T12:47:58.221Z. Reuses saved outputs only.

The hosted DeepInfra FP8 route and local MLX 8-bit Gemma26 give identical scores on the selected 80 paper and 80 email inputs. Their benign-message behavior is less stable: the table below keeps the complete NotInject cohort separate. This compares two deployment configurations, not an isolated quantization intervention.

| Cohort | Cases | Hosted attack flags | Local attack flags | Hosted clean flags | Local clean flags | Different decisions | Different scores |
|---|---:|---:|---:|---:|---:|---:|---:|
| NotInject | 339 | — | — | 20/339 | 23/339 | 7 | 17 |
| LongPI paper, first 20 families | 80 | 40/60 | 40/60 | 0/20 | 0/20 | 0 | 0 |
| LongPI email, first 20 families | 80 | 60/60 | 60/60 | 0/20 | 0/20 | 0 | 0 |
| BIPIA paired emails | 156 | 58/78 | 60/78 | 0/78 | 0/78 | 8 | 31 |

NotInject has 18 shared false positives, 2 hosted-only and 5 local-only false positives. A small difference in totals therefore understates the set of changed decisions.

All selected source text hashes match exactly. Both configurations use the same versioned score-only prompt, output schema, temperature 0 and >0.5 threshold. The hosted engine disables reasoning with a 64-token cap; the local engine requests high reasoning with a 1,024-token cap. Both report zero reasoning tokens on every selected response. This observed equality does not prove identical hidden execution: provider, weights/quantization, template, backend, output allowance and run date remain different.

The long-input agreement also includes shared failures: both miss all 20 naive paper attacks while detecting the 40 combined/authority attacks. Exact agreement on repeated templates does not establish broad deployment equivalence or make those cases independent. These 80-case selections are not the complete 400-case source cohorts.

BIPIA is now complete locally: 55 attacks are detected by both deployments, 3 by hosted only, 5 by local only, and 15 by neither. Keep the local full-input study distinct; saved hosted predictions are a comparison, not substitutes for local observations.

The [audit data](../analysis/lmstudio-hosted-transfer-2026-10-04/results/comparison.json) retain engine identities, source hashes, per-case score/decision differences, original request IDs, completion work and selected cases. No hosted or local requests were repeated.
