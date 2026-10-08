import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDataset } from "../src/datasets.js";
import { sha256 } from "../src/strategies.js";
import type { DatasetManifest } from "../src/types.js";

function loadRecords(format: DatasetManifest["source"]["format"], records: Record<string, unknown>[]) {
  const root = mkdtempSync(join(tmpdir(), "solenoid-legacy-dataset-"));
  const raw = format === "notinject-json" ? JSON.stringify({ cases: records }) : records.map(record => JSON.stringify(record)).join("\n") + "\n";
  const manifest: DatasetManifest = {
    schemaVersion: "security-eval-dataset/v1", id: "legacy-fixture", revision: `sha256:${sha256(raw)}`,
    source: { path: "cases.json", sha256: sha256(raw), format, visibility: "public" },
    expectedCases: records.length, annotationKey: "prompt_injection_attempt", positiveValues: ["injection"], negativeValues: ["benign"],
  };
  try {
    writeFileSync(join(root, "cases.json"), raw);
    return loadDataset(manifest, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("legacy dataset ID compatibility", () => {
  for (const format of ["llmail-jsonl", "notinject-json"] as const) {
    it(`normalizes nonnegative safe integer IDs and preserves text hashes in ${format}`, () => {
      const cases = loadRecords(format, [0, 1, Number.MAX_SAFE_INTEGER, "legacy-id"].map(id => ({ id, text: "A benign document", label: "benign", text_sha256: sha256("A benign document") })));
      expect(cases.map(item => item.id)).toEqual(["0", "1", String(Number.MAX_SAFE_INTEGER), "legacy-id"]);
      expect(cases.every(item => item.turns[0]?.id === `${item.id}/source` && item.textSha256 === sha256("A benign document"))).toBe(true);
    });

    it(`rejects invalid IDs, normalized duplicates, and case hash corruption in ${format}`, () => {
      for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, true, {}, [], "", "  "]) {
        expect(() => loadRecords(format, [{ id, text: "A benign document", label: "benign" }])).toThrow("Invalid case ID");
      }
      expect(() => loadRecords(format, [{ id: 1, text: "First", label: "benign" }, { id: "1", text: "Second", label: "benign" }])).toThrow("Duplicate case IDs");
      expect(() => loadRecords(format, [{ id: 1, text: "A benign document", label: "benign", text_sha256: "0".repeat(64) }])).toThrow("Case text hash mismatch");
    });
  }

  it("requires string IDs for canonical sources", () => {
    const record = { id: 1, label: "benign", turns: [{ id: "source", role: "document", origin: "external", text: "A benign document" }], text_sha256: sha256("A benign document") };
    expect(() => loadRecords("canonical-jsonl", [record])).toThrow("Invalid case ID");
    expect(loadRecords("canonical-jsonl", [{ ...record, id: "1" }])[0]?.id).toBe("1");
  });
});
