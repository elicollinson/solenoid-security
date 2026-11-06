# Frozen joint-final detector on the full suites

**November 6, 2026.** The frozen Qwen3-4B joint weight edit from PR #61 scored all 35 existing datasets (14,085 cases) with
no abstentions and no server errors. It catches most attacks, but it raises far too many false alarms on hard benign
text to compete with the Studio models as a general detector.

| Measure | Result |
|---|---|
| Mean balanced accuracy, 35 datasets | **0.804** (baseline 0.725, extension 0.923) |
| Attacks detected, all cases | 8,469 of 8,880 (95.4%) |
| False alarms, all benign cases | 2,369 of 5,205 (45.5%) |
| Wall time | 39 min 19 s, 4 concurrent requests, no retries |

The report in PR #61 measured 93.27% recall and 8.42% false positives on its 1,066 heldout cases. Recall holds up here;
the false-positive rate does not. It is 95% on `encoding-benign-controls-v1`, 86% on `pids-hard-benign-public` and 62% on
`benign-false-positives`, three benign sets of hard or encoded text.

## Against the Studio models

Same cases and same 0.5 threshold, with each model's frozen `full` checkpoints (Qwen3.8 at `low`). The pairs are counted
on cases both models scored; a model's own abstentions are left out of its balanced accuracy. An exact McNemar test
favors the other model in the first six rows and the joint edit against Laguna, all at p < 10⁻⁴⁰.

| Model | Mean BA (joint-final 0.804) | Attacks only joint / only model | False alarms joint adds / removes |
|---|---:|---:|---:|
| Gemma 4 26B | 0.922 | 699 / 272 | 1,826 / 53 |
| Gemma 4 31B | 0.918 | 761 / 274 | 1,692 / 64 |
| Qwen3.8 27B (low) | 0.907 | 1,269 / 209 | 2,125 / 57 |
| Muse Glimmer 30B | 0.903 | 1,336 / 247 | 2,004 / 78 |
| Ornith | 0.902 | 1,089 / 255 | 2,078 / 150 |
| Qwen3.6 35B | 0.887 | 1,283 / 172 | 2,126 / 87 |
| Laguna XS 2.1 | 0.708 | 4,626 / 69 | 2,062 / 137 |

The joint edit catches more attacks than each model, and it pays for them with about 1,700 to 2,100 extra false alarms.
It scored strictly higher than every other model on six datasets: `bipia-table-mixed`, `attempt-detection`,
`browsesafe-mixed`, `inj-squad-mixed`, `inj-triviaqa-mixed` and `llmail-pool-attacks`. BIPIA tables were a named cohort
in the edit's development, so that win is not evidence of generalization on its own.

## By dataset

"Best other" is the highest of the seven models on that dataset, not one consistent competitor.

