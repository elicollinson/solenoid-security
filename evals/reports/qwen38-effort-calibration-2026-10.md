# Qwen3.8 reasoning effort and score calibration (2026-10-16)

Tracking issue: [#33](https://github.com/elicollinson/solenoid-security/issues/33). Research log L151, `FINDINGS.md`
Appendix B, O54 and O55.

This report covers two linked findings, both reached offline. No inference was run, and LM Studio was not touched.

1. **Protocol.** Every local Qwen3.8 27B run requested `reasoning_effort: "high"` but actually ran at **`xhigh`**. At
   `xhigh`, the model's own chat template **adds an instruction to the front of our system prompt**. An audit of all
   Studio models shows that none of them received our `"high"`. Each template applied its own default, and Qwen3.8 is
   the only model whose default adds an effort instruction that differs from the request.
2. **Calibration.** Most of Qwen3.8's per-category gap behind Qwen3.6 35B-A3B comes from where it puts its threshold,
   not from failing to see the attack. QA is the exception, where Qwen3.8 has a real recognition gap. A single threshold
   of 0.15, chosen on the baseline, lifts Qwen3.8's extension-suite mean balanced accuracy (BA) from 0.865 to 0.891.
   Qwen3.6 35B-A3B and Gemma 4 26B-A4B do not move under the same procedure.

Sources: [`effort-audit.json`](../analysis/qwen38-effort-calibration-2026-10/results/effort-audit.json), written by
[`effort-inputs.ts`](../analysis/qwen38-effort-calibration-2026-10/effort-inputs.ts) and
[`effort-audit.py`](../analysis/qwen38-effort-calibration-2026-10/effort-audit.py), and
[`results.json`](../analysis/qwen38-effort-calibration-2026-10/results/results.json), written by
[`extract.ts`](../analysis/qwen38-effort-calibration-2026-10/extract.ts) and
[`analyze.py`](../analysis/qwen38-effort-calibration-2026-10/analyze.py). The embedded chat templates are in
[`templates/`](../analysis/qwen38-effort-calibration-2026-10/templates/). Laguna's template is not copied there
because of its license. The script fetches it and checks its hash.

## 1. Qwen3.8 ran at `xhigh` with an injected instruction

**The template.** The Q8_0 file we ran, `lmstudio-community/Qwen3.8-27B-GGUF/Qwen3.8-27B-Q8_0.gguf`, embeds the
official Qwen3.8 chat template (SHA-256 `c3cf9e34…1041`). The script read this template from the GGUF header by HTTP
range requests and checked it against the copy the HF API returns. When thinking is on, the template does this:

```jinja
{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
{%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
    {{- raise_exception('Unexpected reasoning effort ' ~ reasoning_effort ~ '. Supported types are xhigh (default), medium, and low.') }}
```

At `xhigh` it puts this text, followed by `\n\n`, in front of the caller's system message:

> Reasoning effort is set to xhigh. Please think carefully through the task, validate key assumptions, consider
> plausible alternatives, and prioritize correctness, consistency, and clarity in the final answer.

At `low` it adds a different 26-token instruction. At `medium` it adds nothing. A `"high"` would have raised a
template error. None of our requests failed, so LM Studio did not pass `reasoning_effort` to the template. The template
fell back to its default, `xhigh`.

**Template diff against Qwen3.6.** The other differences from the Qwen3.6 template (`55d49314…ea0c`, used by both
Qwen3.6 builds) cover only tool calls, developer-role merging, `preserve_thinking` and role validation. None of them
touches a request with one system message and one user message and no tools. On our request path, the effort block is
the only change.

**Token evidence.** Qwen3.6 35B-A3B, Ornith 1.5 and Qwen3.8 use the same BPE vocabulary (248,044 base tokens in their `tokenizer.json`; Qwen3.8 adds 7 special tokens that do not occur in our prompts).
Compared on identical inputs, Qwen3.8's server-reported `prompt_tokens` is exactly 38 higher on every case, and the
instruction plus `\n\n` tokenizes to exactly 38 tokens:

| Comparison (same input SHA-256) | Cases | Difference in `prompt_tokens` |
|---|---|---|
| Studio baseline: Qwen3.8 − Qwen3.6 35B-A3B | 6,627 | +38 on all |
| Studio baseline: Qwen3.8 − Ornith 1.5 | 6,623 | +38 on all |
| Extension suite: Qwen3.8 − Qwen3.6 35B-A3B | 6,755 | +38 on all |
| MacBook 2026-10-04 Qwen3.8 − Studio Qwen3.8 | 976 | 0 on all (same rendering) |
| Pilot: heretic-ara − vanilla Qwen3.8 | 24 | 0 on all |
| Pilot: huihui − vanilla Qwen3.8 | 24 | 0 on all |

The hand-rendered prompts agree. Rendering every saved prompt with the template's default reproduces the server count
exactly on 98.3% of the 7,309 baseline requests. Rendering at `medium` gives +38 on those same requests. The other 1.7%
show the same small offsets (−2 to +20) for Qwen3.6 and Ornith on the same inputs, so they come from tokenizer
differences on unusual text, not from the template.

**Scope.** This covers every local Qwen3.8 GGUF run: the first MacBook run (2026-10-04), Studio Study A, the Studio
baseline, the extension suite and all three abliteration-pilot builds. The heretic and huihui GGUFs embed the same
template (hash checked), so the pilot compared like with like. The Qwen3.8 MLX 8-bit build was not checked. Its
diagnostic runs are paused.

## 2. Effort audit for every Studio model

For each engine in the baseline suite, the exact Q8_0 file comes from `lmStudio.indexedModelIdentifier`. Its embedded
template was read from the GGUF header and hash-checked. For Gemma 4, the HF API's `gguf` block describes a different
file in the repository. The audit uses the template embedded in the Q8_0 file we ran. The script rendered every saved
prompt under each candidate setting and compared the token count with the server's `prompt_tokens`. A constant offset
of 0 identifies the setting the server used.

| Model (Q8_0 GGUF) | Template reads | Effort the template saw | Injected system text (tokens) | Thinking | Evidence | Confidence |
|---|---|---|---|---|---|---|
| Ornith 1.5 35B-A3B | `enable_thinking` | none (no effort variable) | none (0) | on (default) | offset 0 on 98.3% of 7,314; reasoning on 100% | high |
| Gemma 4 26B-A4B-it | `enable_thinking` (default false) | none (no effort variable) | `<\|think\|>` control token only (2), no instruction | on: LM Studio passed `enable_thinking=true` | offset 0 on 100% of 7,317 with thinking on, −2 at the template default | high |
| Qwen3.6 35B-A3B | `enable_thinking` | none (no effort variable) | none (0) | on (default) | offset 0 on 98.3% of 7,323 | high |
| Laguna XS 2.1 | `enable_thinking` (default false) | none (no effort variable) | none (0) | unresolved | offset 0 on 99.7% of 7,212 under either setting; the two differ only in a 1-token generation prefix. 76.6% of responses report 0 reasoning tokens | high (no injection); low (thinking state) |
| Qwen3.8 27B | `reasoning_effort` (`xhigh` default, `medium`, `low`; anything else raises), `enable_thinking` | **`xhigh`** (default) | **yes: the xhigh instruction (38)** | on | offset 0 on 98.3% of 7,309 at default, +38 at `medium`; +38 vs Qwen3.6 on 13,382 shared inputs | high |
| Muse Glimmer 30B | `reasoning_strength` (any string; default `high`), not `reasoning_effort` | `high`, the template default, which matches the request by coincidence | yes, after our prompt: `Reasoning strength: high.` (7) plus a fixed `# Valid recipients` line (11), at any setting | on | offset 0 on 99.9% of 7,321 | high |
| Gemma 4 31B-it | same template as 26B-A4B | none | `<\|think\|>` only (2) | on (`enable_thinking=true`) | offset 0 on 100% of 7,321 | high |
| Qwen3.6 27B (deferred) | same template as Qwen3.6 35B-A3B | none | none (0) | on | offset 0 on 281/281 (partial longpi-paper) | high (partial) |
| Qwen3.8 heretic-ara / huihui (pilot) | same template as Qwen3.8 | `xhigh` | yes (38) | on | offset 0 on 99.1% of 996 / 993; +0 vs vanilla | high |

**Reading the table.**
- **No model received `"high"`.** Four templates have no effort variable at all. Muse reads a different variable
  (`reasoning_strength`) whose default happens to be `high`. Qwen3.8 reads `reasoning_effort` but never got it.
- **LM Studio does set thinking.** Both Gemma 4 templates turn thinking off by default, yet every Gemma response
  rendered with `enable_thinking=true`. LM Studio therefore applies its own per-model reasoning setting through
  `enable_thinking`. It does not forward our `reasoning_effort` to the template.
- **Documentation.** LM Studio's REST docs do not list `reasoning_effort` for the `/api/v0/chat/completions` endpoint
  we used. The changelog lists `reasoning.effort` only for `/v1/responses`, and only for gpt-oss (0.3.29). The newer
  native `POST /api/v1/chat` takes `reasoning: "off" | "low" | "medium" | "high" | "on"` and "will error if the model
  … does not support" it, with a default of "the automatically chosen setting for the model". The runs used LM Studio
  0.4.25. The saved token counts are consistent with the field being ignored on `/api/v0`, but whether LM Studio maps
  it anywhere internally is not documented.
- **Laguna** turns thinking off by default, and its reasoning behaviour is mixed: 23.5% of responses include
  reasoning content. The prompt-token check cannot tell which setting was used. O44's caveat that Laguna's reasoning
  counts understate its work still applies.

## 3. Calibration vs recognition (Qwen3.8 vs Qwen3.6 35B-A3B and Gemma26)

Inputs: per-case maximum scores from the audited baseline (21 datasets) and extension (14 datasets) checkpoints for
Qwen3.8, Qwen3.6 35B-A3B and Gemma 4 26B-A4B. Muse is excluded because its extension run is incomplete. Abstentions
are excluded. "Calibration" means the model ranks attacks above benign cases (high AUROC) but scores many attacks at
or below 0.5. "Recognition" means the attacks are not ranked above benign cases at all.

**Caveat on AUROC here.** In the QA and BIPIA groups, every model scores every benign case 0. AUROC there is just the
share of attacks scored above 0 (ties count half), not a full ranking measure.

### Group level

BA at 0.5 and mean per-dataset AUROC. "Oracle BA" is the best single in-sample threshold for that group, shown for
scale only.

| Run / group | Q3.8 BA@0.5 | Q3.8 AUROC | Q3.8 oracle BA | Q3.6 BA@0.5 | Q3.6 AUROC | G26 BA@0.5 | G26 AUROC |
|---|---|---|---|---|---|---|---|
| ext / QA (2) | 0.730 | 0.821 | 0.821 | 0.914 | 0.919 | 0.948 | 0.954 |
| ext / BIPIA table+code (2) | 0.748 | 0.862 | 0.862 | 0.828 | 0.834 | 0.904 | 0.919 |
| ext / BIPIA code only | 0.885 | 0.978 | 0.978 | 0.897 | 0.902 | 0.962 | 0.972 |
| ext / BIPIA table only | 0.611 | 0.746 | 0.746 | 0.759 | 0.767 | 0.846 | 0.867 |
| ext / long docs (4 two-class) | 0.908 | 0.982 | 0.952 | 0.854 | 0.834 | 0.906 | 0.907 |
| ext / web | 0.803 | 0.856 | 0.818 | 0.703 | 0.783 | 0.820 | 0.834 |
| base / email (BIPIA email) | 0.712 | 0.826 | 0.895 | 0.790 | 0.824 | 0.901 | 0.917 |
| base / obfuscated | 0.810 | 0.921 | 0.855 | 0.855 | 0.887 | 0.811 | 0.956 |

Paired bootstrap of the AUROC difference, Qwen3.8 − Qwen3.6 (1,000 resamples stratified by class within dataset, seed
20261015):

| Run / group | Q3.8 AUROC | Q3.6 AUROC | Difference [95% CI] |
|---|---|---|---|
| ext / QA | 0.821 | 0.919 | **−0.099 [−0.110, −0.087]** |
| ext / BIPIA | 0.862 | 0.834 | +0.028 [+0.011, +0.044] |
| ext / web | 0.856 | 0.783 | +0.073 [+0.039, +0.105] |
| ext / long docs | 0.982 | 0.834 | +0.148 [+0.129, +0.168] |
| ext / code | 1.000 | 0.889 | +0.112 [+0.094, +0.129] |
| base / email | 0.826 | 0.824 | +0.002 [−0.056, +0.057] |
| base / web | 0.899 | 0.861 | +0.038 [+0.013, +0.063] |
| base / obfuscated | 0.921 | 0.886 | +0.035 [+0.007, +0.065] |

### One threshold chosen on the baseline, applied to the extension

For each model, the single threshold that maximizes mean dataset BA over the 21 baseline datasets is applied unchanged
to the 14 extension datasets. The extension data was never used to pick it.

| Model | Chosen threshold | Baseline BA @0.5 → @t | Extension BA @0.5 → @t | Extension in-sample oracle |
|---|---|---|---|---|
| Qwen3.8 27B | 0.15 | 0.895 → 0.906 | **0.865 → 0.891** | 0.904 (t = 0.05) |
| Qwen3.6 35B-A3B | 0.15 | 0.901 → 0.901 | 0.866 → 0.866 | 0.869 |
| Gemma 4 26B-A4B | 0.45 | 0.923 → 0.924 | 0.922 → 0.922 | 0.928 |

Qwen3.8 extension BA by group at 0.5 → 0.15: email (LLMail attacks) 0.810 → 0.887, BIPIA 0.748 → 0.788, QA
0.730 → 0.758, long docs 0.908 → 0.946, web 0.802 → **0.760** (benign pages move above the lower threshold), agent
0.999 → 0.999, code 1.000 → 1.000.

### Where the newly missed attacks score

The table covers attacks that Qwen3.6 flags (> 0.5) and Qwen3.8 does not, on identical cases. It gives the share of
Qwen3.8's scores in each bin.

| Run / group | n | = 0 | (0, 0.25) | [0.25, 0.5] |
|---|---|---|---|---|
| ext / QA | 696 | **60%** | 32% | 8% |
| ext / BIPIA | 181 | 37% | 49% | 14% |
| ext / email | 20 | 15% | 55% | 30% |
| base / email | 59 | 17% | 58% | 25% |
| base / obfuscated | 82 | 15% | 52% | 33% |
| ext / long docs | 24 | 4% | 46% | 50% |

In the other direction (Qwen3.8 flags, Qwen3.6 misses), Qwen3.6 scores exactly 0 on 80–100% of cases in every group.
Qwen3.6 scores are close to binary. Qwen3.8 also puts 14–19% of benign-only cases in (0, 0.25): NotInject 13.7%, PIDS
hard benign 19.1%, encoding benign controls 14.0%, authorized-benign long docs 18.2%. Qwen3.6 and Gemma26 put 0.3–1.9%
there (Gemma26 8.4% on the encoding controls).

## 4. Interpretation

- **Qwen3.8 is a hedging, graded scorer.** In email, BIPIA code, long docs and web, it ranks attacks as well as or
  better than Qwen3.6, but many of its true detections score 0.05–0.5. Under the fixed > 0.5 rule these become misses.
  Qwen3.6 and Gemma26 give near-binary scores, so the threshold barely matters for them. Qwen3.8's lower BA@0.5 in
  these groups is mostly a calibration effect.
- **QA is a real recognition gap.** Qwen3.8's QA AUROC is about 0.10 lower than Qwen3.6's, with a tight interval, and
  60% of the attacks it newly misses score exactly 0. A lower threshold recovers only 0.03 BA there. BIPIA table looks
  similar: low AUROC for every model, and the lowest for Qwen3.8.
- **Hypothesis (untested): the xhigh instruction drives the hedging.** "Validate key assumptions, consider plausible
  alternatives" invites the model to argue itself down from a clear detection. That fits the 0.3–0.5 "recognized but
  not concerning" pattern seen in O18, O44, O46 and the pilot's newly missed attacks. Nothing here separates the
  instruction from the model's own disposition. The effort ablation in #33 (xhigh, medium, low, and xhigh with the
  instruction removed) is the test.

