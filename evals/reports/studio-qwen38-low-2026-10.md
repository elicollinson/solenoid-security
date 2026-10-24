# Qwen3.8 27B at `reasoning_effort: "low"` on the full Studio suites (2026-10-22/24)

Tracking issue: [#33](https://github.com/elicollinson/solenoid-security/issues/33). Pre-registration:
[`studio-qwen38-low-plan-2026-10.md`](studio-qwen38-low-plan-2026-10.md), commit `d77b6f4`, pushed before the first
call. It follows the effort ablation ([report](qwen38-effort-ablation-2026-10.md), O65). `FINDINGS.md` O67, research
log L158. Scripts and aggregates are in [`evals/analysis/studio-qwen38-low-2026-10-22/`](../analysis/studio-qwen38-low-2026-10-22/)
([`low-results.json`](../analysis/studio-qwen38-low-2026-10-22/results/low-results.json)).

## Summary

- **Low replaces the Qwen3.8 rows.** BA at 0.5:
  - baseline 0.895 → **0.912**: ΔBA +0.017 [+0.009, +0.024], 253 vs 168 discordant, exact McNemar p = 4.0×10⁻⁵;
  - extension 0.865 → **0.900**: ΔBA +0.035 [+0.029, +0.042], 579 vs 99, p = 2×10⁻⁸³.

  Qwen3.8 moves from 6th to 3rd of 7 on the baseline and from 6th to 4th on the extension.
- **The gain sits where the ablation found it.** The groups that improve significantly after Holm:
  - QA +0.096 (0.730 → 0.825);
  - email +0.123 (extension) and +0.099 (baseline);
  - BIPIA +0.056;
  - agent +0.020 (baseline).

  Web, long docs (extension), obfuscated text, extension agent and code do not change significantly.
- **The cost is benign false alarms on the baseline's benign sets.** The benign group falls from 0.994 to 0.965
  (1 vs 27 discordant, p = 2×10⁻⁷):
  - NotInject 3 → 18 of ~338 flagged;
  - hard-benign PIDS 3 → 14 of 807;
  - encoded benign controls 33 → 82 of ~965.

  On the extension, pooled benign FPR falls from 2.2% to 1.5% (43 → 29 of 1,973), mainly because BrowseSafe benign
  pages flagged fall from 30 to 16.
- **Cheaper.** 0.87× (baseline) and 0.84× (extension) the mean reasoning tokens; 0.87× and 0.86× the request time.
- **Thresholds.** O55's method now fits **0.08** on the baseline. Out of sample it lifts extension BA from 0.900 to 0.913
  (+0.013 [+0.007, +0.019]); excluding web, from 0.906 to 0.937. The pre-registered rule keeps **0.15 for non-web
  content** (extension non-web 0.928, 25/1,773 benign flagged) and **0.5 for web**: BrowseSafe falls from 0.820 to
  0.698 at 0.15, as benign pages flagged go from 16 to 89 of 200.

## 1. Run

- **Configuration.** One engine, #49's low engine copied byte-for-byte:
  `studio-qwen38-q8gguf-lmstudio-score-v1-thinking4096-native-v0-effort-low-v1`. Everything else is the frozen
  protocol, and the tests are copied unchanged (sorted-JSON diff).
- **Time.** 2026-10-23 02:56:27 to 2026-10-24 01:16:29 UTC, 22.3 h wall time. That is 20.9 h of request time plus
  35 model loads and unloads. The estimate was 20.9 h and the cap 25 h.
- **Calls.** 14,085, one per case, strictly serial. No retries, no LM Link waits, and 0 transport or provenance
  errors. The queue never halted.
- **Drift gate (passed).** The first 24 `bipia-email-mixed` cases reproduced #49's low arm exactly: prompt tokens, scores,
  final answers and reasoning-token counts all 24/24. `prompt_tokens` = frozen xhigh − 12 on 24/24.
- **Mechanism.** −12 on 10/10 at the start of the extension, and on every case with usage in all 35 cells (`CELL` lines).
- **Abstentions (length only).** Baseline 19 vs 17 at xhigh, mostly `pids-obfuscated` 8 and `encoding-eligible` 8.
  Extension 12 vs 2, all `bipia-table-mixed` attacks.

## 2. Results at 0.5

| Group | Baseline xhigh | Baseline low | Δ [95% CI] | low/xhigh right | p (Holm) |
|---|---|---|---|---|---|
| long docs (7) | 0.964 | 0.972 | +0.008 [−0.007, +0.023] | 77 / 38 | 0.0018 |
| email (2) | 0.712 | **0.812** | +0.099 [+0.075, +0.126] | 65 / 5 | 1.6×10⁻¹³ |
| web (1) | 0.856 | 0.854 | −0.002 [−0.021, +0.019] | 11 / 12 | 1 |
| agent (5) | 0.971 | 0.991 | +0.020 [+0.007, +0.035] | 18 / 4 | 0.017 |
| obfuscated (3) | 0.810 | 0.827 | +0.017 [−0.002, +0.037] | 63 / 64 | 1 |
| benign (2) | 0.994 | **0.965** | −0.029 [−0.041, −0.018] | 1 / 27 | 1.3×10⁻⁶ |
| policy (1) | 0.500 | 0.500 | 0 | 18 / 18 | 1 |
| **All 21** | **0.895** | **0.912** | **+0.017 [+0.009, +0.024]** | 253 / 168 | p = 4.0×10⁻⁵ |

| Group | Extension xhigh | Extension low | Δ [95% CI] | low/xhigh right | p (Holm) |
|---|---|---|---|---|---|
| long docs (5) | 0.908 | 0.918 | +0.010 [−0.003, +0.023] | 48 / 31 | 0.28 |
| BIPIA (2) | 0.748 | **0.805** | +0.056 [+0.041, +0.071] | 100 / 23 | 7×10⁻¹² |
| QA (2) | 0.730 | **0.825** | +0.096 [+0.086, +0.105] | 368 / 24 | 2×10⁻⁷⁹ |
| web (1) | 0.802 | 0.820 | +0.018 [−0.010, +0.046] | 22 / 15 | 0.97 |
| agent (2) | 0.999 | 0.997 | −0.002 [−0.007, +0.002] | 1 / 3 | 1 |
| email (1) | 0.810 | **0.933** | +0.123 [+0.082, +0.167] | 40 / 3 | 1.5×10⁻⁸ |
| code (1) | 1.000 | 1.000 | 0 | 0 / 0 | 1 |
| **All 14** | **0.865** | **0.900** | **+0.035 [+0.029, +0.042]** | 579 / 99 | p = 2×10⁻⁸³ |

McNemar uses cases scored in both arms. Counting abstentions as errors changes nothing: baseline 268 vs 180, +0.016;
extension 580 vs 99, +0.035. Δ is the paired, class-stratified bootstrap of mean dataset BA.

**Datasets that moved most.**
- Up:
  - SQuAD 0.698 → 0.795 and TriviaQA 0.761 → 0.856;
  - LLMail pool 0.810 → 0.933 and attempt-detection 0.802 → 0.922;
  - LongPI paper-method 0.870 → 0.967;
  - BIPIA code 0.885 → 0.958 and BIPIA email 0.622 → 0.701;
  - PIDS obfuscated 0.639 → 0.728;
  - AgentDyn GitHub 0.915 → 1.000.
- Down:
  - NotInject 0.991 → 0.947;
  - encoded benign controls 0.966 → 0.915;
  - paper-score counterfactual 0.972 → 0.917 (6 of 36 benign flagged);
  - LongPI code 0.955 → 0.925.

**Ranking.** Mean AUROC over the mixed datasets is 0.938 → 0.940 (baseline) and 0.923 → 0.945 (extension). QA AUROC
rose from 0.821 to 0.943, so the full cohorts confirm the ablation's QA result. Web AUROC is flat on BrowseSafe
(0.856 → 0.854) and lower on web-mixed (0.899 → 0.862).

**Cost.**

| Suite | Reasoning tokens, mean (median), xhigh → low | Request time, h |
|---|---|---|
| Baseline | 308 (240) → 269 (217) | 12.54 → 10.89 |
| Extension | 272 (222) → 229 (197) | 11.64 → 10.02 |

## 3. Thresholds (O55 method, pre-registered rule)

| Threshold | Baseline | Extension | Extension non-web | BrowseSafe | web-mixed | Extension benign flagged (non-web / web) |
|---|---|---|---|---|---|---|
| 0.02 | 0.886 | 0.915 | 0.946 | 0.510 | 0.631 | 55 / 193 |
| **0.08 (fit)** | 0.918 | 0.913 | 0.937 | 0.595 | 0.840 | 33 / 150 |
| 0.10 | 0.917 | 0.913 | 0.930 | 0.685 | 0.856 | 27 / 96 |
| **0.15** | 0.918 | 0.911 | 0.928 | 0.698 | 0.858 | 25 / 89 |
| 0.20 | 0.916 | 0.911 | 0.926 | 0.710 | 0.856 | 18 / 81 |
| **0.5** | 0.912 | 0.900 | 0.906 | **0.820** | 0.854 | 13 / 16 |

Non-web content has 1,773 benign cases and BrowseSafe 200.

- **Fit.** The baseline curve is flat from 0.05 to 0.15 (0.917–0.918), so the fitted value, 0.08, is not sharply
  identified. At xhigh the same code reproduces O55 (0.15).
- **Non-web: keep 0.15.** The rule passes:
  - extension non-web BA at 0.15 is 0.928, above 0.906 at 0.5;
  - 0.15 is 0.018 below the best fixed value (0.02, 0.946), within the 0.03 margin.

  0.15 flags fewer benign cases than 0.08 (25 vs 33 of 1,773), and on the baseline 0.08 and 0.15 tie.
- **Web: keep 0.5.** BrowseSafe loses 0.12 BA at 0.15, and web-mixed gains only 0.004.
- **Score shape changed.** Low gives more benign cases a high score: NotInject flags 18 at 0.5 vs 3 at xhigh. It gives
  fewer of them a small nonzero score: 28 vs 42 above 0.08. A lower threshold therefore costs less benign precision
  than it did at xhigh, but the 0.5 point costs more.

## 4. Caveats

- **The xhigh arm is frozen.** Its checkpoints date from 2026-10-07 to 10-15. The drift gate reproduced #49's low arm
  exactly, and #49's xhigh drift reproduced the frozen arm (100/100 outcomes). The LM Studio version is the same
  (0.4.25).
- **Weights.** Group BA weights datasets equally. Several datasets are single-class, where BA is TPR or TNR alone.
- **Only Qwen3.8 changed.** The other models still run at their template defaults (O54). The comparison is "Qwen3.8 at
  its best declared effort" against the others as frozen.
- **Effort and reasoning length.** At low they are not separable (O65).

## 5. What changes

- **README headline table.** Qwen3.8's row now shows the low numbers. The xhigh numbers (0.895 / 0.865) move to the
  footnote as the historical protocol.
- **FINDINGS.** O67 is new. Dated notes are added to O48 (ranks), O54, O55 (calibration), O59 (benign FPR) and O65
  (follow-up done).
- **Profiles (PR #34, not edited here).** Qwen3.8 uses `reasoning_effort: "low"`, with a threshold of 0.15 for non-web
  content (no longer provisional) and 0.5 for web.
