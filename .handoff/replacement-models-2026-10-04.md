# Replacement models for the bugged slots (2026-10-04)

This was read-only research. No device use, no downloads, no inference. Sources are listed at the end.

**Scope (updated by the user mid-task):** we need direct replacements for the three models that failed on the
reasoning→structured-output routing bug:
- **MoE-A** replaces Nemotron 3 Nano 30B-A3B (MLX8).
- **MoE-B** replaces GLM-4.7 Flash (MLX8).
- **Dense** replaces Qwen3.5-27B Opus-distill (MLX6).

For each slot this gives one top pick and one backup. The batch can be fewer than 5. Gemma 4 GGUFs are already
downloading, so they are not counted as replacements; Gemma 4 31B-it is assessed separately below.

## Key runtime observation

Every failure so far was on **MLX**: Granite, GLM, Nemotron and the Opus-distill. Every **GGUF** on the current
runtime worked: Muse, Qwen3.8 and Ornith. Qwen3.5 GGUF did reproduce #1773, but on LM Studio 0.4.10 in April.
mlx-engine #337 shows the same split for Gemma 4 26B: on MLX it never ends its reasoning, on GGUF it ends normally.
The most likely explanation is that the MLX engine attaches the schema to the reasoning stream, while the current
llama.cpp engine applies it after reasoning ends. That is an inference, not a confirmed fix: #1698, #1773 and #1971
are all still open, with no maintainer resolution. **Every pick below is GGUF Q8_0.** Each still has to pass the
first6 qualification, and that check must confirm `content` is non-empty and `reasoning_tokens` > 0.

I found no lmstudio-bug-tracker issue reporting the reasoning_content/structured-output bug for Nemotron 3.5, Laguna,
EXAONE, Olmo, Granite or Gemma 4 31B. That is absence of reports, not evidence the bug can't occur.

## Recommended batch (3 models; backups only if a top pick fails first6)

| Slot | Pick | Exact repo / file | Bytes | Arch |
|---|---|---|---:|---|
| MoE-A (Nemotron 3 Nano) | **Top: Nemotron 3.5 Lightning 30B-A3B** | `lmstudio-community/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF` / `…-Q8_0.gguf` (same build: `ggml-org/…-GGUF`, 33,585,495,616) | 33,585,494,976 | MoE 30B / 3B, Mamba-2 + MoE + attention hybrid |
| MoE-A backup | Nemotron 3 Nano 30B-A3B (same model, GGUF rescue) | `lmstudio-community/NVIDIA-Nemotron-3-Nano-30B-A3B-GGUF` / `…-Q8_0.gguf` | 33,585,495,328 | same hybrid MoE 30B / 3B |
| MoE-B (GLM-4.7 Flash) | **Top: Laguna XS 2.1** | `lmstudio-community/Laguna-XS-2.1-GGUF` / `Laguna-XS-2.1-Q8_0.gguf` (the queued `ggml-org` file, 35,597,116,480, is equivalent) | 35,597,116,448 | MoE 33B / 3B, 256 experts + 1 shared; SWA:global 3:1 |
| MoE-B backup | GLM-4.7 Flash (same model, GGUF rescue) | `lmstudio-community/GLM-4.7-Flash-GGUF` / `GLM-4.7-Flash-Q8_0.gguf` | 31,842,799,072 | MoE ~30B / ~3B (`deepseek2` arch in GGUF) |
| Dense (Qwen3.5 Opus-distill) | **Top: EXAONE 4.5 33B** | `LGAI-EXAONE/EXAONE-4.5-33B-GGUF` / `EXAONE-4.5-33B-Q8_0.gguf` (skip mmproj; text-only) | 35,138,742,464 | Dense 31.7B LM + 1.29B vision; 3 SWA : 1 global (NoPE) |
| Dense backup | Olmo 3.1 32B Think | `lmstudio-community/Olmo-3.1-32B-Think-GGUF` / `Olmo-3.1-32B-Think-Q8_0.gguf` | 34,254,795,776 | Dense 32.2B; 3 SWA : 1 full |

