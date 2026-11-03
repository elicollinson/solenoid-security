# Solenoid Security

Provenance-aware prompt-injection screening for AI agents, and the evaluation lab that decides how it should screen.

The library screens untrusted text at the boundary where it enters an agent. The [evaluation workspace](evals/README.md)
measures which detectors, input techniques and runtimes actually catch injections. It covers 35 public and synthetic
datasets (21 baseline and 14 extension; 14,085 cases), 33 detector configurations from 17 models, hosted APIs and
local inference. The Mac Studio Q8 suites alone hold 98,595 full-text case verdicts (seven models × 14,085 cases;
[published aggregates](evals/analysis/README.md)). Every claim below links to its evidence. Strength ratings and
confounds are in [`evals/FINDINGS.md`](evals/FINDINGS.md).

## Results

Mean balanced accuracy at full text, one frozen protocol (score-only prompt, temperature 0, reasoning on, 4,096-token
budget, > 0.5 flags), datasets weighted equally and never pooled. The content columns are from the extension suite.

| Model | Type | Baseline (21) | Extension (14) | Long docs | BIPIA | QA | Web | Agent | Benign FPR |
|---|---|---|---|---|---|---|---|---|---|
| Gemma 4 26B-A4B | MoE | **0.923** | 0.922 | 0.906 | 0.904 | **0.948** | 0.820 | 0.999 | 1.4% |
| Gemma 4 31B-it | Dense | 0.915 | **0.923** | 0.917 | **0.917** | 0.921 | **0.825** | 0.999 | **0.9%** |
| Qwen3.8 27B ¹ | Dense | 0.912 | 0.900 | 0.918 | 0.805 | 0.825 | 0.820 | 0.997 | 1.5% |
| Ornith 1.5 35B-A3B | MoE | 0.906 | 0.895 | 0.914 | 0.857 | 0.858 | 0.662 | 0.991 | 7.1% |
| Muse Glimmer 30B | Dense | 0.903 | 0.904 | **0.929** | 0.839 | 0.815 | 0.765 | **1.000** | 3.0% |
| Qwen3.6 35B-A3B | MoE | 0.901 | 0.866 | 0.854 | 0.828 | 0.914 | 0.703 | 0.982 | 4.5% |
| LLaDA2.2-flash ² | Diffusion | 0.718 | 0.707 | 0.659 | 0.711 | 0.562 | 0.635 | 0.955 | 5.6% |
| Laguna XS 2.1 | MoE (coding) | 0.712 | 0.702 | 0.685 | 0.644 | 0.591 | 0.608 | 0.955 | 7.5% |

Seven GGUF Q8_0 models on one Mac Studio. Web is BrowseSafe; benign FPR is benign cases flagged out of 1,973 in the
extension suite. Abstentions (answers cut off at the token limit) are reported separately and never counted as misses.
Reports: [baseline](evals/reports/studio-baseline-q8-t4096-2026-10.md),
[extension](evals/reports/studio-extension-q8-t4096-2026-10.md),
[LLaDA2.2-flash](evals/reports/llada-flash-full-2026-10.md).

¹ Run at `reasoning_effort: "low"`, which is the only setting changed from the frozen protocol, in a pre-registered
full-suite rerun. That gives +0.017 and +0.035 over the frozen run (p = 4×10⁻⁵ and 2×10⁻⁸³), with more false alarms on
the baseline's benign sets ([O67](evals/FINDINGS.md), [report](evals/reports/studio-qwen38-low-2026-10.md)). The frozen
run dropped the requested `"high"` and applied the template's `xhigh` instruction. Its numbers are kept as the
historical protocol ([Appendix B](evals/FINDINGS.md), [O65](evals/FINDINGS.md)):

| Model | Baseline | Extension | Long docs | BIPIA | QA | Web | Agent | Benign FPR |
|---|---|---|---|---|---|---|---|---|
| Qwen3.8 at `xhigh` | 0.895 | 0.865 | 0.908 | 0.748 | 0.730 | 0.802 | 0.999 | 2.2% |

Scores at `low` are still under-calibrated at 0.5. Use a 0.15 threshold for non-web content and 0.5 for web.
² A non-reasoning text-diffusion model, run as MLX 4-bit through the `openai_compatible` engine with prompt-only
JSON, so it is not the frozen Q8 protocol.

**Key outcomes**

