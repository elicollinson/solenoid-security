/** Study B (quant x chunking ladder): offline paired full/window rows for every build x cohort available. No inference.
 * Validates each checkpoint with the partial auditor. Writes ladder-rows.json. NotInject windows are exact-input
 * equivalent to full (planner), so its window arm is the full arm by identity. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditPartialCheckpoint, type Event, type Metadata } from '../../scripts/analyze-research.js';
import { readCompleteJsonl } from '../../src/researchMatrix.js';
import { loadDataset, selectTestCases } from '../../src/datasets.js';
import { segmentCase, sha256 } from '../../src/strategies.js';
import type { DatasetManifest, InferenceObservation } from '../../src/types.js';

const root = resolve(import.meta.dir, '../../..'); // published copy: see evals/analysis/README.md
const run = process.env.RUN_DIR ?? 'evals/runs/lmstudio-studio-2026-10-05';
const BUILDS: [string, string, string][] = [
  ['gemma26-q8', 'Gemma26', 'MoE'], ['gemma26-q6', 'Gemma26', 'MoE'], ['gemma26-q4km', 'Gemma26', 'MoE'],
  ['ornith-q8', 'Ornith', 'MoE'], ['ornith-q6', 'Ornith', 'MoE'], ['ornith-q4km', 'Ornith', 'MoE'],
  ['qwen38-q8gguf', 'Qwen3.8', 'dense'], ['qwen38-q6gguf', 'Qwen3.8', 'dense'], ['qwen38-q4kmgguf', 'Qwen3.8', 'dense'],
  ['muse-q8', 'Muse', 'dense'], ['muse-q6kxl', 'Muse', 'dense'],
  ['gemma31-q8', 'Gemma31', 'dense'], ['gemma31-q6', 'Gemma31', 'dense'], ['gemma31-q4km', 'Gemma31', 'dense'],
  ['qwen38-mlx8-promptjson', 'Qwen3.8 MLX pair', 'dense'], ['qwen38-q8gguf-promptjson', 'Qwen3.8 MLX pair', 'dense'],
  ['qwen38-mlx8-schema', 'Qwen3.8 MLX pair', 'dense'], ['qwen38-q8gguf-schema-ctx262144', 'Qwen3.8 MLX pair', 'dense'],
];
const COHORTS: [string, string, string, number][] = [ // name, test, dataset, frozen cases (first N)
  ['paper80', 'longpi-paper', 'longpibench-paper-default-v1', 80], ['email80', 'longpi-email', 'longpibench-email-default-v1', 80],
  ['code80', 'longpi-code', 'longpibench-code-default-v1', 80], ['numeric', 'paper-score-counterfactual', 'longpibench-paper-score-counterfactual-v1', 72],
  ['bipia', 'bipia-email-mixed', 'bipia-email-paired-v1', 156], ['notinject', 'benign-false-positives', 'notinject-benign-339', 339],
];
function fullPath(b: string, test: string) {
  return `${run}/${test}/studio-${b}-thinking1024-full${test === 'longpi-email' ? '-limit80' : ''}.jsonl`;
}
function windowPaths(b: string, test: string) {
  const lim = test === 'longpi-email' ? '-limit80' : '';
  return [`${run}/${test}/studio-${b}-thinking1024-ladder-preserve512${lim}.jsonl`, `${run}/${test}/studio-${b}-thinking1024-preserve512-nodedup${lim}.jsonl`].filter(p => existsSync(resolve(root, p)));
}
function read(path: string) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const events = readCompleteJsonl(text).events as Event[];
  const audit = auditPartialCheckpoint(events, root);
  const metadata = events[0]!.value as Metadata;
  const obs = new Map<string, InferenceObservation>();
  for (const e of events) if (e.type === 'observation' || e.type === 'derived_observation') { const o = e.value as InferenceObservation; obs.set(o.segmentId, o); }
  const raw = new Map<string, any>(); for (const e of events) if (e.type === 'response') raw.set(String(e.requestId), (e as any).raw);
  const failed = new Map<string, string>(); for (const e of events) if (e.type === 'error') failed.set(String(e.segmentId), String((e as any).issue?.kind));
  return { path, text, audit, metadata, obs, raw, failed };
}
const reasoning = (raw: any) => raw?.nativeResponse?.usage?.completion_tokens_details?.reasoning_tokens ?? null;
const FIN = ['scored', 'output_abstention', 'length_abstention'];
const out: any = { generatedAt: new Date().toISOString(), cells: [] };
for (const [cohort, test, dataset, n] of COHORTS) {
  const manifest = JSON.parse(readFileSync(resolve(root, `evals/datasets/${dataset}.json`), 'utf8')) as DatasetManifest;
  const testSpec = JSON.parse(readFileSync(resolve(root, 'evals/suites/prompt-injection-lmstudio-studio-thinking1024-v1.json'), 'utf8')).tests.find((t: any) => t.id === test);
  const cases = selectTestCases(loadDataset(manifest, root), manifest, testSpec).slice(0, n);
  const group = (c: any) => cohort === 'bipia' ? String(c.facets.pair_id) : cohort === 'numeric' ? `${c.facets.document_family}|${c.facets.requested_high}` : cohort === 'notinject' ? c.id : String(c.facets.document_family);
  const family = (c: any) => cohort === 'bipia' ? String(c.facets.pair_id) : cohort === 'notinject' ? c.id : String(c.facets.document_family);
  for (const [b, fam, arch] of BUILDS) {
    const fp = fullPath(b, test);
    if (!existsSync(resolve(root, fp))) continue;
    const full = read(fp);
    const wps = cohort === 'notinject' ? [] : windowPaths(b, test);
    const win = wps.length ? read(wps[0]!) : null;
    const covers = (r: ReturnType<typeof read>) => cases.every(c => FIN.includes(r.audit.cases.get(c.id)?.status ?? ''));
    const strategy = win?.metadata.inputStrategy;
    const rows = cases.map(c => {
      const fseg = segmentCase(c, full.metadata.inputStrategy)[0]!;
      const fo = full.obs.get(fseg.id);
      const sib = cases.find(x => group(x) === group(c) && x.label === 'benign' && x.id !== c.id) ?? null;
      let inserted = '';
      if (sib && c.label !== 'benign') {
        const at = fseg.text, ct = segmentCase(sib, full.metadata.inputStrategy)[0]!.text;
        let pre = 0; while (pre < at.length && pre < ct.length && at[pre] === ct[pre]) pre++;
        let suf = 0; while (suf < at.length - pre && suf < ct.length - pre && at[at.length - 1 - suf] === ct[ct.length - 1 - suf]) suf++;
        inserted = at.slice(pre, at.length - suf).trim();
      }
      const probes = inserted.length > 80 ? [inserted.slice(0, 40), inserted.slice(-40)] : [inserted];
      let segs: any[] | null = null;
      if (cohort === 'notinject') segs = [{ index: 0, inputSha256: fseg.textSha256, score: typeof fo?.rawScore === 'number' ? fo.rawScore : null, status: fo ? 'scored' : (full.failed.get(fseg.id) ?? 'unattempted'), retainedForCoverage: true, payloadWhole: false, payloadPartial: false, reasoningTokens: fo ? reasoning(full.raw.get(fo.requestId)) : null, durationMs: fo?.durationMs ?? null, equivalence: 'exact-input-identical-to-full' }];
      else if (win && strategy) {
        let covered = 0;
        segs = segmentCase(c, strategy).map(s => {
          const o = win.obs.get(s.id); const kept = (s.endWord ?? 0) > covered; covered = Math.max(covered, s.endWord ?? 0);
          return { index: s.index, inputSha256: s.textSha256, score: typeof o?.rawScore === 'number' ? o.rawScore : null, status: o ? 'scored' : (win.failed.get(s.id) ?? 'unattempted'),
            retainedForCoverage: kept, payloadWhole: !!inserted && s.text.includes(inserted), payloadPartial: !!inserted && probes.some(p => s.text.includes(p)),
            reasoningTokens: o ? reasoning(win.raw.get(o.requestId)) : null, durationMs: o?.durationMs ?? null };
        });
      }
      return { caseId: c.id, family: family(c), attack: String(c.facets.attack ?? c.facets.attack_family ?? ''), positive: c.label !== 'benign',
        full: { status: full.audit.cases.get(c.id)?.status ?? 'unattempted', score: typeof fo?.rawScore === 'number' ? fo.rawScore : null, inputSha256: fseg.textSha256,
          reasoningTokens: fo ? reasoning(full.raw.get(fo.requestId)) : null, durationMs: fo?.durationMs ?? null, ttftS: (fo as any)?.speed?.ttftS ?? null, tps: (fo as any)?.speed?.tokensPerSecond ?? null },
        window: segs ? { status: segs.every(s => s.status === 'scored') ? 'scored' : segs.some(s => s.status === 'unattempted') ? 'unattempted' : 'abstention', segments: segs } : null };
    });
    const src = (r: ReturnType<typeof read>) => ({ path: r.path, capturedBytes: Buffer.byteLength(r.text), capturedSha256: sha256(r.text), completeMarker: r.audit.completeMarker, engineId: r.metadata.engine.id, parallel: r.metadata.engine.lmStudio?.parallel, clientConcurrency: (r.metadata as any).clientConcurrency ?? 1 });
    if (win && JSON.stringify(win.metadata.engine) !== JSON.stringify(full.metadata.engine)) throw new Error(`engine differs ${b} ${cohort}`);
    out.cells.push({ build: b, family: fam, arch, cohort, fullComplete: covers(full), windowComplete: cohort === 'notinject' ? covers(full) : !!win && covers(win), sources: { full: src(full), window: win ? src(win) : null }, rows });
  }
}
writeFileSync(resolve(root, run, 'ladder-rows.json'), JSON.stringify(out) + '\n');
console.log(out.cells.map((c: any) => `${c.build}:${c.cohort}:${c.fullComplete ? 'F' : 'f'}${c.windowComplete ? 'W' : 'w'}`).join(' '));
