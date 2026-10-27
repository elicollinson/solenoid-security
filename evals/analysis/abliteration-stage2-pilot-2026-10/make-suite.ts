/**
 * Builds the per-build stage 2 suite of the abliteration extension (#23, O53; Claude Code 2026-10-27). Offline; never
 * calls a model or LM Studio.
 *
 *   bun make-suite.ts <build> --pin=<pin.json> [--write]     the real suite, evals/suites/<id>.json
 *   bun make-suite.ts <build> --placeholder --out=<file>     a dry-run copy with a placeholder inventory identity
 *
 * One suite per build, because each build's LM Studio inventory identity (modelKey, sizeBytes, the indexed file) is only
 * known once the user's download appears in `lms ls --json` (pin.ts records it; nothing else is pinned at run time).
 *   - tests, inputStrategies, decisionRules: copied from the pilot suite (same caseIds; JSON-identical, checked).
 *   - one engine: the build's VANILLA engine (plan.json `vanilla`) with only the model identity replaced (engine id,
 *     load identifier, lmStudio.modelKey / indexedModelIdentifier / sizeBytes, and quantization for the robustness arm),
 *     plus, where template-audit.py found a rendering difference, lmStudio.promptTemplate (a deviation, see the plan)
 *     and an unsent parameters.template_mechanism note. Qwen3.8 keeps reasoning_effort "low" from the qwen38low engine.
 *   - one condition, stage2-<label>-t4096-full.
 * Checks: the pilot suite hash; vanilla inputStrategies/decisionRules equal the pilot's; the engine differs from vanilla
 * only in the allowed fields; every vanilla checkpoint for the nine tests carries the vanilla engine (canonical JSON).
 * --write never overwrites a different existing file (exit 2): a changed identity needs a new suite version.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : repo;
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const canon = (v: unknown) => JSON.stringify(sorted(v));
const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export const plan = JSON.parse(readFileSync(resolve(import.meta.dir, "plan.json"), "utf8"));
export const suiteIdOf = (build: string) => `prompt-injection-lmstudio-studio-abliteration-stage2-pilot-q8-t4096-${build}-v1`;
export const suitePathOf = (build: string) => `evals/suites/${suiteIdOf(build)}.json`;
export const conditionOf = (build: string) => `stage2-${plan.builds[build].label}-t4096-full`;
const TEMPLATE_NOTE: Record<string, string> = {
  gemma4: "load-time lmStudio.promptTemplate = vanilla Gemma 4 Q8_0 embedded template (sha256 85a08664...) with one prepended line defaulting enable_thinking to true: the vanilla hub model was served enable_thinking=true (O54 audit, offset 0 on 7,317/7,317), while LM Studio passes no effort/thinking variable to non-hub GGUF imports (stage 1, 2026-10-27); request still sends reasoning_effort high (dropped by LM Studio, O65)",
  qwen38: "load-time lmStudio.promptTemplate = stage 1's template: vanilla Qwen3.8 embedded template (sha256 c3cf9e34...) with only its default changed xhigh->low; LM Studio 0.4.25 does not forward request reasoning_effort to non-hub GGUFs (stage 1 probe 2026-10-27); this build's own embedded template (sha256 9bfdde60...) renders the same at low but defaults to no instruction; request still sends reasoning_effort low",
};
const SPEC_NOTE = "not configured by the runner: LM Studio enables a model's built-in MTP drafter by default for Qwen3.8 builds (on in the vanilla-low comparator); per-response draft counts are recorded in raw.nativeResponse.usage.total_draft_tokens_count / accepted_draft_tokens_count (#52)";

export function buildSuite(build: string, pin: { modelKey: string; indexedModelIdentifier: string; sizeBytes: number; quantization: string }) {
  const b = plan.builds[build];
  if (!b) throw new Error(`unknown build ${build}`);
  const pilotText = read(plan.pilotSuite.path);
  if (sha(pilotText) !== plan.pilotSuite.sha256) throw new Error("pilot suite hash differs from plan");
  const pilot = JSON.parse(pilotText), v = plan.vanilla[b.vanilla];
  const vsuite = JSON.parse(read(v.suite)), ve = vsuite.engines[v.engineKey];
  if (!ve || ve.id !== v.engineId) throw new Error(`vanilla engine ${v.engineKey} missing or id differs`);
  for (const k of ["inputStrategies", "decisionRules"]) if (canon(vsuite[k]) !== canon(pilot[k])) throw new Error(`vanilla ${k} differ from pilot`);
  const vc = vsuite.conditions.find((c: any) => c.engine === v.engineKey && c.id === v.condition);
  if (!vc) throw new Error("vanilla condition missing");
  // Every vanilla checkpoint for the nine pilot tests must carry exactly this vanilla engine.
  for (const t of pilot.tests) {
    const file = resolve(dataRoot, v.runDir, t.id, `${v.condition}.jsonl`);
    if (!existsSync(file)) throw new Error(`vanilla checkpoint missing: ${file}`);
    const meta = JSON.parse(readFileSync(file, "utf8").split("\n", 1)[0]!).value;
    if (canon(meta.engine) !== canon(ve) || meta.conditionId !== v.condition || meta.testId !== t.id) throw new Error(`vanilla checkpoint ${t.id} engine/condition mismatch`);
  }
  if (b.quantization && pin.quantization !== b.quantization) throw new Error(`${build}: inventory quantization ${pin.quantization} != ${b.quantization}`);
  const id = pin.indexedModelIdentifier, want = `${b.repo}/${b.file}`;
  if (id !== `${plan.device}:${want}` && !(id.startsWith(`${plan.device}:`) && id.endsWith(`@${want}`))) throw new Error(`${build}: indexed identifier ${id} is not ${want} on the Studio`);
  const low = b.vanilla === "qwen38low", tmpl = b.template ? plan.templates[b.template] : null;
  const suffix = `${low ? "-effort-low" : ""}${tmpl ? "-tmpl" : ""}`;
  const e = structuredClone(ve);
  e.id = `studio-${b.label}-lmstudio-score-v1-thinking4096-native-v0${suffix}-v1`;
  e.model = `solenoid-studio-${b.label}-thinking4096${suffix}`;
  e.lmStudio.modelKey = pin.modelKey; e.lmStudio.indexedModelIdentifier = pin.indexedModelIdentifier; e.lmStudio.sizeBytes = pin.sizeBytes;
  e.lmStudio.quantization = pin.quantization;
  if (tmpl) {
    if (sha(read(tmpl.path)) !== tmpl.sha256) throw new Error("override template hash differs from plan");
    e.lmStudio.promptTemplate = { path: tmpl.path, sha256: tmpl.sha256 };
    if (low) e.parameters.effort_mechanism = TEMPLATE_NOTE.qwen38; else e.parameters.template_mechanism = TEMPLATE_NOTE[b.template];
  }
  if (low) e.parameters.speculative_decoding = SPEC_NOTE;
  if (low && e.parameters.reasoning_effort !== "low") throw new Error("qwen38 build must stay at low");
  const strip = (x: any) => { const { id, model, parameters, lmStudio, ...rest } = x; const { effort_mechanism, template_mechanism, speculative_decoding, ...p } = parameters;
    const { modelKey, indexedModelIdentifier, sizeBytes, promptTemplate, ...l } = lmStudio; if (b.role === "robustness") delete l.quantization; return { ...rest, parameters: p, lmStudio: l }; };
  if (canon(strip(e)) !== canon(strip(ve))) throw new Error(`${build}: engine differs from vanilla beyond model identity`);
  const key = `${b.label}${suffix}`;
  const suite = { schemaVersion: pilot.schemaVersion, id: suiteIdOf(build), tests: pilot.tests, engines: { [key]: e }, inputStrategies: pilot.inputStrategies, decisionRules: pilot.decisionRules,
    conditions: [{ ...vc, id: conditionOf(build), engine: key }] };
  const text = JSON.stringify(suite, null, 2) + "\n";
  const back = JSON.parse(text);
  for (const k of ["tests", "inputStrategies", "decisionRules"]) if (JSON.stringify(back[k]) !== JSON.stringify(pilot[k])) throw new Error(`${k} copy mismatch`);
  return { text, sha256: sha(text), engineId: e.id, model: e.model, condition: conditionOf(build), testsSha256: sha(canon(pilot.tests)) };
}

if (import.meta.main) {
  const build = process.argv[2]!;
  const b = plan.builds[build];
  const placeholder = process.argv.includes("--placeholder");
  const pin = placeholder
    ? { modelKey: `${b.label}-placeholder`, indexedModelIdentifier: `${plan.device}:${b.repo}/${b.file}`, sizeBytes: b.hfFileBytes, quantization: b.quantization ?? "Q8_K_XL" }
    : JSON.parse(readFileSync(resolve(opt("pin")!), "utf8"));
  const s = buildSuite(build, pin);
  const out = placeholder ? resolve(opt("out")!) : resolve(repo, suitePathOf(build));
  if (placeholder || process.argv.includes("--write")) {
    if (!placeholder && existsSync(out) && readFileSync(out, "utf8") !== s.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
    writeFileSync(out, s.text);
  }
  console.log(JSON.stringify({ build, path: placeholder ? out : suitePathOf(build), sha256: s.sha256, engineId: s.engineId, model: s.model, condition: s.condition, testsSha256: s.testsSha256, pin }));
}
