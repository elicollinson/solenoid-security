/**
 * One CELL progress line for a finished cell of the abliterated-builds low run (#23 stage 1). Read-only; aggregates only.
 *   bun cell.ts <heretic-ara|huihui> <test>
 * Prints cases, abstentions, BA at 0.5 for the build and vanilla-low (all cases of the cohort), the matched-case
 * discordance vs vanilla-low, median reasoning tokens and wall seconds, the prompt_tokens equality check, the identity
 * check and speculative-decoding acceptance. Exit 1 (the queue halts) unless every case finished, prompt_tokens equal
 * vanilla-low on every case with usage on both sides (>= 95% coverage), every response carries the build's identity, and
 * the abstention rate does not exceed vanilla-low's rate on the cohort by more than 2 percentage points (pre-registered).
 */
import { ABSTENTION_HALT, ba, buildFile, extract, FINISHED, identityOk, median, vanillaFile, type Build } from "./rows.js";

const [build, test] = process.argv.slice(2) as [Build, string];
const run = extract(buildFile(build, test)), van = extract(vanillaFile(test));
if (!run || !van) { console.log(`${build}/${test}|missing checkpoint`); process.exit(1); }
const finished = run.rows.length === van.rows.length && run.rows.every(r => FINISHED.includes(r.status));
const both = run.rows.filter(r => r.promptTokens !== null && van.byId.get(r.caseId)?.promptTokens != null);
const ptEq = both.filter(r => r.promptTokens === van.byId.get(r.caseId)!.promptTokens).length;
const ptPass = both.length >= 0.95 * run.rows.length && ptEq === both.length;
const resp = run.rows.filter(r => r.responseModel !== null);
const ident = resp.filter(r => identityOk(build, r)).length;
const ab = run.rows.filter(r => r.status !== "scored").length, vab = van.rows.filter(r => r.status !== "scored").length;
const abRate = ab / Math.max(1, run.rows.length), vabRate = vab / Math.max(1, van.rows.length);
const abPass = abRate <= vabRate + ABSTENTION_HALT;
const paired = run.rows.filter(r => r.status === "scored" && van.byId.get(r.caseId)?.status === "scored");
const correct = (r: { positive: boolean; flagged: boolean | null }) => r.flagged === r.positive;
const lost = paired.filter(r => correct(van.byId.get(r.caseId)!) && !correct(r)).length, gained = paired.filter(r => !correct(van.byId.get(r.caseId)!) && correct(r)).length;
const dT = resp.reduce((a, r) => a + (r.draftTotal ?? 0), 0), dA = resp.reduce((a, r) => a + (r.draftAccepted ?? 0), 0);
console.log(`${build}/${test}|cases ${run.rows.length}/${van.rows.length}${run.complete ? "" : finished ? " (finished with abstentions)" : " (incomplete)"}; abstentions ${ab} vs vanilla-low ${vab}${abPass ? "" : " ABSTENTION_HALT"}; BA@0.5 ${ba(run.rows).toFixed(3)} vs vanilla-low ${ba(van.rows).toFixed(3)}; matched ${paired.length}: lost ${lost} gained ${gained}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(van.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(van.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt_tokens == vanilla-low ${ptEq}/${both.length}; identity ${ident}/${resp.length}; drafts ${resp.filter(r => (r.draftTotal ?? 0) > 0).length}/${resp.length}, acceptance ${(100 * dA / Math.max(1, dT)).toFixed(0)}%`);
process.exit(finished && ptPass && ident === resp.length && abPass ? 0 : 1);
