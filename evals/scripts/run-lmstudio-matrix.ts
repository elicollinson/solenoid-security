/** Serial LM Link research driver. No cloud calls; exact completed cells are validated and skipped. */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lmsInventoryJson, lmsJson, validateLMStudioConfig, validateLoadedModel } from "../src/lmStudio.js";
import { validateMatrixSuite, readCompleteJsonl } from "../src/researchMatrix.js";
import { analyzeCheckpoint, auditPartialCheckpoint, readNativeInputSource, type Event } from "./analyze-research.js";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (key: string, fallback = "") => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const suiteArg = option("suite", "evals/suites/prompt-injection-lmstudio-v1.json");
const conditions = option("conditions").split(",").filter(Boolean), tests = option("tests").split(",").filter(Boolean);
const suite = validateMatrixSuite(JSON.parse(readFileSync(resolve(root, suiteArg), "utf8")), conditions, tests);
const outputDir = resolve(root, option("output-dir", "evals/runs/lmstudio-research-2026-10-03"));
if (!outputDir.startsWith(resolve(root, "evals/runs") + "/")) throw new Error("Output must stay in ignored evals/runs");
const cells = suite.conditions.filter(c => !conditions.length || conditions.includes(c.id)).flatMap(condition => suite.tests.filter(test => (!tests.length || tests.includes(test.id)) && (!condition.testIds || condition.testIds.includes(test.id))).map(test => ({ condition, test, engine: suite.engines[condition.engine]! })));
for (const {engine} of cells) { if (!engine.lmStudio) throw new Error("Local matrix refuses cloud engines"); validateLMStudioConfig(engine); }
// Optional device guard: every selected engine must be pinned to, and every loaded instance placed on, this device.
const requiredDevice = option("require-device");
if (requiredDevice && cells.some(c => c.engine.lmStudio!.deviceIdentifier !== requiredDevice)) throw new Error("A selected engine is not pinned to --require-device");
function requireDevice(ps: unknown) {
  if (!requiredDevice) return;
  if (!Array.isArray(ps) || ps.some(m => m?.deviceIdentifier !== requiredDevice)) throw new Error("Loaded instance is not on --require-device");
}
const limit = option("limit"), tranche = option("max-new-segments"), maxCells = Number(option("max-cells", "100000"));
const reuseSource = option("reuse-from");
const inputReuseSource = option("reuse-inputs-from");
const deduplicate = args.includes("--deduplicate-inputs");
// Client concurrency (default 1 = serial). Values above 1 require an engine pinned with parallel >= N (run-suite checks)
// and are recorded in checkpoint metadata as clientConcurrency.
const clientConcurrency = Number(option("concurrency", "1"));
if (!Number.isSafeInteger(clientConcurrency) || clientConcurrency < 1 || clientConcurrency > 16 || deduplicate && clientConcurrency !== 1) throw new Error("Invalid --concurrency");
if (deduplicate && (reuseSource || cells.some(c => c.engine.kind !== "llm_score_json") || args.includes("--continue-after-output-errors") || args.includes("--continue-after-length-errors"))) throw new Error("Within-run reuse requires local score-only inference without external reuse or error continuation");
if (reuseSource && (cells.length !== 1 || limit)) throw new Error("--reuse-from requires one full-cohort local matrix cell");
if (inputReuseSource) {
  if (!deduplicate || cells.length !== 1 || limit) throw new Error("--reuse-inputs-from requires one full-cohort cell with --deduplicate-inputs");
  readNativeInputSource(relative(root, resolve(root, inputReuseSource)), cells[0]!.engine, root);
}
if (!Number.isInteger(maxCells) || maxCells < 1 || [limit, tranche].some(v => v && (!Number.isSafeInteger(Number(v)) || Number(v) < 1))) throw new Error("Invalid limit");
const suffix = limit ? `-limit${limit}` : "";
if (!args.includes("--execute")) { console.log(JSON.stringify({dryRun: true, cells: cells.map(c => [c.engine.id, c.test.id, c.condition.id]), outputDir}, null, 2)); process.exit(0); }
mkdirSync(outputDir, {recursive: true});
const lock = resolve(root, "evals/runs/lmstudio-device.lock");
const fd = openSync(lock, "wx"); writeFileSync(fd, JSON.stringify({pid: process.pid, outputDir, at: new Date().toISOString()})); closeSync(fd);
const log = (value: unknown) => appendFileSync(resolve(outputDir, "driver.ndjson"), JSON.stringify({at: new Date().toISOString(), value}) + "\n");
let active: (typeof cells)[number]["engine"] | undefined;
let child: ReturnType<typeof spawn> | undefined;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; child?.kill(signal); });
async function command(argv: string[]) {
  try {
    const result = await exec("lms", argv, {timeout: 300000, maxBuffer: 8 * 1024 * 1024});
    log({command: ["lms", ...argv], stdout: result.stdout, stderr: result.stderr});
  } catch (error) {
    const failure = error as Error & {code?: string | number; signal?: string; stdout?: string; stderr?: string};
    log({event: "command_failed", command: ["lms", ...argv], message: failure.message ?? String(error),
      code: failure.code ?? null, signal: failure.signal ?? null, stdout: failure.stdout ?? "", stderr: failure.stderr ?? ""});
    throw error;
  }
}
async function sdkLoad(modelKey: string, identifier: string, contextLength: number, parallel: number, ttl: number) {
  const argv = {sdkLoad: {modelKey, identifier, contextLength, parallel, ttl}};
  try {
    const { LMStudioClient } = await import("@lmstudio/sdk");
    const client = new LMStudioClient({ baseUrl: "ws://127.0.0.1:1234" });
    const model = await client.llm.load(modelKey, { identifier, ttl, verbose: false, config: { contextLength, maxParallelPredictions: parallel } as never });
    log({...argv, info: await model.getModelInfo(), lmStudioVersion: await client.system.getLMStudioVersion()});
    await client[Symbol.asyncDispose]?.();
  } catch (error) {
    log({event: "command_failed", ...argv, message: error instanceof Error ? error.message : String(error)});
    throw error;
  }
}
async function unloadOwned() {
  if (!active || !("model" in active)) return;
  const owned = active;
  const ps = await lmsJson("ps");
  if (Array.isArray(ps) && ps.some(m => m.identifier === owned.model)) {
    // The driver assigned this identifier at load time, so it unloads it even when placement validation failed
    // (e.g. a load setting the runtime ignored); the mismatch is logged rather than leaving memory allocated.
    try { validateLoadedModel(active, ps); } catch (error) { log({event: "unload_after_validation_failure", identifier: owned.model, message: error instanceof Error ? error.message : String(error)}); }
    await command(["unload", owned.model]);
  }
  active = undefined;
}
try {
  log({event: "start", suite: suite.id, cells: cells.length});
  const snapshot = await lmsInventoryJson(); const inventory = snapshot.flattened;
  log({event: "inventory", inventory: snapshot.ls, variants: snapshot.variants});
  let executed = 0;
  for (const cell of cells) {
    if (stopping || executed >= maxCells) break;
    const {condition, test, engine} = cell;
    const output = resolve(outputDir, test.id, `${condition.id}${suffix}.jsonl`);
    if (existsSync(output)) {
      const state = readCompleteJsonl(readFileSync(output, "utf8"));
      const captured = state.events[0]?.value as {clientConcurrency?: number; conditionId?: string; testId?: string; suiteId?: string; caseLimit?: number; reuseFrom?: {sourceCheckpoint?: string}; inputReuseFrom?: {sourceCheckpoint?: string}; deduplication?: string};
      if (captured?.conditionId !== condition.id || captured.testId !== test.id || captured.suiteId !== suite.id || captured.caseLimit !== (limit ? Number(limit) : undefined)) throw new Error("Existing local checkpoint identity mismatch");
      if (captured.reuseFrom?.sourceCheckpoint !== (reuseSource ? relative(root, resolve(root, reuseSource)) : undefined)) throw new Error("Existing local checkpoint reuse source differs; resume with the same --reuse-from");
      if (captured.clientConcurrency !== (clientConcurrency !== 1 ? clientConcurrency : undefined)) throw new Error("Existing local checkpoint client concurrency differs");
      if (captured.deduplication !== (deduplicate ? "exact-input/v1" : undefined)) throw new Error("Existing local checkpoint input reuse differs; resume with the same --deduplicate-inputs setting");
      if (captured.inputReuseFrom?.sourceCheckpoint !== (inputReuseSource ? relative(root, resolve(root, inputReuseSource)) : undefined)) throw new Error("Existing local checkpoint native source differs; resume with the same --reuse-inputs-from");
      if (state.events.some(e => e.type === "complete")) {
        analyzeCheckpoint(state.events as Event[], root); log({event: "skip_complete", output}); continue;
      }
      const partial = auditPartialCheckpoint(state.events as Event[], root);
      if (args.includes("--continue-after-output-errors") && [...partial.cases.values()].every(c => ["scored", "length_abstention", "output_abstention"].includes(c.status))) { log({event:"skip_finished_with_abstentions", output}); continue; }
    }
    if (active?.id !== engine.id) {
      await unloadOwned();
      const ps = await lmsJson("ps");
      if (!Array.isArray(ps) || ps.length) throw new Error("Another model is loaded; refusing to evict user models or stack memory allocations");
      const c = engine.lmStudio!;
      if (!("model" in engine) || !Array.isArray(inventory) || inventory.filter(m => m.modelKey === c.modelKey && m.deviceIdentifier === c.deviceIdentifier && m.indexedModelIdentifier === c.indexedModelIdentifier && (m.quantization as {name?: string} | undefined)?.name === c.quantization && m.sizeBytes === c.sizeBytes && m.format === c.format).length !== 1) throw new Error("Pinned LM Studio inventory provenance mismatch");
      await command(["link", "set-preferred-device", c.deviceIdentifier]);
      active = engine; // owned from the load attempt on, so a failed validation still unloads it
      if (c.modelKey.includes("@") && inventory.some(m => m.modelKey === c.modelKey && m.indexedModelIdentifier === c.indexedModelIdentifier && String(m.indexedModelIdentifier).includes("@"))) {
        // `lms load` cannot select a hub-artifact variant (it fuzzy-matches base keys); the SDK accepts variant keys.
        await sdkLoad(c.modelKey, engine.model, c.contextLength, c.parallel, 600);
      } else await command(["load", c.modelKey, "--context-length", String(c.contextLength), "--parallel", String(c.parallel), "--ttl", "600", "--identifier", engine.model, "-y"]);
      active = engine;
      const loaded = await lmsJson("ps");
      validateLoadedModel(engine, loaded); requireDevice(loaded);
      log({event: "preflight_device", deviceIdentifier: c.deviceIdentifier, requiredDevice: requiredDevice || null});
    }
    const argv = [resolve(root, "evals/scripts/run-suite.ts"), `--suite=${suiteArg}`, `--test=${test.id}`, `--condition=${condition.id}`, `--output=${output}`, `--concurrency=${clientConcurrency}`, "--execute", ...(limit ? [`--limit=${limit}`] : []), ...(tranche ? [`--max-new-segments=${tranche}`] : []), ...(reuseSource ? [`--reuse-from=${reuseSource}`] : []), ...(inputReuseSource ? [`--reuse-inputs-from=${inputReuseSource}`] : []), ...["--deduplicate-inputs", "--retry-uncertain", "--continue-after-length-errors", "--continue-after-output-errors"].filter(flag => args.includes(flag))];
    log({event: "cell_start", test: test.id, condition: condition.id});
    const code = await new Promise<number>((done, reject) => {
      child = spawn(process.execPath, argv, {cwd: root, stdio: ["ignore", "pipe", "pipe"]});
      child.stdout?.on("data", chunk => { process.stdout.write(chunk); appendFileSync(resolve(outputDir,"console.log"), chunk); });
      child.stderr?.on("data", chunk => { process.stderr.write(chunk); appendFileSync(resolve(outputDir,"console.log"), chunk); });
      child.once("error", reject); child.once("exit", code => done(code ?? 1));
    });
    child = undefined; executed++;
    log({event: "cell_exit", test: test.id, condition: condition.id, code});
    if (code !== 0) throw new Error("Local cell stopped; inspect retained failure before resuming");
    const state = readCompleteJsonl(readFileSync(output,"utf8"));
    if (state.events.some(e => e.type === "complete")) log({event:"validated", aggregate:analyzeCheckpoint(state.events as Event[],root).aggregate});
    else auditPartialCheckpoint(state.events as Event[],root);
  }
} finally {
  try { await unloadOwned(); } finally { unlinkSync(lock); }
}
