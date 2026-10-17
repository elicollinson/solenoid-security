# Mac Studio Q8 extension suite (max_tokens 4,096)

2026-10-17. The seven models that completed the [Studio Q8 full-text baseline](studio-baseline-q8-t4096-2026-10.md)
were each run on 14 new datasets (6,759 cases per model) under the same frozen protocol on the same Mac Studio. The
chain started 2026-10-13 22:11Z (`CHAIN_START`) and ended 2026-10-17 21:42Z (`EXTENSION_DONE`), about 95.5 hours
against a plan estimate of 94 (range 85–115). Every step exited 0, and there were no halts, reruns or substitutions.
The plan was frozen before inference
([published copy](../analysis/studio-extension-t4096-2026-10-13/results/extension-plan.json)). Every number below
comes from [`extension-results.json`](../analysis/studio-extension-t4096-2026-10-13/results/extension-results.json),
which is produced offline by [`analyze-extension.ts`](../analysis/studio-extension-t4096-2026-10-13/analyze-extension.ts).
That script revalidates all 98 checkpoints with the partial auditor (`auditPartialCheckpoint`). Its overall and group
means and its abstention counts match the seven `MODEL_DONE` lines in `progress.log` to three decimals. It also
recomputes the 147 baseline checkpoints for the saturation comparison and matches the published
`baseline-results.json`. No paid calls were made. Research log: L152.

