/**
 * Shared per-case extraction for the abliteration stage 2 pilot screen (#23; Claude Code 2026-10-27). Run from the
 * feature worktree root (its evals/runs, evals/private and git-ignored datasets are symlinks into the main checkout).
 * The extraction itself is stage 1's (studio-qwen38-abliterated-low-2026-10-27/rows.ts: the repo's partial auditor for
 * suite, engine, dataset and input-hash provenance, then the last native response's usage, answer, model identity and
 * draft counts). The vanilla side is the build's vanilla FULL-suite checkpoint, audited whole and then restricted to the
 * pilot caseIds of that test (no vanilla reruns). IDs and numbers only.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extract, type Extract, type Row } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";
import { plan, suitePathOf, conditionOf } from "./make-suite.js";
export { ba, median, FINISHED, type Row } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";
export { plan };

export const ROOT = process.cwd();
export const RUN_DIR = resolve(ROOT, process.env.STAGE2_RUN_DIR ?? plan.runDir); // override: offline mock test only
export const ABSTENTION_HALT: number = plan.gates.abstentionExcessHalt;
const ctxCache = new Map<string, ReturnType<typeof load>>();
function load(build: string) {
  const suite = JSON.parse(readFileSync(resolve(ROOT, suitePathOf(build)), "utf8"));
  const engine: any = Object.values(suite.engines)[0];
  const caseIds = new Map<string, Set<string>>(suite.tests.map((t: any) => [t.id, new Set<string>(t.caseIds)]));
  return { build, display: plan.builds[build].display as string, condition: conditionOf(build), model: engine.model as string,
    indexed: engine.lmStudio.indexedModelIdentifier as string, quant: engine.lmStudio.quantization as string, tests: suite.tests.map((t: any) => t.id) as string[], caseIds,
    vanilla: plan.vanilla[plan.builds[build].vanilla] as { runDir: string; condition: string } };
}
export const ctx = (build: string) => { if (!ctxCache.has(build)) ctxCache.set(build, load(build)); return ctxCache.get(build)!; };
/** The analyzed checkpoint of a cohort: the newest fresh-condition rerun (r2, r1; plan amendment 2026-10-29) that exists,
 * else the original condition. Superseded partials stay on disk untouched and are never analyzed. */
export const buildFile = (build: string, test: string) => {
  for (const n of [2, 1]) { const f = resolve(RUN_DIR, test, `${conditionOf(build, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(RUN_DIR, test, `${ctx(build).condition}.jsonl`);
};
export const buildRows = (build: string, test: string) => extract(buildFile(build, test));
/** The vanilla checkpoint for this build's model family, restricted to the pilot caseIds of the test. */
export function vanillaRows(build: string, test: string): Extract | null {
  const c = ctx(build), full = extract(resolve(ROOT, c.vanilla.runDir, test, `${c.vanilla.condition}.jsonl`));
  if (!full) return null;
  const ids = c.caseIds.get(test)!;
  const rows = full.rows.filter(r => ids.has(r.caseId));
  return { rows, byId: new Map(rows.map(r => [r.caseId, r])), complete: full.complete && rows.length === ids.size };
}
export const identityOk = (build: string, r: Row) => { const c = ctx(build); return r.responseModel === c.model && r.quant === c.quant && r.loadedIndexed === c.indexed; };
export const correct = (r: { positive: boolean; flagged: boolean | null }) => r.flagged === r.positive;
/** Exact two-sided McNemar (binomial on the discordant pairs). */
export function mcnemar(b: number, c: number): number {
  const n = b + c; if (!n) return 1;
  const lf = (k: number) => { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; };
  let tail = 0; for (let i = 0; i <= Math.min(b, c); i++) tail += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}
