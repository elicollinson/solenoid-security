# Provisional 25–40B dense versus MoE study

**Qualification update, October 4:** Qwen3.8 27B Q8 completed its 24-case
full-input protocol tranche with 18/18 attack detections, 0/6 benign flags and
no invalid outputs. There are now two qualified dense and two qualified MoE
configurations; broader Qwen coverage remains pending. Gemma26 and Ornith completed the full156 BIPIA cohort with60/78 and49/78
attack detections, respectively, both with0/78 clean flags. Qwen completed
the attempted BIPIA cohort with18/75 scored attacks detected, three attack
length abstentions and0/78 clean flags. Its numerical diagnostic is now fully
attempted:48/49 valid attacks detected, five attack length abstentions,
0/18 factual-control flags and0/15 exact endpoint-copying pairs. Muse BIPIA
is running. Qwen benign and email coverage follow. The first24 result
is a protocol check, not a complete400 benchmark or an architecture verdict.

The latest recorded inventory contains21 entries, including Qwen3.8 and Sarvam
30B Q8. Sarvam remains reserve. The Qwen inventory size differs from the pinned
single-file artifact listing; the downloaded weight hash is not verified.
Inventory, configuration and qualification evidence remain under
`model-selection-2026-10-03/` and `lmstudio-qwen38-full-2026-10-04/`.

**User-directed sequencing update, October 4:** Run the dense-versus-MoE
comparison with full input first. Defer further window conditions until the
raw full-input comparison is established. Retain completed chunking results
and the [attack-following diagnostic](injection-following-findings-2026-10-04.md)
for the later technique study. This supersedes the window-first emphasis below;
the original design remains as research history. Full input uses the fixed
detector prompt and schema; runtime/quantization/reasoning differences remain
explicit configuration confounds.

**Earlier October 4 qualification snapshot (retained for history):** The small-model confirmation is complete and
a five-model download request has now been issued (details below). The downloaded
`mlx-community/gemma-4-31b-8bit` traces to Google's base checkpoint, so it is
excluded from the intended instruction-tuned dense panel. Earlier references
below to this artifact as the available 31B candidate are superseded. Both K2
Q8 artifacts fail to load with unknown architecture on the current remote runtime.
Muse, Gemma26 and Ornith passed the initial 24-case protocol tranche. Granite is deferred after bounded output-channel and token-limit failures; its captured results are retained. All three qualified larger models have now attempted the complete 339-case benign cohort and 72-case numerical counterfactual cohort; abstentions remain explicit. Gemma26's original-paper window comparison also completed its selected first 20 families. A frozen five-configuration email comparison is underway, including the two small Gemma references. See `lmstudio-panel-notinject-2026-10-04.md`, `lmstudio-panel-numeric-probes-2026-10-04.md` and `lmstudio-long-email-panel-2026-10-04.md` for measured results. At that snapshot the remote inventory contained 19 entries and the replacement batch was pending; the newer 21-entry inventory and full-input sequencing at the top supersede those availability and scheduling statements.


Original selection state on 2026-10-03, retained for history: this was a research plan before the consolidated download request. The user subsequently downloaded candidate weights; the qualification update above supersedes that initial state. A later read-only inventory refresh no longer lists Gemma 31B GGUF Q8 or Qwen3-Coder-Next; the earlier inventory remains retained and Gemma 31B MLX 8-bit is still present. Public repository revisions, file sizes and available LFS hashes are retained under `evals/runs/model-selection-2026-10-03/`; the candidate artifact index is `q8-artifact-shortlist.json`.

## Selection revision: benchmark and practitioner evidence first

The user clarified that the next panel should come from current benchmark blogs and Reddit reports, rather than larger versions of previously used models. This supersedes the initial emphasis on familiar model families and what is already downloaded. The tables below remain a candidate inventory, not a recommendation to download every entry or a claim that all are current leaders.

