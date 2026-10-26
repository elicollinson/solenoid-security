# Pre-registration: batching (parallel-slot) equivalence on the Studio (2026-10-26)

Tracking issues [#21](https://github.com/elicollinson/solenoid-security/issues/21) (F5, batched inference) and, for the
shared batch-invariance mechanism only, [#7](https://github.com/elicollinson/solenoid-security/issues/7) (speculative
decoding; not tested here). Background: `FINDINGS.md` F5, O34 (hosted temperature-0 churn) and O47 (Studio serial reruns
are nearly, but not always, byte-reproducible). Every local run so far is serial (parallel 1, client concurrency 1).
Committed and pushed before the first study call. Scripts: [`evals/analysis/batching-equivalence-2026-10/`](../analysis/batching-equivalence-2026-10/).

## Question

Does serving with LM Studio's parallel predictions (`lms load --parallel N`, llama.cpp continuous batching over a unified
KV cache) change temperature-0 detection outcomes relative to serial serving, and how much throughput does it buy?

## Context-per-slot finding (measured before freezing; probe outputs retained)

`context-probe.ts` loads a study model, sends K concurrent copies of a synthetic numbered-line prompt (no dataset text)
and records status, `prompt_tokens` and the answer. Outputs: `evals/runs/batching-equivalence-2026-10-26/context-probe/`.

- **The context is one shared pool, not split per slot.** Gemma 4 26B-A4B Q8 at context 65,536 and parallel 4 accepted
  one 36,435-token prompt and answered correctly (a per-slot split would cap a slot at 16,384).
- **Over-subscription fails every in-flight request.** Four concurrent 36k prompts at 65,536 all returned HTTP 400
  "Context size has been exceeded"; two concurrent 33k Qwen3.8 prompts at 65,536 did the same. Nothing is truncated or
  queued; the requests error.
- **Sizing.** The longest study inputs are BrowseSafe: 27,079 prompt tokens (Gemma) and 25,863 (Qwen3.8). Plus the 4,096
  output cap, one slot needs ≤ 32,768. Total context = parallel × 32,768, floored at the frozen 65,536:
  p1 65,536, p2 65,536, p4 131,072, p8 262,144. Verified: Gemma p4/131,072 with 4 × 26.7k and p8/262,144 with
  8 × 26.7k, Qwen3.8 p4/131,072 with 4 × 33.4k, all correct.
- **Memory headroom.** LM Studio's load guardrail (default settings, unchanged) refused Qwen3.8 at 262,144 (76.7 GB) and
  229,376 (71.1 GB) next to a resident model (below), and accepted 196,608 (6 × 25.7k concurrent prompts answered
  correctly). **Qwen3.8 p8 therefore runs at 196,608** (24,576 per slot on average). Its worst in-flight demand in
  dispatch order, from the frozen serial token counts over any 8 consecutive cases, is 156,703 tokens (BrowseSafe),
  which fits. Gemma p8 at 262,144 loads (the SDK estimate is 47.6 GB). Estimates per model × level × context are in
  `memory-estimate.json` (context memory does not depend on parallel: one pool).

## Environment note: a resident user model

At the start, `lms ps` showed `google/gemma-4-26b-a4b-qat` (Q4_0, context 262,144, parallel 4, no TTL) on the Studio. It
serves the user's assistant (hourly and bursty requests in the LM Studio server log). It is not unloaded. The matrix
driver gains `--tolerate-instance=<identifier>`: that named instance is neither counted as a foreign load nor unloaded;
any other loaded model still halts the driver (tested). Effects:
- **Numerics:** none expected. It is a separate model instance; requests are never co-batched with ours.
- **Throughput:** its requests share the GPU. The analysis counts the assistant's requests (from the LM Studio server log
  on this Mac) inside each arm's span and reports them; arms with heavy overlap are flagged.
- **Memory:** headroom figures are with that model resident, so they are conservative.

## Design

- **Suite** `prompt-injection-lmstudio-studio-batching-equivalence-q8-t4096-v1` (sha256 `5063ccb4…f989`, `plan.json`).
  Ten tests copied byte-for-byte from the frozen baseline/extension suites plus `caseIds` (seeded, label-balanced;
  seed `batching-equivalence-2026-10-26`): 500 cases.

  | Band | Test | Cases (pos/neg) |
  |---|---|---|
  | short | `benign-false-positives` (NotInject) | 40 (0/40) |
  | short | `pids-obfuscated` (stratified by obfuscation) | 40 (40/0) |
  | short | `bipia-email-mixed` | 40 (20/20) |
  | short | `inj-squad-mixed` (QA) | 40 (20/20) |
  | medium | `web-mixed` | 60 (30/30) |
  | medium | `agentdyn-github` | 50 (25/25) |
  | medium | `agentdojo-suites-mixed` | 50 (25/25) |
  | long | `longpi-paper` | 60 (30/30) |
  | long | `longpi-email` | 60 (30/30) |
  | long | `browsesafe-mixed` | 60 (30/30) |

- **Models.** Gemma 4 26B-A4B Q8_0 (MoE; frozen engine `gemma26-q8`) and Qwen3.8 27B Q8_0 at `reasoning_effort: "low"`
  (dense; engine `qwen38-q8gguf-low` from the `…qwen38low` suites).
