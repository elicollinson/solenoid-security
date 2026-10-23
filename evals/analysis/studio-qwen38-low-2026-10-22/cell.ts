/**
 * One CELL progress line for a finished cell of the Qwen3.8-low rerun (#33). Read-only; aggregates only.
 *   bun cell.ts <test>
 * Prints cases, abstentions, BA at 0.5 for low and for the frozen xhigh checkpoint (all cases of the cohort), median
 * reasoning tokens and wall seconds, and the prompt_tokens delta check. Exit 1 unless every case finished (scored or a
 * length/output abstention) and the delta is -12 on every case with usage on both sides.
 */
import { EXPECTED_PROMPT_DELTA, extract, FINISHED, frozenFile, lowFile } from "./rows.js";

const test = process.argv[2]!;
const run = extract(lowFile(test)), frozen = extract(frozenFile(test));
if (!run || !frozen) { console.log(`${test}|missing checkpoint`); process.exit(1); }
const finished = run.rows.length === frozen.rows.length && run.rows.every(r => FINISHED.includes(r.status));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const ba = (rows: typeof run.rows) => {
  const sc = rows.filter(r => r.status === "scored"), p = sc.filter(r => r.positive), q = sc.filter(r => !r.positive);
  const parts = [...(p.length ? [p.filter(r => r.flagged).length / p.length] : []), ...(q.length ? [q.filter(r => !r.flagged).length / q.length] : [])];
  return parts.reduce((a, b) => a + b, 0) / parts.length;
};
const both = run.rows.filter(r => r.promptTokens !== null && frozen.byId.get(r.caseId)?.promptTokens != null);
const ok = both.filter(r => r.promptTokens! - frozen.byId.get(r.caseId)!.promptTokens! === EXPECTED_PROMPT_DELTA).length;
const deltaPass = both.length >= 0.95 * run.rows.length && ok === both.length;
console.log(`${test}|cases ${run.rows.length}/${frozen.rows.length}${run.complete ? "" : finished ? " (finished with abstentions)" : " (incomplete)"}; abstentions ${run.rows.filter(r => r.status !== "scored").length} vs xhigh ${frozen.rows.filter(r => r.status !== "scored").length}; BA@0.5 ${ba(run.rows).toFixed(3)} vs xhigh ${ba(frozen.rows).toFixed(3)}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(frozen.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(frozen.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt delta ${EXPECTED_PROMPT_DELTA} on ${ok}/${both.length}`);
process.exit(finished && deltaPass ? 0 : 1);
