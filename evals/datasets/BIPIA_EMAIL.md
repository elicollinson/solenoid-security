# Paired BIPIA EmailQA detection cohort

`bipia-email-paired-v1` contains **78 injection attempts and 78 clean controls**. Each pair shares the same trusted EmailQA question and the same base email. The attack case adds one published BIPIA payload at the start or end; insertion matches the pinned upstream implementation. Questions remain operator turns, and email contents remain external document turns. Expected answers and attack labels are never included in model inputs.

The 100 upstream question rows contain only 78 unique emails. Repeated contexts are deduplicated before constructing pairs. Official test contexts take priority when an email occurs in both upstream splits, leaving **34 train-context pairs and 44 test-context pairs** with no exact email overlap. The `split`, `pair_id`, `base_context_sha256`, `attack_family`, `attack_variant`, and `insertion_position` facets support grouped analysis. The 15 attack families in each source split cover 29 distinct family names overall. Repeated wording and common email templates remain; source-disjoint exact hashes do not imply semantic independence.

Rebuild without provider calls:

```sh
python3 -B evals/scripts/import-bipia-email.py --fetch
bun test evals/tests/bipia-email.test.ts
```

Omit `--fetch` for an offline rebuild, or pass `--source-dir=/path/to/pinned/files`. Raw public source files are cached in ignored `.local/eval-sources/bipia/`. Generated canonical cases are written to ignored `evals/private/sources/bipia-email-paired-v1.jsonl`; their `public` manifest visibility describes upstream access. The importer checks every source-file SHA-256 and the canonical output hash before writing.

Use a mixed test with `caseSelector: "all"`, annotation key `prompt_injection_attempt`, and detection, false-positive, and confusion-matrix metrics. Compare paired results and report upstream-split and attack-family slices. Preserve pair/context groups when tuning thresholds; do not randomly split clean and attacked versions across calibration and evaluation. This cohort measures detection of inserted attempts, not whether an agent obeyed an attack. Original contexts have not received an independent malicious-content review.

The [BIPIA paper](https://arxiv.org/abs/2312.14197) describes the original attack/defense benchmark. The [pinned project license](https://github.com/microsoft/BIPIA/blob/a004b69ec0dd446e0afd461d98cb5e96e120a5d0/LICENSE) explicitly lists EmailQA invoices from OpenAI Evals as MIT licensed; BIPIA attack templates and code are MIT licensed. TableQA and CodeQA use different licenses, and WebQA/Summarization require separately obtained sources, as described in the [upstream benchmark guide](https://github.com/microsoft/BIPIA/blob/a004b69ec0dd446e0afd461d98cb5e96e120a5d0/benchmark/README.md). This cohort uses only EmailQA and the text attack files. Credit: Jingwei Yi and collaborators, *Benchmarking and Defending Against Indirect Prompt Injection Attacks on Large Language Models*; upstream copyright Microsoft Corporation.
