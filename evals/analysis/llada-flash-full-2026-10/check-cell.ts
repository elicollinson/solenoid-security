/**
 * Post-cell abstention check for the pre-registered Flash run (plan.json stoppingRules). Reads one checkpoint (no
 * audit, counts only) and prints one ABST line. Primary case abstention: no valid (scored) segment for the case, which
 * is the ignoreInvalid policy for windows and plain abstention for full text. Strict: any abstained segment.
 * Exit 3 when the primary rate exceeds 10% on a declared window cohort (the queue then halts), exit 0 otherwise;
 * a rate above 10% elsewhere prints FLAG for the ABSTENTION_FLAG line.
 * Usage (repo root): bun <this file> <suite path> <condition> <test>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../../..");
const [suitePath, condition, test] = process.argv.slice(2) as [string, string, string];
const suite = JSON.parse(readFileSync(resolve(root, suitePath), "utf8"));
const plan = JSON.parse(readFileSync(resolve(import.meta.dir, "plan.json"), "utf8"));
const lines = readFileSync(resolve(root, `evals/runs/${suite.id}/${test}/${condition}.jsonl`), "utf8").trimEnd().split("\n").map(l => JSON.parse(l));
const meta = lines[0].value as { expectedCases: number; expectedSegments: number };
const scored = new Map<string, number>(), abstained = new Map<string, number>();
for (const e of lines) {
  if (e.type === "observation" && e.value.status === "scored") scored.set(e.caseId, (scored.get(e.caseId) ?? 0) + 1);
  if (e.type === "error" && e.issue?.kind === "output_abstention") abstained.set(e.caseId, (abstained.get(e.caseId) ?? 0) + 1);
}
const cases = new Set([...scored.keys(), ...abstained.keys()]);
const primary = [...cases].filter(c => !scored.has(c)).length, strict = [...cases].filter(c => abstained.has(c)).length;
const segs = [...abstained.values()].reduce((a, b) => a + b, 0);
const rate = primary / meta.expectedCases;
const declared = (plan.windowCohorts.w256s256 as string[]).includes(test);
const verdict = rate > 0.1 ? (declared ? "HALT" : "FLAG") : "OK";
console.log(`ABST|${condition}|${test}|cases ${meta.expectedCases}|seen ${cases.size}|primary ${primary}|strict ${strict}|segments ${segs}/${meta.expectedSegments}|rate ${rate.toFixed(4)}|${verdict}`);
process.exit(verdict === "HALT" ? 3 : 0);
