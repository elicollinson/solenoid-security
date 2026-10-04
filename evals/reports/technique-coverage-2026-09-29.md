# Technique, engine, and dataset coverage audit

**Historical snapshot:** the continuation now completes a separately defined active matrix of 128 full/sliding baseline cells. See [current coverage and results](current-model-research-2026-09-29.md) and [research findings](research-findings-2026-09-29.md). Tiny chunks were retired from expansion and source-span expansion deferred; their information and artifacts remain preserved. The inventory below records the earlier state and must not be mistaken for current execution status.

Audit date: September 29, 2026, America/New_York. This inventory distinguishes source implementation, historical reported results, locally validated execution, and prepared experiments. **The current experiment program does not yet establish all techniques × all models × all datasets coverage.** The most important remaining runnable gap is seeded 7/14/21-word input on the current small models, Model Armor templates, and non-web cohorts.

## Branch audit

Every local branch and fetched remote branch was inspected with `git for-each-ref`, `git ls-tree`, and the actual versions of `src/techniques.ts`, screening configuration, eval types/strategies/decisions/engines, detector candidates, and suite JSON. `origin/HEAD` aliases `origin/main`.

| Ref at audit | Commit | Technique and evaluation content | Current disposition |
| --- | --- | --- | --- |
| `origin/eval/prompt-injection-datasets-and-detectors` | `a55e709` | Public datasets; `source_spans`; task-context v1; action-provenance primitive; encoder stub; web 7/14/21 suites; direct tool-call, rationale-JSON, and score-only protocols | Included in research checkout. Latest pushed evaluation branch. |
| `codex/security-eval-lab` | `a55e709` base, with working changes | All above plus current matched matrices, neutral task-context v2, BIPIA, budget-aware batch runner, aggregate replay, and this audit | Active experimental work. New suites are distinct from pushed historical suites. |
| `origin/main` | `bbeff7b` | Shared runtime full/random/sliding segmentation, any/all/max/mean/min/custom aggregation, screening overrides; older eval framework | Included through ancestry. Shared `src/techniques.ts` blob matches the evaluation branch. |
| local `screening-config` | `1aa94fa` | Same shared runtime segmentation and screening config; additional unpushed budget checker/instructions | Budget tooling restored separately. No additional branch-only detector or segmentation kind was found. |
| local `main` | `2fb0319` | Historical migration, full/random/sliding eval types, decision replay, evaluation skills | Older ref; incorporated through ancestry. Historical Gemma Agent protocol remains distinct. |
| `origin/add-claude-github-actions-1790562325138` | `80ebc3c` | Older eval framework and Claude workflows | Ancestor of main; no additional technique beyond the above. |

The branch audit found runnable code that had not been benchmarked uniformly. It did not find another missing branch-only technique implementation.

## Evidence status

- **Locally executed:** a complete canonical checkpoint passes manifest, suite, input/context hash, dispatch/response, provider/model, and raw-output validation. Partial checkpoints and three-case smoke rows do not establish cohort performance.
- **Historical, locally replayed:** 52,335 migrated observations reproduce all 14 historical LLMail/NotInject totals. Historical Gemma uses the Agent protocol.
- **Historical, report only:** September 28 claims 29 complete public comparison cells and 34,027 observations, but their raw checkpoints are absent locally. These results remain reported evidence until reproduced.
- **Prepared:** a versioned suite exists and its plan can be computed; preparation is not execution.
- **Unrunnable:** essential input instrumentation or model artifacts are missing. Unit tests do not constitute a dataset benchmark.

## Technique inventory

