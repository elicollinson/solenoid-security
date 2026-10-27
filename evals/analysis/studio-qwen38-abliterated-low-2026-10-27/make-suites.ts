/**
 * Freezes the Qwen3.8 abliterated-builds full-suite run at reasoning_effort "low" (#23 stage 1; Claude Code 2026-10-27).
 * Offline; never calls a model.
 *
 *   bun evals/analysis/studio-qwen38-abliterated-low-2026-10-27/make-suites.ts [--write]
 *
 * Writes two suites (baseline 21 tests, extension 14 tests) whose tests, input strategies and decision rules are copied
 * byte-identical from the qwen38low suites (PR #51). Each suite has two engines and two conditions, one per abliterated
 * build. Each engine is the vanilla-low engine `qwen38-q8gguf-low` with only the model identity replaced (engine id,
 * model name, lmStudio.modelKey / indexedModelIdentifier / sizeBytes, taken from the abliteration pilot suite) and one
 * added, unsent note (parameters.speculative_decoding, #52). Checks all of that with sorted-JSON diffs and prints hashes.
 *
 * v2 (2026-10-27, after the v1 drift gate failed): LM Studio 0.4.25 does not forward the request's reasoning_effort to
 * these non-hub GGUF imports (probe: prompt_tokens 136 = xhigh for none/xhigh/medium/low on /api/v0, /v1 and
 * /v1/responses), although their embedded template is byte-identical to vanilla's (SHA-256 c3cf9e34...). v2 adds
 * lmStudio.promptTemplate: the embedded template with only its default changed from 'xhigh' to 'low', loaded at load
 * time (probe: 124 = low). The request still carries reasoning_effort "low". New engine IDs (-effort-low-tmpl-v1),
 * loaded identifiers, suite IDs (-v2) and condition IDs (-lowtmpl-), so the v1 checkpoints are kept untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const canon = (v: unknown) => JSON.stringify(sorted(v));

const pilot = JSON.parse(read("evals/suites/prompt-injection-lmstudio-studio-abliteration-pilot-q8-t4096-v1.json"));
const VERSION = process.argv.includes("--v1") ? "v1" : "v2";
const TEMPLATE = { path: "evals/analysis/studio-qwen38-abliterated-low-2026-10-27/templates/qwen38-embedded-default-low.jinja", sha256: "690af918a83d305315d94bde649fc7fa8d8c12afc096fe1683092c29727129b2" };
const EMBEDDED_SHA = "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041";
const MECH_V2 = "load-time lmStudio.promptTemplate = the builds' embedded template (sha256 c3cf9e34..., byte-identical to vanilla Qwen3.8's) with only its default changed xhigh->low; LM Studio 0.4.25 does not forward request reasoning_effort to these non-hub GGUFs (probe 2026-10-27: 136 tokens for every request value, 124 with the template); request still sends reasoning_effort low";
const SPEC_NOTE = "not configured by the runner: LM Studio enables the model's built-in MTP drafter by default for Qwen3.8 builds (on in the vanilla-low comparator and the pilot); per-response draft counts are recorded in raw.nativeResponse.usage.total_draft_tokens_count / accepted_draft_tokens_count (#52)";
export const BUILDS = {
  "heretic-ara": { pilotEngine: "qwen38-heretic-ara-q8", key: VERSION === "v1" ? "qwen38-heretic-ara-q8-low" : "qwen38-heretic-ara-q8-lowtmpl" },
  "huihui": { pilotEngine: "qwen38-huihui-abl-q8", key: VERSION === "v1" ? "qwen38-huihui-abl-q8-low" : "qwen38-huihui-abl-q8-lowtmpl" },
} as const;
export const conditionOf = (key: string) => `baseline-${key}-t4096-full`;
const SOURCES = [
  { from: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1.json", id: `prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38-abliterated-low-${VERSION}` },
  { from: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1.json", id: `prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38-abliterated-low-${VERSION}` },
];
const out: Record<string, unknown> = {};
for (const src of SOURCES) {
  const text = read(src.from), vanilla = JSON.parse(text);
  const ve = vanilla.engines["qwen38-q8gguf-low"];
  if (ve.parameters.reasoning_effort !== "low") throw new Error("vanilla engine is not low");
  const vc = vanilla.conditions[0];
  const engines: Record<string, unknown> = {}, conditions: unknown[] = [];
  for (const b of Object.values(BUILDS)) {
    const pe = pilot.engines[b.pilotEngine];
    const e = structuredClone(ve);
    e.id = pe.id.replace(/-v1$/, "-effort-low-v1");
    e.model = `${pe.model}-effort-low`;
    for (const k of ["modelKey", "indexedModelIdentifier", "sizeBytes"] as const) e.lmStudio[k] = pe.lmStudio[k];
    e.parameters.speculative_decoding = SPEC_NOTE;
    if (VERSION === "v2") {
      e.id = pe.id.replace(/-v1$/, "-effort-low-tmpl-v1"); e.model = `${pe.model}-effort-low-tmpl`;
      e.parameters.effort_mechanism = MECH_V2; e.lmStudio.promptTemplate = TEMPLATE;
      const t = read(TEMPLATE.path), emb = read("evals/analysis/qwen38-effort-calibration-2026-10/templates/lmstudio-community_Qwen3.8-27B-GGUF.jinja");
      const line = "{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}";
      if (sha(t) !== TEMPLATE.sha256 || sha(emb) !== EMBEDDED_SHA || emb.split(line).length !== 2 || emb.replace(line, line.replace("'xhigh'", "'low'")) !== t) throw new Error("template is not the embedded template with only the default changed");
    }
    // Identity check: vs vanilla-low, only id, model, the three lmStudio identity fields and the note differ.
    const strip = (x: any) => { const { id, model, parameters, lmStudio, ...rest } = x; const { speculative_decoding, effort_mechanism, ...p } = parameters; const { modelKey, indexedModelIdentifier, sizeBytes, promptTemplate, ...l } = lmStudio; return { ...rest, parameters: p, lmStudio: l }; };
    if (canon(strip(e)) !== canon(strip(ve))) throw new Error(`${b.key}: differs from vanilla-low beyond model identity`);
    // The pilot engine must agree on everything but effort (pilot: "high") and identity.
    const stripP = (x: any) => { const s: any = strip(x); delete s.parameters.reasoning_effort; delete s.parameters.effort_mechanism; return s; };
    if (canon(stripP(e)) !== canon(stripP(pe))) throw new Error(`${b.key}: differs from pilot engine beyond effort`);
    engines[b.key] = e;
    conditions.push({ ...vc, id: conditionOf(b.key), engine: b.key });
  }
  const suite = { schemaVersion: vanilla.schemaVersion, id: src.id, tests: vanilla.tests, engines, inputStrategies: vanilla.inputStrategies, decisionRules: vanilla.decisionRules, conditions };
  const suiteText = JSON.stringify(suite, null, 2) + "\n";
  const back = JSON.parse(suiteText);
  for (const k of ["tests", "inputStrategies", "decisionRules"]) if (canon(back[k]) !== canon(vanilla[k]) || JSON.stringify(back[k]) !== JSON.stringify(vanilla[k])) throw new Error(`${k} copy mismatch`);
  const path = `evals/suites/${src.id}.json`;
  if (process.argv.includes("--write")) writeFileSync(resolve(repo, path), suiteText);
  out[src.id] = { path, sha256: sha(suiteText), sourceSuite: src.from, sourceSha256: sha(text), tests: vanilla.tests.length,
    testsSha256Sorted: sha(canon(vanilla.tests)), engines: Object.fromEntries(Object.entries(engines).map(([k, e]: any) => [k, e.id])), conditions: conditions.map((c: any) => c.id) };
}
console.log(JSON.stringify(out, null, 2));
