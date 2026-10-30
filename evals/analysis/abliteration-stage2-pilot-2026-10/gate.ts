/**
 * Pre-run drift gate for one stage 2 build (#23; Claude Code 2026-10-27). Read-only; appends one line to progress.log.
 *   bun gate.ts <build>
 * The first 24 finished pilot cases of bipia-email-mixed for the build are compared with the build's vanilla full-suite
 * checkpoint on the same caseIds. Pass requires: 24 finished, all with usage; prompt_tokens equal to vanilla on 24/24
 * (same tokenizer and the same served template rendering => identical counts; this is what catches a template or
 * thinking-switch difference); response model, quant and loaded GGUF file equal to the pinned build identity on every
 * response; <= 1 abstention. Outcome agreement, reasoning tokens and drafts are reported, not required. Exit 1 on failure
 * (the chain then skips this build and moves to the next).
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRows, FINISHED, identityOk, median, plan, RUN_DIR, vanillaRows } from "./rows.js";

const build = process.argv[2]!, test: string = plan.drift.test, n: number = plan.drift.cases;
const log = (line: string) => { appendFileSync(resolve(RUN_DIR, "progress.log"), line + "\n"); console.log(line); };
const now = () => new Date().toISOString();
let run, van;
try { run = buildRows(build, test); van = vanillaRows(build, test); } catch (e) { log(`DRIFT_FAIL|${now()}|${build} ${test}: audit error ${String(e).replace(/[|\n]/g, " ").slice(0, 200)}`); process.exit(1); }
if (!run || !van) { log(`DRIFT_FAIL|${now()}|${build} ${test}: missing checkpoint`); process.exit(1); }
const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n);
const withUsage = done.filter(r => r.promptTokens !== null);
const deltas = withUsage.map(r => r.promptTokens! - (van.byId.get(r.caseId)?.promptTokens ?? NaN));
const ptEq = deltas.filter(d => d === 0).length;
const dist = Object.entries(deltas.reduce((a: Record<string, number>, d) => (a[String(d)] = (a[String(d)] ?? 0) + 1, a), {})).map(([k, v]) => `${k}:${v}`).join(",");
const ident = withUsage.filter(r => identityOk(build, r)).length;
const abst = done.filter(r => r.status !== "scored").length;
const agree = done.filter(r => { const v = van.byId.get(r.caseId); return v && v.status === r.status && v.flagged === r.flagged; }).length;
const reas = median(withUsage.map(r => r.reasoningTokens ?? 0)), vreas = median(withUsage.map(r => van.byId.get(r.caseId)?.reasoningTokens ?? 0));
const drafts = withUsage.filter(r => (r.draftTotal ?? 0) > 0).length;
const pass = done.length === n && withUsage.length === n && ptEq === n && ident === n && abst <= plan.gates.driftMaxAbstentions;
log(`${pass ? "DRIFT" : "DRIFT_FAIL"}|${now()}|${build} ${test} first ${n}: finished ${done.length}/${n}; prompt_tokens == vanilla on ${ptEq}/${n} (delta distribution ${dist || "none"}); identity (model, quant, GGUF) ${ident}/${n}; abstentions ${abst}; outcome agreement with vanilla ${agree}/${n} (reported); median reasoning ${reas} vs vanilla ${vreas}; drafts on ${drafts}/${n}`);
process.exit(pass ? 0 : 1);
