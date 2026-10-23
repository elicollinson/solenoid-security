/**
 * Freezes the Qwen3.8-low full-suite rerun (#33; Claude Code 2026-10-22). Offline; never calls a model.
 *
 *   bun evals/analysis/studio-qwen38-low-2026-10-22/make-suites.ts [--write]
 *
 * Writes two suites whose tests, input strategy and decision rule are copied unchanged from the frozen Studio Q8 t4096
 * baseline (21 tests) and extension (14 tests) suites, with a single engine and condition: the Qwen3.8 GGUF Q8_0 low-effort
 * engine copied byte-for-byte from the qwen38-effort-ablation-2026-10 suite (PR #49). That engine differs from the frozen
 * `qwen38-q8gguf` engine only in parameters.reasoning_effort ("low" instead of "high", which LM Studio drops so the
 * template default xhigh applied), parameters.effort_mechanism, its id and its loaded identifier. Checks all of that and
 * prints the suite hashes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const ablation = JSON.parse(read("evals/suites/prompt-injection-lmstudio-studio-qwen38-effort-ablation-q8-t4096-v1.json"));
const lowEngine = ablation.engines["qwen38-effort-low"];
export const ENGINE_KEY = "qwen38-q8gguf-low";
export const CONDITION = `baseline-${ENGINE_KEY}-t4096-full`;
const SOURCES = [
  { from: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json", id: "prompt-injection-lmstudio-studio-baseline-q8-t4096-qwen38low-v1" },
  { from: "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json", id: "prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-qwen38low-v1" },
];
const out: Record<string, unknown> = {};
for (const src of SOURCES) {
  const text = read(src.from), frozen = JSON.parse(text);
  const fe = frozen.engines["qwen38-q8gguf"];
  // The low engine must equal the frozen engine apart from the four documented fields.
  const strip = (e: any) => { const { id, model, parameters, ...rest } = e; const { reasoning_effort, effort_mechanism, ...p } = parameters; return { ...rest, parameters: p }; };
  if (!same(strip(fe), strip(lowEngine))) throw new Error(`${src.from}: low engine differs from frozen qwen38-q8gguf beyond effort/id/model`);
  if (fe.parameters.reasoning_effort !== "high" || lowEngine.parameters.reasoning_effort !== "low") throw new Error("unexpected effort values");
  const frozenCond = frozen.conditions.find((c: any) => c.id === "baseline-qwen38-q8gguf-t4096-full");
  const condition = { ...frozenCond, id: CONDITION, engine: ENGINE_KEY };
  const suite = { schemaVersion: frozen.schemaVersion, id: src.id, tests: frozen.tests, engines: { [ENGINE_KEY]: lowEngine },
    inputStrategies: frozen.inputStrategies, decisionRules: frozen.decisionRules, conditions: [condition] };
  const suiteText = JSON.stringify(suite, null, 2) + "\n";
  const back = JSON.parse(suiteText);
  if (!same(back.tests, frozen.tests) || !same(back.inputStrategies, frozen.inputStrategies) || !same(back.decisionRules, frozen.decisionRules)) throw new Error("copy mismatch");
  if (JSON.stringify(back.tests) !== JSON.stringify(frozen.tests)) throw new Error("tests not identical in order");
  const path = `evals/suites/${src.id}.json`;
  if (process.argv.includes("--write")) writeFileSync(resolve(repo, path), suiteText);
  out[src.id] = { path, sha256: sha(suiteText), sourceSuite: src.from, sourceSha256: sha(text), tests: frozen.tests.length, engineId: lowEngine.id, condition: CONDITION,
    testsSha256Sorted: sha(JSON.stringify(sorted(frozen.tests))) };
}
console.log(JSON.stringify(out, null, 2));
