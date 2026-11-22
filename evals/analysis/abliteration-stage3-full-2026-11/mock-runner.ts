/**
 * Offline mock of `bun run eval:local` for the stage 3 chain test (#23; Claude Code 2026-11-03). Never calls a model or
 * LM Studio. Used only with STAGE3_RUN_DIR pointing at a scratch run dir (MOCK_RUN="bun <this file>").
 * Writes <output-dir>/<test>/<condition>.jsonl by copying the build's vanilla checkpoint for that test with the metadata
 * re-bound to the stage 3 suite, condition and engine, and the response identity (model, loaded instance) set to the
 * build's, so the chain's gate and cell checks see a well-formed checkpoint. Resumes like the runner (appends only cases
 * not yet present); --max-new-segments=N stops after N new cases. MOCK_TRANSPORT_FAIL=<test> makes the first call for
 * that test write 3 cases, print provider_or_transport_error to console.log and exit 1 (exercises RETRY).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { plan, vanillaSource, type Kind } from "./s3.ts";

const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const suitePath = opt("suite")!, cond = opt("conditions")!, test = opt("tests")!, out = resolve(opt("output-dir")!), max = opt("max-new-segments");
const suiteText = readFileSync(suitePath, "utf8"), suite = JSON.parse(suiteText);
const m = /stage3-full-q8-t4096-(.+)-(baseline|extension)-v\d+$/.exec(suite.id)!;
const build = m[1]!, kind = m[2] as Kind;
const engine: any = Object.values(suite.engines)[0];
const con = (s: string) => appendFileSync(resolve(out, "console.log"), s + "\n");
const file = resolve(out, test, `${cond}.jsonl`);
mkdirSync(resolve(out, test), { recursive: true });
con(`[mock] ${build} ${kind} ${test} ${cond}${max ? ` max ${max}` : ""}`);
const marker = resolve(out, `.mock-transport-${test}`);
const failNow = process.env.MOCK_TRANSPORT_FAIL === test && !existsSync(marker);
const src = vanillaSource(build, kind, test);
const lines = readFileSync(src.file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const meta = lines[0];
const oldModel = plan.vanilla[plan.builds[build].vanilla].engineKey;
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
    for (const snap of ["before", "after"]) if (Array.isArray(e.raw.lmStudio?.[snap])) for (const i of e.raw.lmStudio[snap]) if (i?.identifier === vm) {
      i.identifier = engine.model;
      for (const k of ["modelKey", "indexedModelIdentifier", "sizeBytes"]) i[k] = engine.lmStudio[k];
    }
  }
  appendFileSync(file, JSON.stringify(e) + "\n");
}
if (failNow) { writeFileSync(marker, ""); con("[mock] provider_or_transport_error (simulated)"); process.exit(1); }
con(`[mock] wrote ${take.size} cases (${have.size + take.size}/${order.length}); vanilla engine ${oldModel}`);
