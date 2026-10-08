# New-model qualification plan (prepared 2026-10-04, nothing executed)

Prepared while another agent holds the MacBook for the live available-panel run. No model was loaded, no
inference was run, and the device lock and the running panel's suite/run directories were not touched.
The only new repo file is the suite below. **The dry run was not run** (see "Before the first run").

## Key finding: these five models are not new downloads

All five candidates were already in the very first LM Link inventory (`evals/runs/lmstudio-connection-2026-10-03/inventory.txt`,
Oct 3 17:10) with the **same sizes as now**. GLM, Nemotron and LFM2 were already registered in
`prompt-injection-lmstudio-v1.json` (64-token, reasoning-off preset; never run). The current `lms ls --json` (21 entries)
is identical to Codex's last snapshot (`inventory-full-panel-2026-10-04T1641.json`).
The batch Codex actually requested (`model-selection-2026-10-03/next-download-batch-2026-10-04.json`) has **not arrived**,
apart from Qwen3.8: Gemma 4 31B **-it** MLX8, Nemotron **3.5 Lightning** Q8, Laguna XS 2.1 Q8, and KAT-Coder V2.5 Dev Q8.
Ask the user to check whether those downloads finished on the MacBook.

## Candidate identities (from `lms ls --json`, device `c575a267c1d9cc0df57f986171b2b0e6`)

| Engine key in new suite | modelKey / indexed artifact | Arch (inventory) | Format / quant | sizeBytes | Instruct? | Concerns |
|---|---|---|---|---:|---|---|
| `glm47-flash-mlx8-thinking1024` | `zai-org/glm-4.7-flash` | glm4_moe_lite, **MoE** 30B/~3B | MLX 8bit | 31841422272 | Yes (official chat model; reasoning on/off advertised, default on) | Jan 2026 release. Codex had put it in reserve because "fitting the band ≠ current best". |
| `nemotron3-nano-mlx8-thinking1024` | `nvidia/nemotron-3-nano` | nemotron_h, **hybrid Mamba/attention MoE** 30B/~3B | MLX 8bit | 33577236003 | Yes (official; reasoning on/off advertised, default on) | Dec 2025. Its successor, Nemotron 3.5 Lightning, was requested and is missing. Hybrid SSM is a confound. |
| `lfm2-24b-a2b-mlx8-thinking1024` | `liquid/lfm2-24b-a2b` | lfm2_moe, **MoE** 23.8B/~2B (conv + attention hybrid) | MLX 8bit | 25339253879 | Yes (official) | **Below the 25B floor.** Context is unresolved: the card says 32,768 native, but config/inventory say 128,000. Paper inputs are about 36–66 KB, so a 32K engine can't even run the paper qualification. Registered at 65,536 only as an optional, **out-of-panel** condition. |
| `qwen35-27b-opus-distill-mlx6-thinking1024` | `mlx-community/Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit` | qwen3_5, **dense** 27B | MLX 6bit | 21876570312 | Yes (community reasoning-distillation SFT of Qwen3.5-27B by Jackrong; MLX-quantized by mlx-community) | Community fine-tune of an *older* Qwen (3.5) built on synthetic Claude traces. Same family as Qwen3.8, so it is **not an independent dense family**. Long chain-of-thought may exhaust the 1,024-token budget, causing length abstentions. 6-bit is another quant confound. |
| `qwen36-27b-fable-fusion-mlx6-thinking1024` | `philipjohnbasile/Qwen3.6-27B-Fable-Fusion-711-MTPLX-6bit` | qwen3_5, **dense** 27B (+MTP heads) | MLX 6bit | 23657565978 | Chat-capable, but it is a **creative-writing merge of DavidAU "…Uncensored-Heretic…" (abliterated)** | **Not recommended as a "current dense" representative.** Abliteration and creative-writing tuning plausibly change refusal/instruction recognition, and MTP speculative decoding adds a drafting confound. Same Qwen family again. Registered only so it can be run as a labelled curiosity. |

**Muse Glimmer is dense.** Meta's official architecture description says dense with local/global attention, and the
inventory reports arch `muse-glimmer`, 28B. One quantizer's table calls it MoE, and the design doc already records that
table as wrong. Muse is still a Q4_K_M confound relative to the Q8 models.

## How Codex added and qualified a model (convention followed exactly)