## 5. Consequences for reported numbers

- **Every local Qwen3.8 number means "Qwen3.8 at `xhigh` with the template instruction".** That covers the Studio
  baseline (BA 0.895), the extension suite (0.865), Study A and the earlier MacBook runs. None of them is a
  `high`-effort result.
- **The abliteration pilot stays internally valid.** All three builds embed the same template and received the same
  38-token instruction (+0 `prompt_tokens` vs vanilla). The comparison is between abliterated and original weights
  under one shared setting. Whether the effect holds at other effort settings is untested.
- **Cross-model comparisons that involve Qwen3.8 carry a caveat.** This applies to ranks, per-type leaders, reasoning
  length vs accuracy, and MoE vs dense groupings that include Qwen3.8. Qwen3.8 had a different system prompt in
  effect, and its BA@0.5 understates what a per-model threshold would give. No other model's prompt received an effort
  instruction that differs from the request. Muse's template adds "Reasoning strength: high" at every setting, so Muse
  also saw a template-added line, but its value matches the request.
- **For the library:** effort values must be ones each template accepts, and thresholds should be set per model. Both
  belong in the recommended-defaults config (#33, follow-up 3).

## Reproduce

From the repository root, with the run checkpoints under `evals/runs/` (git-ignored) and a checkout that holds
`evals/private` as `DATA_ROOT`:

```sh
DATA_ROOT=<checkout> bun evals/analysis/qwen38-effort-calibration-2026-10/extract.ts
uv run --no-project --python 3.12 --with numpy --with scipy evals/analysis/qwen38-effort-calibration-2026-10/analyze.py
DATA_ROOT=<checkout> bun evals/analysis/qwen38-effort-calibration-2026-10/effort-inputs.ts
uv run --no-project --python 3.12 --with tokenizers --with jinja2 evals/analysis/qwen38-effort-calibration-2026-10/effort-audit.py
```

The intermediate files (`cases.json` with per-case scores, `inputs.jsonl` with case text, and the downloaded
tokenizers) go to `evals/runs/qwen38-effort-calibration-2026-10/` and are not published. `effort-audit.py` downloads
public Hugging Face tokenizers and reads GGUF headers over the network (set `VERIFY_GGUF=0` to skip the header
reads). Rerunning `extract.ts` and `analyze.py` reproduced the original `results.json` byte for byte.
