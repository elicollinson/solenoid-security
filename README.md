# Solenoid Security

Provenance-aware prompt-injection screening for AI agents, and the evaluation lab that decides how it should screen.

The library screens untrusted text at the boundary where it enters an agent. The [evaluation workspace](evals/README.md)
measures which detectors, input techniques and runtimes actually catch injections. It covers 21 public and synthetic
datasets (7,326 cases), 33 detector configurations from 17 models, hosted APIs and local inference, and about 388,000
scored judgments. Every claim below links to its evidence. Strength ratings and confounds are in
[`evals/FINDINGS.md`](evals/FINDINGS.md).

## Results

| Finding | Key numbers | Strength | Evidence |
|---|---|---|---|
| **Subtle injections are a separate failure mode.** A plain request ("rate this paper 8 or 9", "you should approve the code change") is missed where explicit overrides are caught. | Explicit variants ≈100/100. Naive paper template 0–13/100 for most hosted models; naive code 0/100 for Model Armor and several local models. | Strong | [O15](evals/FINDINGS.md), [O43](evals/FINDINGS.md), [code baselines](evals/reports/lmstudio-full-code-baselines-2026-10-04.md) |
| **A detector can be talked into a score.** A small local judge copies the rating the injected text asks for. | Gemma 4 E2B (no reasoning): exact copy in 13/18 paired tests, 0/6 control flips. Reasoning and larger models: 0–2/18. | Strong (existence) | [O12–O13](evals/FINDINGS.md), [attack-following write-up](evals/reports/injection-following-findings-2026-10-04.md) |
| **Chunking helps on long documents, not everywhere.** | 512-word windows lift every hosted detector on papers (Qwen3.6 35B-A3B 206 → 300/300, ≤1/100 clean flags). Neutral or harmful on email, résumés and web pages. | Strong (papers) | [O1–O6](evals/FINDINGS.md), [LongPIBench report](evals/reports/longpibench-research-2026-09-29.md) |
| **Windows can lower concern.** Seeing less context, a judge recognizes the instruction but stops treating it as a threat. | In all 9 Studio window losses, full text flags the attack (0.65–0.95) while every window holding the whole payload scores 0.20–0.45. | Moderate | [O46](evals/FINDINGS.md), [Studio chunking study](evals/reports/lmstudio-studio-chunking-moe-dense-2026-10-06.md) |
| **Build format matters more than architecture.** Same weights, different runtime. | Gemma 4 26B-A4B naive code: 0/100 as MLX 8-bit (no reasoning emitted) vs 44/53 as GGUF Q8 (reasoning). No MoE-vs-dense difference in detection; MoE is 4–6× faster. | Moderate | [O42](evals/FINDINGS.md), [O26](evals/FINDINGS.md), [MoE vs dense panel](evals/reports/lmstudio-moe-dense-panel-2026-10-05.md) |
| **A cheap decode step fixes encoded-text false alarms.** | Decoded previews cut false flags on 969 encoded benign controls by up to 92% (Qwen3.6 27B 140 → 11) and largely keep Base64 recall. | Strong | [O23](evals/FINDINGS.md), [decoded-preview report](evals/reports/decoded-preview-research-2026-09-29.md) |
| **A managed guardrail misses embedded attacks.** | Model Armor catches 0–3/78 BIPIA email attacks and ~0 subtle long-document attacks, but has the lowest benign false-positive rate. | Strong | [O35–O37](evals/FINDINGS.md) |
| **On full text, six of seven self-hostable models score within 0.03.** One frozen protocol, 21 datasets, Q8 on one Mac Studio. | Mean balanced accuracy 0.895–0.923 (Gemma 4 26B-A4B highest); Laguna XS 2.1 0.712. The gaps are in email (0.71–0.91) and encoded text, where the Gemma models flag 40–54% of encoded benign controls. | Moderate | [O48–O52](evals/FINDINGS.md), [Studio baseline](evals/reports/studio-baseline-q8-t4096-2026-10.md) |
| **Rankings flip between datasets, so small checks mislead.** | Qwen3.8 27B: 18/18 on a paper qualification tranche, 18/75 on BIPIA. | Strong | [O30](evals/FINDINGS.md) |

