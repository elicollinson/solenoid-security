# Qwen3.8 reasoning-effort ablation and Muse threshold fit (2026-10-20/21)

Tracking issue: [#33](https://github.com/elicollinson/solenoid-security/issues/33). Pre-registration:
[`qwen38-effort-ablation-plan-2026-10.md`](qwen38-effort-ablation-plan-2026-10.md), commit `7091f85`, pushed before
the main run. `FINDINGS.md` O65 (effort) and O66 (Muse threshold). Research log L157. Scripts and aggregates:
[`evals/analysis/qwen38-effort-ablation-2026-10/`](../analysis/qwen38-effort-ablation-2026-10/)
([`ablation-results.json`](../analysis/qwen38-effort-ablation-2026-10/results/ablation-results.json),
[`muse-threshold.json`](../analysis/qwen38-effort-ablation-2026-10/results/muse-threshold.json),
[`comparators.json`](../analysis/qwen38-effort-ablation-2026-10/results/comparators.json)).

## Summary

- **Setting the effort works through the existing field.** LM Studio 0.4.25 forwards `reasoning_effort` `"xhigh"`,
  `"medium"` and `"low"` on `/api/v0` to Qwen3.8's GGUF template. Only the undeclared `"high"` that we sent was dropped,
  so the template default (`xhigh`) applied. `prompt_tokens` relative to the frozen runs was −38 at medium on
  1,606/1,606 cases and −12 at low on 1,606/1,606. "xhigh without its instruction" renders the same tokens as medium,
  and its output was byte-identical in the probe, so it is the medium arm.
- **H1 supported: removing the xhigh instruction raises BA at 0.5.** Primary test, medium vs xhigh on the 8 QA, BIPIA
  and email tests: 112 vs 25 discordant cases, exact McNemar p = 2.4×10⁻¹⁴, ΔBA +0.054 [+0.040, +0.069]. Low is larger
  still: all 10 tests 149 vs 18, ΔBA +0.069 [+0.056, +0.082], and low beats medium (77 vs 29, p = 3.5×10⁻⁶, ΔBA
  +0.029).
- **H2 partly supported.** The QA gap that O55 called "recognition" was mostly the instruction. QA AUROC rose from
  0.821 to 0.950 (medium) and 0.954 (low). The share of QA attacks scored exactly 0 fell from 36% to 10% and 9%. BIPIA
  AUROC did not move at medium (−0.001 [−0.024, +0.023]) and rose slightly at low (+0.028). Scores remain graded, and
  the best threshold is still near 0 in every arm.
- **H3: low is cheaper; medium is not.** Low used 22% fewer reasoning tokens and 18% less wall time than xhigh.
  Medium used 4% more reasoning tokens and about the same wall time.
- **The cost is benign false alarms.** On NotInject (150 benign), false alarms at 0.5 went from 1 (xhigh) to 5 (medium)
  and 7 (low). Holm-adjusted, this is not significant (p = 0.375 and 0.125), but both ΔBA intervals exclude 0.
- **Muse (offline).** O55's method picks a threshold of 0.10 on the 21 baseline datasets. Applied to the 14 extension
  datasets, it lifts BA from 0.904 to 0.922, a gain of +0.018 [+0.013, +0.024]; excluding web the gain is +0.033.
  On web, BA falls from 0.765 to 0.588, because benign pages flagged go from 44 to 151 of 200.

**Recommended library-profile values (for PR #34; that branch is not edited here):**

| Model | Effort | Threshold |
|---|---|---|
| Qwen3.8 27B | `reasoning_effort: "low"`. Send only `xhigh`/`medium`/`low`; never `"high"` | **0.15** for non-web content (provisional); **0.5** for web pages |
| Muse Glimmer 30B | template default (`reasoning_strength: high`; not varied) | **0.10** for non-web content; **0.5** for web pages |

For Qwen3.8, the pre-registered rule fits **0.02** on the subset's baseline-suite tests. That fit is low-n, the subset
has no web cohort, and 0.02 flags 20/150 NotInject cases. The 0.15 entry is the more conservative O55 value. At low
effort it gives all-10 BA 0.893 (vs 0.870 at 0.5) with 12/150 NotInject false alarms. A full-suite run at low effort
is needed before any threshold below 0.5 is used on web content.

## 1. Step 0: the effort mechanism

The probe ran on the Studio with the frozen Q8_0 file (LM Studio 0.4.25 build 1). It made 6 loads and 33 synthetic
requests, using the frozen score-only system prompt plus a two-line made-up meeting note. Full results are in
[`probe-results.ndjson`](../analysis/qwen38-effort-ablation-2026-10/probe/probe-results.ndjson).

| Mechanism | `prompt_tokens` | Result |
|---|---|---|
| `/api/v0` `reasoning_effort: "high"` (frozen) | 136 | xhigh default. The full 4096-token completion is byte-identical to explicit `"xhigh"` |
| `reasoning_effort: "medium"` (`/api/v0`, `/v1`) | 98 (−38) | medium |
| `reasoning_effort: "low"` | 124 (−12) | low |
| `/api/v1/chat` `reasoning: "low"/"medium"/"high"` | 124 / 98 / HTTP 400 | native API rejects `"high"`: "Supported settings: off, low, medium, xhigh, on" |
| `/v1/responses` `reasoning.effort` | 98 / 124 | works |
| `chat_template_kwargs` in the body; `/v1` `reasoning: {effort}` | 136 | ignored |
| load-time `llamaCppArgumentsOverride --chat-template-kwargs` | 136 | accepted in the load config, ignored |
| load-time `promptTemplate`, official template with the xhigh instruction blanked | 98 | full completion byte-identical to medium |

`/v1` rejects an arbitrary string (`"bogus"` → HTTP 400 listing `none, minimal, low, medium, high, xhigh`). It accepts
`"high"`, the generic OpenAI value, and passes nothing to the template. That is how the frozen runs came to use xhigh.

## 2. Design and run

- **Arms.** The frozen Qwen3.8 engine copied exactly, varying only `reasoning_effort`. Engine IDs:
  `…-native-v0-effort-{xhigh,medium,low}-v1`; the mechanism is recorded in `parameters.effort_mechanism`.
- **xhigh arm.** The frozen baseline and extension checkpoints, restricted to the same case IDs. A drift re-run of 100
  of those cases at explicit `xhigh` tests it.
- **Cohorts.** 10 tests, 1,606 cases per arm. Seeded fixed-quota subsets (seed `qwen38-effort-ablation-2026-10-v1`):
  - QA: SQuAD and TriviaQA, 120/80 each;
  - BIPIA: table and code 120/80, email 78/78;
  - email: LLMail pool 150 attacks, attempt-detection 150 attacks, LongPI LLMail email 75/25;
  - controls: LongPI subtle paper 60/40 and NotInject 150 benign.
- **Run.** 2026-10-20 21:03:55 to 2026-10-21 02:11:52 UTC (5 h 08 min, under the 8 h cap). 3,312 calls, strictly
  serial, 0 transport or provenance errors. One queue halt came from a bug in the progress script, not a stopping rule
  (see Deviations).
- **Drift gate (passed).** `prompt_tokens` equal on 100/100, outcome agreement 100/100, identical scores 99/100,
  identical final answers 98/100, identical reasoning-token counts 97/100.
- **Mechanism gates (passed).** −38 on 10/10 (medium) and −12 on 10/10 (low). Over the full arms: 1,606/1,606 and
  1,606/1,606.
- **Abstentions.** All were length abstentions (4,096 reasoning tokens): xhigh 1, medium 3 (all BIPIA table attacks),
  low 5 (4 BIPIA table, 1 BIPIA email). The primary test is unchanged when abstentions are counted as errors
  (p = 2.4×10⁻¹⁴, ΔBA +0.054).

## 3. Results

### BA at 0.5 by dataset (identical cases)

| Test (attacks/benign) | xhigh (frozen) | medium | low | Qwen3.6 35B-A3B | Gemma26 |
|---|---|---|---|---|---|
| SQuAD (120/80) | 0.725 | 0.800 | 0.804 | | |
| TriviaQA (120/80) | 0.750 | 0.833 | 0.850 | | |
| BIPIA table (120/80) | 0.604 | 0.645 | 0.672 | | |
| BIPIA code (120/80) | 0.879 | 0.929 | 0.950 | | |
| BIPIA email (78/78) | 0.622 | 0.654 | 0.701 | | |
| LLMail pool (150/0) | 0.787 | 0.867 | 0.940 | | |
| Attempt detection (150/0) | 0.800 | 0.880 | 0.940 | | |
| LongPI LLMail email (75/25) | 0.973 | 0.967 | 0.987 | | |
| LongPI subtle paper (60/40), control | 0.867 | 0.867 | 0.900 | | |
| NotInject (0/150), control | 0.993 | 0.967 | 0.953 | | |
| **QA group** | 0.738 | 0.817 | 0.827 | 0.929 | 0.948 |
| **BIPIA group** | 0.702 | 0.743 | 0.775 | 0.814 | 0.893 |
| **email group** | 0.853 | 0.904 | 0.956 | 0.844 | 0.942 |
| **All 10** | **0.800** | **0.841** | **0.870** | 0.865 | 0.915 |

The comparator columns are the frozen runs on the same case IDs, for context only. Group BA is the mean of dataset BAs.

### Pre-registered tests (exact McNemar vs xhigh; ΔBA with 95% paired bootstrap)

| Comparison | n | arm right / xhigh right | p | p (Holm, 10) | ΔBA | ΔAUROC |
|---|---|---|---|---|---|---|
| **Primary: medium, QA+BIPIA+email** | 1,353 | 112 / 25 | 2.4×10⁻¹⁴ | — | **+0.054 [+0.040, +0.069]** | +0.043 [+0.028, +0.059] |
| medium, QA | 400 | 42 / 4 | 5.1×10⁻⁹ | 3.6×10⁻⁸ | +0.079 [+0.054, +0.104] | +0.129 [+0.098, +0.158] |
| medium, BIPIA | 553 | 37 / 11 | 2.2×10⁻⁴ | 0.0013 | +0.040 [+0.018, +0.062] | −0.001 [−0.024, +0.023] |
| medium, email | 400 | 33 / 10 | 6.1×10⁻⁴ | 0.0030 | +0.051 [+0.022, +0.080] | 0 (single mixed set at 1.0) |
| medium, long-doc control | 100 | 4 / 4 | 1 | 1 | 0.000 [−0.042, +0.050] | +0.008 |
| medium, NotInject control | 149 | 0 / 4 | 0.125 | 0.375 | −0.027 [−0.054, −0.007] | — |
| low, QA | 400 | 46 / 3 | 7.0×10⁻¹¹ | 6.3×10⁻¹⁰ | +0.090 [+0.063, +0.115] | +0.133 [+0.104, +0.163] |
| low, BIPIA | 551 | 50 / 6 | 1.0×10⁻⁹ | 8.2×10⁻⁹ | +0.071 [+0.050, +0.094] | +0.028 [+0.004, +0.052] |
| low, email | 400 | 47 / 1 | 3.5×10⁻¹³ | 3.5×10⁻¹² | +0.102 [+0.076, +0.131] | 0 |
| low, long-doc control | 100 | 6 / 2 | 0.29 | 0.58 | +0.033 [−0.008, +0.083] | +0.017 |
| low, NotInject control | 149 | 0 / 6 | 0.031 | 0.125 | −0.040 [−0.074, −0.013] | — |
| all 10, medium | 1,602 | 116 / 33 | 5.0×10⁻¹² | (not in family) | +0.041 [+0.028, +0.053] | +0.038 |
| all 10, low | 1,600 | 149 / 18 | 7.5×10⁻²⁷ | (not in family) | +0.069 [+0.056, +0.082] | +0.053 |
| low vs medium, all 10 | 1,602 | 77 / 29 | 3.5×10⁻⁶ | (not in family) | +0.029 [+0.018, +0.040] | |

### Calibration (H2)

| Group | Arm | mean AUROC | attacks = 0 | attacks in (0, 0.5] | oracle BA − BA@0.5 |
|---|---|---|---|---|---|
| QA | xhigh / medium / low | 0.821 / 0.950 / 0.954 | 36% / 10% / 9% | 17% / 27% / 25% | 0.083 / 0.133 / 0.127 |
| BIPIA | xhigh / medium / low | 0.849 / 0.849 / 0.876 | 29% / 28% / 24% | 28% / 21% / 19% | 0.145 / 0.095 / 0.094 |
| Target (8 tests) | xhigh / medium / low | 0.865 / 0.908 / 0.923 | 20% / 13% / 11% | 20% / 18% / 15% | 0.123 / 0.101 / 0.083 |

- **QA.** At xhigh, the zeros are where recognition fails. Removing the instruction turns most of them into graded
  nonzero scores (AUROC +0.13). On these cases Qwen3.8 at medium or low now ranks QA attacks above Qwen3.6 35B-A3B
  (QA AUROC 0.933), but it still scores many of them below 0.5.
- **BIPIA.** At medium the gain comes from scores moving across 0.5 without any change in ranking. Table attacks still
  score exactly 0 in 52–57% of cases in every arm. That gap is recognition, and it is shared with every model (O55, O56).
- **Thresholds.** In every arm the best threshold is 0–0.02. The model remains under-calibrated at 0.5. In the
  pre-registered out-of-sample check (fit on the subset's three baseline-suite tests, applied to the seven extension
  tests), the fitted thresholds and extension BA were:

  | Arm | Fitted threshold | Extension BA @0.5 → @t |
  |---|---|---|
  | xhigh | 0.02 | 0.798 → 0.901 |
  | medium | 0.08 | 0.844 → 0.904 |
  | low | 0.02 | 0.872 → 0.934 |

  At 0.15 the all-10 BA is 0.847, 0.878 and 0.893.

### Cost (H3; paired Wilcoxon vs xhigh)

| Arm | median reasoning tokens (xhigh 212) | mean ratio | total wall ratio | p (reasoning) |
|---|---|---|---|---|
| medium | 256 | 1.04 | 1.01 | 1.1×10⁻⁹ |
| low | 180 | 0.78 | 0.82 | 4.8×10⁻⁵⁹ |

Medium reasons longer on email (median 362 vs 266) and long docs, and shorter on NotInject. Low is shorter in every
group. The run took 2.55 h at medium and 2.06 h at low.

## 4. Muse threshold fit (offline, O55 method)

| | Threshold | Baseline BA @0.5 → @t | Extension BA @0.5 → @t | Gain [95% CI] | Gain excluding web | Extension in-sample oracle |
|---|---|---|---|---|---|---|
| Muse Glimmer 30B | 0.10 | 0.903 → 0.907 | **0.904 → 0.922** | +0.018 [+0.013, +0.024] | +0.033 [+0.028, +0.038] | 0.929 (t = 0.08) |
| Qwen3.8 (check vs O55) | 0.15 | 0.895 → 0.906 | 0.865 → 0.891 | +0.026 [+0.021, +0.031] | +0.032 | 0.904 |

Muse extension groups, BA at 0.5 → 0.10:

| Group | BA @0.5 → @0.10 | Note |
|---|---|---|
| QA | 0.815 → 0.912 | |
| BIPIA | 0.839 → 0.907 | |
| email | 0.943 → 0.990 | |
| long docs | 0.929 → 0.939 | benign flagged 16 → 49 of 784 |
| agent | 1.000 → 1.000 | |
| code | 1.000 → 1.000 | |
| web | **0.765 → 0.588** | benign pages flagged 44 → 151 of 200 |

Muse's mean AUROC over the 11 mixed extension datasets is 0.978. Its baseline BA curve is flat from 0.10 to 0.20
(0.905–0.907), so the exact value is not sharply identified; across that range extension BA is 0.915–0.922. Muse's
template injects "Reasoning strength: high." (O54). That setting was not varied.

## 5. Caveats

- **Subsets.** These are seeded subsets of 10 tests, 1,606 cases. There is no web cohort, the setting where lowering
  the threshold hurts (O55, Muse here), and no agent, code or obfuscated cohort.
- **The xhigh arm is frozen.** Its outputs date from 2026-10-07 and 10-13. The drift check reproduced them (100/100
  outcomes), and LM Studio was the same version (0.4.25 build 1).
- **Group weights.** Group BA uses equal dataset weights. Email includes two attack-only sets, where BA is just TPR.
- **Benign controls.** Only NotInject. Its false-alarm increase (1 → 5 → 7 of 150) is directionally consistent across
  both arms but not significant after Holm.
- **Low-n threshold fits.** The fits within arms use three baseline-suite tests, two of them single-class.

## 6. Deviations

1. The queue halted once, at 22:05:40 UTC. `cell.ts` required a checkpoint's `complete` marker, which a cell that
   finishes with abstentions does not write. The fix accepts finished abstentions, and the queue resumed at the same
   CELL step 47 s later. No data was affected.
2. The Muse fit uses each model's own scores as threshold candidates, where O55 used the union. The Qwen3.8 check
   reproduces O55 exactly.

## 7. What changes

- **O54 and Appendix B.** The mechanism is now known: LM Studio does forward `reasoning_effort` for the values a
  template declares. Our `"high"` was simply not one of them.
- **O55.** Qwen3.8's QA "recognition gap" is mostly an artifact of the xhigh instruction. Most of the calibration gap
  remains at every effort.
- **O60.** Muse now has a threshold chosen out of sample (O66).
- **Reported numbers.** No reported baseline or extension number changes. The frozen runs remain "Qwen3.8 at xhigh
  with the instruction". A full-suite rerun at `low` would be needed to replace them. The frozen Qwen3.8 runs took 25.2 h of
  request time (12.95 h baseline, 12.25 h extension). At low's 0.82× wall ratio, a rerun would take about 21 h.
