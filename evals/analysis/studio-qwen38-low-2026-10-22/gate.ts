/**
 * Pre-run drift and mechanism gates for the Qwen3.8-low full-suite rerun (#33). Read-only; appends one line to progress.log.
 *
 *   bun gate.ts drift <test> <n>       first n finished cases of <test> in the new run, compared with (a) the frozen xhigh
 *                                      checkpoint and (b) the PR #49 low arm where the case IDs overlap.
 *                                      Pass: n cases finished; prompt_tokens == frozen + (-12) on every case; prompt_tokens
 *                                      == #49 low on every overlapping case; >= 20 overlapping cases; outcome (status and
 *                                      flag at 0.5) agrees with #49 low on >= 90% of them. Exact final-answer and score
 *                                      reproduction is reported, not required (#49's own xhigh drift: 98/100 answers).
 *   bun gate.ts mechanism <test> <n>   first n finished cases: prompt_tokens == frozen - 12 on every case, <= 3 abstentions.
 * Exit 1 on failure (the queue halts).
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ablationLowFile, EXPECTED_PROMPT_DELTA, extract, FINISHED, frozenFile, lowFile, RUN_DIR } from "./rows.js";

const [mode, test, nArg] = process.argv.slice(2);
const n = Number(nArg);
const log = (line: string) => { appendFileSync(resolve(RUN_DIR, "progress.log"), line + "\n"); console.log(line); };
const now = () => new Date().toISOString();
const run = extract(lowFile(test!)), frozen = extract(frozenFile(test!));
if (!run || !frozen || !["drift", "mechanism"].includes(mode!)) { log(`GATE_ERROR|${now()}|${mode} ${test}: missing checkpoint or bad mode`); process.exit(1); }
const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n);
if (done.length < n) { log(`GATE_ERROR|${now()}|${mode} ${test}: ${done.length}/${n} finished`); process.exit(1); }
const deltaOk = done.filter(r => r.promptTokens !== null && r.promptTokens - (frozen.byId.get(r.caseId)?.promptTokens ?? NaN) === EXPECTED_PROMPT_DELTA).length;
const abst = done.filter(r => r.status !== "scored").length;
let pass = deltaOk === n, extra = "";
if (mode === "drift") {
  const prior = extract(ablationLowFile(test!));
  const overlap = done.filter(r => prior?.byId.has(r.caseId));
  const p = (r: typeof done[number]) => prior!.byId.get(r.caseId)!;
  const ptSame = overlap.filter(r => r.promptTokens === p(r).promptTokens).length;
  const agree = overlap.filter(r => r.status === p(r).status && r.flagged === p(r).flagged).length;
  const sameScore = overlap.filter(r => r.status === "scored" && p(r).status === "scored" && r.score === p(r).score).length;
  const sameAnswer = overlap.filter(r => r.finalAnswer !== null && r.finalAnswer === p(r).finalAnswer).length;
  const sameReasoning = overlap.filter(r => r.reasoningTokens === p(r).reasoningTokens).length;
  pass = pass && overlap.length >= 20 && ptSame === overlap.length && agree >= Math.ceil(0.9 * overlap.length);
  extra = `; vs #49 low on ${overlap.length} overlapping: prompt_tokens equal ${ptSame}/${overlap.length}, outcome agreement ${agree}/${overlap.length}, identical scores ${sameScore}/${overlap.length}, identical final answers ${sameAnswer}/${overlap.length}, identical reasoning-token counts ${sameReasoning}/${overlap.length}`;
} else pass = pass && abst <= 3;
log(`${pass ? mode.toUpperCase() : mode.toUpperCase() + "_FAIL"}|${now()}|${test} first ${n}: prompt_tokens == frozen xhigh ${EXPECTED_PROMPT_DELTA} on ${deltaOk}/${n}; abstentions ${abst}${extra}`);
process.exit(pass ? 0 : 1);
