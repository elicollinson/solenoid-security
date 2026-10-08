# Literature scan: related work not previously cited (2026-10-05)

Hugging Face papers search plus arXiv, covering topics in [FINDINGS](../FINDINGS.md) (O1–O44, F1–F4). Every paper
below was absent from the repo's reports, FINDINGS, README, dataset docs and handoff notes. Already cited: BIPIA
2312.14197, JudgeDeceiver 2403.17710, How Not to Detect PI with an LLM 2507.05630, AgentDyn 2602.03117, Skill-Inject
2602.20156, LongPIBench 2608.28411, SkillSecurer 2609.14079, PIDS 2609.15017, RAPIDS, THOR-MoE, plus the NotInject,
LLMail, AgentDojo and buried-injections repos.

Verification: arXiv abstract pages were checked for all entries. The DeFuse windowing details (W=15, S=5, max
pooling, FastText + calibrated linear SVM, 1−(1−p)^N false-positive compounding) and the 2610.03448 findings were also
confirmed against the full text or abstract by the orchestrator. "Capable Enough to Be Hijacked" is a Zenodo preprint,
not arXiv.

## Most important

1. **DeFuse, "Defusing Explosive Prompts"** ([2609.22510](https://arxiv.org/abs/2609.22510), Sep 2026). Classifier
   (FastText + SVM) scoring 15-word sliding windows (stride 5), max window score as the document score. AUC ≥ 0.998
   across lengths, but at a fixed threshold false positives compound with the number of windows (98% at p=0.01 for a
   2,000-word document), so length-aware thresholds are needed. **Closest prior art to our windowing idea**, using a
   classifier rather than an LLM judge. Supports O8–O10 and O16–O17.
2. **AgentWatcher** ([2604.01194](https://arxiv.org/abs/2604.01194), Apr 2026). Detectors degrade with context length.
   It attributes agent actions to a few causal context segments, then has a rule-based LLM monitor judge them. A
   different way to shorten what the judge sees. Supports O1/O2; partly anticipates F4.
3. **Passing the Test You Trained On** ([2610.03448](https://arxiv.org/abs/2610.03448), 2 Oct 2026). 15 detectors on
   AgentDojo and tau-bench tool outputs plus BIPIA. Rankings transfer poorly, false-positive rates range 0–90%, and the
   best BIPIA detector catches 2% of AgentDojo injections at 1% FPR. Supports O30, O32–O34 and the ranking-vs-threshold
   point.
4. **Confidently Wrong** ([2606.22659](https://arxiv.org/abs/2606.22659), Jun 2026). ProtectAI-v2 and Prompt Guard 2
   miss attacks with 0.99–1.00 confidence and share a blind spot on indirect behavior-hijack injections. Parallels
   O15/O18.
5. **When Benchmarks Lie** ([2602.14161](https://arxiv.org/abs/2602.14161), Feb 2026). Leave-one-dataset-out across 18
   datasets: standard splits inflate AUC by ~8.4 points. Prompt Guard 2, LlamaGuard and LLM judges catch 7–37% of
   indirect agent attacks. Supports O32–O37.
6. **The Silent Hyperparameter** ([2605.19537](https://arxiv.org/abs/2605.19537), May 2026). With weights, decoding and
   hardware fixed, the inference backend alone shifts scores by up to 16.6 points (prefix caching is one cause).
   Strongest prior support for F2; no MLX and no safety tasks.
7. **Quality Is Not a Safety Proxy Under Quantization** ([2606.10154](https://arxiv.org/abs/2606.10154), Jun 2026).
   Across a 7-level GGUF ladder plus AWQ/GPTQ, refusal drops 12–68 points while quality holds. Template for backlog
   item 6 (quantization ladder).
8. **Temperature and LLM-judge reproducibility** ([2606.26185](https://arxiv.org/abs/2606.26185), Jun 2026). Safety
   verdicts flip even at temperature 0 / top_k=1. Supports O34 and the variance lesson.

## All relevant new papers

| Topic | Paper | What it does | Relates to | Relation |
|---|---|---|---|---|
| Segmenting / chunking | [2609.22510](https://arxiv.org/abs/2609.22510) DeFuse | Max over word windows (classifier) | O8–O10, O16 | Supports; partial prior art |
| | [2604.01194](https://arxiv.org/abs/2604.01194) AgentWatcher | Long-context degradation; segment attribution | O1, O2, F4 | Supports / extends |
| | [2608.05430](https://arxiv.org/abs/2608.05430) | Query-aware sentence-level detection, adversarial training | O1, O8 | Extends: segment level with context |
| | [2502.16580](https://arxiv.org/abs/2502.16580) | Indirect-injection detection benchmark plus segmentation-based removal | O1 | Related prior art |
| | [2511.10720](https://arxiv.org/abs/2511.10720) PISanitizer | Attention-based token sanitization for long context | O1, O19 | Untested alternative |
| | [2602.07918](https://arxiv.org/abs/2602.07918) CausalArmor | Leave-one-out segment attribution | F4 | Untested |
| Detector benchmarks / transfer | [2610.03448](https://arxiv.org/abs/2610.03448), [2602.14161](https://arxiv.org/abs/2602.14161), [2605.26999](https://arxiv.org/abs/2605.26999) | Out-of-distribution failure; no universal best detector | O30, O32–O37 | Support |
| | [2510.01354](https://arxiv.org/abs/2510.01354) WAInjectBench | Detectors fail on attacks without an explicit instruction | O2, O15 | Supports |
| | [2604.08499](https://arxiv.org/abs/2604.08499) PIArena | Unified platform; adaptive attacks; injected task aligned with user task | O12, O24 | Extends |
| | [2606.22659](https://arxiv.org/abs/2606.22659) Confidently Wrong | Confident misses | O15, O18 | Supports |
| | [2505.12368](https://arxiv.org/abs/2505.12368) CAPTURE | Context-aware detection and over-defense | O24, O25 | Supports |
| LLM as detector or judge | [2603.25176](https://arxiv.org/abs/2603.25176) | Lightweight production LLM judges; mixture of models gives modest gains | O10, O31 | Supports |
| | [2507.15219](https://arxiv.org/abs/2507.15219) PromptArmor | Off-the-shelf LLM detect-and-remove; <1% FPR/FNR on AgentDojo | O20–O23 | Contrasts: frontier models, short tool outputs |
| | [2605.30837](https://arxiv.org/abs/2605.30837) SCOUT | Per-request detector selection | O10 | Extends |
| Judge steering | [2505.13348](https://arxiv.org/abs/2505.13348), [2504.18333](https://arxiv.org/abs/2504.18333), [2508.07805](https://arxiv.org/abs/2508.07805) | Injection or persuasion inflates judge scores; smaller models more susceptible | O12–O14, O41 | Supports; no paired counterfactuals on detectors |
| | [2510.09462](https://arxiv.org/abs/2510.09462) | Adaptive attacks on LLM monitors | O12 | Supports / extends |
| Peer review domain | [2605.25415](https://arxiv.org/abs/2605.25415), [2512.10449](https://arxiv.org/abs/2512.10449) | Hidden prompts raise review scores (flip rate up to 86%) | O2, O15 | Context for the "naive" paper template |
| Reasoning | [2507.15974](https://arxiv.org/abs/2507.15974) | More inference-time compute helps robustness, but reverses when reasoning is exposed | O29, O38 | Extends |
| | [2506.13726](https://arxiv.org/abs/2506.13726) | Mixed robustness of reasoning models, attack-dependent | O29 | Supports |
| Distillation | [2601.03868](https://arxiv.org/abs/2601.03868) | Distillation and post-training can degrade safety (jailbreaks) | F1 | Motivates F1 |
| MoE | [2605.02946](https://arxiv.org/abs/2605.02946) RouteHijack, [2602.04448](https://arxiv.org/abs/2602.04448) RASA, [2609.02293](https://arxiv.org/abs/2609.02293) SEAL | Safety localized in experts; routing-aware jailbreaks | O26–O28 | Not tested by us (routing); none on detection |
| Quantization / runtime | [2606.10154](https://arxiv.org/abs/2606.10154), [2605.19537](https://arxiv.org/abs/2605.19537), [2606.26185](https://arxiv.org/abs/2606.26185) | See above | O32, O33, O38, F2 | Support |
| | [Capable Enough to Be Hijacked](https://zenodo.org/records/22962299) (Zenodo, Sep 2026) | Qwen2.5 0.5B/1.5B across GGUF levels; Q4_K_M ≈ F16, Q4_0 not | F2, O32 | Supports |
| Over-defense | [2606.30783](https://arxiv.org/abs/2606.30783) SecFid | Security vs fidelity frontier | O24 | Extends |
| | [2605.17634](https://arxiv.org/abs/2605.17634) | Contextual-integrity impossibility argument | O24 | Framing |

## Datasets and benchmarks worth adding

- **BrowseSafe-bench** (`perplexity-ai/browsesafe-bench`; [2511.20597](https://arxiv.org/abs/2511.20597)): web-agent injections in realistic HTML.
- **WAInjectBench** (`Norrrrrrr/WAInjectBench`): benign segment categories plus attacks without an explicit instruction (O15).
- **ResumeShield** ([2609.20188](https://arxiv.org/abs/2609.20188)): 104 résumés, 9 concealment techniques, Apache-2.0. Fills our résumé gap.
- **LLM-as-a-Reviewer** ([2605.25415](https://arxiv.org/abs/2605.25415)) and **Reject→Accept** ([2512.10449](https://arxiv.org/abs/2512.10449)): real papers for the fresh long-document cohort (backlog item 3).
- **SecFid**, **CAPTURE**, **PIArena**, and the leave-one-dataset-out suite from [2602.14161](https://arxiv.org/abs/2602.14161).
- The AgentDojo + tau-bench tool-output replay method from [2610.03448](https://arxiv.org/abs/2610.03448).

## Novelty check against the FINDINGS §6 blog angles

1. **"Detector can be talked into a score."** The general vulnerability is well established (JudgeDeceiver, 2505.13348,
   2504.18333, 2508.07805, 2510.09462). No paper found uses paired score counterfactuals on injection detectors or
   measures copying of the requested number. **Still looks new.**
2. **"Chunking helps — sometimes."** Partial prior art: DeFuse (max over windows, classifier, same AUC-stable /
   threshold-fragile pattern), AgentWatcher, 2608.05430. No domain-stratified LLM-judge chunking study or
   chunk-size/specificity analysis found. Frame as "first domain-stratified LLM-judge study", not "chunking for
   detection is new"; cite DeFuse.
3. **"Abstentions, zero-score collisions, threshold trap."** The threshold-vs-AUC point is supported by DeFuse and
   2610.03448. Abstentions and zero-score collisions look new; nearest neighbour is 2606.22659.
4. **"Hosted benchmarks don't transfer for free."** Strong support from 2605.19537, 2606.10154, 2606.26185 and
   2610.03448. Novel part: injection detection on local runtimes. **No MLX-vs-GGUF study found.**
5. **"Managed guardrails vs small open models."** No paper evaluates Model Armor. Prompt Guard 2 / LlamaGuard /
   ProtectAI results (2602.14161, 2606.22659) are consistent with ours.
6. **"MoE vs dense for on-device screening."** No MoE-vs-dense injection-detection comparison found. RouteHijack, RASA
   and SEAL (jailbreaks, expert-localized safety) justify the "routing is unobserved" caveat.

**Future avenues:** F1 open (only indirect jailbreak evidence, 2601.03868). F2 open (nearby backend and GGUF work, no
MLX). F3 nothing found. F4 looks novel: AgentWatcher, CausalArmor and 2610.03448 link detection to agent behavior, but
none replays a model's own detector misses against an agent built on that model.

Thin areas: HF papers had nothing on MoE detection, MLX, or coding models as detectors.
