/**
 * Writes plan.json for the batching study (#21): suite hash, per-test case counts from offline dry runs of every cell,
 * the serial time estimate from the frozen checkpoints, and the worst in-flight KV demand for each batched level
 * (max over any `parallel` consecutive cases in dispatch order of prompt + completion tokens, frozen serial counts).
 * Run from the main checkout root: bun <this dir>/make-plan.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { extract, frozenFile, MODELS, ROOT, SUITE_PATH, suiteJson, condition, REPEAT_LIMIT, type ModelKey } from "./rows.js";
import { CONTEXT } from "./make-suite-constants.js";

const text = readFileSync(resolve(ROOT, SUITE_PATH), "utf8"), suite = suiteJson();
const plan: any = { suite: { path: SUITE_PATH, sha256: createHash("sha256").update(text).digest("hex") }, cases: {}, models: {} };
for (const t of suite.tests) plan.cases[t.id] = t.caseIds.length;
for (const c of suite.conditions) for (const t of suite.tests) {
  const limit = c.id.endsWith("p4-repeat-full") ? [`--limit=${REPEAT_LIMIT}`] : [];
  const out = spawnSync("bun", ["evals/scripts/run-suite.ts", `--suite=${SUITE_PATH}`, `--test=${t.id}`, `--condition=${c.id}`, ...limit], { cwd: ROOT, encoding: "utf8" });
  if (out.status) throw new Error(`dry run ${c.id}/${t.id}: ${out.stderr.slice(-400)}`);
  const d = JSON.parse(out.stdout), want = limit.length ? Math.min(REPEAT_LIMIT, t.caseIds.length) : t.caseIds.length;
  if (d.cases !== want || d.plannedCalls !== want) throw new Error(`dry run ${c.id}/${t.id}: ${d.cases}/${d.plannedCalls} vs ${want}`);
}
plan.dryRunCells = suite.conditions.length * suite.tests.length;
for (const m of Object.keys(MODELS) as ModelKey[]) {
  let serialMs = 0, missing = 0; const demand: Record<number, { maxTokens: number; test: string }> = {};
  for (const t of suite.tests) {
    const x = extract(frozenFile(m, t.id))!; const ids: string[] = t.caseIds;
    const rows = ids.map(id => x.byId.get(id));
    for (const r of rows) { if (!r || r.wallMs === null) missing++; else serialMs += r.wallMs; }
    const need = rows.map(r => (r?.promptTokens ?? 0) + (r?.completionTokens ?? 4096));
    for (const p of [2, 4, 8]) for (let i = 0; i + p <= need.length; i++) {
      const s = need.slice(i, i + p).reduce((a, b) => a + b, 0);
      if (!demand[p] || s > demand[p].maxTokens) demand[p] = { maxTokens: s, test: t.id };
    }
  }
  plan.models[m] = { frozenCondition: MODELS[m].frozenCondition, serialEstimateH: +(serialMs / 3.6e6).toFixed(2), casesWithoutFrozenTiming: missing,
    worstConsecutiveDemand: Object.fromEntries(Object.entries(demand).map(([p, d]) => [p, { ...d, context: CONTEXT[m]![Number(p)], fits: d.maxTokens <= CONTEXT[m]![Number(p)]! }])),
    conditions: ["p1", "p2", "p4", "p8", "p4-repeat"].map(a => condition(m, a)) };
}
writeFileSync(resolve(import.meta.dir, "plan.json"), JSON.stringify(plan, null, 1) + "\n");
console.log(JSON.stringify(plan.models, null, 1));