- The extension breaks the baseline's saturation (spread 0.028 → 0.059), except on agent tool output, which stays at 0.98–1.00 ([O56](evals/FINDINGS.md), [O57](evals/FINDINGS.md)).
- The two Gemmas tie at the top; Gemma 4 26B-A4B is the default, an MoE about 3× faster than Gemma 4 31B-it (3.8 s vs 12.3 s per request) ([O59](evals/FINDINGS.md)).
- Qwen3.8 27B's template-default `xhigh` instruction cost it accuracy; at `low` it ranks 3rd on the baseline and 4th on the extension, gaining most on QA, email and BIPIA ([O65](evals/FINDINGS.md), [O67](evals/FINDINGS.md)).
- Abliterated Qwen3.8 builds detect significantly worse than the original in a pre-registered pilot (0.854 and 0.858 vs 0.888; McNemar p ≤ 5×10⁻⁴); a full-scale replication and more model families are running ([summary](evals/reports/abliteration-findings.md), [O53](evals/FINDINGS.md)).
- Windows help long documents mainly on the subtle template and can lower concern for a payload, so the full-then-windows cascade is recommended ([O1](evals/FINDINGS.md), [O10](evals/FINDINGS.md), [O46](evals/FINDINGS.md)).
- Diffusion LLMs (LLaDA2.2) are weak at full text; windows significantly lift Flash on long documents, mid-document payloads included, but it still trails the reasoning models and adds web false alarms ([O61–O63](evals/FINDINGS.md)).
- The Skill-Inject policy pairs cannot rank full-text detectors: both members send identical input, so every model scores 0.500 ([O49](evals/FINDINGS.md)).
- From the hosted phase: small non-reasoning judges copy an injected score ([O12](evals/FINDINGS.md)), decoded previews cut encoded-text false alarms by up to 92% ([O23](evals/FINDINGS.md)), and Model Armor misses embedded attacks ([O35](evals/FINDINGS.md)).

**Limits**

- One quant and one runtime per model (Q8_0 GGUF in LM Studio; Flash MLX 4-bit), on one machine.
- Long-document cohorts are built on LongPIBench's synthetic documents; the baseline reuses about 12 fixed attack sentences.
- Effort was not set except for Qwen3.8 (`low`). Every other model ran at its chat template's default, which differs by model ([Appendix B](evals/FINDINGS.md), [O54](evals/FINDINGS.md)).
- Agent sets are saturated, and several datasets are single-class (attack-only or benign-only), where balanced accuracy is recall or specificity alone.
- Flash's protocol differs (no reasoning pass, prompt-only JSON, 4-bit), so its row is a reference, not a like-for-like rank.

## Status (2026-10-27)

