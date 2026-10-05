#!/usr/bin/env bun
/**
 * Supabase importer for the injection-detection research data.
 *
 *   bun evals/db/import/cli.ts [--dry-run] [--only=<area>[,<area>]] [--limit=N] [--verbose]
 *
 * Areas, in dependency order: catalog, datasets, suites, artifacts, checkpoints,
 * bodies, legacy, ledgers, documents, behavior, finalize.
 * Reads evals/runs and evals/private read-only; never moves, locks or edits them.
 * Credentials come from the repo-root .env (Bun loads it): SUPABASE_DB_URL,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "./context.ts";
import { walk } from "./context.ts";
import { Db, Stats } from "./db.ts";
import { Storage } from "./storage.ts";
import { importCatalog, importSuites } from "./areas/catalog.ts";
import { importDatasets } from "./areas/datasets.ts";
import { importArtifacts } from "./areas/artifacts.ts";
import { importCheckpoints } from "./areas/checkpoints.ts";
import { importBodies } from "./areas/bodies.ts";
import { importLegacy } from "./areas/legacy.ts";
import { importLedgers } from "./areas/ledgers.ts";
import { importDocuments } from "./areas/documents.ts";
import { importBehavior } from "./areas/behavior.ts";

export const AREAS = ["catalog", "datasets", "suites", "artifacts", "checkpoints", "bodies", "legacy", "ledgers", "documents", "behavior", "finalize"] as const;
type Area = (typeof AREAS)[number];

export function parseArgs(argv: string[]): { dryRun: boolean; only: Area[]; limit: number | null; verbose: boolean } {
  const opt = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const only = (opt("only") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  for (const a of only) if (!(AREAS as readonly string[]).includes(a)) throw new Error(`Unknown area ${a}. Areas: ${AREAS.join(", ")}`);
  const limitText = opt("limit");
  const limit = limitText === undefined ? null : Number(limitText);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  const unknown = argv.filter(a => !/^--(dry-run|verbose|only=.*|limit=.*)$/.test(a));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);
  return { dryRun: argv.includes("--dry-run"), only: (only.length ? only : [...AREAS]) as Area[], limit, verbose: argv.includes("--verbose") };
}

/** Links that could not resolve when their target was imported later (derived sources, reuse sources, run ids). */
async function finalize(ctx: Ctx): Promise<void> {
  if (ctx.dryRun) return;
  const db = ctx.db;
  await db.tx(async tx => {
    await db.exec(tx, "relink: observations.request_id", `
      update evals.observations o set request_id = d.source_request_id
      from evals.observation_derivations d
      where d.observation_pk = o.observation_pk and o.request_id is null
        and exists (select 1 from evals.inference_requests q where q.request_id = d.source_request_id)`);
    await db.exec(tx, "relink: derivations.source_observation_pk", `
      update evals.observation_derivations d set source_observation_pk = x.observation_pk
      from evals.observations x
      where d.source_observation_pk is null and x.request_id = d.source_request_id and x.origin = 'native' and x.observation_pk <> d.observation_pk`);
    await db.exec(tx, "relink: run_sources", `
      update evals.run_sources s set source_run_pk = r.run_pk from evals.runs r
      where s.source_run_pk is null and r.run_id = s.source_run_id and r.run_pk <> s.run_pk`);
    await db.exec(tx, "relink: run_sources.artifact", `
      update evals.run_sources s set source_artifact_id = a.artifact_id from evals.artifacts a
      where s.source_artifact_id is null and a.path = s.source_checkpoint_path and a.sha256 = s.source_checkpoint_sha256`);
    await db.exec(tx, "relink: dataset_revisions.source_artifact_id", `
      update evals.dataset_revisions d set source_artifact_id = a.artifact_id from evals.artifacts a
      where d.source_artifact_id is null and a.path = d.source_path and a.sha256 = d.source_sha256`);
    await db.exec(tx, "relink: batch_cells.run_pk", `
      update evals.batch_cells c set run_pk = r.run_pk from evals.research_batches b, evals.runs r
      where c.run_pk is null and b.batch_pk = c.batch_pk and r.run_id = b.suite_id || '/' || c.test_id || '/' || c.condition_id`);
    await db.exec(tx, "relink: spend_ledger_entries.run_pk", `
      update evals.spend_ledger_entries l set run_pk = r.run_pk from evals.runs r where l.run_pk is null and r.run_id = l.run_id`);
    await db.exec(tx, "relink: coverage_cells.run_pk", `
      update evals.coverage_cells c set run_pk = r.run_pk from evals.runs r where c.run_pk is null and r.run_id = c.run_id`);
  });
  await db.sql.unsafe("analyze");
}