- **Engines.** The p1 engine is the frozen engine, byte-for-byte (parallel 1, context 65,536, timeout 300 s). The p2/p4/p8
  engines differ from it only in id, loaded identifier, `parallel`, `contextLength` (above) and `timeoutMs` (900 s;
  transport only, so a request waiting behind co-batched long prefills is not cut off). `make-suite.ts` checks this
  with a sorted-JSON diff.
- **Conditions.** `batching-<model>-q8-p{1,2,4,8}-full` with harness `--concurrency` = parallel, plus
  `batching-<model>-q8-p4-repeat-full`: the p4 engine re-run on the first 10 cases of each test (`--limit=10`, 100 cases,
  the same dispatch order and so the same neighbours as the main p4 arm, modulo timing).
- **Frozen protocol otherwise:** Q8 GGUF, temperature 0, `max_tokens` 4,096, the score-only prompt and `json_schema`,
  native `/api/v0`, `--require-device=2e1a82366471bc1a78e9b74d2469172d`, the device lock and
  `--continue-after-output-errors`. No speculative drafting flags are passed (LM Studio's default; the loaded-model info
  is logged per load, for #7's provenance prerequisite).
- **Order.** One model and level at a time: Gemma26 p1, p2, p4, p4-repeat, p8, then Qwen3.8 in the same order. Within an
  arm the ten tests run in suite order. The order is fixed, not randomized (a limitation: level is confounded with time
  of day and with the assistant's load).
- **Batch composition.** The workers dispatch in dataset order within a test, so co-batched requests come from the same
  dataset and length band; the pool drains at each test boundary.

## Endpoints (per model × level; references: the p1 arm, and for p1 the frozen checkpoints)

1. **Throughput.** Cases per hour and aggregate generated tokens per second over the arm's span (sum of per-test spans,
   first dispatch to last response; loads excluded), and per-request client wall time (median, p90, max). Per-request
   TTFT and tokens/s are reported but are not comparable across levels.
2. **Agreement with serial (p1).** Outcome agreement: same status and, if scored, same flag at > 0.5 (an abstention on
   one side only is a disagreement). Identical-score rate and identical-final-answer rate (exact `content` string), on
   cases scored in both. Reasoning-text identity (hash) and reasoning-token identity are reported as secondary.
3. **ΔBA vs p1.** Pooled BA over the 500 cases (TPR over all 280 positives, TNR over all 220 negatives; abstentions
   excluded) with a 95% paired, class-stratified bootstrap (10,000 resamples, seed 21). Paired exact two-sided McNemar on
   per-case correctness, on cases scored in both arms. Sensitivity: abstentions counted as errors.
4. **Abstentions.** Rate in each arm and the change in points vs p1.
5. **Memory headroom.** Whether each load succeeded at its context, LM Studio's estimate, and any context-capacity
   failure during the run.

Also reported (not part of the adoption rule): **drift**, p1 vs the frozen checkpoints on the same 500 cases (the serial
run-to-run floor, cf. O47) with the same agreement metrics; **determinism**, p4-repeat vs p4 on its 100 cases, set
against p4 vs p1 and p1 vs frozen on the same 100 cases; and where disagreements fall (band, dataset, |score − 0.5|).

## Adoption rule (declared now)

For each model, a level **passes** if all hold vs that model's p1 arm:
- outcome agreement ≥ 99%;
- McNemar p ≥ 0.05;
- abstention rate rises by ≤ 0.5 points;
- the arm completed without a context-capacity failure.

The **adopted level for a model** is the largest level that passes with every lower level also passing. The repo-wide
recommendation for **new or exploratory** runs is the smaller of the two models' adopted levels (1 = stay serial).
Comparisons against frozen baselines stay serial regardless. No multiplicity correction is applied to the adoption
McNemars (a conservative choice for adoption: more tests make a rejection more likely, not less).

## Gates and stopping rules

1. **Preflight** (`run-chain.sh`): the suite hash equals `plan.json`; every one of the 100 cells dry-runs to the planned
   case count; no device lock, no other matrix driver, nothing loaded but the tolerated instance; LM Link connected.
2. **Every arm** (`cell.ts`): every planned case finished (scored or abstained). A context-capacity failure (HTTP 400
   "Context size has been exceeded") is logged as `ARM_CAPACITY_FAIL`; that level fails endpoint 5 and the queue moves
   on. Any other failure (transport, LM Link, provenance) halts. Per L141 a halted cell is never resumed after a link or
   provenance failure; it is rerun under a fresh condition id, and the original checkpoint is retained.
3. **Time.** Serial estimate from the frozen spans: Gemma26 0.46 h, Qwen3.8 0.79 h per 500 cases; about 3 to 3.5 h in
   all. Hard cap 5 h from `CHAIN_START`.

## Retention

Every checkpoint is kept: all levels, the repeat, the probes and any failed or aborted cell. Nothing is deleted or
overwritten. All study runs are imported into Supabase, and `evals/runs/` is copied additively to the raw backup.
Aggregates for every arm are published, whichever arm is adopted.
