# Injection detection research findings

Research date: September 29, 2026, America/New_York. **Cycle complete: 128/128 baseline cells; all 24 context conditions attempted, 23 fully scored and one with a retained token-limit abstention (155/156 scored). OpenRouter phase spend $0.759861536; remaining $18.878902178. Model Armor conservative current-research allowance $5.1062379, not billed usage.** Detailed validated counts, coverage, failures, paired comparisons, and facet breakdowns are in [the aggregate report](current-model-research-2026-09-29.md); decisions and research sources are in [the running log](research-log-2026-09-29.md).

## What changed our understanding

**The apparent trusted-context benefit was confounded.** For Gemma4 31B, score-only BIPIA detection was 38/78. A new prompt with a rationale and trusted task reached 58/78, but the exact same prompt with the task withheld reached 61/78, all with zero flags on 78 paired clean emails. Gemma4 26B similarly reaches 61 with the task and 63 without; Qwen3.6 35B reaches 53 with the task and 61 without. These small present-versus-withheld differences do not establish a reliable negative context effect; they show that the original gain cannot be credited to task information. Protocol design is the stronger candidate explanation.

**Medium windows interact with model choice.** On PIDS obfuscated attacks, Gemma4 26B-A4B rises from 327/405 full-text detections to 357/405 with 96-word windows at stride 64. Of the +30, +28 occur where the model input actually changes and +2 occur on repeated identical inputs. Gemma4 31B improves only 339→342. This is a useful hypothesis for a device-sized model: a cheap input plan can matter more than increasing the dense model size. It needs independent replication and longer source documents before deployment claims. On the web cohort the same 26B windows keep 240/240 detections but increase benign flags from 81/240 to 92/240; they are not a universal improvement.

**Temperature zero does not make hosted comparisons deterministic.** Gemma4 31B's AIB full/sliding improvement of +2 detections came entirely from identical-input cases. Some older runs also change individual benign decisions while aggregate false-positive counts stay unchanged. The report separates these repeated-input changes from actual segmentation changes. Do not interpret every small delta as a technique effect.

**Model Armor is a baseline with specific gaps.** Low/base templates detect 0/50 Base64-wrapped PIDS attacks, while Gemma4 31B detects 50/50. Model Armor also misses most inserted BIPIA attacks. Increasing its template sensitivity substantially raises web benign flags. Native verdicts remain binary; they are not probabilities. Template contents could not be read with the configured credential, so alias names are not proof of immutable filter settings.

**Benchmark construction changes rankings.** PIDS public benign inputs include 600 curated and 208 externally sourced rows. Gemma4 31B flags 0/600 curated and 13/208 external inputs; Jev flags 159/600 curated and 13/208 external. Many inputs are legitimate user requests, which does not perfectly match an external-document detector's instruction hierarchy. These cohorts should diagnose distinct weaknesses, not become one pooled accuracy score.

**Longer rationale output has a reliability cost.** Qwen3.5 9B repeatedly hit the 256-token output cap on the same BIPIA task-withheld input, returning malformed JSON. The failed responses and charges are retained; the score is not extracted from incomplete JSON, and the cap is not silently changed. This cell remains excluded from complete-cohort accuracy claims. Other cases are attempted without reissuing that failed input.

## Current practical direction

Prioritize Gemma4 26B-A4B with context-preserving windows as the next candidate to stress, alongside Gemma4 31B as a lower-false-positive comparison. Keep Qwen9 as a materially smaller memory option, with its recall and protocol-reliability tradeoffs explicit. All inference here is hosted; model weight sizes merely screen for plausible use within 96 GB. Latency, energy, and quantized local accuracy are unmeasured.

Retire tiny-chunk expansion, retain every old artifact, and defer source-span expansion unless a source-coverage hypothesis warrants it. The next useful experiments are source-disjoint long documents with attack-position controls; helpful versus malicious external instructions under matched trusted tasks; and deterministic deobfuscation with matched benign encodings. The recent [LongPIBench](https://arxiv.org/abs/2608.28411) and [AgentDyn](https://arxiv.org/abs/2602.03117) directions are better aligned with these gaps than another broad short-prompt leaderboard.

The paired two-Gemma OR ensemble is an exploratory option: 357/405 PIDS attacks with 19/808 benign flags, compared with 339/405 and 13/808 for 31B alone. It buys recall at extra inference and false-positive cost; it has no independently validated advantage over the single 26B window model. Do not deploy it based on this post hoc comparison.

## Limits and reproducibility

- The active baseline design has eight detectors × eight cohorts × full/sliding inputs. The separate context ablation has four models × three applicable cohorts × present/withheld task. Consult the live coverage ledger for completed versus incomplete cells.
- Models: Gemma4 31B and 26B-A4B, Qwen3.5 9B, Qwen3.6 35B-A3B, specialist Jev, and three Model Armor templates. Older Gemma3/Ministral evidence is preserved but those general-purpose baselines are not extended.
- The PIDS hard-benign subset excludes 664 unavailable LMSYS rows; its 808 public rows are not the original full benchmark. Attack templates, seed families, and paired emails create dependencies. Upstream labels are attempt labels, not evidence of downstream compromise.
- Scores are ordinal concern scores at the pre-existing >0.5 rule. Threshold sweeps and ensembles are exploratory. No calibrated probability, production prevalence, adaptive-attack robustness, or end-to-end safety is established.
- Provider/model/prompt hashes, source manifests, raw outputs, failures, endpoint snapshots, and exact-reuse lineage remain local under ignored `evals/private/` and `evals/runs/`. Historical missing native Model Armor bodies cannot be reconstructed. New native-body capture does not alter old outputs.
