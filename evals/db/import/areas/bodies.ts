/**
 * Raw native response bodies: one gzipped object per response in the private
 * eval-runs bucket (responses/<run_id>/<request_id>.json.gz). Resumable: picks up
 * every response row whose raw_storage_object is still null, re-reads its line
 * from the checkpoint (append-only, so line numbers are stable) and checks the
 * body hash before uploading. Objects that already exist with the same gzip size (stored by a run
 * that died before recording them) are recorded without a second upload.
 */
import type { Ctx } from "../context.ts";
import { decode, readBytes } from "../context.ts";
import { chunk, completeLines, jsonSha, mapLimit, responseObjectFor } from "../lib.ts";
import { canReuseObject, existingObjectSizes, gzip } from "../storage.ts";

interface Pending { request_id: string; raw_sha256: string; raw_line_no: number; path: string; run_id: string }

export async function importBodies(ctx: Ctx, concurrency = Number(process.env.DB_IMPORT_UPLOAD_CONCURRENCY ?? 32)): Promise<void> {
  const pending = await ctx.db.query<Pending>(ctx.db.sql, `
    select r.request_id::text, r.raw_sha256, r.raw_line_no, a.path, ru.run_id
    from evals.responses r
    join evals.inference_requests q on q.request_id = r.request_id
    join evals.runs ru on ru.run_pk = q.run_pk
    join evals.artifacts a on a.artifact_id = r.raw_artifact_id
    where r.raw_storage_object is null and r.raw_line_no is not null
    order by a.path, r.raw_line_no
    ${ctx.limit ? `limit ${Number(ctx.limit)}` : ""}`);
  if (!pending.length) { ctx.log("  no response bodies pending"); return; }
  const byPath = new Map<string, Pending[]>();
  for (const p of pending) { const list = byPath.get(p.path) ?? []; list.push(p); byPath.set(p.path, list); }
  let done = 0;
  for (const [path, list] of byPath) {
    let lines: string[];
    try { lines = completeLines(decode(await readBytes(ctx.root, path))).lines; }
    catch (e) { ctx.stats.warn(`bodies: cannot read ${path}: ${(e as Error).message}`); continue; }
    for (const group of chunk(list, 1000)) {
      const existing = await existingObjectSizes(ctx.db, "eval-runs", group.map(item => responseObjectFor(item.run_id, item.request_id)));
      const updates = (await mapLimit(group, concurrency, async item => {
        const line = lines[item.raw_line_no - 1];
        if (!line) { ctx.stats.warn(`bodies: ${path} line ${item.raw_line_no} missing`); return null; }
        const ev = JSON.parse(line);
        if (ev.requestId !== item.request_id || jsonSha(ev.raw) !== item.raw_sha256) {
          ctx.stats.warn(`bodies: ${path} line ${item.raw_line_no} no longer matches request ${item.request_id}`);
          return null;
        }
        const object = responseObjectFor(item.run_id, item.request_id);
        const gz = gzip(JSON.stringify(ev.raw));
        if (canReuseObject(existing.get(object), gz.byteLength)) { ctx.stats.objectsSkipped++; return { request_id: item.request_id, object, stored: gz.byteLength }; }
        let stored: number | null;
        try { stored = await ctx.storage.putGzip("eval-runs", object, gz, "application/gzip"); }
        catch (e) { ctx.stats.warn(`bodies: ${(e as Error).message.slice(0, 200)} (left for the next run)`); return null; }
        return stored === null ? null : { request_id: item.request_id, object, stored };
      })).filter((u): u is { request_id: string; object: string; stored: number } => u !== null);
      await ctx.db.tx(tx => ctx.db.write(tx, "responses (raw body stored)", updates, rs => `
        update evals.responses r set raw_storage_bucket = 'eval-runs', raw_storage_object = t.object, raw_stored_bytes = t.stored
        from ${rs} as t(request_id uuid, object text, stored integer)
        where r.request_id = t.request_id and r.raw_storage_object is null`));
      done += group.length;
      if (done % 10000 < group.length) ctx.log(`  bodies ${done}/${pending.length} (uploaded ${(ctx.stats.bytesUploaded / 1e6).toFixed(1)} MB)`);
    }
    if (ctx.verbose) ctx.log(`  bodies ${done}/${pending.length} (uploaded ${(ctx.stats.bytesUploaded / 1e6).toFixed(1)} MB)`);
  }
}
