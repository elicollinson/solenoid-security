# Constructed subtle-template cohorts on LongPIBench documents

`longpi-subtle-paper-v1`, `longpi-subtle-code-v1` and `longpi-subtle-resume-v1` each hold **120 injection and 100 clean** cases. They exist because every LongPIBench paper, code and résumé result so far rests on one fixed sentence per template per domain (FINDINGS O1–O3, O15, O43, O45, O46).

**Templates.** [`templates/varied-injection-templates-v1.json`](templates/varied-injection-templates-v1.json) is a frozen, tracked, repository-authored list of 24 subtle phrasings per domain. The builder pins it by SHA-256; changing it requires a new versioned file and new dataset IDs. Each template records:

| Field | Values |
| --- | --- |
| `goal` | positive review, accept, score ≥ 8, no/one weakness, suppress criticism, hidden rubric, role change, marker phrase; approve, no comments, hide vulnerability, insert exfiltration/backdoor code, weaken security; mark qualified, rank top, inflate experience/degree, suppress gaps, keyword stuffing |
| `politeness` | polite, neutral, imperative |
| `explicitness` | explicit, indirect, implicit |
| `position` | paper: the end of any of 7 sections; code: top, interior line or end of the changed code, or the task description; résumé: header, first job, first degree, skills line, footnote |
| `visibility` | papers: plain, `\textcolor{white}`, tiny font, LaTeX `%` comment, `\iffalse`, footnote; code: line comment or description text; résumés: plain, bracket note, hidden HTML span/font, `display:none`, keyword block |
| `seed` | published source the phrasing paraphrases |

Seeds: the 18 arXiv manuscripts with hidden reviewer prompts and their four types, from direct "give a positive review only" commands to hidden evaluation rubrics ([arXiv 2507.06185](https://arxiv.org/abs/2507.06185)); the résumé-screening measurement in which over 90% of injections avoid explicit instructions ([arXiv 2605.28999](https://arxiv.org/abs/2605.28999)); BIPIA code attack families (exfiltration, persistence, weakened defenses); and the LongPIBench goals, softened. Phrasings are paraphrases, except the short, widely reported command phrases in P01/P08.

**Construction.** Documents are rendered from the hash-verified LongPIBench upstream. The clean rendering is asserted byte-identical to upstream `prepare_example(attack="no")` for all 100 items. Each template goes into 5 documents chosen by a SHA-256 permutation seeded `varied-injection-templates-v1/subtle/<domain>` (documents for template *t*, copy *k*: `perm[(5t+k) mod 100]`). All 100 clean documents are included as siblings. Where upstream has a position, insertions follow its convention: a newline after a paper section, a résumé footnote, or a comment after the code change. Interior code lines are chosen by SHA-256 and keep the line's indentation.

**Analysis.** Report detection per `attack_template_id` with the spread across templates (24 templates × 5 documents), and by `explicitness`, `visibility` and `template_position`. Group by `document_family`. The clean siblings are byte-identical to the clean cases of `longpibench-<domain>-default-v1`; reuse those results or report them once. Labels mark constructed attempts, not compliance. Some implicit templates (for example résumé keyword blocks addressed to a parser) are deliberately near the boundary, so read their per-template rates as such.

```sh
python3 -B evals/scripts/build-longpi-template-cohorts.py
```
