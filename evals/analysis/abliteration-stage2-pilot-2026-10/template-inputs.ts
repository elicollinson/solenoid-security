/**
 * Template audit, step 1 of 2 (abliteration stage 2, #23; Claude Code 2026-10-27). Offline and read-only: never calls a
 * model or LM Studio and never writes to a checkpoint. A narrowed copy of qwen38-effort-calibration-2026-10/effort-inputs.ts:
 * rebuilds the exact user-message text of the 998 pilot cases from the pilot's vanilla Qwen3.8 checkpoints
 * (abliteration-pilot-2026-10, all three pilot conditions, so a case one build abstained on is covered by the other), verifying every segment's SHA-256 against the
 * observation. The output holds case text, so it goes to WORK_DIR (default evals/runs/abliteration-stage2-pilot-2026-10/
 * template-audit, git-ignored) and is never published.
 *   DATA_ROOT=<checkout with evals/private> bun evals/analysis/abliteration-stage2-pilot-2026-10/template-inputs.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { loadDataset } from "../../src/datasets.js";
import { segmentCase } from "../../src/strategies.js";
import type { DatasetManifest, InputStrategy } from "../../src/types.js";

const repo = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : repo;
const runDir = resolve(repo, "evals/runs/abliteration-pilot-2026-10");
const workDir = resolve(repo, process.env.WORK_DIR ?? "evals/runs/abliteration-stage2-pilot-2026-10/template-audit");
const texts = new Map<string, { datasetId: string; testId: string; caseId: string; text: string }>();
for (const test of readdirSync(runDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const name of readdirSync(resolve(runDir, test.name)).filter(f => f.startsWith("pilot-") && f.endsWith("-full.jsonl"))) {
  const file = resolve(runDir, test.name, name);
  const events = readCompleteJsonl(readFileSync(file, "utf8")).events as any[];
  const meta = events.find(e => e.type === "metadata")!.value;
  const strategy = meta.inputStrategy as InputStrategy;
  if (strategy.kind !== "full_text") throw new Error(`Unexpected strategy ${strategy.kind}`);
  const cases = loadDataset(JSON.parse(readFileSync(resolve(repo, `evals/datasets/${meta.datasetId}.json`), "utf8")) as DatasetManifest, dataRoot);
  const segs = new Map<string, { sha: string; text: string; caseId: string }>();
  for (const item of cases) for (const s of segmentCase(item, strategy)) segs.set(s.id, { sha: s.textSha256, text: s.text, caseId: item.id });
  for (const e of events) {
    if (e.type !== "observation") continue;
    const s = segs.get(e.value.segmentId);
    if (!s || s.sha !== e.value.inputSha256) throw new Error(`Input mismatch ${test.name} ${e.value.segmentId}`);
    texts.set(e.value.inputSha256, { datasetId: meta.datasetId, testId: test.name, caseId: s.caseId, text: s.text });
  }
  }
}
mkdirSync(workDir, { recursive: true });
writeFileSync(resolve(workDir, "inputs.jsonl"), [...texts].map(([inputSha256, v]) => JSON.stringify({ inputSha256, ...v })).join("\n") + "\n");
console.error(`unique pilot inputs ${texts.size} -> ${resolve(workDir, "inputs.jsonl")}`);
