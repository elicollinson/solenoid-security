/** Reuse complete captured inference only when the new plan has exactly matching engine/input/context. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCheckpoint, readLiveCheckpoint, rebindObservation, type Event, type Metadata, type Suite } from "./analyze-research.js";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { taskContextForCase } from "../src/engines.js";
import { segmentCase, sha256 } from "../src/strategies.js";
import type { DatasetManifest, InferenceObservation } from "../src/types.js";

interface DeriveOptions { sourceCheckpoint: string; suitePath: string; testId: string; conditionId: string; outputPath?: string; runId?: string; }
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

export function deriveEquivalentRun(options: DeriveOptions, root: string) {
  const sourceCheckpoint = relative(root, resolve(root, options.sourceCheckpoint));
  const source = readLiveCheckpoint(sourceCheckpoint, root);
  const suiteText = readFileSync(resolve(root, options.suitePath), "utf8"), suite = JSON.parse(suiteText) as Suite;
  check(suite.schemaVersion === "security-eval-suite/v1", "Unsupported target suite");
  const test = suite.tests.find(item => item.id === options.testId), condition = suite.conditions.find(item => item.id === options.conditionId);
  check(test && condition && condition.repeat === 1 && (!condition.testIds || condition.testIds.includes(test.id)), "Invalid target condition/test");
  const strategy = suite.inputStrategies[condition.inputStrategy], rule = suite.decisionRules[condition.decisionRule];
  check(strategy && rule && suite.engines[condition.engine], "Invalid target configuration");
  const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${test.datasetId}.json`), "utf8")) as DatasetManifest;
  check(source.metadata.datasetId === manifest.id && source.metadata.datasetRevision === manifest.revision, "Source and target datasets differ");
  const cases = selectTestCases(loadDataset(manifest, root), manifest, test);
  check(cases.length === source.metadata.expectedCases, "Source and target cohorts differ");
  const tasks = cases.flatMap(item => segmentCase(item, strategy).map(segment => ({ item, segment })));
  const metadata: Metadata = {
    schemaVersion: "security-eval-run/v1", runId: options.runId ?? `${suite.id}/${test.id}/${condition.id}`,
    suiteId: suite.id, suiteSha256: sha256(suiteText), datasetId: manifest.id, datasetRevision: manifest.revision,
    datasetSha256: manifest.source.sha256, testId: test.id, conditionId: condition.id, engine: source.metadata.engine,
    inputStrategy: strategy, decisionRule: rule, expectedCases: cases.length, expectedSegments: tasks.length,
    derivedFrom: { version: "exact-segment-equivalence/v1", sourceCheckpoint, sourceCheckpointSha256: sha256(source.text), sourceRunId: source.metadata.runId },
    newInferenceCalls: 0,
  };
  const originalObservations = new Map<string, InferenceObservation>(), originalResponses = new Map<string, unknown>();
  for (const event of source.events) {
    if (event.type === "observation") { const observation = event.value as InferenceObservation; originalObservations.set(observation.segmentId, observation); }
    else if (event.type === "response") originalResponses.set(String(event.requestId), event.raw);
  }
  const originalTasks = cases.flatMap(item => segmentCase(item, source.metadata.inputStrategy).map(segment => ({ item, segment })));
  const usedSourceSegments = new Set<string>();
  const events: Event[] = [{ type: "metadata", value: metadata }];
  for (const { item, segment } of tasks) {
    const expectedContext = metadata.engine.kind === "task_context_llm" ? sha256(JSON.stringify(taskContextForCase(item, segment))) : undefined;
    const match = originalTasks.find(candidate => {
      const original = originalObservations.get(candidate.segment.id);
      return !usedSourceSegments.has(candidate.segment.id) && original && original.caseId === item.id &&
        candidate.segment.textSha256 === segment.textSha256 && same(candidate.segment.turnIds, segment.turnIds) && original.contextSha256 === expectedContext &&
        (candidate.segment.startWord === undefined || segment.startWord === undefined || candidate.segment.startWord === segment.startWord && candidate.segment.endWord === segment.endWord);
    });
    check(match, "Target segment has no exact source inference match");
    const original = originalObservations.get(match.segment.id)!;
    usedSourceSegments.add(match.segment.id);
    events.push({ type: "derived_observation", caseId: item.id, segmentId: segment.id,
      value: rebindObservation(original, metadata, segment, sourceCheckpoint), raw: originalResponses.get(original.requestId!),
      sourceSegmentId: original.segmentId, sourceRequestId: original.requestId, sourceObservationSha256: sha256(JSON.stringify(original)) });
  }
  events.push({ type: "complete", observations: tasks.length });
  // The analyzer independently validates target suite binding, source SHA, original provenance, and every rebound field.
  const analysis = analyzeCheckpoint(events, root);
  const output = resolve(root, options.outputPath ?? `evals/runs/${suite.id}/${test.id}/${condition.id}.jsonl`);
  check(output.startsWith(resolve(root, "evals/runs") + "/") && output.endsWith(".jsonl") && output !== source.path, "Derived output must be a separate ignored checkpoint");
  const physicalRunRoot = realpathSync(resolve(root, "evals/runs"));
  let existingAncestor = existsSync(output) ? output : dirname(output);
  while (!existsSync(existingAncestor)) existingAncestor = dirname(existingAncestor);
  const physicalAncestor = realpathSync(existingAncestor);
  check(physicalAncestor === physicalRunRoot || physicalAncestor.startsWith(physicalRunRoot + "/"), "Derived output cannot escape ignored runs through a symbolic link");
  const text = events.map(event => JSON.stringify(event)).join("\n") + "\n";
  if (existsSync(output)) check(readFileSync(output, "utf8") === text, "Existing derived checkpoint differs; choose a new output");
  else { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, text); }
  return { output, sourceCheckpoint, runId: metadata.runId, cases: cases.length, observations: tasks.length, newInferenceCalls: 0, incrementalCostUsd: 0, analysis };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url)), args = process.argv.slice(2);
  const option = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sourceCheckpoint = option("source"), suitePath = option("suite"), testId = option("test"), conditionId = option("condition");
  check(sourceCheckpoint && suitePath && testId && conditionId, "--source, --suite, --test, and --condition are required");
  const { analysis: _analysis, ...summary } = deriveEquivalentRun({ sourceCheckpoint, suitePath, testId, conditionId, outputPath: option("output"), runId: option("run-id") }, root);
  console.log(JSON.stringify(summary));
}
