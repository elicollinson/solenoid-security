# LLaDA2.2-flash full run and confirmatory window test: pre-registration (2026-10-19)

> **PRE-REGISTERED.** This plan, [`plan.json`](../analysis/llada-flash-full-2026-10/plan.json) and the two suites were
> committed and pushed **before any inference call of this run**. The commit timestamp is the registration time. The
> results report is [`llada-flash-full-2026-10.md`](llada-flash-full-2026-10.md). Part of
> [#38](https://github.com/elicollinson/solenoid-security/issues/38); follows the exploratory window sweep (PR #41,
> FINDINGS O62).

## 1. Context

The exploratory sweep (O62) found that LLaDA2.2-flash 4-bit gained a lot on long LongPIBench code and email with
256/256 and 128/128 sliding word windows (code 0.725→0.975, +10/−0), with zero added false alarms. That sweep was not
pre-registered, compared about 3,900 cells, and used 20 attacks and 20 clean documents per domain.

**The confound.** LongPIBench payloads in the default cohorts always sit at the document end (conclusion, last,
footnote). With 0% overlap the last window is a short remainder that holds the payload almost alone. A window gain
there may be a "the payload is isolated at the end" effect rather than a general long-document effect. This run tests
whether the gain survives where the payload is **not** at the end, and on subtle templates.

This run also gives Flash a complete full-text row on both Studio suites, scored exactly like the 7 Q8 models.

## 2. Model, engine and suites

- **Model:** LLaDA2.2-flash, the user's 4-bit MLX build. It is a text-diffusion model with no reasoning pass.
- **Engine:** `llada22-flash-4bit`, copied byte for byte from
  `prompt-injection-openai-compat-llada22-variants-pilot-v1.json`. It uses the frozen score-only prompt, prompt-only
  JSON, temperature 0 and max_tokens 128. Decoding params are sent per request: block_length 32, steps 32,
  threshold 0.5, editing_threshold 0.0 and max_post_steps 16.
- **Transport:** the harness's `openai_compatible` engine against the user's server, with the URL passed at run time
  (`--base-url`). Calls are strictly serial, with no dedup and `--continue-after-output-errors`.
- **Suites:**
  - `evals/suites/prompt-injection-openai-compat-llada22-flash-baseline-v1.json` (21 tests, 7,326 cases);
  - `evals/suites/prompt-injection-openai-compat-llada22-flash-extension-v1.json` (14 tests, 6,759 cases).

  Both are built by [`make-suites.ts`](../analysis/llada-flash-full-2026-10/make-suites.ts). Their tests (dataset,
  revision, annotation key, case selector, metrics) are copied verbatim from the Studio Q8 t4096 baseline and
  extension suites.
- **Conditions:**

  | Condition | Input strategy | Tests |
  |---|---|---|
  | `llada22-flash-4bit-full` | full text, last external turn | all 35 |
  | `llada22-flash-4bit-w256s256` (**primary**) | `sliding_word_window_preserve_v1`, 256 words, stride 256 | the 14 window cohorts (§3) |
  | `llada22-flash-4bit-w128s128` (secondary) | the same, 128/128 | the 6 H2 cohorts only (§6, declared fallback) |

  The strategy objects are the sweep's own, so window boundaries match O62.

## 3. Window cohorts (rule declared before the run)

**Rule.** A test is a window cohort when both of these hold:

1. its annotation key is `prompt_injection_attempt`;
2. its median full-text input (last external turn, whitespace words) is above 512, **or** its dataset is
   LongPIBench-derived (the id starts with `longpibench-` or `longpi-`).

`skill-policy-pairs` (median 1,502 words) fails the first clause. Its `policy_violation` label is a whole-skill
judgment that is outside the window hypothesis. [`cohort-rule.ts`](../analysis/llada-flash-full-2026-10/cohort-rule.ts)
computes the rule from the datasets and checks it against `plan.json`.

