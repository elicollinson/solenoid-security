# Batching (parallel-slot) equivalence on the Studio (2026-10-26/27)

Issues [#21](https://github.com/elicollinson/solenoid-security/issues/21) (F5) and, for speculative decoding,
[#52](https://github.com/elicollinson/solenoid-security/issues/52) and [#7](https://github.com/elicollinson/solenoid-security/issues/7).
[Pre-registration](../../reports/batching-equivalence-plan-2026-10.md) (commit `7914c42`, pushed before the first call).
[Report](../../reports/batching-equivalence-2026-10.md). `FINDINGS.md` O69, research log L160.

The study ran from the main checkout, detached at `7914c42`, with these scripts in place (`cwd` = repo root).
Checkpoints, probe outputs and per-case intermediates are in the git-ignored
`evals/runs/batching-equivalence-2026-10-26/`. `work/` holds case IDs, scores, token counts, timings and SHA-256 hashes
of answers and reasoning, never text. Everything published here is a script, the plan, the queue, the progress log
or an aggregate. Aggregates cover **every** arm (p1, p2, p4, p8 and the p4 repeat for both models), whichever arm the
rule adopted.

| File | Role |
|---|---|
| `context-probe.ts`, `memory-estimate.ts` | Pre-freeze probes: K concurrent copies of a synthetic numbered-line prompt (no dataset text) per context × parallel; LM Studio's load-memory estimate per model × level × context. Outputs in the run dir (`context-probe/`, `memory-estimate.json`), summarized in `results/`. |
| `make-suite-constants.ts`, `make-suite.ts` → `evals/suites/…-batching-equivalence-q8-t4096-v1.json` | Ten tests copied byte-for-byte from the frozen suites plus seeded, label-balanced `caseIds` (500 cases). p1 engines are the frozen engines; p2/p4/p8 differ only in id, identifier, `parallel`, `contextLength` and `timeoutMs` (checked by sorted-JSON diff). |
| `make-plan.ts` → `plan.json` | Suite hash and per-cell dry-run case counts. |
| `rows.ts` | Per-case extraction through `auditPartialCheckpoint`, plus answer and reasoning hashes, native timing, the responding model and its loaded instance, and the MTP draft counters. |
| `cell.ts`, `run-chain.sh`, `run-queue.sh`, `queue.txt` | Orchestration: preflight, per-arm completion gate, `CELL` lines, the 5 h cap. |
| `progress.log` | The run's progress log with the `PS` lines (LM Studio inventory snapshots, which name the user's resident assistant model) removed. Nothing else differs. |
| `extract.ts` | Per-case rows for all arms and the frozen checkpoints to `work/cases.json` and per-test spans to `work/spans.json`. **Not published** (case IDs). |
| `analyze.py` → `results/batching-results.json` | The pre-registered analysis: throughput, latency, agreement, ΔBA (bootstrap) and exact McNemar vs p1, abstentions, drift vs frozen, determinism (p4 repeat), probes and memory estimates, the adoption rule. Added after the run, outside the plan: the identity check (every response came from the study's own loaded instance), MTP draft acceptance per arm (#52) and throughput by length band. |

Reproduce (from the main checkout; offline, no model calls):

```sh
A=.claude/worktrees/batching/evals/analysis/batching-equivalence-2026-10   # or evals/analysis/... once merged
DATA_ROOT=$PWD bun $A/extract.ts
uv run --no-project --python 3.12 --with numpy --with scipy $A/analyze.py
```

`analyze.py` also counts the resident assistant model's requests inside each arm's span from the LM Studio server logs
on this Mac (`~/.lmstudio/server-logs/2026-10/`); without those logs the counts are zero and nothing else changes.

There were no deviations from the plan's endpoints or rule. Qwen3.8 p8 ran at the pre-declared 196,608 context.
