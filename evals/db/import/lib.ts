/**
 * Pure parsers and mappers for the Supabase importer. No I/O, no network, no
 * subprocesses: everything here is covered by lib.test.ts.
 */
import { createHash } from "node:crypto";

export const IMPORTER_VERSION = "evals-db-import/1";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The repo hashes configs and bodies as sha256(JSON.stringify(value)). */
export function jsonSha(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Splits a file snapshot into complete lines. A final line without "\n" belongs
 * to an active writer and is ignored (truncatedTail = true).
 */
export function completeLines(text: string): { lines: string[]; truncatedTail: boolean } {
  const end = text.lastIndexOf("\n");
  const truncatedTail = end + 1 < text.length;
  if (end < 0) return { lines: [], truncatedTail };
  const lines = text.slice(0, end).split("\n");
  return { lines, truncatedTail };
}

export function parseJsonLines(lines: readonly string[]): { line: number; value: any; text: string }[] {
  const out: { line: number; value: any; text: string }[] = [];
  lines.forEach((text, index) => {
    if (!text.trim()) return;
    try { out.push({ line: index + 1, value: JSON.parse(text), text }); } catch { /* unparseable line: skipped */ }
  });
  return out;
}

// ---------------------------------------------------------------------------
// JSON safety for Postgres: no NUL characters, no lone surrogates.
// ---------------------------------------------------------------------------

export function pgSafeString(value: string): string {
  let out = value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
  if (typeof (out as any).isWellFormed === "function" && !(out as any).isWellFormed()) out = (out as any).toWellFormed();
  return out;
}

export function pgJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "string" ? pgSafeString(v) : v));
}

/** True when the text can be stored verbatim (its sha256 still matches after storage). */
export function storableVerbatim(text: string): boolean {
  return !text.includes("\u0000") && (typeof (text as any).isWellFormed !== "function" || (text as any).isWellFormed());
}

// ---------------------------------------------------------------------------
// Artifact classification
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "checkpoint" | "legacy_event_log" | "source_dataset" | "source_provenance" | "upstream_snapshot"
  | "driver_log" | "console_log" | "batch_ledger" | "budget_ledger" | "key_snapshot" | "endpoint_snapshot"
  | "lmstudio_inventory" | "file_inventory" | "plan" | "summary" | "comparison" | "audit" | "diagnostic"
  | "analysis_snapshot" | "coverage_ledger" | "script" | "figure" | "report" | "literature" | "other";

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json", jsonl: "application/x-ndjson", ndjson: "application/x-ndjson", md: "text/markdown",
  log: "text/plain", txt: "text/plain", ts: "text/plain", py: "text/plain", sh: "text/plain", jinja: "text/plain",
  png: "image/png", svg: "image/svg+xml", pdf: "application/pdf", csv: "text/csv",
};

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

/** `firstLine` is the first line of a .jsonl file, used to recognise checkpoints. */
export function artifactKind(path: string, firstLine?: string): ArtifactKind {
  const base = path.split("/").pop() ?? path;
  const ext = extensionOf(path);
  if (path.startsWith("evals/private/sources/")) return base.endsWith("-provenance.json") ? "source_provenance" : "source_dataset";
  if (path.startsWith("evals/datasets/") && ext === "jsonl") return "source_dataset";
  if (path.startsWith("evals/private/upstream/")) return "upstream_snapshot";
  if (path.startsWith("evals/reports/") || ext === "md") return path.includes("/runs/") ? "other" : "report";
  if (path.includes("/research-literature-")) return "literature";
  if (ext === "jsonl" && firstLine && isCheckpointHead(firstLine)) return "checkpoint";
  if (base === "observations.jsonl" && path.includes("/migrated-")) return "legacy_event_log";
  if (path.includes("/assistant-2026-09/") && ext === "jsonl") return "legacy_event_log";
  if (base === "batch-ledger.jsonl") return "batch_ledger";
  if (base.startsWith("armor-budget") && ext === "jsonl") return "budget_ledger";
  if (ext === "ndjson" && base.startsWith("driver")) return "driver_log";
  if (ext === "log") return "console_log";
  if (["ts", "py", "sh", "jinja"].includes(ext)) return "script";
  if (["png", "svg", "pdf"].includes(ext)) return "figure";
  if (base === "artifact-inventory.json" || base === "inventory-result.json") return "file_inventory";
  if (base === "research-coverage-ledger.json") return "coverage_ledger";
  if (path.includes("/model-endpoints-") || base.startsWith("openrouter-models-")) return "endpoint_snapshot";
  if (/^inventory.*\.json$/.test(base) && path.includes("lmstudio")) return "lmstudio_inventory";
  if (/budget/.test(base) && ext === "json") return "key_snapshot";
  if (/^[0-9a-f]{64}\.json$/.test(base) || /[0-9a-f]{12,}\.json$/.test(base) && path.includes("snapshots")) return "analysis_snapshot";
  if (/plan/.test(base)) return "plan";
  if (/summary/.test(base)) return "summary";
  if (/comparison/.test(base)) return "comparison";
  if (/audit/.test(base)) return "audit";
  if (/diagnostic/.test(base)) return "diagnostic";
  return "other";
}

export function isCheckpointHead(firstLine: string): boolean {
  if (!firstLine.startsWith('{"type":"metadata"')) return false;
  try {
    const head = JSON.parse(firstLine);
    return head?.type === "metadata" && typeof head.value?.runId === "string" && head.value.schemaVersion === "security-eval-run/v1";
  } catch { return false; }
}