| Technique / dial | Implementation and behavior | Evidence and current status | Remaining coverage |
| --- | --- | --- | --- |
| `full_text`, `last_external` | One call on last external turn | Historical report; current seven-engine matrix in progress on all five original cohorts. BIPIA suite prepared. | Complete every current cell and BIPIA, including false-positive cases. |
| `full_text`, `all_external` | Concatenates external turns only, including AIB tool definitions | New matched source-coverage control; 14-cell AIB full-versus-source-span suite prepared | Other cohorts are applicable; many are exact duplicates of last-external inputs and should be recorded as equivalents where validated. |
| `full_text`, `all` | Includes trusted, agent, and external turns | Historical Gemma4 public report; full and last-external are identical on web, LLMail, and NotInject | No fresh all-turn matrix for AIB/Dojo/BIPIA and all seven engines. This changes available information, not only segmentation. |
| `sliding_word_window`, 96 words / 64 stride | Shared runtime splitter; emits a trailing window at every stride until start reaches text length | Current 70-cell seven-engine × five-cohort full/sliding matrix running; 14 baseline BIPIA cells prepared | Current small-model cells need completion; further window sizes are untested. |
| Seeded random max 7, min 2 | Shared runtime splitter; nonoverlapping chunks, possible one-word remainder | Historical Jev/Gemma Agent on LLMail/NotInject; reported Jev/Gemma4 score-only on web | No current Gemma3/Ministral matrix, no Model Armor tiny-chunk matrix, no complete matched current protocol across all cohorts. |
| Seeded random max 14 / 21, min 2 | Same runtime splitter with independent plans per maximum | Reported Jev/Gemma4 score-only web experiments | Other cohorts, current small models, and Model Armor remain unexecuted. New 126-cell suite prepared. |
| `source_spans`, 96 / 64, `all_external` | Splits each external turn separately; stops when first final window covers its end; never crosses source boundary | Reported Jev on web/AIB/Dojo and Gemma3 context-v1 on AIB/Dojo; fresh matched AIB seven-engine control prepared | New small models and Model Armor not yet benchmarked uniformly; all other applicable distinct inputs remain gaps. |
| Task-context v1 | Includes trusted user task and original source turn IDs in judge input | Historical report only; source IDs can reveal labels, particularly Dojo clean/attack construction | Treat as leakage-confounded historical evidence. Do not use its apparent gains to establish task-context value. |
| Task-context neutral v2 | Same judgment prompt, distinct protocol/schema; sends neutral `source-0`, etc., while retaining original provenance in checkpoints | Gemma3 full/sliding prepared on AIB and Dojo; corresponding BIPIA cells prepared | No Ministral/Gemma4 contextual comparisons; no contextual source-spans or tiny chunks. Web/LLMail/NotInject lack a trusted task and are inapplicable without a new dataset. |
| Numeric max / mean / min; fixed thresholds | `decideCase`; score-only output and Jev native score remain distinct ordinal scores | Primary max `>0.5`; analyzer replays all three reductions × `.3,.5,.7,.9,.95,.99` offline over complete current logs | Replay remaining completed inputs; these are exploratory sensitivity results, not held-out calibration. Full-text reductions are identical because there is one score. |
| Binary any / all | Native Model Armor verdicts, without synthesized numeric probabilities | Primary `any`; analyzer now emits both `any` and `all` offline | Replay completed chunked observations; single-segment any/all are identical. No new calls needed. |
| Runtime custom/multi-model rules | SDK permits a custom reducer, including two-of-three; archived research reports OR/at-least-two/all-three rules | Historical ensemble aggregates; current analyzer produces paired disagreement counts | Current selected ensemble rules can reuse complete matched decisions. An arbitrary function is not a finite benchmark technique; name/version a proposed rule first. |
| Action provenance | Checks approved tools and host-supplied lineage of protected arguments | Implemented and unit-tested; no text-only condition | Unrunnable as a detection-rate benchmark on these text cohorts. Requires trusted action instrumentation and action labels. |
| Encoder candidate | Training stub deliberately throws; no checkpoint/tokenizer/calibration pinned | Unrunnable | Select/train weights, pin artifacts and disjoint calibration, then add an engine. This is not an executed small-model baseline. |

**Sliding and source spans are different plans even at 96/64.** On web, shared sliding produces 677 segments, while source spans produce 505. Sliding can add a shortened trailing window after another window already reached the text end. AIB additionally changes source selection: last-external sliding produces 275 segments; all-external source spans produce 571. A difference between those rows cannot be attributed solely to chunk boundaries.

