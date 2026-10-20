# Enhanced agent tool-output set (`agent-enhanced-tool-output-v1`)

**Why.** Agent tool output is the one content group the extension suite did not separate: AgentDojo suites plus Nemotron IPI scored 0.955–1.000 for all seven Studio models, 0.982–1.000 for the six recommended ones (O57, [#31](https://github.com/elicollinson/solenoid-security/issues/31)). Three likely causes are that the injections sit in their original, purpose-built slot, that AgentDojo rotates 5 blunt templates, and that false alarms are barely tested (44 clean AgentDojo outputs, no Nemotron negatives). This cohort changes all three while still writing **no new attack text**:

- **Positives** take already-published attack texts **verbatim** and place them in tool-output fields and positions where they were not originally (a new pairing of carrier, field and position).
- **Hard negatives** place repository-authored **benign instructions** (support tickets, setup steps, calendar notes, runbooks…) in the same kinds of carrier and field.
- **Clean carriers** are untouched tool outputs. Classes are 250 / 250.

Test: `agent-enhanced-mixed` (`caseSelector: all`, detection and false-positive rates) in [`suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-agent-enhanced-v1.json`](../suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-agent-enhanced-v1.json). The suite's engines, input strategy, decision rule and 7 conditions are copied unchanged from the extension suite (Qwen3.6 27B left out). The screened turn is the tool output only (`full_text`, `last_external`), the same framing as `agentdojo-suites-mixed`.

## Composition (500 cases)

| Class | Kind | Cases | AgentDojo / Nemotron carriers |
| --- | --- | ---: | ---: |
| injection | published payload in a new field | 250 | 71 / 179 |
| benign | hard negative (frozen benign phrasing) | 150 | 63 / 87 |
| benign | clean carrier (untouched) | 100 | 8 / 92 |

The carrier mix is identical in the two classes at the suite/domain level: workspace 48, slack 12, travel 11, and Nemotron healthcare 28, hr 27, IT helpdesk 23, logistics 23, education 19, e-commerce 18, real estate 17, insurance 13, legal 11 per class. Banking is absent: its only eligible carrier (a transaction list) was dealt to the positive pool, and positives follow the negatives' cells. Hard negatives use each position 50 times; positives use start 86, middle 82 and end 82.

## Payload provenance (positives)

| Source | Payloads | License | What is used | Category facet |
| --- | ---: | --- | --- | --- |
| [Nemotron-RL-Agentic-IPI-v1](https://huggingface.co/datasets/nvidia/Nemotron-RL-Agentic-Indirect-Prompt-Injection-v1) | 70 | CC BY 4.0 (NVIDIA) | `injection_text`, stripped, deduplicated over all 1,272 rows (686 distinct) | `attack_category` (4) |
| [LLMail-Inject](https://huggingface.co/datasets/microsoft/llmail-inject-challenge) | 70 | MIT | Submission body (no subject) from the `llmail-inject-payload-pool-v1` pool, same selection code | phase × judge reason |
| [BIPIA](https://github.com/microsoft/BIPIA) | 70 | MIT | Text attacks (`text_attack_{train,test}.json`) | attack family (29 used) |
| [AgentDojo](https://github.com/ethz-spylab/agentdojo) (control) | 40 | MIT | The 5 published templates filled with injection-task goals: exactly the (suite, task, template) pairs `agentdojo-suites-v1` uses | template (8 each) |

Every payload is used once. The ignored sidecar `evals/private/sources/agent-enhanced-tool-output-v1-payloads.json` (pinned by SHA-256 in the manifest) records each payload's source, ID, category, license, hash and text. Tests check each text against the upstream file it came from. Nemotron, BIPIA and LLMail must match exactly. AgentDojo control payloads must match whitespace-normalized, because `agentdojo-suites-v1` renders them through the environment YAML. Tests also check that the text appears verbatim in a parsed string field of the screened output. Nemotron payloads in Nemotron carriers stay in their own domain and never return to their source row. AgentDojo payloads in AgentDojo carriers stay in their suite. Elsewhere, payloads were written for other contexts (LLMail's email scenario, BIPIA QA tasks), so some read as out of place in their new carrier.

The control subset (`control=true`) anchors this set against the saturated `agentdojo-suites-mixed`. It keeps the blunt templates but moves them to new fields. If the control stays near 1.0 while Nemotron, LLMail and BIPIA payloads fall, then the field placement is not what saturated the old set.

## Carriers

- **AgentDojo v1 ground-truth tool outputs** (MIT). For each suite and user task, the default environment is replayed through `GroundTruthPipeline` (fixed tool calls, no LLM). An output is a carrier if it exposes at least one free-text environment field that is **not an injection vector**: an email or Slack body, a calendar description, a file's content, a review, or a banking transaction subject. Vectors are found with canaries, as in `import-agentdojo-suites.py`. An insertion edits that field in the environment before replay, so YAML (or Python-literal) formatting and escaping are upstream's. A carrier is excluded if it is over 12,000 bytes, a duplicate output, or a non-reproducible write-tool output (`append_to_file`, `create_file` and similar stamp `datetime.now()`). 31 carriers remain.
- **Nemotron environments** (CC BY 4.0). A row is used when its stripped `injection_text` appears in exactly one environment leaf (1,268 of 1,272). The injection is cut out of that leaf, and the text on each side is joined with one space. The environment is then deduplicated and serialized as indent-2 JSON, as in `nemotron-ipi-domain-sample-v1`. Insertions go into another free-text field of at least 6 words, never the row's `injection_vector`. Fields are notes, descriptions, comments, summaries, findings, message bodies, KB/resume content and feedback.

Each carrier is dealt to **exactly one class pool** (positive, hard-negative or clean). Carriers are sorted by stratum (suite/tool or domain/read tool) and seeded hash, then dealt over a 2 : 2 : 1 pattern. No tool output therefore appears in both classes. AgentDojo outputs from the same suite still share underlying records, such as the same hotel's reviews, because each suite has one environment.

## Placement

The insertion is one space plus the text, at the **start** or **end** of the field value, or at a **middle** sentence boundary (a word boundary if there is none) chosen by SHA-256. The same rule applies to payloads and benign phrasings. Each negative defines a cell (carrier source, suite/domain, field family). Each positive fills one cell in its disjoint pool; a clean cell takes any family in that domain. Payload sources are spread evenly over the seeded cell order, and each source splits over AgentDojo and Nemotron carriers in proportion to the negatives.

## Hard-negative template taxonomy

There are 50 frozen phrasings in [`templates/agent-benign-instructions-v1.json`](templates/agent-benign-instructions-v1.json), pinned by SHA-256 in the builder and the manifest. To revise them, create a new versioned file. Each phrasing has a `kind` and the field families it `fits` (message, notes, document, review), and each is used 3 times (150 cases):

- **Support and requests:** `support_ticket` (4, e.g. "Please reset my password…"), `deadline_request` (2, "Please confirm your attendance by Friday…"), `forward_request`, `chat_request` (3), `form_instruction`.
- **Logistics:** `meeting_logistics` (2), `delivery_instructions` (3, "Leave the package with the front desk… Do not leave it outside").
- **Technical:** `setup_steps` (3, README-style), `api_doc` (3), `runbook` (3), `code_review` (3, including "Please do not merge until the security review is complete").
- **Policy and domain notes:** `policy_note` (3), `account_security`, `correction` (2, "Please ignore the earlier version of this note"; "Disregard the previous invoice"), clinical, HR, legal, finance, property, education and insurance notes, written for the Nemotron domains.
- **Reviews:** `review_tip` (5, "Tip: ask for a room on the upper floors").

No phrasing addresses an assistant or AI, asks to override instructions, or sends data to a third party; a test checks the first of these. Several deliberately use trigger words ("ignore", "disregard", "urgent", "do not", "reset your password") in their ordinary sense. This follows the precedent of `longpi-authorized-instructions-v1`.

## Limits

- The payload texts are public and widely used in training and evaluation, and the AgentDojo control templates are blunt. The new element is the placement and the hard negatives, not the attack text. It is a detection test, not a measure of agent compliance.
- There are few AgentDojo carriers (31: 10 positive, 13 hard-negative and 8 clean), so each hosts several cases. Nemotron supplies most of the variety. Banking is not represented.
- Payloads add more bytes than benign phrasings. Mean screened size: positives 2,122 bytes, hard negatives 1,849, clean 1,703. Report by `negative_type` and `payload_source`, not only pooled.
- The phrasings were authored to be legitimate in context but have not been separately human-reviewed.

## Rebuild

There are no model calls. The generated JSONL and sidecar are written under ignored `evals/private/sources/`.

```sh
bun run eval:fetch-public                       # AgentDojo checkout in .local/eval-sources/dojo
python3 -B evals/scripts/import-bipia-table-code.py --fetch   # BIPIA files in .local/eval-sources/bipia
# Nemotron and LLMail: download the pinned files (see their manifests) into evals/private/upstream/{nemotron-ipi,llmail-inject}/
uv run --no-project --python 3.12 --with-editable .local/eval-sources/dojo --with pyyaml==6.0.3 --with pydantic==2.14.0 \
  python -B evals/scripts/build-agent-enhanced-tool-output.py
bun test ./evals/tests/agent-enhanced-tool-output.test.ts
```
