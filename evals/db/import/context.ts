/** Shared importer context and file helpers. Reads the repo; never writes to it. */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Db, Stats } from "./db.ts";
import type { Storage } from "./storage.ts";

export interface Ctx {
  root: string;
  db: Db;
  storage: Storage;
  stats: Stats;
  limit: number | null;
  verbose: boolean;
  dryRun: boolean;
  log: (message: string) => void;
}

/** Paths never read: the LM Studio device lock and macOS metadata. Upstream clones are excluded separately. */
export function ignoredPath(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  return base === ".DS_Store" || base === "lmstudio-device.lock" || base.endsWith(".lock") || rel.includes("/__pycache__/") || rel.includes("/.git/");
}

/** Recursively lists files under `dir` as repo-relative paths, sorted. */
export function walk(root: string, dir: string, skipDir: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const visit = (abs: string) => {
    let entries: string[];
    try { entries = readdirSync(abs); } catch { return; }
    for (const name of entries.sort()) {
      const full = join(abs, name);
      const rel = relative(root, full);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!skipDir(rel)) visit(full); }
      else if (st.isFile() && !ignoredPath(rel)) out.push(rel);
    }
  };
  visit(join(root, dir));
  return out;
}

export async function readBytes(root: string, rel: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(join(root, rel)).arrayBuffer());
}

export function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