/** Storage key for a content-addressed copy of a file. */
export function storageObjectFor(path: string, sha: string): { bucket: string; object: string } {
  const ext = extensionOf(path) || "bin";
  if (path.startsWith("evals/private/") || path.startsWith("evals/datasets/")) {
    const datasetHint = (path.split("/").pop() ?? "file").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "_");
    return { bucket: "eval-sources", object: `sources/${datasetHint}/${sha}.${ext}.gz` };
  }
  return { bucket: "eval-runs", object: `by-sha256/${sha.slice(0, 2)}/${sha}.${ext}.gz` };
}

export function responseObjectFor(runId: string, requestId: string): string {
  const safeRun = runId.replace(/[^A-Za-z0-9/._-]/g, "_").replace(/\.\./g, "_");
  return `responses/${safeRun}/${requestId}.json.gz`;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type ResponseShape = "openai_chat" | "lmstudio_envelope" | "model_armor_assessment" | "model_armor_assessment_native" | "jev_answers" | "other";

export function responseShape(raw: unknown): ResponseShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "other";
  const r = raw as Record<string, unknown>;
  if ("lmStudio" in r && "nativeResponse" in r) return "lmstudio_envelope";
  if ("choices" in r) return "openai_chat";
  if ("answers" in r) return "jev_answers";
  if ("filterMatchState" in r) return "nativeResponse" in r ? "model_armor_assessment_native" : "model_armor_assessment";
  return "other";
}

const STABLE_LMS_KEYS = ["type", "modelKey", "format", "displayName", "publisher", "path", "sizeBytes", "indexedModelIdentifier",
  "deviceIdentifier", "paramsString", "architecture", "quantization", "identifier", "vision", "trainedForToolUse",
  "maxContextLength", "contextLength", "parallel"];

export interface LmsSnapshot {
  snapshot_sha256: string; identifier: string; model_key: string; indexed_model_identifier: string;
  device_identifier: string | null; format: string | null; quantization: string | null;
  context_length: number | null; parallel: number | null; snapshot: Record<string, unknown>;
}

export function lmsSnapshot(entries: unknown, identifier?: string | null): LmsSnapshot | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const entry = (entries.find((e: any) => identifier && e?.identifier === identifier) ?? entries[0]) as Record<string, any>;
  if (!entry || typeof entry !== "object") return null;
  const stable: Record<string, unknown> = {};
  for (const key of STABLE_LMS_KEYS) if (key in entry) stable[key] = entry[key];
  if (typeof entry.identifier !== "string" || typeof entry.modelKey !== "string" || typeof entry.indexedModelIdentifier !== "string") return null;
  return {
    snapshot_sha256: jsonSha(stable), identifier: entry.identifier, model_key: entry.modelKey,
    indexed_model_identifier: entry.indexedModelIdentifier, device_identifier: entry.deviceIdentifier ?? null,
    format: entry.format ?? null, quantization: entry.quantization?.name ?? null,
    context_length: num(entry.contextLength), parallel: num(entry.parallel), snapshot: stable,
  };
}

function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function int(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null; }
function str(v: unknown): string | null { return typeof v === "string" ? v : null; }

export interface ResponseSummary {
  shape: ResponseShape; envelope_version: string | null; native_id: string | null; provider: string | null;
  resolved_model: string | null; finish_reason: string | null; native_finish_reason: string | null;
  prompt_tokens: number | null; completion_tokens: number | null; reasoning_tokens: number | null; cached_tokens: number | null;
  total_tokens: number | null; cost_usd: number | null; upstream_cost_usd: number | null;
  output_text: string | null; output_chars: number | null; reasoning_text: string | null; reasoning_chars: number | null;
  parsed_output: unknown; parse_error: string | null; raw_sha256: string;
  lms_before: LmsSnapshot | null; lms_after: LmsSnapshot | null; armor: ArmorSummary | null;
}

export interface ArmorSummary {
  filter_match_state: string | null; pi_match_state: string | null; confidence_level: string | null;
  invocation_result: string | null; blocked: boolean | null; flagged: boolean | null; normalized_label: string | null;
  matched_filters: string[] | null; filter_verdicts: unknown; filter_version: string | null; filter_release_date: string | null;
  has_native_body: boolean;
}

export function parseOutput(text: string | null): { parsed: unknown; error: string | null } {
  if (text === null) return { parsed: null, error: "no output text" };
  const trimmed = text.trim();
  if (!trimmed) return { parsed: null, error: "empty output" };
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try { return { parsed: JSON.parse(fenced ? fenced[1]! : trimmed), error: null }; }
  catch (e) { return { parsed: null, error: `invalid JSON: ${(e as Error).message.slice(0, 120)}` }; }
}

