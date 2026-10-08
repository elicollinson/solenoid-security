/**
 * Artifacts: every file under evals/runs and evals/private (excluding upstream
 * clones) plus git-ignored evals/datasets/*.jsonl, gzipped to private Storage
 * (content-addressed) with one artifacts row per (path, sha256) snapshot.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { decode, readBytes, walk } from "../context.ts";
import type { Tx } from "../db.ts";
import { artifactKind, chunk, completeLines, mapLimit, sha256Hex, storageObjectFor } from "../lib.ts";
import { canReuseObject, existingObjectSizes, gzip } from "../storage.ts";

/** Upstream benchmark clones are never uploaded; only their pinned commit/URL is recorded (manifests). */
export function isUpstreamClone(rel: string): boolean {
  return /^evals\/private\/upstream\/[^/]+\//.test(rel);
}

export function backupPaths(root: string): string[] {
  const runs = walk(root, "evals/runs");
  const priv = walk(root, "evals/private", rel => /^evals\/private\/upstream\/[^/]+$/.test(rel)).filter(p => !isUpstreamClone(p));
  const datasets = walk(root, "evals/datasets").filter(p => p.endsWith(".jsonl"));
  return [...runs, ...priv, ...datasets];
}

export interface Snapshot { path: string; bytes: Uint8Array; sha: string; text?: string }

const known = new Map<string, number | null>(); // `${path}|${sha}` -> artifact_id (null in dry-run)

export async function preloadArtifacts(ctx: Ctx): Promise<void> {
  if (known.size) return;
  const rows = await ctx.db.query<{ path: string; sha256: string; artifact_id: number; storage_object: string | null }>(ctx.db.sql,
    `select path, sha256, artifact_id, storage_object from evals.artifacts`);
  for (const r of rows) if (r.storage_object) known.set(`${r.path}|${r.sha256}`, Number(r.artifact_id));
}

/**
 * Records one file snapshot: uploads the gzip copy if this (path, sha256) is new
 * and upserts the artifacts row. Returns artifact_id (null in dry-run).
 */
export async function ensureArtifact(ctx: Ctx, tx: Tx | null, snap: Snapshot): Promise<number | null> {
  const key = `${snap.path}|${snap.sha}`;
  if (known.has(key)) { ctx.stats.objectsSkipped++; return known.get(key)!; }
  const text = snap.text ?? (snap.path.match(/\.(jsonl|ndjson|json|md|log|txt|ts|py)$/) ? decode(snap.bytes) : undefined);
  const firstLine = text ? text.slice(0, Math.max(0, text.indexOf("\n"))) : undefined;
  const kind = artifactKind(snap.path, firstLine);
  const lineCount = text !== undefined ? completeLines(text).lines.length : null;
  const { bucket, object } = storageObjectFor(snap.path, snap.sha);
  const gz = gzip(snap.bytes);
  // Content-addressed key: an object left by an interrupted run is the same file, so reuse it instead of re-uploading.
  const prior = (await existingObjectSizes(ctx.db, bucket, [object])).get(object);
  let stored: number | null;
  if (canReuseObject(prior, gz.byteLength)) { stored = gz.byteLength; ctx.stats.objectsSkipped++; }
  else stored = await ctx.storage.putGzip(bucket, object, gz, "application/gzip");
  let mtime: string | null = null;
  try { mtime = statSync(join(ctx.root, snap.path)).mtime.toISOString(); } catch { /* removed meanwhile */ }
  const row = {
    path: snap.path, sha256: snap.sha, bytes: snap.bytes.byteLength, kind, content_type: contentTypeFor(snap.path), line_count: lineCount,
    storage_bucket: stored === null ? null : bucket, storage_object: stored === null ? null : object, storage_encoding: stored === null ? null : "gzip",
    stored_bytes: stored, file_mtime: mtime, git_ignored: !snap.path.startsWith("evals/reports/"),
  };
  const run = async (t: Tx) => {
    await ctx.db.write(t, "artifacts", [row], rs => `
      insert into evals.artifacts (path, sha256, bytes, kind, content_type, line_count, storage_bucket, storage_object, storage_encoding, stored_bytes, file_mtime, git_ignored)
      select t.path, t.sha256, t.bytes, t.kind, t.content_type, t.line_count, t.storage_bucket, t.storage_object, t.storage_encoding, t.stored_bytes, t.file_mtime, t.git_ignored
      from ${rs} as t(path text, sha256 text, bytes bigint, kind evals.artifact_kind, content_type text, line_count integer, storage_bucket text,
                      storage_object text, storage_encoding text, stored_bytes bigint, file_mtime timestamptz, git_ignored boolean)
      on conflict (path, sha256) do update set storage_bucket = excluded.storage_bucket, storage_object = excluded.storage_object,
        storage_encoding = excluded.storage_encoding, stored_bytes = excluded.stored_bytes
      where evals.artifacts.storage_object is null`);
    if (ctx.dryRun) return null;
    const got = await ctx.db.query<{ artifact_id: number }>(t, `select artifact_id from evals.artifacts where path = $1 and sha256 = $2`, [snap.path, snap.sha]);
    return got[0] ? Number(got[0].artifact_id) : null;
  };
  const id = tx ? await run(tx) : await ctx.db.tx(run);
  if (stored !== null) known.set(key, id);
  return id;
}

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return ({ json: "application/json", jsonl: "application/x-ndjson", ndjson: "application/x-ndjson", md: "text/markdown" } as Record<string, string>)[ext] ?? "text/plain";
}

export async function readSnapshot(ctx: Ctx, path: string): Promise<Snapshot> {
  const bytes = await readBytes(ctx.root, path);
  return { path, bytes, sha: sha256Hex(bytes) };
}

export async function importArtifacts(ctx: Ctx): Promise<void> {
  await preloadArtifacts(ctx);
  let paths = backupPaths(ctx.root);
  if (ctx.limit) paths = paths.slice(0, ctx.limit);
  let done = 0;
  for (const group of chunk(paths, 64)) {
    await mapLimit(group, 8, async path => {
      const snap = await readSnapshot(ctx, path);
      await ensureArtifact(ctx, null, snap);
    });
    done += group.length;
    if (ctx.verbose || done % 256 === 0 || done === paths.length) ctx.log(`  artifacts ${done}/${paths.length} (uploaded ${(ctx.stats.bytesUploaded / 1e6).toFixed(1)} MB)`);
  }
}