Complete: the Studio Q8 full-text baseline (7 models × 21 datasets), the extension suite (7 × 14), the abliteration
pilot ([results](evals/reports/abliteration-pilot-results-2026-10.md)), the Qwen3.8 effort ablation
([report](evals/reports/qwen38-effort-ablation-2026-10.md)), the full-suite Qwen3.8 rerun at `low`
([report](evals/reports/studio-qwen38-low-2026-10.md)), the LLaDA2.2 runs
([pilot](evals/reports/llada-pilot-2026-10.md), [window sweep](evals/reports/llada-window-sweep-2026-10.md),
[pre-registered Flash run](evals/reports/llada-flash-full-2026-10.md)) and the batching equivalence runs (write-up in
progress; [#21](https://github.com/elicollinson/solenoid-security/issues/21)).

**Now running: abliteration extension ([#23](https://github.com/elicollinson/solenoid-security/issues/23)).** Each
abliterated build is compared with its vanilla model's existing results on identical cases; vanilla models are not
re-run. All builds are static Q8_0 GGUF of the abliteration author's weights, matching the vanilla quant, and each must
reproduce the vanilla prompt rendering exactly before it runs (template overrides are recorded as deviations).

| Stage | What | Status | Expected (UTC) |
|---|---|---|---|
| 1 | Qwen3.8 27B heretic-ara and huihui at `low`, full baseline + extension (14,085 cases each) | ▶ Running (started 2026-10-27 11:28) | heretic-ara ≈ Oct 28 13:00–17:00; huihui ≈ Oct 29 14:00–22:00 |
| 2 | 998-case pilot screen: Gemma 4 26B (huihui, heretic, heretic-ultra), Qwen3.6 35B-A3B (huihui, heretic), Qwen3.8 MPOA, Gemma 4 31B (huihui, heretic), Muse (heretic) | Armed; starts when stage 1 ends | ≈ 21 h, done ≈ Oct 30 12:00 – Oct 31 00:00 |
| 3 | Full suites for builds with a confirmed pilot effect, Gemma 4 26B first | Not scheduled | Decided from stage 2 |

Next candidates after that: the enhanced agent set ([#31](https://github.com/elicollinson/solenoid-security/issues/31)),
the speculative-decoding check ([#52](https://github.com/elicollinson/solenoid-security/issues/52)) and the deferred
Qwen3.6 27B.

## Design

**Goal:** a short list of self-hostable screening recommendations that substantially reduce prompt-injection risk
and malicious agent actions, behind one simple interface. Callers make one `screen` call at each trust boundary and
gate writes with `authorizeTool`. What runs behind that call (which technique, which models, how verdicts combine)
comes from a layered, overridable configuration whose defaults are set by measured performance.

**Configuration layers.** App-wide defaults are set once in `createSecurity`, and any setting can be overridden per
call (see [Screening configuration](#screening-configuration)). That part exists today, along with the pieces the
evidence so far points to: a self-hostable LLM judge that asks the exact score-only question the evals measured
([`OpenAICompatibleJudge`](#self-hosted-llm-judge)), the full-then-windows `cascade` technique, and an explicit
inconclusive outcome so a judge that runs out of tokens is never read as a pass. The planned layer is
**recommendation profiles**: evidence-backed defaults per content type (long documents, code, email, web pages, tool
output, encoded text, user prompts), per common self-hostable model, and per technique, each traceable to an
observation in [`FINDINGS.md`](evals/FINDINGS.md).

**What the evidence suggests so far** (provisional; the full-text baseline and the varied-template extension suite are complete, at full text only):

| Content | Current recommendation | Why |
|---|---|---|
| Long documents and code | Full text with a reasoning detector; add a windows pass only when the full-text verdict is negative | Windows lift subtle-injection recall on papers, but can lower concern for a payload. The full-then-windows cascade never lost a full-text detection ([O1](evals/FINDINGS.md), [O10](evals/FINDINGS.md), [O46](evals/FINDINGS.md)) |
| Email, résumés, web pages | Full text | Windows were neutral or harmful ([O4](evals/FINDINGS.md), [O9](evals/FINDINGS.md)) |
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

1. **[`evals/FINDINGS.md`](evals/FINDINGS.md):** 63 observations, each with numbers, sample size, strength rating,
   confounds and a follow-up, plus an open-questions backlog and future research avenues.
2. **Key reports:** [Studio baseline](evals/reports/studio-baseline-q8-t4096-2026-10.md) ·
   [Studio extension](evals/reports/studio-extension-q8-t4096-2026-10.md) ·
   [LLaDA2.2-flash](evals/reports/llada-flash-full-2026-10.md) ·
   [MoE vs dense panel](evals/reports/lmstudio-moe-dense-panel-2026-10-05.md) ·
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

Screen untrusted source content before an AI agent consumes it. Configure a provider once, then call `screen` at the boundary where text enters your agent. Text can be judged by Google Cloud Model Armor or by a [self-hosted LLM judge](#self-hosted-llm-judge) on any OpenAI-compatible endpoint; the input API can grow to images and documents in later releases.

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
| `models` | Names from `providers`. A single `provider` is named `"default"`. | Every configured provider |
| `aggregator` | `"any"`, `"all"`, `{ kind: "score", reduce: "max" \| "mean" \| "min", threshold, comparator?: ">" \| ">=" }`, or a function over every segment-by-model assessment | `"any"` |

Every model screens every segment, and the aggregator sees the whole matrix, so a function can express rules such as "two of three models agree". The score comparator defaults to `>`. Without a `seed`, random chunk boundaries are unpredictable; pass one only when you need reproducible chunks. The chunk techniques split on the same code as the [eval workspace](evals/README.md) input strategies of the same `kind`, so evaluate a technique, model, and threshold together before adopting them. A Model Armor PI verdict is binary and scores 1 or 0.

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
    // apiKey, timeoutMs (120000), temperature (0), maxTokens (4096),
    // reasoningEffort, threshold (0.5, compared with ">"), responseFormat ("json_schema")
  }),
});
```

| Setting | Default | Notes |
| --- | --- | --- |
| `maxTokens` | `4096` | Shared by reasoning and the answer. A 1,024 cap cut verbose reasoning models off before they answered ([Appendix A](evals/FINDINGS.md)). |
| `reasoningEffort` | unset | Sent as `reasoning_effort`. Prefer builds that actually reason ([O42](evals/FINDINGS.md)). |
| `threshold`, `comparator` | `0.5`, `">"` | A score above the threshold flags. |
| `responseFormat` | `"json_schema"` | `"prompt_json"` omits `response_format`, for LM Studio MLX builds that route schema-constrained output to `reasoning_content`. |

The answer must be exactly `{"concernScore": <0..1>}`. A cut-off response (`finish_reason: "length"`), an answer only in the reasoning channel, malformed JSON, or an out-of-range score is never clamped or guessed: it is an **inconclusive** assessment (`label: "INCONCLUSIVE"`, `inconclusive: true`, `inconclusiveReason`, `score: NaN`). An HTTP error or a body that is not a chat completion throws. Each assessment also records `usage` (including `reasoningTokens`), `finishReason`, `responseId` and the answering `model`. Small non-reasoning judges can be steered into the score an injection asks for ([O12](evals/FINDINGS.md)), so evaluate a model before relying on it.

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

## License and citation

The code is released under the [MIT License](LICENSE): free to use, modify and redistribute, provided as-is with no
warranty or liability. Evaluation datasets keep their upstream licenses ([sources](evals/datasets/PUBLIC_SOURCES.md)).

If you use the library, results or findings in your work, please cite it. GitHub's "Cite this repository" button
generates APA and BibTeX from [`CITATION.cff`](CITATION.cff):

```bibtex
@software{collinson_solenoid_security_2026,
  author = {Collinson, Eli},
  title  = {Solenoid Security: screening untrusted content for AI agents, with an open prompt-injection evaluation lab},
  year   = {2026},
  url    = {https://github.com/elicollinson/solenoid-security},
  license = {MIT}
}
```
