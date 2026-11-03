/**
 * Declared-deviation reruns of abliteration stage 2 (#23; plan amendment 2026-11-03, Claude Code). Offline except
 * `hfcheck` (Hugging Face API, read-only); never calls LM Studio or a model. Run from the feature worktree root.
 *
 *   bun dev.ts suite <build> [--rerun=n] [--write]   deviation suite: the stage 2 v1 suite (hash-checked) with only the
 *                                                    suite ID (-dev1-v<1+n>) and the condition ID (stage2-<label>-dev1[-r<n>]-t4096-full)
 *                                                    changed, checked field by field; never overwrites a different file (exit 2)
 *   bun dev.ts dryrun <build> <suite> <condition>    offline dry run: run-suite plans exactly the pilot count for every
 *                                                    deviation test; the matrix dry run lists the suite's nine cells
 *   bun dev.ts pincheck <build> <pin.json>           exit 0 if the re-probed pin equals the original pin on modelKey,
 *                                                    indexed identifier, sizeBytes and quant; 4 if it differs; 5 if smaller
 *                                                    sizeBytes with the same identifiers (still downloading)
 *   bun dev.ts hfcheck <build>                       exit 0 if every recorded HF file keeps its LFS sha256 and size and was
 *                                                    last committed before the original pin; 4 on a mismatch; 5 if unreachable
 *   bun dev.ts gate <build> <test>                   drift gate on the first 24 finished cases (appends DRIFT|DRIFT_FAIL)
 *   bun dev.ts cell <build> <test>                   prints one CELL line; exit 1 on incompleteness, prompt-token or identity
 *                                                    failure. Abstentions are report-only here.
 *   bun dev.ts summarize <build> <k>/<n>             appends one MODEL_DONE line (deviation cells + kept stage 2 cells)
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { extract } from "../studio-qwen38-abliterated-low-2026-10-27/rows.js";
import { ABSTENTION_HALT, ba, buildRows, correct, ctx, FINISHED, identityOk, mcnemar, median, plan, vanillaRows, type Row } from "../abliteration-stage2-pilot-2026-10/rows.js";
import { conditionOf, suitePathOf } from "../abliteration-stage2-pilot-2026-10/make-suite.js";

export const dev = JSON.parse(readFileSync(process.env.DEV_PLAN ?? resolve(import.meta.dir, "dev-plan.json"), "utf8")); // override: mock test only
const ROOT = process.cwd();
export const DEV_DIR = resolve(ROOT, process.env.DEV_RUN_DIR ?? dev.runDir); // override: offline mock test only
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const opt = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const now = () => new Date().toISOString();
const log = (line: string) => { appendFileSync(resolve(DEV_DIR, "progress.log"), line + "\n"); console.log(line); };
const B = (build: string) => { const b = dev.builds[build]; if (!b) { console.error(`unknown build ${build}`); process.exit(1); } return b; };

export const devSuiteId = (build: string, n = 0) => `prompt-injection-lmstudio-studio-abliteration-stage2-pilot-q8-t4096-${build}-dev1-v${1 + n}`;
export const devSuitePath = (build: string, n = 0) => `evals/suites/${devSuiteId(build, n)}.json`;
export const devCondition = (build: string, n = 0) => `stage2-${plan.builds[build].label}-dev1${n ? `-r${n}` : ""}-t4096-full`;
/** The analyzed deviation checkpoint of a cohort: the newest transport rerun (r2, r1) that exists, else the deviation condition. */
export const devFile = (build: string, test: string) => {
  for (const n of [2, 1]) { const f = resolve(DEV_DIR, test, `${devCondition(build, n)}.jsonl`); if (existsSync(f)) return f; }
  return resolve(DEV_DIR, test, `${devCondition(build)}.jsonl`);
};
export const devRows = (build: string, test: string) => extract(devFile(build, test));

function devSuite(build: string, n: number) {
  const b = B(build), baseText = readFileSync(resolve(ROOT, suitePathOf(build)), "utf8");
  if (suitePathOf(build) !== b.v1Suite.path || sha(baseText) !== b.v1Suite.sha256) throw new Error(`${build}: v1 suite hash differs from the stage 2 PIN`);
  const base = JSON.parse(baseText);
  if (base.conditions.length !== 1 || base.conditions[0].id !== conditionOf(build)) throw new Error("v1 suite condition differs");
  const suite = { ...base, id: devSuiteId(build, n), conditions: [{ ...base.conditions[0], id: devCondition(build, n) }] };
  const text = JSON.stringify(suite, null, 2) + "\n", back = JSON.parse(text);
  for (const k of Object.keys(base)) if (!["id", "conditions"].includes(k) && JSON.stringify(back[k]) !== JSON.stringify(base[k])) throw new Error(`${k} differs`);
  if (Object.keys(back).join() !== Object.keys(base).join()) throw new Error("top-level keys differ");
  const { id: _a, ...x } = back.conditions[0], { id: _b, ...y } = base.conditions[0];
  if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error("condition differs beyond its id");
  return { text, sha256: sha(text), condition: devCondition(build, n), base: suitePathOf(build), baseSha256: b.v1Suite.sha256 };
}

