import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { analyzeCheckpoint, auditPartialCheckpoint, readNativeInputSource, type Event } from "../scripts/analyze-research.js";
import { sha256 } from "../src/strategies.js";
import { SCORE_ONLY_PROMPT_ID, SCORE_ONLY_PROMPT_SHA256 } from "../src/engines.js";
import { fixtureRunDir } from "./runDirFixture.js";

function fixture(invalid: boolean, check: (f: { run: (args?: string[]) => ReturnType<typeof spawnSync>; events: () => Event[]; root: string; out: string }) => void, texts = ["same input", "same input", "same\ninput", "same input"]) {
  const root = process.cwd(), id = "input-reuse-" + randomUUID(), temp = mkdtempSync(resolve(tmpdir(), "input-reuse-"));
  const dataset = resolve(root, `evals/datasets/${id}.json`), suite = resolve(root, `evals/suites/${id}.json`);
  const { outDir, cleanup } = fixtureRunDir(root, id), out = resolve(outDir, "run.jsonl");
  try {
    const raw = texts.map((text, i) => ({ id: "case" + i, label: i === 1 ? "benign" : "injection", turns: [{ id: "source-" + i, role: "document", origin: "external", text }], text_sha256: sha256(text) })).map(c => JSON.stringify(c)).join("\n") + "\n";
    const source = resolve(temp, "source.jsonl"), revision = "sha256:" + sha256(raw);
    writeFileSync(source, raw);
    writeFileSync(dataset, JSON.stringify({ schemaVersion: "security-eval-dataset/v1", id, revision, source: { path: source, sha256: sha256(raw), format: "canonical-jsonl", visibility: "private" }, expectedCases: 4, annotationKey: "attempt", positiveValues: ["injection"], negativeValues: ["benign"] }));
    const engine = { id: "fixture-model", kind: "llm_score_json", model: "fixture-model", provider: "lmstudio", lmStudio: { baseUrl: "http://127.0.0.1:1234", modelKey: "fixture", indexedModelIdentifier: "laptop:fixture", deviceIdentifier: "laptop", format: "gguf", quantization: "Q4", sizeBytes: 4000, contextLength: 65536, parallel: 1, timeoutMs: 1000 }, promptId: SCORE_ONLY_PROMPT_ID, promptSha256: SCORE_ONLY_PROMPT_SHA256, schemaId: "concern-score-only-json-v1", parameters: { max_tokens: 64, temperature: 0, reasoning_effort: "none" } };
    writeFileSync(suite, JSON.stringify({ schemaVersion: "security-eval-suite/v1", id, tests: [{ id: "test", datasetId: id, datasetRevision: revision, annotationKey: "attempt", caseSelector: "all", metrics: ["detection_rate"] }], engines: { model: engine }, inputStrategies: { full: { id: "full", kind: "full_text", turnSelection: "last_external" } }, decisionRules: { score: { id: "score", kind: "score_threshold", aggregation: "max", threshold: 0.5, comparator: ">" } }, conditions: [{ id: "condition", engine: "model", inputStrategy: "full", decisionRule: "score", repeat: 1 }] }));
    const loaded = [{ type: "llm", identifier: engine.model, ...engine.lmStudio, quantization: { name: "Q4" } }];
    const lms = resolve(temp, "lms");
    writeFileSync(lms, "#!" + process.execPath + "\nconsole.log(" + JSON.stringify(JSON.stringify(loaded)) + ");"); chmodSync(lms, 0o755);
    const script = resolve(temp, "run.ts");
    const argv = ["bun", "run-suite", `--suite=${suite}`, "--test=test", "--condition=condition", `--output=${out}`, "--deduplicate-inputs", "--concurrency=1"];
    writeFileSync(script, `globalThis.fetch=async(url,init)=>{const text=JSON.parse(init.body).messages[1].content;return Response.json({id:'response-'+encodeURIComponent(text),model:'fixture-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify({concernScore:${invalid ? 9 : 0.8}})}}],usage:{prompt_tokens:2,completion_tokens:9}});};process.argv=${JSON.stringify(argv)}.concat(process.argv.slice(2));await import(${JSON.stringify(resolve(root, "evals/scripts/run-suite.ts"))});`);
    const run = (args: string[] = []) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH: temp + ":" + process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    check({ run, events: () => readFileSync(out, "utf8").trimEnd().split("\n").map(s => JSON.parse(s)), root, out });
  } finally {
    rmSync(dataset, { force: true }); rmSync(suite, { force: true }); cleanup(); rmSync(temp, { recursive: true, force: true });
  }
}

