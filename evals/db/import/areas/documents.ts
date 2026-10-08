/**
 * Git-tracked markdown: reports, the research log (R and L entries), FINDINGS.md
 * (O-ids with strength, confounds, follow-up and the spot-check mark) and the
 * evidence links they cite (reports, run directories, checkpoints, log entries).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { walk } from "../context.ts";
import type { Tx } from "../db.ts";
import { dateFromPath, evidenceRefs, IMPORTER_VERSION, logEntryRefs, markdownTitle, parseFindings, parseResearchLog, sha256Hex } from "../lib.ts";

/** HEAD commit read from .git without spawning git. */
export function gitHead(root: string): string | null {
  try {
    const head = readFileSync(join(root, ".git/HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    if (existsSync(join(root, ".git", ref))) return readFileSync(join(root, ".git", ref), "utf8").trim();
    const packed = readFileSync(join(root, ".git/packed-refs"), "utf8");
    return packed.split("\n").find(l => l.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
  } catch { return null; }
}

function documentKind(path: string): string {
  if (path.endsWith("FINDINGS.md")) return "findings";
  if (/research-log/.test(path)) return "research_log";
  if (path.startsWith("evals/reports/")) return "report";
  if (path.startsWith("evals/datasets/")) return "dataset_note";
  return "methodology";
}

export function documentPaths(root: string): string[] {
  return [
    ...walk(root, "evals/reports").filter(p => p.endsWith(".md")),
    ...["evals/FINDINGS.md", "evals/DETECTOR_CANDIDATES.md", "evals/WEB_SMALL_CHUNKS.md", "evals/README.md"].filter(p => existsSync(join(root, p))),
    ...walk(root, "evals/datasets").filter(p => p.endsWith(".md")),
  ];
}

export async function importDocuments(ctx: Ctx): Promise<void> {
  const commit = gitHead(ctx.root);
  const state = await ctx.db.importState("documents");
  const paths = documentPaths(ctx.root);
  // Log entries and findings must exist before links that point at them, so the
  // research log and FINDINGS go first and links are written in a final pass.
  const ordered = [...paths.filter(p => /research-log/.test(p)), ...paths.filter(p => p.endsWith("FINDINGS.md")), ...paths.filter(p => !/research-log/.test(p) && !p.endsWith("FINDINGS.md"))];
  let changed = false;
  for (const path of ordered) {
    const body = readFileSync(join(ctx.root, path), "utf8");
    const sha = sha256Hex(body);
    const prior = state.get(path);
    if (prior && prior.sha256 === sha && prior.status === "complete") continue;
    changed = true;
    await ctx.db.tx(async tx => {
      const kind = documentKind(path);
      await ctx.db.exec(tx, "documents", `
        insert into evals.documents (path, sha256, git_commit, kind, title, dated, body_md) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (path, sha256) do nothing`, [path, sha, commit, kind, markdownTitle(body), dateFromPath(path), body]);
      const rows: Record<string, number> = {};
      if (kind === "research_log") rows.research_log_entries = await writeLog(ctx, tx, path, sha, body);
      if (kind === "findings") rows.findings = await writeFindings(ctx, tx, path, sha, body);
      await ctx.db.markImported(tx, "documents", path, sha, body.length, "complete", rows, null, IMPORTER_VERSION);
    });
  }
  if (changed || !(await hasLinks(ctx))) await writeAllLinks(ctx, ordered);
}

async function hasLinks(ctx: Ctx): Promise<boolean> {
  const rows = await ctx.db.query<{ n: number }>(ctx.db.sql, `select count(*)::int n from evals.evidence_links`);
  return (rows[0]?.n ?? 0) > 0;
}

async function writeLog(ctx: Ctx, tx: Tx, path: string, sha: string, body: string): Promise<number> {
  const entries = parseResearchLog(body, dateFromPath(path));
  return ctx.db.write(tx, "research_log_entries", entries, rs => `
    insert into evals.research_log_entries (entry_id, document_pk, ordinal, title, dated, body_md)
    select t.entry_id, d.document_pk, t.ordinal, t.title, t.dated, t.body_md
    from ${rs} as t(entry_id text, ordinal integer, title text, dated date, body_md text)
    join evals.documents d on d.path = $2 and d.sha256 = $3
    on conflict (entry_id) do update set document_pk = excluded.document_pk, ordinal = excluded.ordinal, title = excluded.title,
      dated = excluded.dated, body_md = excluded.body_md
    where evals.research_log_entries.body_md is distinct from excluded.body_md or evals.research_log_entries.document_pk is distinct from excluded.document_pk`,
    [path, sha]);
}

async function writeFindings(ctx: Ctx, tx: Tx, path: string, sha: string, body: string): Promise<number> {
  const updated = /\*\*Last updated:\*\*\s*(20\d\d-\d\d-\d\d)/.exec(body)?.[1] ?? null;
  const findings = parseFindings(body).map(f => ({ ...f, updated_at: updated }));
  return ctx.db.write(tx, "findings", findings, rs => `
    insert into evals.findings (finding_id, document_pk, section, section_title, ordinal, title, strength, strength_note, confounds, follow_up,
      status, spot_checked, body_md, updated_at)
    select t.finding_id, d.document_pk, t.section, t.section_title, t.ordinal, t.title, t.strength, t.strength_note, t.confounds, t.follow_up,
      t.status, t.spot_checked, t.body_md, t.updated_at
    from ${rs} as t(finding_id text, section text, section_title text, ordinal integer, title text, strength evals.finding_strength, strength_note text,
      confounds text, follow_up text, status text, spot_checked boolean, body_md text, updated_at date)
    join evals.documents d on d.path = $2 and d.sha256 = $3
    on conflict (finding_id) do update set document_pk = excluded.document_pk, section = excluded.section, section_title = excluded.section_title,
      ordinal = excluded.ordinal, title = excluded.title, strength = excluded.strength, strength_note = excluded.strength_note,
      confounds = excluded.confounds, follow_up = excluded.follow_up, status = excluded.status, spot_checked = excluded.spot_checked,
      body_md = excluded.body_md, updated_at = excluded.updated_at
    where evals.findings.body_md is distinct from excluded.body_md or evals.findings.document_pk is distinct from excluded.document_pk`,
    [path, sha]);
}

/** Evidence links for findings and log entries: documents, checkpoints (runs), artifacts, directories, log entries. */
async function writeAllLinks(ctx: Ctx, paths: string[]): Promise<void> {
  const links: any[] = [];
  for (const path of paths) {
    const body = readFileSync(join(ctx.root, path), "utf8");
    const baseDir = path.split("/").slice(0, -1).join("/");
    if (path.endsWith("FINDINGS.md")) {
      for (const f of parseFindings(body)) links.push(...linksFor({ finding_id: f.finding_id, log_entry_id: null }, f.body_md, baseDir, f.spot_checked));
    } else if (/research-log/.test(path)) {
      for (const e of parseResearchLog(body, dateFromPath(path))) links.push(...linksFor({ finding_id: null, log_entry_id: e.entry_id }, e.body_md, baseDir, false, e.entry_id));
    }
  }
  await ctx.db.tx(async tx => {
    await ctx.db.write(tx, "evidence_links", links, rs => `
      with t as (select * from ${rs} as t(finding_id text, log_entry_id text, kind text, value text, role text, spot_checked boolean, note text)),
      resolved as (
        select t.*,
          (select d.document_pk from evals.documents d where t.kind = 'document' and d.path = t.value order by d.document_pk desc limit 1) as document_pk,
          (select c.run_pk from evals.checkpoints c join evals.artifacts a on a.artifact_id = c.artifact_id
             where t.kind = 'path' and a.path = t.value order by c.checkpoint_pk desc limit 1) as run_pk,
          (select a.artifact_id from evals.artifacts a where t.kind = 'path' and a.path = t.value order by a.artifact_id desc limit 1) as artifact_id,
          (select e.entry_id from evals.research_log_entries e where t.kind = 'log' and e.entry_id = t.value) as log_ref
        from t
      )
      insert into evals.evidence_links (finding_id, log_entry_id, target, run_pk, artifact_id, path_prefix, document_pk, related_log_entry, role, spot_checked, note)
      select r.finding_id, r.log_entry_id,
        (case when r.kind = 'document' then 'document' when r.kind = 'log' then 'research_log_entry'
              when r.run_pk is not null then 'run' when r.artifact_id is not null then 'artifact' else 'path_prefix' end)::evals.evidence_target,
        r.run_pk, case when r.run_pk is null then r.artifact_id end,
        case when r.kind = 'path' and r.run_pk is null and r.artifact_id is null then r.value end,
        r.document_pk, r.log_ref, r.role, r.spot_checked, r.note
      from resolved r
      where (r.finding_id is not null and exists (select 1 from evals.findings f where f.finding_id = r.finding_id)
             or r.log_entry_id is not null and exists (select 1 from evals.research_log_entries e where e.entry_id = r.log_entry_id))
        and (r.kind = 'path' or r.document_pk is not null or r.log_ref is not null)
      on conflict on constraint evidence_links_natural_key do nothing`);
  });
}

function linksFor(subject: { finding_id: string | null; log_entry_id: string | null }, md: string, baseDir: string, spotChecked: boolean, self?: string) {
  const out: any[] = [];
  for (const ref of evidenceRefs(md, baseDir)) {
    const value = ref.kind === "path" && !/\.[a-z0-9]+$/i.test(ref.value) && !ref.value.endsWith("/") ? `${ref.value}/` : ref.value;
    out.push({ ...subject, kind: ref.kind, value, role: "supporting", spot_checked: spotChecked, note: null });
  }
  for (const id of logEntryRefs(md)) if (id !== self) out.push({ ...subject, kind: "log", value: id, role: "context", spot_checked: false, note: null });
  return out;
}
