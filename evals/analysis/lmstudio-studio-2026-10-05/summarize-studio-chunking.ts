/** Study A: offline extraction of paired full/window rows on the Studio (no inference). Validates every checkpoint. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditPartialCheckpoint, type Event, type Metadata } from '../../scripts/analyze-research.js';
import { readCompleteJsonl } from '../../src/researchMatrix.js';
import { loadDataset } from '../../src/datasets.js';
import { segmentCase, sha256 } from '../../src/strategies.js';
import type { DatasetManifest, InferenceObservation } from '../../src/types.js';

const root = resolve(import.meta.dir, '../../..'); // published copy: see evals/analysis/README.md
const run = process.env.RUN_DIR ?? 'evals/runs/lmstudio-studio-2026-10-05';
const plan = JSON.parse(readFileSync(resolve(root, run, 'chunking-moe-dense-plan.json'), 'utf8'));
const MODELS: [string, string][] = [['gemma26-q8', 'MoE'], ['ornith-q8', 'MoE'], ['qwen38-q8gguf', 'dense'], ['muse-q8', 'dense'], ['gemma31-q8', 'dense']];
const DOMAINS: [string, string][] = [['paper', 'longpi-paper'], ['email', 'longpi-email'], ['code', 'longpi-code']];

type Seg = { index: number; startWord?: number; endWord?: number; inputSha256: string; score: number | null; status: string; requestId: string | null; reused: boolean;
  reasoningTokens: number | null; completionTokens: number | null; durationMs: number | null; ttftS: number | null; tps: number | null; retainedForCoverage: boolean; payloadBearing: boolean; payloadWhole: boolean; payloadPartial: boolean };

function read(path: string) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const events = readCompleteJsonl(text).events as Event[];
  const audit = auditPartialCheckpoint(events, root);
  const metadata = events[0]!.value as Metadata;
  const obs = new Map<string, { o: InferenceObservation; derived: boolean }>();
  for (const e of events) if (e.type === 'observation' || e.type === 'derived_observation') { const o = e.value as InferenceObservation; obs.set(o.segmentId, { o, derived: e.type === 'derived_observation' }); }
  const raw = new Map<string, any>();
  for (const e of events) if (e.type === 'response') raw.set(String(e.requestId), (e as any).raw);
  const failed = new Map<string, string>();
  for (const e of events) if (e.type === 'error') failed.set(String(e.segmentId), String((e as any).issue?.kind));
  return { path, text, events, audit, metadata, obs, raw, failed };
}
function nativeUsage(raw: any) {
  const n = raw?.nativeResponse; const u = n?.usage;
  return { reasoning: u?.completion_tokens_details?.reasoning_tokens ?? null, completion: u?.completion_tokens ?? null };
}
function pick(domain: string, test: string, model: string) {
  const full = `${run}/${test}/studio-${model}-thinking1024-full${domain === 'email' ? '-limit80' : ''}.jsonl`;
  const lim = domain === 'email' ? '-limit80' : '';
  const candidates = domain === 'code' ? [`${run}/${test}/studio-${model}-thinking1024-preserve512-nodedup.jsonl`]
    : [`${run}/${test}/studio-${model}-thinking1024-preserve512${lim}.jsonl`, `${run}/${test}/studio-${model}-thinking1024-preserve512-nodedup${lim}.jsonl`,
       `${run}/${test}/studio-${model}-thinking1024-ladder-preserve512${lim}.jsonl`]; // ladder: identical engine/strategy rerun (L141)
  return { full, windows: candidates.filter(p => existsSync(resolve(root, p))) };
}

const out: any = { generatedAt: new Date().toISOString(), plan: { path: `${run}/chunking-moe-dense-plan.json`, sha256: sha256(readFileSync(resolve(root, run, 'chunking-moe-dense-plan.json'), 'utf8')) }, cells: [] };
for (const [domain, test] of DOMAINS) {
  const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/longpibench-${domain}-default-v1.json`), 'utf8')) as DatasetManifest;
  const allCases = loadDataset(manifest, root);
  for (const [model, group] of MODELS) {
    const p = pick(domain, test, model);
    if (!existsSync(resolve(root, p.full)) || !p.windows.length) { out.cells.push({ model, group, domain, status: 'missing' }); continue; }
    const full = read(p.full);
    // Prefer the deduplicated window checkpoint when it covers the frozen cases; otherwise the pre-registered fallback.
    const rejected: { path: string; reason: string }[] = [];
    const winReads = p.windows.flatMap(path => { try { return [read(path)]; } catch (e) { rejected.push({ path, reason: e instanceof Error ? e.message : String(e) }); return []; } });
    if (!winReads.length) { out.cells.push({ model, group, domain, status: 'missing', rejected }); continue; }
    const frozen: string[] = plan.cohorts[domain].caseIds;
    const scope = domain === 'paper' && group === 'MoE' ? allCases.map(c => c.id) : frozen;
    const covers = (w: ReturnType<typeof read>, ids: string[]) => ids.every(id => ['scored', 'output_abstention', 'length_abstention'].includes(w.audit.cases.get(id)?.status ?? ''));
    const win = winReads.find(w => covers(w, frozen)) ?? winReads[0]!;
    const fullDone = covers(full, frozen);
    const rowsFor = (ids: string[]) => ids.map(id => {
      const c = allCases.find(x => x.id === id)!;
      const fa = full.audit.cases.get(id), wa = win.audit.cases.get(id);
      const fseg = segmentCase(c, full.metadata.inputStrategy)[0]!;
      const fo = full.obs.get(fseg.id)?.o;
      const fu = fo ? nativeUsage(full.raw.get(fo.requestId)) : { reasoning: null, completion: null };
      // Clean sibling window hashes identify attack-bearing windows (text absent from the clean document's windows).
      const sib = allCases.find(x => x.facets.document_family === c.facets.document_family && x.facets.attack === 'no')!;
      const cleanHashes = new Set(segmentCase(sib, win.metadata.inputStrategy).map(s => s.textSha256));
      // Inserted span = attack source minus the longest common prefix/suffix with the clean sibling.
      const at = fseg.text, ct = segmentCase(sib, full.metadata.inputStrategy)[0]!.text;
      let pre = 0; while (pre < at.length && pre < ct.length && at[pre] === ct[pre]) pre++;
      let suf = 0; while (suf < at.length - pre && suf < ct.length - pre && at[at.length - 1 - suf] === ct[ct.length - 1 - suf]) suf++;
      const inserted = c.facets.attack === 'no' ? '' : at.slice(pre, at.length - suf).trim();
      const probes = inserted.length > 80 ? [inserted.slice(0, 40), inserted.slice(-40)] : [inserted];
      let coveredEnd = 0;
      const segs: Seg[] = segmentCase(c, win.metadata.inputStrategy).map(s => {
        const rec = win.obs.get(s.id); const o = rec?.o;
        const reqId = o ? o.requestId : null;
        const u = reqId && !rec!.derived ? nativeUsage(win.raw.get(reqId)) : { reasoning: null, completion: null };
        const retained = (s.endWord ?? 0) > coveredEnd; coveredEnd = Math.max(coveredEnd, s.endWord ?? 0);
        return { index: s.index, startWord: s.startWord, endWord: s.endWord, inputSha256: s.textSha256, score: typeof o?.rawScore === 'number' ? o.rawScore : null,
          status: o ? 'scored' : (win.failed.get(s.id) ?? 'unattempted'), requestId: reqId, reused: !!rec?.derived,
          reasoningTokens: rec?.derived ? null : u.reasoning, completionTokens: rec?.derived ? null : u.completion,
          durationMs: rec?.derived ? null : o?.durationMs ?? null, ttftS: rec?.derived ? null : (o as any)?.speed?.ttftS ?? null, tps: rec?.derived ? null : (o as any)?.speed?.tokensPerSecond ?? null,
          retainedForCoverage: retained, payloadBearing: c.facets.attack !== 'no' && !cleanHashes.has(s.textSha256),
          payloadWhole: !!inserted && s.text.includes(inserted), payloadPartial: !!inserted && probes.some(p => s.text.includes(p)) };
      });
      return { caseId: id, family: String(c.facets.document_family), attack: String(c.facets.attack), positive: fa?.positive ?? null,
        full: { status: fa?.status ?? 'unattempted', score: typeof fo?.rawScore === 'number' ? fo.rawScore : null, requestId: fo?.requestId ?? null, reasoningTokens: fu.reasoning, completionTokens: fu.completion, durationMs: fo?.durationMs ?? null, ttftS: (fo as any)?.speed?.ttftS ?? null, inputSha256: fseg.textSha256 },
        insertedChars: inserted.length, window: { status: wa?.status ?? 'unattempted', segments: segs }, fullInputEqualsSingleWindow: segs.length === 1 && segs[0]!.inputSha256 === fseg.textSha256 };
    });
    const source = (s: ReturnType<typeof read>) => ({ path: s.path, capturedBytes: Buffer.byteLength(s.text), capturedSha256: sha256(s.text), completeMarker: s.audit.completeMarker, deduplication: s.metadata.deduplication ?? null, caseLimit: s.metadata.caseLimit ?? null, engineId: s.metadata.engine.id });
    if (JSON.stringify(full.metadata.engine) !== JSON.stringify(win.metadata.engine)) throw new Error('Full/window engine differs');
    out.cells.push({ model, group, domain, status: fullDone && covers(win, frozen) ? 'frozen_complete' : 'in_progress', sources: { full: source(full), window: source(win), otherWindowCheckpoints: winReads.filter(w => w !== win).map(source), rejectedWindowCheckpoints: rejected },
      rows: rowsFor(frozen), extension400: scope.length > frozen.length && covers(full, scope) && covers(win, scope) ? rowsFor(scope) : null });
  }
}
writeFileSync(resolve(root, run, 'chunking-rows.json'), JSON.stringify(out) + '\n');
console.log(JSON.stringify(out.cells.map((c: any) => [c.model, c.domain, c.status, !!c.extension400])));
