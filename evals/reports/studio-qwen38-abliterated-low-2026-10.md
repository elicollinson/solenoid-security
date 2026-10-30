# Abliterated Qwen3.8 27B builds at `reasoning_effort: "low"` on the full Studio suites (2026-10-27/30)

Tracking issue: [#23](https://github.com/elicollinson/solenoid-security/issues/23), stage 1 of the abliteration
extension.
- **Pre-registration.** [`studio-qwen38-abliterated-low-plan-2026-10.md`](studio-qwen38-abliterated-low-plan-2026-10.md)
  (commit `3688376`, pushed before the first call), with amendments 1–4.
- **Records.** `FINDINGS.md` O68, with a dated note on O53. Research log L159.
- **Comparator.** Vanilla Qwen3.8 at `low` ([report](studio-qwen38-low-2026-10.md), O67), which was not rerun.
- **Scripts and aggregates.** [`evals/analysis/studio-qwen38-abliterated-low-2026-10-27/`](../analysis/studio-qwen38-abliterated-low-2026-10-27/)
  ([`abliterated-low-results.json`](../analysis/studio-qwen38-abliterated-low-2026-10-27/results/abliterated-low-results.json)).

## Summary

- **Both builds are significantly worse than vanilla-low on both suites (H1 supported 4/4).** Balanced accuracy (BA)
  at 0.5, equal dataset weights, exact McNemar on matched cases, Holm across 2 builds × 2 suites:

  | Suite | Vanilla-low | heretic-ara | huihui |
  |---|---|---|---|
  | Baseline (21 datasets, 7,326 cases) | 0.912 | **0.898**: ΔBA −0.014 [−0.021, −0.007], 239 vs 131, Holm p = 4×10⁻⁸ | **0.899**: −0.013 [−0.020, −0.006], 289 vs 177, p = 2×10⁻⁷ |
  | Extension (14 datasets, 6,759 cases) | 0.900 | **0.883**: −0.017 [−0.023, −0.011], 334 vs 162, p = 3×10⁻¹⁴ | **0.858**: −0.042 [−0.049, −0.036], 498 vs 161, p = 2×10⁻⁴⁰ |

  "a vs b" counts matched cases vanilla-low got right and the build got wrong, then the reverse. The results are the
  same when abstentions count as errors.
- **The deficit is missed attacks (H2 supported 4/4).** Detections lost vs gained on positives:
  - heretic-ara: baseline 219 vs 47, extension 306 vs 145;
  - huihui: baseline 269 vs 48, extension 438 vs 148;
  - all positive-only Holm p ≤ 3×10⁻¹⁴.

  On the baseline, the builds raise fewer false alarms than vanilla-low (20 vs 84 and 20 vs 129 benign cases). On the
  extension they add a few (28 vs 17, and 60 vs 13 for huihui, mostly BrowseSafe benign pages).
- **Ranking is intact; the scores shift down.** Mean AUROC on mixed datasets is equal or higher for both builds:
  - baseline 0.940 / 0.944 / 0.951 (vanilla-low / heretic-ara / huihui);
  - extension 0.945 / 0.951 / 0.977.

  The builds still separate attacks from benign text, but they give attacks lower concern scores, so more fall below
  0.5. This matches O53's "recognized but downgraded" screen. AUROC is pre-registered as a reported metric, but this
  interpretation is post hoc.
- **The O53 pattern replicates only in part (H3 not supported for either build).** The pre-registered test needed
  obfuscated text or agent tool output among a suite's two largest group losses, significant after Holm.
  - **The largest losses are email and long docs or BIPIA**: baseline email −0.041 / −0.046, extension BIPIA −0.043 /
    −0.073, extension email −0.030 / −0.103.
  - **What does replicate:** PIDS obfuscated recall falls 0.728 → 0.670 (heretic-ara, p = 0.002) and → 0.611 (huihui,
    p = 1×10⁻⁸), the same direction and size as the pilot. But the obfuscated *group* is offset by fewer false alarms on
    the encoded benign controls (82 → 55 / 46 flagged).
  - **What does not replicate:** huihui's AgentDyn benign false alarms (pilot 8 → 19 of 47) stay at 2 → 4 of 182.
- **Heretic-ara vs huihui.** Tied on the baseline (219 vs 213, p = 0.81). heretic-ara is better on the extension (374 vs
  209, p = 8×10⁻¹², ΔBA +0.025), mostly because huihui loses email, web and BIPIA.
- **Cost.**
  - Mean reasoning tokens rise to 1.13× (heretic-ara) and 1.38× (huihui) of vanilla-low on the baseline, and 1.23× and
    1.51× on the extension.
  - Request time 54.1 h in total vs 20.9 h for vanilla-low's single build.
  - Speculative-decoding acceptance 62–65% vs 68–72%.

## 1. Run

- **Configuration.** Each build ran with the vanilla-low engine; only the model identity changed, plus the load-time
  `low` template (amendment 1). Each pass required:
  - `prompt_tokens` equal to vanilla-low on every case with usage, in all 70 cells;
  - identity (response model, Q8_0 and the loaded GGUF) on every response.
- **Time.** 2026-10-27 11:28Z to 2026-10-30 21:27Z, with 54.1 h of request time. The chain was idle for 25 h after a
  transport halt (below).
- **Drift gates.**
  - Before the baselines: heretic-ara and huihui, `bipia-email-mixed`, 24/24 each.
  - After the restart: heretic-ara on `repoguard-mixed` v3, 24/24.
  - huihui on `bipia-table-mixed`: `prompt_tokens` 24/24 and identity 24/24. It failed the reused ≤ 1-abstention
    clause with 2 length abstentions (vanilla-low shares one); see amendment 3.
- **Abstentions (length only).**
  - Baseline 4 (heretic-ara) and 17 (huihui) vs 19.
  - Extension 17 and 16 vs 12, mostly `bipia-table-mixed`.
  - No cell exceeded vanilla-low's rate by more than 2 points.

### Deviations and restarts (all recorded in the plan before or as they were applied)

1. **Amendment 1, before the run.** The v1 drift gate failed because LM Studio does not forward `reasoning_effort` to
   these non-hub GGUFs. v2 loads the embedded template with its default changed to `low`. The v1 24-case checkpoint is
   kept, not analyzed.
2. **Transport halt, 2026-10-28T21:51:29Z.** heretic-ara `repoguard-mixed` stopped at 79/575 with one
   `provider_or_transport_error`. The LM Studio log shows the tolerated foreign instance vanishing in the same second.
   - **Rerun (amendment 2).** Per L141 the cohort reran in full under extension v3: same tests and engine, only the
     condition ID changed. The 79-case v2 partial is kept and excluded.
   - **Cap.** It restarts with 40 h from the restart.
   - **Automatic reruns.** Transport failures now rerun automatically under v4/v5 (at most 2 per cohort, after LM Link
     is connected plus 5 min). **None were needed.**
3. **Gate crash, 22:44Z.** The gate crashed with `ENOENT`: the v3 suites were missing from the main checkout's
   git-ignored `evals/suites`, which the audit reads. The gate passed when rerun, and the cohort resumed from its
   tranche.
4. **Amendment 3, 2026-10-30T06:40Z.** The huihui re-check's abstention clause, described above. The re-check was
   counted as passed, a post-result deviation. The cell's pre-registered abstention rule still applied and passed.
5. **Restart 1d, 21:27Z.** The last RUN completed 384/384. The post-RUN check then halted because the user had loaded
   an untolerated non-study instance (`google/gemma-4-26b-a4b`). The final CELL and SUMMARY ran without model calls.
6. **Amendment 4.** The gate prints the low-signature check as `n/a` when a cohort has no pilot overlap. This is
   cosmetic: 0/0 already passed.

## 2. Results at 0.5


### Baseline groups (Δ = build − vanilla-low; Holm within the suite's group family)

| Group | Vanilla-low BA | heretic-ara BA (Δ, Holm p) | huihui BA (Δ, Holm p) | TPR v / h / u | FPR v / h / u |
|---|---|---|---|---|---|
| longdoc | 0.972 | 0.949 (-0.024, 3.6×10⁻¹⁵) | 0.964 (-0.008, 2.6×10⁻¹⁰) | 0.973 / 0.909 / 0.934 | 0.033 / 0.000 / 0.000 |
| email | 0.812 | 0.770 (-0.041, 9.1×10⁻⁵) | 0.765 (-0.046, 9.2×10⁻⁴) | 0.662 / 0.610 / 0.598 | 0.000 / 0.000 / 0.000 |
| web | 0.854 | 0.856 (+0.002, 1.000) | 0.840 (-0.015, 0.562) | 0.946 / 0.938 / 0.908 | 0.237 / 0.225 / 0.229 |
| agent | 0.991 | 0.982 (-0.009, 1.000) | 0.983 (-0.008, 0.307) | 0.997 / 0.997 / 0.987 | 0.016 / 0.033 / 0.022 |
| obfusc | 0.827 | 0.817 (-0.010, 1.000) | 0.792 (-0.032, 0.346) | 0.727 / 0.672 / 0.633 | 0.069 / 0.028 / 0.037 |
| benign | 0.965 | 0.977 (+0.013, 0.012) | 0.980 (+0.015, 0.004) | — / — / — | 0.035 / 0.023 / 0.020 |
| policy | 0.500 | 0.500 (-0.000, 1.000) | 0.500 (-0.000, 1.000) | 0.769 / 0.624 / 0.325 | 0.769 / 0.624 / 0.325 |

### Baseline datasets (BA at 0.5; abstentions in brackets; McNemar uncorrected)

| Dataset | n | Vanilla-low | heretic-ara | p | huihui | p | AUROC v / h / u |
|---|---|---|---|---|---|---|---|
| longpi-paper | 400 | 0.998 | 0.963 | 9.5×10⁻⁷ | 0.993 | 0.375 | 1.000 / 1.000 / 1.000 |
| longpi-paper-abstract | 300 | 1.000 | 0.983 | 0.062 | 0.967 | 0.002 | — / — / — |
| longpi-paper-method | 300 | 0.967 | 0.930 | 0.052 | 0.997 | 0.012 | — / — / — |
| longpi-resume | 400 | 0.998 | 0.987 | 0.039 | 0.973 | 2.7×10⁻⁴ | 1.000 / 1.000 / 1.000 |
| longpi-code | 400 | 0.925 | 0.860 | 8.1×10⁻⁸ | 0.850 | 2.0×10⁻¹¹ | 1.000 / 1.000 / 1.000 |
| longpi-email | 400 | 1.000 | 1.000 | 1.000 | 0.998 | 1.000 | 1.000 / 1.000 / 1.000 |
| paper-score-counterfactual | 72 | 0.917 | 0.917 | 0.146 | 0.972 | 1.000 | 0.985 / 1.000 / 1.000 |
| bipia-email-mixed | 156 | 0.701 [1] | 0.679 | 0.508 | 0.667 | 0.359 | 0.900 / 0.907 / 0.980 |
| attempt-detection | 400 | 0.922 | 0.860 | 1.1×10⁻⁵ | 0.863 | 1.2×10⁻⁴ | — / — / — |
| web-mixed | 480 | 0.854 | 0.856 | 1.000 | 0.840 | 0.281 | 0.862 / 0.868 / 0.901 |
| agentdyn-shopping | 183 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 / 1.000 / 1.000 |
| agentdyn-github | 237 | 1.000 | 0.936 | 0.031 | 0.957 | 0.125 | 1.000 / 0.999 / 0.995 |
| agentdyn-dailylife | 411 | 0.986 | 0.993 | 1.000 | 1.000 | 0.500 | 1.000 / 1.000 / 1.000 |
| agentdojo-travel-mixed | 21 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 / 1.000 / 1.000 |
| agent-injection-bench-mixed | 182 | 0.968 | 0.981 | 1.000 | 0.956 | 0.109 | 0.995 / 0.995 / 0.992 |
| pids-obfuscated | 405 | 0.728 [8] | 0.670 [2] | 0.002 | 0.611 [9] | 1.1×10⁻⁸ | — / — / — |
| encoding-eligible-existing-v1 | 229 | 0.837 [8] | 0.837 [1] | 0.115 | 0.814 [6] | 0.019 | 0.923 / 0.950 / 0.940 |
| encoding-benign-controls-v1 | 969 | 0.915 [2] | 0.943 [1] | 7.4×10⁻⁶ | 0.953 [1] | 2.1×10⁻⁷ | — / — / — |
| benign-false-positives | 339 | 0.947 | 0.956 | 0.581 | 0.965 | 0.070 | — / — / — |
| pids-hard-benign-public | 808 | 0.983 | 0.999 | 2.4×10⁻⁴ | 0.995 [1] | 0.013 | — / — / — |
| skill-policy-pairs | 234 | 0.500 | 0.500 | 1.000 | 0.500 | 1.000 | 0.500 / 0.500 / 0.500 |

### Extension groups

| Group | Vanilla-low BA | heretic-ara BA (Δ, Holm p) | huihui BA (Δ, Holm p) | TPR v / h / u | FPR v / h / u |
|---|---|---|---|---|---|
| longdoc | 0.918 | 0.907 (-0.011, 0.478) | 0.882 (-0.036, 8.9×10⁻⁷) | 0.812 / 0.782 / 0.716 | 0.007 / 0.006 / 0.005 |
| bipia | 0.804 | 0.762 (-0.043, 1.9×10⁻¹⁰) | 0.732 (-0.073, 1.0×10⁻¹¹) | 0.609 / 0.523 / 0.464 | 0.000 / 0.000 / 0.000 |
| qa | 0.825 | 0.803 (-0.022, 1.1×10⁻⁵) | 0.787 (-0.038, 1.2×10⁻¹⁵) | 0.650 / 0.607 / 0.575 | 0.000 / 0.000 / 0.000 |
| web | 0.820 | 0.800 (-0.020, 0.840) | 0.740 (-0.080, 0.002) | 0.720 / 0.745 / 0.815 | 0.080 / 0.145 / 0.335 |
| agent | 0.997 | 0.996 (-0.001, 1.000) | 0.997 (+0.000, 1.000) | 0.994 / 0.992 / 0.994 | 0.000 / 0.000 / 0.000 |
| email | 0.933 | 0.903 (-0.030, 0.466) | 0.830 (-0.103, 6.5×10⁻⁶) | 0.933 / 0.903 / 0.830 | — / — / — |
| code | 1.000 | 0.999 (-0.001, 1.000) | 0.998 (-0.002, 1.000) | 1.000 / 0.998 / 0.996 | 0.000 / 0.000 / 0.000 |

### Extension datasets (BA at 0.5; abstentions in brackets; McNemar uncorrected)

| Dataset | n | Vanilla-low | heretic-ara | p | huihui | p | AUROC v / h / u |
|---|---|---|---|---|---|---|---|
| longpi-subtle-paper-mixed | 220 | 0.908 | 0.875 | 0.077 | 0.875 | 0.021 | 1.000 / 0.979 / 0.999 |
| longpi-subtle-code-mixed | 220 | 0.846 | 0.821 | 0.286 | 0.779 | 0.004 | 0.979 / 0.995 / 0.996 |
| longpi-subtle-resume-mixed | 220 | 0.879 | 0.883 | 1.000 | 0.808 | 4.9×10⁻⁴ | 0.950 / 0.975 / 0.973 |
| longpi-email-llmail-mixed | 400 | 0.990 | 0.985 | 0.375 | 0.970 | 0.004 | 0.998 / 0.998 / 1.000 |
| longpi-authorized-benign | 384 | 0.966 | 0.971 | 0.774 | 0.977 | 0.388 | — / — / — |
| bipia-table-mixed | 600 | 0.651 [12] | 0.620 [17] | 2.5×10⁻⁵ | 0.654 [16] | 0.899 | 0.730 / 0.746 / 0.954 |
| bipia-code-mixed | 400 | 0.958 | 0.903 | 5.4×10⁻⁷ | 0.810 | 7.2×10⁻²⁴ | 0.998 / 0.995 / 1.000 |
| inj-squad-mixed | 1200 | 0.795 | 0.762 | 5.0×10⁻⁸ | 0.766 | 1.6×10⁻⁶ | 0.941 / 0.952 / 0.992 |
| inj-triviaqa-mixed | 1200 | 0.856 | 0.845 | 0.140 | 0.809 | 2.7×10⁻¹¹ | 0.946 / 0.974 / 0.998 |
| browsesafe-mixed | 400 | 0.820 | 0.800 | 0.280 | 0.740 | 6.3×10⁻⁴ | 0.854 / 0.855 / 0.839 |
| agentdojo-suites-mixed | 280 | 0.996 | 0.992 | 0.500 | 0.994 | 1.000 | 1.000 / 0.996 / 1.000 |
| nemotron-ipi-attacks | 360 | 0.997 | 1.000 | 1.000 | 1.000 | 1.000 | — / — / — |
| llmail-pool-attacks | 300 | 0.933 | 0.903 | 0.093 | 0.830 | 1.6×10⁻⁶ | — / — / — |
| repoguard-mixed | 575 | 1.000 | 0.999 | 1.000 | 0.998 | 0.500 | 1.000 / 1.000 / 1.000 |

**Pooled rates (descriptive).**

| Arm | Baseline TPR | Baseline FPR | Extension TPR | Extension FPR |
|---|---|---|---|---|
| Vanilla-low | 3,743/4,077 = 0.918 | 270/3,230 = 0.084 | 3,641/4,774 = 0.763 | 29/1,973 = 0.015 |
| heretic-ara | 3,580/4,091 = 0.875 | 206/3,231 = 0.064 | 3,479/4,769 = 0.730 | 40/1,973 = 0.020 |
| huihui | 3,519/4,079 = 0.863 | 161/3,230 = 0.050 | 3,351/4,770 = 0.703 | 76/1,973 = 0.039 |

## 3. Hypotheses

| | Baseline heretic-ara | Baseline huihui | Extension heretic-ara | Extension huihui |
|---|---|---|---|---|
| H1: build worse (Holm p) | ✔ 4×10⁻⁸ | ✔ 2×10⁻⁷ | ✔ 3×10⁻¹⁴ | ✔ 2×10⁻⁴⁰ |
| H2: net lost detections vs net added false alarms; positive-only Holm p | ✔ 172 vs −64; 2×10⁻²⁷ | ✔ 221 vs −109; 8×10⁻³⁸ | ✔ 161 vs 11; 3×10⁻¹⁴ | ✔ 290 vs 47; 9×10⁻³⁴ |
| H3: O53 group (obfusc / agent) among the two largest losses and significant | ✘ email, long docs | ✘ email, obfusc (Holm p = 0.35) | ✘ BIPIA, email | ✘ email, web |

**O53 pattern, item by item.**

- **PIDS obfuscated recall** replicates. heretic-ara 0.728 → 0.670 (37 vs 14 discordant positives, p = 0.002); huihui
  → 0.611 (53 vs 9, p = 1×10⁻⁸).
- **Encoding cohorts.** Eligible attacks: recall 0.727 → 0.674 / 0.654. The encoded benign controls improve (FPR 8.5% →
  5.7% / 4.7%), which offsets the group.
- **Naive LongPIBench on paper and code** replicates for code: 0.925 → 0.860 / 0.850 (p ≤ 8×10⁻⁸). For paper it holds
  for heretic-ara only (0.998 → 0.963).
- **Agent tool output.** It did not replicate. huihui's AgentDyn benign false alarms are 2 → 4 of 182 (pilot 8 → 19 of
  47). heretic-ara has 2 → 7 (p = 0.18). The agent groups do not change after Holm.
