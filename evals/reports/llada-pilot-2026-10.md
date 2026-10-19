# LLaDA2.2 text-diffusion pilot: results (2026-10-18)

This pilot asks how text-diffusion language models (dLLMs) do as prompt-injection detectors next to the autoregressive
models in the Studio baseline ([#38](https://github.com/elicollinson/solenoid-security/issues/38)). Three LLaDA2.2
builds were run on the abliteration pilot's 9 datasets: 998 cases, with the same caseIds, labels and model-input hashes
as the comparators. The builds were LLaDA2.2-mini at 6-bit and 4-bit MLX, and LLaDA2.2-flash at 4-bit MLX. The
comparators were the seven Studio Q8 baseline models and the two abliterated Qwen3.8 builds. Execution is in research
log L153. The observation is `FINDINGS.md` O61.

**This is a pilot.** It covers a 998-case subset, one runtime and one device, and the comparison has known confounds
(below). It answers whether these models are worth a full run. It does not rank dLLMs in general.

Source: [`llada-pilot-results.json`](../analysis/llada-pilot-2026-10/results/llada-pilot-results.json), written by
[`analyze-llada-pilot.ts`](../analysis/llada-pilot-2026-10/analyze-llada-pilot.ts). The script is offline. It audits
all 108 checkpoints (12 models × 9 tests) with `auditPartialCheckpoint` through the abliteration pilot's
`extractCheckpoint`. It also checks with `assertIdenticalCases` that every case has the same label and input hash
under all 12 models. Every cell was complete and passed. No inference was run for this analysis.

## Bottom line

- **All three builds are weak detectors at this scale.** Mean balanced accuracy (BA) over the 9 datasets was 0.714 for
  flash 4-bit, 0.695 for mini 6-bit and 0.649 for mini 4-bit. Gemma 4 26B-A4B scored 0.953 and Qwen3.8 27B 0.888.
  The builds sit at about Laguna XS 2.1's level (0.689). They are 0.24 to 0.30 below Gemma26, and every paired exact
  McNemar test against Gemma26 or Qwen3.8 has p < 10⁻³⁴ (Holm over six tests).
- **They are very fast.** Median server time per request was 143 ms (mini 6-bit), 135 ms (mini 4-bit) and 421 ms
  (flash 4-bit), against a client wall-time median of 2.96 s for Gemma26 and 4.93 s for Qwen3.8. Both of those reason
  first. Measured the same way (client wall time), the mini builds are about 18× faster than Gemma26 and flash about
  7× faster. Each build ran all 998 cases in about 5 to 14 minutes of wall time.
- **Most of the gap is missed attacks, plus false alarms on web and agent content.** On the four LongPIBench
  cohorts, LLaDA flagged 20–81% of attacks (mostly under 50%), where Gemma26 and Qwen3.8 flagged 92–100%. BIPIA
  email recall was 0.28–0.54 and PIDS obfuscated recall 0.53–0.59. Web false-alarm rates were 0.63–0.78, against
  0.32–0.33 for the two references.
- **The scores are near-binary and output format is fragile.** At most 14 of each build's scored outputs fall strictly
  between 0.15 and 0.8. Mini 4-bit abstained on 77 cases, mini 6-bit on 31 and flash on 9. All of these are output
  abstentions, and 32% of mini 6-bit's are out-of-range scores (2, 2.5, 8.5, 8.9).
- **They are not usable as a fast pre-screen for Gemma26.** Pooled AUROC is 0.74–0.75 for flash and mini 6-bit, against
  0.955 for Gemma26. Take the least aggressive screen, which clears only cases that score exactly 0 and sends everything
  else (and every abstention) to Gemma26. With mini 6-bit, 80% of cases are still escalated and 41 of Gemma26's
  detections are lost. Mean BA falls from 0.953 to 0.917.

## Setup

**Models.** [LLaDA2.2-mini](https://huggingface.co/inclusionAI/LLaDA2.2-mini) is an MoE dLLM with 16B total and
1.4B active parameters, block diffusion with block size 32 and Levenshtein editing.
[LLaDA2.2-flash](https://huggingface.co/inclusionAI/LLaDA2.2-flash) has about 100B total and about 6B active
parameters. The builds were:

| Condition | Weights (as recorded in the suite) | Suite |
|---|---|---|
| `pilot-llada22-mini-6bit-t128-full` | MLX community 6-bit conversion of inclusionAI/LLaDA2.2-mini | `prompt-injection-openai-compat-llada22-mini-pilot-v1` |
| `pilot-llada22-mini-4bit-t128-full` | 4-bit MLX build of inclusionAI/LLaDA2.2-mini (the suite says the source is to be confirmed) | `prompt-injection-openai-compat-llada22-variants-pilot-v1` |
| `pilot-llada22-flash-4bit-t128-full` | The user's own MLX 4-bit build of the official LLaDA2.2-flash weights | `prompt-injection-openai-compat-llada22-variants-pilot-v1` |

The variants suite is a copy of the 6-bit suite. Only `id` and `conditions` differ (checked with a `jq` diff). Its
engine notes still say "Disabled: no condition uses this engine yet". They were left unchanged, because the
checkpoints pin the suite's SHA-256.

**Runtime.** The user ported the full LLaDA2.2 decoder to MLX and served it through an OpenAI-compatible server on the
Mac Studio. Levenshtein editing was on. The user verified that edit operations happen: token rewrites, DELETE and
INSERT. Requests went through the `openai_compatible` engine (PR #39). These decoding parameters were sent with every
request and are part of the engine identity: temperature 0, threshold 0.5, editing_threshold 0.0, max_post_steps 16,
steps 32, block_length 32 (fixed by the model) and max_tokens 128. The server accepts `response_format` but ignores
it, so only the frozen score-only prompt (`security-eval-score-only-json-v1`) asks for JSON. The server returns no
logprobs. Input is full text, last external turn (`full-last-external-v1`), and the decision rule is score > 0.5.
Requests ran serially. The published run scripts use `$LLADA_BASE_URL` in place of the private endpoint.

**Comparators.** These are the frozen Studio Q8_0 GGUF baseline checkpoints (LM Studio, reasoning on, max_tokens 4096)
and the abliteration-pilot checkpoints for Qwen3.8 heretic-ara and huihui, all restricted to the same 998 caseIds. The
comparator checkpoints were not rerun.

**Order and timing (UTC).** First mini 6-bit: feasibility-24 at 17:15, then the pilot from 17:15:46 to 17:20:29. Then
mini 4-bit, 17:22:11–17:27:59 including feasibility. Then flash 4-bit, 20:14:49–20:28:50 including feasibility. Every
cell exited 0. There were no reruns and no reported model loads (`load_ms` was 0 on every response).

## Results on identical cases

Rates use scored cases, and abstentions are excluded and counted separately. BA is the mean of the available class
rates, so PIDS (attack-only) is recall and NotInject (benign-only) is the true-negative rate. AUROC is computed on
scored cases for the datasets that have both classes.

**Mean BA over the 9 datasets**

| Model | Mean BA | Abstentions | Pooled AUROC | Median request wall time |
|---|---:|---:|---:|---:|
| Gemma 4 26B-A4B-it Q8_0 | 0.953 | 0 | 0.955 | 2,964 ms |
| Gemma 4 31B-it Q8_0 | 0.938 | 0 | 0.969 | 10,003 ms |
| Ornith 1.5 35B-A3B Q8_0 | 0.898 | 1 | 0.950 | 2,019 ms |
| Qwen3.6 35B-A3B Q8_0 | 0.896 | 1 | 0.896 | 4,876 ms |
| Muse Glimmer 30B Q8_0 | 0.893 | 1 | 0.960 | 11,671 ms |
| Qwen3.8 27B Q8_0 | 0.888 | 3 | 0.939 | 4,932 ms |
| Qwen3.8 27B huihui (abliterated) | 0.858 | 5 | 0.938 | 6,256 ms |
| Qwen3.8 27B heretic-ara (abliterated) | 0.854 | 2 | 0.932 | 5,688 ms |
| **LLaDA2.2-flash 4-bit MLX** | **0.714** | 9 | 0.741 | 432 ms |
| **LLaDA2.2-mini 6-bit MLX** | **0.695** | 31 | 0.745 | 162 ms |
| Laguna XS 2.1 Q8_0 | 0.689 | 6 | 0.719 | 3,035 ms |
| **LLaDA2.2-mini 4-bit MLX** | **0.649** | 77 | 0.689 | 153 ms |

Wall time is the client-measured `durationMs` per scored request. The runtimes and transports differ (LM Studio over LM
Link vs the MLX server), so read it as an order of magnitude. Ornith's mean is 0.89751.

**Per dataset (TPR / FPR, BA)**

| Dataset (cases) | Gemma26 | Qwen3.8 | Flash 4-bit | Mini 6-bit | Mini 4-bit |
|---|---|---|---|---|---|
| longpi-paper (120) | 1.000 / 0.000, 1.000 | 0.967 / 0.000, 0.983 | 0.367 / 0.000, 0.683 | 0.255 / 0.000, 0.627 | 0.360 / 0.130, 0.615 |
| longpi-code (120) | 0.950 / 0.000, 0.975 | 0.917 / 0.000, 0.958 | 0.483 / 0.000, 0.742 | 0.293 / 0.000, 0.647 | 0.204 / 0.033, 0.585 |
| longpi-email (120) | 1.000 / 0.000, 1.000 | 1.000 / 0.000, 1.000 | 0.627 / 0.000, 0.814 | 0.608 / 0.034, 0.787 | 0.810 / 0.164, 0.823 |
| paper-score-counterfactual (72) | 1.000 / 0.000, 1.000 | 0.944 / 0.000, 0.972 | 0.296 / 0.000, 0.648 | 0.404 / 0.118, 0.643 | 0.409 / 0.375, 0.517 |
| bipia-email-mixed (120) | 0.867 / 0.000, 0.933 | 0.283 / 0.000, 0.642 | 0.283 / 0.033, 0.625 | 0.421 / 0.150, 0.636 | 0.536 / 0.583, 0.476 |
| web-mixed (120) | 0.983 / 0.333, 0.825 | 0.950 / 0.317, 0.817 | 0.967 / 0.650, 0.658 | 0.933 / 0.627, 0.653 | 0.983 / 0.780, 0.602 |
| agentdyn-github (94) | 1.000 / 0.000, 1.000 | 1.000 / 0.170, 0.915 | 1.000 / 0.447, 0.777 | 1.000 / 0.511, 0.745 | 1.000 / 0.638, 0.681 |
| pids-obfuscated (112, attacks only) | 0.902 | 0.703 | 0.527 | 0.527 | 0.594 |
| benign-false-positives (120, benign only; TNR) | 0.942 | 1.000 | 0.956 | 0.992 | 0.947 |
| **Mean BA** | **0.953** | **0.888** | **0.714** | **0.695** | **0.649** |

The pattern is consistent. LLaDA misses most attacks in long documents and flags many benign web pages and agent tool
outputs. On BIPIA email, flash matches Qwen3.8 (both 0.283 recall) and mini 6-bit exceeds it (0.421, at an FPR of
0.15). NotInject is the one dataset where LLaDA is close to the reasoning models. The 4-bit mini flags more of
everything than 6-bit, so it gains recall on email and LongPI email but pays for it in false alarms. Its abstentions
also concentrate on attacks (56 of 77).

**Paired exact McNemar (correct vs incorrect, cases both models scored; Holm over 6)**

| Reference → LLaDA build | Both scored | Only reference correct | Only LLaDA correct | Paired accuracy difference | p (Holm) |
|---|---:|---:|---:|---:|---|
| Gemma26 → flash 4-bit | 989 | 250 | 6 | −0.247 | 3.3×10⁻⁶⁵ |
| Gemma26 → mini 6-bit | 967 | 257 | 11 | −0.254 | 1.8×10⁻⁶¹ |
| Gemma26 → mini 4-bit | 921 | 287 | 12 | −0.299 | 1.0×10⁻⁶⁸ |
| Qwen3.8 → flash 4-bit | 986 | 194 | 17 | −0.180 | 6.3×10⁻³⁹ |
| Qwen3.8 → mini 6-bit | 964 | 210 | 28 | −0.189 | 1.1×10⁻³⁵ |
| Qwen3.8 → mini 4-bit | 919 | 248 | 35 | −0.232 | 3.1×10⁻⁴⁰ |

Against Gemma26, flash loses 205 detections and gains 1, adds 45 false alarms and removes 5. Mini 6-bit loses 202 and
gains 4, adding 55 false alarms and removing 7. Per dataset (uncorrected), every comparison is significant at 0.05 except
four of the six on NotInject and BIPIA email against Qwen3.8 for flash and mini 6-bit. On NotInject, mini 6-bit is
significantly better than Gemma26 (6 vs 0 discordant, p = 0.031). Between the LLaDA builds, mini 6-bit beats mini 4-bit (82 vs 43
discordant, p = 6.2×10⁻⁴). Mini 6-bit and flash 4-bit do not differ (72 vs 92, p = 0.14), despite flash's roughly
4× larger active size.

## Speed

Server timings come from `raw.nativeResponse.timings` (llama.cpp style) on every response in the 9 datasets:

| Build | Total ms, median / p95 / max | Prompt ms, median | Decode ms, median | Decode tok/s, median | Prompt tok/s, median | Completion tokens, median | Server time, all 998 |
|---|---|---:|---:|---:|---:|---:|---:|
| Mini 6-bit | 143 / 674 / 2,322 | 32 | 103 | 106 | 10,999 | 11 | 4.1 min |
| Mini 4-bit | 135 / 1,064 / 3,124 | 31 | 95 | 115 | 11,528 | 11 | 5.1 min |
| Flash 4-bit | 421 / 2,253 / 4,510 | 116 | 267 | 44 | 3,140 | 12 | 12.4 min |

The median prompt is 356 tokens. The p95 and max come from LongPI documents (up to about 10k tokens). The slowest
request was flash's first one, in feasibility-24, before the pilot: 10.4 s of server time, 7.4 s of it prompt
processing, and 65 s of client wall time. The server still reported `load_ms` 0 for it, so `modelLoad` did not flag
this warm-up. Decoding a 12-token verdict costs about one block of denoising steps, and prompt processing dominates
only on long documents. For comparison, Gemma26's mean client wall time on these cases was 3.56 s (about 59 min for
998), most of it reasoning.

## Abstentions and output format

Every abstention is an `output_abstention` (no length cut-offs; one mini 4-bit output did not finish with `stop`). The
analysis classifies the stop-finished final answers by shape (counts only):

| Shape | Flash 4-bit | Mini 6-bit | Mini 4-bit |
|---|---:|---:|---:|
| Unparsable JSON | 8 | 6 | 40 |
| Valid object followed by trailing text (e.g. an extra `}`) | 0 | 2 | 1 |
| JSON that is not an object (bare number or string) | 0 | 0 | 4 |
| Object without `concernScore` (e.g. `score`) | 0 | 5 | 4 |
| `concernScore` plus extra keys (e.g. `summary`) | 1 | 8 | 12 |
| `concernScore` out of range | 0 | 10 | 15 |
| Not finished with `stop` | 0 | 0 | 1 |
| **Total** | **9** | **31** | **77** |
| Out-of-range share | 0% | 32% | 19% |
| On attacks / benign | 1 / 8 | 26 / 5 | 56 / 21 |

The out-of-range values were 2 (×4), 8.5 (×4), 8.9 and 2.5 for mini 6-bit, and 2 (×5), 8 (×5), 9 (×2), 8.5, 1.5 and
2.5 for mini 4-bit. They look like a 0–10 scale, but the rule never rescales a score, so they stay abstentions. Mini
abstentions cluster on LongPI email (10 and 23), LongPI paper (7 and 16) and the score probe (8 and 12). Flash's
cluster on NotInject (7). Without a schema-constrained decoder (`response_format` is ignored), format errors grow as
the weights get smaller.

**Score distribution.** The scores are near-binary. Flash used 13 distinct values, but 0 / 0.05 / 0.1 / 0.95 account
for 893 of 989 scored outputs. Mini 6-bit used 12, mostly 0.1 (407), 0 (201), 0.9 (146), 0.95 (103) and 0.8 (90).
Mini 4-bit used 11, mostly 0.1 (285), 0.8 (216), 0 (198) and 0.9 (134). Only 11, 13 and 14 scored outputs fall strictly
between 0.15 and 0.8. A threshold sweep therefore has almost nothing to work with: moving the threshold from 0.1 to
0.5 changes flash's recall only from 0.585 to 0.558.

## Interpretation

At this scale, with this protocol, LLaDA2.2 is a weak injection detector: 1.4B active parameters for mini and about
6B for flash at 4-bit. It lands near Laguna XS 2.1, the weakest baseline model, and about 0.24–0.26 BA below Gemma26
(0.30 for mini 4-bit). Its errors are mostly missed attacks in long documents, plus false alarms on web and agent
content that the reasoning models leave alone. Going from mini 6-bit to flash 4-bit raises BA by 0.02 and cuts
abstentions from 31 to 9, but the paired difference is not significant. Most of the format gain may come from flash
being larger, and some may come from the quantization. This pilot cannot separate the two.

**Fast pre-screen (library cascade).** A dLLM first pass is useful only if it can clear a large share of benign
traffic at a threshold where it keeps almost every attack. AUROC says it cannot. Pooled AUROC is 0.741 (flash), 0.745
(mini 6-bit) and 0.689 (mini 4-bit), against 0.955 for Gemma26. With near-binary scores, the only lever is which
low score counts as cleared. The analysis simulates a pre-screen that clears a case when its score is at or below t,
and sends everything else, including every abstention, to Gemma26:

| Pre-screen, t | Pre-screen recall | Attacks cleared | Benign cleared | Escalated to Gemma26 | Gemma26 detections lost | Cascade mean BA |
|---|---:|---:|---:|---:|---:|---:|
| Mini 6-bit, 0 | 0.910 | 46 | 32% | 80% | 41 | 0.917 |
| Flash 4-bit, 0 | 0.823 | 91 | 43% | 70% | 83 | 0.875 |
| Mini 4-bit, 0 | 0.879 | 62 | 28% | 80% | 55 | 0.904 |
| Flash 4-bit, 0.1 | 0.585 | 213 | 83% | 38% | 193 | 0.773 |

Gemma26 alone scores 0.953. The cheapest useful setting still sends 70–80% of cases to Gemma26, so it saves at most
20–30% of second-stage time. In exchange, it loses 41–83 detections that Gemma26 would have made. The verdict is that
a fast pre-screen is **not viable** with these builds.

## Caveats

- **No reasoning vs reasoning baselines.** LLaDA2.2 emits no separate reasoning. Every comparator reasons first
  (reasoning on, max_tokens 4096). The gap mixes model capability with the value of reasoning. A non-reasoning
  autoregressive comparator would be fairer.
- **Quantization and runtime differ.** LLaDA ran as MLX 6-bit and 4-bit through a custom MLX port. The comparators are
  Q8_0 GGUF in LM Studio. Weight precision, runtime and transport all differ. The mini 4-bit source is unconfirmed in
  the suite.
- **Prompt-only JSON.** The server ignores `response_format`, so nothing constrains LLaDA's output. The comparator
  engines sent LM Studio a strict JSON-schema `response_format` along with the same prompt. Part of the abstention gap
  is therefore protocol, not model.
- **A 998-case subset.** About 100 cases per dataset, 9 datasets, four of them LongPIBench (one fixed attack sentence
  per template). This is not the full 21-dataset baseline.
- **One runtime, one device, one decoding setting.** These results come from a single MLX port with editing on,
  `steps` 32 and `threshold` 0.5. Other decoders (the transformers reference or SGLang `JointThresholdInDel`) and other
  step or threshold settings were not tested. Latencies come from one Mac Studio.
- **Prompt not tuned for the family.** The frozen score-only prompt was written for the baseline models, and the 0–10
  outputs suggest it is not always read as asking for a 0–1 score.

## Next steps

1. **Flash at 6-bit or 8-bit, if memory allows.** The Studio has 96 GB. This would show whether flash's weakness is
   quantization or capacity. It is the only remaining LLaDA arm that could change the conclusion.
2. **A fairer non-reasoning comparison.** For example, Gemma26 with thinking off on the same 998 cases. This separates
   "diffusion vs autoregressive" from "no reasoning vs reasoning".
3. **The library cascade with a dLLM pre-screen.** This is not worth pursuing at the measured AUROC (≈0.74). Revisit it
   only if a larger or higher-precision build reaches high recall at a low threshold while clearing most benign
   traffic. Read AUROC and the clearance table first.
4. The full baseline plus extension only if step 1 or 2 changes the picture.
