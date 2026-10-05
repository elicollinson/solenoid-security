/**
 * Ledgers, inventories, logs and analysis outputs under evals/runs:
 * batch ledgers, the Model Armor allowance ledger, OpenRouter key snapshots,
 * endpoint snapshots, LM Studio inventories, driver logs, SHA-256 file
 * inventories, the coverage ledger, analysis JSON documents and case evidence tags.
 * One transaction per file; append-only logs are keyed by (path, line_no).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { decode, walk } from "../context.ts";
import type { Tx } from "../db.ts";
import {
  artifactKind, completeLines, driverEventRow, IMPORTER_VERSION, isCheckpointHead, parseBatchLedger, parseJsonLines, sha256Hex, suiteStemFromPath,
} from "../lib.ts";
import { ensureArtifact, preloadArtifacts, readSnapshot } from "./artifacts.ts";
import { canonicalModel } from "./catalog.ts";

const MAX_BODY = 1_000_000;

function suiteIdFor(root: string, stem: string | null): string | null {
  if (!stem) return null;
  const path = join(root, `evals/suites/${stem}.json`);
  if (!existsSync(path)) return stem;
  try { return JSON.parse(readFileSync(path, "utf8")).id ?? stem; } catch { return stem; }
}

function mtimeOf(root: string, rel: string): string | null {
  try { return statSync(join(root, rel)).mtime.toISOString(); } catch { return null; }
}

let runIdSet: Set<string> | null = null;
async function runIds(ctx: Ctx): Promise<Set<string>> {
  if (runIdSet) return runIdSet;
  const rows = await ctx.db.query<{ run_id: string }>(ctx.db.sql, `select run_id from evals.runs`);
  runIdSet = new Set(rows.map(r => r.run_id));
  return runIdSet;
}

function collectStrings(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || out.size > 50_000) return;
  if (typeof value === "string") { if (value.length < 300) out.add(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out, depth + 1); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (k.length < 300) out.add(k); collectStrings(v, out, depth + 1); }
}

export async function importLedgers(ctx: Ctx): Promise<void> {
  await preloadArtifacts(ctx);
  const state = await ctx.db.importState("ledgers");
  let paths = walk(ctx.root, "evals/runs").filter(p => /\.(json|jsonl|ndjson)$/.test(p));
  if (ctx.limit) paths = paths.slice(0, ctx.limit);
  const known = await runIds(ctx);
  let handled = 0;
  for (const path of paths) {
    const snap = await readSnapshot(ctx, path);
    const prior = state.get(path);
    if (prior && prior.sha256 === snap.sha && prior.status === "complete") continue;
    const text = decode(snap.bytes);
    const firstLine = text.slice(0, Math.max(0, text.indexOf("\n")));
    if (path.endsWith(".jsonl") && isCheckpointHead(firstLine)) continue; // checkpoints area
    if (path.endsWith("migrated-2026-09/observations.jsonl")) continue; // legacy area
    const kind = artifactKind(path, firstLine);
    const base = path.split("/").pop()!;
    try {
      await ctx.db.tx(async tx => {
        const artifactId = await ensureArtifact(ctx, tx, { ...snap, text });
        const rows: Record<string, number> = {};
        if (base === "batch-ledger.jsonl") Object.assign(rows, await batchLedger(ctx, tx, path, text));
        else if (base.startsWith("armor-budget") && base.endsWith(".jsonl")) rows.spend_ledger_entries = await armorLedger(ctx, tx, path, text);
        else if (kind === "driver_log") Object.assign(rows, await driverLog(ctx, tx, path, text, artifactId));
        else if (base === "case-index.jsonl") rows.case_evidence_tags = await caseIndex(ctx, tx, text, artifactId);
        else if (path.endsWith(".json")) {
          let body: any;
          try { body = JSON.parse(text); } catch { body = undefined; }
          if (body !== undefined) {
            if (body && typeof body === "object" && !Array.isArray(body) && "checkedAt" in body && ("remaining" in body || "limit" in body)) rows.provider_key_snapshots = await keySnapshot(ctx, tx, path, body, artifactId);
            if (kind === "endpoint_snapshot") Object.assign(rows, await endpointSnapshot(ctx, tx, path, body, artifactId));
            if (kind === "lmstudio_inventory" && (Array.isArray(body) || Array.isArray(body?.inventory))) Object.assign(rows, await inventory(ctx, tx, path, Array.isArray(body) ? body : body.inventory, artifactId, 0, "inventory_file", base.replace(/\.json$/, ""), mtimeOf(ctx.root, path)));
            if (base === "artifact-inventory.json") Object.assign(rows, await fileInventory(ctx, tx, path, body, artifactId));
            if (base === "research-coverage-ledger.json") rows.coverage_cells = await coverage(ctx, tx, body, artifactId);
            if (kind !== "endpoint_snapshot" && base !== "artifact-inventory.json") Object.assign(rows, await analysisDocument(ctx, tx, path, kind, body, text.length, artifactId, known));
          }
        }
        await ctx.db.markImported(tx, "ledgers", path, snap.sha, snap.bytes.byteLength, "complete", rows, null, IMPORTER_VERSION);
      });
      handled++;
      if (ctx.verbose) ctx.log(`  ${path}`);
    } catch (e) {
      ctx.stats.warn(`${path}: ${(e as Error).message}`);
    }
  }
  ctx.log(`  ledgers/logs/documents: ${handled} file(s) imported`);
}

async function batchLedger(ctx: Ctx, tx: Tx, path: string, text: string): Promise<Record<string, number>> {
  const entries = parseJsonLines(completeLines(text).lines);
  const { batches, cells } = parseBatchLedger(entries);
  const suiteByBatch = new Map<number, string | null>();
  const batchRows = batches.map(b => {
    const suiteId = suiteIdFor(ctx.root, suiteStemFromPath(b.start.suite));
    suiteByBatch.set(b.start_line_no, suiteId);
    return {
      ledger_path: path, start_line_no: b.start_line_no, suite_id: suiteId, started_at: b.start.at ?? null, finished_at: b.finish?.at ?? null,
      cells_planned: b.start.cells ?? null, max_spend_usd: b.start.maxSpend ?? null, reserve_usd: b.start.reserve ?? null,
      budget_scope: b.start.budgetScope ?? null, baseline: b.start.baseline ?? null, initial_balance: b.start.initial ?? null,
      final_balance: b.finish?.final ?? null, effective: b.finish?.effective ?? null, usage_delta_usd: b.finish?.usageDeltaUsd ?? null,
      budget_stopped: typeof b.finish?.budgetStopped === "boolean" ? b.finish.budgetStopped : null, failed_conditions: b.finish?.failedConditions ?? null,
      local: typeof b.start.local === "boolean" ? b.start.local : null, start_payload: b.start, finish_payload: b.finish,
    };
  });
  const out: Record<string, number> = {};
  out.research_batches = await ctx.db.write(tx, "research_batches", batchRows, rs => `
    insert into evals.research_batches (ledger_path, start_line_no, suite_id, started_at, finished_at, cells_planned, max_spend_usd, reserve_usd,
      budget_scope, baseline, initial_balance, final_balance, effective, usage_delta_usd, budget_stopped, failed_conditions, local, start_payload, finish_payload)
    select t.ledger_path, t.start_line_no, t.suite_id, t.started_at, t.finished_at, t.cells_planned, t.max_spend_usd, t.reserve_usd, t.budget_scope,
      t.baseline, t.initial_balance, t.final_balance, t.effective, t.usage_delta_usd, t.budget_stopped, t.failed_conditions, t.local, t.start_payload, t.finish_payload
    from ${rs} as t(ledger_path text, start_line_no integer, suite_id text, started_at timestamptz, finished_at timestamptz, cells_planned integer,
      max_spend_usd numeric, reserve_usd numeric, budget_scope text, baseline jsonb, initial_balance jsonb, final_balance jsonb, effective jsonb,
      usage_delta_usd numeric, budget_stopped boolean, failed_conditions jsonb, local boolean, start_payload jsonb, finish_payload jsonb)
    on conflict (ledger_path, start_line_no) do update set finished_at = excluded.finished_at, final_balance = excluded.final_balance,
      effective = excluded.effective, usage_delta_usd = excluded.usage_delta_usd, budget_stopped = excluded.budget_stopped,
      failed_conditions = excluded.failed_conditions, finish_payload = excluded.finish_payload`);
  const cellRows = cells.map(c => {
    const suiteId = suiteByBatch.get(c.batch_start_line_no) ?? null;
    const f = c.finish ?? {};
    return {
      ledger_path: path, batch_start_line_no: c.batch_start_line_no, line_no: c.line_no, test_id: String(c.start.test ?? ""), condition_id: String(c.start.condition ?? ""),
      run_id: suiteId ? `${suiteId}/${c.start.test}/${c.start.condition}` : null, started_at: c.start.at ?? null, finished_at: f.at ?? null,
      planned_calls: c.start.plannedCalls ?? null, estimated_usd: c.start.estimatedUsd ?? null, requested_concurrency: c.start.requestedConcurrency ?? null,
      effective_concurrency: c.start.effectiveConcurrency ?? null, local: typeof c.start.local === "boolean" ? c.start.local : null,
      exit_code: typeof f.exitCode === "number" ? f.exitCode : null, usage_delta_usd: typeof f.usageDeltaUsd === "number" ? f.usageDeltaUsd : null,
      balance_before: f.before ?? c.start.current ?? null, balance_after: f.after ?? null, budget_stopped: c.budget_stopped,
      start_payload: c.start, finish_payload: c.finish,
    };
  });
  out.batch_cells = await ctx.db.write(tx, "batch_cells", cellRows, rs => `
    insert into evals.batch_cells (batch_pk, line_no, test_id, condition_id, run_pk, started_at, finished_at, planned_calls, estimated_usd,
      requested_concurrency, effective_concurrency, local, exit_code, usage_delta_usd, balance_before, balance_after, budget_stopped, start_payload, finish_payload)
    select b.batch_pk, t.line_no, t.test_id, t.condition_id, (select r.run_pk from evals.runs r where r.run_id = t.run_id), t.started_at, t.finished_at,
      t.planned_calls, t.estimated_usd, t.requested_concurrency, t.effective_concurrency, t.local, t.exit_code, t.usage_delta_usd, t.balance_before,
      t.balance_after, coalesce(t.budget_stopped, false), t.start_payload, t.finish_payload
    from ${rs} as t(ledger_path text, batch_start_line_no integer, line_no integer, test_id text, condition_id text, run_id text, started_at timestamptz,
      finished_at timestamptz, planned_calls integer, estimated_usd numeric, requested_concurrency integer, effective_concurrency integer, local boolean,
      exit_code integer, usage_delta_usd numeric, balance_before jsonb, balance_after jsonb, budget_stopped boolean, start_payload jsonb, finish_payload jsonb)
    join evals.research_batches b on b.ledger_path = t.ledger_path and b.start_line_no = t.batch_start_line_no
    on conflict (batch_pk, line_no) do update set finished_at = excluded.finished_at, exit_code = excluded.exit_code,
      usage_delta_usd = excluded.usage_delta_usd, balance_after = excluded.balance_after, finish_payload = excluded.finish_payload,
      run_pk = coalesce(evals.batch_cells.run_pk, excluded.run_pk)`);
  // Per-condition OpenRouter key deltas. They overlap across concurrent batches: never sum them as spend.
  const lines = completeLines(text).lines;
  let currentSuite: string | null = null;
  const usage: any[] = [];
  for (const { line, value } of entries) {
    if (value.type === "batch_start") currentSuite = suiteIdFor(ctx.root, suiteStemFromPath(value.suite));
    if (value.type === "condition_finish" && typeof value.usageDeltaUsd === "number") usage.push({
      ledger_path: path, line_no: line, line_sha256: sha256Hex(lines[line - 1] ?? ""), at: value.at, usd: value.usageDeltaUsd,
      run_id: currentSuite ? `${currentSuite}/${value.test}/${value.condition}` : null, payload: value,
    });
  }
  out.spend_ledger_entries = await ctx.db.write(tx, "spend_ledger_entries", usage, rs => `
    insert into evals.spend_ledger_entries (ledger, ledger_path, line_no, line_sha256, entry_type, at, usd, run_id, run_pk, basis, payload)
    select 'openrouter_usage', t.ledger_path, t.line_no, t.line_sha256, 'condition_usage', t.at, t.usd, t.run_id,
      (select r.run_pk from evals.runs r where r.run_id = t.run_id), 'OpenRouter key usage delta around one condition (overlaps concurrent batches)', t.payload
    from ${rs} as t(ledger_path text, line_no integer, line_sha256 text, at timestamptz, usd numeric, run_id text, payload jsonb)
    on conflict (ledger_path, line_no) do nothing`);
  const snapshots: any[] = [];
  for (const b of batches) {
    if (b.start.initial && b.start.at) snapshots.push({ checked_at: b.start.at, scope: `${path}#${b.start_line_no} batch_start.initial`, remaining_usd: b.start.initial.remaining ?? null, usage: b.start.initial, raw: b.start.initial });
    if (b.finish?.final && b.finish.at) snapshots.push({ checked_at: b.finish.at, scope: `${path}#${b.finish_line_no} batch_finish.final`, remaining_usd: b.finish.final.remaining ?? null, usage: b.finish.final, raw: b.finish.final });
  }
  out.provider_key_snapshots = await ctx.db.write(tx, "provider_key_snapshots", snapshots, rs => `
    insert into evals.provider_key_snapshots (provider, checked_at, scope, remaining_usd, usage, raw)
    select 'openrouter', t.checked_at, t.scope, t.remaining_usd, t.usage, t.raw
    from ${rs} as t(checked_at timestamptz, scope text, remaining_usd numeric, usage jsonb, raw jsonb)
    on conflict (provider, checked_at) do nothing`);
  return out;
}

async function armorLedger(ctx: Ctx, tx: Tx, path: string, text: string): Promise<number> {
  const lines = completeLines(text).lines;
  const rows = parseJsonLines(lines).map(({ line, value }) => ({
    ledger_path: path, line_no: line, line_sha256: sha256Hex(lines[line - 1]!), entry_type: String(value.type), at: value.at, usd: value.usd ?? 0,
    run_id: value.runId ?? null, request_id: value.requestId ?? null, segment_id: value.segmentId ?? null, attempt: value.attempt ?? null,
    basis: value.basis ?? null, payload: value,
  }));
  return ctx.db.write(tx, "spend_ledger_entries", rows, rs => `
    insert into evals.spend_ledger_entries (ledger, ledger_path, line_no, line_sha256, entry_type, at, usd, run_id, run_pk, request_id, segment_id, attempt, basis, payload)
    select 'model_armor_allowance', t.ledger_path, t.line_no, t.line_sha256, t.entry_type, t.at, t.usd, t.run_id, r.run_pk, t.request_id, t.segment_id,
      t.attempt, t.basis, t.payload
    from ${rs} as t(ledger_path text, line_no integer, line_sha256 text, entry_type text, at timestamptz, usd numeric, run_id text, request_id uuid,
      segment_id text, attempt smallint, basis text, payload jsonb)
    left join evals.runs r on r.run_id = t.run_id
    on conflict (ledger_path, line_no) do nothing`, [], 5000);
}

async function keySnapshot(ctx: Ctx, tx: Tx, _path: string, body: any, artifactId: number | null): Promise<number> {
  return ctx.db.write(tx, "provider_key_snapshots", [{
    checked_at: body.checkedAt, scope: body.scope ?? null, currency: body.currency ?? null, limit_usd: body.limit ?? null, remaining_usd: body.remaining ?? null,
    usage: body.usage ?? null, byok_usage: body.byokUsage ?? null, expires_at: body.expiresAt ?? null, artifact_id: artifactId, raw: body,
  }], rs => `
    insert into evals.provider_key_snapshots (provider, checked_at, scope, currency, limit_usd, remaining_usd, usage, byok_usage, expires_at, artifact_id, raw)
    select 'openrouter', t.checked_at, t.scope, t.currency, t.limit_usd, t.remaining_usd, t.usage, t.byok_usage, t.expires_at, t.artifact_id, t.raw
    from ${rs} as t(checked_at timestamptz, scope text, currency text, limit_usd numeric, remaining_usd numeric, usage jsonb, byok_usage jsonb,
      expires_at timestamptz, artifact_id bigint, raw jsonb)
    on conflict (provider, checked_at) do update set artifact_id = coalesce(evals.provider_key_snapshots.artifact_id, excluded.artifact_id)`);
}

async function endpointSnapshot(ctx: Ctx, tx: Tx, path: string, body: any, artifactId: number | null): Promise<Record<string, number>> {
  const captured = mtimeOf(ctx.root, path);
  const models: any[] = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  const snaps = models.filter(m => m?.id).map(m => ({ artifact_id: artifactId, model_slug: m.id, model_canonical: canonicalModel(ctx.root, m.id), captured_at: captured, raw: m }));
  const out: Record<string, number> = {};
  out.endpoint_snapshots = await ctx.db.write(tx, "endpoint_snapshots", snaps, rs => `
    insert into evals.endpoint_snapshots (artifact_id, model_slug, model_id, captured_at, raw)
    select t.artifact_id, t.model_slug, (select m.model_id from evals.models m where m.canonical_name = t.model_canonical), t.captured_at, t.raw
    from ${rs} as t(artifact_id bigint, model_slug text, model_canonical text, captured_at timestamptz, raw jsonb)
    where t.artifact_id is not null
    on conflict (artifact_id, model_slug) do nothing`, [], 200);
  const offers = models.flatMap(m => (Array.isArray(m?.endpoints) ? m.endpoints : []).map((e: any, i: number) => ({
    model_slug: m.id, offer_index: i, provider_name: e.provider_name ?? null, tag: e.tag ?? null, quantization: e.quantization ?? null,
    context_length: e.context_length ?? null, max_completion_tokens: e.max_completion_tokens ?? null,
    prompt_usd_per_token: e.pricing?.prompt != null ? Number(e.pricing.prompt) : null, completion_usd_per_token: e.pricing?.completion != null ? Number(e.pricing.completion) : null,
    supported_parameters: Array.isArray(e.supported_parameters) ? e.supported_parameters : null, status: typeof e.status === "number" ? e.status : null,
    uptime_last_30m: typeof e.uptime_last_30m === "number" ? e.uptime_last_30m : null, raw: e,
  })));
  out.endpoint_offers = await ctx.db.write(tx, "endpoint_offers", offers, rs => `
    insert into evals.endpoint_offers (snapshot_pk, offer_index, provider_name, tag, quantization, context_length, max_completion_tokens,
      prompt_usd_per_token, completion_usd_per_token, supported_parameters, status, uptime_last_30m, raw)
    select s.snapshot_pk, t.offer_index, t.provider_name, t.tag, t.quantization, t.context_length, t.max_completion_tokens, t.prompt_usd_per_token,
      t.completion_usd_per_token, t.supported_parameters, t.status, t.uptime_last_30m, t.raw
    from ${rs} as t(model_slug text, offer_index integer, provider_name text, tag text, quantization text, context_length integer, max_completion_tokens integer,
      prompt_usd_per_token numeric, completion_usd_per_token numeric, supported_parameters text[], status integer, uptime_last_30m numeric, raw jsonb)
    join evals.endpoint_snapshots s on s.artifact_id = $2 and s.model_slug = t.model_slug
    on conflict (snapshot_pk, offer_index) do nothing`, [artifactId]);
  return out;
}

async function inventory(ctx: Ctx, tx: Tx, _path: string, items: any[], artifactId: number | null, lineNo: number, source: string, label: string | null, at: string | null): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.lmstudio_inventory_snapshots = await ctx.db.write(tx, "lmstudio_inventory_snapshots", [{ artifact_id: artifactId, source_line_no: lineNo, source, label, captured_at: at, item_count: items.length, raw: items }], rs => `
    insert into evals.lmstudio_inventory_snapshots (artifact_id, source_line_no, source, label, captured_at, item_count, raw)
    select t.artifact_id, t.source_line_no, t.source, t.label, t.captured_at, t.item_count, t.raw
    from ${rs} as t(artifact_id bigint, source_line_no integer, source text, label text, captured_at timestamptz, item_count integer, raw jsonb)
    where t.artifact_id is not null
    on conflict (artifact_id, source_line_no) do nothing`);
  const rows = items.filter(i => i && typeof i.modelKey === "string").map((i, index) => ({
    item_index: index, model_type: i.type ?? null, model_key: i.modelKey, indexed_model_identifier: i.indexedModelIdentifier ?? null,
    device_identifier: i.deviceIdentifier ?? null, display_name: i.displayName ?? null, publisher: i.publisher ?? null, path: i.path ?? null,
    format: i.format ?? null, quantization_name: i.quantization?.name ?? null, quantization_bits: typeof i.quantization?.bits === "number" ? i.quantization.bits : null,
    size_bytes: i.sizeBytes ?? null, params_string: i.paramsString ?? null, architecture: i.architecture ?? null, max_context_length: i.maxContextLength ?? null,
    selected_variant: i.selectedVariant ?? null, variants: Array.isArray(i.variants) ? i.variants : null, vision: typeof i.vision === "boolean" ? i.vision : null,
    trained_for_tool_use: typeof i.trainedForToolUse === "boolean" ? i.trainedForToolUse : null, raw: i,
  }));
  out.lmstudio_inventory_items = await ctx.db.write(tx, "lmstudio_inventory_items", rows, rs => `
    insert into evals.lmstudio_inventory_items (snapshot_pk, item_index, model_type, model_key, indexed_model_identifier, device_identifier, display_name,
      publisher, path, format, quantization_name, quantization_bits, size_bytes, params_string, architecture, max_context_length, selected_variant,
      variants, vision, trained_for_tool_use, deployment_id, raw)
    select s.snapshot_pk, t.item_index, t.model_type, t.model_key, t.indexed_model_identifier, t.device_identifier, t.display_name, t.publisher, t.path,
      t.format, t.quantization_name, t.quantization_bits, t.size_bytes, t.params_string, t.architecture, t.max_context_length, t.selected_variant,
      t.variants, t.vision, t.trained_for_tool_use,
      (select d.deployment_id from evals.model_deployments d where d.backend = 'lmstudio'
         and (d.indexed_model_identifier = t.indexed_model_identifier or d.indexed_model_identifier like '%:' || t.indexed_model_identifier) limit 1),
      t.raw
    from ${rs} as t(item_index integer, model_type text, model_key text, indexed_model_identifier text, device_identifier text, display_name text,
      publisher text, path text, format text, quantization_name text, quantization_bits numeric, size_bytes bigint, params_string text, architecture text,
      max_context_length integer, selected_variant text, variants text[], vision boolean, trained_for_tool_use boolean, raw jsonb)
    join evals.lmstudio_inventory_snapshots s on s.artifact_id = $2 and s.source_line_no = $3
    on conflict (snapshot_pk, item_index) do nothing`, [artifactId, lineNo]);
  return out;
}

async function driverLog(ctx: Ctx, tx: Tx, path: string, text: string, artifactId: number | null): Promise<Record<string, number>> {
  const lines = completeLines(text).lines;
  const entries = parseJsonLines(lines);
  const rows = entries.map(({ line, value }) => ({ log_path: path, line_no: line, line_sha256: sha256Hex(lines[line - 1]!), ...driverEventRow(value), payload: value }));
  const out: Record<string, number> = {};
  out.driver_events = await ctx.db.write(tx, "driver_events", rows, rs => `
    insert into evals.driver_events (log_path, line_no, line_sha256, at, event, suite_id, command, exit_code, stdout, stderr, pid, payload)
    select t.log_path, t.line_no, t.line_sha256, t.at, t.event, t.suite_id, t.command, t.exit_code, t.stdout, t.stderr, t.pid, t.payload
    from ${rs} as t(log_path text, line_no integer, line_sha256 text, at timestamptz, event text, suite_id text, command text[], exit_code integer,
      stdout text, stderr text, pid integer, payload jsonb)
    on conflict (log_path, line_no) do nothing`);
  for (const { line, value } of entries) {
    const v = value?.value;
    if (v?.event === "inventory" && Array.isArray(v.inventory)) {
      const r = await inventory(ctx, tx, path, v.inventory, artifactId, line, "driver_log", v.suite ?? null, value.at ?? null);
      for (const [k, n] of Object.entries(r)) out[k] = (out[k] ?? 0) + n;
    }
    const m = typeof v?.stderr === "string" ? /preferred device to "([^"]+)" \(([0-9a-f]{32})\)/.exec(v.stderr) : null;
    if (m) await ctx.db.exec(tx, "devices (display name)", `insert into evals.devices (device_identifier, display_name, first_seen_at) values ($1, $2, $3)
      on conflict (device_identifier) do update set display_name = excluded.display_name, first_seen_at = least(evals.devices.first_seen_at, excluded.first_seen_at)
      where evals.devices.display_name is distinct from excluded.display_name or evals.devices.first_seen_at is null`, [m[2], m[1], value.at ?? null]);
  }
  return out;
}

async function fileInventory(ctx: Ctx, tx: Tx, path: string, body: any, artifactId: number | null): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const resultPath = path.replace(/artifact-inventory\.json$/, "inventory-result.json");
  let inventorySha: string | null = null;
  if (existsSync(join(ctx.root, resultPath))) { try { inventorySha = JSON.parse(readFileSync(join(ctx.root, resultPath), "utf8")).inventorySha256 ?? null; } catch { /* ignore */ } }
  out.file_inventories = await ctx.db.write(tx, "file_inventories", [{ artifact_id: artifactId, generated_at: body.generatedAt ?? null, scope: body.scope ?? null,
    file_count: body.files ?? null, total_bytes: body.totalBytes ?? null, inventory_sha256: inventorySha }], rs => `
    insert into evals.file_inventories (artifact_id, generated_at, scope, file_count, total_bytes, inventory_sha256)
    select t.artifact_id, t.generated_at, t.scope, t.file_count, t.total_bytes, t.inventory_sha256
    from ${rs} as t(artifact_id bigint, generated_at timestamptz, scope text, file_count integer, total_bytes bigint, inventory_sha256 text)
    where t.artifact_id is not null
    on conflict (artifact_id) do nothing`);
  const entries = (Array.isArray(body.artifacts) ? body.artifacts : []).filter((a: any) => a?.path && /^[0-9a-f]{64}$/.test(a.sha256 ?? ""));
  out.file_inventory_entries = await ctx.db.write(tx, "file_inventory_entries", entries.map((a: any) => ({ path: a.path, bytes: a.bytes ?? 0, sha256: a.sha256 })), rs => `
    insert into evals.file_inventory_entries (inventory_pk, path, bytes, sha256)
    select i.inventory_pk, t.path, t.bytes, t.sha256 from ${rs} as t(path text, bytes bigint, sha256 text)
    join evals.file_inventories i on i.artifact_id = $2
    on conflict (inventory_pk, path) do nothing`, [artifactId], 10000);
  return out;
}

