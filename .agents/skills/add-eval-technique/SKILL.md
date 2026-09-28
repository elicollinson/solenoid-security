---
name: add-eval-technique
description: Add or tune a security evaluation input strategy or decision technique in solenoid-security, such as chunking, turn selection, aggregation, or thresholds. For attack-technique labels, update dataset facets instead.
---

# Add an evaluation technique

Read `evals/README.md`, `evals/src/types.ts`, `evals/src/strategies.ts`, `evals/src/decisions.ts`, and the relevant suite. In this repo a **technique** changes what the engine sees or how its raw output becomes a case decision. If the user means an attack category, place it in case facets through the dataset workflow.

1. Put segmentation and turn-selection dials in `InputStrategy`; put aggregation, comparison, and score threshold in `DecisionRule`. Bind them to an engine and test via `EvalCondition`. Do not bake a model-specific threshold into the raw observation or an engine adapter.
2. Version the strategy or rule ID when behavior or parameters change. Make segmentation deterministic and record enough information to reproduce the exact segments: seed derivation, size, overlap or stride, selected turns, segment indexes, text hashes, and source turn IDs. Check that boundaries and coverage match the intended method.
3. Preserve every segment's native raw score or verdict. A full-text strategy produces one segment, so a max of one numeric score is that score; a binary engine still yields a verdict. A threshold or aggregation change can be replayed from saved observations without provider calls. A segmentation or prompt-input change needs new inference.
4. Add focused tests for deterministic segmentation, edge cases, and decision behavior. Run `bun run eval:typecheck`, `bun run eval:test`, and a suite dry run. Execute live calls only when the task includes them.

Report the strategy/rule IDs, parameter values, engine/test bindings, whether old observations can be replayed, and validation.
