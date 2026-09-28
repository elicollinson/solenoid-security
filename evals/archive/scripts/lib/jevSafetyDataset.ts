import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const JEV_SAFETY_SCHEMA_VERSION = "jev-safety-chunks/v1" as const;
export type Backend = "jev" | "llm";
export type Case = { id: number; text: string; label: "injection" | "benign"; technique: string | null; split?: string; category?: string; triggerWords?: string[] };
export type Chunk = {
  index: number;
  text: string;
  startWord: number;
  endWord: number;
  score: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Response-reported provider, when the API exposes one. */
  provider?: string | null;
  /** Distinguishes response verification from a request-side routing constraint. */
  provenance?: "response-verified" | "request-pinned-provider-unverified" | "legacy-unverified";
  /** Provider generation IDs for later provenance audit, when returned. */
  responseIds?: string[];
};
export type Row = { maxLength: number; iteration: number; id: number; label: Case["label"]; technique: string | null; backend: Backend; chunks: Chunk[]; score: number; flagged: boolean; correct: boolean };
export type InProgressRow = Pick<Row, "maxLength" | "iteration" | "id" | "backend"> & { chunks: Chunk[] };
export type Failure = { maxLength: number; iteration: number; id: number; backend: Backend; chunkIndex: number; kind: string; message: string; at: string };
export type Dataset = {
  schemaVersion: typeof JEV_SAFETY_SCHEMA_VERSION;
  status: "partial" | "complete";
  createdAt: string;
  updatedAt: string;
  metadata: {
    sourcePath: string;
    sourceSha256: string;
    cases: Case[];
    lengths: number[];
    iterations: number;
    seed: number;
    expectedRows: number;
    expectedChunkCallsPerBackend: number;
    threshold: number;
    jev: { model: string; questionVersion: string; questionSha256: string; providerSlug?: string; allowFallbacks?: false };
    llm: { routes: { provider: string; model: string }[]; promptVersion: string; promptSha256: string; actualModelKnown: boolean; providerSlug?: string; allowFallbacks?: false; routingMode?: "fixed-provider" | "legacy-mixed" };
    note: string;
  };
  dispatchedTopLevelCalls: number;
  reportedJevCostUsd: number;
  rows: Row[];
  inProgress: InProgressRow[];
  failures: Failure[];
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateDataset(data: Dataset): void {
  if (data.schemaVersion !== JEV_SAFETY_SCHEMA_VERSION || !["partial", "complete"].includes(data.status)) throw new Error("Unsupported Jev safety dataset version or status");
  if (!Array.isArray(data.metadata?.cases) || !Array.isArray(data.metadata.lengths) || !Array.isArray(data.rows) || !Array.isArray(data.inProgress) || !Array.isArray(data.failures)) throw new Error("Incomplete Jev safety dataset");
  const cases = new Map(data.metadata.cases.map(item => [item.id, item]));
  if (cases.size !== data.metadata.cases.length) throw new Error("Duplicate case IDs");
  const keys = new Set<string>();
  for (const row of data.rows) {
    const testCase = cases.get(row.id);
    if (!testCase || testCase.label !== row.label || !data.metadata.lengths.includes(row.maxLength) || !["jev", "llm"].includes(row.backend)) throw new Error("Invalid row identity");
    const key = `${row.maxLength}/${row.iteration}/${row.id}/${row.backend}`;
    if (keys.has(key)) throw new Error("Duplicate case/backend row");
    keys.add(key);
    if (!row.chunks.length || row.chunks.some((chunk, index) => chunk.index !== index || chunk.startWord < 0 || chunk.endWord <= chunk.startWord || chunk.endWord - chunk.startWord > row.maxLength || !Number.isFinite(chunk.score) || chunk.score < 0 || chunk.score > 1)) throw new Error("Invalid chunk data");
    const words = testCase.text.trim().split(/\s+/).filter(Boolean);
    if (row.chunks[0]?.startWord !== 0 || row.chunks.at(-1)?.endWord !== words.length || row.chunks.some((chunk, index) => chunk.text !== words.slice(chunk.startWord, chunk.endWord).join(" ") || (index > 0 && chunk.startWord !== row.chunks[index - 1]?.endWord))) throw new Error("Chunk text/boundaries differ from original case");
    const max = Math.max(...row.chunks.map(chunk => chunk.score));
    if (row.score !== max || row.flagged !== (max > data.metadata.threshold) || row.correct !== (row.flagged === (row.label === "injection"))) throw new Error("Invalid row aggregation");
  }
  for (const pending of data.inProgress) {
    const testCase = cases.get(pending.id);
    const key = `${pending.maxLength}/${pending.iteration}/${pending.id}/${pending.backend}`;
    if (!testCase || keys.has(key) || !data.metadata.lengths.includes(pending.maxLength) || !["jev", "llm"].includes(pending.backend)) throw new Error("Invalid in-progress row identity");
    keys.add(key);
    const words = testCase.text.trim().split(/\s+/).filter(Boolean);
    if (pending.chunks.some((chunk, index) => chunk.index !== index || chunk.startWord !== (index === 0 ? 0 : pending.chunks[index - 1]?.endWord) || chunk.endWord <= chunk.startWord || chunk.endWord - chunk.startWord > pending.maxLength || chunk.text !== words.slice(chunk.startWord, chunk.endWord).join(" ") || !Number.isFinite(chunk.score) || chunk.score < 0 || chunk.score > 1)) throw new Error("Invalid in-progress chunk data");
  }
  if (data.status === "complete" && (data.rows.length !== data.metadata.expectedRows || data.inProgress.length > 0)) throw new Error("Complete dataset has missing rows or pending chunks");
}

export function readDataset(path: string): Dataset {
  const data = JSON.parse(readFileSync(path, "utf8")) as Dataset;
  validateDataset(data);
  return data;
}

export function writeDataset(path: string, data: Dataset): void {
  validateDataset(data);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n");
  renameSync(temporary, path);
}