async function storageUsage(db: Db): Promise<{ bucket: string; objects: number; bytes: number }[]> {
  return db.query(db.sql, `select bucket_id as bucket, count(*)::int as objects, coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
    from storage.objects group by bucket_id order by bucket_id`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const dbUrl = process.env.SUPABASE_DB_URL, url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!dbUrl || !url || !key) throw new Error("SUPABASE_DB_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) must be set (repo-root .env)");
  const stats = new Stats();
  const db = new Db(dbUrl, args.dryRun, stats, args.verbose);
  const storage = new Storage(url, key, args.dryRun, stats);
  const started = Date.now();
  const ctx: Ctx = { root, db, storage, stats, limit: args.limit, verbose: args.verbose, dryRun: args.dryRun,
    log: message => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${message}`) };
  console.log(`evals db import${args.dryRun ? " (dry run: no writes, no uploads)" : ""}; areas: ${args.only.join(", ")}${args.limit ? `; limit ${args.limit}` : ""}`);
  try {
    for (const area of args.only) {
      ctx.log(`area ${area}`);
      if (area === "catalog") await importCatalog(ctx);
      else if (area === "datasets") await importDatasets(ctx);
      else if (area === "suites") await importSuites(ctx, walk(root, "evals/suites").filter(p => p.endsWith(".json")));
      else if (area === "artifacts") await importArtifacts(ctx);
      else if (area === "checkpoints") await importCheckpoints(ctx);
      else if (area === "bodies") await importBodies(ctx);
      else if (area === "legacy") await importLegacy(ctx);
      else if (area === "ledgers") await importLedgers(ctx);
      else if (area === "documents") await importDocuments(ctx);
      else if (area === "behavior") { if (!args.dryRun) await importBehavior(ctx); }
      else if (area === "finalize") await finalize(ctx);
    }
  } finally {
    console.log(`\nRows ${args.dryRun ? "that would be written" : "written"} per table:`);
    for (const [table, n] of [...stats.rows.entries()].sort()) console.log(`  ${String(n).padStart(9)}  ${table}`);
    console.log(`Storage: ${stats.objectsUploaded} object(s), ${(stats.bytesUploaded / 1e6).toFixed(2)} MB gzip ${args.dryRun ? "would be uploaded" : "uploaded"}; ${stats.objectsSkipped} unchanged file(s) skipped`);
    console.log(`Storage errors: ${stats.storageRetries} retried attempt(s) ${JSON.stringify(Object.fromEntries(stats.storageStatuses))}, ${stats.storageFailures} upload(s) failed after retries (left for the next run)`);
    if (!args.dryRun) {
      try {
        for (const b of await storageUsage(db)) console.log(`  bucket ${b.bucket}: ${b.objects} objects, ${(Number(b.bytes) / 1e6).toFixed(2)} MB`);
        const [size] = await db.query<{ size: string }>(db.sql, `select pg_size_pretty(pg_database_size(current_database())) as size`);
        console.log(`Database size: ${size?.size}`);
      } catch { /* reporting only */ }
    }
    console.log(`Warnings: ${stats.warnings.length}`);
    console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(0)}s`);
    await db.close();
  }
}

if (import.meta.main) {
  main().catch(e => { console.error(`import failed: ${(e as Error).message}`); process.exit(1); });
}
