# Batching (parallel-slot) equivalence on the Studio (2026-10-26/27)

Tracking issue [#21](https://github.com/elicollinson/solenoid-security/issues/21) (F5). Pre-registration:
[`batching-equivalence-plan-2026-10.md`](batching-equivalence-plan-2026-10.md), commit `7914c42`, pushed before the
first call. `FINDINGS.md` O69, research log L160. Scripts and aggregates for every arm:
[`evals/analysis/batching-equivalence-2026-10/`](../analysis/batching-equivalence-2026-10/)
([`batching-results.json`](../analysis/batching-equivalence-2026-10/results/batching-results.json)).

## Summary

- **Verdict (declared rule): stay serial.** Gemma 4 26B-A4B fails every batched level on outcome agreement (98.6–98.8%
  vs the 99% bar), so its adopted level is 1. Qwen3.8 27B (`low`) passes every level (99.6–99.8%), so its adopted level
  is 8. The repo-wide recommendation is the smaller, **parallel 1**. Comparisons against frozen baselines stay serial
  regardless.
- **Batching does not bias accuracy.** No ΔBA is significant: every McNemar p ≥ 0.375 and every bootstrap interval
  contains 0. The changes are noise, not a shift.
- **But on Gemma it makes verdicts depend on server load.** 6–7 of 500 verdicts flip vs serial at every level, against
  0 of 500 for a serial rerun. Every Gemma flip came from a confident serial score (more than 0.3 from 0.5), not a
  borderline one; scores move by up to 0.95. A p4 rerun of 100 cases differs from the first p4 run as much as p4
  differs from serial (1 flip; 86% identical answers). Batched Gemma is not reproducible run to run.
- **Throughput.** Gemma: 1.35× (p2), 1.60× (p4), 1.69× (p8) the serial cases per hour. Qwen3.8: 1.32×, **1.45×**, then
  1.26× — **p8 is slower than p4**. Request latency grows much faster than throughput (p8 median 3.6× Gemma's serial
  median and 4.8× Qwen3.8's).
- **Speculative decoding (#52).** Qwen3.8's MTP drafter stayed on at every level with unchanged acceptance: 68.26%
  (frozen), 68.26% (p1), 68.25% (p2), 68.26% (p4), 68.28% (p8). Gemma reports no draft counters (off).
- **Context is one shared pool**, not split per slot, and over-subscribing it fails every in-flight request (HTTP 400).
  Size it as parallel × the longest input plus the output cap.

## Throughput and latency

Span = sum of per-test spans (first dispatch to last response; loads excluded). Aggregate generated tok/s = completion
tokens (reasoning included) over that span. Latency = per-request client wall time.

| Model | Level | Context | Span (min) | Cases/h | × p1 | Gen tok/s | Latency median / p90 / max (s) | Per-request decode tok/s (median) |
|---|---|---|---|---|---|---|---|---|
| Gemma26 | p1 | 65,536 | 31.3 | 959 | 1.00 | 83.0 | 2.7 / 6.2 / 20.7 | 115.9 |
| Gemma26 | p2 | 65,536 | 23.2 | 1,296 | 1.35 | 115.5 | 3.8 / 9.6 / 42.1 | 80.6 |
| Gemma26 | p4 | 131,072 | 19.6 | 1,530 | 1.60 | 139.7 | 5.7 / 17.7 / 54.3 | 55.8 |
| Gemma26 | p8 | 262,144 | 18.5 | 1,620 | 1.69 | 149.9 | 9.7 / 33.9 / 174.8 | 33.8 |
| Qwen3.8 low | p1 | 65,536 | 53.2 | 564 | 1.00 | 37.9 | 3.9 / 11.8 / 35.8 | 65.5 |
| Qwen3.8 low | p2 | 65,536 | 40.3 | 744 | 1.32 | 49.8 | 4.9 / 21.4 / 89.1 | 53.1 |
| Qwen3.8 low | p4 | 131,072 | 36.6 | 820 | 1.45 | 55.0 | 7.7 / 41.8 / 137.7 | 33.3 |
| Qwen3.8 low | p8 | 196,608 | 42.1 | 713 | 1.26 | 47.9 | 18.9 / 103.2 / 272.7 | 13.2 |

By length band (cases/h; `throughputByBand`): the gain is mostly on short and medium inputs. Gemma's long band
(LongPIBench, BrowseSafe) goes 757 → 944 → 999 → 997, flat beyond p4. Qwen3.8's long band goes 329 → 383 → 395 → 348.

The resident assistant model (below) sent 0–4 requests inside any arm's span (2 in Gemma p1 and p4, 3 and 4 in Qwen3.8
p1 and p2, 0 elsewhere), too few to move these figures. Level is still confounded with time of night (fixed order).

## Agreement with serial (p1), ΔBA and McNemar

Outcome agreement = same status and same flag at > 0.5. Identity rates are on cases scored in both. ΔBA is pooled over
500 cases with a paired class-stratified bootstrap (10,000, seed 21); McNemar is exact, on per-case correctness.

| Model | Level | Agreement | Identical score | Identical answer | Identical reasoning | BA | ΔBA [95% CI] | Discordant (p1-only / alt-only correct) | McNemar p | Abstentions (Δ pts) | Pass |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gemma26 | p1 vs frozen (drift) | 500/500 | 99.0% | 98.4% | 93.2% | 0.924 | 0.000 | 0 / 0 | 1 | 0 (0) | — |
| Gemma26 | p2 | 493/500 (98.6%) | 93.6% | 88.6% | 31.8% | 0.918 | −0.006 [−0.016, +0.004] | 5 / 2 | 0.45 | 0 (0) | **no** |
| Gemma26 | p4 | 494/500 (98.8%) | 92.2% | 86.4% | 27.8% | 0.928 | +0.004 [−0.006, +0.014] | 2 / 4 | 0.69 | 0 (0) | **no** |
| Gemma26 | p8 | 493/500 (98.6%) | 93.4% | 86.5% | 26.7% | 0.918 | −0.006 [−0.016, +0.002] | 4 / 1 | 0.38 | 2 (+0.4) | **no** |
| Qwen3.8 low | p1 vs frozen (drift) | 500/500 | 99.8% | 99.8% | 99.4% | 0.880 | 0.000 | 0 / 0 | 1 | 0 (0) | — |
| Qwen3.8 low | p2 | 498/500 (99.6%) | 99.2% | 98.8% | 95.8% | 0.884 | +0.004 [0.000, +0.010] | 0 / 2 | 0.50 | 0 (0) | yes |
| Qwen3.8 low | p4 | 499/500 (99.8%) | 99.0% | 98.6% | 96.4% | 0.882 | +0.002 [0.000, +0.006] | 0 / 1 | 1.00 | 0 (0) | yes |
| Qwen3.8 low | p8 | 499/500 (99.8%) | 98.2% | 97.6% | 92.8% | 0.882 | +0.002 [0.000, +0.006] | 0 / 1 | 1.00 | 0 (0) | yes |

- **Sensitivity** (abstentions as errors): Gemma p8 ΔBA −0.010; every other value is unchanged.
- **Gemma p8's two abstentions** are length abstentions (4,096-token cap; one BIPIA email, one web). Both cases scored
  in serial (0.80 and 0.95); reasoning ran to the cap under batching.
- **Where Gemma's flips fall.** Spread over bands (p2 3/2/2, p4 2/3/1, p8 3/3/1 short/medium/long) and datasets
  (AgentDyn GitHub 2 in each arm; PIDS, InjSQuAD, BrowseSafe, web, BIPIA 0–2). Every flip came from a serial score more
  than 0.3 from 0.5; none were within 0.1. Max score shift 0.95 (p2, p4) and 0.90 (p8); mean 0.012–0.016.
- **Where Qwen3.8's flips fall.** The same borderline web case flips at every level (serial 0.55, batched 0.10); p2
  adds one BIPIA email case (0.10 → 0.85).
- **Prompt tokens** were identical in every pair (100%): the inputs did not change, only the computation.

## Determinism (p4 repeat, 100 cases)

The p4 engine rerun on the first 10 cases of each test, in the same dispatch order.

| Model | Pair (same 100 cases) | Agreement | Identical score | Identical answer | Identical reasoning |
|---|---|---|---|---|---|
| Gemma26 | repeat vs p4 | 99/100 | 93% | 86% | 33% |
| Gemma26 | p4 vs p1 | 99/100 | 95% | 88% | 30% |
| Gemma26 | p1 vs frozen | 100/100 | 98% | 97% | 94% |
| Qwen3.8 low | repeat vs p4 | 100/100 | 97% | 97% | 96% |
| Qwen3.8 low | p4 vs p1 | 100/100 | 97% | 97% | 96% |
| Qwen3.8 low | p1 vs frozen | 100/100 | 99% | 99% | 99% |

Batched runs are not reproducible: two p4 runs differ from each other about as much as p4 differs from serial. That is
what batch-composition dependence predicts (which requests share a decode step depends on timing). Serial reruns stay
near byte-identical (O47).

## Speculative (MTP) decoding under batching (#52)

LM Studio silently enables Qwen3.8's built-in MTP drafter (#52). It stayed on in every arm (draft counters on 500/500
responses per arm), and batching did not change it:

| Qwen3.8 low | frozen | p1 | p2 | p4 | p8 | p4 repeat |
|---|---|---|---|---|---|---|
| Draft acceptance (pooled) | 68.26% | 68.26% | 68.25% | 68.26% | 68.28% | 68.40% |
| Per-request acceptance median [p10, p90] | 67.7% [59.4, 76.6] | 67.7% [59.2, 76.6] | 67.7% [59.2, 76.6] | 67.4% [59.1, 76.6] | 67.7% [59.4, 76.6] | 68.3% [60.2, 77.4] |
| Drafted tokens per generated token | 0.981 | 0.981 | 0.981 | 0.981 | 0.981 | 0.980 |

Acceptance is a property of the text, which barely changed, not of the batch. About two-thirds of Qwen3.8's generated
tokens (0.67) are accepted drafts. Gemma 4 26B reports no draft counters in any arm, including the frozen run
(drafting off).

## The Qwen3.8 p8 anomaly

Qwen3.8 at p8 (713 cases/h) was slower than at p4 (820), in every band: short −16%, medium −16%, long −12%. Per-request
decode speed fell to 13.2 tok/s (8 × 13.2 ≈ 105 aggregate in-flight vs 4 × 33.3 ≈ 133 at p4). Gemma kept gaining to
p8 (+6% over p4), but its long band also stopped gaining after p4. We did not instrument the server, so the causes below
are candidates, not findings:

- **Speculative decoding competes with batching.** With the drafter on, each slot verifies about two tokens per step
  (0.98 drafted per generated token). At p8 a decode step carries about 16 tokens through a dense 27B model instead of
  8, so it reaches the compute-bound regime sooner, and the drafter's benefit (using idle compute in memory-bound
  serial decoding) disappears. Gemma, MoE with about 4B active parameters and no drafting, has far more headroom per
  step. This fits the data but was not tested (no drafting-off arm).
