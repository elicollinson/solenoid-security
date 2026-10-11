/**
 * Queue gates for the abliteration pilot (Claude Code 2026-10-11). Read-only; appends one line to progress.log.
 *
 *   bun gate.ts drift   <condition> <test> <n>   vanilla re-run vs the frozen baseline outputs on the same first n cases.
 *                                                Exit 0 if >= n-2 cases agree on outcome (status and flag), else 1 (halt).
 *   bun gate.ts qualify <condition> <test> <n>   first n cases of a new model. Exit 0 if <= 3 length/output
 *                                                abstentions, else 10 (queue skips this model).
 * Exit 1 also when fewer than n cases finished or any case is unresolved (inspect before resuming).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkpointPath, extractCheckpoint, pilotSuite, VANILLA_BASELINE_CONDITION } from "./pilot-rows.js";

const dir = import.meta.dir;
const progress = process.env.PILOT_PROGRESS_LOG ?? resolve(dir, "progress.log");
const [mode, condition, testId, nText] = process.argv.slice(2);
const n = Number(nText);
const now = () => new Date().toISOString();
const log = (line: string) => { appendFileSync(progress, line + "\n"); console.log(line); };
const test = pilotSuite().tests.find(t => t.id === testId);
if (!["drift", "qualify"].includes(mode ?? "") || !condition || !test || !Number.isSafeInteger(n) || n < 1) { console.error("usage: gate.ts drift|qualify <condition> <test> <n>"); process.exit(2); }
const run = extractCheckpoint(resolve(process.env.PILOT_CHECKPOINT_DIR ?? dir, test.id, `${condition}.jsonl`), condition, test);
if (!run) { log(`GATE_ERROR|${now()}|${mode} ${condition}: checkpoint missing`); process.exit(1); }
const done = run.rows.slice(0, n);
const firstN = new Set(test.caseIds.slice(0, n));
if (done.length < n || run.unfinished.some(id => firstN.has(id))) { log(`GATE_ERROR|${now()}|${mode} ${condition}: ${done.length}/${n} finished; unfinished ${run.unfinished.length}`); process.exit(1); }
if (mode === "qualify") {
  const abst = done.filter(r => r.status !== "scored").length, length = done.filter(r => r.status === "length_abstention").length;
  const reasoning = done.map(r => r.reasoningTokens ?? 0);
  const summary = `${condition} ${test.id} first ${n}: abstentions ${abst} (length ${length}); flags ${done.filter(r => r.flagged).length}; median reasoning ${[...reasoning].sort((a, b) => a - b)[Math.floor(n / 2)]}; max ${Math.max(...reasoning)}`;
  if (abst <= 3) { log(`QUALIFIED|${now()}|${summary}`); process.exit(0); }
  log(`QUALIFY_FAIL|${now()}|${summary}; rule <= 3 abstentions`); process.exit(10);
}
const base = extractCheckpoint(checkpointPath("", test.id, VANILLA_BASELINE_CONDITION), "baseline", test);
if (!base) { log(`GATE_ERROR|${now()}|drift: baseline checkpoint missing`); process.exit(1); }
const byId = new Map(base.rows.map(r => [r.caseId, r]));
let agree = 0, identical = 0;
for (const r of done) {
  const b = byId.get(r.caseId)!;
  if (b.status === r.status && b.flagged === r.flagged) agree++;
  if (run.finalAnswers.get(r.caseId) !== undefined && run.finalAnswers.get(r.caseId) === base.finalAnswers.get(r.caseId)) identical++;
}
const driver = resolve(dir, "driver.ndjson");
const version = existsSync(driver) ? readFileSync(driver, "utf8").trim().split("\n").map(l => JSON.parse(l)).reverse().find(e => e.value?.lmStudioVersion)?.value.lmStudioVersion : undefined;
const line = `${condition} vs frozen baseline, ${test.id} first ${n}: outcome agreement ${agree}/${n}; identical final answers ${identical}/${n}; LM Studio ${version ? `${version.version} build ${version.build}` : "unknown"} (baseline 0.4.25 build 1)`;
if (agree >= n - 2) { log(`DRIFT|${now()}|${line}`); process.exit(0); }
log(`DRIFT_FAIL|${now()}|${line}`); process.exit(1);