- **Config location:** a new versioned suite JSON in `evals/suites/`. Codex never edited a suite after it had been run.
  Each engine has kind `llm_score_json`, provider `lmstudio`, prompt `security-eval-score-only-json-v1`
  (sha `f194db14…7d36`), schema `concern-score-only-json-v1`, and parameters `{temperature:0, max_tokens:1024, reasoning_effort:"high"}`.
  This is the "thinking1024" protocol used for **every** larger model (Muse, Qwen3.8, Gemma26, Ornith). The `lmStudio`
  block pins baseUrl `http://127.0.0.1:1234`, modelKey, indexedModelIdentifier, deviceIdentifier, format, quantization,
  sizeBytes, `contextLength: 65536`, `parallel: 1`, `timeoutMs: 300000`. `validateLMStudioConfig` only allows max_tokens
  64 or 1024. The driver refuses to load unless the inventory row matches all of these fields.
- **Provenance:** every request snapshots `lms ps --json` before and after inside a `lmstudio-provenance/v1` envelope.
  Codex also saved an inventory snapshot plus `qualification-audit.json` per model
  (e.g. `evals/runs/lmstudio-qwen38-full-2026-10-04/`).
- **Qualification ("first6"):** `longpi-paper` full input, `--max-new-segments=24`. That is the first 6 ordered paper
  families: 18 attacks and 6 clean, resumable into the full 400-case cohort.
  - **Pass:** 24 valid responses with no protocol failures. Granite failed on its output channel and token limit.
    Gemma31-base was excluded because 4 of 6 clean papers were flagged.
  - **Reasoning behaviour:** check the native responses. Requested "high" doesn't prove the runtime reasoned
    (Gemma26 reported 0 reasoning tokens).
- **New suite:** `evals/suites/prompt-injection-lmstudio-new-panel-thinking1024-v1.json`. It is a copy of the Qwen3.8
  full-input suite: same 6 tests (benign-false-positives, bipia-email-mixed, longpi-paper, longpi-code,
  paper-score-counterfactual, longpi-email), same `full` strategy and `score05` rule. There is one `<engine>-full`
  condition per model, with values pinned from today's inventory. No windows (full-input-first).
- **New output directory:** `evals/runs/lmstudio-new-panel-2026-10-04`. It does not exist yet; the driver creates it.

## Before the first run

1. Wait for the other agent's run to finish:
   - `evals/runs/lmstudio-device.lock` must be gone.
   - `lms ps --json` must be empty. The driver refuses to start if any model is loaded.
2. Make sure the relay is up: `lms server start --bind 127.0.0.1 --port 1234`.
3. Re-check the inventory with `lms ls --json`. If any sizeBytes changed, make a **new** suite version; don't edit this one.
4. Dry run. I attempted it, but the sandbox's auto-mode classifier blocked `eval:local` while the device was busy.
   It is side-effect-free: the driver exits before taking the lock. Run it first:
   ```sh
   S=evals/suites/prompt-injection-lmstudio-new-panel-thinking1024-v1.json; O=evals/runs/lmstudio-new-panel-2026-10-04
   bun run eval:local --suite=$S --tests=longpi-paper --output-dir=$O
   bun evals/scripts/run-suite.ts --suite=$S --test=longpi-paper --condition=glm47-flash-mlx8-thinking1024-full --output=$O/longpi-paper/glm47-flash-mlx8-thinking1024-full.jsonl
   ```

## Ordered commands

Common prefix: `bun run eval:local --execute --suite=$S --output-dir=$O`. The driver loads, runs and unloads one model
at a time. If a run pauses on `output_abstention` or `length_abstention`, inspect the native body first. Only then
resume with the same command plus `--continue-after-output-errors` (as was done for Muse and Qwen).

**Stage 1: qualification (24 cases each).** Run in this order. Stop and review each `qualification-audit` before moving on.

```sh
bun run eval:local --execute --suite=$S --output-dir=$O --tests=longpi-paper --max-new-segments=24 --conditions=glm47-flash-mlx8-thinking1024-full
bun run eval:local --execute --suite=$S --output-dir=$O --tests=longpi-paper --max-new-segments=24 --conditions=nemotron3-nano-mlx8-thinking1024-full
bun run eval:local --execute --suite=$S --output-dir=$O --tests=longpi-paper --max-new-segments=24 --conditions=qwen35-27b-opus-distill-mlx6-thinking1024-full
# optional / labelled out-of-panel:
bun run eval:local --execute --suite=$S --output-dir=$O --tests=longpi-paper --max-new-segments=24 --conditions=qwen36-27b-fable-fusion-mlx6-thinking1024-full
bun run eval:local --execute --suite=$S --output-dir=$O --tests=longpi-paper --max-new-segments=24 --conditions=lfm2-24b-a2b-mlx8-thinking1024-full
```

**Stage 2: full-input cohorts, qualified models only.** Use the same order that was used for the earlier panel. `C` is a qualified condition ID.