Scores are computed per dataset and never pooled across datasets. Abstentions (answers cut off at the token limit) are
reported separately and never counted as misses. Labels mark injection *attempts*, not downstream compromise. The completed full-text baseline is summarized [below](#now-running-as-of-2026-10-12).

## Now running (as of 2026-10-16)

**Extension suite on the fully tested models: running** (started 2026-10-13). The seven models that finished the
baseline now run 14 new datasets (6,759 cases per model) under the identical frozen protocol. Estimated about 94 hours
in total (realistic range 85–115).

*Why expand.* The baseline is saturating. Six of seven models finish within 0.03 of each other
([O48](evals/FINDINGS.md)). Long documents (0.94–0.99) and agent tool output (0.97–0.99) are at ceiling for most
models. Much of the long-document score rests on LongPIBench, which reuses about 12 fixed attack sentences. The policy
pairs cannot separate full-text detectors at all ([O49](evals/FINDINGS.md)). A benchmark that cannot separate models
cannot drive per-content recommendations, so the next round adds harder and more varied data rather than more of the
same.

*How it is expanded* ([sources](evals/datasets/PUBLIC_SOURCES.md#varied-prompt-injection-cohorts-2026-10-08)):

- **Varied, subtle long documents:** new LongPIBench-style paper, code and résumé cohorts with many distinct subtle
  attacks instead of one template; LLMail attacks embedded in long emails; and an authorized-benign set of documents
  that legitimately contain instructions, to measure false alarms on hard negatives.
- **New formats:** BIPIA table and code tasks.
- **New sources and environments:** BrowseSafe web pages, the full AgentDojo suites, Nemotron indirect-injection
  attacks, RepoGuard repository content, and the LLMail attack pool.
- **QA contexts:** injections inside SQuAD and TriviaQA passages (1,200 cases each).

What to watch: whether the stronger models start to separate on the subtle and hard-negative sets.

| Model | Type | Status |
|---|---|---|
| Ornith 1.5 35B-A3B | MoE | ✅ Done (mean balanced accuracy 0.895; 2 abstentions in 6,759) |
| Gemma 4 26B-A4B | MoE | ✅ Done (mean balanced accuracy 0.922; 2 abstentions) |
| Laguna XS 2.1 | MoE (coding) | ✅ Done (mean balanced accuracy 0.702; 8 abstentions) |
| Qwen3.8 27B | Dense | ✅ Done (mean balanced accuracy 0.865; 2 abstentions) |
| Qwen3.6 35B-A3B | MoE | ✅ Done (mean balanced accuracy 0.866; 2 abstentions) |
| Gemma 4 31B-it | Dense | ✅ Done (mean balanced accuracy 0.923; 0 abstentions) |
| Muse Glimmer 30B | Dense | ▶ Running |

**Abliteration pilot: complete** ([#23](https://github.com/elicollinson/solenoid-security/issues/23),
[results](evals/reports/abliteration-pilot-results-2026-10.md)). Two abliterated builds of Qwen3.8 27B ran against the
vanilla model on 9 datasets (998 identical cases per model), under the same protocol.

> **RESULT NOTE:** in this small sample, the heretic-ara build shows lower performance than vanilla Qwen3.8 (mean
> balanced accuracy 0.854 vs 0.888), and so does the huihui build (0.858). Both are marked for a full 21-dataset
> follow-up. The drop is mostly missed borderline attacks (obfuscated text, one LongPIBench template). Huihui also
> raised more false alarms on agent tool output. This is a pilot: about 100 cases per dataset, one quant and one
> runtime ([O53](evals/FINDINGS.md)).

**Mac Studio Q8 full-text baseline: complete** ([report](evals/reports/studio-baseline-q8-t4096-2026-10.md)). Seven self-hostable models, each run on all 21
datasets (7,326 cases per model) under one frozen protocol: Q8 GGUF, full text, score-only prompt, temperature 0,
reasoning on with a 4,096-token budget, one request at a time on a single machine. It is the reference point for
later quantization, abliterated-model, prompt and technique comparisons.

| Model | Type | Mean balanced accuracy | Abstentions (of 7,326) |
|---|---|---|---|
| Gemma 4 26B-A4B | MoE | 0.923 | 9 |
| Gemma 4 31B-it | Dense | 0.915 | 5 |
| Ornith 1.5 35B-A3B | MoE | 0.906 | 12 |
| Muse Glimmer 30B | Dense | 0.903 | 5 |
| Qwen3.6 35B-A3B | MoE | 0.901 | 3 |
| Qwen3.8 27B | Dense | 0.895 | 17 |
| Laguna XS 2.1 | MoE (coding) | 0.712 | 114 |
| Qwen3.6 27B | Dense | ⏸ Deferred (about 3.7× slower than Qwen3.8; can resume later) | — |

Every model scores 0.500 on the Skill-Inject policy pairs. On full text, both members of a pair send identical
input, so that dataset cannot rank these detectors ([O49](evals/FINDINGS.md)). Gemma 4 31B-it's encoded-benign cell
was rerun in full after an LM Link route change. The budget was raised from 1,024 tokens after the first attempt cut
off verbose reasoning models ([Appendix A](evals/FINDINGS.md)).

After the extension suite come the full abliteration run and the deferred Qwen3.6 27B. Jev and Model Armor results remain
hosted references.

## Design

**Goal:** a short list of self-hostable screening recommendations that substantially reduce prompt-injection risk
and malicious agent actions, behind one simple interface. Callers make one `screen` call at each trust boundary and
gate writes with `authorizeTool`. What runs behind that call (which technique, which models, how verdicts combine)
comes from a layered, overridable configuration whose defaults are set by measured performance.

**Configuration layers.** App-wide defaults are set once in `createSecurity`, and any setting can be overridden per
call (see [Screening configuration](#screening-configuration)). That part exists today, along with the pieces the
evidence so far points to: a self-hostable LLM judge that asks the exact score-only question the evals measured
([`OpenAICompatibleJudge`](#self-hosted-llm-judge)), the full-then-windows `cascade` technique, and an explicit
inconclusive outcome so a judge that runs out of tokens is never read as a pass. **Recommendation profiles** now
exist too ([`src/recommendations.ts`](src/recommendations.ts)): evidence-backed defaults per content type and per
measured self-hostable model, each traceable to an observation in [`FINDINGS.md`](evals/FINDINGS.md). See
[Recommended setup](#recommended-setup).

**What the evidence suggests so far.** These rows now ship as data in [`src/recommendations.ts`](src/recommendations.ts)
(`CONTENT_RECOMMENDATIONS`, each entry marked measured or provisional, and `JUDGE_PROFILES`), applied when a screen
names a `contentType`:

| Content | Current recommendation | Why |
|---|---|---|
| Long documents and code | Full text with a reasoning detector; add a windows pass only when the full-text verdict is negative | Windows lift subtle-injection recall on papers, but can lower concern for a payload. The full-then-windows cascade never lost a full-text detection ([O1](evals/FINDINGS.md), [O10](evals/FINDINGS.md), [O46](evals/FINDINGS.md)) |
| Email, résumés, web pages, retrieved passages | Full text | Windows were neutral or harmful ([O4](evals/FINDINGS.md), [O9](evals/FINDINGS.md)) |
| Encoded or obfuscated text | Full text plus bounded decoded previews | Up to 92% fewer encoded-text false alarms with recall largely kept ([O23](evals/FINDINGS.md)) |
| Agent tool output | Full text with an LLM detector rather than a managed filter alone | LLM detectors ≈97% vs 47% for Model Armor ([O35](evals/FINDINGS.md)) |
| Any content, small or fast judges | Avoid trusting a generated score from small non-reasoning models | They can be steered into the requested score ([O12](evals/FINDINGS.md)) |
| Runtime | Prefer builds that actually run reasoning (GGUF over MLX here), and record abstentions | Build format moved detection more than architecture ([O42](evals/FINDINGS.md), [Appendix A](evals/FINDINGS.md)) |

**Provenance comes first.** Whether text is an injection is a question about where it came from, not its wording. Two
files make that argument in code:

- **[`src/trust.ts`](src/trust.ts): origin is declared by the caller, never inferred.** Text is `operator`, `agent` or
  `external`, and anything unlabeled defaults to `external`. Inferring origin from position ("the first message is the
  user") would treat a stranger's iMessage or a screenshot as trusted, because those workflows put outside text in that
  position. The same flag also means different things by origin: `observe` for the operator, `quarantine` for tool
  output, `block` elsewhere.
- **[`src/authoredText.ts`](src/authoredText.ts): subtract what we wrote before the detector looks.** Our own tool
  descriptions are second-person imperatives, and classifiers cannot tell them from attacks. Measured with Llama Prompt
  Guard 2, nine tool descriptions scored 0.001–0.172 one at a time, but their concatenation scored 0.63 and was
  flagged. Registered constant strings are redacted per span, so the mixed case (our scaffolding around someone's
  email) is handled without trusting a whole tool. The safety rule: register only literals from the source, never
  interpolated text.

The library's chunking techniques run on the same code as the eval input strategies
([`src/techniques.ts`](src/techniques.ts)), so a recommendation measured in the lab is exactly what ships.

## Where to look

1. **[`evals/FINDINGS.md`](evals/FINDINGS.md):** 52 observations, each with numbers, sample size, strength rating,
   confounds and a follow-up, plus an open-questions backlog and future research avenues.
2. **Key reports:** [MoE vs dense panel](evals/reports/lmstudio-moe-dense-panel-2026-10-05.md) ·
   [Studio chunking study](evals/reports/lmstudio-studio-chunking-moe-dense-2026-10-06.md) ·
   [attack-following](evals/reports/injection-following-findings-2026-10-04.md) ·
   [literature scan](evals/reports/literature-scan-2026-10-05.md) ·
   [all reports](evals/reports/lmstudio-research-index-2026-10-04.md).
3. **[`evals/README.md`](evals/README.md):** the harness. Datasets, engines, input strategies and decision rules are
   versioned separately. Runs are resumable and reuse exact inputs, and every native response is retained.
4. **[`evals/reports/research-log-2026-09-29.md`](evals/reports/research-log-2026-09-29.md):** the decision log, with
   every protocol choice, failure and rerun.
5. **[`supabase/migrations/`](supabase/migrations) and [`evals/db/`](evals/db/README.md):** a private Postgres store
   for all runs, including per-response reasoning text, behavior assessments (did the model follow the injection?)
   and prompt lineage.

## Reproduce

1. **Smoke test, no models needed.** `git clone`, `bun install`, then `bun run smoke`. It runs both typechecks, all
   offline tests and a small synthetic end-to-end eval through the real runner and analyzer in about 5 seconds, with no
   network, `.env` or private data. CI runs it on every push.
2. **Check the published numbers.** The analysis scripts and aggregate results behind the reports are in
   [`evals/analysis/`](evals/analysis/README.md), so cited numbers can be checked without rerunning inference.
3. **Full reruns** need LM Studio or hosted model credentials plus the dataset sources. See
   [`evals/README.md`](evals/README.md#reproduce).

## Using the library

Screen untrusted source content before an AI agent consumes it. Configure a provider once, then call `screen` at the boundary where text enters your agent. Text can be judged by Google Cloud Model Armor or by a [self-hosted LLM judge](#self-hosted-llm-judge) on any OpenAI-compatible endpoint. [Images and documents](#images-and-documents) use the same `screen` call.

```ts
import { createSecurity, ModelArmorScanner } from "@elicollinson/solenoid-security";

const security = createSecurity({
  provider: new ModelArmorScanner({
    projectId: process.env.MODEL_ARMOR_PROJECT_ID,
    templateId: "base-detector",
  }),
});

const result = await security.screen({
  type: "text",
  content: emailBody,
  origin: "external",
  boundary: "input",
});

if (result.decision === "block" || result.decision === "quarantine") {
  // Keep this source out of the model context.
}
```

`content` can be one string or an array of strings screened together. Use a separate call for each independent source so one quarantined item does not stop unrelated work. Unknown origins default to `external`, even if the content is placed in the first message of a conversation.

### Recommended setup

Point a judge at your own endpoint serving the recommended model, give it that model's measured profile, and say what kind of content each screen is looking at:

```ts
import { createSecurity, OpenAICompatibleJudge } from "@elicollinson/solenoid-security";

const security = createSecurity({
  provider: new OpenAICompatibleJudge({
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "google/gemma-4-26b-a4b", // your server's name for the weights
    profile: "gemma-4-26b-a4b",      // DEFAULT_JUDGE_PROFILE_ID: threshold, effort, temperature, max tokens as measured
  }),
});

await security.screen({ type: "text", content: paper, contentType: "long_document" }); // full text, then windows
await security.screen({ type: "text", content: blob, contentType: "encoded" });        // decoded previews, then full text
```

A `contentType` fills any screening setting your configuration leaves unset with the recommendation in [`CONTENT_RECOMMENDATIONS`](src/recommendations.ts). Without one, nothing is recommended and screens behave exactly as before.

| `contentType` | Technique | Status | Evidence |
| --- | --- | --- | --- |
| `long_document`, `code` | `cascade`: `full_text`, then `sliding_word_window_preserve_v1` 512/384 | measured (post-hoc replay) | [O1](evals/FINDINGS.md), [O10](evals/FINDINGS.md), [O46](evals/FINDINGS.md) |
| `email`, `resume`, `web_page` | `full_text` | measured | [O4](evals/FINDINGS.md), [O9](evals/FINDINGS.md), [O51](evals/FINDINGS.md) |
| `retrieved_passage` (QA and RAG context) | `full_text` | provisional | extension suite; windows not measured |
| `tool_output` | `full_text` with an LLM judge | measured | [O35](evals/FINDINGS.md), [O48](evals/FINDINGS.md) |
| `encoded` | `preprocess: ["decoded_preview_v1"]`, then `full_text` | measured (hosted panel) | [O23](evals/FINDINGS.md), [O50](evals/FINDINGS.md) |
| `user_prompt`, `unknown` | `full_text` | provisional | [O48](evals/FINDINGS.md) |
| `image` | whole image, vision judge | **unmeasured** | none yet; an image-injection eval is the follow-up |

Every entry uses the measured decision rule, the maximum score against each model's own threshold (`{ kind: "score", reduce: "max" }`).

**Judge profiles** (`JUDGE_PROFILES`) record the settings each model was measured with: GGUF Q8_0, temperature 0, 4,096 tokens, score-only prompt. Accuracy is mean balanced accuracy on the 21-dataset [baseline](evals/reports/studio-baseline-q8-t4096-2026-10.md) and the 14-dataset extension suite.

| Profile | Threshold | Effort sent (measured template behavior) | Baseline / extension | Status |
| --- | --- | --- | --- | --- |
| `gemma-4-26b-a4b` (default) | 0.5 | none (no effort variable; thinking on) | 0.923 / 0.922 | recommended: fewest false alarms on hard benign sets (1.4% pooled), MoE and fast |
| `gemma-4-31b-it` | 0.5 | none (no effort variable; thinking on) | 0.915 / 0.923 | recommended (dense, slowest) |
| `ornith-1.5-35b-a3b` | 0.5 | none (no effort variable) | 0.906 / 0.895 | recommended |
| `qwen3.6-35b-a3b` | 0.5 | none (no effort variable) | 0.901 / 0.866 | recommended |
| `qwen3.8-27b` | **0.15** (provisional); **0.5** for `web_page` | **low** (injects a 26-token instruction) | 0.895 / 0.865 at xhigh (0.891 at 0.15) | recommended: graded scores; effort and threshold from the ablation ([O65, PR #49](https://github.com/elicollinson/solenoid-security/pull/49)) |
| `muse-glimmer-30b` | **0.10**; **0.5** for `web_page` | none (template's own `reasoning_strength` defaults to high) | 0.903 / 0.904 (0.922 at 0.10) | provisional |
| `laguna-xs-2.1` | 0.5 | none (thinking state unresolved) | 0.712 / 0.702 | not recommended |

Every judge setting resolves as: the option you pass, then the profile's value, then the library default. The evals requested `reasoning_effort: "high"`, but LM Studio did not forward it to any template, so each model ran on its template's defaults. Each profile reproduces that and records it in `profile.template` (FINDINGS O54 and Appendix B, from the effort audit in [#35](https://github.com/elicollinson/solenoid-security/pull/35); [#33](https://github.com/elicollinson/solenoid-security/issues/33)). Qwen3.8's template accepts only `xhigh`, `medium` or `low` (LM Studio silently drops any other value, so the template default `xhigh` and its 38-token instruction applied in the baseline and extension runs), and the judge rejects other values. Its profile sends `low`: in the pre-registered effort ablation (FINDINGS O65, [report](https://github.com/elicollinson/solenoid-security/blob/feature/qwen38-effort-ablation/evals/reports/qwen38-effort-ablation-2026-10.md), [PR #49](https://github.com/elicollinson/solenoid-security/pull/49), [#33](https://github.com/elicollinson/solenoid-security/issues/33); 10 seeded tests, 1,606 cases per arm), balanced accuracy at 0.5 went from 0.800 at `xhigh` to 0.841 at `medium` and 0.870 at `low`, QA AUROC from 0.821 to 0.950, with 0.78× the reasoning tokens. `low` prepends its own 26-token instruction ("Reasoning effort is set to low. Keep your thinking brief…"). Its 0.15 threshold is the conservative baseline fit and is provisional until a full-suite run at `low`. Muse's 0.10 was fit on the baseline and lifts extension balanced accuracy from 0.904 to 0.922 out of sample (O66). Both keep 0.5 for `web_page`: at 0.10 Muse's web accuracy falls from 0.765 to 0.588, and the Qwen ablation had no web cohort. The Gemma models flag 40–54% of encoded benign text on raw full text ([O50](evals/FINDINGS.md)), so screen encoded content with `contentType: "encoded"`.

**Layers.** Each setting (`technique`, `preprocess`, `models`, `aggregator`) is resolved separately, and the highest layer that sets it wins:

1. library defaults: `full_text`, no preprocessing, every provider, `"any"`;
2. the built-in recommendation, only when the input names a `contentType`;
3. `createSecurity({ screening })`, then `createSecurity({ contentTypes: { [type]: ... } })`;
4. `localOverrides.screening`, then `localOverrides.contentTypes[type]`;
5. the per-call overrides passed to `screen`.

`security.resolveScreening(contentType?, overrides?)` returns the settings a screen would use and the layer each came from. Local overrides are plain data the host loads. The library never reads files or environment variables, so a host that wants a git-ignored local file wires it like this:

```ts
import { existsSync, readFileSync } from "node:fs";
import { createSecurity, parseScreeningOverrides } from "@elicollinson/solenoid-security";

const path = "solenoid.local.json"; // e.g. { "contentTypes": { "code": { "technique": { "kind": "full_text" } } } }
const localOverrides = existsSync(path) ? parseScreeningOverrides(JSON.parse(readFileSync(path, "utf8")), path) : undefined;
const security = createSecurity({ provider, localOverrides });
```

`parseScreeningOverrides` accepts only `screening` and `contentTypes`, validates every technique, preprocessor and aggregator, refuses functions, and names the offending path in its error. `mergeScreeningConfig(...configs)` is the same field-by-field merge, exported for hosts that build their own layers.

### Screening configuration

A screen has three settings: the **technique** that decides what text each provider call sees, the **models** that judge it, and the **aggregator** that turns their verdicts into one flag. Register named providers and set app-wide defaults once:

```ts
const security = createSecurity({
  providers: {
    armor: new ModelArmorScanner({ projectId, templateId: "base-detector" }),
    armorHigh: new ModelArmorScanner({ projectId, templateId: "high-detector" }),
  },
  screening: {
    technique: { kind: "random_word_chunks", minWords: 50, maxWords: 150 },
    models: ["armor"],
    aggregator: "any",
  },
  // Optional, per content type; see Recommended setup for how layers combine.
  contentTypes: { web_page: { models: ["armor", "armorHigh"] } },
});
```

Any setting can be overridden for one call. Omitted settings keep the app-wide value.

```ts
await security.screen(
  { type: "text", content: webPage, boundary: "tool_output" },
  { models: ["armor", "armorHigh"], aggregator: "all" },
);
```

| Setting | Options | Default |
| --- | --- | --- |
| `technique` | `{ kind: "full_text" }`; `{ kind: "decoded_preview_v1" }`; `{ kind: "random_word_chunks", minWords, maxWords, seed? }`; `{ kind: "sliding_word_window" \| "sliding_word_window_preserve_v1", windowWords, strideWords }`; `{ kind: "cascade", first, then }` | `full_text` |
| `preprocess` | `["decoded_preview_v1"]`: applied to the whole text before the technique | none |
| `models` | Names from `providers`. A single `provider` is named `"default"`. | Every configured provider |
| `aggregator` | `"any"`, `"all"`, `{ kind: "score", reduce: "max" \| "mean" \| "min", threshold?, comparator?: ">" \| ">=", lengthAdjust? }`, or a function over every segment-by-model assessment | `"any"` |

Every model screens every segment, and the aggregator sees the whole matrix, so a function can express rules such as "two of three models agree". The score comparator defaults to `>`. Without a `seed`, random chunk boundaries are unpredictable; pass one only when you need reproducible chunks. The chunk techniques split on the same code as the [eval workspace](evals/README.md) input strategies of the same `kind`, so evaluate a technique, model, and threshold together before adopting them. A Model Armor PI verdict is binary and scores 1 or 0.

**Per-model thresholds.** A score rule's threshold resolves in this order:

1. the `threshold` on the rule (from whichever layer set the aggregator, including `contentTypes[type]`);
2. the judge's explicit `threshold` option, which replaces its profile's thresholds for every content type;
3. the profile's `thresholdByContentType[contentType]`, when the input names that content type (Qwen3.8 and Muse set `web_page: 0.5`);
4. the profile's `threshold`;
5. 0.5.

Any provider can expose `threshold` and `thresholdByContentType` properties instead of a profile, and `screen` passes `{ contentType }` as `assess`'s second argument when the input names one, so the judge's own flag (read by `"any"`) uses the same threshold. Without a threshold on the rule, each model's segment scores are reduced separately and compared with that model's threshold, and the text is flagged if any model flags. So a Qwen3.8 judge at 0.15 and a Gemma judge at 0.5 can share one screen. The comparator resolves the same way and defaults to `>`.

**Decoded previews compose.** `preprocess: ["decoded_preview_v1"]` appends bounded decoded views of Base64, percent- and `\u`-escaped and invisible-character text, then hands the result to any technique, windows included. In a cascade, both passes see the previewed text. Preprocessing joins the parts with a newline first. `{ kind: "decoded_preview_v1" }` remains as an alias for preview plus `full_text` and sends the same bytes as before.

```ts
await security.screen({ type: "text", content: longLogWithBlobs }, {
  preprocess: ["decoded_preview_v1"],
  technique: { kind: "cascade", first: { kind: "full_text" }, then: { kind: "sliding_word_window_preserve_v1", windowWords: 512, strideWords: 384 } },
});
```

**Length-aware thresholds (off by default, uncalibrated).** Every extra window is another chance for clean text to cross the threshold ([O9](evals/FINDINGS.md); DeFuse puts a 1% per-window false-positive rate at about 98% for a 402-window document). `lengthAdjust` raises a score rule's threshold `t` with the pass's segment count `n`: `{ kind: "sidak" }` gives `t^(1/n)`, `{ kind: "bonferroni" }` gives `1 − (1 − t)/n`, and `{ kind: "linear", perSegment }` gives `t + perSegment × (n − 1)`. Each takes an optional `cap` (default 1) and never lowers the threshold. Full text (`n = 1`) is unchanged, and each cascade pass counts its own segments. Šidák and Bonferroni treat the score as a calibrated probability, which these judges' mostly near-binary scores are not, so no setting is recommended until long benign controls are measured ([#4](https://github.com/elicollinson/solenoid-security/issues/4)).

The aggregator decides only prompt injection. A match on any other content filter from any model or segment still blocks. `result.assessment` is the aggregated assessment and `result.assessments` lists each model's result for each segment. Any provider failure fails the whole screen with `ScreeningError`. Chunking multiplies provider calls by the number of segments, and the calls run concurrently.

**Cascade (recommended for long documents).** Screen the full text first, and only if it is not flagged, screen it again in windows. The text is flagged if either pass flags it.

```ts
technique: {
  kind: "cascade",
  first: { kind: "full_text" },
  then: { kind: "sliding_word_window_preserve_v1", windowWords: 512, strideWords: 384 },
}
```

Windows alone can lower a judge's concern for a payload it flags in context ([O46](evals/FINDINGS.md)); after a clean full-text pass they can only add detections. Replayed on 20 model × domain cells, the cascade kept every full-text detection at roughly 1.3–3.8× the work of full text ([O10](evals/FINDINGS.md), [O45](evals/FINDINGS.md)). `first` is any single-pass technique, `then` must segment, and cascades do not nest. Each pass uses the same models and aggregator. `result.cascade.decidedBy` is `"first"` when the first pass flagged and the windows never ran, otherwise `"then"`; `result.cascade.stages` summarizes each pass that ran, and each entry in `result.assessments` carries its `stage`.

### Self-hosted LLM judge

`OpenAICompatibleJudge` screens text with a model on any OpenAI-compatible chat completions endpoint: LM Studio, llama.cpp `llama-server`, vLLM, or OpenRouter. It sends the same score-only prompt and JSON schema the evals measured (`security-eval-score-only-json-v1`, `concern-score-only-json-v1`), so its behavior matches the numbers in [`FINDINGS.md`](evals/FINDINGS.md).

```ts
import { createSecurity, OpenAICompatibleJudge } from "@elicollinson/solenoid-security";

const security = createSecurity({
  provider: new OpenAICompatibleJudge({
    baseUrl: "http://127.0.0.1:1234/v1", // LM Studio; `/chat/completions` is appended
    model: "qwen3.6-35b-a3b",
    profile: "qwen3.6-35b-a3b", // optional: measured settings from JUDGE_PROFILES
    // apiKey, timeoutMs (120000), temperature (0), maxTokens (4096),
    // reasoningEffort, threshold (0.5, compared with ">"), responseFormat ("json_schema")
  }),
});
```

| Setting | Default | Notes |
| --- | --- | --- |
| `maxTokens` | `4096` | Shared by reasoning and the answer. A 1,024 cap cut verbose reasoning models off before they answered ([Appendix A](evals/FINDINGS.md)). |
| `profile` | unset | A `JUDGE_PROFILES` id or a `JudgeProfile` object. Supplies the defaults for the settings below; an option you pass wins. |
| `reasoningEffort` | profile's, else unset | Sent as `reasoning_effort`. Rejected if the profile lists accepted values and this is not one. Prefer builds that actually reason ([O42](evals/FINDINGS.md)). |
| `threshold`, `comparator` | profile's, else `0.5`, `">"` | A score above the threshold flags. Exposed as `judge.threshold` for score aggregators. An explicit `threshold` also replaces the profile's `thresholdByContentType`; `judge.thresholdFor(contentType)` gives the threshold a screen of that type uses. |
| `responseFormat` | `"json_schema"` | `"prompt_json"` omits `response_format`, for LM Studio MLX builds that route schema-constrained output to `reasoning_content`. |

The answer must be exactly `{"concernScore": <0..1>}`. A cut-off response (`finish_reason: "length"`), an answer only in the reasoning channel, malformed JSON, or an out-of-range score is never clamped or guessed: it is an **inconclusive** assessment (`label: "INCONCLUSIVE"`, `inconclusive: true`, `inconclusiveReason`, `score: NaN`). An HTTP error or a body that is not a chat completion throws. Each assessment also records `usage` (including `reasoningTokens`), `finishReason`, `responseId` and the answering `model`. Small non-reasoning judges can be steered into the score an injection asks for ([O12](evals/FINDINGS.md)), so evaluate a model before relying on it.

### Images and documents

`screen` also accepts `{ type: "image" }` and `{ type: "document" }` inputs. `origin`, `boundary` and `contentType` mean exactly what they mean for text, and an unlabeled input is `external`.

```ts
import { createSecurity, OpenAICompatibleJudge, ModelArmorScanner } from "@elicollinson/solenoid-security";

const security = createSecurity({
  providers: {
    judge: new OpenAICompatibleJudge({ baseUrl, model: "google/gemma-4-26b-a4b", profile: "gemma-4-26b-a4b", vision: true }),
    armor: new ModelArmorScanner({ projectId, templateId: "base-detector" }),
  },
  documents: { extractors: [pdfExtractor] }, // optional, see below
});

await security.screen({ type: "image", data: screenshotBytes, mimeType: "image/png", boundary: "tool_output" });
await security.screen({ type: "image", data: "data:image/jpeg;base64,/9j/4AAQ..." });
await security.screen({ type: "document", mimeType: "text/html", text: pageHtml, contentType: "web_page" });
await security.screen({ type: "document", mimeType: "application/pdf", data: pdfBytes, filename: "cv.pdf", contentType: "resume" });
```

**No implicit URL fetching.** `data` is a `Uint8Array`, a base64 string, or a base64 `data:` URL. An `http(s)` URL is refused with a `TypeError`, never fetched: fetching would let injected text steer the screen's network requests, and would screen whatever the server returned at that moment rather than what your agent reads. Download it with your own allowlist and size cap, then pass the bytes. Declared image types are checked against the file signature.

**Capabilities and failing closed.** Providers declare the inputs they accept with `supports` (`{ text?, image?: { mimeTypes, maxBytes }, document?: { mimeTypes, maxBytes } }`); a provider without `supports` is text-only. When no model is selected explicitly, a screen uses every provider that accepts the input and lists the rest in `result.skippedModels`. Models you select explicitly (in `screening`, a content-type entry, local overrides or the call) are a requirement. An input no selected model can read throws `ScreeningError` with code `"unsupported_input"` and is never allowed. Inputs over a provider's `maxBytes`, or over `documents.maxBytes` (10 MiB by default), throw `"input_too_large"`.

**Images.** `OpenAICompatibleJudge` with `vision: true` sends PNG, JPEG, WebP or GIF up to `maxImageBytes` (4 MiB by default) as an OpenAI-compatible `image_url` part holding a base64 data URL. It uses a separate image prompt (`SCORE_ONLY_IMAGE_PROMPT_ID`, `security-image-score-only-json-v1`) with the same schema and strict parser, so text screens still send the measured prompt byte for byte. The Gemma 4, Qwen3.6 and Qwen3.8 profiles record a vision encoder (`profile.vision`), and a profile without one rejects `vision: true`. Your server must load the model's projector (mmproj for GGUF). **Image screening is unmeasured.** No eval has run the image prompt, so treat it as a starting point until an image-injection eval exists. Techniques and preprocessing do not apply to images: each model sees the whole image once.

**Documents.** A document's text is extracted, then screened as a text input. That means the content-type recommendation, preprocessing, technique and authored-text redaction all apply, and `result.extraction` records the extractor id, input bytes, extracted characters and segment count. Pass `data` (bytes) or `text` (an already-decoded text format). The built-in extractors need no dependencies:

| MIME type | Extractor | Output |
| --- | --- | --- |
| `text/plain` | `builtin:text` | The text (strict decoding; a `charset` parameter is honored) |
| `text/markdown` | `builtin:markdown` | The source as written, so comments a renderer would hide are still screened |
| `text/html`, `application/xhtml+xml` | `builtin:html` | Visible text, then **hidden text** as a second segment. Scripts and styles are dropped |
| `application/json`, `application/ld+json` | `builtin:json` | Every string value in order, plus keys that contain spaces |
| `text/csv` | `builtin:csv` | Unquoted cells, tab-separated, one row per line |

The HTML extractor surfaces text a reader would not see but a model reading the source would: comments, elements hidden with `hidden`, `aria-hidden="true"`, `<template>` or an inline `display:none`/`visibility:hidden`/zero-size/off-screen style, hidden form values, `alt`/`title`/`aria-label`/`placeholder` and `<meta>` content. Hidden text is a classic injection carrier, so it is screened rather than discarded. Detection of inline styles is a heuristic: text hidden by a stylesheet class is reported as visible, and is still screened. Hidden text in extracted pages is unmeasured. The `web_page` recommendation (full text) was measured on page text.

PDF, DOCX and other binary formats need an extractor you provide. Yours are consulted before the built-ins, so you can also replace one. If no extractor matches the MIME type, a provider that screens the format natively gets the raw bytes (`result.input.via: "native"`). If none does, the screen throws `"unsupported_input"`. An extractor that throws, or returns something other than `{ text, segments?, metadata? }`, fails the screen with `"extraction_failed"`. An extractor that cannot read a file (a scanned PDF, say) should throw rather than return empty text, because empty text is allowed. Images embedded in documents are out of scope. Screen them as image inputs if your extractor surfaces them.

```ts
import type { DocumentExtractor } from "@elicollinson/solenoid-security";

const pdfExtractor: DocumentExtractor = {
  id: "pdfjs",
  mimeTypes: ["application/pdf"],
  async extract({ bytes }) {
    const pages = await extractPdfPages(bytes);                // your PDF library
    return { text: pages.join("\n"), segments: pages, metadata: { pages: pages.length } };
  },
};
```

**Model Armor.** Per Google's [overview](https://docs.cloud.google.com/model-armor/overview) and [`DataItem` reference](https://docs.cloud.google.com/model-armor/reference/rest/v1/DataItem), Model Armor screens files sent as a `byteItem`: PDF, Word, Excel and PowerPoint OOXML formats, TXT and CSV, from 69 bytes to 4 MB. It skips scanning larger files, so the scanner refuses them with `"input_too_large"` before the request. `ModelArmorScanner` declares those types, so a PDF reaches it natively when you supply no PDF extractor. Images (JPEG, PNG, BMP, up to 4 MB, one per request) are screened by OCR for the text filters and by Sensitive Data Protection for visual content. Google offers image screening only in the `us` and `eu` multi-regions, so it is opt-in with `imageScreening: true` and requires `location: "us"` or `"eu"`. Model Armor does not screen images embedded in files. File and image responses are read with the same strict rules as text, so a missing prompt-injection verdict fails the screen.

### Decisions

| Decision | Meaning |
| --- | --- |
| `allow` | No configured filter matched, or no untrusted text remained after authored text was removed. |
| `observe` | Prompt injection was flagged in confirmed operator or prior local agent text; record it and continue. |
| `quarantine` | Prompt injection was flagged in external tool output; keep that output out of model context. |
| `block` | Prompt injection was flagged at another external boundary, or a different content safety filter matched. |

The provider result is included in `assessment` when screening runs. A provider failure throws `ScreeningError`; callers must stop or otherwise contain that source. A failed or incomplete scan is never an `allow` result.

**Inconclusive screens.** An abstaining assessment is neither a flag nor a pass. Each aggregator is evaluated twice, reading every abstention once as flagged (score 1) and once as clean (score 0). If both readings agree, the missing answers could not have changed the outcome and it stands: one conclusive flag under `"any"` still flags, and one conclusive clean segment under `"all"` still clears. If they disagree, the screen is inconclusive. Function aggregators receive both readings (abstentions stay marked `inconclusive: true`) and are assumed monotone. A cascade's windows still run after an inconclusive first pass; a flag from them decides, and a clean result leaves the screen inconclusive.

By default an inconclusive screen throws `ScreeningError` with `code: "inconclusive"` (provider failures use `"provider_failed"`), so code that already contains failures stays safe. `error.result` holds every assessment. Set `onInconclusive: "quarantine"` or `"block"` in `createSecurity` to get that decision instead, at every boundary and for every origin, with `assessment.inconclusive: true`.

```ts
try {
  const result = await security.screen({ type: "text", content: page, boundary: "tool_output" });
} catch (error) {
  if (error instanceof ScreeningError && error.code === "inconclusive") {
    // The judge gave no verdict. Retry with a larger maxTokens, try another model, or contain the source.
  }
}
```

The default Model Armor adapter requires a project and a template with its prompt injection filter enabled. It supports an API key, an injected token callback, or Google application default credentials. Pass `getAuthToken` and `fetchFn` to test without a cloud account. Model Armor requests send text to Google Cloud; choose a provider and retention policy appropriate for your data.

```ts
const scanner = new ModelArmorScanner({
  projectId: "my-project",
  location: "us-central1",
  templateId: "base-detector",
  // apiKey: process.env.MODEL_ARMOR_API_KEY,
});
```

### Provenance

Register only **literal text written by your application**. The registry removes exact authored spans before a provider sees a mixed tool result, while leaving external content to be screened. Never register a string that contains interpolated user, document, web, or tool data.

```ts
security.authoredText.register(
  "tool:search",
  "This search tool returns excerpts from external web pages for reference only.",
);
```

`origin: "operator"` means the person controlling the assistant, not simply the first message. Retrieved messages, pages, screenshots, and memory records containing other people's text remain `external` wherever they appear.

### Tool gating

The package also provides a run-scoped hook for approving or denying writes. Validate tool arguments first, call `authorizeTool` before executing the tool, and execute only when it returns `{ allow: true }`. A write without a gate is denied by this helper. The host application owns its permission storage, approval UI, and audit trail.

```ts
import { authorizeTool, withToolGate } from "@elicollinson/solenoid-security";

await withToolGate(async (request) => {
  return request.tool === "save_draft"
    ? { allow: true }
    : { allow: false, tell: "This write needs approval." };
}, async () => {
  const verdict = await authorizeTool({
    tool: "save_draft",
    kind: "write",
    args: validatedArgs,
    description: "Save a draft",
  });
  if (verdict.allow) await saveDraft(validatedArgs);
});
```

The initial gate matches Solenoid Assistant's `read` / `write` distinction. Hosts should classify by actual side effect: a tool that changes state, including an audit record, is a write. Future policy layers can add destination, resource, and data sensitivity checks.

### Install and develop

This package is ESM and ships compiled JavaScript plus TypeScript declarations for Node 20+ and Bun. It does not expose a Zod type in its public API; applications may use Zod 4 for their own tool argument validation.

Until an npm registry release exists, install from the public GitHub repository:

```sh
npm install github:elicollinson/solenoid-security
# or
bun add github:elicollinson/solenoid-security
```

For development:

```sh
bun install
bun run build
bun test
```
