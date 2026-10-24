# Pre-registration: Qwen3.8 27B at `reasoning_effort: "low"` on the full Studio suites (2026-10-22)

Tracking issue [#33](https://github.com/elicollinson/solenoid-security/issues/33). Stacked on the effort ablation
([report](qwen38-effort-ablation-2026-10.md), PR #49, `FINDINGS.md` O65). Committed and pushed before any call.
Scripts: [`evals/analysis/studio-qwen38-low-2026-10-22/`](../analysis/studio-qwen38-low-2026-10-22/).

## What changes

- **One setting.** Qwen3.8 27B GGUF Q8_0 runs at `reasoning_effort: "low"` instead of the frozen `"high"`. LM Studio drops
  `"high"`, so the frozen runs got the template default, `xhigh`. The engine is the ablation's low engine, copied
  byte-for-byte: `studio-qwen38-q8gguf-lmstudio-score-v1-thinking4096-native-v0-effort-low-v1`. Its only differences
  from the frozen `studio-qwen38-q8gguf-lmstudio-score-v1-thinking4096-native-v0-v1` are `reasoning_effort`, an
  `effort_mechanism` note, the engine ID and the loaded identifier (sorted-JSON diff checked by `make-suites.ts`).
- **New suites, one condition.**
  - `prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1`: 21 tests, 7,326 cases.
  - `prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1`: 14 tests, 6,759 cases.
  - Tests, input strategy (`full-last-external-v1`) and decision rule (`max-score-gt-05-v1`) are copied unchanged
    from the frozen baseline and extension suites.
  - Condition `baseline-qwen38-q8gguf-low-t4096-full`. Run directory `evals/runs/studio-qwen38-low-2026-10-22/`.
- **Everything else is frozen:**
  - the score-only prompt and `json_schema` output;
  - temperature 0, `max_tokens` 4096, context 65,536;
  - native `/api/v0`, serial, `--require-device=2e1a82366471bc1a78e9b74d2469172d`, the device lock and
    `--continue-after-output-errors`.

## What is reused

- **The xhigh rows.** The frozen Qwen3.8 baseline and extension checkpoints are the comparator. They stay published as
  the historical protocol ("Qwen3.8 at xhigh with the template instruction").
- **Other models.** Their rows are not rerun.

## Gates and stopping rules

1. **Preflight.** Both suite hashes must match `plan.json`, and every cell is dry-run (case counts must equal the plan).
   No model may be loaded, no device lock may exist, no other matrix driver may be running, and LM Link must be
   connected.
2. **Drift gate.** The first 24 cases of `bipia-email-mixed` are run before anything else. All 156 of its cases are in
   #49's low arm. Pass requires all of:
   - `prompt_tokens` equal to frozen xhigh − 12 on 24/24;
   - `prompt_tokens` equal to #49's low arm on every overlapping case;
   - outcome (status and flag at 0.5) agreeing with #49's low arm on ≥ 90%.

   Exact score and final-answer reproduction are reported but not required (#49's own xhigh drift had 98/100 identical
   answers). On failure the run stops.
3. **Mechanism gate on the extension.** The first 10 cases of `bipia-table-mixed` must have `prompt_tokens` equal to
   frozen − 12 on 10/10, with ≤ 3 abstentions.
4. **Every cell.** The `CELL` step halts the queue unless every case finished (scored or abstained) and the −12 delta
   holds on every case with usage on both sides.
5. **L141.** A link or provenance failure halts the queue. That cohort is rerun under a fresh condition and is never
   resumed.
6. **Time.** The estimate is 20.9 h (the frozen xhigh spans of 13.24 h + 12.29 h, × 0.82). The hard cap is 25 h from
   `CHAIN_START`. The approved budget is about 21 Studio hours.

## Analysis (fixed now)

- **Metrics per dataset and group, low vs frozen xhigh:**
  - BA at 0.5, FPR, abstentions, and AUROC on mixed datasets;
  - groups are the frozen data types: baseline longdoc, email, web, agent, obfusc, benign, policy; extension longdoc,
    BIPIA, QA, web, agent, email, code;
  - datasets are weighted equally, abstentions are excluded from rates, and the two suites are never pooled.
- **Paired tests vs xhigh.**
  - Exact McNemar at 0.5 per group and per suite, on cases scored in both arms, Holm-adjusted within each suite's group
    family.
  - ΔBA with a 95% paired, class-stratified bootstrap.
  - Each suite's overall test is the headline test. A sensitivity check counts abstentions as errors.
- **Threshold.** The O55 method: the observed score that maximizes mean dataset BA over the 21 baseline datasets (ties
  go to the value closest to 0.5). It is applied unchanged to the 14 extension datasets, and the out-of-sample gain is
  reported with a bootstrap interval, with and without web.
- **Profile rule.** Keep 0.15 for non-web content if both hold:
  - extension non-web BA at 0.15 ≥ BA at 0.5;
  - 0.15 is within 0.03 of the best fixed value on the extension, non-web.

  Otherwise recommend the fitted value. Keep 0.5 for web unless both web datasets (baseline `web-mixed`, extension
  BrowseSafe) score at least as well at the lower value.
- **README.** The low numbers replace the Qwen3.8 row in the headline table whatever their direction, because low is
  now the recommended configuration (O65). The xhigh numbers move to the footnote and the report.
