# Abliteration extension, stage 3: pre-registered full-suite runs of the stage 2 candidates (2026-11-03)

Status: **frozen before any stage 3 inference.** Issue [#23](https://github.com/elicollinson/solenoid-security/issues/23),
FINDINGS O53. The user approved stage 3 on 2026-11-03. Stage 2's pre-registration
([plan](abliteration-stage2-plan-2026-10.md), "Decision") made builds with a Holm-significant loss or |ΔBA| ≥ 0.05 on the
998-case pilot candidates for a full-suite stage 3. This plan runs those candidates on the full Studio baseline (21
datasets) and extension (14 datasets) suites, 14,085 cases per build. Each build is compared with **its own vanilla
model's frozen Studio Q8 checkpoints on identical cases. No vanilla model is rerun.** Stage 1
([plan](studio-qwen38-abliterated-low-plan-2026-10.md), PR #57) did the same for the two Qwen3.8 builds and is the
template. This branch is stacked on PR #57, because the runner's load-time template pin and `--tolerate-instance` are
there.

- Plan, builds, pins and gates: [`analysis/abliteration-stage3-full-2026-11/plan.json`](../analysis/abliteration-stage3-full-2026-11/plan.json)
- Candidate rule applied: [`candidates.py`](../analysis/abliteration-stage3-full-2026-11/candidates.py) →
  [`results/candidates.json`](../analysis/abliteration-stage3-full-2026-11/results/candidates.json)
- Vanilla audit: `s3.ts vanilla-audit` → [`results/vanilla-audit.json`](../analysis/abliteration-stage3-full-2026-11/results/vanilla-audit.json)
- Suites (committed): `suites/prompt-injection-lmstudio-studio-abliteration-stage3-full-q8-t4096-<build>-{baseline,extension}-v1.json`
- Chain: [`run-chain.sh`](../analysis/abliteration-stage3-full-2026-11/run-chain.sh), with `s3.ts` (suites, probe, pin and HF
  checks, dry run, gate, cell, summary) and `mock-runner.ts` (offline chain test only)
- Run directory (git-ignored): `evals/runs/abliteration-stage3-full-2026-11/`, with `progress.log` and `chain.log`

## Candidates (stage 2 rule, computed from the stage 2 checkpoints)

`candidates.py` reads the MODEL_DONE lines that stage 2's `summarize.ts` and the deviation `dev.ts` computed from the
checkpoints. These use a two-sided exact McNemar on both-scored cases and macro BA with equal dataset weights. The script
then applies the rule. The primary Holm family is the 7 completed pre-registered builds.

| Build | Pilot ΔBA | Lost / gained | p | Holm p | Rule met by | Stage 3 |
|---|---:|---:|---:|---:|---|---|
| gemma26-ultra | −0.226 | 243 / 9 | 2.8e-60 | 2.0e-59 | both | yes |
| gemma31-huihui (v2) | −0.156 | 177 / 13 | 6.1e-38 | 3.7e-37 | both | yes |
| gemma26-huihui | −0.147 | 154 / 12 | 1.4e-32 | (8.5e-32)† | both† | yes, **flagged: deviation rerun only** |
| gemma26-heretic | −0.141 | 156 / 10 | 7.6e-35 | 3.8e-34 | both | yes |
| muse-heretic | −0.062 | 83 / 19 | 1.0e-10 | 3.1e-10 | both | yes |
| gemma31-heretic | −0.055 | 68 / 11 | 3.5e-11 | 1.4e-10 | both | yes |
| qwen36-huihui | −0.027 | 70 / 43 | 1.4e-2 | 2.8e-2 | Holm only | yes |
| qwen36-heretic | −0.017 | 51 / 35 | 1.1e-1 | 1.1e-1 | — | no |
| qwen38-mpoa | +0.015† | 20 / 35 | 5.8e-2 | (1.2e-1)† | — | no (a gain) |

† gemma26-huihui and qwen38-mpoa were stopped in the pre-registered screen by its abstention rule. Their numbers come
from the declared-deviation rerun (abstention rule report-only). The Holm value in parentheses comes from the
sensitivity family that adds them (9 builds). gemma26-huihui qualifies only through that rerun and is therefore included
but **flagged** in every stage 3 table. qwen36-huihui qualifies by the Holm clause alone (|ΔBA| < 0.05). Both readings of
the family make it significant (0.028 and 0.042), so it is included. The UD-Q8_K_XL robustness arm was dropped in
stage 2 and never ran.

## Design

- **Cases.** Each build runs the full baseline suite `prompt-injection-lmstudio-studio-baseline-q8-t4096-v1` (21
  datasets, 7,326 cases) and the extension suite `…-extension-v1` (14 datasets, 6,759 cases). Tests, input strategies
  and decision rules are copied JSON-identical, and `s3.ts suites` checks this. The two suites are never pooled in the
  primary analysis.
- **Vanilla side.** These are frozen checkpoints in `studio-baseline-t4096-2026-10-07` and
  `studio-extension-t4096-2026-10-13`, conditions `baseline-<vanilla>-t4096-full`:

  | Vanilla | Engine key | Builds |
  |---|---|---|
  | Gemma 4 26B-A4B | `gemma26-q8` | gemma26-ultra, gemma26-heretic, gemma26-huihui |
  | Gemma 4 31B-it | `gemma31-q8` | gemma31-huihui, gemma31-heretic |
  | Muse Glimmer 30B | `muse-q8` | muse-heretic |
  | Qwen3.6 35B-A3B | `qwen36-35b-a3b-q8` | qwen36-huihui |

  The one exception is Gemma 31B `encoding-benign-controls-v1`. There the baseline report analyzes the rerun1 checkpoint
  (`baseline-gemma31-q8-t4096-rerun1-full`, L148/L141), and so does this plan. The original checkpoint stays excluded.
- **Vanilla audit (done before this commit).** `s3.ts vanilla-audit` checked all 4 × 35 cohorts with the repo's partial
  auditor (suite, engine, dataset and input hashes):
  - every cohort is complete, with every case finished;
  - every checkpoint's engine equals the suite engine (canonical JSON);
  - the protocol is Q8_0, `temperature: 0`, `max_tokens: 4096`, the score-only prompt, serial, and the vanilla
    `reasoning_effort`.

  Vanilla abstentions over both suites: Gemma 26B 11, Gemma 31B 5, Muse 5, Qwen3.6 5. **No dataset is excluded.**
- **Engine.** Each build's engine is its stage 2 engine **verbatim**: the same engine ID, loaded identifier, inventory
  pin (`modelKey`, `indexedModelIdentifier`, `sizeBytes`, quant) and load-time template override. It is read from the
  stage 2 v1 suite, with the hash checked against the stage 2 `PIN` line. `s3.ts` re-checks that it differs from the
  vanilla engine of both suites only in model identity (plus the unsent template note).
  - **Gemma builds (all five).** These load `evals/analysis/abliteration-stage2-pilot-2026-10/templates/gemma4-vanilla-q8-default-thinking.jinja`
    (SHA-256 `d1465380…6ec5`). It is the vanilla Gemma 4 Q8_0 template with one prepended line defaulting
    `enable_thinking` to true. The file is copied here byte-identically at the same path, so stage 2 and stage 3 share
    one engine. The override changes only the default of a variable the request never sets. It therefore renders the
    vanilla served prompt on every input, not only the 980 pilot inputs that stage 2's template audit checked. The
    per-case prompt-token gate below verifies this online for all 14,085 cases.
  - **Muse and Qwen3.6.** These need no override. Muse's embedded template is the vanilla one. Qwen3.6 huihui's renders
    identically on the pilot inputs; on the remaining inputs the per-case prompt-token gate is the check.
- **Conditions.** `stage3-<stage 2 label>-t4096-full`, equal to the vanilla condition except for ID and engine. Runner
  flags: `--require-device`, `--tolerate-instance=google/gemma-4-26b-a4b-qat`, `--concurrency=1`,
  `--continue-after-output-errors`, native `/api/v0`, context 65,536, parallel 1, timeout 300 s.
- **Fresh data.** The 998 pilot cases are part of the baseline suite and are run again, not reused. The overlap gives a
  replication check against stage 2 at the case level (H3).

## Model availability (Studio inventory, 2026-11-03T19:4xZ)

`s3.ts probe` (the stage 2 `pin.ts` logic, read-only `lms ls --json` through LM Link) found:

- **Present with the exact stage 2 pin:** gemma26-huihui and muse-heretic.
- **Absent:** gemma26-ultra, gemma26-heretic, qwen36-huihui, gemma31-huihui and gemma31-heretic. Their GGUFs were
  removed from the Studio after stage 2. The user may download them again. A re-download is accepted only if it matches
  the stage 2 identity exactly:
  - the inventory entry equals the stage 2 pin on two probes 2 min apart;
  - the HF LFS sha256 and size of the Q8_0 file and the mmproj file that LM Studio counts in `sizeBytes` are unchanged,
    with their last commit before the stage 2 pin. These values are recorded in `plan.json`; all were last committed
    between 2026-04-12 and 2026-08-11.

  Any difference means `SKIP`, never a run.

## Order and estimates

**Preferred order** (pre-registered): fastest and biggest effect first.
1. Tranche A, the Gemma 26B-A4B builds: gemma26-ultra, gemma26-heretic, gemma26-huihui (flagged).
2. Tranche B: qwen36-huihui.
3. Tranche C, the slow 30B-class builds: gemma31-huihui, muse-heretic, gemma31-heretic.

**Rule for absent builds.** At every build boundary the chain runs the **first remaining build in that order that is
present** with its stage 2 identity. Absent builds are deferred and re-probed at each boundary. When nothing remaining
is present, the chain polls every 10 min and gives up the absent builds after 24 h (`SKIP … absent`, not an attempt; a
restart probes them again). With today's inventory the chain therefore starts with **gemma26-huihui, then
muse-heretic**. Any re-downloaded build is picked up at the next boundary in plan order.

**Estimates.** Each build is estimated from its vanilla's summed per-request wall time on the full suites (the "vanilla
wall" column), scaled by the build's own wall time relative to vanilla on the 998 pilot cases. Abliterated Gemma builds
reason 2–3× longer. Loading adds about 1 min per cell (35 per build).

| # | Build | Tranche | Pilot slowdown | Vanilla wall (h) | **Estimate (h)** | ≈ days |
|---:|---|---|---:|---:|---:|---:|
| 1 | gemma26-ultra | A | 2.85× | 16.2 | **46** | 1.9 |
| 2 | gemma26-heretic | A | 2.09× | 16.2 | **34** | 1.4 |
| 3 | gemma26-huihui (flagged) | A | 2.72× | 16.2 | **44** | 1.8 |
| 4 | qwen36-huihui | B | 1.40× | 25.3 | **36** | 1.5 |
| 5 | gemma31-huihui | C | 1.58× | 55.0 | **87** | 3.6 |
| 6 | muse-heretic | C | 1.00× | 56.1 | **56** | 2.3 |
| 7 | gemma31-heretic | C | 1.39× | 55.0 | **77** | 3.2 |
| | **All seven** | | | 256 | **≈ 380 h (≈ 16 days)** | |

Tranche A alone is ≈ 124 h (5.2 days). The first two builds the chain can run today (gemma26-huihui, then
muse-heretic) take ≈ 100 h.

**Stopping by the user (pre-registered).** The user may stop the chain at any build boundary, in particular after
tranche A, with no consequence for the builds already completed. Each completed build is analyzed on its own against
its own vanilla. The Holm family (below) is the set of completed builds. A build stopped mid-way is reported as
partial and is not analyzed. This rule is fixed now, so stopping is not a result-dependent choice of hypotheses.

## Gates and stopping rules

- **Start.** The chain waits until no other LM Studio matrix driver or stage 2 chain is running and the device lock is
  absent (up to 4 h, then it halts). It then needs LM Link connected and no study instance (`solenoid-*`) loaded.
- **The user's own models.** Any untolerated instance that is not a study instance belongs to the user. Before every
  step the chain logs `WAIT` and waits for LM Studio's idle TTL to unload it, for up to 4 h, then halts. **It never
  unloads the user's models.**
- **Local API.** Before every step the chain checks `curl 127.0.0.1:1234/v1/models`. If the API is down it runs
  `lms server start` once, and halts if the API stays down.
- **Identity, per build.** The pin and HF checks above, then an offline dry run of both suites: per test, cases =
  planned calls = the vanilla cohort size, and the matrix lists 21 and 14 cells.
- **Drift gate, per build.** The first 24 baseline `bipia-email-mixed` cases. Pass requires:
  - 24 finished with usage;
  - `prompt_tokens` equal to vanilla on **24/24**;
  - identity (response model, Q8_0, loaded GGUF) on 24/24.

  Abstentions and outcome agreement are reported, not required. On failure: `DRIFT_FAIL`, then `SKIP` the build.
- **Cell check, per dataset.** Binding:
  - every case finished;
  - `prompt_tokens` equal to vanilla on every case with usage on both sides (≥ 95% coverage);
  - identity on every response.

  A failure skips the rest of the build.
- **Abstentions are report-only, from the start.** In stage 2 the +2 pp abstention rule stopped two builds. In both, the
  build itself reasons longer and runs out of budget. That is an effect of the build, not a protocol failure, so stage
  3 does not let it stop a multi-day run.
  - A cell above vanilla + 2 pp is printed as `ABSTENTION_EXCESS`.
  - Only `ABSTENTION_RUNAWAY` (above vanilla + 25 pp on one cell) skips the rest of the build, as a guard against a
    broken runtime.
  - The primary analysis excludes abstentions. A sensitivity analysis counts them as errors.
- **Runner failures (L141).**
  - **Transport failure** (`provider_or_transport_error` on a clean device): the cohort reruns automatically, in full,
    under a fresh condition (`stage3-<label>-r1|r2-t4096-full`; suite `-v2|-v3` of that kind, otherwise
    byte-identical). Before the rerun the chain waits for LM Link plus 5 min. The failed partial is kept and excluded.
    After 2 reruns the chain halts.
  - **Any other non-zero exit:** the build is skipped without resuming it.
  - **Two such builds in a row, or a lock or study model left behind, halt the chain.**
- **Cap.** Per build, 2 × its estimate within one invocation. The rest of the build is then skipped. A cap skip is not an
  attempt: a restart resumes from the completed cells. There is no global cap, because the user's pauses must not drop
  builds (stage 2 amendment 2026-11-03).
- **No reruns for a better result, and no threshold or case changes.** Checkpoints are only ever resumed, never deleted
  or overwritten. A completed, passing cell is not rerun after a restart.

## Hypotheses

The unit is one build on one suite (baseline or extension). Every test is build vs its own vanilla, on the cases scored
in both arms, at threshold 0.5.

- **H1, lower accuracy at full scale (primary).** The exact two-sided McNemar on correct/incorrect, pooled over the
  suite's datasets. Holm runs at α = 0.05 across all completed build × suite tests (≤ 14). Support requires Holm
  p < 0.05 with fewer correct for the build. ΔBA (macro, equal dataset weights) is reported with a 95% paired,
  class-stratified bootstrap. The flagged build gemma26-huihui is in the family. A sensitivity Holm without it is also
  reported.
- **H2, misses rather than false alarms.** Among discordant cases, detections lost on positives exceed false alarms
  added on negatives. The exact sign test on positives only (lost vs gained detections) must be Holm-significant (same
  family construction).
- **H3, replication of the pilot.**
  - (a) **Sign.** For each build and suite, the sign of the full-suite ΔBA equals the sign of the stage 2 pilot ΔBA.
    The prediction is negative for all seven. H3a holds for a build if both suites match.
  - (b) **Size.** The full-suite ΔBA restricted to the 998 pilot caseIds, and the ratio of full-suite to pilot ΔBA,
    are descriptive.
  - (c) **Determinism.** Case-level outcome agreement between stage 3 and stage 2 on the 998 overlapping cases: same
    engine, temperature 0, fresh calls.
- **Secondary and exploratory.** All p-values here are uncorrected unless stated.
  - Per-dataset and per-group McNemar, BA, TPR, FPR and AUROC. The groups are the frozen data types: baseline longdoc,
    email, web, agent, obfusc, benign, policy; extension longdoc, BIPIA, QA, web, agent, email, code.
  - Whether O53's most-affected areas lead at full scale: obfuscation (PIDS obfuscated, the encoding cohorts) and agent
    tool output.
  - Abstentions per dataset, and the abstentions-as-errors sensitivity analysis.
  - Reasoning tokens and wall time.
  - Within Gemma 26B ARA: heretic vs ultra McNemar (card KL 0.0468 vs 0.1237).
  - Method contrasts within a base: huihui vs heretic for Gemma 26B and for Gemma 31B.

**Decision.** O53 generalizes at full scale if at least half of the completed builds show a Holm-significant loss on
both suites, and no build shows a Holm-significant gain.

## Execution

```sh
W=/Users/eli/Documents/Code/solenoid-security/.claude/worktrees/abl-stage3   # feature/abliteration-stage3-full
cd $W && mkdir -p evals/runs/abliteration-stage3-full-2026-11 && nohup zsh evals/analysis/abliteration-stage3-full-2026-11/run-chain.sh \
  >> evals/runs/abliteration-stage3-full-2026-11/chain.log 2>&1 &
tail -f evals/runs/abliteration-stage3-full-2026-11/progress.log
```

Before the real launch, the chain is tested offline with `MOCK_RUN="bun …/mock-runner.ts"`, a scratch run dir and a mock
inventory. The mock writes checkpoints re-bound from the vanilla ones. It never calls a model.

Restart safety:
- a build with `MODEL_DONE`, or with a `SKIP` that counts as an attempt, is not touched again;
- a passed drift gate is not repeated;
- every runner step resumes its own checkpoint.

The analysis (Holm, H2, H3, the write-up) is done offline after each build's `MODEL_DONE`, or after `DONE`.

## Limitations

- The vanilla checkpoints date from 2026-10-07 to 2026-10-13 (LM Studio 0.4.25). Stage 3 runs weeks later. The
  per-case prompt-token gate and the identity check guard the served prompt and the model, but not runtime changes
  inside LM Studio that do not show in the prompt.
- Gemma vanilla is a hub model; the builds are not (as in stage 2).
- Quantizers differ from vanilla's, as in stage 2.
- gemma26-huihui's candidacy rests on a declared-deviation rerun. Its stage 3 result is reported with that flag.
- The Studio GGUF files cannot be hashed from the Mac mini. Identity rests on the inventory pin and the HF blob hashes
  (as in the stage 2 deviation).
- The estimate assumes each build's pilot slowdown holds on all datasets. Long-document datasets may differ. At ≈ 16
  days in total the chain will likely meet user pauses; the waits and the restart rules above handle them.
