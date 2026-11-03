# Abliterated models as prompt-injection detectors

_A living summary. Last updated 2026-11-03. Each stage links to its frozen, detailed report._

**Question.** "Abliteration" removes a model's refusal behaviour by editing its weights. Tools such as
[Heretic](https://github.com/p-e-w/heretic) automate it, and thousands of these builds are published. If you use one as
a **prompt-injection detector**, screening emails, web pages, documents and tool output before an AI agent reads them,
does it still work?

**Answer so far.** It works less well. In a pre-registered pilot, both abliterated Qwen3.8 27B builds were significantly
worse than the original, and the loss comes mostly from **missed attacks**, not extra false alarms. A pre-registered
screen of nine more builds across Gemma 4, Qwen3.6, Qwen3.8 and Muse (stage 2) found the same direction in six of the
seven completed builds. How much is lost depends mostly on the base model: a lot for Gemma 4, little for Qwen.

## How it is tested

- **Identical cases, one protocol.** Each abliterated build is compared with its own vanilla model on the same cases:
  same Q8_0 GGUF quantization, the same score-only detection prompt, temperature 0, one request at a time, on one Mac
  Studio (LM Studio).
- **Vanilla is never re-run.** Vanilla results come from the frozen baseline and extension runs.
- **Clean builds only.** Each build is the abliteration author's own weights, as a static Q8_0 GGUF matching the
  vanilla quantization. Merges, fine-tunes and stacked builds are excluded. Download popularity is not a selection
  criterion.
- **Identical prompt rendering.** Each build must reproduce vanilla's rendered prompt exactly (checked by prompt-token
  counts) before it runs. Where a build's embedded chat template differs, a load-time template override restores the
  vanilla rendering, and it is recorded as a protocol deviation.
- **Paired statistics.** Exact McNemar tests on matched cases with Holm correction, plus the builder's own reported
  refusal rate and KL divergence as covariates.

## Results

### Stage 0: pilot (complete, pre-registered)

Qwen3.8 27B, 998 identical cases across 9 datasets (long documents, email, web, agent tool output, obfuscated attacks,
benign controls). This ran at the template's default `xhigh` reasoning effort.

| Build | Method | Mean balanced accuracy | vs vanilla (McNemar, Holm) |
|---|---|---|---|
| Vanilla Qwen3.8 27B | — | **0.888** | — |
| heretic-ara | Heretic (ARA) | 0.854 | 49 vs 16 discordant, p = 1.0×10⁻⁴ |
| huihui abliterated | classic refusal-direction ablation | 0.858 | 42 vs 15 discordant, p = 4.6×10⁻⁴ |

- The biggest drops were in obfuscated-attack recall (0.703 → 0.595 / 0.565) and agent tool output (0.915 → 0.851 /
  0.798). The two builds are not significantly different from each other (p = 0.70).
- **"Recognized but not concerning."** In most newly missed attacks, the model's reasoning names the injection and then
  plays it down. This was a post-hoc keyword screen, so it is descriptive only.

Detailed report: [abliteration-pilot-results-2026-10.md](abliteration-pilot-results-2026-10.md), plan:
[abliteration-pilot-plan-2026-10.md](abliteration-pilot-plan-2026-10.md), FINDINGS
[O53](../FINDINGS.md).

### Stage 1: full suites at the better effort setting (running)

Both Qwen3.8 builds on the full baseline (21 datasets) and extension (14 datasets), 14,085 cases per build, at
`reasoning_effort: "low"`, which is the most accurate setting for vanilla Qwen3.8 ([O65](../FINDINGS.md),
[O67](../FINDINGS.md)). The comparison is against vanilla Qwen3.8 at `low` on the same cases.

**Interim (2026-10-27, heretic-ara, first 8 of 35 datasets; not final):** heretic-ara is lower on 7 datasets and ties
on 1. The largest gaps are on code (0.860 vs 0.925) and email-style attack detection (0.860 vs 0.922). Final numbers,
paired tests and the huihui build will replace this paragraph when the stage completes.

### Stage 2: more model families (complete, pre-registered)

The same 998 pilot cases were run for nine abliterated builds on five bases. Each build is compared with its own
vanilla model on identical cases, with identical rendered prompts (checked on every case).

