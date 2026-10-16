/**
 * Effort audit, step 1 of 2 (#33). Offline and read-only: never calls a model and never writes to a checkpoint.
 *
 * Rebuilds the exact user-message text behind every saved Studio Q8 response so that `effort-audit.py` can hand-render
 * each model's chat template and compare the token count with the server's `prompt_tokens`. For each checkpoint it
 * reads the metadata (dataset, input strategy), loads the dataset with the repo loader, segments every case with the
 * recorded strategy and keeps the segments whose ID and SHA-256 match an observation's `segmentId`/`inputSha256`.
 * Any mismatch aborts.
 *
 * The output holds case text, so it goes to WORK_DIR (default evals/runs/qwen38-effort-calibration-2026-10, which is
 * git-ignored) and is never published. Run from the repository root:
 *   DATA_ROOT=<checkout with evals/private> bun evals/analysis/qwen38-effort-calibration-2026-10/effort-inputs.ts
 * Env: RUNS_ROOT (default evals/runs), DATA_ROOT (default repo root), WORK_DIR.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCompleteJsonl } from "../../src/researchMatrix.js";
import { loadDataset } from "../../src/datasets.js";
import { segmentCase } from "../../src/strategies.js";
import type { DatasetManifest, EvalCase, InputStrategy } from "../../src/types.js";

const repo = resolve(import.meta.dir, "../../..");
const dataRoot = process.env.DATA_ROOT ? resolve(process.env.DATA_ROOT) : repo;
const runsRoot = resolve(repo, process.env.RUNS_ROOT ?? "evals/runs");
const workDir = resolve(repo, process.env.WORK_DIR ?? "evals/runs/qwen38-effort-calibration-2026-10");
// Baseline (7 models x 21 tests, plus the deferred Qwen3.6 27B partial) and the abliteration pilot (3 Qwen3.8 builds).
const RUNS = [
  { dir: "studio-baseline-t4096-2026-10-07", prefix: "baseline-" },
  { dir: "abliteration-pilot-2026-10", prefix: "pilot-" },
];

const datasets = new Map<string, EvalCase[]>();
const texts = new Map<string, { datasetId: string; segmentId: string; text: string }>();
let files = 0, matched = 0;
for (const run of RUNS) {
  const runDir = resolve(runsRoot, run.dir);
  for (const test of readdirSync(runDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== "qualification")) {
    for (const name of readdirSync(resolve(runDir, test.name)).filter(f => f.startsWith(run.prefix) && f.endsWith("-full.jsonl"))) {
      const events = readCompleteJsonl(readFileSync(resolve(runDir, test.name, name), "utf8")).events as any[];
      const meta = events.find(e => e.type === "metadata")?.value;
      if (!meta) throw new Error(`No metadata in ${run.dir}/${test.name}/${name}`);
      const strategy = meta.inputStrategy as InputStrategy;
      if (strategy.kind !== "full_text") throw new Error(`Unexpected strategy ${strategy.kind}`);
      if (!datasets.has(meta.datasetId)) {
        const manifestPath = resolve(repo, `evals/datasets/${meta.datasetId}.json`);
        if (!existsSync(manifestPath)) throw new Error(`Missing manifest ${meta.datasetId}`);
        datasets.set(meta.datasetId, loadDataset(JSON.parse(readFileSync(manifestPath, "utf8")) as DatasetManifest, dataRoot));
      }
      const segs = new Map<string, { sha: string; text: string }>();
      for (const item of datasets.get(meta.datasetId)!) for (const s of segmentCase(item, strategy)) segs.set(s.id, { sha: s.textSha256, text: s.text });
      for (const e of events) {
        if (e.type !== "observation") continue;
        const o = e.value, s = segs.get(o.segmentId);
        if (!s || s.sha !== o.inputSha256) throw new Error(`Input mismatch ${run.dir}/${test.name}/${name} ${o.segmentId}`);
        texts.set(o.inputSha256, { datasetId: meta.datasetId, segmentId: o.segmentId, text: s.text });
        matched++;
      }
      files++;
    }
  }
}
mkdirSync(workDir, { recursive: true });
writeFileSync(resolve(workDir, "inputs.jsonl"), [...texts].map(([inputSha256, v]) => JSON.stringify({ inputSha256, ...v })).join("\n") + "\n");
console.error(`files ${files}, observations matched ${matched}, unique inputs ${texts.size} -> ${resolve(workDir, "inputs.jsonl")}`);
