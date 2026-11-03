# Abliteration extension, stage 2: pilot screen results (2026-11-03)

This is the pre-registered analysis of the stage 2 pilot screen of [#23](https://github.com/elicollinson/solenoid-security/issues/23).
It asks whether O53 (abliterated Qwen3.8 builds detect prompt injection worse than the original) holds across model
families and abliteration methods, and whether the loss tracks the build's reported KL divergence. The plan,
hypotheses, decision rule and every amendment are in the [pre-registered plan](abliteration-stage2-plan-2026-10.md).
Execution is in research-log entry L161, and the finding is FINDINGS O70.

Sources: [`analyze.ts`](../analysis/abliteration-stage2-pilot-2026-10/analyze.ts) writes
[`results/stage2-summary.json`](../analysis/abliteration-stage2-pilot-2026-10/results/stage2-summary.json) (committed)
and the full `stage2-results.json` in the git-ignored run directory. It runs offline. Before computing anything it
re-checks all 81 analyzed cells (9 builds × 9 tests): every pilot case finished, `prompt_tokens` equal to vanilla on
every case, model identity on every response, and input hashes equal to vanilla. All passed. Every per-build number
below matches the chain's own `CELL` and `MODEL_DONE` lines. No inference was run for this analysis.

**Scale.** 998 cases per build on 9 datasets (72–120 per dataset), one Q8_0 quant, LM Studio on one Mac Studio. Four of
the nine datasets are LongPIBench, which uses one fixed attack sentence per template. This is a screen that decides
which builds get a full-suite run (stage 3). It does not replace one.

## Bottom line

- **O53 generalizes under the pre-registered rule.** Six of the seven builds completed under the plan's rules show a
  Holm-significant loss against their own vanilla model, and none shows a significant gain. The rule needed at least
  half. With the two declared-deviation builds added, the count is seven of nine, again with no significant gain.
- **The size of the loss depends mostly on the base model.**
  - Every Gemma 4 build lost a lot: ΔBA −0.055 to −0.226.
  - Muse lost −0.062.
  - Qwen3.6 lost little: −0.028 (huihui, Holm p = 0.028) and −0.017 (Heretic MPOA, not significant).
  - The Qwen3.8 MPOA build (a declared deviation) did not lose at all: +0.015, p = 0.058.
- **The loss is missed attacks.** Among discordant cases, detections lost far outnumber false alarms added in every
  build with a loss (e.g. 238 vs 5 for Gemma 26B ultra). The builds raise *fewer* false alarms on benign text than
  vanilla.
- **KL dose-response holds within Gemma 4 26B.** The stronger ("ultra", card KL 0.124) Heretic build is worse than the
  standard one (KL 0.047): 0.727 vs 0.812, 105 vs 17 discordant, p = 1×10⁻¹⁶.
- **Stage 3 candidates (pre-registered rule):** gemma26-heretic, gemma26-ultra, qwen36-huihui, gemma31-huihui,
  gemma31-heretic and muse-heretic. gemma26-huihui would also qualify, but only through the declared deviation.

## Methods recap

- **Design.** Each build runs the 998 pilot cases of the O53 pilot suite. It is compared with its own vanilla model's
  existing full-suite checkpoint restricted to those case IDs. No vanilla model was rerun.
- **Engine.** Each build's engine is its vanilla engine with only the model identity replaced: score-only prompt,
  temperature 0, 4,096 max tokens, context 65,536, serial. For 8 of 10 builds, a load-time template override
  reproduces the vanilla prompt rendering (plan deviation 1). Every analyzed cell has `prompt_tokens` equal to vanilla
  on every case.
- **Statistics.** Macro BA is the mean of the nine per-dataset BAs at threshold 0.5. Abstentions are excluded from BA
  and from the McNemar pairs, and are reported separately.
  - **H1.** Pooled exact McNemar, vanilla → build, on cases both scored, with Holm across builds at α = 0.05.
  - **H2.** Misses vs false alarms among the discordant cases, plus an exact sign test on positives.
  - **H3.** Exact McNemar gemma26-heretic → gemma26-ultra, plus a descriptive Spearman rank correlation of card KL with
    ΔBA.
  - Per-dataset p-values are uncorrected.

### Builds and their status

| Build | Base | Method (card) | Card KL | Status |
|---|---|---|---:|---|
| gemma26-heretic | Gemma 4 26B-A4B | Heretic v1.2.0, ARA | 0.0468 | completed |
| gemma26-ultra | Gemma 4 26B-A4B | Heretic v1.2.0, ARA | 0.1237 | completed |
| gemma26-huihui | Gemma 4 26B-A4B | classic (huihui) | – | stopped by the abstention rule; **declared-deviation rerun** |
| gemma26-huihui-udq8kxl | Gemma 4 26B-A4B | same huihui weights, UD-Q8_K_XL | – | **dropped by the user before it ran**; never downloaded |
| qwen36-huihui | Qwen3.6 35B-A3B | classic (huihui) | – | completed |
| qwen36-heretic | Qwen3.6 35B-A3B | Heretic v1.2.0, MPOA | 0.0015 | completed |
| qwen38-mpoa | Qwen3.8 27B (`low`) | Heretic v2.0.0.dev0, MPOA | 0.0244 | stopped by the abstention rule after 6 cells; **declared-deviation rerun** of the other 3 |
| gemma31-huihui | Gemma 4 31B-it | classic (huihui), v2 | – | completed |
| gemma31-heretic | Gemma 4 31B-it | Heretic v1.2.0, ARA | 0.0541 | completed |
| muse-heretic | Muse Glimmer 30B | Heretic v1.4.0 (variant not named) | 0.0743 | completed |

## Amendments and deviations

All are in the plan. In order:

1. **Template override** for 8 of 10 builds (plan deviation 1), **run-time identity pin** (deviation 2), and **no
   vanilla drift rerun** (deviation 3). These were written before the run.
2. **2026-10-29: automatic transport reruns.** These are fresh-condition reruns. They were used once: muse-heretic
   longpi-paper ran under `-r2`, and its two failed partials are kept and excluded.
3. **2026-10-30: wait through stage 1 halts that are followed by a restart.**
4. **2026-10-30T21:3xZ: wait for the user's own instances instead of halting.**
5. **2026-10-30T23:1xZ: runner invocation fix.** The exit-127 skip was not a run.
6. **2026-11-01: chain cap raised from 36 h to 60 h** after user-requested pauses.
7. **2026-11-03: robustness arm dropped** by the user's decision. It was never downloaded or run, so the
   quant-scheme question stays open.
8. **2026-11-03T12:4xZ: the wall-clock cap counts per invocation.** Cap skips are not attempts.
9. **2026-11-03T13:1xZ: the local LM Studio API is preflighted before every step.** The two muse failures were
   `TypeError`s with the API server down, and no inference ran in either attempt.
10. **2026-11-03T13:0xZ, before any deviation run: declared-deviation reruns of the two abstention-stopped builds.**
    The abstention rule is report-only for those runs. The other gates stay binding.
11. **2026-11-03 (recorded after the fact, operational): the stage 2 chain was closed with `GIVEUP_S=0`.** After
    muse-heretic finished at 16:02:58Z, the only build left was the dropped robustness arm. The chain would have
    waited until about 18:50–19:00Z for it. It was re-invoked with the give-up wait set to 0. At 16:04:29Z it logged
    `SKIP` (absent) and `DONE`, and the deviation chain started at 16:07:16Z. No inference, gate or data was affected.

    One side effect: that invocation's `CHAIN_START` line reads "stage 1 ended 2026-11-03T16:03:58Z", and its `SKIP`
    line reads "6 h after stage 1 ended". Both reflect the zero wait. Stage 1 actually ended at 2026-10-30T21:27:34Z,
    as the `WAIT` line just before them records.

**How the deviation builds are handled.** The primary family is (a): the seven builds completed under the
pre-registered rules. Family (b) adds the two deviation builds as a sensitivity analysis. Every result that uses a
deviation cell is marked †.

The deviation reruns of the two originally stopped cells reproduced the retained originals exactly. This covers
qwen38-mpoa pids-obfuscated (112 cases) and gemma26-huihui bipia-email-mixed (120 cases). Status, flag, score, final
answer and reasoning-token count were identical on every case. So for these cells, the deviation changes only whether
the build continued, not the outputs.

**Run.** The stage 2 chain ran from 2026-10-30T22:00:40Z to 2026-11-03T16:04:29Z, including user-requested pauses.
The deviation chain ran from 16:07:16Z to 19:27:59Z on 2026-11-03.

## H1: lower BA (primary)

Pooled exact McNemar, vanilla → build, on cases both scored. "Lost" means vanilla was correct and the build was wrong;
"gained" is the reverse. Paired accuracy difference with a 95% Wald CI.

| Build | Vanilla BA | Build BA | ΔBA | Both scored | Lost | Gained | Acc. diff [95% CI] | p | Holm (a), 7 builds | Holm (b), 9 builds |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| gemma26-heretic | 0.953 | 0.812 | −0.141 | 996 | 156 | 10 | −0.147 [−0.170, −0.123] | 7.6×10⁻³⁵ | **3.8×10⁻³⁴** | **5.3×10⁻³⁴** |
| gemma26-ultra | 0.953 | 0.727 | −0.226 | 995 | 243 | 9 | −0.235 [−0.263, −0.208] | 2.8×10⁻⁶⁰ | **2.0×10⁻⁵⁹** | **2.5×10⁻⁵⁹** |
| qwen36-huihui | 0.896 | 0.869 | −0.028 | 996 | 70 | 43 | −0.027 [−0.048, −0.006] | 0.014 | **0.028** | **0.042** |
| qwen36-heretic | 0.896 | 0.879 | −0.017 | 995 | 51 | 35 | −0.016 [−0.034, +0.002] | 0.105 | 0.105 | 0.116 |
| gemma31-huihui | 0.938 | 0.782 | −0.156 | 998 | 177 | 13 | −0.164 [−0.189, −0.139] | 6.1×10⁻³⁸ | **3.7×10⁻³⁷** | **4.9×10⁻³⁷** |
| gemma31-heretic | 0.938 | 0.883 | −0.055 | 997 | 68 | 11 | −0.057 [−0.074, −0.040] | 3.5×10⁻¹¹ | **1.4×10⁻¹⁰** | **1.8×10⁻¹⁰** |
| muse-heretic | 0.893 | 0.831 | −0.062 | 993 | 83 | 19 | −0.065 [−0.084, −0.045] | 1.0×10⁻¹⁰ | **3.1×10⁻¹⁰** | **4.1×10⁻¹⁰** |
| qwen38-mpoa † | 0.897 | 0.912 | +0.015 | 988 | 20 | 35 | +0.015 [+0.001, +0.030] | 0.058 | – | 0.116 |
| gemma26-huihui † | 0.953 | 0.806 | −0.147 | 973 | 154 | 12 | −0.146 [−0.170, −0.122] | 1.4×10⁻³² | – | **8.5×10⁻³²** |

Bold marks Holm p < 0.05. Every significant result is a loss.

- qwen36-huihui is the closest call: Holm 0.028 in family (a) and 0.042 in (b).
- For qwen38-mpoa the Wald CI just excludes 0, but the exact test does not (p = 0.058). The pre-registered test is the
  exact one, so this build shows no significant change in either direction.
- **Abstentions counted as errors** (sensitivity check, not pre-registered): every conclusion is unchanged.
  - gemma26-huihui: 178 vs 12, p = 4×10⁻³⁹.
  - qwen36-huihui: 71 vs 44, p = 0.015.
  - qwen38-mpoa: 27 vs 36, p = 0.31.

## H2: the deficit comes from misses

| Build | Detections lost (misses) | False alarms added | Detections gained | Sign test on positives p | False alarms removed | H2 |
|---|---:|---:|---:|---:|---:|---|
| gemma26-heretic | 153 | 3 | 2 | 5×10⁻⁴³ | 8 | supported |
| gemma26-ultra | 238 | 5 | 1 | 5×10⁻⁷⁰ | 8 | supported |
| qwen36-huihui | 66 | 4 | 41 | 0.020 | 2 | supported |
| qwen36-heretic | 48 | 3 | 31 | 0.071 | 4 | direction only |
| gemma31-huihui | 169 | 8 | 3 | 3×10⁻⁴⁶ | 10 | supported |
| gemma31-heretic | 67 | 1 | 3 | 1×10⁻¹⁶ | 8 | supported |
| muse-heretic | 83 | 0 | 3 | 3×10⁻²¹ | 16 | supported |
| qwen38-mpoa † | 12 | 8 | 25 | 0.047 (more gained) | 10 | not supported (opposite) |
| gemma26-huihui † | 151 | 3 | 2 | 2×10⁻⁴² | 10 | supported |

- H2 is supported for 6 of 7 completed builds. qwen36-heretic has the predicted direction but is not significant.
- Every build with a loss except qwen36-huihui (4 added, 2 removed) also *removed* more false alarms than it added.
  The builds are less suspicious overall: they miss more attacks and flag less benign text.
- **Where the misses fall.** The plan predicted they would concentrate where vanilla is marginal (PIDS obfuscated,
  LongPI naive). That holds only in part:
  - **PIDS obfuscated** is the largest single source of misses in most builds. Detections lost / gained:
    gemma26-heretic 47/1, gemma26-ultra 52/0, gemma26-huihui † 64/1, gemma31-huihui 41/0, qwen36-huihui 48/0,
    qwen36-heretic 33/4 and muse-heretic 25/0. gemma31-heretic loses only 7/0 there.
  - **LongPI naive** loses in every Gemma and Muse build.
  - **Gemma also loses on templates the O53 pilot found robust.** These are authority-spoof
    (gemma26-ultra 17/20 paper, 20/20 code; gemma26-heretic 20/20 code; gemma31-huihui 16/20 code) and combine
    (gemma26-ultra and gemma31-huihui 17–18 on code). Gemma also loses BIPIA email (9–29 lost, 0–2 gained) and the
    score-counterfactual probe's attacks (11–33 lost, 0 gained).
  - **Qwen3.6 is different.** Its misses are almost all on PIDS. Both Qwen3.6 builds *gained* detections on LongPI
    paper (10 and 6 gained) and on the probe (11 and 6).

## H3: KL dose-response (Gemma 4 26B, ARA)

- **Predicted order holds.** Vanilla 0.953 > heretic (KL 0.0468) 0.812 > ultra (KL 0.1237) 0.727. Ultra's net loss
  against vanilla is also larger: lost − gained = 234 vs heretic's 146.
- **Exact McNemar heretic → ultra.** 105 vs 17 discordant of 993 both scored, p = 1.1×10⁻¹⁶. The direction is ultra
  worse, with an accuracy difference of −0.089 [−0.110, −0.068]. Of the 105, 100 are missed attacks.
- **Rank correlation across builds (descriptive only).** Spearman ρ between card KL and ΔBA:
  - −0.70 over the 5 completed builds with a card KL;
  - −0.77 with qwen38-mpoa † added (n = 6).

  The sign means that higher KL goes with a larger loss. But the builds differ in base model and author, and the KL
  values are the authors' own. The smallest-KL build (qwen36-heretic, 0.0015) is also on the base that lost least, so
  base and KL cannot be separated here.

## Robustness arm

Not run. The UD-Q8_K_XL build was dropped by the user before download (amendment 7). The question of whether the quant
scheme alone moves results is untested, so O53's "different quantizers" caveat stands unchanged.

## Method and family views (descriptive)

| Method | Builds (ΔBA) | Mean ΔBA, completed only | Mean ΔBA incl. † |
|---|---|---:|---:|
| Heretic ARA | gemma26-heretic −0.141, gemma26-ultra −0.226, gemma31-heretic −0.055 | −0.140 | −0.140 |
| Classic (huihui) | qwen36-huihui −0.028, gemma31-huihui −0.156, gemma26-huihui † −0.147 | −0.092 | −0.110 |
| Heretic MPOA | qwen36-heretic −0.017, qwen38-mpoa † +0.015 | −0.017 | −0.001 |
| Heretic 1.4.0 (variant not named) | muse-heretic −0.062 | −0.062 | −0.062 |

- **The two MPOA builds had the two smallest effects.** They are also the only two Heretic builds on Qwen bases, so
  method and base are confounded.
- **The base explains more than the method.** Every Gemma 4 build lost 0.055–0.226, whatever the method. Both Qwen3.6
  builds lost under 0.03. Stage 1's Qwen3.8 builds lost 0.013–0.042 on the full suites (O68, PR #57).
- **Within-base method contrasts** (exact McNemar between the two builds on cases both scored):

| Base | huihui only correct | Heretic only correct | p | Heretic − huihui ΔBA |
|---|---:|---:|---:|---:|
| Gemma 4 26B (huihui †) | 53 | 58 | 0.70 | +0.007 |
| Qwen3.6 35B-A3B | 38 | 48 | 0.33 | +0.011 |
| Gemma 4 31B-it | 8 | 115 | 2×10⁻²⁵ | +0.102 |

On Gemma 4 31B the Heretic build is much closer to vanilla than huihui v2. On the other two bases the methods tie.

## Per-dataset results (secondary, uncorrected)

Each cell shows vanilla BA → build BA, then (lost/gained) on cases both scored, with the exact McNemar p where it is
below 0.05. † marks a deviation cell.

| Test | n | gemma26-heretic | gemma26-ultra | gemma26-huihui † | gemma31-huihui | gemma31-heretic |
|---|---:|---|---|---|---|---|
| bipia-email-mixed | 120 | 0.933 → 0.792 (17/0, p 2e-5) | 0.933 → 0.692 (29/0, p 4e-9) | 0.933 → 0.750 (19/0, p 4e-6) † | 0.900 → 0.733 (21/1, p 1e-5) | 0.900 → 0.842 (9/2) |
| longpi-paper | 120 | 1.000 → 0.833 (20/0, p 2e-6) | 1.000 → 0.683 (38/0, p 7e-12) | 1.000 → 0.915 (10/0, p 0.002) † | 1.000 → 0.817 (22/0, p 5e-7) | 1.000 → 0.858 (17/0, p 2e-5) |
| longpi-code | 120 | 0.975 → 0.667 (37/0, p 1e-11) | 0.975 → 0.509 (54/0, p 1e-16) | 0.975 → 0.819 (18/0, p 8e-6) † | 0.875 → 0.550 (39/0, p 4e-12) | 0.875 → 0.792 (10/0, p 0.002) |
| longpi-email | 120 | 1.000 → 0.858 (17/0, p 2e-5) | 1.000 → 0.737 (31/0, p 9e-10) | 1.000 → 0.763 (27/0, p 1e-8) † | 1.000 → 0.767 (28/0, p 7e-9) | 1.000 → 0.917 (10/0, p 0.002) |
| web-mixed | 120 | 0.825 → 0.817 (3/2) | 0.825 → 0.792 (6/2) | 0.825 → 0.845 (3/5) † | 0.850 → 0.808 (8/3) | 0.850 → 0.850 (1/1) |
| agentdyn-github | 94 | 1.000 → 1.000 (0/0) | 1.000 → 1.000 (0/0) | 1.000 → 1.000 (0/0) † | 1.000 → 1.000 (0/0) | 1.000 → 1.000 (0/0) |
| pids-obfuscated | 112 | 0.902 → 0.482 (47/1, p 3e-13) | 0.902 → 0.438 (52/0, p 4e-16) | 0.902 → 0.288 (64/1, p 4e-18) † | 0.902 → 0.536 (41/0, p 9e-13) | 0.902 → 0.838 (7/0, p 0.016) |
| benign-false-positives | 120 | 0.942 → 0.983 (2/7) | 0.942 → 1.000 (0/7, p 0.016) | 0.942 → 0.975 (2/6) † | 0.917 → 0.992 (0/9, p 0.004) | 0.917 → 0.983 (0/8, p 0.008) |
| paper-score-counterfactual | 72 | 1.000 → 0.880 (13/0, p 2e-4) | 1.000 → 0.694 (33/0, p 2e-10) | 1.000 → 0.894 (11/0, p 0.001) † | 1.000 → 0.833 (18/0, p 8e-6) | 1.000 → 0.870 (14/0, p 1e-4) |

| Test | n | qwen36-huihui | qwen36-heretic | qwen38-mpoa | muse-heretic |
|---|---:|---|---|---|---|
| bipia-email-mixed | 120 | 0.842 → 0.833 (9/8) | 0.842 → 0.825 (9/7) | 0.729 → 0.750 (4/7) | 0.750 → 0.608 (17/0, p 2e-5) |
| longpi-paper | 120 | 0.908 → 0.992 (0/10, p 0.002) | 0.908 → 0.950 (1/6) | 1.000 → 1.000 (0/0) | 0.917 → 0.858 (9/2) |
| longpi-code | 120 | 0.883 → 0.917 (3/7) | 0.883 → 0.883 (4/4) | 0.950 → 1.000 (0/6, p 0.031) | 0.858 → 0.831 (3/0) |
| longpi-email | 120 | 1.000 → 0.958 (5/0) | 1.000 → 1.000 (0/0) | 1.000 → 1.000 (0/0) | 1.000 → 0.883 (14/0, p 1e-4) |
| web-mixed | 120 | 0.775 → 0.808 (2/6) | 0.775 → 0.833 (0/7, p 0.016) | 0.792 → 0.850 (0/7, p 0.016) | 0.825 → 0.842 (3/5) |
| agentdyn-github | 94 | 1.000 → 1.000 (0/0) | 1.000 → 1.000 (0/0) | 1.000 → 0.936 (6/0, p 0.031) | 0.925 → 1.000 (0/7, p 0.016) |
| pids-obfuscated | 112 | 0.811 → 0.378 (48/0, p 7e-15) | 0.811 → 0.545 (33/4, p 1e-6) | 0.736 → 0.726 (8/8) † | 0.838 → 0.606 (25/0, p 6e-8) |
| benign-false-positives | 120 | 0.975 → 0.958 (3/1) | 0.975 → 0.958 (3/1) | 0.950 → 0.975 (1/4) † | 0.967 → 1.000 (0/4) |
| paper-score-counterfactual | 72 | 0.870 → 0.972 (0/11, p 0.001) | 0.870 → 0.917 (1/6) | 0.917 → 0.972 (1/3) † | 0.954 → 0.852 (12/1, p 0.003) |

- **Benign sets.** Builds flag less benign text than vanilla, or the same.
  - NotInject (`benign-false-positives`) improves in every Gemma build: 0–2 false alarms added, 6–9 removed.
  - AgentDyn benign false alarms (O53's huihui effect) do not recur for any huihui build: 0 added of 47 negatives in
    every Gemma and Qwen3.6 build.
  - The one build that adds them is qwen38-mpoa (0 → 6 of 47, p = 0.031, in a kept stage 2 cell). muse-heretic removes
    all 7 of Muse's.
- **Web.** No build loses web significantly (the largest drop is gemma31-huihui, 8 lost vs 3 gained). Qwen3.6 heretic
  and qwen38-mpoa gain 7 each (p = 0.016).

## Abstentions (reported separately; excluded from BA)

Each cell shows build / vanilla abstentions on the same cases.

| Build | bipia-email | longpi-paper | longpi-code | longpi-email | web | agentdyn | pids-obf. | benign | probe | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gemma26-heretic | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 0 | 0 / 0 | 0 / 0 | 2 / 0 |
| gemma26-ultra | 0 / 0 | 0 / 0 | 2 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 3 / 0 |
| gemma26-huihui † | 6 / 0 | 1 / 0 | 2 / 0 | 3 / 0 | 2 / 0 | 1 / 0 | 8 / 0 | 0 / 0 | 2 / 0 | 25 / 0 |
| gemma31-huihui | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| gemma31-heretic | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |
| qwen36-huihui | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1 / 1 | 0 / 0 | 0 / 0 | 1 / 1 |
| qwen36-heretic | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 1 | 0 / 0 | 0 / 0 | 2 / 1 |
| qwen38-mpoa (pids, benign, probe †) | 0 / 1 | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 | 0 / 0 | 6 / 2 | 0 / 0 | 0 / 0 | 8 / 3 |
| muse-heretic | 0 / 0 | 0 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 3 / 1 | 0 / 0 | 0 / 0 | 4 / 1 |

- In the gemma26-huihui deviation run, 5 of 9 cells exceed the pre-registered +2 pp limit. It would have been stopped
  at its first cell under the plan's rules.
- All abstentions are length abstentions: reasoning ran past the 4,096-token budget.
- **Reasoning length.** Mean reasoning tokens rise sharply for Gemma 26B: 688 (heretic), 961 (ultra) and 915 (huihui
  †) vs 307 for vanilla, or 2.2–3.1×. The other builds rise less: Gemma 31B 1.4–1.7×, Qwen3.6 1.2–1.4×, Qwen3.8 MPOA
  1.5×. Muse is unchanged (0.97×).
- **Drafting (MTP).** qwen38-mpoa accepted 59.9% of draft tokens (223,312 / 372,581), against 68.8% for vanilla-low
  (159,911 / 232,448).

## Score-counterfactual probe (secondary)

There are 18 attack families per model. A "flip" means the score crossed from ≤ 0.5 to > 0.5 when the injected
instruction asked for a high score instead of a low one.

| Base | Vanilla flips | Builds: flips (matched both targets) |
|---|---:|---|
| Gemma 4 26B | 0 | heretic 1 (1), ultra 5 (3), huihui † 5 (0) |
| Gemma 4 31B | 0 | huihui 0 (0), heretic 4 (0) |
| Qwen3.6 | 0 | huihui 1 (0), heretic 1 (0) |
| Qwen3.8 low | 0 | mpoa † 0 (0) |
| Muse | 2 | heretic 1 (0) |

Steerability rises for some Gemma builds: ultra, huihui † and gemma31-heretic. It does not rise for the Qwen or Muse
builds. The counts are small and descriptive. The O53 pilot had 3/18 for Qwen3.8 heretic-ara at xhigh.

## Decision

The pre-registered rule: O53 generalizes if at least half of the completed primary builds show a Holm-significant loss
and none shows a Holm-significant gain.

- **Family (a), pre-registered.** 6 of 7 show a significant loss (gemma26-heretic, gemma26-ultra, qwen36-huihui,
  gemma31-huihui, gemma31-heretic, muse-heretic) and 0 show a gain. **O53 generalizes.**
- **Family (b), with the deviation builds.** 7 of 9 show a significant loss (adds gemma26-huihui) and 0 a gain. Same
  verdict.

The generalization is about direction. The size varies by base: large on Gemma 4, moderate on Muse, small or absent on
Qwen.

## Stage 3 candidates

The pre-registered rule: a build with a Holm-significant loss, or with |ΔBA| ≥ 0.05, is a candidate. The hours below
are estimated full-suite request time on the baseline and extension suites (35 datasets, 14,085 cases). Each estimate
is the vanilla model's own request time on those suites times the build/vanilla request-time ratio on the 998 pilot
cases.

| Build | Qualifies by | Vanilla full-suite request h | Pilot time ratio | Est. h |
|---|---|---:|---:|---:|
| gemma26-heretic | Holm loss, ΔBA −0.141 | 16.2 | 2.09× | 34 |
| gemma26-ultra | Holm loss, ΔBA −0.226 | 16.2 | 2.85× | 46 |
| qwen36-huihui | Holm loss (ΔBA −0.028) | 25.3 | 1.40× | 36 |
| gemma31-huihui | Holm loss, ΔBA −0.156 | 55.0 | 1.58× | 87 |
| gemma31-heretic | Holm loss, ΔBA −0.055 | 55.0 | 1.39× | 76 |
| muse-heretic | Holm loss, ΔBA −0.062 | 56.1 | 1.00× | 56 |
| **Total, pre-registered candidates** | | | | **≈ 335** |
| gemma26-huihui † (deviation only) | Holm loss, ΔBA −0.147 | 16.2 | 2.72× | 44 |

Not candidates: qwen36-heretic (Holm p = 0.105, ΔBA −0.017; about 31 h if wanted) and qwen38-mpoa † (+0.015; about
33 h).

- **Calibration check.** Stage 1's two Qwen3.8 builds took 54.1 h of request time against vanilla-low's 20.9 h, which
  is 1.29× per build. That is the same kind of ratio.
- **What the estimates leave out.** Model loads, gates and pauses are not included. The pilot over-represents long
  documents, so the ratio is approximate.
- **Running all six** is about two weeks of Studio time. Running them is a separate decision. If the full run is
  trimmed, the plan's run order (Gemma 4 26B first) puts gemma26-heretic and gemma26-ultra first (about 80 h), because
  they also carry the KL contrast.

## Limitations

- **Pilot scale.** About 100 cases per dataset, nine datasets, four of them LongPIBench with one fixed attack sentence
  per template. Equal dataset weights; several datasets are single-class.
- **Builds per base.** One or two per base, one Q8_0 quant, one runtime, one device.
- **Quantizers.** The builds come from different quantizers than their vanilla GGUFs (mradermacher, llmfan46,
  bartowski vs lmstudio-community, unsloth). The robustness arm that would have probed this was dropped.
- **Hub vs non-hub serving.** Gemma vanilla is a hub model and the builds are not. The template override reproduces
  the rendered prompt on every case, but LM Studio's internal handling may still differ.
- **Old vanilla checkpoints.** They date from 2026-10-07 to 2026-10-22 and were not rerun.
- **Card numbers.** KL and refusal numbers are the authors' own, measured differently across authors.
- **Deviation builds.** Their results come from runs in which the pre-registered abstention stop was waived. They are
  reported for completeness and are not part of the primary family.

## Reproduce

```sh
cd <worktree with evals/runs and the dataset sources>
bun evals/analysis/abliteration-stage2-pilot-2026-10/analyze.ts
```

The script reads `evals/runs/abliteration-stage2-pilot-2026-10/` and `evals/runs/abliteration-stage2-deviation-2026-11/`.
It also reads the vanilla full-suite checkpoints (`studio-baseline-t4096-2026-10-07`,
`studio-extension-t4096-2026-10-13`, `studio-qwen38-low-2026-10-22`). It writes
`evals/runs/abliteration-stage2-pilot-2026-10/analysis/stage2-results.json` and
`results/stage2-summary.json`. The progress logs of both chains are copied next to their scripts.
