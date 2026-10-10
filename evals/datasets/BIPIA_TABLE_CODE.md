# Paired BIPIA TableQA and CodeQA cohorts

`bipia-table-paired-v1` (**450 injection, 150 clean**) and `bipia-code-paired-v1` (**300 injection, 100 clean**) extend the [paired EmailQA design](BIPIA_EMAIL.md) to two more BIPIA tasks. They use the complete published attack inventories rather than one attack per context.

- **TableQA.** Per upstream split, question rows are deduplicated by exact table, ordered by SHA-256 and the first 75 unique tables are kept. The trusted turn is `Question: …`; the table is the external turn.
- **CodeQA.** All 50 unique Stack Overflow answers per split are used. The user's error message and code form the trusted turn; the answer is the external turn, matching BIPIA's own prompt.
- **Assignment.** In each split, the split-matched attacks (75 text attacks: 15 families × 5 variants; 50 code attacks: 10 families × 5) form a Latin square over the contexts. Context *i* gets attack *(i + offset) mod n* at start, middle and end, with offsets 0, n/3 and 2n/3. Every attack appears exactly once at each position, and every context has one clean and three attacked siblings, each with a different attack. Text attacks have 29 distinct family names overall ("Language Translation" occurs in both splits); code attacks have 20.
- **Insertion.** `start` and `end` reproduce upstream `insert_start`/`insert_end` exactly. Upstream `insert_middle` samples an NLTK Punkt sentence start with a seeded RNG. Here `middle` takes a SHA-256-chosen interior line start with the same newline join, which avoids a tokenizer dependency. Tables and answers are line-structured.

Facets: `split`, `pair_id`, `attack_family`, `attack_variant`, `attack_template_id`, `insertion_position`, `attack_kind`, `task`. Use `caseSelector: "all"` with detection, false-positive and confusion metrics. Group bootstrap and calibration by `pair_id`. Report by family and position. Clean contexts were not independently reviewed for malicious content.

Licenses: BIPIA code and attack templates are MIT. TableQA tables come from WikiTableQuestions and CodeQA answers from Stack Exchange, both **CC BY-SA 4.0**, so derived cases carry attribution and ShareAlike terms. WebQA (NewsQA/CNN) and Summarization (XSum/BBC) are excluded because their sources must be obtained separately under restrictive terms.

```sh
python3 -B evals/scripts/import-bipia-table-code.py --fetch
```
