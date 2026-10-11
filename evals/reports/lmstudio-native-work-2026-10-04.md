# Measured work on identical full inputs

The same requested high reasoning setting and 1,024-token output cap produce
very different amounts of reported generation work. This helps interpret the
slow dense-model runs, but does not isolate the cause of their latency.

These are the same 24 full paper inputs: six source families, each with a clean
variant and three attacks. Every selected response is valid. The source-linked
audit verifies captured checkpoint hashes and identical input hashes across all
six configurations; no inference was repeated.

| Configuration | Mean request seconds | Total output tokens | Reported reasoning tokens | Responses with draft counters | Accepted / total draft tokens |
|---|---:|---:|---:|---:|---:|
| E2B Q4 high/1024 | 5.79 | 10,467 | 9,914 | 0/24 | unknown |
| E4B Q4 high/1024 | 12.77 | 9,986 | 9,486 | 0/24 | unknown |
| Muse Q4 high/1024 | 54.21 | 9,169 | 8,689 | 0/24 | unknown |
| Gemma26 MLX8 high/1024 | 3.87 | 192 | 0 | 0/24 | unknown |
| Ornith Q8 high/1024 | 13.17 | 9,805 | 9,469 | 24/24 | 6,100 / 11,043 |
| Qwen3.8 Q8 high/1024 | 54.68 | 7,800 | 7,488 | 24/24 | 5,169 / 7,848 |

Reasoning counts are reported for all24 responses in each row. A zero reported
count does not establish the model's internal computation. Missing draft
counters mean unknown, not no drafting. Positive counters are consistent with
speculative drafting; they do not identify the draft model, establish identical
implementations or measure the speedup from drafting. The audit checks that
accepted plus rejected equals total draft tokens for every reported response.

Durations include relay, prefill and placement checks, and exclude model loading.
Tokenizers, quantization, runtime and generation work differ. These are measured
configuration latencies on this tranche, not native decode throughput, an
architecture-controlled comparison, or an estimate for every evaluation set.
Qwen's first-six paper timing should not be used directly to estimate its much
shorter BIPIA emails.

Keep the established protocol fixed during the full-input baseline stage.
Changing reasoning or output limits mid-cohort would change the detector being
compared. A later speed/quality experiment would need separately versioned
configurations, the same inputs, explicit abstentions and attack-following
regressions. Current raw outputs already provide the baseline for such a test.

[Source-linked native work audit](../analysis/lmstudio-available-panel-2026-10-04/results/first6-native-work-audit.json)
retains per-case request IDs, input hashes, usage, timing, native draft counters,
engine identities and captured checkpoint hashes. The
[protocol-tranche results](lmstudio-larger-protocol-first6-2026-10-04.md) show
detection performance on these cases; the
[broader full-input comparison](lmstudio-dense-moe-full-baselines-2026-10-04.md)
keeps other cohorts separate.
