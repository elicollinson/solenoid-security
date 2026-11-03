/**
 * Pre-run drift gate for the abliterated-builds low run (#23 stage 1). Read-only; appends one line to progress.log.
 *   bun gate.ts <heretic-ara|huihui> <test> <n>
 * The first n finished cases of <test> for the build are compared with the vanilla-low checkpoint (PR #51) and, where the
 * case IDs overlap, the build's own xhigh pilot checkpoint (O53). Pass requires: n cases finished; prompt_tokens equal to
 * vanilla-low on n/n (same embedded template); prompt_tokens equal to the pilot xhigh - 12 on every overlapping case (the
 * low signature); response model, Q8_0 quant and loaded GGUF file equal to the build on every response; <= 1 abstention.
 * Outcome agreement with vanilla-low and draft-token presence are reported, not required. Exit 1 on failure.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILDS, buildFile, EXPECTED_PROMPT_DELTA_VS_PILOT_XHIGH, extract, FINISHED, identityOk, pilotFile, RUN_DIR, vanillaFile, type Build } from "./rows.js";

const [build, test, nArg] = process.argv.slice(2) as [Build, string, string];
const n = Number(nArg);
const log = (line: string) => { appendFileSync(resolve(RUN_DIR, "progress.log"), line + "\n"); console.log(line); };
const now = () => new Date().toISOString();
if (!(build in BUILDS)) { log(`GATE_ERROR|${now()}|bad build ${build}`); process.exit(1); }
const run = extract(buildFile(build, test)), van = extract(vanillaFile(test)), pilot = extract(pilotFile(build, test));
if (!run || !van) { log(`DRIFT_FAIL|${now()}|${build} ${test}: missing checkpoint`); process.exit(1); }
const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n);
const withUsage = done.filter(r => r.promptTokens !== null);
const ptEq = withUsage.filter(r => r.promptTokens === van.byId.get(r.caseId)?.promptTokens).length;
const overlap = pilot ? withUsage.filter(r => pilot.byId.get(r.caseId)?.promptTokens != null) : [];
const lowSig = overlap.filter(r => r.promptTokens! - pilot!.byId.get(r.caseId)!.promptTokens! === EXPECTED_PROMPT_DELTA_VS_PILOT_XHIGH).length;
const ident = withUsage.filter(r => identityOk(build, r)).length;
const abst = done.filter(r => r.status !== "scored").length;
const agree = done.filter(r => { const v = van.byId.get(r.caseId); return v && v.status === r.status && v.flagged === r.flagged; }).length;
const drafts = withUsage.filter(r => (r.draftTotal ?? 0) > 0).length;
const accept = withUsage.reduce((a, r) => a + (r.draftAccepted ?? 0), 0) / Math.max(1, withUsage.reduce((a, r) => a + (r.draftTotal ?? 0), 0));
const pass = done.length === n && withUsage.length === n && ptEq === n && lowSig === overlap.length && ident === n && abst <= 1;
log(`${pass ? "DRIFT" : "DRIFT_FAIL"}|${now()}|${build} ${test} first ${n}: finished ${done.length}/${n}; prompt_tokens == vanilla-low on ${ptEq}/${n}; low signature (== pilot xhigh ${EXPECTED_PROMPT_DELTA_VS_PILOT_XHIGH}) on ${lowSig}/${overlap.length} overlapping; identity (model, Q8_0, GGUF) ${ident}/${n}; abstentions ${abst}; outcome agreement with vanilla-low ${agree}/${n} (reported); speculative drafts on ${drafts}/${n}, acceptance ${(100 * accept).toFixed(0)}%`);
process.exit(pass ? 0 : 1);
