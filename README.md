# Solenoid Security

The separate [evaluation workspace](evals/README.md) holds prompt-injection datasets, engine/input-strategy experiments, raw-score checkpoints, and historical comparisons. It is not part of the published runtime package.

Screen untrusted source content before an AI agent consumes it. Configure a provider once, then call `screen` at the boundary where text enters your agent. The first release supports text through Google Cloud Model Armor; the input API can grow to images and documents in later releases.

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

## Screening configuration

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
| `technique` | `{ kind: "full_text" }`; `{ kind: "random_word_chunks", minWords, maxWords, seed? }`; `{ kind: "sliding_word_window", windowWords, strideWords }` | `full_text` |
| `models` | Names from `providers`. A single `provider` is named `"default"`. | Every configured provider |
| `aggregator` | `"any"`, `"all"`, `{ kind: "score", reduce: "max" \| "mean" \| "min", threshold, comparator?: ">" \| ">=" }`, or a function over every segment-by-model assessment | `"any"` |

Every model screens every segment, and the aggregator sees the whole matrix, so a function can express rules such as "two of three models agree". The score comparator defaults to `>`. Without a `seed`, random chunk boundaries are unpredictable; pass one only when you need reproducible chunks. The chunk techniques split on the same code as the [eval workspace](evals/README.md) input strategies of the same `kind`, so evaluate a technique, model, and threshold together before adopting them. A Model Armor PI verdict is binary and scores 1 or 0.

The aggregator decides only prompt injection. A match on any other content filter from any model or segment still blocks. `result.assessment` is the aggregated assessment and `result.assessments` lists each model's result for each segment. Any provider failure fails the whole screen with `ScreeningError`. Chunking multiplies provider calls by the number of segments, and the calls run concurrently.

## Decisions

| Decision | Meaning |
| --- | --- |
| `allow` | No configured filter matched, or no untrusted text remained after authored text was removed. |
| `observe` | Prompt injection was flagged in confirmed operator or prior local agent text; record it and continue. |
| `quarantine` | Prompt injection was flagged in external tool output; keep that output out of model context. |
| `block` | Prompt injection was flagged at another external boundary, or a different content safety filter matched. |

The provider result is included in `assessment` when screening runs. A provider failure throws `ScreeningError`; callers must stop or otherwise contain that source. A failed or incomplete scan is never an `allow` result.

The default Model Armor adapter requires a project and a template with its prompt injection filter enabled. It supports an API key, an injected token callback, or Google application default credentials. Pass `getAuthToken` and `fetchFn` to test without a cloud account. Model Armor requests send text to Google Cloud; choose a provider and retention policy appropriate for your data.

```ts
const scanner = new ModelArmorScanner({
  projectId: "my-project",
  location: "us-central1",
  templateId: "base-detector",
  // apiKey: process.env.MODEL_ARMOR_API_KEY,
});
```

## Provenance

Register only **literal text written by your application**. The registry removes exact authored spans before a provider sees a mixed tool result, while leaving external content to be screened. Never register a string that contains interpolated user, document, web, or tool data.

```ts
security.authoredText.register(
  "tool:search",
  "This search tool returns excerpts from external web pages for reference only.",
);
```

`origin: "operator"` means the person controlling the assistant, not simply the first message. Retrieved messages, pages, screenshots, and memory records containing other people's text remain `external` wherever they appear.

## Tool gating

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

## Install and develop

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