function chatSummary(native: any, provider: string | null): Omit<ResponseSummary, "shape" | "envelope_version" | "raw_sha256" | "lms_before" | "lms_after" | "armor"> {
  const choice = Array.isArray(native?.choices) ? native.choices[0] : undefined;
  const message = choice?.message ?? {};
  const content = message.content;
  const outputText = typeof content === "string" ? content : content == null ? null : JSON.stringify(content);
  const reasoning = str(message.reasoning) ?? str(message.reasoning_content);
  const usage = native?.usage ?? {};
  const { parsed, error } = parseOutput(outputText);
  return {
    native_id: str(native?.id), provider: provider ?? str(native?.provider), resolved_model: str(native?.model),
    finish_reason: str(choice?.finish_reason), native_finish_reason: str(choice?.native_finish_reason),
    prompt_tokens: int(usage.prompt_tokens), completion_tokens: int(usage.completion_tokens),
    reasoning_tokens: int(usage.completion_tokens_details?.reasoning_tokens), cached_tokens: int(usage.prompt_tokens_details?.cached_tokens),
    total_tokens: int(usage.total_tokens), cost_usd: num(usage.cost), upstream_cost_usd: num(usage.cost_details?.upstream_inference_cost),
    output_text: outputText, output_chars: outputText?.length ?? null, reasoning_text: reasoning, reasoning_chars: reasoning?.length ?? null,
    parsed_output: parsed, parse_error: error,
  };
}

function armorSummary(raw: any): ArmorSummary {
  const verdicts = Array.isArray(raw.filterVerdicts) ? raw.filterVerdicts : [];
  const pi = verdicts.find((v: any) => v?.filter === "pi_and_jailbreak");
  const native = raw.nativeResponse?.sanitizationResult;
  const piNative = native?.filterResults?.pi_and_jailbreak?.piAndJailbreakFilterResult;
  const version = native?.sanitizationMetadata?.filterVersionConfig;
  const date = version?.releaseDate;
  const release = date?.year && date?.month && date?.day
    ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : null;
  return {
    filter_match_state: str(raw.filterMatchState), pi_match_state: str(pi?.matchState) ?? str(piNative?.matchState),
    confidence_level: str(piNative?.confidenceLevel) ?? str(pi?.confidenceLevel), invocation_result: str(raw.invocationResult),
    blocked: typeof raw.blocked === "boolean" ? raw.blocked : null, flagged: typeof raw.flagged === "boolean" ? raw.flagged : null,
    normalized_label: str(raw.label), matched_filters: Array.isArray(raw.matchedFilters) ? raw.matchedFilters.map(String) : null,
    filter_verdicts: verdicts.length ? verdicts : null, filter_version: str(version?.filterVersion), filter_release_date: release,
    has_native_body: !!raw.nativeResponse,
  };
}

/** Extracts the SQL summary columns from one native response body. */
export function summarizeResponse(raw: unknown): ResponseSummary {
  const shape = responseShape(raw);
  const r = raw as any;
  const base = {
    shape, envelope_version: null as string | null, raw_sha256: jsonSha(raw), lms_before: null as LmsSnapshot | null,
    lms_after: null as LmsSnapshot | null, armor: null as ArmorSummary | null,
  };
  if (shape === "openai_chat") return { ...base, ...chatSummary(r, null) };
  if (shape === "lmstudio_envelope") {
    const chat = chatSummary(r.nativeResponse, "LM Studio");
    return {
      ...base, ...chat, envelope_version: str(r.lmStudio?.version) ?? "lmstudio-provenance/v1",
      lms_before: lmsSnapshot(r.lmStudio?.before, chat.resolved_model), lms_after: lmsSnapshot(r.lmStudio?.after, chat.resolved_model),
    };
  }
  const empty = {
    native_id: null, provider: null, resolved_model: null, finish_reason: null, native_finish_reason: null, prompt_tokens: null,
    completion_tokens: null, reasoning_tokens: null, cached_tokens: null, total_tokens: null, cost_usd: null, upstream_cost_usd: null,
    output_text: null, output_chars: null, reasoning_text: null, reasoning_chars: null, parsed_output: null, parse_error: null,
  };
  if (shape === "jev_answers") {
    const usage = r.usage ?? {};
    return {
      ...base, ...empty, native_id: str(r.id), provider: str(r.provider), resolved_model: str(r.model),
      prompt_tokens: int(usage.input_tokens), completion_tokens: int(usage.output_tokens), cost_usd: num(usage.cost),
      total_tokens: int(usage.input_tokens) !== null && int(usage.output_tokens) !== null ? int(usage.input_tokens)! + int(usage.output_tokens)! : null,
      parsed_output: r.answers ?? null,
    };
  }
  if (shape === "model_armor_assessment" || shape === "model_armor_assessment_native") {
    const armor = armorSummary(r);
    return {
      ...base, ...empty, provider: "Google Cloud Model Armor", armor,
      parsed_output: { label: r.label ?? null, flagged: r.flagged ?? null, filterMatchState: r.filterMatchState ?? null, piMatchState: armor.pi_match_state },
    };
  }
  return { ...base, ...empty, parse_error: "unrecognized response shape" };
}

