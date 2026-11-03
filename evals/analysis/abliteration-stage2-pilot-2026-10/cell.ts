/**
 * One CELL progress line for a finished stage 2 cell (#23; Claude Code 2026-10-27). Read-only; aggregates only.
 *   bun cell.ts <build> <test>
 * Exit 1 (the chain skips the rest of this build) unless every pilot case finished, prompt_tokens equal vanilla on every
 * case with usage on both sides (>= 95% coverage), every response carries the pinned identity, and the abstention rate
 * does not exceed vanilla's on the same caseIds by more than 2 percentage points (pre-registered).
 */
import { ABSTENTION_HALT, ba, buildRows, correct, ctx, FINISHED, identityOk, median, plan, vanillaRows } from "./rows.js";

const [build, test] = process.argv.slice(2) as [string, string];
const run = buildRows(build, test), van = vanillaRows(build, test);
if (!run || !van) { console.log(`${build}/${test}|missing checkpoint`); process.exit(1); }
const want = ctx(build).caseIds.get(test)!.size;
const finished = run.rows.length === want && run.rows.every(r => FINISHED.includes(r.status));
const both = run.rows.filter(r => r.promptTokens !== null && van.byId.get(r.caseId)?.promptTokens != null);
const ptEq = both.filter(r => r.promptTokens === van.byId.get(r.caseId)!.promptTokens).length;
const ptPass = both.length >= plan.gates.cellPromptTokenCoverage * run.rows.length && ptEq === both.length;
const resp = run.rows.filter(r => r.responseModel !== null);
const ident = resp.filter(r => identityOk(build, r)).length;
const ab = run.rows.filter(r => r.status !== "scored").length, vab = van.rows.filter(r => r.status !== "scored").length;
const abPass = ab / Math.max(1, run.rows.length) <= vab / Math.max(1, van.rows.length) + ABSTENTION_HALT;
const paired = run.rows.filter(r => r.status === "scored" && van.byId.get(r.caseId)?.status === "scored");
const lost = paired.filter(r => correct(van.byId.get(r.caseId)!) && !correct(r)).length, gained = paired.filter(r => !correct(van.byId.get(r.caseId)!) && correct(r)).length;
console.log(`${build}/${test}|cases ${run.rows.length}/${want}${finished ? "" : " (incomplete)"}; abstentions ${ab} vs vanilla ${vab}${abPass ? "" : " ABSTENTION_HALT"}; BA@0.5 ${ba(run.rows).toFixed(3)} vs vanilla ${ba(van.rows).toFixed(3)}; matched ${paired.length}: lost ${lost} gained ${gained}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(van.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(van.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt_tokens == vanilla ${ptEq}/${both.length}; identity ${ident}/${resp.length}`);
process.exit(finished && ptPass && ident === resp.length && abPass ? 0 : 1);
