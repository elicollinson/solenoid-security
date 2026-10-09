# LLMail-Inject payload pool and long-email cohort

**Payload pool.** `llmail-inject-payload-pool-v1` contains **300 attack-only** emails sampled from the full public [LLMail-Inject release](https://huggingface.co/datasets/microsoft/llmail-inject-challenge) (MIT) at a pinned revision.

1. **Eligibility.** From both phases' labelled unique submissions, keep those with `attack_attempt == "True"` and a reason of `api_triggered` or `judge` (131,734). Each must parse as `Subject of the email: … Body: …` with a 40–4,000-character body.
2. **Deduplication.** Order by SHA-256 of `llmail-inject-payload-pool-v1/<phase>/<sha256(submission)>`. Drop exact duplicates of the normalized body (whitespace-collapsed, casefolded) and near duplicates sharing its first 120 normalized characters, leaving 56,122.
3. **Stratification.** Strata are phase × judge reason × body-length tercile (edges 256 and 667 characters). Take the first 25 per stratum.

Each case is the subject and body as a single email. Facets keep the phase, reason, tercile and submission hash for provenance. This cohort may overlap the private `llmail-phase2-positive-400` cohort; do not pool the two.

**Constructed cohort.** `longpi-email-llmail-v1` holds **300 injection and 100 clean** cases. Each of the 100 LongPIBench benign emails receives pooled payloads *i*, *100+i* and *200+i* in three siblings:

- `email_in_end`: appended to the incoming email body;
- `attachment_middle`: at a SHA-256-chosen paragraph break in the attachment;
- `attachment_end`: appended to the attachment.

Every pooled payload is used once. Only the payload body is inserted. The clean email (the fourth sibling) is asserted byte-identical to upstream `prepare_example(attack="no")` and to the clean cases of `longpibench-email-default-v1`. The trusted turn is LongPIBench's email-assistant prompt.

These are real competition attempts written for LLMail's exfiltration scenario, placed in long benign business emails. Their goals do not match the summarize-and-reply task, and labels mark attempts, not compliance. Report by `insertion_position`, `phase` and `judge_reason`, and group by `document_family`. Unlike LongPIBench's single email sentence, the 300 payloads are distinct.

```sh
python3 -B evals/scripts/import-llmail-pool.py
```