/** Raw bodies stay in Storage except for anomalies, which are also kept in Postgres. */
export function isAnomalousResponse(s: ResponseSummary, hasError: boolean): boolean {
  if (hasError || s.shape === "other") return true;
  if (s.shape === "openai_chat" || s.shape === "lmstudio_envelope") return s.finish_reason !== "stop" || s.parse_error !== null;
  return false;
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export function segmentIndexOf(segmentId: unknown): number | null {
  if (typeof segmentId !== "string") return null;
  const m = /\/(\d+)$/.exec(segmentId);
  return m ? Number(m[1]) : null;
}

export type RunOrigin = "live" | "derived_equivalent" | "reused_full_input" | "legacy_migrated";

export function runOrigin(meta: any): RunOrigin {
  if (meta?.derivedFrom) return "derived_equivalent";
  if (meta?.reuseFrom) return "reused_full_input";
  return "live";
}

/** Import order: live sources first, then runs that reuse native inputs, then reuse and derivation targets. */
export function checkpointRank(meta: any): number {
  if (meta?.derivedFrom) return 3;
  if (meta?.reuseFrom) return 2;
  if (meta?.inputReuseFrom) return 1;
  return 0;
}

export function derivedMethod(meta: any, sourceArtifact: unknown): "derived_segment_equivalence" | "reused_full_input" | "dedup_same_run" | "dedup_native_input" {
  if (typeof sourceArtifact === "string" && sourceArtifact.startsWith("same-run:")) return "dedup_same_run";
  if (meta?.derivedFrom) return "derived_segment_equivalence";
  if (meta?.reuseFrom) return "reused_full_input";
  if (meta?.inputReuseFrom) return "dedup_native_input";
  return "reused_full_input";
}

export interface ParsedCheckpoint {
  meta: any;
  lineCount: number;
  truncatedTail: boolean;
  eventCounts: Record<string, number>;
  completeObservations: number | null;
  hasComplete: boolean;
  firstAt: string | null;
  lastAt: string | null;
  requests: { request_id: string; case_id: string; segment_index: number; attempts: number; first_dispatch_at: string | null; last_dispatch_at: string | null }[];
  rateLimits: { request_id: string; attempt: number; at: string; delay_ms: number; body: string | null }[];
  responses: { request_id: string; case_id: string; segment_index: number | null; line_no: number; at: string | null; raw: unknown; summary: ResponseSummary; anomalous: boolean }[];
  observations: { line_no: number; at: string | null; value: any; derived: boolean; event: any }[];
  errors: { request_id: string | null; case_id: string | null; segment_index: number | null; at: string | null; issue: any; issue_kind: string; outcome_kind: string; event: any }[];
}

export const KNOWN_ERROR_KINDS = new Set(["output_abstention", "length_abstention", "provider_or_transport_error", "http_error",
  "research_dispatch_cap", "provenance_or_validation_failure", "sibling_failure_cancellation", "legacy_error"]);

export function parseCheckpoint(text: string): ParsedCheckpoint {
  const { lines, truncatedTail } = completeLines(text);
  const events = parseJsonLines(lines);
  const head = events[0];
  if (!head || head.value?.type !== "metadata") throw new Error("not a checkpoint (no metadata head)");
  const meta = head.value.value;
  const out: ParsedCheckpoint = {
    meta, lineCount: lines.length, truncatedTail, eventCounts: {}, completeObservations: null, hasComplete: false,
    firstAt: null, lastAt: null, requests: [], rateLimits: [], responses: [], observations: [], errors: [],
  };
  const requests = new Map<string, ParsedCheckpoint["requests"][number]>();
  const errorRequestIds = new Set<string>();
  for (const e of events.slice(1)) if (e.value?.type === "error" && typeof e.value.requestId === "string") errorRequestIds.add(e.value.requestId);
  const lengthLimited = new Set<string>();
  for (const { line, value: ev } of events.slice(1)) {
    const type = String(ev?.type);
    out.eventCounts[type] = (out.eventCounts[type] ?? 0) + 1;
    const at = typeof ev.at === "string" ? ev.at : null;
    if (at) { if (!out.firstAt || at < out.firstAt) out.firstAt = at; if (!out.lastAt || at > out.lastAt) out.lastAt = at; }
    if (type === "dispatch") {
      const id = String(ev.requestId);
      const index = segmentIndexOf(ev.segmentId);
      const prior = requests.get(id);
      if (prior) {
        prior.attempts = Math.max(prior.attempts, Number(ev.attempt) || 1);
        if (at && (!prior.first_dispatch_at || at < prior.first_dispatch_at)) prior.first_dispatch_at = at;
        if (at && (!prior.last_dispatch_at || at > prior.last_dispatch_at)) prior.last_dispatch_at = at;
      } else if (index !== null) {
        requests.set(id, { request_id: id, case_id: String(ev.caseId), segment_index: index, attempts: Math.max(1, Number(ev.attempt) || 1), first_dispatch_at: at, last_dispatch_at: at });
      }
    } else if (type === "rateLimit") {
      out.rateLimits.push({ request_id: String(ev.requestId), attempt: Number(ev.attempt) || 1, at: at ?? out.lastAt ?? new Date(0).toISOString(),
        delay_ms: Math.max(0, Math.round(Number(ev.delayMs) || 0)), body: typeof ev.raw === "string" ? ev.raw.slice(0, 4096) : null });
    } else if (type === "response") {
      const summary = summarizeResponse(ev.raw);
      if (summary.finish_reason === "length") lengthLimited.add(String(ev.requestId));
      out.responses.push({ request_id: String(ev.requestId), case_id: String(ev.caseId), segment_index: segmentIndexOf(ev.segmentId), line_no: line, at,
        raw: ev.raw, summary, anomalous: isAnomalousResponse(summary, errorRequestIds.has(String(ev.requestId))) });
    } else if (type === "observation" || type === "derived_observation") {
      out.observations.push({ line_no: line, at, value: ev.value, derived: type === "derived_observation", event: ev });
    } else if (type === "error") {
      const issueKind = String(ev.issue?.kind ?? "provider_or_transport_error");
      out.errors.push({ request_id: typeof ev.requestId === "string" ? ev.requestId : null, case_id: typeof ev.caseId === "string" ? ev.caseId : null,
        segment_index: segmentIndexOf(ev.segmentId), at, issue: ev.issue ?? {}, issue_kind: issueKind, outcome_kind: issueKind, event: ev });
    } else if (type === "complete") {
      out.hasComplete = true;
      out.completeObservations = typeof ev.observations === "number" ? ev.observations : out.completeObservations;
    }
  }
  for (const err of out.errors) {
    if (err.request_id && lengthLimited.has(err.request_id)) err.outcome_kind = "length_abstention";
    else if (!KNOWN_ERROR_KINDS.has(err.outcome_kind)) err.outcome_kind = "provider_or_transport_error";
  }
  out.requests = [...requests.values()];
  return out;
}

/**
 * Completeness without a marker: every expected segment resolved with some
 * abstentions is 'finished_with_abstentions'; anything else is 'partial'.
 */
export function checkpointCompleteness(p: ParsedCheckpoint): "complete" | "finished_with_abstentions" | "partial" {
  if (p.hasComplete) return "complete";
  const expected = Number(p.meta?.expectedSegments);
  const scored = new Set(p.observations.filter(o => o.value?.status === "scored").map(o => String(o.value.segmentId)));
  const abstained = new Set(p.errors.filter(e => e.outcome_kind === "output_abstention" || e.outcome_kind === "length_abstention")
    .map(e => `${e.case_id}/${e.segment_index}`).filter(id => !scored.has(id)));
  if (Number.isFinite(expected) && expected > 0 && scored.size + abstained.size === expected && abstained.size > 0) return "finished_with_abstentions";
  return "partial";
}

// ---------------------------------------------------------------------------
// Engines, strategies, rules
// ---------------------------------------------------------------------------

export function engineRow(engine: any, deploymentKey: string | null) {
  const p = engine.parameters ?? {};
  const armor = engine.kind === "model_armor";
  return {
    engine_id: engine.id, config_sha256: jsonSha(engine), kind: engine.kind,
    model_text: armor ? null : str(engine.model), provider_text: str(engine.provider),
    deployment_key: deploymentKey,
    prompt_id: armor ? null : str(engine.promptId) ?? str(engine.questionId),
    prompt_sha256: armor ? null : str(engine.promptSha256) ?? str(engine.questionSha256),
    schema_id: str(engine.schemaId),
    armor_template_id: armor ? str(engine.templateId) : null, armor_location: armor ? str(engine.location) : null,
    armor_filter: armor ? str(engine.filter) : null, armor_project_ref: armor ? str(engine.projectId) : null,
    temperature: num(p.temperature), max_output_tokens: int(p.max_tokens ?? p.max_output_tokens),
    reasoning_effort: str(p.reasoning_effort) ?? str(p.reasoning?.effort), reasoning_enabled: typeof p.reasoning_enabled === "boolean" ? p.reasoning_enabled : null,
    request_json_schema: typeof p.request_json_schema === "boolean" ? p.request_json_schema : null,
    withhold_task: typeof p.withhold_task === "boolean" ? p.withhold_task : null,
    parameters: p, lmstudio: engine.lmStudio ?? null, config: engine,
  };
}

/** Deployment natural key: LM Studio artifact, OpenRouter route, or Model Armor template. */
export function deploymentFor(engine: any): {
  deployment_key: string; backend: string; provider: string | null; quantization: string | null; weight_format: string;
  runtime: string; model_key: string | null; indexed_model_identifier: string | null; device_identifier: string | null;
  size_bytes: number | null; max_context_length: number | null; model_alias: string; raw: unknown;
} {
  if (engine.kind === "model_armor") {
    return { deployment_key: `model-armor/${engine.templateId}`, backend: "model_armor", provider: "google-cloud", quantization: null,
      weight_format: "not_applicable", runtime: "managed", model_key: null, indexed_model_identifier: null, device_identifier: null,
      size_bytes: null, max_context_length: null, model_alias: "google/model-armor", raw: { templateId: engine.templateId, location: engine.location } };
  }
  const lm = engine.lmStudio;
  if (lm) {
    const local = String(lm.indexedModelIdentifier).replace(/^[0-9a-f]{32}:/, "");
    const alias = local.split("/").slice(0, 2).join("/");
    return { deployment_key: lm.indexedModelIdentifier, backend: "lmstudio", provider: "lmstudio", quantization: lm.quantization ?? null,
      weight_format: lm.format === "gguf" ? "gguf" : "safetensors", runtime: lm.format === "gguf" ? "llama.cpp (build unreported via LM Link)" : "mlx (build unreported via LM Link)",
      model_key: lm.modelKey ?? null, indexed_model_identifier: lm.indexedModelIdentifier, device_identifier: lm.deviceIdentifier ?? null,
      size_bytes: num(lm.sizeBytes), max_context_length: int(lm.contextLength), model_alias: alias, raw: lm };
  }
  const provider = str(engine.provider);
  const quant = provider && provider.includes("/") ? provider.split("/").slice(1).join("/") : null;
  return { deployment_key: `${engine.model}@${provider ?? "unknown"}`, backend: "openrouter", provider, quantization: quant,
    weight_format: "hosted", runtime: "hosted:unknown", model_key: null, indexed_model_identifier: null, device_identifier: null,
    size_bytes: null, max_context_length: null, model_alias: String(engine.model), raw: { model: engine.model, provider } };
}

export function strategyRow(strategy: any) {
  return {
    strategy_id: strategy.id, config_sha256: jsonSha(strategy), kind: strategy.kind, turn_selection: strategy.turnSelection,
    window_words: int(strategy.windowWords), stride_words: int(strategy.strideWords), max_words: int(strategy.maxWords),
    min_words: int(strategy.minWords), seed: int(strategy.seed), seed_derivation: str(strategy.seedDerivation), config: strategy,
  };
}

export function ruleRow(rule: any, origin: "suite" | "replay" = "suite") {
  return {
    rule_id: rule.id, config_sha256: jsonSha(rule), kind: rule.kind, aggregation: rule.aggregation,
    comparator: rule.kind === "score_threshold" ? rule.comparator : null,
    threshold: rule.kind === "score_threshold" ? rule.threshold : null,
    positive_verdict: rule.kind === "binary_verdict" ? rule.positiveVerdict : null, origin, config: rule,
  };
}

/** Same rules analyze-research.ts replays (exploratory thresholds) as stored rule configs. */
export const REPLAY_THRESHOLDS = [0.3, 0.5, 0.7, 0.9, 0.95, 0.99] as const;
export function replayRules(): any[] {
  const rules: any[] = [];
  for (const aggregation of ["max", "mean", "min"] as const)
    for (const threshold of REPLAY_THRESHOLDS)
      rules.push({ id: `exploratory-${aggregation}-gt-${threshold}`, kind: "score_threshold", aggregation, comparator: ">", threshold });
  for (const aggregation of ["any", "all"] as const)
    rules.push({ id: `exploratory-binary-${aggregation}`, kind: "binary_verdict", aggregation, positiveVerdict: "MATCH_FOUND" });
  return rules;
}

// ---------------------------------------------------------------------------
// Cases: facet projections and injection payload metadata
// ---------------------------------------------------------------------------

function firstFacet(f: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = f[k];
    if (v === undefined || v === null) continue;
    return Array.isArray(v) ? v.join(",") : String(v);
  }
  return null;
}

