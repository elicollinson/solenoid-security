# Prompt-injection detector runs on the new datasets

Run date: September 28, 2026. These are aggregate results from local evaluation runs. Raw provider checkpoints and case-level outputs remain ignored under `evals/runs/`; generated dataset JSONL files are also omitted from Git. Rebuild the public inputs with `bun run eval:fetch-public` before reproducing a run.

**Metric key:** detection = true positives / labeled attacks; false positives = benign cases flagged / labeled benign. Counts are shown so small denominators stay visible. All rows have complete case and segment coverage.

## In-page web (240 attack / 240 benign)

Each case contains a **stored web-page context window**, not an entire web page. A *full stored window* row sends all of that case's text in one call. In this initial table, only the Jev span row splits it: overlapping 96-word windows, advanced 64 words at a time, with a case flagged if any span scores above 0.5. Gemma and Model Armor in this table received full stored windows. The separate 7/14/21-word Jev and Gemma runs appear immediately below.

| Detector | Input sent per call | Detection | False positives | Confusion matrix (TP/FN/FP/TN) | Calls |
| --- | --- | ---: | ---: | ---: | ---: |
| Jev | Full stored window | 99.2% (238/240) | 43.8% (105/240) | 238/2/105/135 | 480 |
| Jev | Overlapping 96-word spans (64-word stride) | 99.2% (238/240) | 44.6% (107/240) | 238/2/107/133 | 505 |
| Gemma 4 31B | Full stored window | 96.7% (232/240) | 27.5% (66/240) | 232/8/66/174 | 480 |
| Model Armor · low | Full stored window | 27.5% (66/240) | 5.4% (13/240) | 66/174/13/227 | 480 |
| Model Armor · base | Full stored window | 57.9% (139/240) | 55.4% (133/240) | 139/101/133/107 | 480 |
| Model Armor · high | Full stored window | 78.3% (188/240) | 66.2% (159/240) | 188/52/159/81 | 480 |

### Smaller nonoverlapping chunks: 7, 14, and 21 words

These follow the original **seeded random, nonoverlapping** chunk method: chunk lengths vary from 2 words up to the stated maximum (a final remainder may be 1 word). The web runs use seed `20260926`, `xor_case_ordinal_v1` derivation for both labels, and only the stored external context window. The historical NotInject benign run used a different seed derivation, so this is a new web-cohort experiment, not a replay of those historical chunks. A case is flagged when **any** chunk's native score is greater than 0.5. Calls are per detector; chunk boundaries are identical for Jev and Gemma at each size.

| Input | Jev detection | Jev false positives | Gemma detection | Gemma false positives | Calls per detector |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full stored window | 99.2% (238/240) | 43.8% (105/240) | 92.5% (222/240) | 24.6% (59/240) | 480 |
| Random chunks, max 7 words | 100.0% (240/240) | 100.0% (240/240) | 100.0% (240/240) | 97.5% (234/240) | 6,668 |
| Random chunks, max 14 words | 100.0% (240/240) | 96.7% (232/240) | 99.2% (238/240) | 87.5% (210/240) | 3,888 |
| Random chunks, max 21 words | 100.0% (240/240) | 95.4% (229/240) | 99.6% (239/240) | 74.2% (178/240) | 3,564 |

The Gemma column uses **Gemma 4 31B with a versioned score-only JSON-schema prompt** (`gemma-4-31b-deepinfra-score-only-json-v1`, 64 output-token cap). Its full-window row was rerun with that same protocol. It should be compared within this table, not directly with the earlier Gemma tool-call full-window row above: the prompts and response protocols differ. The original tool-call protocol failed to return a tool call on a tiny fragment; a rationale-bearing JSON protocol also left 7- and 14-word runs incomplete. Those incomplete runs are excluded from the table. All eight detector-by-input conditions in this table have complete case and segment coverage.

At this fixed threshold, the 7-word method flags nearly every benign case. Increasing the maximum to 21 words reduces false positives, but both detectors remain substantially above their full-window false-positive rates. The thousands of chances for one chunk to cross 0.5 are part of the effect. The web benign cohort is deliberately hard-negative and is not prevalence-weighted.

## AgentInjectionBench (142 / 40)

| Condition | Detection | False positives | Confusion matrix (TP/FN/FP/TN) | Calls |
| --- | ---: | ---: | ---: | ---: |
| Jev · external source | 77.5% (110/142) | 0.0% (0/40) | 110/32/0/40 | 182 |
| Jev · source spans | 76.8% (109/142) | 0.0% (0/40) | 109/33/0/40 | 571 |
| Gemma 4 31B · external source | 88.0% (125/142) | 0.0% (0/40) | 125/17/0/40 | 182 |
| Gemma 4 31B · all turns | 95.8% (136/142) | 0.0% (0/40) | 136/6/0/40 | 182 |
| Gemma 3 4B · task context + spans | 95.1% (135/142) | 12.5% (5/40) | 135/7/5/35 | 571 |
| Model Armor · low | 7.7% (11/142) | 0.0% (0/40) | 11/131/0/40 | 182 |
| Model Armor · base | 15.5% (22/142) | 0.0% (0/40) | 22/120/0/40 | 182 |
| Model Armor · high | 24.6% (35/142) | 2.5% (1/40) | 35/107/1/39 | 182 |