Unseeded runtime random segmentation is implemented but not reproducible. Current evaluations pin one seed and one derivation; robustness across new seeds is a further experiment, not established evidence. Historical NotInject uses a distinct recorded seed derivation.

## Current engines and datasets

The seven baseline engines are Jev 1.13 / TypeSafe; Gemma3 4B / DeepInfra bf16; Ministral 3B (`mistralai/ministral-3b-2512`) / Mistral; Gemma4 31B / DeepInfra turbo; and Model Armor low/base/high templates. The three generic LLMs share the current score-only prompt and 64-token cap; Jev uses its own pinned question. Task-context neutral v2 currently configures Gemma3 separately with rationale output. Model Armor is binary and does not support the LLM task-context protocol. These are hosted measurements; local quantized inference is not being run.

| Cohort | Labeled attacks | Benign | Trusted task available | Full last-external calls | Sliding 96/64 calls | All-external source-span calls |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Web hard negatives | 240 | 240 | No | 480 | 677 | 505 |
| AgentInjectionBench | 142 | 40 | Yes | 182 | 275 | 571 |
| AgentDojo travel probes | 18 | 3 | Yes | 21 | 21 | 21 |
| LLMail attempt sample | 400 | 0 | No | 400 | 1,796 | 1,616 |
| NotInject | 0 | 339 | No | 339 | 339 | 339 |
| BIPIA paired email | 78 | 78 | Yes | 156 | 274 | 193 |

BIPIA contains 78 email contexts, each paired with a clean and inserted-attack version. Preserve this pairing and source split during analysis; its 156 rows are not 156 independent contexts. The label identifies an inserted attempt, not observed compromise. Dataset manifests and source hashes remain the authority for cohort membership.

## All-for-all ledger and remaining gaps

| Program | Applicable cells | Status at this audit |
| --- | ---: | --- |
| Seven baseline engines × full/sliding × five original cohorts | 70 | Running. Complete cells are independently validated; rate-limited/incomplete cells require resume. |
| Seven baseline engines × full/sliding × BIPIA | 14 | Prepared in `prompt-injection-research-round1-bipia-v1.json`. |
| Gemma3 neutral task context × full/sliding × AIB/Dojo/BIPIA | 6 | Four in context suite and two in BIPIA suite prepared. |
| Seven baseline engines × all-external full/source spans × AIB | 14 | Prepared in `prompt-injection-research-round1-coverage-v1.json`. |
| Seven baseline engines × random 7/14/21 × all six cohorts | 126 | Prepared in `prompt-injection-research-round2-tiny-chunks-v1.json`; **not launched**. Initial selected BIPIA stage would contain 21 cells. |
| Numeric max/mean/min threshold replay | 18 summaries per complete numeric run | Implemented; zero provider calls. |
| Model Armor binary any/all replay | 2 summaries per complete binary run | Implemented; zero provider calls. |
| All-turn full inputs on AIB/Dojo/BIPIA, all seven engines | 21 | Not in current fresh matrices. Other three cohorts are exact equivalents of last-external input. |
| Neutral contextual techniques for Ministral/Gemma4 | At least 12 full/sliding cells on three applicable cohorts | Not configured/executed. Further contextual source-spans and tiny chunks also remain gaps. |
| Other distinct all-external/source-span inputs, seeds, windows, repeat inference | Configuration-dependent | Not uniformly executed. Do not imply coverage from availability of the primitive. |

Coverage means complete inference for a versioned, applicable engine/strategy/cohort, or an explicit validated equivalence derivation. Equal segment counts alone do not prove equivalent inputs. Actual hash comparisons found full-input equivalence for all-turn web/LLMail/NotInject (480/400/339 cases), source-spans Dojo/NotInject (21/339), and sliding Dojo/NotInject (21/339). Other cohorts have partial equivalent subsets. Any reuse must retain traceable original responses and new configuration provenance; a file containing newly inferred scores is not required for an exactly derived equivalent cell.

