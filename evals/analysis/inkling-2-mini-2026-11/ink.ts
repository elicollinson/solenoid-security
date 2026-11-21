/**
 * Inkling-2-Mini on the frozen Studio protocol (Claude Code 2026-11-21). Offline except `probe` (read-only `lms ls`,
 * never loads) and `hfcheck` (Hugging Face API, read-only). Run from the worktree root (evals/runs, evals/private and the
 * git-ignored datasets are symlinks into the main checkout). IDs and numbers only; no case text is printed or written.
 *
 *   bun ink.ts probe <v> [--out=<pin.json>]        Studio inventory entry for the variant: 0 present, 3 absent, 1 ambiguous
 *   bun ink.ts pincheck <v> <pin.json>             0 = equals plan pin; 5 = same identifiers, smaller (downloading); 4 = differs
 *   bun ink.ts hfcheck <v>                         0 = HF LFS sha256 + size equal the plan record; 4 = differ; 5 = unreachable
 *   bun ink.ts suites <v> [--write|--check]        pilot (5 tests), baseline (21) and extension (14) suites of a variant
 *   bun ink.ts rerun <v> <kind> <n> [--write]      transport-rerun suite n (1|2): suite ID -v<1+n> and condition -r<n> only
 *   bun ink.ts dryrun <v> <kind> <suite> <cond>    run-suite dry run per test (cases == planned calls == plan) + matrix dry run
 *   bun ink.ts gate <v>                            drift/rendering gate on the first 24 bipia-email-mixed cases vs the pilot
 *   bun ink.ts cell <v> <kind> <test>              one CELL line; exit 1 incomplete/identity/usage; exit 6 ABSTENTION_RUNAWAY
 *   bun ink.ts summarize <v> <k>/<n>               one MODEL_DONE line (descriptive)
 *   bun ink.ts pilot <v>                           pilot summary JSON (parse/abstention rates, wall time, frozen ratios)
 * kind = pilot | baseline | extension. Suites: tests, inputStrategies and decisionRules copied JSON-identical from the
 * frozen Studio Q8 t4096 suites; one engine (the frozen gemma26-q8 engine with model identity, effort note and the
 * speculative-decoding record changed); one condition equal to the frozen condition apart from id and engine.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { extract, ba, median, FINISHED, type Row } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";

const HERE = import.meta.dir, ROOT = process.cwd();
export const plan = JSON.parse(readFileSync(resolve(HERE, "plan.json"), "utf8"));
export const RUN_DIR = resolve(ROOT, process.env.INK_RUN_DIR ?? plan.runDir);
const RESULTS = process.env.INK_RESULTS_DIR ? resolve(process.env.INK_RESULTS_DIR) : resolve(HERE, "results");  // override: offline mock test only
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const canon = (v: unknown) => JSON.stringify(sorted(v));
const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = () => new Date().toISOString();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const log = (line: string) => { appendFileSync(resolve(RUN_DIR, "progress.log"), line + "\n"); console.log(line); };
const V = (v: string) => { const x = plan.variants[v]; if (!x) { console.error(`unknown variant ${v}`); process.exit(1); } return x; };
export type Kind = "pilot" | "baseline" | "extension";
/** The variant's pin: plan.json (committed) or, for a variant with an autoPin rule and no plan pin, the chain's auto-pin
 * record (<run dir>/pins/<v>.auto.json, written by `autopin` after two identical probes). Same for the HF record. */
const autoFile = (v: string, what: "pin" | "hf") => resolve(RUN_DIR, "pins", `${v}.auto${what === "hf" ? "-hf" : ""}.json`);
export const pinOf = (v: string) => V(v).pin ?? (V(v).autoPin && existsSync(autoFile(v, "pin")) ? JSON.parse(readFileSync(autoFile(v, "pin"), "utf8")).pin : null);
export const hfOf = (v: string) => V(v).hf ?? (V(v).autoPin && existsSync(autoFile(v, "hf")) ? JSON.parse(readFileSync(autoFile(v, "hf"), "utf8")) : null);
const FULL: Kind[] = ["baseline", "extension"];

export const suiteIdOf = (v: string, kind: Kind, n = 0) => `prompt-injection-lmstudio-studio-inkling2mini-${kind}-t4096-${V(v).label}-v${1 + n}`;
export const suitePathOf = (v: string, kind: Kind, n = 0) => `evals/suites/${suiteIdOf(v, kind, n)}.json`;
export const conditionOf = (v: string, kind: Kind, n = 0) => `${kind === "pilot" ? "pilot" : "baseline"}-${V(v).label}${n ? `-r${n}` : ""}-t4096-full`;

