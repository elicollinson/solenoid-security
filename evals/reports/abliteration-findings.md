# Abliterated models as prompt-injection detectors

_A living summary. Last updated 2026-10-30. Each stage links to its frozen, detailed report._

**Question.** "Abliteration" removes a model's refusal behaviour by editing its weights. Tools such as
[Heretic](https://github.com/p-e-w/heretic) automate it, and thousands of these builds are published. If you use one as
a **prompt-injection detector**, screening emails, web pages, documents and tool output before an AI agent reads them,
does it still work?

**Answer so far.** It works less well. Both abliterated Qwen3.8 27B builds were significantly worse than the original,
first in a pre-registered pilot and then on the full suites (14,085 cases per build). The loss comes mostly from
**missed attacks**, not extra false alarms. The builds still rank attacks above benign text about as well as the
original, but they give attacks lower concern scores.

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

### Stage 1: full suites at the better effort setting (complete, pre-registered)

Both Qwen3.8 builds ran on the full baseline (21 datasets) and extension (14 datasets), 14,085 cases per build, at
`reasoning_effort: "low"`. That is the most accurate setting for vanilla Qwen3.8 ([O65](../FINDINGS.md),
[O67](../FINDINGS.md)). The comparison is against vanilla Qwen3.8 at `low` on the same cases, with identical rendered
prompts (checked on every case).

| Build | Baseline balanced accuracy | vs vanilla (McNemar, Holm) | Extension balanced accuracy | vs vanilla (McNemar, Holm) |
|---|---|---|---|---|
| Vanilla Qwen3.8 27B | **0.912** | — | **0.900** | — |
| heretic-ara | 0.898 | 239 vs 131 discordant, p = 4×10⁻⁸ | 0.883 | 334 vs 162, p = 3×10⁻¹⁴ |
| huihui abliterated | 0.899 | 289 vs 177, p = 2×10⁻⁷ | 0.858 | 498 vs 161, p = 2×10⁻⁴⁰ |

- **Missed attacks.** Attacks the builds newly miss far outnumber the ones they newly catch (for example 438 vs 148 for
  huihui on the extension). On the baseline they actually raise fewer false alarms than the original.
- **Where it hurts.**
  - Email-style attacks: −0.03 to −0.10.
  - BIPIA table and code: −0.04 / −0.07.
  - QA documents: −0.02 / −0.04.
  - huihui loses web (more false alarms on benign pages). Agent tool output and code are unaffected.
  - The pilot's obfuscated-attack recall drop recurs (0.728 → 0.670 / 0.611). As a whole, though, the pre-registered
    "same pattern as the pilot" test did not hold.
- **Recognized, but scored lower.** Ranking quality (AUROC) is unchanged or higher, so the builds still see the attacks
  but score them below the 0.5 threshold more often.
- **Between the builds.** heretic-ara (Heretic, KL 0.0535, 0/100 refusals) and huihui tie on the baseline. heretic-ara
  is clearly better on the extension.

Detailed report: [studio-qwen38-abliterated-low-2026-10.md](studio-qwen38-abliterated-low-2026-10.md), plan:
[studio-qwen38-abliterated-low-plan-2026-10.md](studio-qwen38-abliterated-low-plan-2026-10.md), FINDINGS
[O68](../FINDINGS.md).

### Stage 2: more model families (armed 2026-10-30; starts when the Studio is free)

A 998-case pilot screen of Gemma 4 26B-A4B (huihui, Heretic and a stronger "ultra" Heretic build, for a KL
dose-response), Qwen3.6 35B-A3B (huihui, Heretic), a third Qwen3.8 method (Heretic MPOA), Gemma 4 31B (huihui,
Heretic) and Muse Glimmer 30B (Heretic). Plan:
[#53](https://github.com/elicollinson/solenoid-security/pull/53) (pre-registration). Full suites follow only for builds
with a confirmed pilot effect.

## Caveats

- One model family so far, at one quantization (Q8_0 GGUF) and one runtime.
- Abliteration methods and strengths vary between builds; the stage 2 dose-response arm addresses strength directly.
- Several datasets are synthetic LongPIBench documents; the extension suite adds varied and real-world sources.
- The detector is asked for a concern score with a 0.5 threshold. Per-model thresholds are covered separately
  ([O55](../FINDINGS.md), [O67](../FINDINGS.md)).

## Why it matters

If you self-host a guard model, an "uncensored" build can quietly weaken it: the model still recognizes the attack,
but no longer treats it as a problem.

Tracking issue: [#23](https://github.com/elicollinson/solenoid-security/issues/23). To cite this work, see
[CITATION.cff](../../CITATION.cff).