| Suite | Dataset | Cases | TP | FN | TN | FP | BA | Best other |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | longpi-paper | 400 | 300 | 0 | 95 | 5 | 0.975 | 1.000 |
| baseline | longpi-paper-abstract | 300 | 300 | 0 | 0 | 0 | 1.000 | 1.000 |
| baseline | longpi-paper-method | 300 | 300 | 0 | 0 | 0 | 1.000 | 1.000 |
| baseline | longpi-resume | 400 | 300 | 0 | 100 | 0 | 1.000 | 1.000 |
| baseline | longpi-code | 400 | 257 | 43 | 94 | 6 | 0.898 | 0.972 |
| baseline | bipia-email-mixed | 156 | 62 | 16 | 65 | 13 | 0.814 | 0.917 |
| baseline | longpi-email | 400 | 300 | 0 | 99 | 1 | 0.995 | 1.000 |
| baseline | attempt-detection | 400 | 387 | 13 | 0 | 0 | 0.968 | 0.922 |
| baseline | web-mixed | 480 | 238 | 2 | 58 | 182 | 0.617 | 0.867 |
| baseline | agentdyn-shopping | 183 | 117 | 0 | 43 | 23 | 0.826 | 1.000 |
| baseline | agentdyn-github | 237 | 190 | 0 | 19 | 28 | 0.702 | 1.000 |
| baseline | agentdyn-dailylife | 411 | 342 | 0 | 57 | 12 | 0.913 | 1.000 |
| baseline | agentdojo-travel-mixed | 21 | 18 | 0 | 0 | 3 | 0.500 | 1.000 |
| baseline | agent-injection-bench-mixed | 182 | 130 | 12 | 31 | 9 | 0.845 | 0.968 |
| baseline | pids-obfuscated | 405 | 349 | 56 | 0 | 0 | 0.862 | 0.904 |
| baseline | encoding-eligible-existing-v1 | 229 | 170 | 21 | 8 | 30 | 0.550 | 0.942 |
| baseline | encoding-benign-controls-v1 | 969 | 0 | 0 | 48 | 921 | 0.050 | 0.924 |
| baseline | benign-false-positives | 339 | 0 | 0 | 130 | 209 | 0.383 | 0.988 |
| baseline | pids-hard-benign-public | 808 | 0 | 0 | 115 | 693 | 0.142 | 0.983 |
| baseline | skill-policy-pairs | 234 | 90 | 27 | 27 | 90 | 0.500 | 0.513 |
| baseline | paper-score-counterfactual | 72 | 43 | 11 | 10 | 8 | 0.676 | 1.000 |
| extension | bipia-table-mixed | 600 | 420 | 30 | 150 | 0 | 0.967 | 0.863 |
| extension | bipia-code-mixed | 400 | 297 | 3 | 94 | 6 | 0.965 | 0.995 |
| extension | browsesafe-mixed | 400 | 173 | 27 | 170 | 30 | 0.857 | 0.825 |
| extension | nemotron-ipi-attacks | 360 | 356 | 4 | 0 | 0 | 0.989 | 1.000 |
| extension | agentdojo-suites-mixed | 280 | 233 | 3 | 34 | 10 | 0.880 | 1.000 |
| extension | repoguard-mixed | 575 | 473 | 7 | 55 | 40 | 0.782 | 1.000 |
| extension | inj-squad-mixed | 1200 | 890 | 10 | 295 | 5 | 0.986 | 0.932 |
| extension | inj-triviaqa-mixed | 1200 | 892 | 8 | 291 | 9 | 0.981 | 0.964 |
| extension | llmail-pool-attacks | 300 | 292 | 8 | 0 | 0 | 0.973 | 0.943 |
| extension | longpi-email-llmail-mixed | 400 | 253 | 47 | 99 | 1 | 0.917 | 0.990 |
| extension | longpi-subtle-paper-mixed | 220 | 104 | 16 | 95 | 5 | 0.908 | 0.967 |
| extension | longpi-subtle-code-mixed | 220 | 101 | 19 | 94 | 6 | 0.891 | 0.921 |
| extension | longpi-subtle-resume-mixed | 220 | 92 | 28 | 100 | 0 | 0.883 | 0.925 |
| extension | longpi-authorized-benign | 384 | 0 | 0 | 360 | 24 | 0.938 | 0.974 |

## Limits

- **Tuning overlap.** Several dataset families here were used to develop and check the edit. This run did not separate
  those cases, as requested, so its strong results on those families may be optimistic.
- **Different protocol.** One forward pass with the server's own prompt, against reasoning models using the frozen
  score-only prompt. The speed gain is real, but it isn't a like-for-like comparison of the same prompt.
- **No paired baseline.** Unpatched Qwen3-4B has no full-suite run here, so this run does not measure what the edit
  changed.
- **Repeatability is untested.** The 80 cases scored twice were identical, but the server caches exact duplicate inputs,
  and 1,342 of its lifetime scores came from the cache. The match may only show the cache working.
- **Unpublished serving code.** The 4-worker `/score_batch` server is not in PR #61.

## Reproduce

`evals/analysis/solenoid-joint-final-2026-11/`: `run-queue.sh` (needs `SOLENOID_SCORER_URL`) and `analyze.ts`, with the
aggregates in `results/summary.json`. All 35 checkpoints passed the shared checkpoint validator. The BA values in the
run's own `progress.log` are wrong because `check-cell.ts` misread the labels during the run; that script is fixed, and
the checkpoints and this report are unaffected.
