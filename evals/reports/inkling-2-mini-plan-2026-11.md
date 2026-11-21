# Inkling-2-Mini on the frozen Studio protocol: pre-registration (2026-11-21)

Committed before any Inkling request reaches the Studio. Tooling: [`evals/analysis/inkling-2-mini-2026-11/`](../analysis/inkling-2-mini-2026-11/).
Run dir (git-ignored): `evals/runs/inkling-2-mini-2026-11/` (progress log: `progress.log`).

## Model and variants

[thinkingmachines/Inkling-2-Mini](https://huggingface.co/thinkingmachines/Inkling-2-Mini) was released 2026-11-20 under Apache 2.0.
It is a 26.4B-total MoE with 3.4B active parameters, about 5.4B effective because it is a looped transformer whose middle 12
layers run 3 times. It is multimodal (text and image) with a 1M context. The user downloaded two builds on the Mac Studio.

| Variant | Role | Studio inventory identity (pinned) | HF source |
|---|---|---|---|
| `q8` | **primary**, protocol-matched: GGUF Q8_0 on llama.cpp, like every prior Studio model | `inkling-2-mini`, `lmstudio-community/Inkling-2-Mini-GGUF/Inkling-2-Mini-Q8_0.gguf`, 28,461,905,056 bytes (Q8_0 + BF16 mmproj), arch `inkling2_loop` | `lmstudio-community/Inkling-2-Mini-GGUF` @ `23c938b`; Q8_0 sha256 `0689d67d…`, mmproj `45fc9cdc…` |
| `mlx4` | **secondary**, not protocol-matched: a different runtime (MLX) **and** a different quantization (4-bit) | still downloading at commit time. Pinned by the chain under a **pre-registered rule**: exactly one Studio `safetensors` entry whose key or file contains `inkling-2-mini`, identical on two probes 2 min apart. The HF file list and revision are recorded at that moment; zero matches defer, several skip | from the inventory (mlx-community/Inkling-2-Mini-4bit and -oQ4e-mtp are the candidates; "kf" in the request is unresolved until then) |

Both pins (model key, indexed file, byte size, quantization) must match the inventory on two probes 2 min apart. The HF LFS
hashes must also be unchanged before the variant runs. Anything else is skipped, never run.

## Template and reasoning setting (fixed now)

- **Template audit** (`template-audit.py`, offline). The chat template embedded in the lmstudio-community and ggml-org
  Q8_0 GGUF headers is byte-identical to the upstream `chat_template.jinja` (sha256 `53a9035f…`), and so are the
  mlx-community 4bit and oQ4e-mtp templates. The template adds one system message, `Thinking effort level: <n>`, before
  the first non-system turn. It accepts `none|minimal|low|medium|high|xhigh|max` or a float in [0, 0.99]. An unknown
  string **raises**; it does not fall back silently. With no effort given it uses **0.9, the same as `high`**. On our
  score-only system prompt, every value renders the same token count except `none`, which is 2 tokens shorter.
- **Setting: `reasoning_effort: "high"`, max_tokens 4096**, the same request every frozen Studio engine sent. It is also the
  model's own default (0.9), so the rendering is 0.9 whether or not LM Studio forwards the field. Reasoning counts
  against the 4096-token cap, and an exhausted cap is a length abstention, as for every other model.
- **Speculative decoding / MTP (#52)**: LM Studio's default, not set by the driver, as for every frozen engine. The
  pre-run probe records the load config. Every response also records the draft-token counts, which are reported per
  cell and in the report.

## Sequence (one armed chain, `run-chain.sh`, launched with nohup)

The user ordered that abliteration stage 3 finishes first. The chain therefore sends **no Studio request of any kind**
until stage 3's `progress.log` has a `DONE` line written after its latest `CHAIN_START`. It also waits for no matrix
driver, no abliteration chain process, no device lock and no study model. It then runs the variants in order `q8`,
then `mlx4`. For each variant:

1. **Probe** (`probe/probe-reasoning.ts`). Synthetic inputs only. The probe loads the pinned file under a probe
   identifier, sends native-v0 requests at no effort, `high`, `low`, `medium`, `xhigh`, `none`, `minimal` and an unknown
   value, plus `/v1` at no effort, `high` and `low`. It records prompt, reasoning and draft tokens and the load config,
   then unloads only its own instance.
   **Binding gate:** the probe loaded the pinned Studio file, and on both inputs `high` and no-effort return 200 with a
   JSON `concernScore` and have identical prompt_tokens, reasoning hash and content hash. A failure skips the variant.
   The rest is reported only: effort forwarding, unknown-value behaviour and MTP.
2. **Pilot**: 50 cases, the first N of each cohort in dataset order. These are bipia-email-mixed 24,
   benign-false-positives 8, longpi-paper 6, agentdyn-shopping 6 and browsesafe-mixed 6, under condition
   `pilot-<label>-t4096-full`.
   **Binding gate:** all 50 cases finished; identity (response model, `model_info.quant`, loaded file) and usage on every
   response; abstentions ≤ 25%. The PILOT line reports the parse rate, abstentions, wall time, reasoning, draft counts and
   the full-run estimate. The estimate is each of Gemma 4 26B-A4B, Qwen3.6 35B-A3B and Ornith's summed frozen wall time
   over the 35 datasets, times the pilot/frozen wall ratio on the same cases; the central value is the median. A
   failure skips the variant.
3. **Drift / rendering gate**: the first 24 bipia-email-mixed cases under the run condition.
   **Binding:** 24/24 finished, prompt_tokens equal to the pilot's on the same cases 24/24, identity 24/24. Outcome
   agreement and identical answers are reported only.
4. **Full run**: the 21 baseline datasets (7,326 cases), then the 14 extension datasets (6,759 cases), in the frozen
   suite order, under condition `baseline-<label>-t4096-full`. Each produces a CELL line with completeness, abstentions
   (length/output), BA@0.5 (abstentions excluded), reasoning, wall time, usage, identity and draft counts, followed by a
   MODEL_DONE line. Tests, input strategy (`full`) and decision rule (`score05`) are copied JSON-identical from the frozen
   suites. The engine is the frozen `gemma26-q8` engine with only the model identity, the effort note and the speculative
   record changed (checked by `ink.ts suites`).

Frozen protocol: temperature 0, max_tokens 4096, the score-only JSON prompt (`security-eval-score-only-json-v1`),
native-v0, context 65,536, parallel 1, serial (concurrency 1), `--require-device`, the device lock and
`--continue-after-output-errors`.

## Failure handling (stage 3 rules)

- A transport failure is `provider_or_transport_error`, `EINTR` or "interrupted system call" in the step's console
  output. It reruns the whole cohort under a fresh condition (`-r1`, `-r2`; suite `-v2`, `-v3`) after LM Link
  reconnects. There are at most 2 reruns before HALT (L141). The partial checkpoint is kept and never resumed.
- Any other runner failure skips the variant; two in a row halt the chain. An unclean device halts it: a lock or a
  study model left after a step.
- **ABSTENTION_RUNAWAY**: more than 25% abstentions on a cell stops the variant. Otherwise abstentions are reported only.
- The user's own loaded models are waited for, up to 4 h, and never unloaded. `google/gemma-4-26b-a4b-qat` is tolerated
  (as in stage 3).
- There is a per-variant cap of 2× the pilot estimate. A variant absent or still downloading for 24 h with nothing else
  to run is given up; that is not an attempt.
- Checkpoints are never deleted or overwritten. The chain is restart-safe: passing cells are not rerun.

## Analysis (after both runs)

Per dataset and suite macro BA@0.5 (abstentions excluded), FPR, abstention rates and AUROC, set beside the frozen Studio
rows (8 models, the same cases). For the MLX secondary, a paired comparison with the Q8 primary on identical cases
(exact McNemar). It is reported as a runtime and quantization contrast, not a protocol-matched row. Speed (true tok/s
with the draft state stated) and Studio hours. Everything is descriptive and uncorrected unless stated otherwise.