export function engineOf(v: string) {
  const x = V(v), pin = pinOf(v);
  if (!pin) throw new Error(`${v}: no pin recorded in plan.json`);
  const frozen = JSON.parse(read(plan.frozen.baseline.path)).engines[plan.frozen.templateEngine];
  return {
    id: `studio-${x.label}-lmstudio-score-v1-thinking4096-native-v0-v1`, kind: frozen.kind, model: `solenoid-studio-${x.label}-thinking4096`, provider: frozen.provider,
    promptId: frozen.promptId, promptSha256: frozen.promptSha256, schemaId: frozen.schemaId,
    parameters: { temperature: 0, max_tokens: 4096, reasoning_effort: plan.reasoning.effort, effort_mechanism: x.effortMechanism, speculative_decoding: x.speculativeDecoding },
    lmStudio: { baseUrl: frozen.lmStudio.baseUrl, modelKey: pin.modelKey, indexedModelIdentifier: pin.indexedModelIdentifier, deviceIdentifier: plan.device, format: x.format,
      quantization: pin.quantization, sizeBytes: pin.sizeBytes, contextLength: frozen.lmStudio.contextLength, parallel: 1, timeoutMs: frozen.lmStudio.timeoutMs, endpoint: frozen.lmStudio.endpoint },
  };
}
export function buildSuites(v: string) {
  const b = JSON.parse(read(plan.frozen.baseline.path)), e = JSON.parse(read(plan.frozen.extension.path));
  for (const [k, s] of [["baseline", b], ["extension", e]] as const) if (sha(read(plan.frozen[k].path)) !== plan.frozen[k].sha256) throw new Error(`frozen ${k} suite hash differs from plan`);
  if (canon(b.inputStrategies) !== canon(e.inputStrategies) || canon(b.decisionRules) !== canon(e.decisionRules)) throw new Error("frozen suites differ in strategy/rule");
  const fe = b.engines[plan.frozen.templateEngine], eng = engineOf(v), key = V(v).label;
  // The new engine may differ from the frozen template engine only in identity, effort note and speculative record.
  const strip = (x: any) => { const { id, model, parameters, lmStudio, ...rest } = x; const { effort_mechanism, speculative_decoding, reasoning_effort, ...p } = parameters;
    const { modelKey, indexedModelIdentifier, sizeBytes, quantization, format, ...l } = lmStudio; return { ...rest, parameters: p, lmStudio: l }; };
  if (canon(strip(eng)) !== canon(strip(fe))) throw new Error("engine differs from the frozen template engine beyond identity");
  if (fe.parameters.reasoning_effort !== plan.reasoning.effort) throw new Error("reasoning effort differs from the frozen request");
  const fc = b.conditions.find((c: any) => c.engine === plan.frozen.templateEngine);
  const out: Record<string, { text: string; sha256: string; tests: number; path: string }> = {};
  for (const kind of ["pilot", "baseline", "extension"] as Kind[]) {
    const tests = kind === "baseline" ? b.tests : kind === "extension" ? e.tests
      : plan.pilot.tests.map((p: any) => [...b.tests, ...e.tests].find((t: any) => t.id === p.test));
    const cond = { ...fc, id: conditionOf(v, kind), engine: key };
    const suite = { schemaVersion: b.schemaVersion, id: suiteIdOf(v, kind), tests, engines: { [key]: eng }, inputStrategies: b.inputStrategies, decisionRules: b.decisionRules, conditions: [cond] };
    const text = JSON.stringify(suite, null, 2) + "\n", back = JSON.parse(text);
    if (kind !== "pilot" && JSON.stringify(back.tests) !== JSON.stringify((kind === "baseline" ? b : e).tests)) throw new Error("tests copy mismatch");
    if (back.tests.some((t: any) => !t)) throw new Error("pilot test missing from frozen suites");
    out[kind] = { text, sha256: sha(text), tests: tests.length, path: suitePathOf(v, kind) };
  }
  return out;
}
export function rerunSuite(v: string, kind: Kind, n: number) {
  const baseText = read(suitePathOf(v, kind)), base = JSON.parse(baseText);
  const suite = { ...base, id: suiteIdOf(v, kind, n), conditions: [{ ...base.conditions[0], id: conditionOf(v, kind, n) }] };
  const text = JSON.stringify(suite, null, 2) + "\n";
  return { text, sha256: sha(text), path: suitePathOf(v, kind, n), condition: conditionOf(v, kind, n), base: suitePathOf(v, kind), baseSha256: sha(baseText) };
}
/** Analyzed checkpoint of a cohort: newest transport rerun (r2, r1) that exists, else the v1 condition. Partials are kept. */
export const fileOf = (v: string, kind: Kind, test: string) => {
  for (const n of [2, 1]) { const f = resolve(RUN_DIR, test, `${conditionOf(v, kind, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(RUN_DIR, test, `${conditionOf(v, kind)}.jsonl`);
};
export const rowsOf = (v: string, kind: Kind, test: string) => extract(fileOf(v, kind, test));
export const identityOk = (v: string, r: Row) => { const e = engineOf(v); return r.responseModel === e.model && r.quant === e.lmStudio.quantization && r.loadedIndexed === e.lmStudio.indexedModelIdentifier; };
const abst = (rows: Row[]) => rows.filter(r => r.status !== "scored").length;
const mean = (xs: number[]) => { const y = xs.filter(x => !Number.isNaN(x)); return y.reduce((a, b) => a + b, 0) / Math.max(1, y.length); };
const frozenFile = (kind: "baseline" | "extension", test: string, model: string) => resolve(ROOT, plan.frozen[kind].runDir, test, `baseline-${model}-t4096-full.jsonl`);
const kindOfTest = (test: string): "baseline" | "extension" => JSON.parse(read(plan.frozen.baseline.path)).tests.some((t: any) => t.id === test) ? "baseline" : "extension";
const draftRate = (rows: Row[]) => { const t = rows.reduce((a, r) => a + (r.draftTotal ?? 0), 0), acc = rows.reduce((a, r) => a + (r.draftAccepted ?? 0), 0); return { withDraft: rows.filter(r => (r.draftTotal ?? 0) > 0).length, acceptance: t ? acc / t : null }; };

const [cmd, v, a3, a4, a5] = process.argv.slice(2) as [string, string, string?, string?, string?];
if (import.meta.main) {
if (cmd === "probe") {
  const x = V(v);
  let inv: Record<string, unknown>[];
  try { inv = process.env.MOCK_INVENTORY ? JSON.parse(readFileSync(process.env.MOCK_INVENTORY, "utf8")) : (await (await import("../../src/lmStudio.js")).lmsInventoryJson()).flattened; }
  catch (e) { console.error(`inventory: ${e}`); process.exit(1); }
  const wantId = x.indexedModelIdentifier ?? pinOf(v)?.indexedModelIdentifier;
  const hits = inv.filter(m => m.deviceIdentifier === plan.device && m.format === x.format && m.indexedModelIdentifier === wantId);
  const uniq = [...new Map(hits.map(m => [`${m.modelKey}|${m.indexedModelIdentifier}|${m.sizeBytes}`, m])).values()];
  if (!uniq.length) { console.log(JSON.stringify({ variant: v, present: false, want: x.indexedModelIdentifier })); process.exit(3); }
  if (uniq.length > 1) { console.error(`ambiguous: ${uniq.length} entries`); process.exit(1); }
  const m = uniq[0]!, pin = { modelKey: m.modelKey, indexedModelIdentifier: m.indexedModelIdentifier, sizeBytes: m.sizeBytes, quantization: (m.quantization as { name?: string } | undefined)?.name };
  if (opt("out")) writeFileSync(resolve(opt("out")!), JSON.stringify(pin, null, 1) + "\n");
  console.log(JSON.stringify({ variant: v, present: true, ...pin }));
} else if (cmd === "autopin") {
  // Pre-registered auto-pin rule (plan.variants[v].autoPin), used only when plan.json has no pin for the variant: exactly
  // one Studio inventory entry of the variant's format whose modelKey or indexed identifier contains autoPin.match.
  // Prints {pin, inventory}; with --write also records it and the HF file list (sizes, LFS sha256) at pin time.
  // Exit 0 = one entry; 3 = none; 1 = ambiguous (the chain skips). The chain compares two runs STABLE s apart.
  const x = V(v), rule = x.autoPin;
  if (!rule) { console.error("no autoPin rule"); process.exit(1); }
  const inv: Record<string, unknown>[] = process.env.MOCK_INVENTORY ? JSON.parse(readFileSync(process.env.MOCK_INVENTORY, "utf8")) : (await (await import("../../src/lmStudio.js")).lmsInventoryJson()).flattened;
  const hits = inv.filter(m => m.deviceIdentifier === plan.device && m.format === x.format && (String(m.modelKey) + "|" + String(m.indexedModelIdentifier)).toLowerCase().includes(rule.match));
  const uniq = [...new Map(hits.map(m => [`${m.modelKey}|${m.indexedModelIdentifier}|${m.sizeBytes}`, m])).values()];
  if (!uniq.length) { console.log(JSON.stringify({ variant: v, present: false })); process.exit(3); }
  if (uniq.length > 1) { console.log(JSON.stringify({ variant: v, ambiguous: uniq.map(m => m.indexedModelIdentifier) })); process.exit(1); }
  const m = uniq[0]!, pin = { modelKey: m.modelKey, indexedModelIdentifier: m.indexedModelIdentifier, sizeBytes: m.sizeBytes, quantization: (m.quantization as { name?: string } | undefined)?.name };
  if (!pin.quantization) { console.log(JSON.stringify({ variant: v, error: "no quantization name" })); process.exit(1); }
  const inventory = Object.fromEntries(["path", "publisher", "displayName", "architecture", "quantization", "maxContextLength", "vision"].map(k => [k, m[k]]));
  const rec = { variant: v, pin, inventory, rule, at: now() };
  if (process.argv.includes("--write")) {
    const id = String(pin.indexedModelIdentifier).slice(plan.device.length + 1), repo = id.split("/").slice(0, 2).join("/");
    let hf: any = null;
    try {
      const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true&expand=true`, { signal: AbortSignal.timeout(30000) });
      if (r.ok) { const t = await r.json() as any[]; const files = Object.fromEntries(t.filter(e => e.type === "file").map(e => [e.path, { size: e.size, sha256: e.lfs?.oid ?? e.oid }]));
        const info = await (await fetch(`https://huggingface.co/api/models/${repo}`, { signal: AbortSignal.timeout(30000) })).json() as any;
        hf = { repo, revision: info.sha, recordedAt: now(), files, note: "recorded by the chain at auto-pin time" }; }
    } catch {}
    writeFileSync(autoFile(v, "pin"), JSON.stringify(rec, null, 1) + "\n");
    if (hf) writeFileSync(autoFile(v, "hf"), JSON.stringify(hf, null, 1) + "\n");
  }
  console.log(JSON.stringify(rec));
} else if (cmd === "pinfield") {
  const pin = pinOf(v); if (!pin) process.exit(3); console.log(pin[a3!]);
} else if (cmd === "pincheck") {
  const want = pinOf(v), got = JSON.parse(readFileSync(resolve(a3!), "utf8"));
  const diff = ["modelKey", "indexedModelIdentifier", "sizeBytes", "quantization"].filter(k => got[k] !== want[k]);
  if (!diff.length) { console.log(`same as the plan pin (${want.sizeBytes} bytes)`); process.exit(0); }
  const desc = diff.map(k => `${k} ${got[k]} != plan ${want[k]}`).join("; ");
  if (diff.join() === "sizeBytes" && got.sizeBytes < want.sizeBytes) { console.log(`smaller than the plan pin: ${desc}`); process.exit(5); }
  console.log(desc); process.exit(4);
} else if (cmd === "hfcheck") {
  const hf = hfOf(v), files = Object.keys(hf.files);
  let got: any[];
  try {
    const res = await fetch(`https://huggingface.co/api/models/${hf.repo}/paths-info/main`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: [...files.map(f => `paths=${encodeURIComponent(f)}`), "expand=true"].join("&"), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    got = await res.json() as any[];
  } catch (e) { console.log(`HF unreachable: ${String(e).slice(0, 200)}`); process.exit(5); }
  const bad: string[] = [];
  for (const f of files) {
    const e = got.find(x => x.path === f), w = hf.files[f];
    if (!e) { bad.push(`${f} missing`); continue; }
    if ((e.lfs?.oid ?? e.oid) !== w.sha256 || e.size !== w.size) bad.push(`${f} sha256 ${e.lfs?.oid ?? e.oid} size ${e.size} != recorded ${w.sha256} ${w.size}`);
  }
  if (bad.length) { console.log(bad.join("; ")); process.exit(4); }
  console.log(`HF sha256 + size unchanged on ${files.length} files of ${hf.repo} (recorded ${hf.recordedAt})`);
} else if (cmd === "suites") {
  const s = buildSuites(v); let bad = 0; const res: Record<string, unknown> = {};
  for (const kind of ["pilot", "baseline", "extension"] as Kind[]) {
    const out = resolve(ROOT, s[kind]!.path);
    if (process.argv.includes("--check")) { if (!existsSync(out) || readFileSync(out, "utf8") !== s[kind]!.text) { console.error(`${s[kind]!.path} differs from a fresh build`); bad++; } }
    else if (process.argv.includes("--write")) {
      if (existsSync(out) && readFileSync(out, "utf8") !== s[kind]!.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
      writeFileSync(out, s[kind]!.text);
    }
    res[kind] = { path: s[kind]!.path, sha256: s[kind]!.sha256, tests: s[kind]!.tests, condition: conditionOf(v, kind) };
  }
  console.log(JSON.stringify({ variant: v, engineId: engineOf(v).id, model: engineOf(v).model, ...res }));
  process.exit(bad ? 1 : 0);
} else if (cmd === "rerun") {
  const kind = a3 as Kind, n = Number(a4);
  if (![1, 2].includes(n) || !["pilot", ...FULL].includes(kind)) { console.error("rerun <v> <kind> <1|2>"); process.exit(1); }
  const r = rerunSuite(v, kind, n), out = resolve(ROOT, r.path);
  if (process.argv.includes("--write")) {
    if (existsSync(out) && readFileSync(out, "utf8") !== r.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
    writeFileSync(out, r.text);
  }
  console.log(JSON.stringify({ variant: v, kind, rerun: n, path: r.path, sha256: r.sha256, condition: r.condition, base: r.base, baseSha256: r.baseSha256 }));
} else if (cmd === "dryrun") {
  const kind = a3 as Kind, suite = a4!, cond = a5!, tests = JSON.parse(read(suite)).tests;
  let n = 0;
  for (const t of tests) {
    const r = Bun.spawnSync(["bun", "evals/scripts/run-suite.ts", `--suite=${suite}`, `--test=${t.id}`, `--condition=${cond}`]);
    if (r.exitCode) { console.error(`dry run failed ${cond}/${t.id}: ${r.stderr.toString().slice(-400)}`); process.exit(1); }
    const d = JSON.parse(r.stdout.toString()), want = plan.cases[kindOfTest(t.id)][t.id];
    if (d.cases !== want || d.plannedCalls !== want) { console.error(`dry run ${cond}/${t.id}: ${d.cases} cases / ${d.plannedCalls} calls, plan ${want}`); process.exit(1); }
    n += kind === "pilot" ? plan.pilot.tests.find((p: any) => p.test === t.id).cases : d.cases;
  }
  const m = Bun.spawnSync(["bun", "evals/scripts/run-lmstudio-matrix.ts", `--suite=${suite}`, `--conditions=${cond}`, `--output-dir=${plan.runDir}`, `--require-device=${plan.device}`]);
  if (m.exitCode || JSON.parse(m.stdout.toString()).cells.length !== tests.length) { console.error(`matrix dry run failed ${cond}: ${m.stderr.toString().slice(-400)}`); process.exit(1); }
  console.log(`dry run ok: ${kind} ${cond} ${tests.length} cells, ${n} cases`);
} else if (cmd === "gate") {
  const test: string = plan.drift.test, n: number = plan.drift.cases;
  const run = rowsOf(v, "baseline", test), pil = rowsOf(v, "pilot", test);
  if (!run || !pil) { log(`DRIFT_FAIL|${now()}|${v} ${test}: missing checkpoint`); process.exit(1); }
  const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n), withUsage = done.filter(r => r.promptTokens !== null);
  const paired = done.filter(r => pil.byId.has(r.caseId));
  const ptEq = paired.filter(r => r.promptTokens !== null && r.promptTokens === pil.byId.get(r.caseId)!.promptTokens).length;
  const ident = withUsage.filter(r => identityOk(v, r)).length, ab = abst(done), pab = paired.filter(r => pil.byId.get(r.caseId)!.status !== "scored").length;
  const agree = paired.filter(r => { const p = pil.byId.get(r.caseId)!; return p.status === r.status && p.flagged === r.flagged; }).length;
  const same = paired.filter(r => { const p = pil.byId.get(r.caseId)!; return r.finalAnswer !== null && p.finalAnswer === r.finalAnswer; }).length;
  const exp = plan.rendering?.[v]?.expectedOffset as number | undefined, expOk = exp === undefined ? null : done.filter(r => r.promptTokens !== null && r.inputSha256 && plan.rendering[v].expected?.[r.inputSha256] !== undefined && r.promptTokens === plan.rendering[v].expected[r.inputSha256] + exp).length;
  const pass = done.length === n && paired.length === n && withUsage.length === n && ptEq === n && ident === n;
  const dr = draftRate(done);
  log(`${pass ? "DRIFT" : "DRIFT_FAIL"}|${now()}|${v} ${test} first ${n} (${conditionOf(v, "baseline")}) vs pilot (${conditionOf(v, "pilot")}): finished ${done.length}/${n}; paired with pilot ${paired.length}/${n}; prompt_tokens == pilot ${ptEq}/${n}; identity (model, quant, file) ${ident}/${n}; outcome agreement with pilot ${agree}/${n} (reported); identical final answers ${same}/${n} (reported); abstentions ${ab} vs pilot ${pab} (report-only); median reasoning ${median(done.map(r => r.reasoningTokens ?? 0))}; speculative draft on ${dr.withDraft}/${n} responses${dr.acceptance === null ? "" : `, acceptance ${(dr.acceptance * 100).toFixed(0)}%`}`);
  process.exit(pass ? 0 : 1);
} else if (cmd === "cell") {
  const kind = a3 as Kind, test = a4!, run = rowsOf(v, kind, test);
  const want = plan.cases[kind][test];
  if (!run) { console.log(`${v}/${kind}/${test}|missing checkpoint`); process.exit(1); }
  const finished = run.rows.length === want && run.rows.every(r => FINISHED.includes(r.status));
  const withUsage = run.rows.filter(r => r.promptTokens !== null), resp = run.rows.filter(r => r.responseModel !== null), ident = resp.filter(r => identityOk(v, r)).length;
  const ab = abst(run.rows), rate = ab / Math.max(1, run.rows.length), runaway = rate > plan.gates.abstentionRunaway;
  const len = run.rows.filter(r => r.status === "length_abstention").length, outp = run.rows.filter(r => r.status === "output_abstention").length;
  const usageOk = withUsage.length >= plan.gates.cellUsageCoverage * run.rows.length;
  const dr = draftRate(run.rows), cond = fileOf(v, kind, test).split("/").pop()!.replace(/\.jsonl$/, "");
  console.log(`${v}/${kind}/${test} (${cond})|cases ${run.rows.length}/${want}${finished ? "" : " (incomplete)"}; scored ${run.rows.length - ab}; abstentions ${ab} (${(rate * 100).toFixed(1)}%: length ${len}, output ${outp}; report-only${runaway ? "; ABSTENTION_RUNAWAY over 25%, variant stopped" : ""}); BA@0.5 (abstentions excluded) ${ba(run.rows).toFixed(3)}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; sum wall ${(run.rows.reduce((a, r) => a + (r.wallMs ?? 0), 0) / 3.6e6).toFixed(2)} h; usage ${withUsage.length}/${run.rows.length}; identity ${ident}/${resp.length}; speculative draft on ${dr.withDraft}/${run.rows.length}${dr.acceptance === null ? "" : ` (acceptance ${(dr.acceptance * 100).toFixed(0)}%)`}`);
  process.exit(!(finished && usageOk && ident === resp.length) ? 1 : runaway ? 6 : 0);
} else if (cmd === "summarize") {
  const x = V(v); const parts: string[] = [], unfinished: string[] = [];
  try {
    for (const kind of FULL) {
      const tests = JSON.parse(read(suitePathOf(v, kind))).tests; const bas: number[] = []; let done = 0, ab = 0, n = 0, hours = 0;
      for (const t of tests) {
        const run = rowsOf(v, kind, t.id); if (!run) { unfinished.push(t.id); continue; }
        if (run.rows.length === plan.cases[kind][t.id] && run.rows.every(r => FINISHED.includes(r.status))) done++; else unfinished.push(t.id);
        bas.push(ba(run.rows)); ab += abst(run.rows); n += run.rows.length; hours += run.rows.reduce((a, r) => a + (r.wallMs ?? 0), 0) / 3.6e6;
      }
      parts.push(`${kind}: tests complete ${done}/${tests.length}; macro BA@0.5 ${mean(bas).toFixed(3)} (abstentions excluded per dataset); abstentions ${ab}/${n}; ${hours.toFixed(1)} h summed wall`);
    }
    appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${now()}|${x.display}|${a3}|${parts.join(" // ")}${unfinished.length ? `; UNFINISHED ${unfinished.join(",")}` : ""}\n`);
  } catch (e) { appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${now()}|${x.display}|${a3}|SUMMARY_ERROR ${String(e).replace(/[|\n]/g, " ").slice(0, 200)}\n`); }
} else if (cmd === "pilot") {
  const per: any[] = []; const all: Row[] = [];
  for (const p of plan.pilot.tests) {
    const run = rowsOf(v, "pilot", p.test); if (!run) { per.push({ test: p.test, missing: true }); continue; }
    const rows = run.rows; all.push(...rows);
    const fk = kindOfTest(p.test), ratios: Record<string, number | null> = {};
    for (const m of plan.frozen.estimateModels) {
      const fr = extract(frozenFile(fk, p.test, m)); if (!fr) { ratios[m] = null; continue; }
      const both = rows.filter(r => fr.byId.has(r.caseId) && r.wallMs !== null && fr.byId.get(r.caseId)!.wallMs !== null);
      const a = both.reduce((s, r) => s + r.wallMs!, 0), b = both.reduce((s, r) => s + fr.byId.get(r.caseId)!.wallMs!, 0);
      ratios[m] = b ? Number((a / b).toFixed(3)) : null;
    }
    per.push({ test: p.test, cases: rows.length, scored: rows.length - abst(rows), length: rows.filter(r => r.status === "length_abstention").length, output: rows.filter(r => r.status === "output_abstention").length,
      ba: Number(ba(rows).toFixed(3)), medianWallS: Number((median(rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(2)), sumWallS: Number((rows.reduce((s, r) => s + (r.wallMs ?? 0), 0) / 1000).toFixed(1)),
      medianReasoning: median(rows.map(r => r.reasoningTokens ?? 0)), maxReasoning: Math.max(...rows.map(r => r.reasoningTokens ?? 0)), medianPrompt: median(rows.map(r => r.promptTokens ?? 0)),
      identity: rows.filter(r => r.responseModel !== null && identityOk(v, r)).length, draft: draftRate(rows), wallRatioVsFrozen: ratios });
  }
  // Full-run estimate: each frozen model's summed per-case wall over all 35 datasets x (pilot / frozen summed wall on the
  // same pilot cases, pooled). Central = the median over the estimate models.
  const est: Record<string, number | null> = {};
  for (const m of plan.frozen.estimateModels) {
    let a = 0, b = 0, full = 0;
    for (const p of plan.pilot.tests) {
      const run = rowsOf(v, "pilot", p.test), fr = extract(frozenFile(kindOfTest(p.test), p.test, m)); if (!run || !fr) continue;
      for (const r of run.rows) { const f = fr.byId.get(r.caseId); if (f && r.wallMs !== null && f.wallMs !== null) { a += r.wallMs; b += f.wallMs; } }
    }
    for (const kind of FULL) for (const t of Object.keys(plan.cases[kind])) { const fr = extract(frozenFile(kind as any, t, m)); if (fr) full += fr.rows.reduce((s, r) => s + (r.wallMs ?? 0), 0); }
    est[m] = b ? Number((full * (a / b) / 3.6e6).toFixed(1)) : null;
  }
  const ests = Object.values(est).filter((x): x is number => x !== null).sort((x, y) => x - y);
  const planned = plan.pilot.tests.reduce((s: number, p: any) => s + p.cases, 0);
  console.log(JSON.stringify({ variant: v, generatedAt: now(), planned, cases: all.length, scored: all.length - abst(all), parseRate: Number(((all.length - abst(all)) / Math.max(1, all.length)).toFixed(4)),
    abstentionRate: Number((abst(all) / Math.max(1, all.length)).toFixed(4)), identity: all.filter(r => r.responseModel !== null && identityOk(v, r)).length, withUsage: all.filter(r => r.promptTokens !== null).length,
    medianWallS: Number((median(all.map(r => r.wallMs ?? 0)) / 1000).toFixed(2)), meanWallS: Number((all.reduce((s, r) => s + (r.wallMs ?? 0), 0) / Math.max(1, all.length) / 1000).toFixed(2)),
    medianReasoning: median(all.map(r => r.reasoningTokens ?? 0)), draft: draftRate(all),
    estimateHours: { central: ests.length ? ests[Math.floor(ests.length / 2)] : null, perFrozenModel: est, basis: "frozen model's summed httpWallMs over the 35 datasets x pooled pilot/frozen wall ratio on the same pilot cases" }, perTest: per }, null, 1));
} else if (cmd === "pilotgate") {
  // Pre-registered pilot gate (binding before a variant's full run): all planned cases finished, identity and usage on
  // every response, abstentions <= gates.pilotAbstentionMax. Appends PILOT|PILOT_FAIL to progress.log.
  const f = resolve(RESULTS, `pilot-${v}.json`);
  if (!existsSync(f)) { log(`PILOT_FAIL|${now()}|${v}: no pilot summary`); process.exit(1); }
  const p = JSON.parse(readFileSync(f, "utf8"));
  const pass = p.cases === p.planned && p.identity === p.cases && p.withUsage === p.cases && p.abstentionRate <= plan.gates.pilotAbstentionMax && p.estimateHours.central !== null;
  log(`${pass ? "PILOT" : "PILOT_FAIL"}|${now()}|${v} (${conditionOf(v, "pilot")}): cases ${p.cases}/${p.planned}; parse rate ${(p.parseRate * 100).toFixed(1)}%; abstentions ${(p.abstentionRate * 100).toFixed(1)}% (gate <= ${(plan.gates.pilotAbstentionMax * 100).toFixed(0)}%); identity ${p.identity}/${p.cases}; usage ${p.withUsage}/${p.cases}; median wall ${p.medianWallS}s; median reasoning ${p.medianReasoning}; speculative draft on ${p.draft.withDraft}/${p.cases}; estimate ${p.estimateHours.central} h (${JSON.stringify(p.estimateHours.perFrozenModel).replace(/[|"]/g, "")})`);
  process.exit(pass ? 0 : 1);
} else if (cmd === "probegate") {
  // Pre-registered reasoning/rendering probe gate (plan.reasoning.gate). Reads the variant's probe ndjson (a3 or default).
  // Binding: the probe loaded the pinned file on the Studio; on both synthetic inputs the native-v0 requests with
  // reasoning_effort "high" and with no effort returned 200 with a JSON {concernScore} answer and identical prompt_tokens,
  // reasoning hash and content hash (the template renders both as "Thinking effort level: 0.9"). Reported, not binding:
  // whether LM Studio forwards the effort (none = 2 prompt tokens fewer; low/medium/xhigh reasoning differs), what an
  // unknown value does, /v1 behaviour, and speculative decoding (load config keys, draft-token counts).
  const f = a3 ? resolve(a3) : resolve(HERE, "probe", `probe-results-${V(v).label}.ndjson`);
  if (!existsSync(f)) { log(`PROBE_FAIL|${now()}|${v}: no probe results`); process.exit(1); }
  const ev = readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(e => e.label === V(v).label);
  const lastLoad = ev.map(e => e.event).lastIndexOf("loaded"), run = lastLoad >= 0 ? ev.slice(lastLoad) : [];
  const loaded = run[0]?.ps?.[0], req = run.filter(e => e.event === "request");
  const q = (path: string, input: string, effort: string | null) => req.find(e => e.path === path && e.input === input && e.effort === effort);
  const okJson = (e: any) => { try { const j = JSON.parse(e?.content ?? ""); return typeof j?.concernScore === "number"; } catch { return false; } };
  const v0 = "/api/v0/chat/completions", inputs = ["benign", "injection"];
  const lines: string[] = []; let pass = !!loaded && loaded.indexedModelIdentifier === pinOf(v)?.indexedModelIdentifier && loaded.deviceIdentifier === plan.device;
  for (const i of inputs) {
    const d = q(v0, i, null), h = q(v0, i, "high");
    const same = d && h && d.status === 200 && h.status === 200 && okJson(h) && d.usage?.prompt_tokens === h.usage?.prompt_tokens && d.reasoningSha === h.reasoningSha && d.contentSha === h.contentSha;
    pass = pass && !!same;
    const pt = (e: string | null) => q(v0, i, e)?.usage?.prompt_tokens ?? "?";
    const rs = (e: string | null) => q(v0, i, e)?.reasoningSha === d?.reasoningSha ? "=" : "≠";
    lines.push(`${i}: high vs default ${same ? "identical" : "DIFFER"} (prompt ${pt("high")}/${pt(null)}, reasoning tokens ${h?.usage?.completion_tokens_details?.reasoning_tokens ?? "?"}); prompt none/low/medium/xhigh ${pt("none")}/${pt("low")}/${pt("medium")}/${pt("xhigh")}; reasoning vs default low ${rs("low")} medium ${rs("medium")} xhigh ${rs("xhigh")} none ${rs("none")}; bogus status ${q(v0, i, "bogus")?.status ?? "?"}; draft tokens ${h?.usage?.total_draft_tokens_count ?? "none"}/${h?.usage?.accepted_draft_tokens_count ?? "none"}`);
  }
  const lc = run.find(e => e.event === "loadConfig");
  log(`${pass ? "PROBE" : "PROBE_FAIL"}|${now()}|${v} ${loaded?.indexedModelIdentifier ?? "not loaded"}: ${lines.join("; ")}; load-config speculative keys ${JSON.stringify(lc?.speculative ?? null).replace(/[|]/g, "/")}; LM Studio ${JSON.stringify(run[0]?.lmStudioVersion ?? null).replace(/[|]/g, "/")}`);
  process.exit(pass ? 0 : 1);
} else if (cmd === "estimate") {
  const f = resolve(RESULTS, `pilot-${v}.json`);
  console.log(V(v).estimateHours?.central ?? (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).estimateHours.central : 30));
} else { console.error("usage: see the header"); process.exit(1); }
}