| Build | Method | Vanilla → build balanced accuracy | vs vanilla (McNemar, Holm over 7) |
|---|---|---|---|
| Gemma 4 26B-A4B heretic | Heretic (ARA), KL 0.047 | 0.953 → 0.812 | 156 vs 10 discordant, p = 4×10⁻³⁴ |
| Gemma 4 26B-A4B ultra | Heretic (ARA), KL 0.124 | 0.953 → **0.727** | 243 vs 9, p = 2×10⁻⁵⁹ |
| Gemma 4 31B-it huihui v2 | classic | 0.938 → 0.782 | 177 vs 13, p = 4×10⁻³⁷ |
| Gemma 4 31B-it heretic | Heretic (ARA), KL 0.054 | 0.938 → 0.883 | 68 vs 11, p = 1×10⁻¹⁰ |
| Muse Glimmer 30B heretic | Heretic 1.4.0, KL 0.074 | 0.893 → 0.831 | 83 vs 19, p = 3×10⁻¹⁰ |
| Qwen3.6 35B-A3B huihui | classic | 0.896 → 0.869 | 70 vs 43, p = 0.028 |
| Qwen3.6 35B-A3B heretic | Heretic (MPOA), KL 0.0015 | 0.896 → 0.879 | 51 vs 35, p = 0.105 (not significant) |
| Gemma 4 26B-A4B huihui † | classic | 0.953 → 0.806 | 154 vs 12, p = 8×10⁻³² (Holm over 9) |
| Qwen3.8 27B MPOA † | Heretic (MPOA), KL 0.024 | 0.897 → 0.912 | 20 vs 35, p = 0.058 (not significant) |

† These two builds were stopped by the pre-registered rule on length abstentions (reasoning running out of budget).
They were finished in a declared deviation with that rule made report-only, so they are reported separately.

- **The finding generalizes.** Six of seven builds lose significantly and none gains. Under the pre-registered rule
  this means the pilot result holds across families.
- **The base model matters most.** All Gemma 4 builds lose 0.055–0.226, whatever the method. The Qwen builds lose
  little or nothing. The two MPOA builds had the two smallest effects, but both are on Qwen.
- **A stronger edit hurts more.** On Gemma 4 26B, the "ultra" Heretic build (KL 0.124) is clearly worse than the
  standard one (KL 0.047): 105 vs 17 discordant, p = 1×10⁻¹⁶.
- **Missed attacks again.** Obfuscated attacks (PIDS) lose the most. Balanced accuracy there falls from 0.81–0.90 to
  0.29–0.55 for six of the builds. Gemma builds also miss long-document and email attacks that vanilla caught every time. False
  alarms on benign text go down, not up.
- **They think longer.** Gemma 4 26B builds reason 2–3× as long as vanilla before answering.
- **Not tested.** The quantization-only check (same weights, another quant scheme) was dropped before it ran.

Detailed report: [abliteration-stage2-results-2026-11.md](abliteration-stage2-results-2026-11.md), plan:
[abliteration-stage2-plan-2026-10.md](abliteration-stage2-plan-2026-10.md), FINDINGS [O70](../FINDINGS.md).

### Stage 3: full suites for the confirmed builds (not scheduled)

The pre-registered rule names six candidates: both Gemma 4 26B Heretic builds, both Gemma 4 31B builds, Qwen3.6 huihui
and Muse heretic. Running all six is about 335 h of Studio request time.

## Caveats

- Five model families, but one or two builds per family, at one quantization (Q8_0 GGUF) and one runtime.
- Stage 2 is a 998-case screen, not a full-suite run. Method and base are confounded (for example, both MPOA builds
  are on Qwen), and the KL values are the authors' own.
- Several datasets are synthetic LongPIBench documents; the extension suite adds varied and real-world sources.
- The detector is asked for a concern score with a 0.5 threshold. Per-model thresholds are covered separately
  ([O55](../FINDINGS.md), [O67](../FINDINGS.md)).

## Why it matters

If you self-host a guard model, an "uncensored" build can quietly weaken it: the model still recognizes the attack,
but no longer treats it as a problem.

Tracking issue: [#23](https://github.com/elicollinson/solenoid-security/issues/23). To cite this work, see
[CITATION.cff](../../CITATION.cff).
