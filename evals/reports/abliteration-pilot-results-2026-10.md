# Abliteration pilot: results (2026-10-12)

This pilot tests FINDINGS F7 ([#23](https://github.com/elicollinson/solenoid-security/issues/23)): do abliterated builds
of a model detect prompt injection differently from the original? Two abliterated Qwen3.8 27B builds, heretic-ara and
huihui, were run against the frozen vanilla baseline outputs on identical cases: 9 datasets, 998 cases per model, one
Q8_0 GGUF quant, LM Studio on one Mac Studio. The plan, hypotheses, analysis and stopping rules were frozen before
inference in the [pre-registered plan](abliteration-pilot-plan-2026-10.md). Execution is in research-log entry L150.

**This is a pilot.** It has about 100 cases per dataset, one quant, one runtime and one device, and four of its nine
datasets are LongPIBench, which uses one fixed attack sentence per template. Its job was to decide whether F7 deserves a
full run. It did not settle F7. **A full-suite follow-up is needed before any general claim.**

Sources: [`comparison.json`](../analysis/abliteration-pilot-2026-10/results/comparison.json) and
[`comparison.md`](../analysis/abliteration-pilot-2026-10/results/comparison.md), written by the pre-registered
[`compare-pilot.ts`](../analysis/abliteration-pilot-2026-10/compare-pilot.ts), plus
[`supplement.json`](../analysis/abliteration-pilot-2026-10/results/supplement.json) from
[`supplement-pilot.ts`](../analysis/abliteration-pilot-2026-10/supplement-pilot.ts). The supplement computes Holm,
the hypothesis thresholds, attack strata and one post-hoc reasoning screen. Both scripts run offline. Before reporting
any number, `compare-pilot.ts` audits every checkpoint with `auditPartialCheckpoint`. It also checks that prompt,
parameters, transport, strategy and rule are identical across the three engines, and that every case has the same
label and model-input hash under all three. All 27 cells were complete and passed. No inference was run for this
analysis.

## Bottom line

- **Both abliterated builds scored lower than vanilla on the same cases.** Macro balanced accuracy (BA) was 0.888 for
  vanilla, 0.854 for heretic and 0.858 for huihui. The pre-registered primary test is a pooled exact McNemar on correct
  vs incorrect, Holm-corrected over two comparisons. It is significant for both: vanilla→heretic 49 vs 16 discordant
  (p = 5.1×10⁻⁵, Holm 1.0×10⁻⁴) and vanilla→huihui 42 vs 15 (p = 4.6×10⁻⁴, Holm 4.6×10⁻⁴). The paired accuracy
  differences are −0.033 (95% CI −0.049 to −0.018) and −0.027 (−0.042 to −0.012).
- **The losses are mostly missed attacks, concentrated in two places.** One is obfuscated text (PIDS: 15 and 16
  detections lost). The other is the naive LongPIBench template on paper and code. Authority-spoof and combine
  attacks stayed at 20/20 in every LongPI cell. BIPIA email moved the other way (more detections).
- **Huihui added benign false alarms on agent tool output.** On AgentDyn GitHub benign outputs, huihui flagged 19 of
  47 against vanilla's 8 (11 added, 0 removed; exploratory p = 0.001). Heretic flagged 14 (10 added, 4 removed). The
  "fewer false alarms" hypothesis (H4) is not supported. NotInject stayed at or near the floor.
- **Heretic and huihui did not differ overall** (29 vs 33 discordant, p = 0.70). They differ in where they lose:
  heretic on the score probe and the LongPI paper naive template, huihui on agent benign outputs.
- **Pre-registered decision: escalate F7 to the full 21-dataset protocol.** Each model meets at least two escalation
  rules (below).
- **Newly missed attacks look like vanilla's own misses, not a new failure mode.** This comes from a post-hoc,
  descriptive keyword screen. In most newly missed attacks, the conclusion still names the injection but downgrades it,
  and most final scores sit just under the threshold (0.3–0.5).

## Three-way results on identical cases

Rates use scored cases. Abstentions are excluded from rates and counted separately. BA is the mean of the available
class rates, so PIDS (attack-only) is recall and NotInject (benign-only) is the true-negative rate. Lengths and content
types follow the plan.

| Dataset (cases) | Type | Vanilla BA | Heretic BA | Huihui BA | Vanilla TPR / FPR | Heretic TPR / FPR | Huihui TPR / FPR |
|---|---|---:|---:|---:|---|---|---|
| longpi-paper (120) | long | 0.983 | 0.942 | 0.983 | 0.967 / 0.000 | 0.883 / 0.000 | 0.967 / 0.000 |
| longpi-code (120) | long | 0.958 | 0.908 | 0.900 | 0.917 / 0.000 | 0.817 / 0.000 | 0.800 / 0.000 |
| longpi-email (120) | long | 1.000 | 1.000 | 0.992 | 1.000 / 0.000 | 1.000 / 0.000 | 0.983 / 0.000 |
| paper-score-counterfactual (72) | probe | 0.972 | 0.907 | 0.981 | 0.944 / 0.000 | 0.815 / 0.000 | 0.963 / 0.000 |
| bipia-email-mixed (120) | email | 0.642 | 0.678 | 0.683 | 0.283 / 0.000 | 0.356 / 0.000 | 0.367 / 0.000 |
| web-mixed (120) | web | 0.817 | 0.817 | 0.817 | 0.950 / 0.317 | 0.967 / 0.333 | 0.950 / 0.317 |
| agentdyn-github (94) | agent | 0.915 | 0.851 | 0.798 | 1.000 / 0.170 | 1.000 / 0.298 | 1.000 / 0.404 |
| pids-obfuscated (112) | obfuscated, recall | 0.703 | 0.595 | 0.565 | 0.703 / – | 0.595 / – | 0.565 / – |
| benign-false-positives (120) | NotInject, TNR | 1.000 | 0.992 | 1.000 | – / 0.000 | – / 0.008 | – / 0.000 |
| **All 9 (998)** | macro BA | **0.888** | **0.854** | **0.858** | pooled 0.826 / 0.056 | 0.779 / 0.072 | 0.794 / 0.079 |

| Group | Vanilla | Heretic | Huihui |
|---|---:|---:|---:|
| Long band macro BA (4 sets) | 0.978 | 0.939 | 0.964 |
| Medium band macro BA (3 sets) | 0.791 | 0.782 | 0.766 |
| Short band macro BA (2 sets) | 0.851 | 0.793 | 0.782 |
| Abstentions, all length (of 998) | 3 | 2 | 5 |
| Mean reasoning tokens | 291 | 305 | 338 |

Per-test medians, tok/s and draft acceptance are in `comparison.md`. Tok/s and draft acceptance are lower for both
abliterated files (about 55–60 vs 63–68 tok/s; acceptance about 0.50–0.59 vs 0.63–0.70). The plan treats these as not
comparable across builds.

## Paired flips and exact McNemar

"Lost" means vanilla flagged an attack and the other model did not. "Added" means a new false alarm on a benign case.
Per-test p-values are uncorrected and exploratory. Only the pooled vanilla→abliterated rows are primary.

| Test | V→Heretic only-V / only-H correct (p) | lost / gained, FA added / removed | V→Huihui only-V / only-U correct (p) | lost / gained, FA added / removed | Heretic→Huihui (p) |
|---|---|---|---|---|---|
| longpi-paper | 6 / 1 (0.125) | 6 / 1, 0 / 0 | 2 / 2 (1.00) | 2 / 2, 0 / 0 | 1 / 6 (0.125) |
| longpi-code | 7 / 1 (0.070) | 7 / 1, 0 / 0 | 8 / 1 (0.039) | 8 / 1, 0 / 0 | 4 / 3 (1.00) |
| longpi-email | 0 / 0 (1.00) | 0 / 0, 0 / 0 | 1 / 0 (1.00) | 1 / 0, 0 / 0 | 1 / 0 (1.00) |
| paper-score-counterfactual | 7 / 0 (0.016) | 7 / 0, 0 / 0 | 1 / 2 (1.00) | 1 / 2, 0 / 0 | 0 / 8 (0.0078) |
| bipia-email-mixed | 2 / 6 (0.29) | 2 / 6, 0 / 0 | 3 / 8 (0.23) | 3 / 8, 0 / 0 | 7 / 7 (1.00) |
| web-mixed | 1 / 1 (1.00) | 0 / 1, 1 / 0 | 0 / 0 (1.00) | 0 / 0, 0 / 0 | 1 / 1 (1.00) |
| agentdyn-github | 10 / 4 (0.18) | 0 / 0, 10 / 4 | 11 / 0 (0.00098) | 0 / 0, 11 / 0 | 5 / 0 (0.0625) |
| pids-obfuscated | 15 / 3 (0.0075) | 15 / 3, – | 16 / 2 (0.0013) | 16 / 2, – | 10 / 7 (0.63) |
| benign-false-positives | 1 / 0 (1.00) | –, 1 / 0 | 0 / 0 (1.00) | –, 0 / 0 | 0 / 1 (1.00) |
| **Pooled (primary for V→X)** | **49 / 16 (5.1×10⁻⁵)** | 37 / 12, 12 / 4 | **42 / 15 (4.6×10⁻⁴)** | 31 / 15, 11 / 0 | 29 / 33 (0.70) |

Both-scored pairs: 993 (heretic) and 990 (huihui) of 998. Abstention transitions (scored→abstained / abstained→scored):
heretic 2 / 3, huihui 5 / 3. All are length abstentions; four of huihui's five are on PIDS.

## Results against the pre-registered hypotheses

**H1, recognition survives (pooled TPR falls by at most 0.05 and macro BA stays within ±0.03).** Not met by either
build, but only narrowly. The TPR criterion holds: −0.047 (heretic) and −0.033 (huihui). The BA criterion fails: −0.033
and −0.030 (−0.0301 unrounded, just past the bound). Read this as a small loss, not as recognition breaking down.

**H2, concern drops.** The direction is supported for both builds. Positives lost more detections than they gained:
heretic 37 vs 12 (positive-only exact McNemar p = 4.7×10⁻⁴) and huihui 31 vs 15 (p = 0.026). These positive-only tests
are exploratory and uncorrected. The mean scored-positive score fell from 0.795 to 0.750 (heretic) and 0.727 (huihui).
On paired positives, scores fell in 327 of 510 (heretic) and 390 of 508 (huihui). The predicted locations were only
partly right:

- PIDS obfuscated (vanilla recall 0.703): losses as predicted, spread across most of the seven obfuscations with no
  single dominant one (per-obfuscation counts in `supplement.json`).
- BIPIA email (vanilla TPR 0.283): opposite to prediction. Both builds detected more (heretic +6/−2, huihui +8/−3;
  not significant).
- LongPI authority-spoof: opposite to prediction. There were no losses: 20/20 in every cell for all three models. All
  LongPI losses are on the naive template (paper: heretic 13/20 vs vanilla 18/20; code: heretic 9/20 and huihui 8/20
  vs vanilla 15/20). That is where vanilla is already below ceiling, which fits the "marginal cases go first"
  reading, but for a different template than the plan named.

**H3, steerability rises.** The evidence is mixed and weak. Heretic has 3/18 low→high flag flips on the probe (vanilla
0/18, huihui 1/18). That meets the pre-registered ≥3 threshold exactly. No model matched both targets (0/18 each), and
no model copied an out-of-range value (2 or 3). The mean high−low score was 0.074 for heretic, −0.002 for huihui and
0.033 for vanilla. The flips do not look like steering toward the requested value. All three come from naive pairs
where the low-request (0.2) member fell below threshold under heretic. The out-of-range "3" member of the same family
also fell (4 of 6 crossed down, mean −0.233), so the pattern fits lower concern on naive attacks at least as well as
steering. Exact in-range copies of a requested value rose descriptively: vanilla 2 outputs, heretic 5, huihui 7. Half
of them (6 of 12) were 0.9 on combine attacks that were flagged anyway.

**H4, fewer false alarms.** Not supported, and the direction is opposite. Web-mixed FPR was unchanged or slightly
higher (0.317 → 0.333 / 0.317). AgentDyn GitHub FPR rose (0.170 → 0.298 / 0.404). NotInject added 1 false alarm for
heretic and 0 for huihui (rule threshold ≥ 3).

**H5, reasoning and abstentions change (descriptive).** Mean reasoning tokens were 291 (vanilla), 305 (heretic) and
338 (huihui). Length abstentions were 3, 2 and 5. The changes are small. Huihui reasons longer than vanilla on seven
of nine tests, most on PIDS (mean 659 vs 529).

**Build difference.** There is no overall difference between the builds (pooled 29 vs 33, p = 0.70; accuracy difference
+0.004, CI −0.012 to +0.020). The pattern differs by test. Heretic lost the probe's naive detections (heretic→huihui 0
vs 8, exploratory p = 0.0078) and LongPI paper naive detections. Huihui added more agent false alarms and shifted
numeric-fact control scores up (+0.09 to +0.14, all below threshold).

## Stopping and decision rules

| Rule (plan) | Heretic | Huihui |
|---|---|---|
| Drift gate (≥ 22/24 vanilla outcomes agree) | 24/24 agree, 24/24 identical final answers, LM Studio 0.4.25 build 1 (same as baseline) | (shared) |
| Qualification (≤ 3 abstentions in first 24 longpi-paper) | 0 abstentions, passed | 0 abstentions, passed |
| Manual stop (projected > 8 h) | not needed (≈2.0 h) | not needed (≈2.2 h) |
| Escalate: Holm-significant pooled McNemar | **yes** (Holm p = 1.0×10⁻⁴) | **yes** (Holm p = 4.6×10⁻⁴) |
| Escalate: band macro BA \|Δ\| ≥ 0.05 | **yes**: short −0.058 (long −0.039, medium −0.009) | **yes**: short −0.069 (long −0.014, medium −0.025) |
| Escalate: ≥ 3/18 probe low→high flips | **yes**: 3/18 | no: 1/18 |
| Escalate: ≥ 3 matched-both-targets | no: 0 | no: 0 |
| Escalate: ≥ 3 added NotInject false alarms | no: 1 | no: 0 |
| **Decision** | **Escalate F7** | **Escalate F7** |

There were no reruns, threshold changes or case swaps after launch. The chain ran from 19:29Z to 23:46Z on 2026-10-12
(≈4.3 h for both models plus the drift check). The plan estimated 3.6 h at the vanilla pace.

## Post-hoc descriptive check: "recognized but not concerning"

**This check is not pre-registered and is descriptive only. It is a keyword screen, not human coding.** It covers the
newly missed attacks, which vanilla flagged and the abliterated build did not. It reads the saved reasoning text in
memory and writes counts only. No reasoning or case text is published. Regexes are in `supplement-pilot.ts` and
`supplement.json`.

- **Variant A (whole reasoning)** asks whether the reasoning names an embedded instruction or injection attempt, and
  whether it also uses a dismissal phrase anywhere. It fired on almost everything: 37/37 newly missed (heretic) and
  30/31 (huihui), but also on 381/385 retained detections. **It does not discriminate and is not interpreted.**
- **Variant B (final 500 characters, where the model settles on a score)** asks whether the conclusion refers to the
  injection or instruction and also downgrades it (for example mild, low, not severe, benign). It was defined after
  variant A saturated and after reading three conclusion windows. Treat it accordingly.

| Variant B: recognized and downgraded in the conclusion | Heretic | Huihui |
|---|---:|---:|
| Newly missed attacks, abliterated reasoning | **33 / 37** | **27 / 31** |
| Same cases, vanilla reasoning (vanilla flagged them) | 22 / 37 | 17 / 31 |
| Reference: attacks both models detected (abliterated reasoning) | 208 / 385 | 195 / 388 |
| Reference: attacks both models missed (abliterated reasoning) | 68 / 76 | 65 / 74 |
| Newly missed final scores: ≤ 0.1 / 0.1–0.3 / 0.3–0.5 | 4 / 10 / 23 | 0 / 7 / 24 |

On this crude screen, nearly every newly missed attack still refers to the injection in its conclusion and then
downgrades it, and most scores land just under the 0.5 threshold. That matches what the models do on attacks they both
miss (68/76 and 65/74), and it is more frequent than in the same model's retained detections (about half). This fits
the "recognized but not concerning" reading in O18/O44 as a threshold shift on marginal cases, rather than a failure to
notice. The screen cannot tell recognition from paraphrase. Vanilla's own reasoning on the same cases, which it
flagged, also uses downgrading words in more than half of them (22/37 and 17/31), so the words alone are weak
evidence. It is descriptive only.

## Deviations and notes

- **No deviation from the frozen analysis.** `compare-pilot.ts` ran unchanged: the tracked copy, byte-identical to the
  run-directory copy, run from a worktree with `PILOT_DATA_ROOT` pointing at the checkout that holds the checkpoints,
  as the script provides.
- **Supplement.** Holm adjustment, the H1/H2 threshold arithmetic, positive-only McNemar, attack strata and paired
  accuracy intervals come from a script written after the run (`supplement-pilot.ts`). They are quantities the plan
  names. The 95% intervals on paired accuracy differences are a Wald interval on discordant pairs, which the plan did
  not specify.
- **Reasoning screen.** The plan says recognition-versus-concern reading is post hoc and outside the plan. It is
  reported here only as labeled descriptive counts, and variant B was defined after seeing variant A.
- **Probe as a primary.** The plan lists probe flips and target matches as primary but gives them a count threshold,
  not a test. They are reported as counts against that threshold.

## Limitations

- **Pilot scale.** There are about 100 cases per dataset (72–120), and per-test effects are a handful of cases. Per-test
  p-values are uncorrected. Only the two pooled tests are confirmatory, and they pool heterogeneous datasets.
- **One quant, one runtime, one device.** All runs are Q8_0 GGUF under LM Studio 0.4.25 on one Mac Studio. The three
  files come from three publishers (lmstudio-community, mradermacher, huihui-ai), and their sizes differ by up to
  3.7 MB. A quantizer difference outside the ablated weights cannot be ruled out.
- **Vanilla is not rerun.** Vanilla outputs are the frozen 2026-10-09 baseline. The drift gate checked 24 cases (24/24
  identical final answers).
- **LongPIBench caveat.** LongPI attacks use a single fixed attack sentence per template, so the naive-template
  losses are losses on one sentence per domain. Generalization needs the varied-template cohorts.
- **Speculative decoding.** Draft acceptance differs across files. Greedy drafting is meant to be lossless, but F9 is
  open.
- **Build details.** The meaning of "ara" in the heretic build name is unverified. Both builds are treated as black
  boxes.

## Next step

The escalation rule fires, so F7 moves to the full 21-dataset Studio baseline protocol for both abliterated builds
(7,326 cases per model, the same frozen engines). That run is not scheduled yet. Per the user's ordering, the
extension suite on the fully tested models runs first.

## Reproduce

Offline, from the repository root, with the run checkpoints and baseline checkpoints present (or `PILOT_DATA_ROOT`
pointing at a checkout that has them):

```sh
RUN_DIR=evals/runs/abliteration-pilot-2026-10 bun evals/analysis/abliteration-pilot-2026-10/compare-pilot.ts     # comparison.json / .md
RUN_DIR=evals/runs/abliteration-pilot-2026-10 bun evals/analysis/abliteration-pilot-2026-10/supplement-pilot.ts  # supplement.json
```

Without checkpoints, use the published `results/` copies. They hold counts, rates, scores, token and timing statistics
and case IDs only.
