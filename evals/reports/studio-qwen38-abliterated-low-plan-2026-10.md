# Pre-registration: abliterated Qwen3.8 27B builds at `reasoning_effort: "low"` on the full Studio suites (2026-10-27)

Tracking issue [#23](https://github.com/elicollinson/solenoid-security/issues/23), stage 1 of extending `FINDINGS.md` O53
(the 998-case [abliteration pilot](abliteration-pilot-results-2026-10.md), run at `xhigh`). The comparator is the
vanilla Qwen3.8 low run ([report](studio-qwen38-low-2026-10.md), PR #51, O67), which is **not** rerun. Committed and
pushed before any call. Scripts: [`evals/analysis/studio-qwen38-abliterated-low-2026-10-27/`](../analysis/studio-qwen38-abliterated-low-2026-10-27/).

## What changes

- **Only the weights.** Two builds already on the Studio, each run with the vanilla-low engine
  (`studio-qwen38-q8gguf-lmstudio-score-v1-thinking4096-native-v0-effort-low-v1`) with only the model identity replaced
  (engine ID, loaded identifier, `lmStudio.modelKey` / `indexedModelIdentifier` / `sizeBytes`, taken from the pilot suite):
  - `qwen3.8-27b-heretic-ara`: mradermacher/Qwen3.8-27B-heretic-ara-GGUF Q8_0 (from trohrbaugh/Qwen3.8-27B-heretic-ara;
    card: KL 0.0535, 0/100 refusals). Engine `studio-qwen38-heretic-ara-q8-lmstudio-score-v1-thinking4096-native-v0-effort-low-v1`.
  - `huihui-qwen3.8-27b-abliterated`: huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF Q8_0 (classic abliteration; no KL or
    refusal figure is recorded for it here). Engine `studio-qwen38-huihui-abl-q8-lmstudio-score-v1-thinking4096-native-v0-effort-low-v1`.
- One unsent note is added to each engine's parameters, `speculative_decoding` (#52): LM Studio turns on the built-in MTP
  drafter by default for these builds, as it did for vanilla-low and the pilot. The runner does not set it. Draft counts
  are recorded per response (`usage.total_draft_tokens_count` / `accepted_draft_tokens_count`) and reported.
- **New suites, two conditions each.**
  - `prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38-abliterated-low-v1`: 21 tests, 7,326 cases.
  - `prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38-abliterated-low-v1`: 14 tests, 6,759 cases.
  - Tests, input strategy and decision rule are byte-identical to the `qwen38low` suites. `make-suites.ts` checks this
    with sorted-JSON and order-preserving diffs. It also checks that each engine differs from vanilla-low only in the
    identity fields and the note, and from the pilot engine only in effort.
  - Conditions `baseline-qwen38-heretic-ara-q8-low-t4096-full` and `baseline-qwen38-huihui-abl-q8-low-t4096-full`. Run
    directory `evals/runs/studio-qwen38-abliterated-low-2026-10-27/`.
- **Frozen as in vanilla-low:**
  - the score-only prompt and `json_schema`;
  - temperature 0, `max_tokens` 4096, context 65,536;
  - native `/api/v0`;
  - serial (parallel 1, client concurrency 1), because the comparator is serial;
  - `--require-device`, the device lock and `--continue-after-output-errors`.
  
  The user's resident Gemma 4 26B-A4B QAT instance is tolerated by name (`--tolerate-instance`, #21). Every response is
  checked for the build's identity.

## Hypotheses

- **H1 (primary).** Each build has lower balanced accuracy than vanilla-low on matched cases, per suite. The test is an
  exact two-sided McNemar on correct/incorrect at 0.5, over cases scored in both arms. Holm adjustment runs across the
  4-test family (2 builds × 2 suites). Support requires Holm p < 0.05 with fewer correct for the build. ΔBA (equal
  dataset weights) is reported with a 95% paired, class-stratified bootstrap.
- **H2.** The deficit is concentrated in missed attacks, not false alarms. Per build and suite we compare detections lost
  on positives (vanilla-low correct, build wrong) with benign cases newly flagged. H2 holds if lost detections exceed
  added false alarms and the positive-only McNemar is significant (Holm, same family of 4).
- **H3 (descriptive).** Does the O53 pattern replicate at low effort and full scale? O53's most-affected areas were
  obfuscated text (PIDS obfuscated, the encoding cohorts) and agent tool output (AgentDyn false alarms for huihui). We
  report per-group McNemar (Holm within each suite's group family) and ΔBA. We call the pattern replicated if, for a
  build, the baseline obfusc group or an agent group is among that suite's two largest group-level BA losses and is
  significant after Holm.
- **Heretic vs huihui** (secondary). Paired McNemar per suite, two-sided.
- **Covariates.** These are reported, not modeled: card refusals and KL (heretic-ara 0/100, KL 0.0535; huihui none
  published), the pilot effects (O53), mean reasoning tokens and draft acceptance.

## Order, gates and stopping rules

1. **Order:** heretic-ara baseline → huihui baseline → heretic-ara extension → huihui extension, so both builds get the
   baseline first. Each build starts with a drift tranche.
2. **Preflight.** Suite hashes (new and vanilla-low) must match `plan.json`. Every cell is dry-run for both conditions,
   and case counts must equal the plan. No device lock, no other matrix driver, nothing loaded except the tolerated
   instance, and LM Link must be connected.
3. **Drift gate per build.** Before the build's first cell, its first 24 `bipia-email-mixed` cases run. Pass requires:
   - `prompt_tokens` equal to vanilla-low on 24/24 (same embedded template);
   - the low signature: `prompt_tokens` equal to the build's own pilot xhigh − 12 on every overlapping case;
   - the build's identity (response model, Q8_0, GGUF file) on 24/24;
   - ≤ 1 abstention.

   Outcome agreement with vanilla-low is reported, not required. On failure, stop.
4. **Every cell.** The queue halts unless:
   - every case finished;
   - `prompt_tokens` equal vanilla-low on every case with usage on both sides (≥ 95% coverage);
   - every response carries the build's identity;
   - abstentions do not exceed vanilla-low's rate on the same cohort by more than 2 percentage points.

   The last item makes the "halt above 2%" rule concrete. Vanilla-low itself abstained on 3.5% of
   `encoding-eligible-existing-v1` and 2.0% of `bipia-table-mixed`, so the 2% applies to the excess. A halt is
   reported before any decision to continue.
5. **L141.** A link or provenance failure halts the queue. That cohort is rerun under a fresh condition ID and is never
   resumed.
6. **Retention.** Every checkpoint is kept, including failed cells. Nothing is overwritten, and reruns get fresh
   condition IDs.
7. **Time.** The estimate is the vanilla-low checkpoint spans (15.25 h + 10.68 h) per build: ≈ 52 h in total, likely
   less (vanilla-low's wall time was 22.3 h). The hard cap is 60 h from `CHAIN_START`.

## Analysis (fixed now)

- **Metrics per dataset, group and suite, build vs vanilla-low:**
  - BA, TPR and FPR at 0.5, abstentions, and AUROC on mixed datasets;
  - the groups are the frozen data types: baseline longdoc, email, web, agent, obfusc, benign, policy; extension
    longdoc, BIPIA, QA, web, agent, email, code;
  - datasets are weighted equally, abstentions are excluded from rates, and the two suites are never pooled.
- **Sensitivity check.** Abstentions are counted as errors.
- **What is not compared.** The pilot (xhigh) is cited for the earlier protocol only. It is not compared numerically
  with low.

## Amendment 1 (2026-10-27, 11:20–12:10Z, before any analyzed call): the effort mechanism

**What happened.** The v1 chain started at 11:17:45Z. The heretic-ara drift gate failed at 11:20:33Z and the chain
halted:
- `prompt_tokens` equaled vanilla-low on 0/24. Every case was +12, which is vanilla xhigh.
- The low signature held on 0/24. Every case was equal to heretic-ara's own xhigh pilot (Δ 0).
- Identity was correct on 24/24.

Diagnosis:
- **The templates are the same.** The GGUF chat templates of mradermacher/Qwen3.8-27B-heretic-ara-GGUF,
  huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF and lmstudio-community/Qwen3.8-27B-GGUF are byte-identical (HF API
  `gguf.chat_template`, SHA-256 `c3cf9e34…`, 8,952 bytes). LM Studio reports the same hash as the loaded template for
  both builds. All three accept `xhigh`/`medium`/`low`, with default `xhigh`.
- **The request did carry `low`.** The runner sends `parameters.reasoning_effort`.
- **LM Studio does not forward it.** For these two non-hub GGUF imports, LM Studio 0.4.25 does not pass the request's
  effort to the template. The probe ([`probe/`](../analysis/studio-qwen38-abliterated-low-2026-10-27/probe/))
  measured 136 `prompt_tokens` (xhigh) for none/xhigh/medium/low on `/api/v0` and for low on `/v1` and `/v1/responses`,
  on both builds. The hub model `qwen/qwen3.8-27b@q8_0` gets the effort, which is how vanilla-low has 124.
- **Consequence for O53.** The pilot was at xhigh as recorded, and nothing in O53 changes.

**Change (v2).** Both builds are loaded with a load-time prompt template: the embedded template with only
`default('xhigh')` changed to `default('low')`, in
[`templates/qwen38-embedded-default-low.jinja`](../analysis/studio-qwen38-abliterated-low-2026-10-27/templates/qwen38-embedded-default-low.jinja),
SHA-256 `690af918…`.
- **Why it is equivalent.** The rendered prompt is the same string that vanilla-low's request-level `low` produces. The
  probe measured 124 = low on heretic-ara. PR #49's probe found the same load-time-template route byte-identical in full
  completions for medium.
- **Runner change.** The runner gains an optional `lmStudio.promptTemplate {path, sha256}`. It loads through the SDK
  with that template, then checks the loaded template's hash, and a mismatch is a provenance failure. The request still
  sends `reasoning_effort: "low"`.
- **New IDs.** Suites `…-qwen38-abliterated-low-v2`, engines `…-effort-low-tmpl-v1`, conditions
  `baseline-qwen38-{heretic-ara-q8,huihui-abl-q8}-lowtmpl-t4096-full`.
- **Unchanged.** Hypotheses, order, gates, stopping rules and the analysis. The drift gate (prompt tokens equal to
  vanilla-low on 24/24) remains the hard check that the semantics match.
- **The failed v1 drift cell is kept, not analyzed.** It is the 24-case heretic-ara v1 checkpoint,
  `bipia-email-mixed/baseline-qwen38-heretic-ara-q8-low-t4096-full.jsonl`, an xhigh run under a low label.
- **Where it runs.** The chain runs from the feature worktree (its runner has the template pin). The main checkout's
  git-ignored data are symlinked in, so outputs and the device lock are shared. The cap is restarted at the v2
  `CHAIN_START`.
