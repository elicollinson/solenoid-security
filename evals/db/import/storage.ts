/** Supabase Storage uploads (private buckets) through the REST API with the secret key. */
import type { Db, Stats } from "./db.ts";

export const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export class Storage {
  private readonly base: string;
  constructor(url: string, private readonly key: string, private readonly dryRun: boolean, private readonly stats: Stats) {
    this.base = url.replace(/\/+$/, "") + "/storage/v1";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  /** Uploads gzip bytes (idempotent upsert). Returns stored size, or null when skipped (too large). */
  async putGzip(bucket: string, object: string, gz: Uint8Array, contentType: string): Promise<number | null> {
    if (gz.byteLength > MAX_OBJECT_BYTES) { this.stats.warn(`object over 50 MB not uploaded: ${bucket}/${object}`); return null; }
    if (this.dryRun) { this.stats.bytesUploaded += gz.byteLength; this.stats.objectsUploaded++; return gz.byteLength; }
    const url = `${this.base}/object/${bucket}/${object.split("/").map(encodeURIComponent).join("/")}`;
    let lastError = "";
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: this.headers({ "content-type": contentType, "content-encoding": "identity", "x-upsert": "true", "cache-control": "max-age=31536000" }),
          body: gz,
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) { this.stats.bytesUploaded += gz.byteLength; this.stats.objectsUploaded++; return gz.byteLength; }
        lastError = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
        this.stats.storageStatuses.set(String(res.status), (this.stats.storageStatuses.get(String(res.status)) ?? 0) + 1);
        if (res.status < 500 && res.status !== 429 && res.status !== 408) break;
      } catch (e) { lastError = (e as Error).message; this.stats.storageStatuses.set("network", (this.stats.storageStatuses.get("network") ?? 0) + 1); }
      this.stats.storageRetries++;
      if (attempt >= 3) console.warn(`  storage retry ${attempt} for ${bucket}/${object}: ${lastError.slice(0, 120)}`);
      await Bun.sleep(Math.min(30_000, 500 * 2 ** attempt));
    }
    this.stats.storageFailures++;
    throw new Error(`Storage upload failed for ${bucket}/${object}: ${lastError}`);
  }

}

/**
 * Sizes of objects that already exist in a bucket, read from storage.objects with SQL (no HTTP).
 * Used to skip re-uploading objects a crashed or restarted run already stored: every Storage upload
 * costs one rolled-back transaction inside the Storage API (its permission probe), even with x-upsert.
 */
export async function existingObjectSizes(db: Db, bucket: string, names: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (db.dryRun || !names.length) return out;
  for (let i = 0; i < names.length; i += 1000) {
    const rows = await db.query<{ name: string; size: string | null }>(db.sql,
      `select name, metadata->>'size' as size from storage.objects where bucket_id = $1 and name = any(($2::text)::text[])`,
      [bucket, pgTextArray(names.slice(i, i + 1000))]);
    for (const r of rows) if (r.size !== null) out.set(r.name, Number(r.size));
  }
  return out;
}

/** An existing object is reused only when its stored size equals the gzip we would upload (keys are deterministic). */
export function canReuseObject(existingSize: number | undefined, gzBytes: number): boolean {
  return existingSize !== undefined && existingSize === gzBytes;
}

/** Postgres text[] literal (passed as text and cast, which avoids array-parameter binding quirks). */
export function pgTextArray(values: readonly string[]): string {
  return "{" + values.map(v => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
}

export function gzip(bytes: Uint8Array | string): Uint8Array {
  return Bun.gzipSync(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, { level: 6 });
}
