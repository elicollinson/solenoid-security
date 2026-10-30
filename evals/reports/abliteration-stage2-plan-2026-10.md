# Abliteration extension, stage 2: pre-registered pilot screen (2026-10-27)

Status: **frozen, armed, not run.** This plan is fixed before any stage 2 inference. Stage 2 starts automatically
when stage 1 (the two Qwen3.8 builds at `low` on the full suites, [plan](studio-qwen38-abliterated-low-plan-2026-10.md))
writes `RUN_DONE`. It extends FINDINGS O53 ([#23](https://github.com/elicollinson/solenoid-security/issues/23)) from
one model family to four (five with Muse): does abliteration lower prompt-injection detection across families and
methods, and does the size of the change track the build's reported KL divergence?

- Plan, builds and gates: [`analysis/abliteration-stage2-pilot-2026-10/plan.json`](../analysis/abliteration-stage2-pilot-2026-10/plan.json)
- Template audit: [`template-audit.py`](../analysis/abliteration-stage2-pilot-2026-10/template-audit.py) →
  [`results/template-audit.json`](../analysis/abliteration-stage2-pilot-2026-10/results/template-audit.json)
- Chain: [`run-chain.sh`](../analysis/abliteration-stage2-pilot-2026-10/run-chain.sh) (with `pin.ts`, `make-suite.ts`,
  `dryrun.py`, `gate.ts`, `cell.ts`, `summarize.ts`, `rows.ts` in the same folder)
- Run directory (git-ignored): `evals/runs/abliteration-stage2-pilot-2026-10/`; progress in `progress.log`

## Design

Each build runs the **998 pilot cases** (the nine tests and `caseIds` of
[`suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json`](../suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json),
SHA-256 `445ecbe2…c112`, copied JSON-identical). Each build is compared with **its own vanilla model's existing
full-suite checkpoint, restricted to those caseIds**. No vanilla model is rerun. The vanilla side is audited whole by
the repo's partial auditor (suite, engine, dataset, input hashes) and then filtered.

| Vanilla (engine key) | Checkpoints | Vanilla on the 998: macro BA / TPR / FPR / abstentions | Wall on these cases |
|---|---|---|---:|
| Gemma 4 26B-A4B (`gemma26-q8`) | `studio-baseline-t4096-2026-10-07`, `baseline-gemma26-q8-t4096-full` | 0.953 / 0.955 / 0.056 / 0 | 0.89 h |
| Qwen3.6 35B-A3B (`qwen36-35b-a3b-q8`) | same run, `baseline-qwen36-35b-a3b-q8-t4096-full` | 0.896 / 0.836 / 0.052 / 1 | 1.57 h |
| Qwen3.8 27B at `low` (`qwen38-q8gguf-low`) | `studio-qwen38-low-2026-10-22`, `baseline-qwen38-q8gguf-low-t4096-full` | 0.897 / 0.857 / 0.058 / 3 | 1.31 h |
| Gemma 4 31B-it (`gemma31-q8`) | `studio-baseline-t4096-2026-10-07`, `baseline-gemma31-q8-t4096-full` | 0.938 / 0.920 / 0.052 / 0 | 3.09 h |
| Muse Glimmer 30B (`muse-q8`) | same run, `baseline-muse-q8-t4096-full` | 0.893 / 0.842 / 0.064 / 1 | 3.51 h |

`make-suite.ts` checks that every one of these 45 vanilla checkpoints carries exactly the vanilla engine (canonical
JSON) and that the vanilla input strategy and decision rule equal the pilot's.

## Builds

All are GGUF files the user downloads to the Studio (`2e1a82366471bc1a78e9b74d2469172d`). Card numbers are as the
authors report them (refusals on their own 100-prompt set; KL vs the original); downloads are the HF 30-day counts on
2026-10-27 (GGUF repo / weights repo), recorded as metadata only. Lineage was checked through each card's
`base_model` chain.

| Key | Repo / file | Lineage | Method (card) | Card KL | Card refusals | Downloads |
|---|---|---|---|---:|---|---|
| `gemma26-huihui` | mradermacher/Huihui-gemma-4-26B-A4B-it-abliterated-GGUF / `…abliterated.Q8_0.gguf` | google/gemma-4-26B-A4B-it → huihui-ai → mradermacher static | abliteration (remove-refusals-with-transformers); first 5 layers and the experts not ablated | – | – | 2,729 / 1,325 |
| `gemma26-heretic` | llmfan46/gemma-4-26B-A4B-it-uncensored-heretic-GGUF / `…-uncensored-heretic-Q8_0.gguf` | google/gemma-4-26B-A4B-it → llmfan46 | Heretic v1.2.0, ARA | 0.0468 | 11/100 (orig. 100/100) | 33,082 / 615 |
| `gemma26-ultra` | llmfan46/gemma-4-26B-A4B-it-ultra-uncensored-heretic-GGUF / `…-ultra-uncensored-heretic-Q8_0.gguf` | google/gemma-4-26B-A4B-it → llmfan46 | Heretic v1.2.0, ARA | 0.1237 | 3/100 (orig. 100/100) | 24,434 / 1,197 |
| `gemma26-huihui-udq8kxl` (robustness, optional) | groxaxo/Huihui-gemma-4-26B-A4B-it-abliterated-GGUF / `gemma-4-26B-A4B-it-UD-Q8_K_XL.gguf` | the same huihui weights → groxaxo | same weights, other quant scheme | – | – | 36,646 / 1,325 |
| `qwen36-huihui` | mradermacher/Huihui-Qwen3.6-35B-A3B-abliterated-GGUF / `…abliterated.Q8_0.gguf` | Qwen/Qwen3.6-35B-A3B → huihui-ai → mradermacher static | abliteration (remove-refusals-with-transformers) | – | – | 89,662 / 3,115 |
| `qwen36-heretic` | llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF / `…-uncensored-heretic-Q8_0.gguf` | Qwen/Qwen3.6-35B-A3B → llmfan46 | Heretic v1.2.0, MPOA variant | 0.0015 | 10/100 (orig. 83/100) | 31,705 / 1,579 |
| `qwen38-mpoa` | llmfan46/Qwen3.8-27B-Uncensored-Heretic-Native-MTP-Preserved-GGUF / `Qwen3.8-27B-Ultra-Uncensored-Heretic-Native-MTP-Preserved-Q8_0.gguf` | Qwen/Qwen3.8-27B → llmfan46 (weights repo renamed from `…-Ultra-Uncensored-…`) | Heretic v2.0.0.dev0, MPOA variant, 15 MTP layers kept | 0.0244 | 3/100 (orig. 91/100) | 23,956 / 1,140 |
| `gemma31-huihui` | mradermacher/Huihui-gemma-4-31B-it-abliterated-v2-GGUF / `…abliterated-v2.Q8_0.gguf` | google/gemma-4-31B-it → huihui-ai (v2) → mradermacher static | abliteration, v2 (first 5 layers not ablated) | – | – | 3,601 / 1,463 |
| `gemma31-heretic` | llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF / `…-uncensored-heretic-Q8_0.gguf` | google/gemma-4-31B-it → llmfan46 | Heretic v1.2.0, ARA | 0.0541 | 10/100 (orig. 99/100) | 81,527 / 2,340 |
| `muse-heretic` (optional) | bartowski/darkc0de_Muse-Glimmer-30B-heretic-GGUF / `darkc0de_…-heretic-Q8_0.gguf` | meta-models/Muse-Glimmer-30B → darkc0de (API `base_model` unset; card names the base) → bartowski static | Heretic v1.4.0 (variant not named) | 0.0743 | 11/100 (orig. 59/100) | 5,730 / 679 |

Every listed Q8_0 (and the UD-Q8_K_XL) file exists on HF as a single file.

**Selection criteria (pre-registered).** (1) The weights are the abliteration author's own (huihui-ai, llmfan46,
darkc0de), possibly quantized by a third party. (2) A static Q8_0 GGUF, matching the vanilla engines' quant. (3) A
documented method on the card. (4) Popularity is **not** a criterion (downloads are metadata only). (5) The one
robustness arm keeps the huihui Gemma 26B weights and changes only the quant scheme, to test whether the quantizer
alone can move the result (O53's "three publishers" caveat).

## Protocol

Each build's engine is its vanilla engine with only the model identity replaced: engine ID, load identifier,
`lmStudio.modelKey`, `indexedModelIdentifier`, `sizeBytes` (and `quantization` for the robustness arm).
`make-suite.ts` asserts this by sorted-JSON diff. Score-only prompt `security-eval-score-only-json-v1`,
`temperature: 0`, `max_tokens: 4096`, native `/api/v0`, context 65,536, parallel 1, timeout 300 s, serial client,
`--require-device`, `--continue-after-output-errors`, `--tolerate-instance=google/gemma-4-26b-a4b-qat`. The request
keeps the vanilla `reasoning_effort` (`high` for Gemma, Qwen3.6 and Muse, which LM Studio drops (O65); `low` for the
Qwen3.8 build, as in the `qwen38low` engine).

## Deviations

1. **Load-time template override (`lmStudio.promptTemplate`) for 8 of 10 builds.** Stage 1 found that LM Studio
   passes no effort or thinking variable to non-hub GGUF imports. `template-audit.py` read every build's template from
   the exact GGUF file header (HTTP range read) and hand-rendered our system+user path for all 980 distinct pilot
   inputs. The vanilla side used the variant the effort audit identified (O54): Gemma `enable_thinking=true` (hub
   model), Qwen3.6 and Muse the default (non-hub), Qwen3.8 `reasoning_effort=low`. Results:

   | Build | Embedded template | At default vs vanilla served | Override |
   |---|---|---|---|
   | gemma26-huihui, gemma26-huihui-udq8kxl, gemma31-huihui | `2dfbfc7d…` (older Gemma 4 template, differs from vanilla) | 0/980 identical, +2 tokens (thinking off); −1 token even with thinking on | yes |
   | gemma26-heretic, gemma26-ultra | `85a08664…` (same as vanilla) | 0/980, +2 tokens (thinking off) | yes |
   | gemma31-heretic | `0a52be69…` (differs) | 0/980, +2 tokens; identical with thinking on | yes |
   | qwen36-huihui, qwen36-heretic | `e84f32a2…`, `e7018ebe…` (differ) | 980/980 identical | no |
   | qwen38-mpoa | `9bfdde60…` (differs, 28 kB) | 0/980, −26 tokens (no low instruction); identical at low | yes |
   | muse-heretic | `114f55eb…` (same as vanilla) | 980/980 identical | no |

   The override is always the **vanilla** model's embedded template with only its default changed. For Gemma 4,
   `templates/gemma4-vanilla-q8-default-thinking.jinja` (SHA-256 `d1465380…6ec5`) is the vanilla Q8_0 template with one
   prepended line, `{%- set enable_thinking = enable_thinking | default(true) -%}`. For Qwen3.8 it is stage 1's
   `qwen38-embedded-default-low.jinja` (`690af918…29b2`). Both re-render 980/980 identically to the vanilla served
   prompt. The runner loads the template through the SDK and verifies the loaded hash (stage 1 mechanism). Without
   the override, every Gemma build would run **with thinking off** against a thinking vanilla. So the comparison
   isolates the weights, not the template. Engine IDs carry `-tmpl`, and an unsent `parameters.template_mechanism` (or
   `effort_mechanism`) note records this.
2. **Run-time identity pin.** The files are still downloading, and LM Studio assigns `modelKey`/`sizeBytes` (which do
   not equal the HF file size). They are pinned from `lms ls --json` when the build first appears with the same size on
   two probes 2 minutes apart, matched to `<device>:<repo>/<file>`. This produces **one suite per build**,
   `suites/prompt-injection-lmstudio-studio-abliteration-stage2-pilot-q8-t4096-<build>-v1.json`. Nothing else in the
   suite depends on the pin. A `PIN` line records the suite hash and the pinned fields. An existing suite file is never
   overwritten with a different identity.
3. **No vanilla drift rerun** (unlike the O53 pilot). The per-build drift gate below checks `prompt_tokens` against
   the vanilla checkpoint instead.

## Gates and stopping rules

- **Start (a).** Stage 1's `progress.log` shows `RUN_DONE` after its last `CHAIN_START`, no matrix driver runs, and the
  device lock is absent. If a `HALTED` line appears there, stage 2 logs `HALTED` and does not start. Until then it
  touches nothing of LM Studio. Then it needs LM Link online and nothing loaded but the tolerated instance.
- **Presence (b).** If a build is not in the Studio inventory, it is deferred to the end and re-probed every 10 min. It
  is given up (`SKIP`) once 6 h have passed since stage 1 ended.
- **Drift gate (c), per build.** A 24-case tranche on bipia-email-mixed. Pass requires 24 finished with usage,
  `prompt_tokens` equal to the vanilla checkpoint on **24/24** (same tokenizer and served rendering ⇒ identical), the
  pinned identity (model, quant, GGUF) on 24/24, and ≤ 1 abstention. On failure: `DRIFT_FAIL`, then `SKIP`, then the
  next build.
- **Cell check, per test.** All pilot cases finished. `prompt_tokens` equal vanilla on every case with usage on both
  sides (≥ 95% coverage). Identity holds on every response. Abstention rate ≤ vanilla's on the same caseIds + 2 pp.
  On failure, the build's remaining cells are skipped.
- **Failures.** A runner step that exits non-zero on a clean device skips the build without resuming it (L141). Two
  such builds in a row, or a leftover lock or loaded study model, halt the chain.
- **Cap.** 36 h from `CHAIN_START`, about 1.5× the estimate. Partial checkpoints are kept and are not reported as
  results.
- No reruns for a better result, no threshold or case changes. Reruns go under fresh condition IDs and a new suite
  version, and old checkpoints are never overwritten.

## Hypotheses (from O53)

- **H1, lower BA.** Each primary build's macro BA on the 998 cases is below its vanilla's. Primary test: the pooled
  exact McNemar on correct/incorrect (both scored), vanilla → build, one per completed primary build. Holm correction
  runs across those builds at α = 0.05. The robustness arm is outside the family.
- **H2, the deficit comes from misses.** Among discordant losses, detections lost on positives outnumber false alarms
  added on negatives. Detections lost > gained (exact sign test on positives only). Expected to concentrate where
  vanilla is marginal (PIDS obfuscated, LongPI naive), as in O53.
- **H3, KL dose-response (Gemma 26B).** Same base, same method (ARA), card KL 0.0468 (`heretic`) vs 0.1237 (`ultra`).
  Predicted order: vanilla BA > heretic BA > ultra BA, and ultra's lost−gained against vanilla exceeds heretic's.
  Test: exact McNemar heretic → ultra (two-sided, reported with direction). Across all builds with a card KL, the
  rank correlation of KL with ΔBA is descriptive only (n ≤ 6, different bases).
- **Robustness arm.** huihui Q8_0 vs huihui UD-Q8_K_XL: exact McNemar between them and both ΔBA vs vanilla. If
  p < 0.05 or |ΔΔBA| ≥ 0.02, the quant scheme alone moves results, and O53's quantizer caveat stands. Otherwise it
  weakens.
- **Secondary and exploratory.** Per-test McNemar, BA, TPR and FPR. AgentDyn benign false alarms added (O53 huihui).
  Steerability probe low→high flips and target matches (paper-score-counterfactual). Method contrasts (huihui vs heretic
  within a base). Reasoning tokens and abstentions. MTP draft counts for the Qwen3.8 build. Per-test p-values are
  uncorrected.

**Decision.** O53 generalizes if at least half of the completed primary builds show a Holm-significant loss, with no
Holm-significant gain. Builds with a Holm-significant loss or |ΔBA| ≥ 0.05 are candidates for a full-suite stage 3.

## Run order and estimates

Serial, in this order: the Gemma 26B builds first, then Qwen3.6, Qwen3.8, Gemma 31B and Muse last. Within a base, the
order is huihui, heretic, ultra, then the robustness arm.

| # | Build | Est. h |
|---:|---|---:|
| 1–3 | gemma26-huihui, gemma26-heretic, gemma26-ultra | 1.2 each |
| 4 | gemma26-huihui-udq8kxl (optional) | 1.2 |
| 5–6 | qwen36-huihui, qwen36-heretic | 2.0 each |
| 7 | qwen38-mpoa (low) | 1.5 |
| 8–9 | gemma31-huihui, gemma31-heretic | 4.0 each |
| 10 | muse-heretic (optional) | 4.0 |

All builds: ≈ 22.3 h of inference plus ≈ 10 model loads and a 2-min stability probe per build, so ≈ 24 h. Without the
two optional builds: ≈ 17 h. Stage 1 is expected to end 2026-10-29 08:00–09:00Z, so stage 2 should run until about
2026-10-30 08:00–10:00Z.

## Execution

```sh
W=/Users/eli/Documents/Code/solenoid-security/.claude/worktrees/abl-stage2   # feature/abliteration-stage2-pilot
cd $W && nohup zsh evals/analysis/abliteration-stage2-pilot-2026-10/run-chain.sh \
  >> evals/runs/abliteration-stage2-pilot-2026-10/chain.log 2>&1 &
tail -f evals/runs/abliteration-stage2-pilot-2026-10/progress.log
```

The chain is restart-safe. A build with `MODEL_DONE` or a non-absence `SKIP` is not touched again, a passed drift gate
is not repeated, and every runner step resumes its own checkpoint. The analysis (Holm, H2–H3, robustness, write-up)
is done offline after `DONE`.

## Limitations

- Gemma vanilla is a hub model and the builds are not. The override reproduces the served rendering (980/980 offline,
  24/24 online by the gate), but LM Studio's internal handling of hub and non-hub models may differ in ways the
  prompt does not show.
- Different quantizers (lmstudio-community, unsloth vs mradermacher, llmfan46, bartowski). The robustness arm probes
  this for one build only.
- The Qwen3.8 build keeps 15 MTP layers and is 1.4 GB larger. Drafting may differ from vanilla (greedy drafting is
  meant to be lossless; F9).
- The vanilla checkpoints date from 2026-10-07 to 2026-10-22 (LM Studio 0.4.25). The drift gate checks only 24 cases
  per build.
- Card KL and refusal numbers are the authors' own and were measured differently across authors. They are used only
  within the Gemma 26B ARA pair.

## Amendment (2026-10-29, before re-arming): automatic transport reruns

Stage 1 halted on 2026-10-28T21:51Z after a single `provider_or_transport_error`. That stopped this chain as designed
(`HALTED|2026-10-28T21:56:12Z`), and both chains then sat idle for about 25 h. Stage 1 was restarted at
2026-10-29T22:41:44Z with its own amendment 2. This chain is re-armed unchanged in its wait: it waits for `RUN_DONE` after
stage 1's last `CHAIN_START`, so it never runs concurrently with stage 1.

**New rule.** A runner step can exit non-zero on a clean device (no lock, nothing but the tolerated instance loaded)
while its console output since the step started reports `provider_or_transport_error`. Such a cohort is not resumed and
the build is no longer skipped:
- **Rerun.** The chain writes a `RETRY` line, waits for LM Link to show the Studio connected, then waits 5 minutes. It
  then reruns the cohort (build + test, including the drift tranche) in full under a fresh condition.
- **The fresh condition.** It comes from `make-suite.ts <build> --rerun=1|2`. That is the build's v1 suite with only the
  suite ID (`-v2`/`-v3`) and the condition ID (`stage2-<label>-r1|r2-t4096-full`) changed, checked field by field, plus
  an offline dry run.
- **Analysis.** `rows.ts` analyzes the newest rerun checkpoint of a cohort. The failed partial stays on disk untouched
  and is excluded.
- **Limit.** At most 2 automatic reruns per cohort. A third transport failure HALTS the chain for a human.
- **Other failures.** They keep the existing rule (skip the build, two in a row halt).

## Amendment (2026-10-30): do not stand down on a stage 1 HALTED that is followed by a restart

Stage 1 was restarted twice after halts, at 22:44Z and 06:40Z. Each halt made this chain stand down, and it had to be
re-armed by hand.

**New rule.** When stage 1's last state is `HALTED`, the chain now waits up to 10 minutes (`HALT_GRACE_S=600`) for a
new stage 1 `CHAIN_START`:
- if one appears, it logs `WAIT … stage 1 restarted` and keeps waiting for `RUN_DONE`;
- if none appears, it halts as before.

Stage 1's own automatic reruns write `RETRY`, not `HALTED`, so they never trigger this.

**Gate.** The stage 2 drift gate has no pilot low-signature check: the comparison is on the same pilot cases. So the
`0/0 overlapping` fix of stage 1's amendment 4 does not apply here.

## Amendment (2026-10-30T21:3xZ): wait for the user's untolerated instances instead of halting

Stage 1 finished at `RUN_DONE|2026-10-30T21:27:34Z`. At 21:28:23Z this chain halted at its start check because the
user had loaded `google/gemma-4-26b-a4b` (Q4_K_M, idle TTL 1 h). That is not the tolerated QAT identifier, and it is
not a study model.

**New rule.** A study instance is one this project loads: its identifier starts with `solenoid-`.
- **At start.** A study instance that is already loaded still halts the chain.
- **Before any model loads** (start and each step): another untolerated instance makes the chain log `WAIT` and wait
  for it to be unloaded, which LM Studio's idle TTL does, for up to 4 h (`OTHERS_WAIT_S`). If it is still loaded
  after that, the chain halts.
- **After a step.** Only a study instance left loaded halts the chain.

The runner's own preflight still refuses to run beside any untolerated instance. Re-armed from the same plan; no stage
2 call had run.

## Amendment (2026-10-30T23:1xZ): fix the runner invocation; exit-127 skips are not runs

At 23:00:01Z the first build (gemma26-huihui) was skipped with exit 127: zsh did not word-split the default
`${MOCK_RUN:-bun run eval:local}`, so the shell looked for a command literally named "bun run eval:local". The mock test
always set `MOCK_RUN`, so the real path was never exercised. **No runner started and no inference ran.** Fix:
`${=MOCK_RUN:-bun run eval:local}`. A SKIP whose cause is exit 127 (no runner started) no longer counts as a prior
attempt, so gemma26-huihui runs normally on restart. The chain was stopped at 23:0xZ and restarted from the same plan.
