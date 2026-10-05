/**
 * Datasets and SHA-pinned revisions, cases, turns and full case text (Postgres
 * text_blobs.body), facet projections, injection payload metadata and the
 * counterfactual pairs of the numerical score probe.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { walk } from "../context.ts";
import {
  classifyGoal, counterfactualArm, diffInsertion, facetProjections, IMPORTER_VERSION, requestedValueFrom, sha256Hex, storableVerbatim,
} from "../lib.ts";
import { loadDataset } from "../../../src/datasets.ts";
import type { DatasetManifest, EvalCase } from "../../../src/types.ts";

export interface LoadedDataset { manifestPath: string; manifestText: string; manifest: DatasetManifest & { provenance?: any }; cases: EvalCase[] | null; error?: string }

const datasetCache = new Map<string, LoadedDataset>();

export function manifestPaths(root: string): string[] {
  return walk(root, "evals/datasets").filter(p => /^evals\/datasets\/[^/]+\.json$/.test(p));
}

export function loadManifest(root: string, manifestPath: string): LoadedDataset {
  const cached = datasetCache.get(manifestPath);
  if (cached) return cached;
  const manifestText = readFileSync(join(root, manifestPath), "utf8");
  const manifest = JSON.parse(manifestText);
  let cases: EvalCase[] | null = null, error: string | undefined;
  if (!existsSync(join(root, manifest.source.path))) error = `source missing: ${manifest.source.path}`;
  else { try { cases = loadDataset(manifest, root); } catch (e) { error = (e as Error).message; } }
  const loaded = { manifestPath, manifestText, manifest, cases, error };
  datasetCache.set(manifestPath, loaded);
  return loaded;
}

/** Dataset by id at an exact revision (null when the manifest moved on). */
export function datasetAt(root: string, datasetId: string, revision: string): LoadedDataset | null {
  const path = `evals/datasets/${datasetId}.json`;
  if (!existsSync(join(root, path))) return null;
  const loaded = loadManifest(root, path);
  return loaded.manifest.revision === revision ? loaded : null;
}

function wordCount(text: string): number { return text.trim() ? text.trim().split(/\s+/).length : 0; }

export function blobRow(text: string, withBody: boolean) {
  return {
    text_sha256: sha256Hex(text), byte_length: Buffer.byteLength(text), char_length: text.length, word_count: wordCount(text),
    body: withBody && storableVerbatim(text) ? text : null,
  };
}

interface CleanIndex { longpi: Map<string, EvalCase>; bipia: Map<string, EvalCase> }

function externalTurn(item: EvalCase) {
  return [...item.turns].reverse().find(t => t.origin === "external") ?? item.turns[item.turns.length - 1]!;
}

function buildCleanIndex(all: LoadedDataset[]): CleanIndex {
  const index: CleanIndex = { longpi: new Map(), bipia: new Map() };
  for (const d of all) for (const c of d.cases ?? []) {
    const f = c.facets as Record<string, any>;
    if (String(f.source ?? "").startsWith("LongPIBench synthetic") && f.attack === "no" && f.document_family) index.longpi.set(String(f.document_family), c);
    if (f.source === "bipia" && f.attack_family === "none" && f.pair_id) index.bipia.set(String(f.pair_id), c);
  }
  return index;
}

/** Payload of an attacked case from its clean sibling; goal type and requested value. */
export function payloadFor(item: EvalCase, positive: boolean, index: CleanIndex) {
  const f = item.facets as Record<string, any>;
  let clean: EvalCase | undefined;
  if (String(f.source ?? "").startsWith("LongPIBench") && f.document_family && f.attack !== "no") clean = index.longpi.get(String(f.document_family));
  else if (f.source === "bipia" && f.pair_id && f.attack_family !== "none") clean = index.bipia.get(String(f.pair_id));
  let payload: { start: number; end: number; text: string } | null = null;
  let turnId: string | null = null;
  if (clean) {
    const turn = externalTurn(item);
    const cleanTurn = clean.turns.find(t => t.id === turn.id) ?? externalTurn(clean);
    payload = diffInsertion(cleanTurn.text, turn.text);
    turnId = turn.id;
  }
  const goal = positive ? classifyGoal(payload?.text ?? null, f) : null;
  const requested = requestedValueFrom(payload?.text ?? null, f);
  return {
    injection_goal_type: goal,
    requested_value: positive ? requested : null,
    payload_sha256: payload ? sha256Hex(payload.text) : null,
    payload_turn_id: payload ? turnId : null,
    payload_start_char: payload?.start ?? null,
    payload_end_char: payload?.end ?? null,
    payload_derivation: payload ? (positive ? "clean-sibling-diff" : "clean-sibling-diff (non-directive control)") : (goal ? "facets" : null),
  };
}