```sh
bun run eval:local --execute --suite=$S --output-dir=$O --conditions=$C --tests=bipia-email-mixed            # 156
bun run eval:local --execute --suite=$S --output-dir=$O --conditions=$C --tests=benign-false-positives       # NotInject 339
bun run eval:local --execute --suite=$S --output-dir=$O --conditions=$C --tests=longpi-email --limit=80      # first 20 families (separate -limit80 cohort, as planned for Qwen3.8)
bun run eval:local --execute --suite=$S --output-dir=$O --conditions=$C --tests=paper-score-counterfactual   # numeric probes 72
bun run eval:local --execute --suite=$S --output-dir=$O --conditions=$C --tests=longpi-code                  # code-review 400 (matches full-code-plan.json)
```

After each cohort, regenerate the comparison with Codex's existing scripts. Point them at the new checkpoints:
- `evals/runs/lmstudio-available-panel-2026-10-04/summarize-full-baselines.ts`
- `evals/runs/lmstudio-available-panel-2026-10-04/compare-first6-protocol.ts`
- `bun evals/scripts/summarize-lmstudio.ts`

Those scripts hard-code configuration lists, so adding the new models means extending those lists.

## Time estimates (request time only; add about 1–3 min per model load)

These are based on measured means for similar configurations: Ornith/Gemma26 for the A3B MoEs, and Qwen3.8/Muse for the 27B dense models.

| Cohort | Calls | MoE A3B (GLM, Nemotron, LFM2) | Dense 27B (Opus-distill, Fable) |
|---|---:|---|---|
| Qualification | 24 | ~2–6 min | ~20–25 min |
| BIPIA | 156 | ~3–13 min | ~1.1 h |
| NotInject | 339 | ~4–19 min | ~2.5 h |
| Email80 | 80 | ~2–10 min | ~50 min |
| Numeric | 72 | ~2–13 min | ~1 h |
| Code | 400 | ~10–45 min | ~3–3.5 h |

Per model, the full set of cohorts takes about **0.5–1.7 h for a MoE** and **about 9 h for a dense model**.
Qualifying all five takes about 1.2 h. Running every cohort for GLM, Nemotron and Opus-distill takes about 12 h.

## Resulting roster (if qualification passes)

| | Dense | MoE |
|---|---|---|
| 1 | Muse Glimmer Q4_K_M (qualified) | Gemma 4 26B A4B MLX8 (qualified) |
| 2 | Qwen3.8 27B Q8_0 (qualified) | Ornith 1.5 35B A3B Q8_0 (qualified; Qwen-derived) |
| 3 | Qwen3.5-27B Opus-distill MLX6 (candidate; Qwen fine-tune) | GLM-4.7-Flash MLX8 (candidate) |
| 4 | *(Fable Fusion MLX6: not recommended, abliterated creative merge)* | Nemotron 3 Nano MLX8 (candidate) |
| 5 | **gap** | Sarvam 30B Q8_0 (reserve; protocol untested). LFM2 is out of band. |

**MoE can reach 5.** **Dense realistically reaches 3**, and two of those three are the Qwen family.
Codex's rule: don't pad the dense side with old or altered checkpoints.

### Recommended single download batch for the dense gap (≥5, user-managed)

1. `unsloth/gemma-4-31B-it-GGUF` Q8_0. Instruction-tuned Gemma dense, which fixes the base-model substitution and pairs
   with Gemma26. (`lmstudio-community/gemma-4-31B-it-MLX-8bit` was already requested and is also acceptable.)
2. `ibm-granite/granite-4.2-30b-GGUF` Q8_0. Official GGUF; tests whether Granite's failures came from the MLX runtime or
   template rather than the model.
3. `ukisai/Swift-1.5-Qwen3.8-27B-GGUF` Q8_0. Pinned at 29,047,084,416 bytes. A within-Qwen efficiency contrast, not
   an independent family.
4. `unsloth/Muse-Glimmer-30B-GGUF` Q8_0. Removes Muse's Q4 confound. It is the same model, so it doesn't add a slot.
5. Re-request the still-missing MoE items from the earlier batch:
   - `unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF` Q8_0, which would replace the older Nemotron 3 Nano
   - `ggml-org/Laguna-XS-2.1-GGUF` Q8_0
   - `bartowski/Kwaipilot_KAT-Coder-V2.5-Dev-GGUF` Q8_0

   Pinned revisions are in `next-download-batch-2026-10-04.json`.

Even with that batch, the earlier searches found only about **4 independent current dense families** in 25–40B:
Qwen3.8, Muse, Gemma 4 31B and Granite 4.2. K2 32B is runtime-blocked. Report an honest 4-dense panel rather than padding it.
