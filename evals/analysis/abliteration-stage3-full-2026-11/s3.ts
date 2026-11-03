/**
 * Abliteration stage 3: the stage 2 candidates on the full Studio suites (#23, O53; Claude Code 2026-11-03). Offline
 * except `hfcheck` (Hugging Face API, read-only) and `dryrun` (the runner's own offline dry runs); never calls LM Studio
 * or a model. Run from the worktree root (evals/runs, evals/private and the git-ignored datasets are symlinks into the
 * main checkout). IDs and numbers only; no case text is printed or written.
 *
 *   bun s3.ts suites <build> [--write|--check]          the build's two suites (baseline 21 tests, extension 14 tests)
 *   bun s3.ts suites <build> --kind=<k> --rerun=<n> [--write]   transport rerun suite n (1|2) of one kind: the v1 suite
 *                                                       with only the suite ID (-v<1+n>) and the condition ID changed
 *   bun s3.ts vanilla-audit                             every vanilla cohort used: audited whole, complete, its engine
 *                                                       equal to the suite's (writes results/vanilla-audit.json)
 *   bun s3.ts dryrun <build> <kind> <suite> <cond>      run-suite dry run per test (cases == planned calls == vanilla
 *                                                       rows) and the matrix dry run (cell count)
 *   bun s3.ts probe <build> [--out=<pin.json>]          read-only Studio inventory probe (stage 2 pin.ts): 0 present, 3 absent
 *   bun s3.ts pincheck <build> <pin.json>               0 = equals the stage 2 pin; 5 = same identifiers, smaller (still
 *                                                       downloading); 4 = differs
 *   bun s3.ts hfcheck <build>                           0 = HF LFS sha256 + size unchanged, last commit before the stage
 *                                                       2 pin; 4 = mismatch; 5 = unreachable
 *   bun s3.ts gate <build>                              drift gate (appends DRIFT|DRIFT_FAIL to progress.log)
 *   bun s3.ts cell <build> <kind> <test>                one CELL line; exit 1 = incomplete / prompt tokens / identity;
 *                                                       exit 6 = ABSTENTION_RUNAWAY
 *   bun s3.ts summarize <build> <k>/<n>                 appends one MODEL_DONE line (descriptive, uncorrected)
 *
 * Suites: tests, inputStrategies and decisionRules are copied JSON-identical from the vanilla Studio suites; the one
 * engine is the build's stage 2 engine verbatim (same id, loaded identifier, pin and load-time template override), which
 * itself differs from its vanilla engine only in model identity (and the template override note). One condition,
 * stage3-<label>-t4096-full, otherwise equal to the vanilla condition.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { extract, ba, median, FINISHED, type Row, type Extract } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";

const HERE = import.meta.dir;
export const plan = JSON.parse(readFileSync(resolve(HERE, "plan.json"), "utf8"));
const ROOT = process.cwd();
// Overrides exist only for the offline mock test (run dir) and for reading stage 2's untracked suites.
export const RUN_DIR = resolve(ROOT, process.env.STAGE3_RUN_DIR ?? plan.runDir);
const STAGE2_ROOT = process.env.STAGE2_ROOT ?? "/Users/eli/Documents/Code/solenoid-security/.claude/worktrees/abl-stage2";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as any)[k])])) : v;
const canon = (v: unknown) => JSON.stringify(sorted(v));
const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = () => new Date().toISOString();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const log = (line: string) => { appendFileSync(resolve(RUN_DIR, "progress.log"), line + "\n"); console.log(line); };
const B = (build: string) => { const b = plan.builds[build]; if (!b) { console.error(`unknown build ${build}`); process.exit(1); } return b; };
export type Kind = "baseline" | "extension";
export const KINDS: Kind[] = plan.suiteOrder;

export const suiteIdOf = (build: string, kind: Kind, n = 0) => `prompt-injection-lmstudio-studio-abliteration-stage3-full-q8-t4096-${build}-${kind}-v${1 + n}`;
export const suitePathOf = (build: string, kind: Kind, n = 0) => `evals/suites/${suiteIdOf(build, kind, n)}.json`;
export const conditionOf = (build: string, n = 0) => `stage3-${B(build).label}${n ? `-r${n}` : ""}-t4096-full`;

// ---- suites ----
function stage2Engine(build: string) {
  const b = B(build), text = readFileSync(resolve(STAGE2_ROOT, b.stage2Suite.path), "utf8");
  if (sha(text) !== b.stage2Suite.sha256) throw new Error(`${build}: stage 2 suite hash differs from its PIN`);
  const s = JSON.parse(text), keys = Object.keys(s.engines);
  if (keys.length !== 1) throw new Error("stage 2 suite must have one engine");
  return { key: keys[0]!, engine: s.engines[keys[0]!], condition: s.conditions[0] };
}
const stripIdentity = (x: any) => { const { id, model, parameters, lmStudio, ...rest } = x; const { effort_mechanism, template_mechanism, speculative_decoding, ...p } = parameters;
  const { modelKey, indexedModelIdentifier, sizeBytes, promptTemplate, ...l } = lmStudio; return { ...rest, parameters: p, lmStudio: l }; };
/** The vanilla checkpoint (file, suite) for one test of a build's vanilla, honoring the plan's per-test overrides. */
export function vanillaSource(build: string, kind: Kind, test: string) {
  const v = plan.vanilla[B(build).vanilla], o = v.overrides[test];
  return { file: `${v.suites[kind].runDir}/${test}/${o?.condition ?? v.condition}.jsonl`, suite: o?.suite ?? v.suites[kind].path, condition: o?.condition ?? v.condition, engineKey: v.engineKey as string };
}
export function buildSuites(build: string) {
  const b = B(build), v = plan.vanilla[b.vanilla], s2 = stage2Engine(build), out: Record<string, { text: string; sha256: string; tests: number }> = {};
  const pin = b.pin, e = s2.engine;
  for (const k of ["modelKey", "indexedModelIdentifier", "sizeBytes", "quantization"]) if (e.lmStudio[k] !== pin[k]) throw new Error(`${build}: stage 2 engine ${k} differs from the stage 2 pin`);
  if (b.template) { const t = e.lmStudio.promptTemplate; if (!t || sha(read(t.path)) !== t.sha256) throw new Error(`${build}: template override missing or its file hash differs`); }
  for (const kind of KINDS) {
    const vt = read(v.suites[kind].path);
    if (sha(vt) !== v.suites[kind].sha256) throw new Error(`vanilla ${kind} suite hash differs from plan`);
    const vs = JSON.parse(vt), ve = vs.engines[v.engineKey];
    if (!ve || ve.id !== v.engineId) throw new Error(`vanilla engine ${v.engineKey} missing or id differs`);
    if (canon(stripIdentity(e)) !== canon(stripIdentity(ve))) throw new Error(`${build}: stage 2 engine differs from the vanilla ${kind} engine beyond model identity`);
    const vc = vs.conditions.find((c: any) => c.engine === v.engineKey && c.id === v.condition);
    if (!vc || canon({ ...s2.condition, id: 0, engine: 0 }) !== canon({ ...vc, id: 0, engine: 0 })) throw new Error(`${build}: vanilla/stage 2 condition differs beyond id/engine`);
    for (const t of vs.tests) {  // every vanilla checkpoint must carry exactly the vanilla engine
      const src = vanillaSource(build, kind, t.id), f = resolve(ROOT, src.file);
      if (!existsSync(f)) throw new Error(`vanilla checkpoint missing: ${src.file}`);
      const meta = JSON.parse(readFileSync(f, "utf8").split("\n", 1)[0]!).value;
      const ss = JSON.parse(read(src.suite));
      if (canon(meta.engine) !== canon(ve) || canon(ss.engines[src.engineKey]) !== canon(ve) || meta.conditionId !== src.condition || meta.testId !== t.id) throw new Error(`vanilla checkpoint ${kind}/${t.id} engine/condition mismatch`);
      if (canon(ss.tests.find((x: any) => x.id === t.id)) !== canon(t)) throw new Error(`vanilla override suite test ${t.id} differs`);
    }
    const suite = { schemaVersion: vs.schemaVersion, id: suiteIdOf(build, kind), tests: vs.tests, engines: { [s2.key]: e }, inputStrategies: vs.inputStrategies, decisionRules: vs.decisionRules,
      conditions: [{ ...vc, id: conditionOf(build), engine: s2.key }] };
    const text = JSON.stringify(suite, null, 2) + "\n", back = JSON.parse(text);
    for (const k of ["tests", "inputStrategies", "decisionRules"]) if (JSON.stringify(back[k]) !== JSON.stringify(vs[k])) throw new Error(`${k} copy mismatch`);
    if (JSON.stringify(back.engines[s2.key]) !== JSON.stringify(e)) throw new Error("engine copy mismatch");
    out[kind] = { text, sha256: sha(text), tests: vs.tests.length };
  }
  return out;
}
export function rerunSuite(build: string, kind: Kind, n: number) {
  const baseText = read(suitePathOf(build, kind)), base = JSON.parse(baseText);
  if (base.conditions.length !== 1 || base.conditions[0].id !== conditionOf(build)) throw new Error("v1 suite condition differs");
  const suite = { ...base, id: suiteIdOf(build, kind, n), conditions: [{ ...base.conditions[0], id: conditionOf(build, n) }] };
  const text = JSON.stringify(suite, null, 2) + "\n", back = JSON.parse(text);
  for (const k of Object.keys(base)) if (!["id", "conditions"].includes(k) && JSON.stringify(back[k]) !== JSON.stringify(base[k])) throw new Error(`rerun ${n}: ${k} differs`);
  const { id: _a, ...x } = back.conditions[0], { id: _b, ...y } = base.conditions[0];
  if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`rerun ${n}: condition differs beyond its id`);
  return { text, sha256: sha(text), condition: conditionOf(build, n), base: suitePathOf(build, kind), baseSha256: sha(baseText) };
}