- **llama.cpp Metal batched-decode kernels.** The Metal backend switches matrix kernels with the number of tokens in a
  step, and small-batch (2–16 token) decode has been a known weak spot; an upstream llama.cpp change (PR #29869) targets
  it. LM Studio 0.4.25's bundled llama.cpp runtime version was not recorded, so we cannot say whether that change was
  present.
- **Memory pressure.** Qwen3.8 p8 ran at 196,608 context, near LM Studio's load guardrail with the 15.6 GB resident
  assistant model loaded (229,376 was refused at 71.05 GB; linear interpolation puts 196,608 near 65 GB). p4 ran at
  131,072. A larger KV pool should not slow attention by itself, but memory pressure could.
- **Long prefills stalling decode.** With 8 slots, long BrowseSafe and LongPIBench prefills (up to about 26k tokens)
  interleave with other slots' decoding more often. This would explain the long band, less so the short band.
- Not the assistant: 0 assistant requests fell inside the p8 span.

A drafting-off arm at p4 and p8 (planned in #52) would separate the first cause from the rest.

## Context per slot and memory

From the probes run before freezing (synthetic prompts, no dataset text; `contextProbes` in the results):

- **One shared pool.** Gemma at 65,536 / p4 answered one 36,435-token prompt correctly; a per-slot split would cap a
  slot at 16,384.
- **Over-subscription fails all in-flight requests.** Four concurrent 36k prompts at 65,536 (Gemma) and two concurrent
  33k prompts (Qwen3.8) all returned HTTP 400 "Context size has been exceeded". Nothing is queued or truncated.
- **Sized pools work.** Gemma p4/131,072 with 4 × 26,685 and p8/262,144 with 8 × 26,685; Qwen3.8 p4/131,072 with
  4 × 33,370 and p8/196,608 with 6 × 25,694: all answered correctly.
- **Memory.** LM Studio's estimate depends on context, not on parallel (one pool): Gemma 34.5 / 40.0 / 51.1 GB at
  65,536 / 131,072 / 262,144; Qwen3.8 46.2 / 59.2 / 85.3 GB (the last fails the guardrail). With the resident model
  loaded, the guardrail refused Qwen3.8 at 262,144 (76.69 GB) and 229,376 (71.05 GB) and accepted 196,608.
- **During the study** no arm hit a context-capacity failure; every load succeeded at its planned context.

## Provenance and the resident model

The user's assistant model, `google/gemma-4-26b-a4b-qat` (Q4_0, parallel 4), stayed loaded throughout and was tolerated
by name (`--tolerate-instance`). Every one of the 5,200 responses analysed (including the frozen checkpoints) names the
study's own loaded identifier, and the instance it maps to in the per-request `lms ps` snapshot has the intended model
key (`google/gemma-4-26b-a4b@q8_0` or `qwen/qwen3.8-27b@q8_0`), architecture, parallel level and context: 0
mismatches, and no response came from the QAT instance (`identity` in the results). 4,200 calls, 2026-10-26 22:50 to
2026-10-27 03:26 UTC (4.6 h incl. loads), no halt, no retry, no capacity failure.

## Limitations

- Two models, one device, one runtime (LM Studio 0.4.25, llama.cpp GGUF), one prompt protocol, 500 cases.
- Fixed order: level is confounded with time of night and with the assistant's (light) load.
- Batches came from one dataset at a time (dataset-order dispatch), so co-batching across length bands, which a busy
  production server would see, was not tested.
- Speculative decoding was on for Qwen3.8 in all arms; its interaction with batching is inferred, not measured.
- The 99% agreement bar is strict at 500 cases: Gemma misses it by 1–2 cases per level (5 disagreements are allowed,
  it had 6–7). The rule was declared in advance and is applied as written; the serial drift floor of 0/500 is the
  stronger reason to treat Gemma's flips as real.

## What this means

- Keep frozen comparisons serial (unchanged).
- For new or exploratory runs the declared recommendation is serial. Batching is safe for **aggregate accuracy** on
  both models (no ΔBA), so it is a defensible opt-in for throughput-bound exploratory screens that report pooled
  metrics, but **not** where individual verdicts or reruns must be reproducible (Gemma).
- If a run opts in for Qwen3.8, use **p4**, not the rule's p8: p4 passes too and is faster, with much lower latency.
  (This is a post-hoc reading; the rule's adopted level is 8.)
- How to run batched is documented in [`evals/README.md`](../README.md#batched-parallel-slot-runs-opt-in).