## AgentDojo travel (18 / 3)

| Condition | Detection | False positives | Confusion matrix (TP/FN/FP/TN) | Calls |
| --- | ---: | ---: | ---: | ---: |
| Jev · external source | 100.0% (18/18) | 0.0% (0/3) | 18/0/0/3 | 21 |
| Jev · source spans | 100.0% (18/18) | 0.0% (0/3) | 18/0/0/3 | 21 |
| Gemma 4 31B · external source | 100.0% (18/18) | 0.0% (0/3) | 18/0/0/3 | 21 |
| Gemma 4 31B · all turns | 100.0% (18/18) | 0.0% (0/3) | 18/0/0/3 | 21 |
| Gemma 3 4B · task context + spans | 100.0% (18/18) | 66.7% (2/3) | 18/0/2/1 | 21 |
| Model Armor · low | 50.0% (9/18) | 0.0% (0/3) | 9/9/0/3 | 21 |
| Model Armor · base | 83.3% (15/18) | 0.0% (0/3) | 15/3/0/3 | 21 |
| Model Armor · high | 100.0% (18/18) | 0.0% (0/3) | 18/0/0/3 | 21 |

## Readout

- **Web:** Jev detects 238/240 labeled attacks but flags 105/240 benign cases. Gemma 4 external-source detects 232/240 with 66/240 false positives. The web benign set was deliberately selected for attack-adjacent, hard-negative context; these false-positive rates are not population prevalence estimates.
- **AgentInjectionBench:** Gemma 4 all-turn input detects 136/142 with 0/40 false positives, but it receives trusted/system/tool context that external-source screening does not. Gemma 3 task-context + spans detects 135/142 with 5/40 false positives. Jev external-source detects 110/142 with 0/40; source spans do not improve it at the exploratory 0.5 rule. Model Armor high detects 35/142 with 1/40 false positives.
- **AgentDojo travel:** Most detectors identify all 18 template-derived attack texts. The task-context Gemma judge flags 2 of just 3 clean cases, so its 66.7% false-positive rate is highly uncertain. These probes are not agent execution traces or attack-success measurements.
- **Span strategy:** On the web dataset, only Jev was evaluated both ways: 96-word overlapping spans yielded 238/240 detections and 107/240 false positives, versus 238/240 and 105/240 when each stored context window was sent whole. On AgentInjectionBench, Jev spans detected 109/142 versus 110/142 with its full external-source input. This configuration offers no observed gain at the 0.5 threshold; other window sizes and thresholds remain untested.

## Scope and interpretation

- The three datasets have different construction and benign-case sampling. Do not pool their rates or interpret them as real-world attack prevalence. Labels identify attempted injection text, not whether an agent complied.
- The common numeric decision rule is raw score greater than 0.5, exploratory for these new combinations. Model Armor returns a binary PI match rather than a comparable calibrated score.
- The in-page web cases lack a trusted user task, so the task-context Gemma condition cannot run on them. The web `all turns` and `external source` inputs are identical for all 480 cases, so a duplicate Gemma call set was skipped.
- The action provenance monitor needs host-supplied tool-call argument lineage, which these text datasets do not contain. The fine-tuned encoder remains a non-runnable training TODO.
- Transient provider failures were inspected before checkpointed retries. The matched runs in the tables have complete coverage; incomplete diagnostic Gemma protocols are excluded.

## Reproduction and validation

- Suite definitions: `evals/suites/prompt-injection-public-datasets-v1.json`, `evals/suites/prompt-injection-detector-candidates-v1.json`, `evals/suites/prompt-injection-web-small-chunks-v1.json` (Jev), and `evals/suites/prompt-injection-web-small-chunks-scoreonly-v1.json` (matched Gemma) in this repository. Small-chunk strategies are `web-random-nonoverlap-min2-max{7,14,21}-seed20260926-v1`; the decision rule is `max-score-gt-0.5`. These segments require new inference; only threshold changes can be replayed from saved raw scores.
- Dataset provenance and sampling: `evals/datasets/PUBLIC_SOURCES.md`; detector definitions and limits: `evals/DETECTOR_CANDIDATES.md`.
- `git diff --check`, `bun run eval:typecheck`, `bun run typecheck`, and all 19 evaluation tests pass. The main comparisons use 29 complete condition-by-dataset runs with 34,027 scored observations. Two further rationale-JSON diagnostic conditions completed but are excluded from the matched chunk-size table; other failed diagnostic checkpoints remain incomplete.
