# LLaDA2.2-flash surface-cue analysis (EXPLORATORY, POST HOC, 2026-10-19)

Offline re-analysis of existing checkpoints; **no inference was run**. It tests a hypothesis formed after O63: that
LLaDA2.2-flash (4-bit MLX, full text) is a "surface-cue detector" that flags salient, explicit, AI-directed
imperatives rather than judging task redirection. Part of
[#38](https://github.com/elicollinson/solenoid-security/issues/38). The report is
[`llada-flash-surface-cues-2026-10.md`](../../reports/llada-flash-surface-cues-2026-10.md), recorded as `FINDINGS.md` O64
and research log L156.

**Order of work.** `coding.json` (the explicitness coding, lexical features and bins) was committed in `263e26c` before
any per-label, per-length or per-feature result was computed. The only Flash numbers seen beforehand were the
per-dataset aggregates of O63. Three additions were made after the first run, and they are labelled as such everywhere:
the sensitivity contrast without the LongPI default family, the payload-size model, and excluding the two encoded
datasets from check 3 (their inputs are base64 or unicode escapes, so they have no words to code).

**Data (git-ignored, read from `DATA_ROOT`).** Flash full-text checkpoints
`evals/runs/prompt-injection-openai-compat-llada22-flash-{baseline,extension}-v1/<test>/llada22-flash-4bit-full.jsonl`;
controls `evals/runs/studio-{baseline-t4096-2026-10-07,extension-t4096-2026-10-13}/<test>/baseline-<m>-t4096-full.jsonl`
for Gemma 4 26B-A4B (`gemma26-q8`), Qwen3.8 27B (`qwen38-q8gguf`) and Laguna XS 2.1 (`laguna-xs21-q8`). All 140
checkpoints (35 tests × 4 models) are audited with `auditPartialCheckpoint`, and every scored observation's input
SHA-256 is checked against a fresh full-text segmentation. Dataset facets come from `loadDataset` and `selectTestCases`.

| File | What it is |
|---|---|
| `coding.json` | Fixed before results: the explicitness coding per dataset (with the template text it was read from), the secondary contrasts, the descriptive-only facets, the six lexical features and the length bins. |
| `analyze-surface-cues.ts` | Offline and read-only. It runs checks 1–3 and the post hoc additions and writes aggregates only. Usage from the repo root: `DATA_ROOT=<checkout with evals/runs and dataset sources> bun evals/analysis/llada-flash-surface-cues-2026-10/analyze-surface-cues.ts` (optional `B=<bootstrap reps>`, default 1000). It takes about 40 s. |
| `results/surface-cue-results.json` | All estimates, CIs, per-label and per-bin rates, and the audited checkpoint paths and SHA-256s. |
| `results/tables.md` | The same, as Markdown tables. |
| `PROVENANCE.tsv` | Provenance for this folder's files (also listed in `../PROVENANCE.tsv`). |

**Methods in one paragraph.** Cases are the 14,085 full-text cases of the 35 Flash tests. Cases where any of the four
models abstained are dropped (13,801 are jointly valid). Rates are per model on the same cases. Logistic models use
stratum intercepts (dataset, or dataset × template label for length). Strata whose outcome is constant for a model are
dropped, because they carry no within-stratum information. A small ridge keeps the fits finite. Recall-gap contrasts
are also reported as risk differences averaged over datasets with equal weight. CIs are percentile intervals from a
cluster bootstrap with 1,000 replicates. The bootstrap resamples clusters (document family, pair, parent seed or task
family) within datasets, and uses the same resample for all models, so Flash-minus-control differences are paired.
Benign-case feature associations are stratified AUROCs: pairs are formed only within a dataset. The feature model is a
stratum-intercept logistic model on log1p features, scored out of fold (5 folds by cluster hash).

**No case text, response text, case IDs or endpoint URLs** are written. `results/` holds counts, rates, estimates,
dataset and label names, and checkpoint paths with hashes.