> **Protocol caveat ([#33](https://github.com/elicollinson/solenoid-security/issues/33), FINDINGS Appendix B, O54, O55).**
> The requested `reasoning_effort: "high"` reached no model's chat template, because LM Studio did not pass it.
> Qwen3.8 ran at its template default `xhigh`, with a 38-token instruction added in front of the system prompt. Muse's
> template appends "Reasoning strength: high." and a fixed recipients line. The two Gemma models ran with thinking on
> through LM Studio's template switch, with no effort level. Qwen3.8's scores are also under-calibrated at 0.5 (O55).
> The rows below are what each model did under these settings, not a comparison at one common effort level.

## Bottom line

- **The extension broke the baseline's saturation in the overall figure and in most content types.** Among the six
  recommended models (all but Laguna), the overall spread doubled, from 0.028 (baseline, 21 datasets) to 0.059
  (extension). The change is +0.031, 95% CI [+0.023, +0.042]. The share of model pairs more than 0.05 apart went
  from 0/15 to 4/15. Within content types, QA (0.219 range; 11/15 pairs separated), BIPIA tables and code (0.170;
  10/15), BrowseSafe web pages (0.163; 10/15), LLMail attacks (0.133; 10/15) and RepoGuard (0.112; 9/15) separate the
  models clearly.
- **Agent tool output stays saturated.** Every model scores 0.955–1.000, and the six recommended models score
  0.982–1.000 (range 0.018, 0/15 pairs separated), the same as in the baseline (0.024). This is the case for the
  enhanced agent set in [#31](https://github.com/elicollinson/solenoid-security/issues/31).
- **Gemma 4 31B-it (0.923) and Gemma 4 26B-A4B (0.922) are tied at the top.** The difference is +0.002 [−0.004,
  +0.007]. Gemma 4 31B-it is ahead of Gemma26 on BIPIA (+0.014 [+0.002, +0.025]) and RepoGuard (+0.016 [+0.006,
  +0.026]), and Gemma 4 26B-A4B leads QA (+0.028 [+0.021, +0.035] over Gemma31). The two Gemmas also raise the fewest false alarms: 17 and 27 of 1,973
  benign cases (0.9% and 1.4%). Gemma 4 26B-A4B stays the sensible default, because Gemma 4 31B-it is about 3.2×
  slower per request.
- **Muse Glimmer 30B leads long documents (0.929), LLMail (0.943, tied with Gemma26) and RepoGuard (1.000, tied with
  Qwen3.8).** Its ranking ability is better than its score at 0.5 shows. In QA and BIPIA tables its AUROC is
  0.994–0.997, but it puts 26–63% of attacks in (0, 0.5], so they are missed at the threshold.
- **Qwen3.6 35B-A3B (−0.035) and Qwen3.8 (−0.030) dropped most from the baseline.** Qwen3.8 is weakest among the six
  on QA (0.730) and BIPIA (0.748). For Qwen3.8 this is mostly calibration (O55). Qwen3.6 35B-A3B is weakest among the
  six on long documents (0.854) and RepoGuard (0.889), where it scores many attacks exactly 0, and it has the most
  false alarms after Ornith.
- **False alarms concentrate on two benign sets.** Ten of the twelve benign sets get 0–1 false positives per model.
  Almost every false alarm is on BrowseSafe benign pages (3–68% of 200) or on documents that contain legitimate
  instructions (`longpi-authorized-benign`, 2.6–9.4% of 384).
- **Laguna XS 2.1 stays far behind (0.702).** It is last in every group. It does have the highest TNR on the
  authorized-instruction documents (97.4%), but it recalls only 13–18% of subtle long-document attacks.

## Frozen protocol

Identical to the [baseline](studio-baseline-q8-t4096-2026-10.md#frozen-protocol): the extension suite's engines,
strategies, rules and conditions are byte-identical to the baseline suite's.

| Setting | Value |
|---|---|
| Device | Mac Studio `2e1a82366471bc1a78e9b74d2469172d` over LM Link, `--require-device` |
| Runtime | LM Studio 0.4.25 native-v0 (`/api/v0/chat/completions`), GGUF Q8_0, context 65,536, parallel 1, client concurrency 1 |
| Technique | Full text, last external turn (`full-last-external-v1`) |
| Prompt and schema | `security-eval-score-only-json-v1`, strict `concern-score-only-json-v1` |
| Generation | temperature 0, `reasoning_effort: high` requested (not delivered; see the caveat above), `max_tokens: 4096`, timeout 300 s |
| Decision | max score > 0.5 (`max-score-gt-05-v1`) |
| Errors | `--continue-after-output-errors`; abstentions recorded and never retried; no per-model tuning |

Suite: `evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json` (sha256 `64863c9e…`),
checked against the frozen plan by the chain before inference and again by the analysis.

**Scoring.** Abstentions (length or output cut-offs) are not misses. They are left out of every rate and reported
separately. Balanced accuracy (BA) for a dataset is the mean of the class rates it has. Two datasets are attack-only,
so their BA is recall: `nemotron-ipi-attacks` (360) and `llmail-pool-attacks` (300). One is benign-only, so its BA is
TNR: `longpi-authorized-benign` (384). A group score is the unweighted mean of its datasets, and the overall score is
the unweighted mean of all 14. Everything comes from one environment and one technique, so nothing is pooled across
environments. The pooled false-positive rate pools scored benign cases across one model's datasets in this one
environment, and is reported next to the per-set rates.

## Datasets and roster

| Group | Datasets (attacks / benign) |
|---|---|
| Long docs (5) | `longpi-subtle-paper-mixed` (120/100), `longpi-subtle-code-mixed` (120/100), `longpi-subtle-resume-mixed` (120/100), `longpi-email-llmail-mixed` (300/100), `longpi-authorized-benign` (0/384, benign-only) |
| BIPIA (2) | `bipia-table-mixed` (450/150), `bipia-code-mixed` (300/100) |
| QA (2) | `inj-squad-mixed` (900/300), `inj-triviaqa-mixed` (900/300) |
| Web (1) | `browsesafe-mixed` (200/200) |
| Agent (2) | `agentdojo-suites-mixed` (236/44), `nemotron-ipi-attacks` (360/0, attack-only) |
| Email (1) | `llmail-pool-attacks` (300/0, attack-only) |
| Code (1) | `repoguard-mixed` (480/95) |

Sources, licenses and design are in [PUBLIC_SOURCES](../datasets/PUBLIC_SOURCES.md#varied-prompt-injection-cohorts-2026-10-08).

Roster: the same seven conditions as the baseline (`baseline-<engine>-t4096-full`): Ornith 1.5 35B-A3B, Gemma 4
26B-A4B-it, Laguna XS 2.1 and Qwen3.6 35B-A3B (MoE); Qwen3.8 27B, Gemma 4 31B-it and Muse Glimmer 30B (dense). Order of
execution was fastest first. Qwen3.6 27B is still deferred (L147) and did not run.

## Results

### By group (mean balanced accuracy, datasets weighted equally)

| Model | Type | Overall | Long docs (5) | BIPIA (2) | QA (2) | Web (1) | Agent (2) | Email (1) | Code (1) | Pooled FPR | Abstentions (of 6,759) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gemma 4 31B-it | Dense | **0.923** | 0.917 | **0.917** | 0.921 | **0.825** | 0.999 | 0.920 | 0.923 | 17/1,973 (0.9%) | 0 |
| Gemma 4 26B-A4B | MoE | 0.922 | 0.906 | 0.904 | **0.948** | 0.820 | 0.999 | **0.943** | 0.907 | 27/1,973 (1.4%) | 2 |
| Muse Glimmer 30B | Dense | 0.904 | **0.929** | 0.839 | 0.815 | 0.765 | **1.000** | **0.943** | **1.000** | 60/1,973 (3.0%) | 0 |
| Ornith 1.5 35B-A3B | MoE | 0.895 | 0.914 | 0.857 | 0.858 | 0.662 | 0.991 | 0.886 | 0.999 | 141/1,973 (7.1%) | 2 |
| Qwen3.6 35B-A3B | MoE | 0.866 | 0.854 | 0.828 | 0.914 | 0.703 | 0.982 | 0.810 | 0.889 | 88/1,973 (4.5%) | 2 |
| Qwen3.8 27B | Dense | 0.865 | 0.908 | 0.748 | 0.730 | 0.802 | 0.999 | 0.810 | **1.000** | 43/1,973 (2.2%) | 2 |
| Laguna XS 2.1 | MoE | 0.702 | 0.685 | 0.644 | 0.591 | 0.608 | 0.955 | 0.701 | 0.709 | 147/1,969 (7.5%) | 8 |

Email here is LLMail attack recall only, and code is RepoGuard. Both are single datasets. Change from each model's
baseline overall (21 different datasets, descriptive only): Gemma31 +0.009, Muse +0.002, Gemma26 −0.001, Laguna
−0.010, Ornith −0.011, Qwen3.8 −0.030, Qwen3.6 35B-A3B −0.035.

### Per dataset (balanced accuracy)

| Dataset | Ornith | Gemma26 | Laguna | Qwen3.8 | Qwen3.6 35B | Gemma31 | Muse |
|---|---|---|---|---|---|---|---|
| `longpi-subtle-paper-mixed` | **0.967** | 0.850 | 0.562 | 0.908 | 0.850 | 0.904 | 0.892 |
| `longpi-subtle-code-mixed` | 0.867 | 0.825 | 0.583 | 0.846 | 0.725 | 0.796 | **0.921** |
| `longpi-subtle-resume-mixed` | 0.850 | 0.917 | 0.575 | 0.842 | 0.775 | **0.925** | 0.887 |
| `longpi-email-llmail-mixed` | 0.980 | 0.987 | 0.728 | 0.977 | 0.968 | **0.990** | 0.985 |
| `longpi-authorized-benign` (TNR) | 0.906 | 0.953 | **0.974** | 0.966 | 0.951 | 0.971 | 0.958 |
| `bipia-table-mixed` | 0.768 | 0.846 | 0.553 | 0.611 | 0.759 | **0.863** | 0.683 |
| `bipia-code-mixed` | 0.947 | 0.962 | 0.735 | 0.885 | 0.897 | 0.972 | **0.995** |
| `inj-squad-mixed` | 0.834 | **0.932** | 0.502 | 0.698 | 0.922 | 0.929 | 0.759 |
| `inj-triviaqa-mixed` | 0.882 | **0.964** | 0.681 | 0.761 | 0.906 | 0.912 | 0.871 |
| `browsesafe-mixed` | 0.662 | 0.820 | 0.608 | 0.802 | 0.703 | **0.825** | 0.765 |
| `agentdojo-suites-mixed` | 0.985 | 0.998 | 0.940 | 0.998 | 0.975 | 0.998 | **1.000** |
| `nemotron-ipi-attacks` (recall) | 0.997 | **1.000** | 0.969 | **1.000** | 0.989 | **1.000** | **1.000** |
| `llmail-pool-attacks` (recall) | 0.886 | **0.943** | 0.701 | 0.810 | 0.810 | 0.920 | **0.943** |
| `repoguard-mixed` | 0.999 | 0.907 | 0.709 | **1.000** | 0.889 | 0.923 | **1.000** |

Per-cell TPR and FPR with Wilson intervals, AUROC and score bands are in the JSON. In the mixed BIPIA, QA, RepoGuard
and subtle LongPI sets, BA differences come almost entirely from recall: benign specificity is 99–100% for every
model there.

**Abstentions** are rare: 0–2 per model, 8 for Laguna (all length cut-offs; 4 on subtle code). Ornith's two are
output abstentions, and the others are length cut-offs at 4,096 tokens.

## False-positive rates

Scored benign cases flagged, per benign set. The ten other benign sets (BIPIA table and code, both QA sets, RepoGuard,
AgentDojo and the four mixed LongPI sets, 1,389 cases) have 0 false positives for every model, except 1 for Ornith on
TriviaQA, 1 for Laguna on AgentDojo and 1 for Laguna on subtle code.

| Model | BrowseSafe benign (200) | Authorized-instruction docs (384) | Pooled (1,973) | Mean of 12 per-set FPRs |
|---|---|---|---|---|
| Gemma 4 31B-it | 6 (3.0%) | 11 (2.9%) | 17 (0.9%) | 0.5% |
| Gemma 4 26B-A4B | 9 (4.5%) | 18 (4.7%) | 27 (1.4%) | 0.8% |
| Qwen3.8 27B | 30 (15.0%) | 13 (3.4%) | 43 (2.2%) | 1.5% |
| Muse Glimmer 30B | 44 (22.0%) | 16 (4.2%) | 60 (3.0%) | 2.2% |
| Qwen3.6 35B-A3B | 69 (34.5%) | 19 (4.9%) | 88 (4.5%) | 3.3% |
| Ornith 1.5 35B-A3B | 104 (52.0%) | 36 (9.4%) | 141 (7.1%) | 5.1% |
| Laguna XS 2.1 | 135 (67.5%) | 10/383 (2.6%) | 147/1,969 (7.5%) | 6.1% |

The pooled rate is dominated by the larger mixed sets with zero false alarms, so the two hard sets are the
informative columns. The authorized-instruction documents (2.6–9.4%) show that every model flags some legitimate
imperatives, but rarely. BrowseSafe benign pages are where the models really differ (3–68%).

## Did the extension break saturation?

The baseline's six recommended models were within 0.028 overall (O48). The question for this suite was whether harder
and more varied data would separate them. Spread is measured on per-model BA across models: the range (max − min),
the sample standard deviation, and the share of model pairs more than 0.05 apart. 95% intervals come from 2,000
paired, class-stratified bootstrap resamples over cases. Within each dataset, attacks and benign cases are resampled
separately, and the same resample is applied to every model. Range and pair share are max-type statistics, so their
percentile intervals lean upward from the point estimate.

### Overall and same-named groups, six recommended models (15 pairs)

| Group | Baseline range | Extension range | Change [95% CI] | Baseline SD | Extension SD | Pairs > 0.05 apart (baseline → extension) |
|---|---|---|---|---|---|---|
| Overall | 0.028 | 0.059 | +0.031 [+0.023, +0.042] | 0.010 | 0.026 | 0/15 → 4/15 |
| Web | 0.025 | 0.163 | +0.138 [+0.091, +0.181] | 0.009 | 0.067 | 0/15 → 10/15 |
| Long docs | 0.053 | 0.075 | +0.022 [+0.002, +0.040] | 0.021 | 0.026 | 1/15 → 5/15 |
| Agent | 0.024 | 0.018 | −0.006 [−0.023, +0.007] | 0.010 | 0.007 | 0/15 → 0/15 |
| Email | 0.197 | 0.133 | −0.064 [−0.096, +0.003] | 0.073 | 0.062 | 11/15 → 10/15 |

Same-named groups hold different data in the two suites. Baseline web is an in-page wild sample, extension web is
BrowseSafe. Baseline long docs is the single-template LongPIBench (plus the score counterfactual), extension long
docs is the varied subtle templates, LLMail long emails and the authorized-benign controls. Baseline agent is
AgentDyn, AgentDojo travel and agent-injection-bench, extension agent is all four AgentDojo suites plus Nemotron.
Baseline email is BIPIA email plus LLMail attempts, extension email is the LLMail attack pool.

### All extension groups

| Group | Six recommended: range [95% CI] | SD | Pairs > 0.05 apart [95% CI] | All seven: range | Pairs > 0.05 (of 21) |
|---|---|---|---|---|---|
| QA | 0.219 [0.207, 0.232] | 0.082 | 11/15 [10, 12] | 0.357 | 17 |
| BIPIA | 0.170 [0.154, 0.187] | 0.061 | 10/15 [9, 11] | 0.273 | 16 |
| Web | 0.163 [0.125, 0.208] | 0.067 | 10/15 [8, 12] | 0.218 | 16 |
| Email | 0.133 [0.113, 0.187] | 0.062 | 10/15 [8, 11] | 0.242 | 16 |
| Code | 0.112 [0.094, 0.131] | 0.052 | 9/15 [9, 10] | 0.291 | 15 |
| Long docs | 0.075 [0.060, 0.091] | 0.026 | 5/15 [2, 5] | 0.244 | 11 |
| Agent | 0.018 [0.011, 0.027] | 0.007 | 0/15 [0, 0] | 0.045 | 0 |
| Overall | 0.059 [0.054, 0.067] | 0.026 | 4/15 [3, 4] | 0.222 | 10 |

**Where the expansion separated models.**
- **Web (BrowseSafe).** This is the largest change from the baseline. The models trade recall against benign false
  alarms in different ways. Gemma31 and Gemma26 flag 3.0–4.5% of benign pages and catch 68–69% of attacks, while
  Ornith catches 85% but flags 52% of benign pages. BrowseSafe also has the lowest threshold-free separation in the
  suite: AUROC is 0.783–0.856 for the six recommended models. The best web BA is 0.825, below the baseline web
  ceiling of 0.867 (O51).
- **QA (SQuAD and TriviaQA injections).** Gemma26 0.948 vs Qwen3.8 0.730. The gap is all recall: the only benign QA
  context flagged by any model is one of Ornith's 600.
- **BIPIA tables.** Recall on 450 table attacks runs from 22% (Qwen3.8) to 73% (Gemma31). BIPIA code is easier
  (0.885–0.995).
- **LLMail attack pool.** Recall is 81–94% among the six, and 70% for Laguna.
- **Subtle long documents.** Separation is moderate (5/15 pairs). Ornith leads subtle papers (0.967), Muse subtle code
  (0.921) and Gemma31 subtle résumés (0.925). LLMail-in-long-email is near ceiling (0.968–0.990).

**Where it stayed saturated.**
- **Agent tool output:** 0.955–1.000 for all seven, 0.982–1.000 for the six. Nemotron attacks are recalled at
  96.9–100%, and AgentDojo ground-truth tool outputs are classified at 0.940–1.000. Neither the baseline agent sets
  nor these separate the stronger models. [#31](https://github.com/elicollinson/solenoid-security/issues/31) proposes
  an enhanced set with subtle injections and hard negatives.
- **RepoGuard is partly saturated.** Qwen3.8, Muse (1.000) and Ornith (0.999) are at ceiling, while Gemma31 (0.923),
  Gemma26 (0.907) and Qwen3.6 35B-A3B (0.889) miss 15–22% of poisoned artifacts, mostly by scoring them exactly 0. It
  separates models only below the top three, and it has only 5 payload texts.

**Threshold or recognition?** BA at 0.5 mixes ranking with calibration (O55). AUROC ranges for the six recommended
models are still wide where BA is: QA 0.800–0.997, BIPIA tables 0.746–0.994, subtle code 0.729–0.985 and BrowseSafe
0.783–0.856. So the separation is not only a threshold effect. The leaders change, though. Muse has the highest or
tied-highest AUROC on 9 of the 11 mixed datasets (Qwen3.8 on 4, including BrowseSafe and subtle papers), but loses
BA at 0.5 because it scores many attacks in (0, 0.5]. In QA and BIPIA,
every benign case is scored 0 by most models, so AUROC there is close to the share of attacks scored above 0 (see
`scoreBands` in the JSON).

## Per-content leaders

These rows feed the recommendation profiles in [PR #34](https://github.com/elicollinson/solenoid-security/pull/34).
"Tied" means the leader's margin over the runner-up has a 95% bootstrap interval that includes 0.

| Content | Leader (BA) | Runner-up (BA) | Margin [95% CI] | Gemma31 − Gemma26 [95% CI] |
|---|---|---|---|---|
| Overall | Gemma31 0.923 | Gemma26 0.922 | +0.002 [−0.004, +0.007], tied | +0.002 [−0.004, +0.007] |
| Long docs | Muse 0.929 | Gemma31 0.917 | +0.011 [−0.002, +0.025], tied | +0.011 [−0.001, +0.023] |
| BIPIA (tables, code) | Gemma31 0.917 | Gemma26 0.904 | +0.014 [+0.002, +0.025] | +0.014 [+0.002, +0.025] |
| QA passages | Gemma26 0.948 | Gemma31 0.921 | +0.028 [+0.021, +0.035] | −0.028 [−0.035, −0.021] |
| Web pages | Gemma31 0.825 | Gemma26 0.820 | +0.005 [−0.018, +0.028], tied (Qwen3.8 0.802) | +0.005 [−0.018, +0.028] |
| Agent tool output | Muse 1.000 | Gemma26, Qwen3.8 0.999 | saturated | 0.000 [−0.003, +0.003] |
| Email attacks (LLMail) | Muse 0.943 | Gemma26 0.943 | +0.000 [−0.033, +0.033], tied | −0.023 [−0.053, +0.004] |
| Repository content | Qwen3.8, Muse 1.000 | Ornith 0.999 | tied at ceiling | +0.016 [+0.006, +0.026] |

**The default.** Gemma 4 26B-A4B remains a good default. It is tied for the best overall score, has the
second-fewest false alarms and is the fastest of the top three (3.8 s mean request vs 12.3 s for Gemma31 and 14.3 s
for Muse). Gemma 4 31B-it is preferable for BIPIA-style tables and code, repository content and false-alarm-sensitive
web screening (fewest benign flags), when its latency is acceptable. Its margins are small (0.014–0.016). Gemma26 is
better on QA passages. Muse is worth considering for long documents and repository content, but its scores need a
lower threshold to show its ranking (follow-up, not chosen here). Qwen3.8's profile in PR #34 uses a 0.15 threshold
(O55). Laguna is not recommended.

## Speed and work

| Model | Median decode (tok/s) | Mean request (s) | Median request (s) | Mean reasoning tokens | Total request time (h) |
|---|---|---|---|---|---|
| Ornith 1.5 35B-A3B | 147 | 2.3 | 1.8 | 253 | 4.3 |
| Laguna XS 2.1 | 127 | 2.8 | 2.6 | 163 | 5.2 |
| Gemma 4 26B-A4B | 114 | 3.8 | 2.7 | 361 | 7.2 |
| Qwen3.8 27B | 65 | 6.2 | 4.6 | 271 | 11.6 |
| Qwen3.6 35B-A3B | 119 | 6.6 | 6.2 | 718 | 12.4 |
| Gemma 4 31B-it | 27 | 12.3 | 9.4 | 258 | 23.2 |
| Muse Glimmer 30B | 33 | 14.3 | 12.8 | 404 | 26.8 |

The pattern matches the baseline (O52): the MoE builds decode 114–147 tok/s and the dense builds 27–65. Qwen3.6
35B-A3B is fast per token but reasons longest (718 tokens mean), so its requests take as long as Qwen3.8's. Reasoning
length is not comparable across models on a common setting (O54). Laguna reports 0 reasoning tokens on most
responses (median 0).

## Caveats

- **Template and effort differences (O54).** No model received the requested effort. Qwen3.8 ran at `xhigh` with a
  38-token instruction, Muse with "Reasoning strength: high." plus a recipients line, and the Gemmas with thinking on
  via the template. The comparison is "each model at its template default", not "each model at high".
- **Qwen3.8 calibration (O55).** At 0.5, Qwen3.8's scores are under-calibrated. A threshold of 0.15, chosen on the
  baseline, lifts its extension BA from 0.865 to 0.891 out of sample. Its QA gap is partly recognition. Muse shows a
  similar pattern in this run (high AUROC, many attacks in (0, 0.5]), which has not been tested out of sample.
- **One quantization, runtime and device.** GGUF Q8_0 in LM Studio 0.4.25 on one Mac Studio, serial, temperature 0.
  Earlier work showed that the build can change results (O32, O33, O42).
- **Single-class datasets.** Three of 14 datasets have one class. Their BA is recall (Nemotron, LLMail pool) or TNR
  (authorized benign), so the agent and email groups mix recall-only scores with mixed-class BA.
- **Equal dataset weights.** A single 300-case attack-only set is the whole email group, and one 400-case set is the
  whole web group.
- **Small attack variety in places.** RepoGuard has 5 payload texts, and the subtle LongPI sets use 24 templates per
  domain. The BrowseSafe release has no attack-type columns, so web errors cannot be broken down by attack style.
- **Bootstrap scope.** The intervals cover case sampling only, not template, model-build or run-to-run variation.
  Temperature 0 was not fully deterministic in the baseline (O47 update).
- **Labels mark attempts**, not compromise.

## Next steps

1. **[#33](https://github.com/elicollinson/solenoid-security/issues/33) effort ablation** on Qwen3.8 (`xhigh`,
   `medium`, `low`, `xhigh` without the instruction) on seeded QA, BIPIA and email subsets. A Muse threshold check
   fits naturally alongside it.
2. **[#31](https://github.com/elicollinson/solenoid-security/issues/31) enhanced agent set** (subtle tool-output
   injections plus hard negatives), because agent output is still saturated. It needs a design decision first.
3. **[#32](https://github.com/elicollinson/solenoid-security/issues/32) multi-part injections** split across inputs,
   which needs a new eval path and harness.
4. **The full abliteration run** (F7, [#23](https://github.com/elicollinson/solenoid-security/issues/23)) of both
   abliterated Qwen3.8 builds on the full protocol.
5. **The deferred Qwen3.6 27B** (L147), on the baseline and extension suites.

## Files

- [`analysis/studio-extension-t4096-2026-10-13/`](../analysis/studio-extension-t4096-2026-10-13/) holds
  `analyze-extension.ts` (this report's numbers), `summarize-model.ts` (the `MODEL_DONE` lines), `run-chain.sh`,
  `run-queue.sh`, `queue-extension.txt`, `results/extension-plan.json` and `results/extension-results.json`.
- Run checkpoints are in `runs/studio-extension-t4096-2026-10-13/` (git-ignored; 98 cells).
- Regenerate from the repository root (checkpoints for both runs and dataset sources required):
  `DATA_ROOT=<checkout with evals/private> bun evals/analysis/studio-extension-t4096-2026-10-13/analyze-extension.ts`.