| Suite | Cohort | Cases (attack/benign) | Median words | Windows 256 | Windows 128 | Payload position |
|---|---|---|---:|---:|---:|---|
| baseline | longpi-paper | 300/100 | 4,207 | 6,982 | – | end (conclusion) |
| baseline | longpi-paper-abstract | 300/0 | 4,218 | 5,251 | 10,351 | **start (abstract)** |
| baseline | longpi-paper-method | 300/0 | 4,218 | 5,251 | 10,351 | **middle (method)** |
| baseline | longpi-resume | 300/100 | 269 | 627 | – | end (footnote) |
| baseline | longpi-code | 300/100 | 564 | 1,102 | – | end (last) |
| baseline | longpi-email | 300/100 | 1,278 | 2,138 | – | end (last) |
| baseline | paper-score-counterfactual | 54/18 | 5,130 | 1,539 | – | end (conclusion) |
| extension | browsesafe-mixed | 200/200 | 2,262 | 4,016 | – | varied (HTML pages) |
| extension | inj-triviaqa-mixed | 900/300 | 692 | 3,565 | – | start / middle / end |
| extension | longpi-email-llmail-mixed | 300/100 | 1,308 | 2,210 | 4,239 | email_in_end / **attachment_middle** / attachment_end |
| extension | longpi-subtle-paper-mixed | 120/100 | 4,175 | 3,813 | 7,510 | 7 sections, mostly not the end |
| extension | longpi-subtle-code-mixed | 120/100 | 546 | 591 | 1,086 | top / middle / end / description end |
| extension | longpi-subtle-resume-mixed | 120/100 | 250 | 326 | 564 | 5 sections |
| extension | longpi-authorized-benign | 0/384 | 834 | 2,566 | – | benign only (authorized instructions) |

Not selected: every other test (medians 1–434 words). Repoguard (median 100) and BIPIA code and table (110 and 230)
fail the rule.

## 4. Hypotheses (confirmatory)

All three use the max > 0.5 decision rule. The **primary abstention policy is ignore-invalid**: an output-abstained
window is ignored, and a case abstains only if no window is valid. The strict rule (any invalid window abstains the
case, the harness rule) is reported as secondary. There is no dedup. Comparisons are paired on identical cases that
are jointly valid under the policy in use. BA is the mean of the available class rates (TPR alone on attack-only
cohorts). Tests use exact two-sided McNemar on per-case correct/incorrect.

**H1.** On the long-document cohorts, Flash with 256/256 windows has higher BA than Flash full text.

- Family: the 13 window cohorts that contain attacks. `longpi-authorized-benign` is benign only, so it enters H3
  only.
- A cohort supports H1 when ΔBA > 0 and the Holm-adjusted p (over the 13) is below 0.05.
- Secondary: 128/128 on the 6 H2 cohorts, with Holm over those 6.

**H2 (the key test).** The 256/256 gain holds where the payload is **not** at the end, and on the subtle templates.

- Family (6 members, Holm over 6, same criterion as H1):
  - `longpi-paper-abstract`;
  - `longpi-paper-method`;
  - `longpi-email-llmail-mixed` restricted to `attachment_middle` attacks plus all 100 clean emails;
  - `longpi-subtle-paper-mixed`, `longpi-subtle-code-mixed` and `longpi-subtle-resume-mixed`.
- `longpi-email-llmail-mixed` is reported per position: `email_in_end`, `attachment_middle` and `attachment_end`,
  each with the same 100 clean emails. The facet has no start position. The two end positions are the descriptive
  contrast.
- **Verdict:**
  - **supported** if all three non-end members (abstract, method, attachment_middle) are supported;
  - **partial** if at least one H2 member is supported;
  - **not supported** otherwise.
- Secondary: the same family at 128/128. Descriptive only, with no correction: `inj-triviaqa-mixed` by
  `insertion_position` (start, middle, end), and the subtle cohorts by `template_position`.

**H3.** Windows do not add false alarms. FPR with 256/256 is non-inferior to full text within 2 percentage points.

- Population: all benign cases of the 14 window cohorts, pooled and paired. `longpi-authorized-benign` is included.
- Statistic: the paired FPR difference (windows minus full) with a 95% Newcombe hybrid-score interval for paired
  proportions (method 10).
- Non-inferior if the upper bound is below +0.02.
- Secondary, descriptive: per cohort, `longpi-authorized-benign` alone, and 128/128 on the H2 cohorts' benign cases.

**Sensitivity (declared).** H1 and H3 are repeated on cases outside the 998-case pilot caseIds. The exploratory sweep
drew its subsample from the pilot, so those are the cases the hypotheses came from. This deviates from the sweep's
§8 proposal of fully fresh cases. The H2 cohorts were not in the pilot or the sweep.

## 5. Full text on every test