async function coverage(ctx: Ctx, tx: Tx, body: any, artifactId: number | null): Promise<number> {
  const rows = new Map<string, any>();
  for (const s of Array.isArray(body?.studies) ? body.studies : []) for (const c of Array.isArray(s.cells) ? s.cells : []) {
    const key = `${s.id}|${c.test}|${c.condition}`;
    if (!rows.has(key)) rows.set(key, { artifact_id: artifactId, study_id: String(s.id), study_name: s.name ?? null, test_id: String(c.test), condition_id: String(c.condition), run_id: c.runId ?? null, status: String(c.status ?? "unknown") });
  }
  return ctx.db.write(tx, "coverage_cells", [...rows.values()], rs => `
    insert into evals.coverage_cells (artifact_id, study_id, study_name, test_id, condition_id, run_id, run_pk, status)
    select t.artifact_id, t.study_id, t.study_name, t.test_id, t.condition_id, t.run_id, (select r.run_pk from evals.runs r where r.run_id = t.run_id), t.status
    from ${rs} as t(artifact_id bigint, study_id text, study_name text, test_id text, condition_id text, run_id text, status text)
    where t.artifact_id is not null
    on conflict (artifact_id, study_id, test_id, condition_id) do update set run_pk = coalesce(evals.coverage_cells.run_pk, excluded.run_pk)`);
}