export async function importDatasets(ctx: Ctx): Promise<void> {
  const paths = manifestPaths(ctx.root);
  const all = paths.map(p => loadManifest(ctx.root, p));
  const index = buildCleanIndex(all);
  const state = await ctx.db.importState("datasets");
  for (const d of all) {
    const m = d.manifest;
    const key = sha256Hex(`${sha256Hex(d.manifestText)}|${m.source.sha256}|${d.cases ? "cases" : "nocases"}|${IMPORTER_VERSION}`);
    const prior = state.get(d.manifestPath);
    if (prior && prior.sha256 === key && prior.status === "complete") continue;
    if (d.error) ctx.stats.warn(`${m.id}: ${d.error} (revision recorded without cases)`);
    await ctx.db.tx(async tx => {
      await ctx.db.exec(tx, "datasets", `insert into evals.datasets (dataset_id, title, description) values ($1, $2, $3)
        on conflict (dataset_id) do update set description = coalesce(excluded.description, evals.datasets.description)`,
        [m.id, m.id, m.provenance?.selection ?? null]);
      await ctx.db.exec(tx, "dataset_revisions", `
        insert into evals.dataset_revisions (dataset_id, revision, schema_version, source_path, source_sha256, source_format, visibility,
          expected_cases, annotation_key, positive_values, negative_values, license, provenance, manifest, manifest_path, manifest_sha256)
        values ($1, $2, $3, $4, $5, $6::evals.dataset_source_format, $7::evals.dataset_visibility, $8, $9, ($10::text)::jsonb, ($11::text)::jsonb,
                $12, ($13::text)::jsonb, ($14::text)::jsonb, $15, $16)
        on conflict (dataset_id, revision) do update set manifest = excluded.manifest, manifest_sha256 = excluded.manifest_sha256,
          provenance = excluded.provenance, license = excluded.license
        where evals.dataset_revisions.manifest_sha256 is distinct from excluded.manifest_sha256`,
        [m.id, m.revision, m.schemaVersion, m.source.path, m.source.sha256, m.source.format, m.source.visibility, m.expectedCases,
          m.annotationKey, JSON.stringify(m.positiveValues), JSON.stringify(m.negativeValues), m.provenance?.license ?? null,
          m.provenance ? JSON.stringify(m.provenance) : null, d.manifestText, d.manifestPath, sha256Hex(d.manifestText)]);
      const rows: Record<string, number> = {};
      if (d.cases) {
        const blobs = new Map<string, ReturnType<typeof blobRow>>();
        const caseRows: any[] = [], turnRows: any[] = [], pairRows: any[] = [];
        for (const c of d.cases) {
          const fullText = c.turns.map(t => t.text).join("\n");
          const full = blobRow(fullText, true);
          blobs.set(full.text_sha256, full);
          const label = String(c.annotations[m.annotationKey]);
          const positive = (m.positiveValues as unknown[]).includes(c.annotations[m.annotationKey]);
          caseRows.push({
            case_id: c.id, ordinal: c.ordinal ?? 0, label_value: label, expected_positive: positive, annotations: c.annotations,
            facets: c.facets, text_sha256: full.text_sha256, turn_count: c.turns.length, ...facetProjections(c.facets as Record<string, unknown>),
            ...payloadFor(c, positive, index),
          });
          c.turns.forEach((t, i) => {
            const b = blobRow(t.text, true);
            if (!blobs.has(b.text_sha256) || (!blobs.get(b.text_sha256)!.body && b.body)) blobs.set(b.text_sha256, b);
            turnRows.push({ case_id: c.id, turn_index: i, turn_id: t.id, role: t.role, origin: t.origin ?? null, text_sha256: b.text_sha256 });
          });
          const arm = counterfactualArm(c.facets as Record<string, unknown>);
          if (arm) {
            const f = c.facets as Record<string, any>;
            pairRows.push({ study: m.id, pair_id: `${f.document_family}|${f.attack}`, case_id: c.id, ...arm,
              target_value: `${f.requested_low} or ${f.requested_high}`, parent_case_id: f.parent_case ?? null,
              note: arm.pair_kind === "control" ? "Non-directive numerical fact control" : "Constructed instruction prescribing the review score" });
          }
        }
        rows.text_blobs = await ctx.db.write(tx, "text_blobs", [...blobs.values()], rs => `
          insert into evals.text_blobs (text_sha256, byte_length, char_length, word_count, body)
          select t.text_sha256, t.byte_length, t.char_length, t.word_count, t.body
          from ${rs} as t(text_sha256 text, byte_length integer, char_length integer, word_count integer, body text)
          on conflict (text_sha256) do update set body = excluded.body
          where evals.text_blobs.body is null and excluded.body is not null`, [], 500);
        rows.cases = await ctx.db.write(tx, "cases", caseRows, rs => `
          insert into evals.cases (dataset_revision_id, case_id, ordinal, label_value, expected_positive, annotations, facets, text_sha256, turn_count,
            attack_family, attack_template, attack_position, domain, source_name, split, pair_key, parent_case_id,
            injection_goal_type, requested_value, payload_sha256, payload_turn_id, payload_start_char, payload_end_char, payload_derivation)
          select dr.dataset_revision_id, t.case_id, t.ordinal, t.label_value, t.expected_positive, t.annotations, t.facets, t.text_sha256, t.turn_count,
            t.attack_family, t.attack_template, t.attack_position, t.domain, t.source_name, t.split, t.pair_key, t.parent_case_id,
            t.injection_goal_type, t.requested_value, t.payload_sha256, t.payload_turn_id, t.payload_start_char, t.payload_end_char, t.payload_derivation
          from ${rs} as t(case_id text, ordinal integer, label_value text, expected_positive boolean, annotations jsonb, facets jsonb, text_sha256 text,
            turn_count smallint, attack_family text, attack_template text, attack_position text, domain text, source_name text, split text,
            pair_key text, parent_case_id text, injection_goal_type text, requested_value text, payload_sha256 text, payload_turn_id text,
            payload_start_char integer, payload_end_char integer, payload_derivation text)
          join evals.dataset_revisions dr on dr.dataset_id = $2 and dr.revision = $3
          on conflict (dataset_revision_id, case_id) do update set
            injection_goal_type = excluded.injection_goal_type, requested_value = excluded.requested_value, payload_sha256 = excluded.payload_sha256,
            payload_turn_id = excluded.payload_turn_id, payload_start_char = excluded.payload_start_char, payload_end_char = excluded.payload_end_char,
            payload_derivation = excluded.payload_derivation, attack_family = excluded.attack_family, attack_template = excluded.attack_template,
            attack_position = excluded.attack_position, domain = excluded.domain, source_name = excluded.source_name, split = excluded.split,
            pair_key = excluded.pair_key, parent_case_id = excluded.parent_case_id`, [m.id, m.revision], 1000);
        rows.case_turns = await ctx.db.write(tx, "case_turns", turnRows, rs => `
          insert into evals.case_turns (case_pk, turn_index, turn_id, role, origin, text_sha256)
          select c.case_pk, t.turn_index, t.turn_id, t.role, t.origin, t.text_sha256
          from ${rs} as t(case_id text, turn_index smallint, turn_id text, role evals.turn_role, origin evals.turn_origin, text_sha256 text)
          join evals.dataset_revisions dr on dr.dataset_id = $2 and dr.revision = $3
          join evals.cases c on c.dataset_revision_id = dr.dataset_revision_id and c.case_id = t.case_id
          on conflict (case_pk, turn_index) do nothing`, [m.id, m.revision]);
        rows.counterfactual_pairs = await ctx.db.write(tx, "counterfactual_pairs", pairRows, rs => `
          insert into evals.counterfactual_pairs (study, pair_id, case_pk, pair_kind, arm, target_value, target_low, target_high, parent_case_id, note)
          select t.study, t.pair_id, c.case_pk, t.pair_kind, t.arm, t.target_value, t.target_low, t.target_high, t.parent_case_id, t.note
          from ${rs} as t(study text, pair_id text, case_id text, pair_kind text, arm text, target_value text, target_low double precision,
                          target_high double precision, parent_case_id text, note text)
          join evals.dataset_revisions dr on dr.dataset_id = $2 and dr.revision = $3
          join evals.cases c on c.dataset_revision_id = dr.dataset_revision_id and c.case_id = t.case_id
          on conflict (study, case_pk) do update set pair_id = excluded.pair_id, pair_kind = excluded.pair_kind, arm = excluded.arm,
            target_value = excluded.target_value, target_low = excluded.target_low, target_high = excluded.target_high`, [m.id, m.revision]);
      }
      await ctx.db.markImported(tx, "datasets", d.manifestPath, key, d.manifestText.length, d.cases ? "complete" : "partial", rows, d.error ?? null, IMPORTER_VERSION);
    });
    ctx.log(`  dataset ${m.id}: ${d.cases?.length ?? 0} cases`);
  }
}
