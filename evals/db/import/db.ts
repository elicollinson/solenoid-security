/** Postgres access for the importer (Bun's built-in client) plus row statistics. */
import { SQL } from "bun";
import { pgJson } from "./lib.ts";

export type Tx = SQL;

export class Stats {
  readonly rows = new Map<string, number>();
  readonly warnings: string[] = [];
  bytesUploaded = 0;
  objectsUploaded = 0;
  objectsSkipped = 0;
  storageRetries = 0;
  storageFailures = 0;
  readonly storageStatuses = new Map<string, number>();
  add(table: string, n: number): void { if (n) this.rows.set(table, (this.rows.get(table) ?? 0) + n); }
  warn(message: string): void { this.warnings.push(message); console.warn(`  warn: ${message}`); }
}

export class Db {
  readonly sql: SQL;
  constructor(url: string, readonly dryRun: boolean, readonly stats: Stats, readonly verbose: boolean) {
    // Small pool. No idle timeout: a per-file transaction can wait on parsing between statements.
    this.sql = new SQL({ url, max: 4, idleTimeout: 0, maxLifetime: 0, connectionTimeout: 60 });
  }

  async close(): Promise<void> { await this.sql.close(); }

  /** One transaction per file. In dry-run mode writes are counted, not executed. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.dryRun) return fn(this.sql);
    return this.sql.begin(async tx => fn(tx as unknown as Tx)) as Promise<T>;
  }

  async query<T = any>(tx: Tx, text: string, params: unknown[] = []): Promise<T[]> {
    return (await tx.unsafe(text, params as any[])) as unknown as T[];
  }

  /**
   * Batched write through jsonb_to_recordset: `build(recordset)` returns the SQL with
   * the recordset expression substituted for the rows parameter ($1); `extra` binds $2.. Rows are
   * split by count and by JSON size. Returns the number of rows Postgres reports.
   */
  async write(tx: Tx, table: string, rows: readonly unknown[], build: (recordset: string) => string, extra: unknown[] = [], maxRows = 2000): Promise<number> {
    if (!rows.length) return 0;
    if (this.dryRun) { this.stats.add(table, rows.length); return rows.length; }
    const recordset = "jsonb_to_recordset(($1::text)::jsonb)";
    const text = build(recordset);
    let written = 0;
    let batch: unknown[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const result = (await tx.unsafe(text, [pgJson(batch), ...extra] as any[])) as unknown as { count?: number; length: number };
      written += typeof result.count === "number" ? result.count : result.length;
      batch = []; size = 0;
    };
    for (const row of rows) {
      const approx = pgJson(row).length;
      if (batch.length && (batch.length >= maxRows || size + approx > 16_000_000)) await flush();
      batch.push(row); size += approx;
    }
    await flush();
    this.stats.add(table, written);
    return written;
  }

  /** A single statement that writes (counted under `table`); skipped in dry-run. */
  async exec(tx: Tx, table: string, text: string, params: unknown[] = []): Promise<number> {
    if (this.dryRun) return 0;
    const result = (await tx.unsafe(text, params as any[])) as unknown as { count?: number; length: number };
    const n = typeof result.count === "number" ? result.count : result.length;
    if (table) this.stats.add(table, n);
    return n;
  }

  // -------------------------------------------------------------------------
  // import_files bookkeeping
  // -------------------------------------------------------------------------

  async importState(area: string): Promise<Map<string, { sha256: string; status: string }>> {
    const rows = await this.query<{ path: string; sha256: string; status: string }>(this.sql,
      `select path, sha256, status from evals.import_files where area = $1`, [area]);
    return new Map(rows.map(r => [r.path, { sha256: r.sha256, status: r.status }]));
  }

  async markImported(tx: Tx, area: string, path: string, sha256: string, bytes: number, status: string, rows: Record<string, number>, note: string | null, version: string): Promise<void> {
    await this.exec(tx, "", `insert into evals.import_files (area, path, sha256, bytes, status, rows, note, importer_version, completed_at)
      values ($1, $2, $3, $4, $5, ($6::text)::jsonb, $7, $8, now())
      on conflict (area, path) do update set sha256 = excluded.sha256, bytes = excluded.bytes, status = excluded.status,
        rows = excluded.rows, note = excluded.note, importer_version = excluded.importer_version, completed_at = now()`,
      [area, path, sha256, bytes, status, pgJson(rows), note, version]);
  }
}
