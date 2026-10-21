/**
 * One CELL progress line for a finished ablation cell (#33). Read-only; aggregates only.
 *   bun cell.ts <condition> <test>
 * Prints: cases, abstentions, BA at 0.5 for this arm and the frozen xhigh arm on the same cases, median reasoning
 * tokens and wall seconds, and the prompt_tokens delta check. Exit 1 unless every case ID finished (scored or a length/output
 * abstention; a cell with abstentions has no complete marker, as in the frozen runs). Fixed 2026-10-20 22:1x UTC after
 * it halted the queue on bipia-table-mixed (3 abstentions): the first version required the complete marker.
 */
import { ablationFile, extract, frozenArm, PLAN } from "./rows.js";

const [condition, testId] = process.argv.slice(2);
const cond = PLAN.conditions.find((c: any) => c.id === condition);
const run = extract(ablationFile(testId!, condition!));
if (!cond || !run) { console.log(`missing ${condition} ${testId}`); process.exit(1); }
const frozen = frozenArm(testId!);
const finished = run.complete || run.rows.length === frozen.rows.length && run.rows.every(r => ["scored", "length_abstention", "output_abstention"].includes(r.status));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const ba = (rows: typeof run.rows) => {
  const sc = rows.filter(r => r.status === "scored"), p = sc.filter(r => r.positive), q = sc.filter(r => !r.positive);
  const parts = [...(p.length ? [p.filter(r => r.flagged).length / p.length] : []), ...(q.length ? [q.filter(r => !r.flagged).length / q.length] : [])];
  return parts.reduce((a, b) => a + b, 0) / parts.length;
};
const delta = PLAN.expectedPromptTokenDelta[cond.reasoningEffort];
const ok = run.rows.filter(r => r.promptTokens !== null && r.promptTokens - (frozen.byId.get(r.caseId)?.promptTokens ?? NaN) === delta).length;
const same = run.rows.map(r => frozen.byId.get(r.caseId)!);
console.log(`${condition}|${testId}|cases ${run.rows.length}${run.complete ? "" : finished ? " (finished with abstentions)" : " (incomplete)"}; abstentions ${run.rows.filter(r => r.status !== "scored").length}; BA@0.5 ${ba(run.rows).toFixed(3)} vs frozen xhigh ${ba(same).toFixed(3)}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(same.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(same.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt delta ${delta} on ${ok}/${run.rows.length}`);
process.exit(finished ? 0 : 1);
