/**
 * Fresh-clone smoke test: `bun run smoke`.
 *
 * Needs no network, models, .env or private data. Runs both typechecks, every offline test suite, and a tiny
 * end-to-end eval: the committed synthetic fixture (evals/fixtures/smoke) goes through the real
 * evals/scripts/run-suite.ts and analyze-run.ts with a deterministic keyword detector standing in for the model
 * endpoint. The eval runs in a temporary copy of the eval code, so nothing is written to evals/runs.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
type Result = { name: string; ok: boolean; seconds: number; note?: string };
const results: Result[] = [];

function run(name: string, command: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const started = performance.now();
  const child = spawnSync(command[0]!, command.slice(1), { cwd: options.cwd ?? root, env: options.env ?? process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const ok = child.status === 0;
  const tally = output.match(/^\s*(\d+) pass\s*$/m) ? ["pass", "skip", "fail"].map(k => `${output.match(new RegExp(`^\\s*(\\d+) ${k}\\s*$`, "m"))?.[1] ?? 0} ${k}`).join(", ") : undefined;
  record(name, ok, started, tally);
  if (!ok) console.log(output.trimEnd().split("\n").slice(-40).map(line => `    ${line}`).join("\n"));
  return output;
}

function record(name: string, ok: boolean, started: number, note?: string): void {
  const seconds = (performance.now() - started) / 1000;
  results.push({ name, ok, seconds, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${seconds.toFixed(1)}s${note ? `; ${note}` : ""})`);
}

const bun = process.execPath, tsc = resolve(root, "node_modules/typescript/bin/tsc");
console.log("Smoke test: offline, no models, no .env, no private data\n");
run("library typecheck", [bun, tsc, "-p", "tsconfig.json", "--noEmit"]);
run("library tests (tests/)", [bun, "test", "./tests"]);
run("eval typecheck", [bun, tsc, "-p", "evals/tsconfig.json", "--noEmit"]);
run("eval tests (evals/tests/)", [bun, "test", "./evals/tests"]);
run("archived eval tests (evals/archive/)", [bun, "test", "./evals/archive"]);
run("db importer tests (evals/db/import/)", [bun, "test", "./evals/db/import"]);

// End-to-end: real runner and analyzer, stubbed endpoint, temporary root.
const temp = mkdtempSync(resolve(tmpdir(), "solenoid-smoke-"));
const started = performance.now();
try {
  for (const dir of ["src", "evals/src", "evals/scripts", "evals/fixtures/smoke"]) cpSync(resolve(root, dir), resolve(temp, dir), { recursive: true });
  cpSync(resolve(root, "package.json"), resolve(temp, "package.json"));
  symlinkSync(resolve(root, "node_modules"), resolve(temp, "node_modules"), "dir");
  for (const dir of ["evals/datasets", "evals/suites"]) mkdirSync(resolve(temp, dir), { recursive: true });
  cpSync(resolve(root, "evals/fixtures/smoke/synthetic-smoke-v1.json"), resolve(temp, "evals/datasets/synthetic-smoke-v1.json"));
  cpSync(resolve(root, "evals/fixtures/smoke/synthetic-smoke-suite.json"), resolve(temp, "evals/suites/synthetic-smoke.json"));

  // Deterministic offline detector: flags explicit override phrases, misses the subtle synthetic case by design.
  // fetch is replaced before run-suite loads, so the runner cannot reach the network.
  const driver = resolve(temp, "smoke-driver.ts");
  writeFileSync(driver, `const trigger = /ignore (all )?previous instructions|disregard the above|system override/i;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("smoke stub: unexpected request " + String(url));
  const body = JSON.parse(String(init?.body)), text = String(body.messages.at(-1).content);
  const concernScore = trigger.test(text) ? 0.9 : 0.1;
  return Response.json({ id: "stub-" + crypto.randomUUID(), model: body.model, provider: "offline-stub", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ concernScore }) } }], usage: { prompt_tokens: text.length, completion_tokens: 8, cost: 0 } });
}) as typeof fetch;
process.argv = ["bun", "run-suite", ...process.argv.slice(2)];
await import(${JSON.stringify(resolve(temp, "evals/scripts/run-suite.ts"))});
`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, OPENROUTER_API_KEY: "offline-smoke-stub" };
  const expected = { tp: 3, fp: 1, tn: 3, fn: 1, incomplete: 0 };
  const problems: string[] = [];
  for (const condition of ["stub-full", "stub-windows"]) {
    const exec = spawnSync(bun, [driver, "--suite=evals/suites/synthetic-smoke.json", "--test=synthetic-mixed", `--condition=${condition}`, "--execute", "--concurrency=1"], { cwd: temp, env, encoding: "utf8" });
    if (exec.status !== 0) { problems.push(`${condition}: run-suite exited ${exec.status}\n${exec.stdout}${exec.stderr}`); continue; }
    const checkpoint = `evals/runs/synthetic-smoke/synthetic-mixed/${condition}.jsonl`;
    const analyze = spawnSync(bun, [resolve(temp, "evals/scripts/analyze-run.ts"), `--input=${checkpoint}`, "--suite=evals/suites/synthetic-smoke.json"], { cwd: temp, env, encoding: "utf8" });
    if (analyze.status !== 0) { problems.push(`${condition}: analyze-run exited ${analyze.status}\n${analyze.stdout}${analyze.stderr}`); continue; }
    const analysis = JSON.parse(readFileSync(resolve(temp, checkpoint.replace(/\.jsonl$/, "-analysis.json")), "utf8"));
    const matrix = analysis.summaries[0].matrix;
    if (Object.entries(expected).some(([key, value]) => matrix[key] !== value)) problems.push(`${condition}: matrix ${JSON.stringify(matrix)} != expected ${JSON.stringify(expected)}`);
    const segments = analysis.summaries[0].coverage.observedSegments;
    if (condition === "stub-windows" ? segments <= 8 : segments !== 8) problems.push(`${condition}: unexpected segment count ${segments}`);
  }
  record("end-to-end synthetic eval (run-suite + analyze-run, full and windowed)", problems.length === 0, started, problems.length ? undefined : "tp 3, fp 1, tn 3, fn 1 as designed");
  for (const problem of problems) console.log(problem.split("\n").slice(0, 40).map(line => `    ${line}`).join("\n"));
} catch (error) {
  record("end-to-end synthetic eval (run-suite + analyze-run, full and windowed)", false, started);
  console.log(`    ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter(result => !result.ok);
const total = results.reduce((sum, result) => sum + result.seconds, 0);
console.log(`\n${failed.length ? "SMOKE FAIL" : "SMOKE PASS"}: ${results.length - failed.length}/${results.length} steps passed in ${total.toFixed(1)}s`);
if (failed.length) console.log(`Failed: ${failed.map(result => result.name).join("; ")}`);
console.log("Skipped tests need git-ignored datasets; see the Reproduce section of evals/README.md.");
process.exit(failed.length ? 1 : 0);
