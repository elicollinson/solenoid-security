import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import type { DatasetManifest, EvalTest } from "../src/types.js";

const root = new URL("../../", import.meta.url).pathname;
const sources = [
  ["in-page-wild-sample-v1", 240, 240],
  ["agent-injection-bench-v1", 142, 40],
  ["agentdojo-travel-v1", 18, 3],
] as const;

function manifest(id: string): DatasetManifest {
  return JSON.parse(readFileSync(`${root}evals/datasets/${id}.json`, "utf8")) as DatasetManifest;
}
function hasCases(id: string): boolean { return existsSync(`${root}evals/datasets/${id}.jsonl`); }

describe("public prompt-injection cohorts", () => {
  it("pins source repositories, commits, and generated hashes", () => {
    for (const [id] of sources) {
      const metadata = manifest(id) as DatasetManifest & { provenance: { repository: string; commit: string } };
      expect(metadata.source.path).toBe(`evals/datasets/${id}.jsonl`);
      expect(metadata.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.provenance.repository.startsWith("https://github.com/")).toBe(true);
      expect(metadata.provenance.commit).toMatch(/^[a-f0-9]{40}$/);
    }
  });

  for (const [id, positives, negatives] of sources) {
    (hasCases(id) ? it : it.skip)(`loads and selects both classes in ${id}`, () => {
      const metadata = manifest(id);
      const cases = loadDataset(metadata, root);
      expect(cases).toHaveLength(positives + negatives);
      const test: EvalTest = { id: "class-test", datasetId: id, datasetRevision: metadata.revision, annotationKey: metadata.annotationKey, caseSelector: "positive", metrics: ["detection_rate"] };
      expect(selectTestCases(cases, metadata, test)).toHaveLength(positives);
      expect(selectTestCases(cases, metadata, { ...test, caseSelector: "negative", metrics: ["false_positive_rate"] })).toHaveLength(negatives);
      expect(selectTestCases(cases, metadata, { ...test, caseSelector: "all" })).toHaveLength(positives + negatives);
      expect(cases.every(item => item.turns.some(turn => turn.origin === "external"))).toBe(true);
      expect(cases.every(item => item.facets.source !== undefined)).toBe(true);
    });
  }

  (hasCases("agent-injection-bench-v1") && hasCases("agentdojo-travel-v1") ? it : it.skip)("keeps agent task context separate from external material", () => {
    for (const id of ["agent-injection-bench-v1", "agentdojo-travel-v1"]) {
      const cases = loadDataset(manifest(id), root);
      expect(cases.every(item => item.turns.some(turn => turn.origin === "operator") && item.turns.some(turn => turn.origin === "external"))).toBe(true);
    }
  });

  (hasCases("agentdojo-travel-v1") ? it : it.skip)("rejects source and case hash corruption", () => {
    const metadata = manifest("agentdojo-travel-v1");
    expect(() => loadDataset({ ...metadata, source: { ...metadata.source, sha256: "0".repeat(64) } }, root)).toThrow("SHA-256 mismatch");
    const temp = mkdtempSync(join(tmpdir(), "solenoid-dataset-") );
    try {
      const original = readFileSync(`${root}${metadata.source.path}`, "utf8");
      const records = original.trimEnd().split("\n");
      const first = JSON.parse(records[0]!) as Record<string, unknown>;
      delete first.text_sha256;
      records[0] = JSON.stringify(first);
      const malformed = records.join("\n") + "\n";
      writeFileSync(join(temp, "malformed.jsonl"), malformed);
      const invalid: DatasetManifest = { ...metadata, source: { ...metadata.source, path: "malformed.jsonl", sha256: createHash("sha256").update(malformed).digest("hex") } };
      expect(() => loadDataset(invalid, temp)).toThrow("Case text hash mismatch");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