export function facetProjections(facets: Record<string, unknown>) {
  return {
    attack_family: firstFacet(facets, ["attack_family", "attack", "attack_type", "injection_family", "technique"]),
    attack_template: firstFacet(facets, ["attack_variant", "goal", "obfuscation", "encoding"]),
    attack_position: firstFacet(facets, ["position", "insertion_position"]),
    domain: firstFacet(facets, ["domain", "surface", "task"]),
    source_name: firstFacet(facets, ["source"]),
    split: firstFacet(facets, ["split"]),
    pair_key: firstFacet(facets, ["pair_id", "pair_family", "document_family"]),
    parent_case_id: firstFacet(facets, ["parent_case", "parent_default_case"]),
  };
}

/** The inserted span between a clean sibling and its attacked variant (common prefix/suffix diff). */
export function diffInsertion(clean: string, attacked: string): { start: number; end: number; text: string } | null {
  if (clean === attacked) return null;
  let p = 0;
  const max = Math.min(clean.length, attacked.length);
  while (p < max && clean.charCodeAt(p) === attacked.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && clean.charCodeAt(clean.length - 1 - s) === attacked.charCodeAt(attacked.length - 1 - s)) s++;
  const end = attacked.length - s;
  if (end <= p) return null;
  // Expand to whole words so offsets do not split a token that both versions share.
  let start = p;
  while (start > 0 && /\S/.test(attacked[start - 1]!) && /\S/.test(attacked[start]!)) start--;
  let stop = end;
  while (stop < attacked.length && /\S/.test(attacked[stop]!) && /\S/.test(attacked[stop - 1]!)) stop++;
  return { start, end: stop, text: attacked.slice(start, stop) };
}

