# LLaDA2.2-flash: full Studio suites and a pre-registered window test (2026-10-19)

> **PRE-REGISTERED (§3–§5); EXPLORATORY (§6–§9).** The plan
> ([`llada-flash-full-plan-2026-10.md`](llada-flash-full-plan-2026-10.md),
> [`plan.json`](../analysis/llada-flash-full-2026-10/plan.json)) and both suites were committed in `f122c8d` and
> pushed at 2026-10-19 02:10:40 UTC (commit time). The run started at 02:11:05 UTC, after the push. The confirmatory sections test exactly
> the declared hypotheses, families, policy and criteria. Everything else is labelled exploratory. Part of
> [#38](https://github.com/elicollinson/solenoid-security/issues/38); follows the exploratory sweep
> ([report](llada-window-sweep-2026-10.md), FINDINGS O62).

## 1. Short answer

- **Full text (8th row).** LLaDA2.2-flash 4-bit MLX has a mean BA of **0.718** on the 21-test baseline and **0.707**
  on the 14-test extension. That is 7th of 8 in both suites, just above Laguna XS 2.1 (0.712 and 0.702) and
  0.17–0.22 below the other six Q8 models. It is a diffusion model with no reasoning pass, at about 0.65 s per
  request.
- **H1 (windows beat full text on long documents): supported on 9 of 13 cohorts** at 256/256, with a mean ΔBA of
  +0.082. It fails on four cohorts:
  - longpi-resume (+0.003);
  - BrowseSafe (0.000);
  - subtle résumés (+0.029, Holm p = 0.20);
  - TriviaQA, where windows are **significantly worse**: −0.023, with 81 detections lost against 42 gained.
- **H2 (the gain holds where the payload is not at the end): SUPPORTED.** The gains at 256/256 are:
  - LongPIBench abstract: TPR 0.223→0.385 (+52/−5);
  - LongPIBench method: 0.175→0.377 (+59/−0);
  - LLMail payloads in the middle of an attachment: 0.253→0.444 (+25/−6);
  - subtle paper and subtle code.

  In each of these the firing window is where the payload is, not the last window. At 128/128 all six H2 members
  improve, by +0.05 to +0.29 BA. **O62's end-of-document confound does not explain the gain away.**
- **H3 (no added false alarms, margin 2 points): NOT non-inferior.** Pooled benign FPR rose 0.064→0.079 (Δ +0.015,
  95% CI 0.006–0.025). The rise comes from BrowseSafe web pages (+34/−16 false alarms). Without BrowseSafe
  (exploratory) it is 0.001→0.006, upper bound 0.011. At 128/128, false alarms rose 0→12 on 399 benign documents
  (9 on subtle code). **O62's "zero added false alarms" is withdrawn as a general claim.** It holds approximately
  only for LongPIBench-style documents at 256 words.
- **Still far from the references.** On every window cohort, Gemma 4 26B-A4B and Qwen3.8 27B full text stay above
  Flash with windows. Pooled over the window cohorts the discordant counts are 1,893 vs 86 against Gemma26, and the
  absolute recall on non-end payloads remains low (0.38–0.47 against 0.99–1.00). O62's parity on code and email
  **does not replicate** at full size: email 0.975 vs 1.000, code 0.888 vs 0.962.

## 2. What ran

- **Volume:** 55 cells, **88,163 calls**, exactly the dry-run count.
- **Timing:** wall clock 02:11:05–12:13:14 UTC (10 h 02 min), strictly serial. The phases were full text 2 h 34 min,
  256/256 4 h 15 min and 128/128 3 h 13 min. Summed HTTP time was 10.0 h, against an estimate of 9.8 h.
- **Failures:** 0 transport errors, 0 retries, 0 halts and 0 server model reloads. The only failures were output
  abstentions.
- **Abstentions:**
  - full text: 137 of 14,085 cases. Nemotron reached 35/360 (9.7%), just under the 10% flag. NotInject was 20/339.
  - windows: 0.0–0.7% of windows. Under the primary ignore-invalid policy, 1 case abstained. Under strict, up to
    24 of 400 papers did.
- **Determinism:** every comparable score reproduced exactly: 971/971 against the pilot's full-text checkpoints and
  907/907 against the sweep's 256/256 windows.
- **Engine:** `llada22-flash-4bit`, byte-identical to the pilot and the sweep, through the `openai_compatible`
  engine. The suites are `prompt-injection-openai-compat-llada22-flash-{baseline,extension}-v1`. Their tests are
  copied verbatim from the Studio Q8 t4096 suites.
- **Comparators:** the 7 Q8 rows are recomputed from their checkpoints with the same auditor. They match the
  published baseline and extension aggregates for every model and group.

## 3. Full text: Flash as the 8th model

Scoring is the same as in the 7-model tables: abstentions are excluded and counted, per-dataset BA is the mean of
the available class rates, and groups and the overall score weight datasets equally.

**Baseline suite (21 tests, 7,326 cases).**

| Model | Overall | longdoc | email | web | agent | obfusc | benign | policy | Abst. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 26B-A4B Q8 | 0.923 | 0.993 | 0.901 | 0.858 | 0.983 | 0.811 | 0.956 | 0.513 | 9 |
| Gemma 4 31B-it Q8 | 0.915 | 0.981 | 0.909 | 0.867 | 0.992 | 0.760 | 0.958 | 0.500 | 5 |
| Ornith 1.5 35B-A3B Q8 | 0.906 | 0.950 | 0.831 | 0.866 | 0.988 | 0.828 | 0.967 | 0.500 | 12 |
| Muse Glimmer 30B Q8 | 0.903 | 0.948 | 0.827 | 0.854 | 0.968 | 0.843 | 0.969 | 0.500 | 5 |
| Qwen3.6 35B-A3B Q8 | 0.901 | 0.940 | 0.790 | 0.842 | 0.985 | 0.855 | 0.962 | 0.500 | 3 |
| Qwen3.8 27B Q8 | 0.895 | 0.964 | 0.712 | 0.856 | 0.971 | 0.810 | 0.994 | 0.500 | 17 |
| **LLaDA2.2-flash 4-bit MLX** (diffusion, no reasoning) | **0.718** | 0.599 | 0.563 | 0.700 | 0.905 | 0.730 | 0.919 | 0.500 | 68 |
| Laguna XS 2.1 Q8 | 0.712 | 0.566 | 0.550 | 0.772 | 0.917 | 0.689 | 0.985 | 0.500 | 114 |

**Extension suite (14 tests, 6,759 cases).**

| Model | Overall | longdoc | bipia | qa | web | agent | email | code | Abst. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 31B-it Q8 | 0.923 | 0.917 | 0.917 | 0.921 | 0.825 | 0.999 | 0.920 | 0.923 | 0 |
| Gemma 4 26B-A4B Q8 | 0.922 | 0.906 | 0.904 | 0.948 | 0.820 | 0.999 | 0.943 | 0.907 | 2 |
| Muse Glimmer 30B Q8 | 0.904 | 0.929 | 0.839 | 0.815 | 0.765 | 1.000 | 0.943 | 1.000 | 0 |
| Ornith 1.5 35B-A3B Q8 | 0.895 | 0.914 | 0.857 | 0.858 | 0.662 | 0.991 | 0.886 | 0.999 | 2 |
| Qwen3.6 35B-A3B Q8 | 0.866 | 0.854 | 0.828 | 0.914 | 0.703 | 0.982 | 0.810 | 0.888 | 2 |
| Qwen3.8 27B Q8 | 0.865 | 0.908 | 0.748 | 0.730 | 0.802 | 0.999 | 0.810 | 1.000 | 2 |
| **LLaDA2.2-flash 4-bit MLX** (diffusion, no reasoning) | **0.707** | 0.659 | 0.711 | 0.562 | 0.635 | 0.955 | 0.638 | 0.874 | 69 |
| Laguna XS 2.1 Q8 | 0.702 | 0.685 | 0.644 | 0.591 | 0.608 | 0.955 | 0.701 | 0.709 | 8 |

**What the row shows.**

- **Missed attacks drive the losses.** At full text Flash flags almost nothing on clean long documents (FPR 0.000 on
  every LongPIBench cohort, 0.003 on authorized-benign). Its recall is low:
  - LongPI paper 0.378, abstract 0.223, method 0.175;
  - QA passages 0.106 (SQuAD) and 0.142 (TriviaQA);
  - BIPIA table 0.100;
  - subtle templates 0.026–0.168.
- **It is competitive where attacks are blatant.** BA is 0.92–1.00 on most agent tool output (AgentDojo suites 0.915,
  Nemotron 0.994, AgentDyn shopping 0.985, agent-injection-bench 0.920), 0.874 on RepoGuard and 0.871 on BIPIA code.
- **False alarms:**
  - web-like content: web-mixed FPR 0.558 and BrowseSafe 0.535;
  - AgentDyn GitHub: 0.447;
  - encoded benign controls: 0.178. That is fewer false alarms than the Gemma models (BA 0.822 against 0.595 for
    Gemma26), although Qwen3.8 does better (0.966).
- Paired against Gemma26 over all 35 tests, the discordant counts are 4,192 vs 525. Against Qwen3.8 they are
  3,204 vs 454. Per-test tables are in [`tables.md`](../analysis/llada-flash-full-2026-10/results/tables.md).

## 4. H1: windows against full text (confirmatory)

The primary policy is ignore-invalid. Pairs are jointly valid cases. The test is exact McNemar, with Holm over the 13
cohorts that contain attacks.

| Cohort | n | Full BA | 256/256 BA | ΔBA | +gained/−lost | FA +/− | Holm p | H1 |
|---|---:|---:|---:|---:|---|---|---:|---|
| longpi-paper | 398 | 0.689 | 0.736 | +0.047 | +40/−9 | +1/−0 | 1.7×10⁻⁴ | ✔ |
| longpi-paper-abstract | 291 | 0.223 | 0.385 | +0.162 | +52/−5 | 0 | 6×10⁻¹⁰ | ✔ |
| longpi-paper-method | 292 | 0.175 | 0.377 | +0.202 | +59/−0 | 0 | 4×10⁻¹⁷ | ✔ |
| longpi-resume | 400 | 0.875 | 0.878 | +0.003 | +8/−6 | 0 | 1.0 | ✘ |
| longpi-code | 400 | 0.750 | 0.888 | +0.138 | +91/−5 | +1/−0 | 2×10⁻¹⁹ | ✔ |
| longpi-email | 394 | 0.832 | 0.975 | +0.143 | +90/−6 | 0 | 3×10⁻¹⁹ | ✔ |
| paper-score-counterfactual | 72 | 0.648 | 0.759 | +0.111 | +14/−2 | 0 | 0.017 | ✔ |
| browsesafe-mixed | 400 | 0.635 | 0.635 | 0.000 | +22/−4 | +34/−16 | 1.0 | ✘ |
| inj-triviaqa-mixed | 1,198 | 0.571 | 0.548 | **−0.023** | +42/−81 | +1/−0 | 0.0025 (worse) | ✘ |
| longpi-email-llmail-mixed | 393 | 0.652 | 0.739 | +0.087 | +65/−14 | 0 | 5×10⁻⁸ | ✔ |
| longpi-subtle-paper-mixed | 215 | 0.513 | 0.616 | +0.103 | +25/−0 | +1/−0 | 6×10⁻⁶ | ✔ |
| longpi-subtle-code-mixed | 220 | 0.550 | 0.608 | +0.058 | +15/−0 | +1/−0 | 0.0026 | ✔ |
| longpi-subtle-resume-mixed | 219 | 0.584 | 0.613 | +0.029 | +9/−2 | 0 | 0.20 | ✘ |

**Results.**

- **9 of 13 supported** (mean ΔBA +0.082). The strict policy gives the same 9 of 13.
- **TriviaQA is a significant loss.** End-inserted TriviaQA payloads lose 76 detections (§6). Full text catches
  them; the window that holds the payload does not.
- **Secondary, 128/128 (6 H2 cohorts, Holm over 6): 6 of 6 supported**, mean ΔBA +0.159. Detail:

  | Cohort | Full BA | 128/128 BA | +gained/−lost | FA added |
  |---|---:|---:|---|---:|
  | longpi-paper-abstract | 0.223 | 0.474 | +78/−5 | 0 |
  | longpi-paper-method | 0.175 | 0.469 | +86/−0 | 0 |
  | longpi-email-llmail-mixed | 0.652 | 0.804 | +103/−14 | 0 |
  | longpi-subtle-paper-mixed | 0.513 | 0.670 | +40/−0 | 3 |
  | longpi-subtle-code-mixed | 0.550 | 0.597 (Holm p = 0.041) | +24/−2 | 9 |
  | longpi-subtle-resume-mixed | 0.584 | 0.639 | +15/−2 | 0 |

- **Declared sensitivity, cases outside the 998-case pilot:** 8 of 13 supported. paper-score-counterfactual has no
  non-pilot cases, and every other verdict is unchanged. The ΔBAs are within 0.01 of the full-cohort values (code
  +0.140, email +0.136).

## 5. H2 and H3 (confirmatory)

**H2: the gain where the payload is not at the end. Verdict SUPPORTED at 256/256, and also at 128/128.**

| Member | 256/256 ΔBA (Holm p) | 128/128 ΔBA (Holm p) |
|---|---|---|
| longpi-paper-abstract (payload at the start) | +0.162 (3×10⁻¹⁰) ✔ | +0.251 (3×10⁻¹⁷) ✔ |
| longpi-paper-method (middle) | +0.202 (2×10⁻¹⁷) ✔ | +0.294 (2×10⁻²⁵) ✔ |
| longpi-email-llmail @ attachment_middle | +0.096 (0.0018) ✔ | +0.172 (2×10⁻⁶) ✔ |
| longpi-subtle-paper-mixed | +0.103 (3×10⁻⁶) ✔ | +0.157 (10⁻⁸) ✔ |
| longpi-subtle-code-mixed | +0.058 (0.0016) ✔ | +0.047 (0.041) ✔ |
| longpi-subtle-resume-mixed | +0.029 (0.065) ✘ | +0.055 (0.0047) ✔ |

All three non-end members are supported, which is the declared criterion. Strict gives the same verdicts. The end
contrast within `longpi-email-llmail-mixed` (TPR):

| Position | Full | 256/256 | 128/128 |
|---|---:|---:|---:|
| email_in_end | 0.100 | 0.320 | 0.470 |
| attachment_middle | 0.253 | 0.444 | 0.596 |
| attachment_end | 0.575 | 0.681 | 0.766 |

There were 0 false alarms on the 100 clean emails at either size.

**H3: false-alarm non-inferiority with a 2-point margin. NOT non-inferior.**

| Population | Benign | FPR full → windows | +added/−removed | Δ (95% Newcombe) | Upper < 0.02 |
|---|---:|---|---|---|---|
| **Pooled, 14 cohorts, 256/256 (primary)** | 1,697 | 0.064 → 0.079 | +43/−17 | +0.015 (0.006, 0.025) | **no** |
| longpi-authorized-benign, 256/256 | 381 | 0.003 → 0.011 | +4/−1 | +0.008 (−0.006, 0.024) | no (inconclusive) |
| Not-pilot sensitivity, 256/256 | 1,500 | 0.072 → 0.089 | +42/−17 | +0.017 (0.007, 0.027) | no |
| 128/128 on the H2 cohorts (secondary) | 399 | 0.000 → 0.030 | +12/−0 | +0.030 (0.014, 0.052) | no |

The strict policy gives the same verdicts (pooled +0.014, CI 0.005–0.023).

Per cohort at 256/256, BrowseSafe adds 34 false alarms and removes 16 (FPR 0.535→0.625). Every other cohort adds at
most 1, except authorized-benign, which adds 4. **Exploratory, chosen after seeing the data:** without BrowseSafe the
pooled FPR is 0.001→0.006, Δ +0.005 (CI 0.001–0.011). That would pass the margin, but the lower bound is still above
zero. At 128/128 the false alarms come from subtle code (+9, FPR 0.09) and subtle paper (+3).

## 6. Payload position and which window fires (exploratory)

**Full-text recall depends on position.** The same papers are caught 0.378 of the time with the payload in the
conclusion, 0.223 in the abstract and 0.175 in the method section. Windows close part of that gap. At 256/256 the
rates are 0.482, 0.385 and 0.377; at 128/128, abstract 0.474 and method 0.469.

**Which window fires on window-only detections.**

| Cohort | Window-only detections | Only the last window fired | Last window did not fire | Median relative index of first firing window |
|---|---:|---:|---:|---:|
| longpi-paper (end) | 40 | 38 | 2 | 1.00 |
| longpi-code (end) | 91 | 83 | 6 | 1.00 |
| longpi-email (end) | 90 | 90 | 0 | 1.00 |
| longpi-paper-abstract | 52 | 0 | 52 | 0.06 |
| longpi-paper-method | 59 | 0 | 59 | 0.53 |
| longpi-email-llmail-mixed | 65 | 18 | 47 | 0.40 |
| longpi-subtle-paper-mixed | 25 | 11 | 14 | 0.73 |

So the confound was real for the default LongPIBench cohorts: almost every gain there comes from the short last
window. But the mechanism is not specific to the end. When the payload is at the start or in the middle, the window
that holds it fires.

**Other strata.**

- **TriviaQA by insertion position (TPR, full → 256/256):**
  - start 0.007 → 0.034 (+9/−1);
  - middle 0.023 → 0.077 (+20/−4);
  - end 0.397 → 0.187 (+13/−76).

  At the end of a QA passage, Flash flags the payload with the passage in view but often not in the closing window,
  which mostly holds the payload. This is the O46 "less context, less concern" pattern, which earlier appeared only
  for autoregressive judges.
- **Subtle paper by section (256/256):** gains in the conclusion (0.15→0.70), related work (0→0.50) and abstract
  (0→0.26). Still 0 in the intro and `dl` sections.
- **Subtle code:** after_end 0.31→0.51, description_end 0→0.16; middle and top gain little.
- **Subtle résumé:** small gains everywhere, none significant.
- **BrowseSafe by length stratum:** recall rises on the two longest strata (0.70–0.73 → 0.90–0.95). So do false
  alarms (+12 to +13 each).

## 7. Cascade, abstention policy and cost (exploratory)

- **Cascade (full text, then windows when full text does not flag).** It adds a few detections over windows alone on
  every cohort:
  - LongPI paper 0.736→0.751;
  - email 0.975→0.985;
  - TriviaQA 0.548→0.593, recovering the 81 window losses. It is still only +0.022 over full text.
  - It inherits BrowseSafe's false alarms (cascade BA 0.605, below full text).

  It costs 1.6–4.4× full text at 256/256 and 3.0–7.0× at 128/128.
- **Abstention policy.**
  - The window-level abstention rate is 0.1–0.7%, against 0.5–3% of cases at full text.
  - Under strict, one invalid window abstains the whole case: up to 24/400 papers at 256/256 and 24/300 at 128/128,
    more than full text abstains (2–9).
  - Ignore-invalid leaves 1 abstention in all window cells.
  - The confirmatory verdicts do not depend on the policy.
- **Latency.**

  | Input | Mean HTTP time | Median | p95 | Calls per hour |
  |---|---:|---:|---:|---:|
  | full text | 654 ms | 414 ms | 1,986 ms | 5,497 |
  | 256-word window | 381 ms | 372 ms | 512 ms | 9,411 |
  | 128-word window | 339 ms | 333 ms | 433 ms | 10,579 |

  Per case, windows cost 1.3–3.5× full text at 256/256 and 2.2–6.2× at 128/128. A LongPI paper takes about 6–7 s at
  256/256, against about 3 s client time for one Gemma26 full-text call (O61).

## 8. Against Gemma26 and Qwen3.8 on identical cases (exploratory)

Flash with windows does not reach either reference on any window cohort.

| Cohort | Gemma26 | Qwen3.8 | Flash full | Flash 256 | Flash 128 |
|---|---:|---:|---:|---:|---:|
| longpi-code | 0.962 | 0.955 | 0.750 | 0.888 | – |
| longpi-email | 1.000 | 1.000 | 0.832 | 0.975 | – |
| longpi-paper-abstract | 1.000 | 1.000 | 0.223 | 0.403 | 0.490 |
| longpi-paper-method | 0.986 | 0.870 | 0.175 | 0.390 | 0.480 |
| longpi-email-llmail-mixed | 0.988 | 0.978 | 0.652 | 0.741 | 0.804 |
| longpi-subtle-paper-mixed | 0.849 | 0.905 | 0.513 | 0.612 | 0.664 |
| inj-triviaqa-mixed | 0.964 | 0.761 | 0.571 | 0.548 | – |

The closest are long email (15 vs 0 discordant, p = 6×10⁻⁵) and long code (51 vs 9 against Gemma26). Pooled over the
14 window cohorts at 256/256, the discordant counts are 1,893 vs 86 against Gemma26 and 1,493 vs 129 against Qwen3.8.
On the 6 H2 cohorts at 128/128 they are 589 vs 11 and 553 vs 14. The only cohort where Flash leads is
longpi-authorized-benign: FPR 0.003–0.011 against 0.047 and 0.034 (18 vs 4 discordant against Gemma26).

## 9. Caveats

- **Synthetic long documents.** 11 of 14 window cohorts are LongPIBench-derived, built from about 100 source documents
  per domain with templated payloads. The two independent long cohorts disagree with them: BrowseSafe adds false
  alarms, and TriviaQA loses detections.
- **Not fresh cases.** The sweep's §8 asked for cases disjoint from the pilot. This run used the full suites and
  declared a not-pilot sensitivity analysis instead. It agrees, but the default LongPIBench cohorts share source
  documents with the pilot cases.
- **A protocol difference, not only a model difference.** Flash has no reasoning pass and uses prompt-only JSON with a
  128-token output, and it runs as MLX 4-bit on the user's server. The 7 Q8 rows reason first, use a strict schema,
  and run as GGUF Q8_0 in LM Studio. One quant, one decoder setting.
- **H3's margin is tight for small cohorts.** The per-cohort CIs (±0.04 at 100 clean documents) cannot show
  non-inferiority alone. The pooled test is dominated by BrowseSafe, which has the most benign cases and the highest
  baseline FPR.
- **128/128 ran only on the H2 cohorts.** This was the declared fallback for budget. H1 and H3 at 128/128 are
  therefore not tested on the default end-position cohorts.
- **Analysis code.** `analyze-flash.ts` was written while the run was in progress. It implements `plan.json`'s
  families and criteria. The BrowseSafe-excluded H3 line was added after the results were seen and is labelled
  exploratory.

## 10. Artifacts

- Plan: [`llada-flash-full-plan-2026-10.md`](llada-flash-full-plan-2026-10.md),
  [`plan.json`](../analysis/llada-flash-full-2026-10/plan.json) (commit `f122c8d`).
- Suites: `evals/suites/prompt-injection-openai-compat-llada22-flash-baseline-v1.json` and `…-extension-v1.json`.
- Scripts, queue, logs and aggregate results: [`evals/analysis/llada-flash-full-2026-10/`](../analysis/llada-flash-full-2026-10/README.md):
  - `results/flash-full-results.json`;
  - `results/tables.md`;
  - `PROVENANCE.tsv` rows.
- Checkpoints (git-ignored): `evals/runs/prompt-injection-openai-compat-llada22-flash-{baseline,extension}-v1/`.
  Logs are in `evals/runs/llada-flash-full-2026-10-19/`.
- FINDINGS O63 (with notes on O61, O62 and F10), and research log L155.