test("within-run reuse preserves labels and exact bytes across tranche and resume", () => fixture(false, f => {
  const dry = f.run(); expect(dry.status).toBe(0);
  expect(JSON.parse(String(dry.stdout))).toMatchObject({ plannedCalls: 2, reusedObservations: 2 });
  const first = f.run(["--execute", "--max-new-segments=1"]); expect(first.stderr).toBe(""); expect(first.status).toBe(0);
  const partial = auditPartialCheckpoint(f.events(), f.root);
  expect([...partial.cases.values()].filter(c => c.status === "scored")).toHaveLength(2);
  expect(f.run(["--execute"]).status).toBe(0);
  const events = f.events(), run = analyzeCheckpoint(events, f.root);
  expect(run.aggregate.execution).toMatchObject({ kind: "mixed", newInferenceCalls: 2, reusedObservations: 2 });
  expect(run.aggregate.primary.matrix).toEqual({ tp: 3, fp: 1, tn: 0, fn: 0, incomplete: 0 });
  expect(run.aggregate.latencyMs.basis).toBe("mixed_source_observations");
  expect(events.filter(e => e.type === "response")).toHaveLength(2);
  const source = events.find(e => e.type === "observation")!;
  for (const e of events.filter(e => e.type === "derived_observation")) expect(e.sourceRequestId).toBe((source.value as any).requestId);
  expect(f.run(["--execute"]).status).toBe(0);
  expect(f.events().filter(e => e.type === "dispatch")).toHaveLength(2);
  expect(f.events().filter(e => e.type === "derived_observation")).toHaveLength(2);
}));

test("within-run audit rejects altered or fabricated reuse and duplicate dispatches", () => fixture(false, f => {
  expect(f.run(["--execute"]).status).toBe(0);
  const original = f.events();
  const edits = [
    (e: any) => e.sourceSegmentId = "wrong",
    (e: any) => e.sourceObservationSha256 = "wrong",
    (e: any) => e.sourceRequestId = "wrong",
    (e: any) => e.value.rawScore = 0.1,
    (e: any) => e.raw = {},
    (e: any) => e.value.inputSha256 = "wrong",
  ];
  for (const edit of edits) { const events = structuredClone(original); edit(events.find(e => e.type === "derived_observation")); expect(() => analyzeCheckpoint(events, f.root)).toThrow(); }
  const unmarked = structuredClone(original); delete (unmarked[0]!.value as any).deduplication;
  expect(() => analyzeCheckpoint(unmarked, f.root)).toThrow();
  const repeated = structuredClone(original), reused = repeated.find(e => e.type === "derived_observation")!;
  repeated.splice(1, 0, { type: "dispatch", caseId: reused.caseId, segmentId: reused.segmentId, requestId: "duplicate" });
  expect(() => auditPartialCheckpoint(repeated, f.root)).toThrow("exact within-run input");
}));