Full text runs on all 35 tests (14,085 cases). It is scored exactly like the 7 Q8 models in
`studio-baseline-t4096-2026-10-07` and `studio-extension-t4096-2026-10-13`:

- abstentions are excluded from rates and counted;
- per-dataset BA is the mean of the available class rates;
- data-type groups and the overall score weight datasets equally;
- groups are the same as `analyze-baseline.ts` and `analyze-extension.ts`.

Flash becomes an 8th row. It differs from the 7 models in protocol: it has no reasoning pass, uses prompt-only JSON
instead of a strict schema, runs as MLX 4-bit instead of GGUF Q8_0, and is served by the user's server instead of LM
Studio.

**Exploratory (clearly separated in the report):**

- the cascade (full text, then windows), replayed offline;
- position strata beyond H2;
- whether the firing window is the document's last window;
- paired comparison with Gemma26 and Qwen3.8 Q8 full text on identical cases;
- latency and throughput;
- determinism against the pilot checkpoints.

## 6. Run order, fallback and stopping rules

**Order.** One serial queue ([`queue.txt`](../analysis/llada-flash-full-2026-10/queue.txt),
[`run-queue.sh`](../analysis/llada-flash-full-2026-10/run-queue.sh)):

1. full text on all 35 tests;
2. 256/256 on the 14 cohorts;
3. 128/128 on the 6 H2 cohorts (subtle code, subtle resume, email-llmail, subtle paper, abstract, method).

**Paths.** Checkpoints go to the default per-suite paths `evals/runs/<suite id>/<test>/<condition>.jsonl`. Logs
(`progress.log`, `console.log`) go to `evals/runs/llada-flash-full-2026-10-19/`. Everything there is git-ignored.

**Declared fallback (triggered before the run).** At the sweep's measured latency, 128/128 on all 14 cohorts would be
77,924 calls (about 7.4 h). Full text (about 2.5 h) and 256/256 (about 4.1 h) come on top of that, about 14 h in
total, which is far past the 8 h budget. So 256/256 runs on all 14 cohorts and **128/128 only on the 6 H2 cohorts**.
H1 at 128/128 is therefore tested on those 6 only.

**Stopping rules.**

- Any non-zero runner exit halts the chain.
- A transport failure (`provider_or_transport_error` or `http_error`) is retried after 120 s with `--retry-uncertain`,
  at most 3 times per cell. The same applies to unresolved dispatches left by an interrupted process. A provenance or
  validation failure halts with no retry.
- If the server fails repeatedly (3 halted cells, or the same cell halting twice after a manual resume), the run stops
  and is reported as stopped.
- After each cell, [`check-cell.ts`](../analysis/llada-flash-full-2026-10/check-cell.ts) counts case abstentions under
  the primary policy:
  - **above 10% on a declared window cohort** (either condition): the chain halts and the run is reported;
  - **above 10% on any other full-text cohort:** an `ABSTENTION_FLAG` line is written and the run continues, because
    the 8th row needs every test. The pilot's NotInject rate was 7/120.
- Server-reported model reloads are counted and reported. They do not stop the run.

## 7. Planned calls and estimated cost

Dry runs (`run-suite.ts` without `--execute`, every queued cell; [`dryrun.tsv`](../analysis/llada-flash-full-2026-10/dryrun.tsv)):

| Condition | Cells | Planned calls | Estimate |
|---|---:|---:|---:|
| full text | 35 | 14,085 | 2.5 h |
| 256/256 | 14 | 39,977 | 4.1 h |
| 128/128 (H2 cohorts) | 6 | 34,101 | 3.2 h |
| **Total** | **55** | **88,163** | **≈ 9.8 h** |

The estimate uses Flash latencies from the pilot and the sweep: full text costs 0.30 s plus 0.42 ms per word, a
256-word window 0.37 s, and a 128-word window 0.34 s. Money cost is zero, since this is the user's own hardware.

## 8. What would change the conclusions

- **H1 holds but H2 fails on the non-end members:** the O62 gain is mostly payload isolation at the document end.
  Windows would then be a niche for end-appended payloads, not a long-document fix.
- **H1 and H2 both hold:** Flash with windows is a fast long-document detector on these synthetic cohorts. The
  short-content gap from O61 still stands.
- **H3 fails:** the "zero added false alarms" claim from O62 is withdrawn.