export function requestedValueFrom(payload: string | null, facets: Record<string, unknown>): string | null {
  const lo = facets.requested_low, hi = facets.requested_high;
  if (lo !== undefined && hi !== undefined) return `${lo} or ${hi}`;
  if (!payload) return null;
  const pair = /\b(?:score|rating|rate|grade|rank)\b[^.\n]{0,60}?\b(\d+(?:\.\d+)?)\s*(?:or|-|to|\/)\s*(\d+(?:\.\d+)?)\b/i.exec(payload);
  if (pair) return `${pair[1]} or ${pair[2]}`;
  const single = /\b(?:score|rating|rate|grade)\b[^.\n]{0,40}?\b(?:of|as|at|is|to)\s+(\d+(?:\.\d+)?)\b/i.exec(payload);
  return single ? single[1]! : null;
}

export function requestedNumbers(requested: string | null): number[] {
  if (!requested) return [];
  return [...requested.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
}

export type GoalType = "score_request" | "url_insertion" | "approval" | "language_change" | "exfiltration" | "other";

export function classifyGoal(payload: string | null, facets: Record<string, unknown>): GoalType | null {
  const family = String(facets.attack_family ?? facets.category ?? facets.intent ?? "").toLowerCase();
  if (facets.requested_low !== undefined) return "score_request";
  if (/translat|language/.test(family)) return "language_change";
  if (/exfiltrat|eavesdrop|leak/.test(family)) return "exfiltration";
  const text = payload ?? "";
  if (!text && !family) return null;
  if (/\b(score|rating|rate (it|this)|grade)\b[^.\n]{0,60}\d/i.test(text)) return "score_request";
  if (/\b(translat\w*|respond in|reply in|answer in|write in)\b[^.\n]{0,40}\b(french|spanish|german|chinese|japanese|italian|portuguese|russian|korean|arabic|hindi|dutch|english|language)\b|\blanguage\b/i.test(text)) return "language_change";
  if (/\b(approve|approved|approval|lgtm|merge (this|it)|accept (this|the) (pr|pull request|change))\b/i.test(text)) return "approval";
  if (/\b(send|forward|email|e-mail|upload|post|exfiltrat\w*|leak|share)\b[^.\n]{0,80}\b(password|credential|token|api key|secret|data|information|contacts?|address|files?)\b/i.test(text)) return "exfiltration";
  if (/https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}|\[[^\]]+\]\([^)]+\)/i.test(text)) return "url_insertion";
  return "other";
}

