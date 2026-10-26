/**
 * Queue gates for the Qwen3.8 effort ablation (#33). Read-only; appends one line to progress.log. Pre-registered in
 * evals/reports/qwen38-effort-ablation-plan-2026-10.md.
 *
 *   bun gate.ts drift <condition>                 explicit-xhigh re-run of the first n caseIds of every test vs the frozen
 *                                                 checkpoint. Pass: prompt_tokens equal on every case AND outcome (status
 *                                                 and flag at 0.5) agrees on >= 95% of cases. Else exit 1 (halt).
 *   bun gate.ts mechanism <condition> <test> <n>  first n cases of a medium/low arm. Pass: prompt_tokens == frozen + the
 *                                                 plan's delta on every case AND <= 3 abstentions. Else exit 1 (halt).
 * Exit 1 also when fewer than the required cases finished.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ablationFile, extract, frozenArm, PLAN, RUN_DIR, SUITE } from "./rows.js";

const progress = resolve(RUN_DIR, "progress.log");
const now = () => new Date().toISOString();
const log = (line: string) => { appendFileSync(progress, line + "\n"); console.log(line); };
const [mode, condition, testArg, nArg] = process.argv.slice(2);
const cond = PLAN.conditions.find((c: any) => c.id === condition);
if (!cond || !["drift", "mechanism"].includes(mode ?? "")) { console.error("usage: gate.ts drift <condition> | mechanism <condition> <test> <n>"); process.exit(2); }
const delta = PLAN.expectedPromptTokenDelta[cond.reasoningEffort] as number;
const tests: string[] = mode === "drift" ? SUITE.tests.map((t: any) => t.id) : [testArg!];
const n = mode === "drift" ? PLAN.driftPerTest : Number(nArg);
let total = 0, tokensOk = 0, agree = 0, identical = 0, abst = 0, sameScore = 0;
const deltas = new Map<number, number>();
for (const testId of tests) {
  const run = extract(ablationFile(testId, condition));
  const ids: string[] = SUITE.tests.find((t: any) => t.id === testId).caseIds.slice(0, n);
  const done = ids.map(id => run?.byId.get(id)).filter(r => r && ["scored", "length_abstention", "output_abstention"].includes(r.status));
  if (done.length < ids.length) { log(`GATE_ERROR|${now()}|${mode} ${condition} ${testId}: ${done.length}/${ids.length} finished`); process.exit(1); }
  const frozen = frozenArm(testId);
  for (const r of done) {
    const f = frozen.byId.get(r!.caseId)!;
    total++;
    const d = (r!.promptTokens ?? NaN) - (f.promptTokens ?? NaN);
    deltas.set(d, (deltas.get(d) ?? 0) + 1);
    if (d === delta) tokensOk++;
    if (r!.status === f.status && r!.flagged === f.flagged) agree++;
    if (r!.status === "scored" && f.status === "scored" && r!.score === f.score) sameScore++;
    if (r!.finalAnswer !== null && r!.finalAnswer === f.finalAnswer) identical++;
    if (r!.status !== "scored") abst++;
  }
}
const dist = [...deltas].map(([d, c]) => `${d}:${c}`).join(",");
const summary = `${condition} (${cond.reasoningEffort}) ${mode === "drift" ? `drift ${tests.length} tests x first ${n}` : `${testArg} first ${n}`}: prompt_tokens delta vs frozen == ${delta} on ${tokensOk}/${total} (dist ${dist}); outcome agreement ${agree}/${total}; identical scores ${sameScore}/${total}; identical final answers ${identical}/${total}; abstentions ${abst}`;
const pass = mode === "drift" ? tokensOk === total && agree >= Math.ceil(0.95 * total) : tokensOk === total && abst <= 3;
log(`${pass ? (mode === "drift" ? "DRIFT" : "MECHANISM") : (mode === "drift" ? "DRIFT_FAIL" : "MECHANISM_FAIL")}|${now()}|${summary}`);
process.exit(pass ? 0 : 1);