test("invalid native output is retained once and never reused as a score", () => fixture(true, f => {
  expect(f.run(["--execute"]).status).toBe(1);
  const before = readFileSync(f.out, "utf8"), events = f.events();
  expect(events.filter(e => e.type === "dispatch")).toHaveLength(1);
  expect(events.filter(e => e.type === "response")).toHaveLength(1);
  expect(events.filter(e => e.type === "observation" || e.type === "derived_observation")).toHaveLength(0);
  expect(auditPartialCheckpoint(events, f.root).cases.get("case0")!.status).toBe("output_abstention");
  expect(f.run(["--execute"]).status).toBe(1);
  expect(readFileSync(f.out, "utf8")).toBe(before);
  const continuation = f.run(["--execute", "--continue-after-output-errors"]);
  expect(continuation.status).toBe(1); expect(String(continuation.stderr)).toContain("without external reuse or error continuation");
}));


test("cross-study native reuse preserves target labels, exact bytes and original provenance on resume", () => fixture(false, source => {
  expect(source.run(["--execute"]).status).toBe(0);
  const sourceEvents = source.events(), original = sourceEvents.find(e => e.type === "observation")!;
  const sourcePath = relative(source.root, source.out), engine = (sourceEvents[0]!.value as any).engine;
  const cache = readNativeInputSource(sourcePath, engine, source.root);
  expect(cache.inputs.size).toBe(1); // Three source copies cannot become new cache origins.
  expect(cache.reference.sourceCheckpointSha256).toBe(sha256(readFileSync(source.out, "utf8")));
  fixture(false, target => {
    const args = [`--reuse-inputs-from=${source.out}`];
    const dry = target.run(args); expect(dry.status).toBe(0);
    expect(JSON.parse(String(dry.stdout))).toMatchObject({ plannedCalls: 1, reusedObservations: 3 });
    expect(target.run([...args, "--execute", "--max-new-segments=1"]).status).toBe(0);
    const events = target.events(), run = analyzeCheckpoint(events, target.root);
    expect(run.aggregate.execution).toMatchObject({ kind: "mixed", newInferenceCalls: 1, reusedObservations: 3 });
    expect(run.aggregate.primary.matrix).toEqual({ tp: 3, fp: 1, tn: 0, fn: 0, incomplete: 0 });
    expect(events.filter(e => e.type === "response")).toHaveLength(1);
    for (const e of events.filter(e => e.type === "derived_observation")) {
      expect(e.sourceRequestId).toBe((original.value as any).requestId);
      expect(e.sourceSegmentId).toBe(original.segmentId);
      expect((e.value as any).sourceArtifact).toBe(sourcePath);
      expect((e.value as any).sourceTurnIds).toEqual(["source-" + String(e.caseId).slice(4)]);
      expect(e.raw).toEqual(sourceEvents.find(e => e.type === "response")!.raw);
    }
    expect(target.run([...args, "--execute"]).status).toBe(0);
    expect(target.events().filter(e => e.type === "dispatch")).toHaveLength(1);
    expect(target.run(["--execute"]).status).toBe(1);
    const chained = target.run(args); expect(chained.status).toBe(0);
    expect(() => readNativeInputSource(relative(target.root, target.out), engine, target.root)).toThrow("external reuse source");
    for (const edit of [
      (e: any) => e.raw = {},
      (e: any) => e.sourceSegmentId = "copied-segment",
      (e: any) => e.value.sourceArtifact = "same-run:wrong",
      (e: any) => e.value.rawScore = 0.1,
    ]) {
      const edited = structuredClone(events); edit(edited.find(e => e.type === "derived_observation"));
      expect(() => analyzeCheckpoint(edited, target.root)).toThrow();
    }
    const repeated = structuredClone(events), reused = repeated.find(e => e.type === "derived_observation")!;
    repeated.splice(1, 0, { type: "dispatch", caseId: reused.caseId, segmentId: reused.segmentId, requestId: "fabricated" });
    expect(() => auditPartialCheckpoint(repeated, target.root)).toThrow("exact within-run input");
    const before = readFileSync(target.out, "utf8");
    writeFileSync(source.out, readFileSync(source.out, "utf8") + "\n");
    expect(() => analyzeCheckpoint(events, target.root)).toThrow("hash/identity differs");
    expect(target.run([...args, "--execute"]).status).toBe(1);
    expect(readFileSync(target.out, "utf8")).toBe(before);
  });
}, Array(4).fill("same input")));