// ---------------------------------------------------------------------------
// Ledgers and logs
// ---------------------------------------------------------------------------

export interface BatchLedger {
  batches: { start_line_no: number; start: any; finish: any | null; finish_line_no: number | null }[];
  cells: { batch_start_line_no: number; line_no: number; start: any; finish: any | null; budget_stopped: boolean }[];
}

/** Groups batch-ledger lines: batch_start..batch_finish, and condition_start..condition_finish per (test, condition). */
export function parseBatchLedger(entries: { line: number; value: any }[]): BatchLedger {
  const out: BatchLedger = { batches: [], cells: [] };
  let current: BatchLedger["batches"][number] | null = null;
  const open = new Map<string, BatchLedger["cells"][number]>();
  for (const { line, value } of entries) {
    const type = value?.type;
    if (type === "batch_start") {
      current = { start_line_no: line, start: value, finish: null, finish_line_no: null };
      out.batches.push(current);
      open.clear();
    } else if (!current) {
      continue;
    } else if (type === "batch_finish") {
      current.finish = value; current.finish_line_no = line;
    } else if (type === "condition_start") {
      const cell = { batch_start_line_no: current.start_line_no, line_no: line, start: value, finish: null, budget_stopped: false };
      out.cells.push(cell);
      open.set(`${value.test}|${value.condition}`, cell);
    } else if (type === "condition_finish") {
      const cell = open.get(`${value.test}|${value.condition}`);
      if (cell) { cell.finish = value; open.delete(`${value.test}|${value.condition}`); }
    } else if (type === "budget_stop") {
      out.cells.push({ batch_start_line_no: current.start_line_no, line_no: line, start: value, finish: null, budget_stopped: true });
    }
  }
  return out;
}

/** suite path in a batch ledger ("evals/suites/<id>.json") -> suite file stem. */
export function suiteStemFromPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const m = /([^/]+)\.json$/.exec(path);
  return m ? m[1]! : null;
}

export function driverEventRow(value: any) {
  const v = value?.value && typeof value.value === "object" ? value.value : value;
  const event = str(v?.event) ?? (Array.isArray(v?.command) ? "command" : str(value?.action) ? "action" : null);
  return {
    at: str(value?.at), event, suite_id: str(v?.suite),
    command: Array.isArray(v?.command) ? v.command.map(String) : null,
    exit_code: int(v?.code ?? v?.exitCode ?? v?.status), stdout: str(v?.stdout), stderr: str(v?.stderr),
    pid: int(value?.pid ?? v?.pid),
  };
}

// ---------------------------------------------------------------------------
// Markdown: research log, findings, evidence links
// ---------------------------------------------------------------------------

export function markdownTitle(md: string): string | null {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1]!.trim() : null;
}

export function dateFromPath(path: string): string | null {
  const m = /(20\d\d-\d\d-\d\d)/.exec(path);
  return m ? m[1]! : null;
}

export interface LogEntry { entry_id: string; ordinal: number; title: string; dated: string | null; body_md: string }

export function parseResearchLog(md: string, documentDate: string | null): LogEntry[] {
  const lines = md.split("\n");
  const out: LogEntry[] = [];
  let sectionDate = documentDate;
  let current: LogEntry | null = null;
  const body: string[] = [];
  const flush = () => { if (current) { current.body_md = body.join("\n").trim(); out.push(current); } body.length = 0; };
  for (const line of lines) {
    const section = /^##\s+(.+)$/.exec(line);
    if (section && !line.startsWith("###")) {
      flush(); current = null;
      const iso = /(20\d\d-\d\d-\d\d)/.exec(section[1]!);
      const month = /\b(September|October|November)\s+(\d{1,2})\b/.exec(section[1]!);
      if (iso) sectionDate = iso[1]!;
      else if (month) sectionDate = `2026-${month[1] === "September" ? "09" : month[1] === "October" ? "10" : "11"}-${month[2]!.padStart(2, "0")}`;
      continue;
    }
    const head = /^###\s+([RL]\d+[a-z]?)\s+[—–-]+\s+(.+)$/.exec(line);
    if (head) {
      flush();
      const own = /(20\d\d-\d\d-\d\d)/.exec(head[2]!);
      current = { entry_id: head[1]!, ordinal: out.length, title: head[2]!.trim(), dated: own ? own[1]! : sectionDate, body_md: "" };
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return out;
}

export interface FindingBlock {
  finding_id: string; section: string | null; section_title: string | null; ordinal: number; title: string;
  strength: "strong" | "moderate" | "suggestive" | "anecdotal" | null; strength_note: string | null;
  confounds: string | null; follow_up: string | null; status: "active" | "provisional" | "superseded" | "retracted";
  spot_checked: boolean; body_md: string;
}

function bulletField(body: string, labels: string[]): string | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^-\s+([A-Za-z -]+?):\s*(.*)$/.exec(lines[i]!);
    if (!m || !labels.some(l => m[1]!.toLowerCase().startsWith(l))) continue;
    const parts = [m[2]!];
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]!) && !/^\s*-\s+[A-Z][a-z -]+:/.test(lines[j]!); j++) parts.push(lines[j]!.trim());
    return parts.join(" ").trim();
  }
  return null;
}