async function analysisDocument(ctx: Ctx, tx: Tx, path: string, kind: string, body: any, size: number, artifactId: number | null, known: Set<string>): Promise<Record<string, number>> {
  const docKind = ["plan", "summary", "comparison", "audit", "diagnostic", "analysis_snapshot", "coverage_ledger", "key_snapshot", "lmstudio_inventory", "file_inventory"].includes(kind) ? kind : "other";
  const generated = body && typeof body === "object" && !Array.isArray(body) ? (body.generatedAt ?? body.updatedAt ?? body.createdAt ?? body.checkedAt ?? null) : null;
  const out: Record<string, number> = {};
  out.analysis_documents = await ctx.db.write(tx, "analysis_documents", [{
    artifact_id: artifactId, doc_kind: docKind, schema_version: typeof body?.schemaVersion === "string" ? body.schemaVersion : null,
    generated_at: typeof generated === "string" && !Number.isNaN(Date.parse(generated)) ? generated : null, title: path.split("/").slice(-2).join("/"),
    body: size <= MAX_BODY ? body : null,
  }], rs => `
    insert into evals.analysis_documents (artifact_id, doc_kind, schema_version, generated_at, title, body)
    select t.artifact_id, t.doc_kind, t.schema_version, t.generated_at, t.title, t.body
    from ${rs} as t(artifact_id bigint, doc_kind evals.artifact_kind, schema_version text, generated_at timestamptz, title text, body jsonb)
    where t.artifact_id is not null
    on conflict (artifact_id) do nothing`);
  const strings = new Set<string>();
  collectStrings(body, strings);
  const runs = [...strings].filter(s => known.has(s)).map(run_id => ({ run_id }));
  out.analysis_document_runs = await ctx.db.write(tx, "analysis_document_runs", runs, rs => `
    insert into evals.analysis_document_runs (artifact_id, run_pk, role)
    select $2, r.run_pk, 'input' from ${rs} as t(run_id text) join evals.runs r on r.run_id = t.run_id
    join evals.analysis_documents d on d.artifact_id = $2
    on conflict do nothing`, [artifactId]);
  return out;
}

async function caseIndex(ctx: Ctx, tx: Tx, text: string, artifactId: number | null): Promise<number> {
  const rows: any[] = [];
  for (const { value } of parseJsonLines(completeLines(text).lines)) {
    const tags = Array.isArray(value.evidenceTags) && value.evidenceTags.length ? value.evidenceTags : [null];
    for (const tag of tags) rows.push({ case_id: value.caseId, source_sha: value.sourceTextSha256 ?? null, model_label: tag?.model ?? null, tier: tag?.tier ?? null,
      requested_values: Array.isArray(value.requestedValues) ? value.requestedValues.map(String) : null, payload: value });
  }
  return ctx.db.write(tx, "case_evidence_tags", rows, rs => `
    insert into evals.case_evidence_tags (artifact_id, case_pk, model_label, tier, requested_values, payload)
    select $2, c.case_pk, t.model_label, t.tier, t.requested_values, t.payload
    from ${rs} as t(case_id text, source_sha text, model_label text, tier text, requested_values text[], payload jsonb)
    join lateral (select x.case_pk from evals.cases x where x.case_id = t.case_id order by x.case_pk desc limit 1) c on true
    where $2::bigint is not null
    on conflict on constraint case_evidence_tags_natural_key do nothing`, [artifactId]);
}