**Overlap with earlier requests:** Nemotron 3.5 Lightning and Laguna XS 2.1 were already requested. If those
downloads are still in flight, no new MoE download is needed. One caution: the queued **unsloth** Nemotron Q8 is
35,004,643,392 bytes, larger than the lmstudio-community/ggml-org file. The size suggests it bundles MTP tensors, and
#2283 reports an unsloth Nemotron 3.5 file failing with "wrong number of tensors" on runtime 2.28.2. Prefer the
lmstudio-community or ggml-org Q8. **The only new download required is EXAONE 4.5 33B.**

## Ranked candidates: MoE (25–40B total)

| Rank | Model | Release | License | Ctx | Reasoning toggle | LM Studio / llama.cpp status | Family independence |
|---|---|---|---|---|---|---|---|
| 1 | Nemotron 3.5 Lightning 30B-A3B | 2026-08-11 | OpenMDW-1.1 | up to 1M | `enable_thinking` on/off; #2274 says it is the one model whose Think toggle still works after 0.4.16 | GGUF Q8 from lmstudio-community and ggml-org. #2276 (AMD APU load) is not relevant. #2283 is MTP/unsloth only | NVIDIA; same family as the failed Nano |
| 2 | Laguna XS 2.1 | Jul 2026 (LM Studio builds 2026-07-23) | OpenMDW-1.1 | 262,144 | per-request `enable_thinking`, interleaved thinking | llama.cpp PR #25165 merged 2026-07-22. #1968 (XS.2 load failure) closed as fixed. #2243 is MLX tool parsing only | Poolside, independent |
| 3 | GLM-4.7 Flash (GGUF) | Jan 2026 | MIT | 202,752 | on by default | #1495 (open): LM Studio doesn't emit the opening `<think>` tag, which could affect how reasoning is split out | Zhipu; same model as the failed MLX build |
| 4 | Nemotron 3 Nano (GGUF) | Dec 2025 | NVIDIA Open | 1M | on/off | #1443 is a tool-template problem only | same model as the failed MLX build |
| 5 | Sarvam 30B (reserve) | Mar 2026 | Apache-2.0 | 131,072 | `enable_thinking` | `sarvam_moe` merged in llama.cpp (PR #20275, Mar 2026). Official GGUF is Q4_K_M only; Q8 is community-only (`Sumitc13`, 34.2 GB) | Sarvam, independent; India-focused |
| x | North Mini Code 1.0 | Jun 2026 | Apache-2.0 | — | — | #2076 (GGUF can't load, open) and #2118 (`cohere2_moe` unsupported on MLX). Coder-only | excluded |
| x | Xing4.0-29B-A4B (China Telecom) | Sep 2026 | Apache-2.0 | 256K | `enable_thinking` | **Not in mainline llama.cpp** (PR #29012 still open). Only GGUF is from a non-reputable quantizer | excluded for now |
| x | KAT-Coder V2.5, Nex-N2.5-mini, occamy, Apodex, Thomson-1.0-Small, Holo4 | 2026 | — | — | — | all `qwen3_5_moe` | Qwen derivatives; add family confound |

## Ranked candidates: dense (25–40B)

| Rank | Model | Release | License | Ctx | Reasoning | LM Studio / llama.cpp status | Independent family |
|---|---|---|---|---|---|---|---|
| 1 | EXAONE 4.5 33B | Apr 2026 (report arXiv 2604.08644); GGUF updated 2026-07-06 | EXAONE 1.2-**NC** (research OK, no commercial use) | 262,144 | **on by default**; off via `enable_thinking=False` | Support merged in llama.cpp 2026-06-01 (PR #21733). **SWA fix PR #26848 merged 2026-08-11**: without it, MTP-bearing GGUFs (this one has 64+1 layers) skip SWA and output garbage. The first build with the fix is about b10362. LM Studio runtime 2.28.2 (= b10252) **lacks it**; GitHub compare shows b10252 is 109 commits behind the fix | LG AI Research, yes |
| 2 | Olmo 3.1 32B Think | Dec 2025 (card updated Jan 2026) | Apache-2.0 | **65,536** (exactly the suite's context) | always thinks; no toggle | lmstudio-community GGUF exists; `olmo3` is supported. No open LM Studio issues for Olmo 3 | Ai2, yes |
| (queued) | Granite 4.2 30B GGUF | Aug 2026 | Apache-2.0 | 131,072 | thinking | Same model as the failed MLX8 build. Our MLX run with prompt-JSON had 3 of 4 calls hit the 1,024-token length limit, so its budget risk persists on GGUF | IBM, yes |
| (downloading) | Gemma 4 31B-it GGUF | Apr 2026 | Apache-2.0 | 256K | thinking | See note below | Google, yes (shares a family with the Gemma 26B MoE) |
| (blocked) | K2 Horizon 32B | 2026 | — | 512K | — | Needs a custom llama.cpp fork; upstream issue #29424 is open | IFM |
| x | Cloudflare clef, Swift 1.5, Salience, JEV, Darwin, Kiwen, … | Sep 2026 | — | — | — | — | all Qwen3.5/3.8 derivatives |

**Gemma 4 31B-it GGUF is a good dense pick.** It is an official instruct model, Apache-2.0, with 256K context.
Files: `lmstudio-community/gemma-4-31B-it-GGUF` Q8_0 is 32,635,674,272 bytes; `unsloth/gemma-4-31B-it-GGUF` Q8_0 is
32,635,677,632. GGUF Gemma 4 ends its reasoning normally (mlx-engine #337), and it corrects the earlier base-model
substitution. Risks:
- #1740: excessive KV cache footprint.
- #1750: Q8 memory growth on a 64 GB Mac. 96 GB should cope, but watch it.
- #2274: the Think toggle is ignored on 0.4.18+.
- Gemma26 MLX reported 0 reasoning tokens. Confirm that the GGUF reports `reasoning_tokens` > 0.

It counts as an independent dense family, but it shares a family with the Gemma26 MoE. That makes it a clean
within-family dense/MoE contrast rather than another family for the dense group.

**Independent dense families in 25–40B that can run now:** Qwen3.8, Muse (Meta), Gemma 4 31B, Granite 4.2,
EXAONE 4.5 and Olmo 3.1. That is **6**, up from the 4 counted earlier, because EXAONE and Olmo are new. K2 would be a
7th if runtime support arrives. Mistral has nothing current in range: Devstral Small 2 is a 24B coder and Mistral
Small 4 is 119B.

## Risk notes per pick

- **Nemotron 3.5 Lightning:**
  - The failed Nano was the same family, but the failure was on MLX.
  - The hybrid Mamba design is an architecture confound and must stay labelled.
  - Recommended sampling is temperature 1.0; we use 0.
  - Benchmarks are weaker than Qwen3.6-35B-A3B on most tasks but better on IFBench (71.9).
- **Laguna XS 2.1:**
  - It is trained for agentic coding, and the card publishes no general or knowledge benchmarks. It is the best
    *independent, current* non-Qwen MoE with confirmed llama.cpp support; nothing general-purpose and independent with
    a reputable Q8 exists in range.
  - Sliding window is 512 tokens on 30 of 40 layers, so long-input behaviour could differ.
  - Watch whether its thinking template splits correctly into `reasoning_content`.
- **GLM-4.7 Flash (backup):**
  - #1495 (missing opening `<think>` tag) touches the same reasoning-splitting path we care about. Workaround: a
    Developer setting in LM Studio.
  - Older (Jan 2026) and previously classed as reserve.
- **Nemotron 3 Nano (backup):** preserves the original panel identity exactly. It is older than its successor.
- **EXAONE 4.5:**
  - **Before loading, check the llama.cpp runtime with `lms runtime ls`.** It must be newer than 2.28.2 and contain
    llama.cpp ≥ b10362 (PR #26848). Otherwise the outputs will be garbage.
  - The NC license is fine for research.
  - There is no lmstudio-community build, so LM Studio relies on the GGUF's embedded Jinja template. EXAONE 4.0 once
    failed to load in LM Studio (#769, 2025, an older architecture).
  - The card recommends temperature 1.0 with presence penalty 1.5, and prefers `\boxed{}` answers, which may fight
    the score-only JSON prompt.
  - Weak spots: IFBench 62.6 and AA-LCR 50.6. Reasoning is verbose (AIME-tuned), so length abstentions at 1,024
    tokens are plausible.
  - The 35.1 GB weights plus 64K KV fit in 96 GB.
- **Olmo 3.1 Think (backup):**
  - It always thinks and its traces are long, so it is likely to hit the 1,024-token cap.
  - Its native context equals the suite's 65,536, so prompt plus output must stay under that. Paper inputs (~10K
    tokens) fit.
  - Dec 2025 is older than the 2026 preference.
  - The 32B Instruct variant does not reason, so it would not match the protocol.

## Sources

- LM Studio bugs: [#1698](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1698), [#1773](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1773), [#1971](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1971), [mlx-engine #337](https://github.com/lmstudio-ai/mlx-engine/issues/337), [#2274](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2274), [#2283](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2283), [#2276](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2276), [#1968](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1968), [#2243](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2243), [#1495](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1495), [#1443](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1443), [#769](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/769), [#2076](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2076), [#2118](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2118), [#1740](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1740), [#1750](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1750), [#2289](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2289) (runtime 2.28.2 = b10252)
- llama.cpp: [EXAONE 4.5 PR #21733](https://github.com/ggml-org/llama.cpp/pull/21733), [EXAONE SWA fix PR #26848](https://github.com/ggml-org/llama.cpp/pull/26848), [Laguna PR #25165](https://github.com/ggml-org/llama.cpp/pull/25165), [Sarvam PR #20275](https://github.com/ggml-org/llama.cpp/pull/20275), [Xing4.0 PR #29012 (open)](https://github.com/ggml-org/llama.cpp/pull/29012), [K2 issue #29424](https://github.com/ggml-org/llama.cpp/issues/29424)
- Model cards and files: [EXAONE-4.5-33B](https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B), [EXAONE GGUF](https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B-GGUF), [EXAONE GGUF discussion #3](https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B-GGUF/discussions/3), [Nemotron 3.5 Lightning](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16), [lmstudio-community Nemotron 3.5 GGUF](https://huggingface.co/lmstudio-community/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF), [ggml-org Nemotron 3.5 GGUF](https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF), [Laguna XS 2.1](https://huggingface.co/poolside/Laguna-XS-2.1), [lmstudio-community Laguna GGUF](https://huggingface.co/lmstudio-community/Laguna-XS-2.1-GGUF), [Olmo 3.1 32B Think](https://huggingface.co/allenai/Olmo-3.1-32B-Think), [lmstudio-community Olmo GGUF](https://huggingface.co/lmstudio-community/Olmo-3.1-32B-Think-GGUF), [GLM-4.7-Flash GGUF](https://huggingface.co/lmstudio-community/GLM-4.7-Flash-GGUF), [Nemotron 3 Nano GGUF](https://huggingface.co/lmstudio-community/NVIDIA-Nemotron-3-Nano-30B-A3B-GGUF), [Gemma 4 31B-it GGUF](https://huggingface.co/lmstudio-community/gemma-4-31B-it-GGUF), [Granite 4.2 30B](https://huggingface.co/ibm-granite/granite-4.2-30b), [Sarvam 30B](https://huggingface.co/sarvamai/sarvam-30b), [Xing4.0-29B-A4B](https://huggingface.co/XingChen-AGI/Xing4.0-29B-A4B)
- In-repo: `evals/reports/lmstudio-granite-protocol-2026-10-04.md` (Granite MLX length/output abstentions), `evals/runs/model-selection-2026-10-03/next-download-batch-2026-10-04.json`, `.handoff/new-model-qualification-plan.md`.