test("cross-study cache rejects incomplete and incompatible source protocols", () => fixture(false, source => {
  expect(source.run(["--execute", "--max-new-segments=1"]).status).toBe(0);
  const path = relative(source.root, source.out), engine = (source.events()[0]!.value as any).engine;
  expect(() => readNativeInputSource(path, engine, source.root)).toThrow();
  expect(source.run(["--execute"]).status).toBe(0);
  expect(() => readNativeInputSource(path, { ...engine, parameters: { ...engine.parameters, max_tokens: 65 } }, source.root)).toThrow("engine differs");
  expect(() => readNativeInputSource(path, { ...engine, kind: "task_context_llm" }, source.root)).toThrow();
}));

test("a completed limited source expands a full cohort without repeating its native inputs", () => fixture(false, source => {
  expect(source.run(["--execute", "--limit=1"]).status).toBe(0);
  const original = readFileSync(source.out, "utf8"), sourceEvents = source.events();
  expect(analyzeCheckpoint(sourceEvents, source.root).aggregate.limited).toBe(true);
  const engine = (sourceEvents[0]!.value as any).engine;
  const cache = readNativeInputSource(relative(source.root, source.out), engine, source.root);
  expect(cache.inputs.size).toBe(1);
  fixture(false, target => {
    const args = [`--reuse-inputs-from=${source.out}`];
    expect(JSON.parse(String(target.run(args).stdout))).toMatchObject({ cases: 4, plannedCalls: 1, reusedObservations: 3 });
    expect(target.run([...args, "--execute"]).status).toBe(0);
    const events = target.events(), aggregate = analyzeCheckpoint(events, target.root).aggregate;
    expect(aggregate.limited).toBe(false);
    expect(aggregate.execution).toMatchObject({ newInferenceCalls: 1, reusedObservations: 3 });
    expect(aggregate.primary.matrix).toEqual({ tp: 3, fp: 1, tn: 0, fn: 0, incomplete: 0 });
    const originalRequest = (sourceEvents.find(e => e.type === "observation")!.value as any).requestId;
    for (const e of events.filter(e => e.type === "derived_observation")) expect(e.sourceRequestId).toBe(originalRequest);
    expect(target.run([...args, "--execute"]).status).toBe(0);
    expect(target.events().filter(e => e.type === "dispatch")).toHaveLength(1);
    expect(readFileSync(source.out, "utf8")).toBe(original);
    // Altering the selected-source limit cannot manufacture completed coverage.
    const forged = structuredClone(sourceEvents); (forged[0]!.value as any).caseLimit = 2;
    writeFileSync(source.out, forged.map(e => JSON.stringify(e)).join("\n") + "\n");
    expect(() => readNativeInputSource(relative(source.root, source.out), engine, source.root)).toThrow();
    expect(target.run([...args, "--execute"]).status).toBe(1);
  });
}));

test("cross-study source survives a genuinely partial native tranche without repeat inference", () => fixture(false, source => {
  expect(source.run(["--execute"]).status).toBe(0);
  fixture(false, target => {
    const args = [`--reuse-inputs-from=${source.out}`, "--execute"];
    expect(target.run([...args, "--max-new-segments=1"]).status).toBe(0);
    expect([...auditPartialCheckpoint(target.events(), target.root).cases.values()].filter(c => c.status === "scored")).toHaveLength(2);
    expect(target.run(args).status).toBe(0);
    expect(analyzeCheckpoint(target.events(), target.root).aggregate.execution).toMatchObject({ newInferenceCalls: 2, reusedObservations: 2 });
    expect(target.events().filter(e => e.type === "dispatch")).toHaveLength(2);
  }, ["same input", "first new input", "second new input", "same input"]);
}, Array(4).fill("same input")));
