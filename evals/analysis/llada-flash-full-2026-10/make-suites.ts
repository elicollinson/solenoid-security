/**
 * Builds the two PRE-REGISTERED LLaDA2.2-flash suites (#38, 2026-10-19). Tests are copied verbatim (dataset, revision,
 * annotation key, case selector, metrics) from the Studio Q8 t4096 baseline and extension suites, so Flash scores the
 * exact cohorts of the 7-model tables. The engine is copied verbatim from the variants pilot suite
 * (`llada22-flash-4bit`), so engine identity matches the pilot and the exploratory sweep. The input strategies are the
 * sweep's objects. Window conditions are bound (testIds) to the cohorts declared in plan.json. Refuses to overwrite a
 * suite, because checkpoints pin its SHA-256. Run from the repository root: bun <this file>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const plan = read("evals/analysis/llada-flash-full-2026-10/plan.json");
const pilot = read("evals/suites/prompt-injection-openai-compat-llada22-variants-pilot-v1.json");
const sweep = read("evals/suites/prompt-injection-openai-compat-llada22-window-sweep-exploratory-v1.json");
const engine = pilot.engines["llada22-flash-4bit"];
if (JSON.stringify(engine) !== JSON.stringify(sweep.engines["llada22-flash-4bit"])) throw new Error("pilot and sweep Flash engines differ");
const inputStrategies = { full: pilot.inputStrategies.full, w256s256: sweep.inputStrategies.w256s256, w128s128: sweep.inputStrategies.w128s128 };
for (const [part, source] of [["baseline", "prompt-injection-lmstudio-studio-baseline-q8-t4096-v1"], ["extension", "prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1"]] as const) {
  const id = `prompt-injection-openai-compat-llada22-flash-${part}-v1`;
  const src = read(`evals/suites/${source}.json`);
  const ids = new Set(src.tests.map((t: { id: string }) => t.id));
  const w256 = plan.windowCohorts.w256s256.filter((t: string) => ids.has(t)), w128 = plan.windowCohorts.w128s128.filter((t: string) => ids.has(t));
  const conditions = [
    { id: "llada22-flash-4bit-full", engine: "llada22-flash-4bit", inputStrategy: "full", decisionRule: "score05", repeat: 1 },
    { id: "llada22-flash-4bit-w256s256", testIds: w256, engine: "llada22-flash-4bit", inputStrategy: "w256s256", decisionRule: "score05", repeat: 1 },
    { id: "llada22-flash-4bit-w128s128", testIds: w128, engine: "llada22-flash-4bit", inputStrategy: "w128s128", decisionRule: "score05", repeat: 1 },
  ];
  const suite = { schemaVersion: "security-eval-suite/v1", id, tests: src.tests, engines: { "llada22-flash-4bit": engine }, inputStrategies, decisionRules: src.decisionRules, conditions };
  if (JSON.stringify(src.decisionRules) !== JSON.stringify(pilot.decisionRules)) throw new Error("decision rules differ");
  const out = resolve(root, `evals/suites/${id}.json`);
  if (existsSync(out) && !process.argv.includes("--force")) throw new Error(`${out} exists (checkpoints pin its hash)`);
  writeFileSync(out, JSON.stringify(suite, null, 2) + "\n");
  console.log(id, src.tests.length, "tests;", "w256s256:", w256.join(","), "| w128s128:", w128.join(","));
}