Discover candidates from dated independent comparisons and practitioner reports; then verify release identity, total parameters, ancestry, weights and runtime against primary sources. A recently updated roundup can still contain old measurements. Record benchmark date, model version, quantization, reasoning settings and harness whenever available. Treat Reddit experience as a source of candidates and runtime failure reports, not a substitute for controlled detection results. Fine-tunes are eligible when evidence supports them; retain their parent-family dependence in the analysis.

| Current evidence | What it changes | Limit of the evidence |
|---|---|---|
| [TIMETOACT September comparison](https://www.timetoact-group.at/en/insights/llm-benchmarks/september-2026): Qwen3.8 27B scores 92 at Extra High reasoning; Muse Glimmer 82–84; Nemotron 3.5 Lightning 85. | Prioritize Qwen3.8 and Nemotron 3.5 for the capability-led shortlist. Muse remains a different dense-family candidate rather than a presumed co-leader. | Enterprise tasks, hosted configurations; these are not local Q8 or injection-detection measurements. |
| [September sub-40B MoE discussion](https://www.reddit.com/r/LocalLLaMA/comments/1w698ub/best_sub_40b_moe_no_hope_for_qwen3835b/) recommends Ornith 1.5 and discusses KAT, Tiel and K2 deployment. | Investigate current post-trained variants rather than automatically selecting stock Qwen or old GLM. | Anecdotes vary by harness and quant; some use repaired or altered artifacts. Pin the actual release. |
| [Local LLM Labs](https://localllmlabs.com/posts/quality-vs-speed-three-models-dgx-spark/) reports 2,800 MMLU-Pro questions per model on one DGX Spark, with Qwen3.6 dense and MoE close in aggregate and ahead of Muse in that study. | Supports testing within-model chunking changes and reporting workload-specific results, not assuming larger or newer means better. | August study, different precision/runtime configurations; does not include Qwen3.8 or establish Mac throughput. |
| [September 30 practitioner roundup](https://www.how2shout.com/ai/best-local-coding-model.html) and [local coding comparisons](https://www.reddit.com/r/LocalLLaMA/comments/1v89yxj/i_ran_the_35b_agentic_comparison_someone_asked/) expose additional candidates. | Expand screening to Laguna XS 2.1, KAT-Coder V2.5 Dev and North Mini Code. | Coding results are discovery evidence only. The August comparison predates Ornith 1.5 and must not be presented as a test of that release. |

GLM 4.7 Flash and Sarvam move to reserve status: being a fitting family representative is insufficient to call them current best. Remove the OLMo fallback from the proposed main panel; there is no current comparative evidence here justifying it over stronger candidates. Granite remains under evidence review, not guaranteed a slot because it is recent. Keep existing Gemma results as comparison evidence, without automatically promoting every larger Gemma variant. Do not force five dense models by padding the panel.

A more directly relevant [September tool-use comparison](https://www.reddit.com/r/LocalLLaMA/comments/1vyaxip/35ba3b_tool_calling_benchmark_original_qwen_vs/) ran 13 GGUFs with five seeds each, under approximately 128K tokens of distracting history. Reported mean raw points were Qwen3.8-27B 152.6, Ornith 1.5 144.2, Tiel 144.0, KAT 133.8 and stock Qwen3.6-35B 131.5. This supports prioritizing Ornith over stock Qwen for current capability, while keeping stock Qwen only if needed for a defined family/training contrast. It remains a community tool-use experiment with heterogeneous roughly-Q4 artifacts, not an injection benchmark or a Q8 result. Tiel's template/quant changes must not be counted as another independent model. The linked raw CSV is on an encrypted paste service and was not readable through the text fetch, so those aggregates have not been independently recomputed here.

Additional candidates verified after the broader search:

- [Laguna XS 2.1](https://huggingface.co/poolside/Laguna-XS-2.1): 33.44B total in the saved weight metadata, MoE; independent Poolside family. Check its exact current GGUF/MLX and template support before requesting it. The current card's license is OpenMDW 1.1; do not copy the older XS.2 release's license onto XS 2.1.
- [KAT-Coder V2.5 Dev](https://huggingface.co/Kwaipilot/KAT-Coder-V2.5-Dev): 34.66B in the metadata, approximately 3B active. Its official card identifies Qwen3.6-35B-A3B as the post-training base; some community summaries incorrectly identify Qwen3.5. Candidate for a strong current coding-trained MoE, not an independent base family.
- [North Mini Code 1.0](https://huggingface.co/CohereLabs/North-Mini-Code-1.0): official 30B/3B coding-focused MoE. Runtime and non-coding detection suitability remain to be checked.
- [AutoTrust JEV-27B](https://huggingface.co/autotrust/JEV-27B): recent decision-model release discovered during the search. Its special decision head requires its own inference path; ordinary chat generation uses the unchanged Qwen3.8 backbone. It cannot be counted as another independent dense model or evaluated through plain LM Studio chat as if that exercised the decision head. Keep as a separate future detector-adapter lead.

A further [Primitive quantization study](https://huggingface.co/primitive-ai/granite-4.2-30b-mixed-NVFP4-FP8) gives Granite comparative evidence beyond release recency: it reports 85.5 overall, versus Qwen3.8 88.8, Ornith 88.7 and Nemotron 87.1, on 1,370 knowledge/tool items. Its separate call/abstain scores show different rankings, relevant to distinguishing capability from restraint. This is a quantizer-authored, mixed-precision Blackwell/vLLM study with thinking enabled and a 16,384-token cap, not our Q8/Mac protocol. Its table incorrectly calls Muse MoE relative to Muse's official architecture description; retain architecture from primary model metadata, not this table. Small benchmark differences remain uncertain.

[Artificial Analysis's current direct comparison](https://artificialanalysis.ai/models/comparisons/qwen3-8-27b-medium-vs-muse-glimmer) uses Intelligence Index v4.3.2 and reports Qwen3.8 Medium above Muse High overall (28 versus 17), but Muse ahead on AA-LCR v1.1 (83% versus 80%). Record the index version and reasoning settings; do not combine these numbers with older index scores. This supports workload-specific selection rather than a universal ranking.

[Inkling-Small](https://thinkingmachines.ai/news/inkling-small/) was screened from the instruction-following leaderboard but excluded: 276B total parameters is outside the 25–40B panel despite its 12B active count.

The expanded community search also surfaced [Swift 1.5 Qwen3.8-27B](https://ukisai.com/swift-1-5-27b), a recent reasoning-efficiency post-training candidate. Its author reports lower reasoning use, but IFBench decreases from 73.53% to 72.07%; shorter traces are not a universal quality gain. An [independent practitioner comparison](https://www.reddit.com/r/LocalLLaMA/comments/1wuigui/peculiarragdolls_dirkqwen_3827b_vs_ukisai_swift15/) found difficult-task truncations against a differently templated/quantized Qwen derivative, so that evidence is informative but confounded. Its role would be a within-Qwen training/latency contrast, not a fifth independent dense family or a presumed best detector. The [official standard Q8 GGUF](https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF) is pinned in saved metadata (29,047,084,416 bytes). The card identifies a custom Swift license; retain that exact identity rather than inheriting Qwen's license label. Remote load/protocol compatibility still needs verification.

Bonsai 2 is a separate compact-device lead discovered through [a reproducible RTX 3090 comparison](https://github.com/ippocra/bonsai-qwen-rtx3090-benchmark). That study uses a PrismML fork after a stock-runtime failure. Keep it outside the matched-Q8 main panel: compression format and runtime would change alongside the model. Do not substitute the older downloaded Bonsai variant for this newer release.

## Question and design

Does removing surrounding document context improve injection detection more consistently for current MoE models than for similarly sized dense models? The primary measurement is each model's paired change from full input to 512-word windows with stride 384, with recall, false positives, abstentions, total request latency and generated tokens reported together. Similar **total** parameters approximate weight-memory requirements; MoE active parameters and per-token compute remain different. This is not an equal-compute comparison.

Use the same frozen cases and methods for every included model. Preserve prompt, threshold, temperature, context limit and output allowance within each model's full/window pair. Reasoning support and actual completion usage must be verified, not inferred from accepting an API parameter. Runtime load checks and a protocol smoke precede cohort expansion. Treat invalid or truncated outputs as abstentions, never benign scores or opportunities to retry for a better answer. Existing observations are reused only when the complete inference identity matches.

The candidate inventory contains four recent dense families plus a conditional fifth, and more than five MoE candidates; the evidence review has not yet selected the final panel. Prefer plain GGUF Q8_0 across the main panel, loaded serially on the same MacBook Pro, to reduce backend and quantization confounds. A filename's existence does not establish compatibility or memory fit: verify the installed remote runtime, actual template, context allocation and a small live protocol tranche after download. Keep enough memory for the KV cache and OS; do not infer fit from weight size alone.

Full input and windows will share the selected short/long, attack/clean cohorts. The small-model numeric-substitution probe is an explicit robustness diagnostic: a high concern score could be obedience to an injected request for a high rating. Include its low-target counterparts and non-directive factual-number controls. Preserve the probe's post-hoc status; it is not independent evidence of attack prevalence.

Report every model separately before architecture-group summaries. Compare Gemma dense/MoE and Qwen dense/MoE as family contrasts, while recording different training and release histories. Resample source-document families, keeping attack variants and clean siblings together; cases from one document are not independent trials. With about five models per group, any architecture association remains exploratory and may be confounded by training, tokenizer, attention design, reasoning or quantization. These APIs expose no router traces, so a difference cannot establish expert-selection causality.

An exact-input audit found all 339 NotInject examples identical under full input and 512-word windows; reuse their saved observations. In BIPIA, 154/156 cases fit in one window but only 17 inputs are byte-identical because segmentation normalizes whitespace. Stratify genuinely shortened inputs separately from formatting-only changes before attributing gains to context reduction. The complete audit and derived NotInject checkpoint provenance are retained in the local study outputs.

For chunking attribution, retain a secondary coverage-only analysis that removes redundant terminal windows where the payload was already covered, following the earlier hosted study. Derive this from saved per-segment outputs when possible; do not issue duplicate requests. Max aggregation also creates more opportunities for a false alarm, so benign full/window pairs are essential. Small-model output-budget effects must not be labeled model-size effects.

The same per-request output cap gives a windowed document more total generation opportunities than its single full-input request. Report total work per source case as well as per-request latency. A chunking gain under this protocol demonstrates a method-level tradeoff; it does not isolate context length from total compute, nor establish an expert-routing mechanism. The saved E2B fast protocol reports zero reasoning tokens, whereas E4B thinking1024 reports substantial reasoning, so their comparison also changes generation mode. Use the registered E2B thinking1024 condition for a matched-budget follow-up before attributing those differences to size.

Runtime screening now confirms [Laguna support merged into mainline llama.cpp](https://github.com/ggml-org/llama.cpp/pull/25165) on July 22, 2026. Its saved Q8 artifact is from ggml-org. This is stronger eligibility evidence than K2's still-open support request, although the remote LM Studio build still needs a load/protocol check. CLI runtime inspection exposes no remote-device selection flag in this installed version; local runtime listings are not remote-version evidence.

## What would establish a routing mechanism?

[Counterfactual routing analysis (May 2026)](https://arxiv.org/html/2605.07260v1)
tests alternative expert routes for the same token under a fixed model and
equal compute, then probes router-only updates. It provides a useful example
of evidence that can separate routing from expert capacity. It does not test
prompt-injection detection or establish that shorter inputs select better experts.
Our LM Studio API experiment cannot perform that intervention or inspect routes.

[MCF-MOE (July 2026)](https://arxiv.org/html/2607.16427v1) changes how routers
incorporate local and cross-layer context. Its history-window ablation concerns
router history across layers, not the document chunk length we change. Its
main preprocessing uses 512-token sequences. Do not cite its optimal history
setting as evidence that our 512-word detector windows improve expert selection.

[THOR-MoE (ACL 2025)](https://aclanthology.org/2025.acl-long.1040/) adds task
and context information to routing for translation. This is a counterpoint to
assuming that less context must improve routing: relevant context can help.
Our test asks whether removing surrounding document material improves measured
detection; the internal explanation remains open.

The architecture comparison should therefore establish a paired method effect
first. Position, whitespace, output budget, extra calls, false alarms and
payload-score obedience remain competing explanations to check. A consistent
MoE/dense difference would motivate a later instrumented routing study, not
complete one.

## Additional community benchmark screened

The [buried-injections benchmark](https://github.com/rudratoshs/buried-injections/tree/f2101b33d9a98fb1c7e6fa549e6dabdb063d171c)
was discovered through Reddit and its source inspected at the pinned revision.
Its loader combines AgentDojo user tasks and rotating default tool text with
27 goals in one repeated attack wrapper; these are constructed combinations,
not captured successful agent trajectories. Its HF classifiers already use
510-token windows with stride 384 and max aggregation, so its leaderboard is
not a comparison of full input against our word windows. The reported threshold
calibration result is interesting, but its nominal 2% calibration budget becomes
5/97 benign flags on held-out domains for the highlighted detector.

Defer importing this as another broad matrix: the repeated explicit wrapper is
close to the saturated attack style already covered by AgentDyn. Preserve it as
a calibration and tokenizer-validation reference. Source, license and hashes
are retained under `evals/runs/research-literature-2026-10-03/`; no upstream code
was executed and no weights downloaded. This screening does not reproduce its
numbers or imply that its repeated cases are independent.

## Additional primary benchmark audit

The [ND-DAC-DOME local comparison](https://github.com/ND-DAC-DOME/local-llm-benchmark/tree/b148fa61237edaca2edaef48d03cc1364dd46a7c)
reports budget-sensitive Muse/Qwen results on knowledge and coding tasks.
Recounting its three saved 200-item Qwen3.8 MMLU-Pro files confirms 149/200
without MTP at 12K, 154/200 with MTP at 12K, and 160/200 with MTP at 32K.
The matched-MTP pair has six losses and 12 gains; the published three/14 row
instead matches the non-MTP baseline. Summary configs for two runs also show
later speed-test settings, so they cannot alone establish the scoring budget.
Per-item completion maxima and retained run files provide additional evidence.

This recount validates stored correctness counts, not independent regrading.
The pinned sources, raw records, hashes and audit are retained under
`research-literature-2026-10-03/local-llm-benchmark-b148fa61237e/`.
Treat budget and completion rate as part of a model comparison; this external
study neither ranks injection detectors nor supplies a new independent dense
candidate. It supports retaining protocol tranches and all unfinished outputs
before interpreting the larger-panel scores.

## Dense candidates

### Download follow-up

The user reports the planned downloads are underway. A fresh remote inventory
adds five models: K2 Horizon Q8_0, Ornith 1.5 Q8_0, Muse Glimmer Q4_K_M,
Granite 4.2 MLX 8-bit, and Gemma 4 26B A4B MLX 8-bit. Gemma 4 31B MLX 8-bit
was already present. Inventory availability does not expose download progress
for models still missing, nor establish that any new model can run successfully.

Registered the five non-K2 models in
`prompt-injection-lmstudio-available-panel-thinking1024-v1.json`, with actual
remote model identifiers, format, quantization and inventory size pinned.
This is a provisional **three-dense / two-MoE available panel**, not the final
five-per-group comparison. All share the frozen five cohorts, original score
prompt, 1,024-token allowance, and full / normalized / preserved-window options.
Registration and matrix validation made no inference calls. Each model still
needs a small retained protocol tranche before expansion, after the small-model
study releases the device. Accepted reasoning parameters alone will not prove
equivalent reasoning behavior.

These downloaded variants are usable research candidates but do not constitute
the provisional matched-Q8 panel: Muse is Q4, and three models use MLX. Keep
those confounds in all comparisons. Ornith's inventory size is 38,704,971,520
bytes, different from the previously pinned single-GGUF size of 37,802,149,280;
record the actual inventory value without claiming the earlier weight hash was
verified. K2 is downloaded but remains outside automatic execution until runtime
compatibility is established. No replacement downloads are requested while the
user's current batch is in flight.

Raw inventory, its hash, model-by-model availability and the dry-run matrix are
retained in `evals/runs/model-selection-2026-10-03/`. Qwen3.8, Swift 1.5,
Nemotron 3.5 Lightning, Laguna, KAT, stock Qwen3.6 MoE and North Mini were not
visible in this snapshot; that is not a failed-download diagnosis.

A later snapshot, `inventory-post-e4b-window.json`, also lists K2 Horizon MoVA
36B A4B Q8_0 on the remote MacBook Pro (39,831,174,496 inventory bytes). Both
K2 variants are now downloaded but remain conditional on runtime validation.
The MoVA inventory's `paramsString` reads `91x3.7B`; retain that raw metadata
without interpreting its product as the model's total parameters. Architecture
and total/active size claims come from the pinned primary model metadata, while
inventory size alone does not verify the weight hash. No new eligible main-panel
model or successful K2 inference is claimed by this read-only refresh.

| Model | Total parameters | Role / availability |
|---|---:|---|
| [Gemma 4 31B](https://huggingface.co/google/gemma-4-31B-it) | 31B | MLX 8-bit remains downloaded; the latest inventory no longer lists its GGUF Q8_0. A matched-Q8 panel would need that artifact again. Candidate same-family contrast with Gemma 26B MoE. |
| [Qwen3.8 27B](https://huggingface.co/Qwen/Qwen3.8-27B) | nominal 27B | Current dense Qwen candidate; plain Q8_0 artifact found. |
| [Muse Glimmer 30B](https://huggingface.co/meta-models/Muse-Glimmer-30B) | about 29.6B including vision | August 2026 dense model. Record local/global attention pattern; text-only study. Plain Q8_0 artifact found. |
| [Granite 4.2 30B](https://huggingface.co/ibm-granite/granite-4.2-30b) | 30B | August 2026 dense model; official Q8_0 artifact found. |
| [K2 Horizon 32B](https://huggingface.co/IFM/K2-Horizon-32B) | 32B | Conditional only: Stage1 checkpoint and runtime support require resolution. Do not request its GGUF for standard LM Studio yet. |

K2's official [GGUF card](https://huggingface.co/IFM/K2-Horizon-32B-GGUF) requires a custom llama.cpp fork. The [upstream support request](https://github.com/ggml-org/llama.cpp/issues/29424), opened September 25, is still open in this check. The [MLX-VLM port](https://github.com/Blaizzy/mlx-vlm/blob/main/mlx_vlm/models/k2_horizon/README.md) supports dense K2 but explicitly excludes the MoE variant. That does not establish support in the remote LM Studio runtime. Generic Hugging Face app links are not runtime validation.

If K2 remains unavailable, do not quietly pad the cutting-edge panel with old models merely to reach five. Continue the benchmark-led candidate search or report a smaller eligible dense panel transparently. Selection remains open until the download handoff.

## MoE candidates

| Model | Total / active parameters | Role / availability |
|---|---:|---|
| [Gemma 4 26B A4B](https://huggingface.co/google/gemma-4-26B-A4B-it) | 26B / about 4B | Main family contrast; Q8_0 artifact found. Select the full model, not an MTP draft. |
| [Qwen3.6 35B A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | 35B / about 3B | Current fitting general-purpose Qwen MoE found in this search; Q8_0 artifact found. |
| [Nemotron 3.5 Lightning 30B A3B](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16) | 30B / about 3B | August successor candidate to the downloaded Nano 3. Hybrid Mamba/attention/MoE; analyze that distinction explicitly. |
| [GLM 4.7 Flash](https://huggingface.co/zai-org/GLM-4.7-Flash) | 30B / about 3B | Reserve only. Downloaded MLX 8-bit; fitting the size band alone is insufficient evidence for the main current-best panel. |
| [Ornith 1.5 35B A3B](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B) | about 35B / about 3B | August release; official Q8_0 and MLX artifacts exist. Qwen-derived continued training, **not an independent architecture family**. Useful training-recipe contrast, with family dependence retained. |
| [Sarvam 30B](https://huggingface.co/sarvamai/sarvam-30b) | nominal 30B / 2.4B non-embedding | Reserve independent family; comparative evidence and community GGUF correctness/runtime compatibility still need verification. |
| [K2 Horizon MoVA 36B A4B](https://huggingface.co/IFM/K2-Horizon-MoVA-36B-A4B) | 36B / about 4B | Attractive within-family contrast if support arrives; currently conditional due to runtime limitations above. |

[GLM 5.3 Flash](https://huggingface.co/zai-org/GLM-5.3-Flash-BF16) is **320B total / 18B active**, despite its name; exclude it. LFM2 24B A2B is below the requested total-parameter band and has a native context limitation relevant to the existing local preset; do not silently count it as a 25B model. The downloaded Qwen 27B fusion/distillation variants are altered checkpoints. They are eligible if comparative evidence supports selecting them, with their ancestry and altered training recorded; their availability alone does not justify inclusion. Multiple quants do not count as multiple models.

## Relation of the new score-steering finding to prior work

The broad vulnerability is established. [JudgeDeceiver](https://arxiv.org/abs/2403.17710) attacks LLM judges through attacker-controlled candidate responses. [How Not to Detect Prompt Injections with an LLM](https://arxiv.org/abs/2507.05630) shows adaptive evasion of known-answer detectors; our concern-score detector is a different protocol, so do not present those results as direct replication. The contribution worth testing here is narrower: paired in-range numerical substitutions reveal apparent true positives caused by payload compliance, under small quantized local models and chunking variants.

[RAPIDS](https://aclanthology.org/2026.acl-industry.127/) evaluates a fine-tuned small detector and verifier cascade for resume injections. That motivates a later specialized-model baseline if suitable artifacts and licenses are available. Its domain-specific gains cannot be transferred to this study's document and code cohorts without measurement. Do not replace the current controlled comparison with a large unplanned dataset expansion while E4B's baseline remains in flight.


## October 4 user-managed download batch

Skip entries already in the existing download queue. Metadata and revisions are
pinned in `model-selection-2026-10-03/next-download-batch-2026-10-04.json`.

| Model | Exact repository / format | Purpose |
|---|---|---|
| Gemma 4 31B **instruction tuned** | [lmstudio-community/gemma-4-31B-it-MLX-8bit](https://huggingface.co/lmstudio-community/gemma-4-31B-it-MLX-8bit) | Correct the base-artifact substitution; pair with the available Gemma MoE MLX8 |
| Qwen3.8 27B | [unsloth/Qwen3.8-27B-GGUF](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF), Q8_0 | Current dense Qwen baseline |
| Nemotron 3.5 Lightning 30B-A3B | [unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF](https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF), Q8_0 | Current MoE family |
| Laguna XS 2.1 | [ggml-org/Laguna-XS-2.1-GGUF](https://huggingface.co/ggml-org/Laguna-XS-2.1-GGUF), Q8_0 | Additional MoE family |
| KAT-Coder V2.5 Dev | [bartowski/Kwaipilot_KAT-Coder-V2.5-Dev-GGUF](https://huggingface.co/bartowski/Kwaipilot_KAT-Coder-V2.5-Dev-GGUF), Q8_0 | Current Qwen-derived MoE training contrast |

This batch does not create five independent dense families. Swift remains an
optional within-Qwen efficiency contrast; K2 remains conditional on runtime
support. Do not pad the panel with older checkpoints merely to reach a count.