## Budget-aware tiny-chunk follow-up

The new immutable suite has all seven baseline engines, all six cohort tests, and random maxima 7/14/21 with min 2, seed `20260926`, `xor_case_ordinal_v1`, and `last_external`. The primary rule is max native score `>0.5`, or any native PI verdict. Replays can examine aggregation without purchasing more calls. No live call was made to prepare or dry-run it.

| Cohort | Random max 7 | Random max 14 | Random max 21 |
| --- | ---: | ---: | ---: |
| Web | 6,668 | 3,888 | 3,564 |
| AgentInjectionBench | 2,594 | 1,511 | 1,397 |
| AgentDojo | 164 | 88 | 100 |
| LLMail | 23,005 | 13,106 | 9,909 |
| NotInject | 1,315 | 770 | 1,072 |
| BIPIA | 2,868 | 1,635 | 1,444 |
| **Calls per detector** | **36,614** | **20,998** | **17,486** |
| **Calls across seven detectors** | **256,298** | **146,986** | **122,402** |
| **Conservative OpenRouter estimate, all four numeric engines** | **$4.669** | **$2.812** | **$2.395** |

All 126 cells total **525,686 planned calls**. The current matrix runner's deliberately conservative estimate totals **$9.876** across Jev ($1.084), Gemma3 ($1.772), Ministral ($3.062), and Gemma4 ($3.958). It uses pinned script rates, one token per Unicode code unit, 300 overhead tokens, and 64 output tokens per request. These are planning estimates, exclude retries, and do not price Google Model Armor. They are not actual key usage; `bun run eval:budget` and checkpoint usage determine subsequent spending.

Stage the 21 BIPIA cells first to test paired clean-versus-attack behavior across every detector and size: 5,947 calls per detector, 41,629 across all seven, and a conservative $0.775 across the four OpenRouter engines. Then prioritize both small models across all cohorts, retain the larger model/Jev/Model Armor comparisons as explicit remaining cells, and complete them as observed budget and provider reliability permit. Provider failures at high concurrency already justify limiting Gemma3 to 16 concurrent requests after restart. A partial stage must be labeled partial rather than all-for-all completion. Free rule replay and exact equivalence reuse should precede additional inference.

## Validated interim findings

These findings use complete, unrestricted current checkpoints only. The audit snapshot in ignored `evals/runs/research-round1-2026-09-29/coverage-audit-analysis.json` validated 13 unrestricted cells in addition to smoke artifacts; ongoing execution will supersede this snapshot.

- Jev web full detects 238/240 and flags 107/240 benign windows; sliding detects the same 238 but flags 120/240. The extra trailing windows and max aggregation add benign flags in this comparison.
- Jev AIB full detects 108/142 with 0/40 benign flags; sliding detects 112/142 with 0/40. LLMail rises from 190/400 to 203/400, while NotInject remains 9/339 flags. This suggests dataset-dependent window effects; it does not establish a universally better technique.
- Gemma3 score-only full detects 349/400 LLMail attempts. On AIB it detects 115/142 and flags 6/40 benign cases; Dojo detects 12/18 with 0/3 benign flags. The completed NotInject/web comparisons and matched sliding/context cells are needed before drawing a small-model tradeoff conclusion.
- Historical stricter-threshold replay still favors full text over tiny fragments: at `>0.7`, Gemma Agent full detects 291/400 with 6/339 benign flags, versus seven-word 185/400 and 16/339. This motivates testing context-preserving small-model techniques first while measuring tiny chunks explicitly.

Wilson intervals assume independent cases. Source/template clusters, BIPIA paired contexts, and Dojo's repeated templates reduce effective sample size. Zero flags among 40 benign cases still has a Wilson upper 95% bound of 8.8%; zero among three has an upper bound of 56.1%. Fixed-threshold replays are exploratory and must not be described as held-out calibration or deployment prevalence estimates.