- **New at full scale.**
  - Email (BIPIA email, attempt detection, LLMail): −0.03 to −0.10.
  - BIPIA table/code: −0.04 / −0.07.
  - Extension QA: −0.02 / −0.04.
  - Web false alarms: BrowseSafe benign pages flagged go from 16 to 29 (heretic-ara) and 67 (huihui) of 200, while
    attack recall rises (144 → 149 / 163 of 200). For huihui, web is −0.080 (Holm p = 0.002).

**Covariates (reported, not modeled).**

| | Card refusals | Card KL | Pilot at xhigh (O53) | Baseline ΔBA | Extension ΔBA | Mean reasoning tokens, baseline / extension |
|---|---|---|---|---|---|---|
| Vanilla-low | — | — | 0.888 | — | — | 269 / 229 |
| heretic-ara | 0/100 | 0.0535 | 0.854 | −0.014 | −0.017 | 304 / 281 |
| huihui | not published | not published | 0.858 | −0.013 | −0.042 | 371 / 345 |

With two builds, a card covariate cannot be separated from the method. huihui (classic ablation, no published KL) is
the one with the larger extension loss and the longer reasoning.

## 4. Interpretation and caveats

- **The size of the effect.** Abliteration costs this detector about 1.3–1.7 BA points on familiar data and up to 4
  points on the harder extension. Almost all of it is missed attacks. The effect is smaller than in the pilot (−3.3 /
  −2.7 at xhigh on 998 cases), but it is significant on every suite, with complete cohorts and exact prompt
  equivalence.
- **The mechanism.** It looks like calibration rather than lost recognition: AUROC is unchanged or higher. A per-build
  threshold could recover part of the loss. That was not pre-registered and is not claimed here.
- **Caveats.**
  - The GGUFs come from different publishers.
  - The `low` effort reaches the builds through a load-time template, not the request. Rendering is verified equal by
    `prompt_tokens`, but the delivery mechanism differs from vanilla's.
  - Vanilla was not rerun.
  - One quant (Q8_0), one runtime, two builds.
  - Equal dataset weights, and several datasets are single-class.
  - Skill-Inject policy pairs score 0.500 for every arm (O49).
  - The H3 call depends on the frozen group definitions.