// ---- rows ----
const suiteTests = new Map<string, any[]>();
export const testsOf = (build: string, kind: Kind): any[] => {
  const k = `${build}/${kind}`;
  if (!suiteTests.has(k)) suiteTests.set(k, JSON.parse(read(suitePathOf(build, kind))).tests);
  return suiteTests.get(k)!;
};
const engineOf = (build: string, kind: Kind) => Object.values(JSON.parse(read(suitePathOf(build, kind))).engines)[0] as any;
/** The analyzed checkpoint of a cohort: the newest transport rerun (r2, r1) that exists, else the v1 condition. */
export const buildFile = (build: string, test: string) => {
  for (const n of [2, 1]) { const f = resolve(RUN_DIR, test, `${conditionOf(build, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(RUN_DIR, test, `${conditionOf(build)}.jsonl`);
};
export const buildRows = (build: string, test: string) => extract(buildFile(build, test));
const vanCache = new Map<string, Extract | null>();
export const vanillaRows = (build: string, kind: Kind, test: string) => {
  const src = vanillaSource(build, kind, test);
  if (!vanCache.has(src.file)) vanCache.set(src.file, extract(resolve(ROOT, src.file)));
  return vanCache.get(src.file)!;
};
export const identityOk = (build: string, r: Row) => { const e = engineOf(build, "baseline"); return r.responseModel === e.model && r.quant === e.lmStudio.quantization && r.loadedIndexed === e.lmStudio.indexedModelIdentifier; };
export const correct = (r: { positive: boolean; flagged: boolean | null }) => r.flagged === r.positive;
/** Exact two-sided McNemar (binomial on the discordant pairs), as in stages 1-2. */
export function mcnemar(b: number, c: number): number {
  const n = b + c; if (!n) return 1;
  const lf = (k: number) => { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; };
  let tail = 0; for (let i = 0; i <= Math.min(b, c); i++) tail += Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}
const abst = (rows: Row[]) => rows.filter(r => r.status !== "scored").length;
const mean = (xs: number[]) => { const y = xs.filter(x => !Number.isNaN(x)); return y.reduce((a, b) => a + b, 0) / Math.max(1, y.length); };

// ---- commands ----
const [cmd, build, a3, a4, a5] = process.argv.slice(2) as [string, string, string?, string?, string?];
if (import.meta.main) {
if (cmd === "suites" && opt("rerun")) {
  const n = Number(opt("rerun")), kind = opt("kind") as Kind;
  if (![1, 2].includes(n) || !KINDS.includes(kind)) { console.error("--rerun must be 1|2 with --kind=baseline|extension"); process.exit(1); }
  const r = rerunSuite(build, kind, n), path = suitePathOf(build, kind, n), out = resolve(ROOT, path);
  if (process.argv.includes("--write")) {
    if (existsSync(out) && readFileSync(out, "utf8") !== r.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
    writeFileSync(out, r.text);
  }
  console.log(JSON.stringify({ build, kind, rerun: n, path, sha256: r.sha256, condition: r.condition, base: r.base, baseSha256: r.baseSha256 }));
} else if (cmd === "probe") {
  // Read-only inventory probe (stage 2 pin.ts): `lms ls --json` + `--variants` through the runner's lmsInventoryJson; never loads.
  // Exit 0 = exactly one entry for <device>:<repo>/<file> (written to --out); 3 = absent; 1 = ambiguous/unreadable.
  const b = B(build), want = `${b.repo}/${b.file}`;
  let inv: Record<string, unknown>[];
  try {
    inv = process.env.MOCK_INVENTORY ? JSON.parse(readFileSync(process.env.MOCK_INVENTORY, "utf8"))
      : (await (await import("../../src/lmStudio.js")).lmsInventoryJson()).flattened;
  } catch (e) { console.error(`inventory: ${e}`); process.exit(1); }
  const hits = inv.filter(m => m.deviceIdentifier === plan.device && m.format === "gguf" && typeof m.indexedModelIdentifier === "string"
    && (m.indexedModelIdentifier === `${plan.device}:${want}` || (m.indexedModelIdentifier.startsWith(`${plan.device}:`) && m.indexedModelIdentifier.endsWith(`@${want}`))));
  const uniq = [...new Map(hits.map(m => [`${m.modelKey}|${m.indexedModelIdentifier}|${m.sizeBytes}`, m])).values()];
  if (!uniq.length) { console.log(JSON.stringify({ build, present: false, want })); process.exit(3); }
  if (uniq.length > 1) { console.error(`ambiguous: ${uniq.length} entries for ${want}`); process.exit(1); }
  const m = uniq[0]!, pin = { modelKey: m.modelKey, indexedModelIdentifier: m.indexedModelIdentifier, sizeBytes: m.sizeBytes, quantization: (m.quantization as { name?: string } | undefined)?.name };
  if (opt("out")) writeFileSync(resolve(opt("out")!), JSON.stringify(pin, null, 1) + "\n");
  console.log(JSON.stringify({ build, present: true, ...pin }));
} else if (cmd === "suites") {
  const s = buildSuites(build), res: Record<string, unknown> = {};
  let bad = 0;
  for (const kind of KINDS) {
    const path = suitePathOf(build, kind), out = resolve(ROOT, path);
    if (process.argv.includes("--check")) { if (!existsSync(out) || readFileSync(out, "utf8") !== s[kind]!.text) { console.error(`${path} differs from a fresh build`); bad++; } }
    else if (process.argv.includes("--write")) {
      if (existsSync(out) && readFileSync(out, "utf8") !== s[kind]!.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
      writeFileSync(out, s[kind]!.text);
    }
    res[kind] = { path, sha256: s[kind]!.sha256, tests: s[kind]!.tests };
  }
  console.log(JSON.stringify({ build, condition: conditionOf(build), engineId: engineOf(build, "baseline")?.id, ...res }));
  process.exit(bad ? 1 : 0);
} else if (cmd === "vanilla-audit") {
  const out: Record<string, any> = {};
  let bad = 0;
  for (const [vk, v] of Object.entries<any>(plan.vanilla)) {
    const anyBuild = Object.keys(plan.builds).find(b => plan.builds[b].vanilla === vk)!;
    out[vk] = { engineId: v.engineId, condition: v.condition, suites: {} };
    for (const kind of KINDS) {
      const vs = JSON.parse(read(v.suites[kind].path)); const per: Record<string, unknown> = {};
      for (const t of vs.tests) {
        const src = vanillaSource(anyBuild, kind, t.id), x = vanillaRows(anyBuild, kind, t.id);
        const meta = x ? JSON.parse(readFileSync(resolve(ROOT, src.file), "utf8").split("\n", 1)[0]!).value : null;
        const ok = !!x && x.rows.length === meta.expectedCases && x.rows.every(r => FINISHED.includes(r.status));
        if (!ok) bad++;
        per[t.id] = { checkpoint: src.file, cases: x?.rows.length ?? 0, expected: meta?.expectedCases ?? null, finished: ok, abstentions: x ? abst(x.rows) : null,
          withUsage: x ? x.rows.filter(r => r.promptTokens !== null).length : null, ba: x ? Number(ba(x.rows).toFixed(4)) : null,
          hours: x ? Number((x.rows.reduce((a, r) => a + (r.wallMs ?? 0), 0) / 3.6e6).toFixed(2)) : null };
      }
      out[vk].suites[kind] = per;
    }
  }
  writeFileSync(resolve(HERE, "results/vanilla-audit.json"), JSON.stringify({ generatedAt: now(), vanilla: out }, null, 1) + "\n");
  for (const [vk, v] of Object.entries<any>(out)) for (const kind of KINDS) {
    const per = Object.values<any>(v.suites[kind]);
    console.log(`${vk} ${kind}: ${per.filter(p => p.finished).length}/${per.length} cohorts complete, ${per.reduce((a, p) => a + p.cases, 0)} cases, ${per.reduce((a, p) => a + (p.abstentions ?? 0), 0)} abstentions, ${per.reduce((a, p) => a + (p.hours ?? 0), 0).toFixed(1)} h`);
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === "dryrun") {
  const kind = a3 as Kind, suite = a4!, cond = a5!;
  let n = 0;
  const tests = JSON.parse(read(suite)).tests;
  for (const t of tests) {
    const r = Bun.spawnSync(["bun", "evals/scripts/run-suite.ts", `--suite=${suite}`, `--test=${t.id}`, `--condition=${cond}`]);
    if (r.exitCode) { console.error(`dry run failed ${cond}/${t.id}: ${r.stderr.toString().slice(-400)}`); process.exit(1); }
    const d = JSON.parse(r.stdout.toString()), want = vanillaRows(build, kind, t.id)?.rows.length;
    if (d.cases !== want || d.plannedCalls !== want) { console.error(`dry run ${cond}/${t.id}: ${d.cases} cases / ${d.plannedCalls} calls, vanilla ${want}`); process.exit(1); }
    n += d.cases;
  }
  const m = Bun.spawnSync(["bun", "evals/scripts/run-lmstudio-matrix.ts", `--suite=${suite}`, `--conditions=${cond}`, `--output-dir=${plan.runDir}`, `--require-device=${plan.device}`, `--tolerate-instance=${plan.toleratedInstance}`]);
  if (m.exitCode || JSON.parse(m.stdout.toString()).cells.length !== tests.length) { console.error(`matrix dry run failed ${cond}: ${m.stderr.toString().slice(-400)}`); process.exit(1); }
  console.log(`dry run ok: ${kind} ${cond} ${tests.length} cells, ${n} cases`);
} else if (cmd === "pincheck") {
  const want = B(build).pin, got = JSON.parse(readFileSync(resolve(a3!), "utf8"));
  const diff = ["modelKey", "indexedModelIdentifier", "sizeBytes", "quantization"].filter(k => got[k] !== want[k]);
  if (!diff.length) { console.log(`same as the stage 2 pin (${want.sizeBytes} bytes)`); process.exit(0); }
  const desc = diff.map(k => `${k} ${got[k]} != stage 2 ${want[k]}`).join("; ");
  if (diff.join() === "sizeBytes" && typeof got.sizeBytes === "number" && got.sizeBytes < want.sizeBytes) { console.log(`smaller than the stage 2 pin: ${desc}`); process.exit(5); }
  console.log(desc); process.exit(4);
} else if (cmd === "hfcheck") {
  const hf = B(build).hf, files = Object.keys(hf.files);
  let got: any[];
  try {
    if (process.env.MOCK_HF_JSON) got = JSON.parse(readFileSync(process.env.MOCK_HF_JSON, "utf8"))[build];
    else {
      const res = await fetch(`https://huggingface.co/api/models/${hf.repo}/paths-info/main`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: [...files.map(f => `paths=${encodeURIComponent(f)}`), "expand=true"].join("&"), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got = await res.json() as any[];
    }
  } catch (e) { console.log(`HF unreachable: ${String(e).slice(0, 200)}`); process.exit(5); }
  const before = Date.parse(B(build).stage2Suite.pinnedAt), bad: string[] = [];
  for (const f of files) {
    const e = got.find(x => x.path === f), w = hf.files[f];
    if (!e) { bad.push(`${f} missing`); continue; }
    if (e.lfs?.oid !== w.sha256 || e.size !== w.size) bad.push(`${f} sha256 ${e.lfs?.oid} size ${e.size} != recorded ${w.sha256} ${w.size}`);
    if (!(Date.parse(e.lastCommit?.date) < before)) bad.push(`${f} last commit ${e.lastCommit?.date} not before the stage 2 pin ${B(build).stage2Suite.pinnedAt}`);
  }
  if (bad.length) { console.log(bad.join("; ")); process.exit(4); }
  console.log(`HF LFS sha256 + size unchanged on ${files.length} files (${files.map(f => `${f} ${hf.files[f].sha256.slice(0, 12)}`).join(", ")}), last commits before the stage 2 pin ${B(build).stage2Suite.pinnedAt}`);
} else if (cmd === "gate") {
  const test: string = plan.drift.test, kind: Kind = plan.drift.suite, n: number = plan.drift.cases;
  let run, van;
  try { run = buildRows(build, test); van = vanillaRows(build, kind, test); } catch (e) { log(`DRIFT_FAIL|${now()}|${build} ${test}: audit error ${String(e).replace(/[|\n]/g, " ").slice(0, 200)}`); process.exit(1); }
  if (!run || !van) { log(`DRIFT_FAIL|${now()}|${build} ${test}: missing checkpoint`); process.exit(1); }
  const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n), withUsage = done.filter(r => r.promptTokens !== null);
  const deltas = withUsage.map(r => r.promptTokens! - (van.byId.get(r.caseId)?.promptTokens ?? NaN));
  const ptEq = deltas.filter(d => d === 0).length;
  const dist = Object.entries(deltas.reduce((a: Record<string, number>, d) => (a[String(d)] = (a[String(d)] ?? 0) + 1, a), {})).map(([k, v]) => `${k}:${v}`).join(",");
  const ident = withUsage.filter(r => identityOk(build, r)).length, ab = done.filter(r => r.status !== "scored").length;
  const vab = done.filter(r => van.byId.get(r.caseId)?.status !== "scored").length;
  const agree = done.filter(r => { const v = van.byId.get(r.caseId); return v && v.status === r.status && v.flagged === r.flagged; }).length;
  const reas = median(withUsage.map(r => r.reasoningTokens ?? 0)), vreas = median(withUsage.map(r => van.byId.get(r.caseId)?.reasoningTokens ?? 0));
  const pass = done.length === n && withUsage.length === n && ptEq === n && ident === n;
  log(`${pass ? "DRIFT" : "DRIFT_FAIL"}|${now()}|${build} ${test} first ${n} (${conditionOf(build)}): finished ${done.length}/${n}; prompt_tokens == vanilla on ${ptEq}/${n} (delta distribution ${dist || "none"}); identity (model, quant, GGUF) ${ident}/${n}; abstentions ${ab} vs vanilla ${vab} (report-only); outcome agreement with vanilla ${agree}/${n} (reported); median reasoning ${reas} vs vanilla ${vreas}`);
  process.exit(pass ? 0 : 1);
} else if (cmd === "cell") {
  const kind = a3 as Kind, test = a4!, run = buildRows(build, test), van = vanillaRows(build, kind, test);
  if (!run || !van) { console.log(`${build}/${kind}/${test}|missing checkpoint`); process.exit(1); }
  const want = van.rows.length;
  const finished = run.rows.length === want && run.rows.every(r => FINISHED.includes(r.status)) && run.rows.every(r => van.byId.has(r.caseId));
  const both = run.rows.filter(r => r.promptTokens !== null && van.byId.get(r.caseId)?.promptTokens != null);
  const ptEq = both.filter(r => r.promptTokens === van.byId.get(r.caseId)!.promptTokens).length;
  const ptPass = both.length >= plan.gates.cellPromptTokenCoverage * run.rows.length && ptEq === both.length;
  const resp = run.rows.filter(r => r.responseModel !== null), ident = resp.filter(r => identityOk(build, r)).length;
  const ab = abst(run.rows), vab = abst(van.rows), rate = ab / Math.max(1, run.rows.length), vrate = vab / Math.max(1, van.rows.length);
  const excess = rate > vrate + plan.gates.abstentionExcessReport, runaway = rate > vrate + plan.gates.abstentionRunaway;
  const paired = run.rows.filter(r => r.status === "scored" && van.byId.get(r.caseId)?.status === "scored");
  const lost = paired.filter(r => correct(van.byId.get(r.caseId)!) && !correct(r)).length, gained = paired.filter(r => !correct(van.byId.get(r.caseId)!) && correct(r)).length;
  const cond = buildFile(build, test).split("/").pop()!.replace(/\.jsonl$/, "");
  console.log(`${build}/${kind}/${test} (${cond})|cases ${run.rows.length}/${want}${finished ? "" : " (incomplete)"}; abstentions ${ab} vs vanilla ${vab} (report-only${excess ? "; ABSTENTION_EXCESS over +2 pp" : ""}${runaway ? "; ABSTENTION_RUNAWAY over +25 pp, build stopped" : ""}); BA@0.5 (abstentions excluded) ${ba(run.rows).toFixed(3)} vs vanilla ${ba(van.rows).toFixed(3)}; matched ${paired.length}: lost ${lost} gained ${gained}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(van.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(van.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt_tokens == vanilla ${ptEq}/${both.length}; identity ${ident}/${resp.length}`);
  process.exit(!(finished && ptPass && ident === resp.length) ? 1 : runaway ? 6 : 0);
} else if (cmd === "summarize") {
  const b = B(build);
  let line: string;
  try {
    const parts: string[] = [], unfinished: string[] = [];
    const all = { lost: 0, gained: 0, n: 0, bBA: [] as number[], vBA: [] as number[] };
    for (const kind of KINDS) {
      const bBA: number[] = [], vBA: number[] = []; let done = 0, ab = 0, vab = 0, lost = 0, gained = 0, dl = 0, dg = 0, fa = 0, fr = 0, nP = 0;
      const tests = testsOf(build, kind);
      for (const t of tests) {
        const run = buildRows(build, t.id), van = vanillaRows(build, kind, t.id);
        if (!run || !van) { unfinished.push(t.id); continue; }
        if (run.rows.length === van.rows.length && run.rows.every(r => FINISHED.includes(r.status))) done++; else unfinished.push(t.id);
        bBA.push(ba(run.rows)); vBA.push(ba(van.rows)); ab += abst(run.rows); vab += abst(van.rows);
        for (const r of run.rows) {
          const v = van.byId.get(r.caseId); if (r.status !== "scored" || v?.status !== "scored") continue;
          nP++;
          if (correct(v) && !correct(r)) { lost++; if (r.positive) dl++; else fa++; }
          if (!correct(v) && correct(r)) { gained++; if (r.positive) dg++; else fr++; }
        }
      }
      all.lost += lost; all.gained += gained; all.n += nP; all.bBA.push(...bBA); all.vBA.push(...vBA);
      parts.push(`${kind}: tests complete ${done}/${tests.length}; macro BA build/vanilla ${mean(bBA).toFixed(3)}/${mean(vBA).toFixed(3)} (delta ${(mean(bBA) - mean(vBA)).toFixed(3)}); McNemar vanilla->build on ${nP} both-scored: lost ${lost} gained ${gained}, exact p ${mcnemar(lost, gained).toExponential(2)}; detections lost/gained ${dl}/${dg}; false alarms added/removed ${fa}/${fr}; abstentions ${ab} vs vanilla ${vab}`);
    }
    const d = mean(all.bBA) - mean(all.vBA), pilotSign = Math.sign(b.pilot.deltaBa);
    line = `${parts.join(" // ")} // both suites (secondary, 35 datasets equal weight): delta ${d.toFixed(3)}, lost ${all.lost} gained ${all.gained}; pilot delta ${b.pilot.deltaBa.toFixed(3)}${b.flag ? " (deviation rerun)" : ""}, sign ${Math.sign(d) === pilotSign ? "replicated" : "NOT replicated"} (uncorrected, descriptive)` +
      (unfinished.length ? `; UNFINISHED ${unfinished.join(",")}` : "");
  } catch (error) {
    line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
  }
  appendFileSync(resolve(RUN_DIR, "progress.log"), `MODEL_DONE|${now()}|${b.display}|${a3}|${line.replace(/\|/g, "/")}\n`);
  console.log(line);
} else { console.error("usage: see the header"); process.exit(1); }
}
