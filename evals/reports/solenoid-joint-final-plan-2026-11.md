# Frozen joint-final detector on the full suites: run plan

**Recorded before the full run, November 6, 2026.** Run the frozen Qwen3-4B joint weight edit from PR #61 on every
existing baseline and extension dataset, under the eval structure used for the other Studio models.

- **Cases.** All 21 baseline and 14 extension datasets, 14,085 cases, with the same tests and revisions as the frozen
  Studio Q8 suites (`dryrun.tsv`).
- **Engine.** `solenoid-joint-final-score-batch-v4`: a new `score_batch` engine with one text per `POST /score_batch`
  request. Every response must report the pinned protocol, base identity and manifest
  (`21b61117…b757c7`), or the run halts.
- **Input and decision.** The whole last external turn (`full-last-external-v1`) and score > 0.5
  (`max-score-gt-05-v1`), the same as the other models' `full` condition. The prompt is fixed by the server, not the
  frozen score-only prompt, and there is no reasoning or temperature setting.
- **Execution.** Four concurrent requests, matching the server's 4 workers; this is recorded as `clientConcurrency`
  in every checkpoint. The operator verified the 4-worker path against the original scorer (350 of 350).
- **Abstentions.** Only the server's "Input exceeds fixed token budget" item error (32,768 tokens). These are excluded
  from balanced accuracy and reported separately. Any other item error halts or retries.
- **Before the run.** Two 40-case samples were scored (`longpi-paper`, `agentdyn-github`) to test the path. They stay in
  separate `-limit40` checkpoints and are not results. Their 80 cases also give a repeatability check against the full run.

## Comparability limits

- Datasets from the same families (BIPIA, LongPI, web, code, tables, email) were used to develop and check this edit, so
  high scores on them do not show generalization on their own.
- The endpoint runs 4-worker server code that is not in PR #61, which has only the single-worker `/score`.
- The operator reports that decisions can flip on rounding-level numeric differences, so these scores apply only to this
  exact serving path. The server also caches exact duplicate inputs, so duplicates and the repeatability check may be
  served from the cache.
- Unpatched Qwen3-4B has no full-suite results in this repo, so there is no paired baseline for the edit here.
