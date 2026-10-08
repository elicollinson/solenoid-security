# In-page web small-chunk evaluation

The web cohort has 240 labeled injection attempts and 240 reviewed benign context windows. These are stored excerpts, not entire web pages. The small-chunk experiment selects the last external turn and uses seeded random, nonoverlapping word chunks with minimum 2 words, maximum 7, 14, or 21 words, seed `20260926`, and `xor_case_ordinal_v1` derivation. A final remainder can contain one word. The historical positive-cohort 7-word method used that seed derivation; the historical NotInject benign cohort used a different one. These web segments are a newly pinned plan, not historical observations.

In a fresh checkout, run `bun run eval:fetch-public` first to regenerate the ignored web JSONL from its pinned public source. See `datasets/PUBLIC_SOURCES.md`.

| Maximum words | Segments across 480 cases |
| ---: | ---: |
| 7 | 6,668 |
| 14 | 3,888 |
| 21 | 3,564 |

Each segment retains its source turn ID, index, word offsets, and text hash. The `max-score-gt-0.5` rule flags a case when any segment's raw score exceeds 0.5. Thresholds can be replayed from saved observations without provider calls; a different chunk plan needs new inference.

`suites/prompt-injection-web-small-chunks-v1.json` holds the Jev conditions and the original direct-chat Gemma tool-call conditions. The tool-call Gemma 7-word run is incomplete because a short fragment elicited plain text instead of the required tool call. Do not treat that partial checkpoint as a case-level result.

`suites/prompt-injection-web-small-chunks-json-v1.json` is a separate rationale-bearing Gemma JSON-schema protocol. Its full-window and 21-word conditions completed, but the 7- and 14-word checkpoints remain incomplete after provider failures. These protocols are not mixed in an analysis.

For the complete Gemma comparison, use `suites/prompt-injection-web-small-chunks-scoreonly-v1.json`. It pins the same Gemma 4 31B model and DeepInfra provider with a distinct score-only JSON-schema prompt, a 64-token output cap, and a matched full-window condition. All four score-only conditions completed. Raw responses and aggregate analyses are ignored under `evals/runs/`; preserve the engine ID and prompt hash when comparing results. The score-only full-window result is not interchangeable with the earlier tool-call Gemma full-window result.

The web benign sample intentionally favors attack-adjacent hard negatives. Report detection and false-positive rates separately, with counts and call volume; do not treat the sample as a prevalence estimate.
