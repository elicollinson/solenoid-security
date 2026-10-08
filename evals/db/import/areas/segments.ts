/** Segment materialization by replaying evals/src/strategies.ts segmentCase for every case. */
import type { Ctx } from "../context.ts";
import { IMPORTER_VERSION, jsonSha } from "../lib.ts";
import { segmentCase } from "../../../src/strategies.ts";
import type { InputSegment } from "../../../src/types.ts";
import { blobRow, datasetAt } from "./datasets.ts";

const done = new Set<string>();
const segmentCache = new Map<string, Map<string, InputSegment[]>>();

/** All segments of every case in the dataset revision under one strategy (cases the strategy rejects are skipped). */
export function segmentsFor(ctx: Ctx, datasetId: string, revision: string, strategy: any): Map<string, InputSegment[]> | null {
  const key = `${datasetId}|${revision}|${jsonSha(strategy)}`;
  const cached = segmentCache.get(key);
  if (cached) return cached;
  const dataset = datasetAt(ctx.root, datasetId, revision);
  if (!dataset?.cases) return null;
  const out = new Map<string, InputSegment[]>();
  for (const item of dataset.cases) {
    try { out.set(item.id, segmentCase(item, strategy)); } catch { /* no external turn / empty text for this strategy */ }
  }
  segmentCache.set(key, out);
  return out;
}

/** Writes segments (and segment text hashes) once per (dataset revision, strategy). */
export async function ensureSegments(ctx: Ctx, datasetId: string, revision: string, strategy: any): Promise<boolean> {
  const strategySha = jsonSha(strategy);
  const marker = `segments/${datasetId}/${revision.replace("sha256:", "")}/${strategySha}`;
  if (done.has(marker)) return true;
  const state = await ctx.db.query<{ status: string }>(ctx.db.sql, `select status from evals.import_files where area = 'segments' and path = $1`, [marker]);
  if (state[0]?.status === "complete") { done.add(marker); return true; }
  const segments = segmentsFor(ctx, datasetId, revision, strategy);
  if (!segments) { ctx.stats.warn(`cannot materialize segments: dataset ${datasetId} at ${revision} is not the current manifest revision or its source is missing`); return false; }
  const blobs = new Map<string, ReturnType<typeof blobRow>>();
  const rows: any[] = [];
  for (const [caseId, list] of segments) {
    for (const s of list) {
      if (!blobs.has(s.textSha256)) blobs.set(s.textSha256, blobRow(s.text, false));
      rows.push({
        case_id: caseId, segment_index: s.index, segment_id: s.id, text_sha256: s.textSha256, source_turn_ids: s.turnIds,
        start_word: s.startWord ?? null, end_word: s.endWord ?? null,
        word_count: s.startWord !== undefined && s.endWord !== undefined ? s.endWord - s.startWord : blobs.get(s.textSha256)!.word_count,
        byte_length: Buffer.byteLength(s.text), is_whole_source: list.length === 1 && strategy.kind !== "decoded_preview_v1",
      });
    }
  }
  await ctx.db.tx(async tx => {
    await ctx.db.write(tx, "text_blobs", [...blobs.values()], rs => `
      insert into evals.text_blobs (text_sha256, byte_length, char_length, word_count, body)
      select t.text_sha256, t.byte_length, t.char_length, t.word_count, null
      from ${rs} as t(text_sha256 text, byte_length integer, char_length integer, word_count integer)
      on conflict (text_sha256) do nothing`, [], 5000);
    await ctx.db.write(tx, "segments", rows, rs => `
      insert into evals.segments (case_pk, strategy_pk, segment_index, segment_id, text_sha256, source_turn_ids, start_word, end_word, word_count,
                                  byte_length, is_whole_source, materialized_by)
      select c.case_pk, st.strategy_pk, t.segment_index, t.segment_id, t.text_sha256, t.source_turn_ids, t.start_word, t.end_word, t.word_count,
             t.byte_length, t.is_whole_source, 'segmenter'
      from ${rs} as t(case_id text, segment_index integer, segment_id text, text_sha256 text, source_turn_ids text[], start_word integer,
                      end_word integer, word_count integer, byte_length integer, is_whole_source boolean)
      join evals.dataset_revisions dr on dr.dataset_id = $2 and dr.revision = $3
      join evals.cases c on c.dataset_revision_id = dr.dataset_revision_id and c.case_id = t.case_id
      join evals.input_strategies st on st.config_sha256 = $4
      on conflict (case_pk, strategy_pk, segment_index) do nothing`, [datasetId, revision, strategySha], 4000);
    await ctx.db.markImported(tx, "segments", marker, strategySha, rows.length, "complete", { segments: rows.length }, null, IMPORTER_VERSION);
  });
  done.add(marker);
  return true;
}
