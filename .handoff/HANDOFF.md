# Codex → Claude Code handoff (security evals)

Source: Codex rollout `~/.codex/sessions/2026/09/29/rollout-2026-09-29T21-44-14-…jsonl` (Codex Desktop, one long thread
with 10 compactions in the last 24h). The thread stopped at **2026-10-04 16:44 UTC** because Codex hit its weekly
usage limit (resets Oct 10). Extracted transcript: `.handoff/codex-transcript.md`.

## Goal
Codex's goal for the thread: "Add and validate an LM Studio evaluation backend, then continue strategic injection-detection
research on downloaded MacBook Pro models within the user's size range, preserving all outputs and documenting decisions.
Request unavailable models only in batches of at least five."

User direction during the last 24h:
- Run models on the MacBook Pro through LM Studio's LM Link remote feature, with the agent managing models.
- After the small models, run a MoE vs. dense comparison: about 5 of each, current models (picked from benchmarks, blogs and Reddit,
  not scaled-up old versions), 25–40B parameters.
- (Oct 4) Run MoE vs. dense on **full input, no chunking**, first. Write up the cases where models *followed* the injection.

## Decisions
- LM Link setup: the Mac mini's localhost API (`127.0.0.1:1234`) forwards requests to the MacBook. Models are managed with `lms`. Downloading new
  models onto the MacBook can't be done remotely yet, so the user downloads them.
- Runs are serial, resumable and reuse exact inputs. Raw responses go under the git-ignored `evals/runs/`.
- Invalid or abstained outputs are counted separately from misses. Numeric concern scores get counterfactual checks
  (low/high target payloads), because some "detections" were the model copying the score the attacker asked for.
- Window/chunking runs are deferred until the full-input baselines finish.
- Excluded models: Gemma 31B MLX (base model), both K2 (fail to load), Granite (protocol failures, deferred). Sarvam 30B is held in reserve.

## Done (last 24h)
- LM Studio adapter in `evals/src/engines.ts`, `rateGate.ts`, `types.ts`, `run-suite.ts` and `src/techniques.ts`
  (+570/−55 across 10 files). **Not committed.**
- Ran small models: Gemma E2B and E4B. Chunking added 10 detections each on the 60-attack paper cohort,
  but E2B dropped from 37 to 34 of 60 on email.
- Qualified the larger models: Muse Glimmer Q4, Qwen3.8 27B Q8, Gemma4 26B A4B (MoE), Ornith 1.5 35B A3B (MoE).
- Full-input BIPIA (78 attacks, 78 clean):
  - Gemma26: 60 attacks caught.
  - Ornith: 49 caught.
  - Qwen: 18 of 75 scored.
  - All three: 0 clean flags.
- Email (60 attacks, 20 clean):
  - Gemma26 and Ornith: 60/60.
  - Muse: 59/60.
  - All: 0 of 20 clean flagged.
- Also run: the NotInject benign comparison (339 cases), hosted-vs-local transfer, native work/latency, and a translation diagnostic.
- Wrote `evals/reports/injection-following-findings-2026-10-04.md`, with a 72-case regression set. E2B copied the score the
  attacker asked for in 13 of 18 pairs; E4B did in 2 of 18.
- Summary index: `evals/reports/lmstudio-research-index-2026-10-04.md`. About 50 new reports, plus figures, are untracked.
- The OpenRouter budget ($19.64) is used up. The Model Armor ledger shows about $10.22 of the $30 cap.

## In progress when it stopped
- **Muse BIPIA full-input run** stopped at **107/156** with `Evaluation paused after 107/156: output_abstention`
  (case `be-d003862156c1121badc878cd`: the reasoning ran out of budget and the content came back empty). Files:
  `evals/runs/lmstudio-available-panel-2026-10-04/{console.log,bipia-email-mixed/muse-glimmer-q4-thinking1024-full.jsonl}`.
  The run needs to be resumed (the checkpoint resumes).
- The user said "the rest of the models have downloaded", but the LM Link inventory hadn't shown them as of 16:41 UTC.
  Codex tried to check the LM Studio UI, but was blocked on macOS computer-use permission.

## Next steps (Codex's queue)
1. Resume Muse BIPIA (full input) and audit it.
2. Run Qwen benign (NotInject) and email full-input cohorts (already validated).
3. Refresh the LM Link inventory, then qualify the newly downloaded models toward 5 MoE + 5 dense.
4. Run the prepared full code-review cohort (`evals/runs/lmstudio-code-panel-2026-10-04/full-code-plan.json`) on the
   5 configurations not yet run. E4B's 400 cases and Model Armor's 1,200 outputs are reused.
5. After that, return to window/chunking runs for Muse and Ornith.
6. Commit the adapter, datasets and reports. Nothing from this work is committed yet.