export function parseFindings(md: string): FindingBlock[] {
  const lines = md.split("\n");
  const out: FindingBlock[] = [];
  let section: string | null = null, sectionTitle: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const sec = /^###\s+(\d+\.\d+)\s+(.+)$/.exec(line);
    if (sec) { section = sec[1]!; sectionTitle = sec[2]!.trim(); i++; continue; }
    if (/^##\s/.test(line)) { section = null; sectionTitle = null; }
    const start = /^\*\*(O\d+[a-z]?):\s*(.*)$/.exec(line);
    if (!start) { i++; continue; }
    // The bold title may wrap onto following lines until the closing **.
    let titleText = start[2]!;
    let j = i;
    while (!titleText.includes("**") && j + 1 < lines.length) { j++; titleText += " " + lines[j]!.trim(); }
    const title = titleText.split("**")[0]!.trim();
    const bodyLines: string[] = [];
    let k = j + 1;
    while (k < lines.length && !/^\*\*O\d+[a-z]?:/.test(lines[k]!) && !/^#{2,3}\s/.test(lines[k]!)) { bodyLines.push(lines[k]!); k++; }
    const body = bodyLines.join("\n").trim();
    const strengthLine = bulletField(body, ["strength"]);
    const sm = strengthLine ? /\*\*(Strong|Moderate|Suggestive|Anecdotal)\*\*|\b(Strong|Moderate|Suggestive|Anecdotal)\b/i.exec(strengthLine) : null;
    const strength = sm ? ((sm[1] ?? sm[2])!.toLowerCase() as FindingBlock["strength"]) : null;
    const lower = (title + " " + (strengthLine ?? "")).toLowerCase();
    out.push({
      finding_id: start[1]!, section, section_title: sectionTitle, ordinal: out.length, title,
      strength, strength_note: strengthLine, confounds: bulletField(body, ["caveat", "confound"]), follow_up: bulletField(body, ["follow-up", "follow up", "followup"]),
      status: /retracted/.test(lower) ? "retracted" : /superseded/.test(lower) ? "superseded" : /provisional/.test(lower) ? "provisional" : "active",
      spot_checked: /Evidence\s*✔|✔/.test(body.split("\n").find(l => /^-\s+Evidence/.test(l)) ?? ""),
      body_md: [lines.slice(i, j + 1).join("\n"), body].join("\n").trim(),
    });
    i = k;
  }
  return out;
}

export interface EvidenceRef { kind: "document" | "path"; value: string }

/**
 * Evidence references in a markdown block: links to reports (documents) and
 * runs/ or private/ paths in links or backticks. Paths are made repo-relative.
 */
export function evidenceRefs(md: string, baseDir: string): EvidenceRef[] {
  const refs = new Map<string, EvidenceRef>();
  const add = (raw: string) => {
    let target = raw.trim().replace(/[#?].*$/, "").replace(/[),.;:]+$/, "");
    if (!target || /^https?:/.test(target)) return;
    target = normalizeRepoPath(baseDir, target);
    if (!target.startsWith("evals/")) return;
    if (target.endsWith(".md") && !target.includes("/runs/")) refs.set(`d:${target}`, { kind: "document", value: target });
    else if (target.startsWith("evals/runs/") || target.startsWith("evals/private/")) refs.set(`p:${target}`, { kind: "path", value: target });
  };
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]!);
  for (const m of md.matchAll(/`((?:\.\.\/)*(?:evals\/)?(?:runs|private)\/[^`\s]+)`/g)) add(m[1]!);
  return [...refs.values()];
}

export function normalizeRepoPath(baseDir: string, target: string): string {
  const parts = (target.startsWith("evals/") ? target : `${baseDir}/${target}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return out.join("/");
}

/** R/L log ids referenced in a block (ranges like R0–R23 yield both ends). */
export function logEntryRefs(md: string): string[] {
  return [...new Set([...md.matchAll(/\b([RL]\d{1,3})\b/g)].map(m => m[1]!))];
}

// ---------------------------------------------------------------------------
// Counterfactual pairs
// ---------------------------------------------------------------------------

export function counterfactualArm(facets: Record<string, unknown>): { pair_kind: "attack" | "control"; arm: "low" | "high" | "out_of_range"; target_low: number; target_high: number } | null {
  const lo = Number(facets.requested_low), hi = Number(facets.requested_high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const arm = hi > 1 ? "out_of_range" : hi >= 0.5 ? "high" : "low";
  return { pair_kind: facets.attack === "numeric_fact" ? "control" : "attack", arm, target_low: lo, target_high: hi };
}

// ---------------------------------------------------------------------------
// Small concurrency helper
// ---------------------------------------------------------------------------

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]!, i); }
  });
  await Promise.all(workers);
  return results;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
