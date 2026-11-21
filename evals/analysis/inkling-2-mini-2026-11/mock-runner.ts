/**
 * Offline mock of `bun run eval:local` for the Inkling chain test (Claude Code 2026-11-21). Never calls a model or
 * LM Studio. Used only with INK_RUN_DIR / INK_RESULTS_DIR pointing at scratch dirs (MOCK_RUN="bun <this file>").
 * Writes <output-dir>/<test>/<condition>.jsonl by copying the frozen Gemma 4 26B checkpoint for that test, re-bound to
 * the Inkling suite, condition and engine, with the response identity (model, quant, loaded instance) set to the
 * variant's. Resumes like the runner; --max-new-segments=N stops after N new cases. MOCK_TRANSPORT_FAIL=<test> makes the
 * first call for that test write 3 cases, print provider_or_transport_error and exit 1 (exercises RETRY).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { plan } from "./ink.ts";

const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const suitePath = opt("suite")!, cond = opt("conditions")!, test = opt("tests")!, out = resolve(opt("output-dir")!), max = opt("max-new-segments");
const suiteText = readFileSync(suitePath, "utf8"), suite = JSON.parse(suiteText);
const engine: any = Object.values(suite.engines)[0];
const con = (s: string) => appendFileSync(resolve(out, "console.log"), s + "\n");
const file = resolve(out, test, `${cond}.jsonl`);
mkdirSync(resolve(out, test), { recursive: true });
con(`[mock] ${suite.id} ${test} ${cond}${max ? ` max ${max}` : ""}`);
const marker = resolve(out, `.mock-transport-${test}`);
const failNow = process.env.MOCK_TRANSPORT_FAIL === test && !existsSync(marker);
const kind = JSON.parse(readFileSync(plan.frozen.baseline.path, "utf8")).tests.some((t: any) => t.id === test) ? "baseline" : "extension";
const src = resolve(plan.frozen[kind].runDir, test, "baseline-gemma26-q8-t4096-full.jsonl");
const lines = readFileSync(src, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const meta = lines[0];
const have = new Set<string>();
let runId = `mock-${Date.now()}`;
if (existsSync(file)) {
  const ls = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  runId = ls[0].value.runId;
  for (const e of ls) if (e.caseId) have.add(e.caseId);
} else {
  meta.value = { ...meta.value, suiteId: suite.id, suiteSha256: createHash("sha256").update(suiteText).digest("hex"), conditionId: cond, engine, runId };
  writeFileSync(file, JSON.stringify(meta) + "\n");
}
const engineHash = createHash("sha256").update(JSON.stringify(engine)).digest("hex");
const order: string[] = [];
for (const e of lines) if (e.type === "dispatch" && e.caseId && !order.includes(e.caseId)) order.push(e.caseId);
const todo = order.filter(c => !have.has(c));
const take = new Set(todo.slice(0, failNow ? 3 : max ? Number(max) : todo.length));
for (const e of lines.slice(1)) {
  if (e.type === "complete" || !e.caseId || !take.has(e.caseId)) continue;
  if (e.type === "observation") e.value = { ...e.value, runId, conditionId: cond, engineId: engine.id, engineConfigSha256: engineHash, ...(e.value.resolvedModel ? { resolvedModel: engine.model } : {}) };
  if (e.type === "response" && e.raw?.nativeResponse) {
    const vm = e.raw.nativeResponse.model;
    e.raw.nativeResponse.model = engine.model;
    if (e.raw.nativeResponse.model_info) e.raw.nativeResponse.model_info.quant = engine.lmStudio.quantization;
    for (const snap of ["before", "after"]) if (Array.isArray(e.raw.lmStudio?.[snap])) for (const i of e.raw.lmStudio[snap]) if (i?.identifier === vm) {
      i.identifier = engine.model;
      for (const k of ["modelKey", "indexedModelIdentifier", "sizeBytes", "format"]) i[k] = engine.lmStudio[k];
    }
  }
  appendFileSync(file, JSON.stringify(e) + "\n");
}
if (failNow) { writeFileSync(marker, ""); con("[mock] provider_or_transport_error (simulated)"); process.exit(1); }
con(`[mock] wrote ${take.size} cases (${have.size + take.size}/${order.length})`);
