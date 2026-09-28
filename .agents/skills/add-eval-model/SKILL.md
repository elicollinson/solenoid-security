---
name: add-eval-model
description: Add or revise an inference model, provider, Model Armor template, or scoring protocol in solenoid-security evaluations. Use when changing the decider that judges segments, not a dataset or chunking technique.
---

# Add an evaluation model

The eval layer calls deciders **engines**. Read `evals/README.md`, `evals/src/types.ts`, `evals/src/engines.ts`, the target suite, and relevant engine tests before editing. Keep the published screening SDK separate from eval changes unless the user asks to change it.

1. Determine whether this is a new model on an existing protocol, a new prompt/question or response schema, a provider change, or a Model Armor template. Give a changed configuration a distinct engine ID. Pin provider/model/template, prompt or question ID and hash, schema, parameters, and fallback policy so results remain comparable.
2. Extend `EngineSpec` and `inferText` only when the existing adapter cannot express the new decider. Validate the actual resolved provider/model and response schema. Capture the native numeric `rawScore` or binary `rawVerdict` on every observation; do not synthesize a probability from a binary filter. Preserve response IDs, usage, timing, errors, and raw provider response in the ignored run checkpoint.
3. Add suite conditions that bind the engine to an input strategy and decision rule. These dials may be model-specific and test-specific. Keep historical Agent-based Gemma results separate from the newer direct-chat protocol; changed prompts or protocols need new IDs.
4. Cover parsing, provenance mismatch, and failure handling with mocked provider responses. Run `bun run eval:typecheck`, `bun run eval:test`, and a dry run for the affected condition. Execute paid/live calls only when requested by the task.

Report the engine ID, exact protocol/version, output type, suite conditions, validation, and comparability limits.