function counts(rows: Row[]) { return { ab: rows.filter(r => r.status !== "scored").length, n: rows.length }; }

const [cmd, build, a3] = process.argv.slice(2) as [string, string, string | undefined];
if (cmd === "suite") {
  const n = Number(opt("rerun") ?? 0);
  if (![0, 1, 2].includes(n)) { console.error("--rerun must be 1 or 2"); process.exit(1); }
  const s = devSuite(build, n), path = devSuitePath(build, n), out = resolve(ROOT, path);
  if (process.argv.includes("--write")) {
    if (existsSync(out) && readFileSync(out, "utf8") !== s.text) { console.error(`refusing to overwrite a different ${out}`); process.exit(2); }
    writeFileSync(out, s.text);
  }
  console.log(JSON.stringify({ build, rerun: n, path, sha256: s.sha256, condition: s.condition, base: s.base, baseSha256: s.baseSha256 }));
} else if (cmd === "dryrun") {
  const suite = a3!, cond = process.argv[5]!;
  for (const t of B(build).tests as string[]) {
    const r = Bun.spawnSync(["bun", "evals/scripts/run-suite.ts", `--suite=${suite}`, `--test=${t}`, `--condition=${cond}`]);
    if (r.exitCode) { console.error(`dry run failed ${cond}/${t}: ${r.stderr.toString().slice(-400)}`); process.exit(1); }
    const d = JSON.parse(r.stdout.toString()), want = plan.pilotSuite.cases[t];
    if (d.cases !== want || d.plannedCalls !== want) { console.error(`dry run ${cond}/${t}: ${d.cases} cases / ${d.plannedCalls} calls, plan ${want}`); process.exit(1); }
  }
  const m = Bun.spawnSync(["bun", "evals/scripts/run-lmstudio-matrix.ts", `--suite=${suite}`, `--conditions=${cond}`, `--output-dir=${dev.runDir}`, `--require-device=${plan.device}`, `--tolerate-instance=${plan.toleratedInstance}`]);
  if (m.exitCode || JSON.parse(m.stdout.toString()).cells.length !== 9) { console.error(`matrix dry run failed ${cond}: ${m.stderr.toString().slice(-400)}`); process.exit(1); }
  console.log(`dry run ok: ${cond} ${B(build).tests.length} deviation tests (${B(build).tests.map((t: string) => `${t} ${plan.pilotSuite.cases[t]}`).join(", ")}), 9 cells in the suite`);
} else if (cmd === "pincheck") {
  const want = B(build).originalPin, got = JSON.parse(readFileSync(resolve(a3!), "utf8"));
  const diff = ["modelKey", "indexedModelIdentifier", "sizeBytes", "quantization"].filter(k => got[k] !== want[k]);
  const desc = diff.map(k => `${k} ${got[k]} != original ${want[k]}`).join("; ");
  if (!diff.length) { console.log(`same as the original pin (${want.sizeBytes} bytes)`); process.exit(0); }
  if (diff.join() === "sizeBytes" && typeof got.sizeBytes === "number" && got.sizeBytes < want.sizeBytes) { console.log(`smaller than the original: ${desc}`); process.exit(5); }
  console.log(desc); process.exit(4);
} else if (cmd === "hfcheck") {
  const hf = B(build).hf, files = Object.keys(hf.files);
  let got: any[];
  try {
    if (process.env.MOCK_HF_JSON) got = JSON.parse(readFileSync(process.env.MOCK_HF_JSON, "utf8"));
    else {
      const res = await fetch(`https://huggingface.co/api/models/${hf.repo}/paths-info/main`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: [...files.map(f => `paths=${encodeURIComponent(f)}`), "expand=true"].join("&"), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got = await res.json() as any[];
    }
  } catch (e) { console.log(`HF unreachable: ${String(e).slice(0, 200)}`); process.exit(5); }
  const before = Date.parse(B(build).originalPinAt), bad: string[] = [];
  for (const f of files) {
    const e = got.find(x => x.path === f), w = hf.files[f];
    if (!e) { bad.push(`${f} missing`); continue; }
    if (e.lfs?.oid !== w.sha256 || e.size !== w.size) bad.push(`${f} sha256 ${e.lfs?.oid} size ${e.size} != recorded ${w.sha256} ${w.size}`);
    if (!(Date.parse(e.lastCommit?.date) < before)) bad.push(`${f} last commit ${e.lastCommit?.date} not before the original pin ${B(build).originalPinAt}`);
  }
  if (bad.length) { console.log(bad.join("; ")); process.exit(4); }
  console.log(`HF LFS sha256 + size unchanged on ${files.length} files (${files.map(f => `${f} ${hf.files[f].sha256.slice(0, 12)}`).join(", ")}), last commits before ${B(build).originalPinAt}`);
} else if (cmd === "gate") {
  const test = a3!, n: number = dev.drift.cases;
  let run, van;
  try { run = devRows(build, test); van = vanillaRows(build, test); } catch (e) { log(`DRIFT_FAIL|${now()}|${build} ${test}: audit error ${String(e).replace(/[|\n]/g, " ").slice(0, 200)}`); process.exit(1); }
  if (!run || !van) { log(`DRIFT_FAIL|${now()}|${build} ${test}: missing checkpoint`); process.exit(1); }
  const done = run.rows.filter(r => FINISHED.includes(r.status)).slice(0, n), withUsage = done.filter(r => r.promptTokens !== null);
  const deltas = withUsage.map(r => r.promptTokens! - (van.byId.get(r.caseId)?.promptTokens ?? NaN));
  const ptEq = deltas.filter(d => d === 0).length;
  const dist = Object.entries(deltas.reduce((a: Record<string, number>, d) => (a[String(d)] = (a[String(d)] ?? 0) + 1, a), {})).map(([k, v]) => `${k}:${v}`).join(",");
  const ident = withUsage.filter(r => identityOk(build, r)).length, abst = done.filter(r => r.status !== "scored").length;
  const vabst = done.filter(r => van.byId.get(r.caseId)?.status !== "scored").length;
  const agree = done.filter(r => { const v = van.byId.get(r.caseId); return v && v.status === r.status && v.flagged === r.flagged; }).length;
  const reas = median(withUsage.map(r => r.reasoningTokens ?? 0)), vreas = median(withUsage.map(r => van.byId.get(r.caseId)?.reasoningTokens ?? 0));
  const pass = done.length === n && withUsage.length === n && ptEq === n && ident === n;
  log(`${pass ? "DRIFT" : "DRIFT_FAIL"}|${now()}|${build} ${test} first ${n} (deviation ${devFile(build, test).split("/").pop()!.replace(/\.jsonl$/, "")}): finished ${done.length}/${n}; prompt_tokens == vanilla on ${ptEq}/${n} (delta distribution ${dist || "none"}); identity (model, quant, GGUF) ${ident}/${n}; abstentions ${abst} vs vanilla ${vabst} (report-only); outcome agreement with vanilla ${agree}/${n} (reported); median reasoning ${reas} vs vanilla ${vreas}`);
  process.exit(pass ? 0 : 1);
} else if (cmd === "cell") {
  const test = a3!, run = devRows(build, test), van = vanillaRows(build, test);
  if (!run || !van) { console.log(`${build}/${test}|missing checkpoint`); process.exit(1); }
  const want = ctx(build).caseIds.get(test)!.size;
  const finished = run.rows.length === want && run.rows.every(r => FINISHED.includes(r.status));
  const both = run.rows.filter(r => r.promptTokens !== null && van.byId.get(r.caseId)?.promptTokens != null);
  const ptEq = both.filter(r => r.promptTokens === van.byId.get(r.caseId)!.promptTokens).length;
  const ptPass = both.length >= plan.gates.cellPromptTokenCoverage * run.rows.length && ptEq === both.length;
  const resp = run.rows.filter(r => r.responseModel !== null), ident = resp.filter(r => identityOk(build, r)).length;
  const { ab } = counts(run.rows), vab = counts(van.rows).ab;
  const excess = ab / Math.max(1, run.rows.length) > vab / Math.max(1, van.rows.length) + ABSTENTION_HALT;
  const paired = run.rows.filter(r => r.status === "scored" && van.byId.get(r.caseId)?.status === "scored");
  const lost = paired.filter(r => correct(van.byId.get(r.caseId)!) && !correct(r)).length, gained = paired.filter(r => !correct(van.byId.get(r.caseId)!) && correct(r)).length;
  console.log(`${build}/${test} (deviation ${devFile(build, test).split("/").pop()!.replace(/\.jsonl$/, "")})|cases ${run.rows.length}/${want}${finished ? "" : " (incomplete)"}; abstentions ${ab} vs vanilla ${vab} (report-only${excess ? "; ABSTENTION_EXCESS over the pre-registered +2 pp" : ""}); BA@0.5 (abstentions excluded) ${ba(run.rows).toFixed(3)} vs vanilla ${ba(van.rows).toFixed(3)}; matched ${paired.length}: lost ${lost} gained ${gained}; median reasoning ${median(run.rows.map(r => r.reasoningTokens ?? 0))} vs ${median(van.rows.map(r => r.reasoningTokens ?? 0))}; median wall ${(median(run.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s vs ${(median(van.rows.map(r => r.wallMs ?? 0)) / 1000).toFixed(1)}s; prompt_tokens == vanilla ${ptEq}/${both.length}; identity ${ident}/${resp.length}`);
  process.exit(finished && ptPass && ident === resp.length ? 0 : 1);
} else if (cmd === "summarize") {
  const b = B(build);
  let line: string;
  try {
    const c = ctx(build), bBA: number[] = [], vBA: number[] = [], perAb: string[] = [], unfinished: string[] = [];
    let done = 0, ab = 0, vab = 0, lost = 0, gained = 0, dl = 0, dg = 0, fa = 0, fr = 0, nPaired = 0;
    for (const t of c.tests) {
      const isDev = (b.tests as string[]).includes(t), run = isDev ? devRows(build, t) : (b.kept as string[]).includes(t) ? buildRows(build, t) : null, van = vanillaRows(build, t);
      if (!run || !van) { unfinished.push(t); continue; }
      if (run.rows.length === c.caseIds.get(t)!.size && run.rows.every(r => FINISHED.includes(r.status))) done++; else unfinished.push(t);
      bBA.push(ba(run.rows)); vBA.push(ba(van.rows));
      const x = counts(run.rows).ab, y = counts(van.rows).ab; ab += x; vab += y; perAb.push(`${t}${isDev ? "" : "[kept]"} ${x}/${run.rows.length} vs ${y}/${van.rows.length}`);
      for (const r of run.rows) {
        const v = van.byId.get(r.caseId); if (r.status !== "scored" || v?.status !== "scored") continue;
        nPaired++;
        if (correct(v) && !correct(r)) { lost++; if (r.positive) dl++; else fa++; }
        if (!correct(v) && correct(r)) { gained++; if (r.positive) dg++; else fr++; }
      }
    }
    const mean = (xs: number[]) => xs.filter(x => !Number.isNaN(x)).reduce((p, q) => p + q, 0) / Math.max(1, xs.filter(x => !Number.isNaN(x)).length);
    const st = b.stopped, orig = buildRows(build, st.test), ov = vanillaRows(build, st.test);
    const origTxt = orig && ov ? `original stopped cell ${st.test} (${st.condition}, retained): abstentions ${counts(orig.rows).ab}/${orig.rows.length} vs vanilla ${counts(ov.rows).ab}/${ov.rows.length}, BA ${ba(orig.rows).toFixed(3)} vs ${ba(ov.rows).toFixed(3)}` : `original stopped cell ${st.test} missing`;
    line = `DEVIATION (abstention rule report-only): tests complete ${done}/${c.tests.length} (deviation ${b.tests.length}, kept stage 2 ${b.kept.length}); macro BA (abstentions excluded) build/vanilla ${mean(bBA).toFixed(3)}/${mean(vBA).toFixed(3)} (delta ${(mean(bBA) - mean(vBA)).toFixed(3)}); pooled McNemar vanilla->build on ${nPaired} both-scored: lost ${lost} gained ${gained}, exact p ${mcnemar(lost, gained).toExponential(2)} (uncorrected, descriptive); detections lost/gained ${dl}/${dg}; false alarms added/removed ${fa}/${fr}; abstentions ${ab} vs vanilla ${vab} (per dataset: ${perAb.join(", ")}); ${origTxt}` +
      (unfinished.length ? `; UNFINISHED ${unfinished.join(",")}` : "");
  } catch (error) {
    line = `SUMMARY_ERROR ${(error instanceof Error ? error.message : String(error)).replace(/[|\n]/g, " ").slice(0, 200)}`;
  }
  appendFileSync(resolve(DEV_DIR, "progress.log"), `MODEL_DONE|${now()}|${plan.builds[build]?.display ?? build}|${a3}|${line.replace(/\|/g, "/")}\n`);
  console.log(line);
} else { console.error("usage: see the header"); process.exit(1); }
