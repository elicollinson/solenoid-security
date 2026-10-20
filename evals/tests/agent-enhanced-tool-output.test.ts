import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { segmentCase } from "../src/strategies.js";
import { validateMatrixSuite } from "../src/researchMatrix.js";
import { SCORE_ONLY_PROMPT } from "../src/engines.js";
import type { DatasetManifest, EvalCase, EvalTest } from "../src/types.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ID = "agent-enhanced-tool-output-v1";
const SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-agent-enhanced-v1.json";
const EXTENSION = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const TEMPLATES = "evals/datasets/templates/agent-benign-instructions-v1.json";
const BUILDER = "evals/scripts/build-agent-enhanced-tool-output.py";
const SOURCE_BYTE_LIMIT = 65536 - 1280 - Buffer.byteLength(SCORE_ONLY_PROMPT);

type Template = { id: string; kind: string; fits: string[]; text: string };
type Payload = { source: string; category: string; license: string; sha256: string; text: string };
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const manifest = JSON.parse(read(`evals/datasets/${ID}.json`)) as DatasetManifest & { provenance: Record<string, any> };
const templateList = JSON.parse(read(TEMPLATES)) as { fieldFamilies: Record<string, string>; templates: Template[] };
const hasCases = existsSync(`${root}${manifest.source.path}`) && existsSync(`${root}${manifest.provenance.payloadSidecar.path}`);
const external = (item: EvalCase) => item.turns.filter(turn => turn.origin === "external").at(-1)!.text;
const facet = (item: EvalCase, key: string) => String(item.facets[key]);
const count = <T,>(items: readonly T[], key: (item: T) => string) => items.reduce((map, item) => map.set(key(item), (map.get(key(item)) ?? 0) + 1), new Map<string, number>());

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

// Some AgentDojo travel tools return a Python dict repr; read its string literals.
function pythonStrings(text: string): string[] {
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
  const unescape = (body: string) => body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (_, e: string) =>
    /^[xuU][0-9a-fA-F]+$/.test(e) && e.length > 1 ? String.fromCodePoint(parseInt(e.slice(1), 16)) : escapes[e] ?? `\\${e}`);
  return [...text.matchAll(/'((?:[^'\\]|\\[\s\S])*)'|"((?:[^"\\]|\\[\s\S])*)"/g)].map(m => unescape(m[1] ?? m[2]!));
}

/** String leaves of a screened tool output (Nemotron JSON, AgentDojo YAML or a Python literal) plus the raw text. */
function stringLeaves(text: string): string[] {
  try { return [...leaves(JSON.parse(text)), text]; } catch { /* not JSON */ }
  if (/^[{[]['"]/.test(text.trimStart())) return [...pythonStrings(text), text];
  try { return [...leaves(Bun.YAML.parse(text)), text]; } catch { return [text]; }
}

describe("agent-enhanced tool-output dataset: manifest, templates and suite", () => {
  it("pins provenance, licenses, private paths and balanced class counts", () => {
    expect(manifest.revision).toBe(`sha256:${manifest.source.sha256}`);
    expect(manifest.source).toMatchObject({ path: `evals/private/sources/${ID}.jsonl`, format: "canonical-jsonl", visibility: "public" });
    expect(manifest.provenance.classCounts).toEqual({ injection: 250, benign: 250 });
    expect(manifest.expectedCases).toBe(500);
    expect(manifest.provenance.payloadSidecar.path).toBe(`evals/private/sources/${ID}-payloads.json`);
    for (const source of ["agentdojo", "nemotron-ipi", "llmail-inject", "bipia"]) expect(Object.keys(manifest.provenance.repositories)).toContain(source);
    for (const license of ["MIT", "CC BY 4.0", "repository-authored"]) expect(manifest.provenance.license.toLowerCase()).toContain(license.toLowerCase());
  });

  it("freezes 40-60 benign phrasings pinned by SHA-256 in the builder and the manifest", () => {
    const digest = sha256(readFileSync(`${root}${TEMPLATES}`));
    expect(manifest.provenance.templateList).toEqual({ path: TEMPLATES, sha256: digest, templates: templateList.templates.length });
    expect(read(BUILDER)).toContain(`TEMPLATES_SHA256 = "${digest}"`);
    const templates = templateList.templates;
    expect(templates.length).toBeGreaterThanOrEqual(40);
    expect(templates.length).toBeLessThanOrEqual(60);
    expect(new Set(templates.map(t => t.id)).size).toBe(templates.length);
    expect(new Set(templates.map(t => t.text)).size).toBe(templates.length);
    const families = Object.keys(templateList.fieldFamilies);
    for (const template of templates) {
      expect(template.fits.length).toBeGreaterThan(0);
      expect(template.fits.every(f => families.includes(f))).toBe(true);
      // Benign by construction: no phrasing addresses an assistant or AI.
      expect(template.text).not.toMatch(/\b(assistant|AI|model|LLM|system prompt)\b/i);
    }
    for (const family of families) expect(templates.filter(t => t.fits.includes(family)).length).toBeGreaterThanOrEqual(5);
    expect(new Set(templates.map(t => t.kind)).size).toBeGreaterThanOrEqual(15);
  });

  it("suite runs the extension suite's engines and conditions byte-for-byte, minus Qwen3.6 27B", () => {
    const suite = validateMatrixSuite(JSON.parse(read(SUITE)), [], []);
    const raw = JSON.parse(read(SUITE)), extension = JSON.parse(read(EXTENSION));
    const kept = extension.conditions.filter((c: { engine: string }) => c.engine !== "qwen36-27b-q8");
    expect(raw.conditions).toEqual(kept);
    expect(raw.conditions.map((c: { id: string }) => c.id)).toEqual([
      "baseline-ornith-q8-t4096-full", "baseline-gemma26-q8-t4096-full", "baseline-qwen36-35b-a3b-q8-t4096-full", "baseline-laguna-xs21-q8-t4096-full",
      "baseline-qwen38-q8gguf-t4096-full", "baseline-muse-q8-t4096-full", "baseline-gemma31-q8-t4096-full",
    ]);
    for (const [id, engine] of Object.entries(raw.engines)) expect(engine).toEqual(extension.engines[id]);
    expect(Object.keys(raw.engines).sort()).toEqual(kept.map((c: { engine: string }) => c.engine).sort());
    expect([raw.inputStrategies, raw.decisionRules]).toEqual([extension.inputStrategies, extension.decisionRules]);
    expect(raw.inputStrategies.full).toEqual({ id: "full-last-external-v1", kind: "full_text", turnSelection: "last_external" });
    expect(suite.conditions).toHaveLength(7);
    expect(suite.tests.map(test => test.id)).toEqual(["agent-enhanced-mixed"]);
    const test = suite.tests[0]!;
    expect([test.datasetId, test.datasetRevision, test.annotationKey, test.caseSelector]).toEqual([ID, manifest.revision, manifest.annotationKey, "all"]);
    expect(test.metrics).toEqual(["detection_rate", "false_positive_rate", "confusion_matrix"]);
  });
});

describe("agent-enhanced tool-output dataset: generated cases", () => {
  const load = () => {
    const cases = loadDataset(manifest, root);
    const payloads = JSON.parse(readFileSync(`${root}${manifest.provenance.payloadSidecar.path}`, "utf8")) as Record<string, Payload>;
    return { cases, payloads, positives: cases.filter(c => c.annotations.prompt_injection_attempt === "injection"), negatives: cases.filter(c => c.annotations.prompt_injection_attempt === "benign") };
  };

  (hasCases ? it : it.skip)("loads, selects both classes, frames the tool output like agentdojo-suites-mixed and fits the engine bound", () => {
    const { cases } = load();
    const test: EvalTest = { id: "check", datasetId: ID, datasetRevision: manifest.revision, annotationKey: manifest.annotationKey, caseSelector: "positive", metrics: ["detection_rate"] };
    expect(selectTestCases(cases, manifest, test)).toHaveLength(250);
    expect(selectTestCases(cases, manifest, { ...test, caseSelector: "negative" })).toHaveLength(250);
    const screened = new Set<string>();
    for (const item of cases) {
      const last = item.turns.at(-1)!;
      expect([last.id, last.role, last.origin]).toEqual(["tool-output", "tool", "external"]);
      expect(item.turns.slice(0, -1).every(turn => turn.origin === "operator")).toBe(true);
      const segments = segmentCase(item, { id: "full", kind: "full_text", turnSelection: "last_external" });
      expect(segments.map(s => s.text)).toEqual([external(item)]);
      expect(Buffer.byteLength(external(item))).toBeLessThanOrEqual(SOURCE_BYTE_LIMIT);
      screened.add(external(item));
    }
    expect(screened.size).toBe(cases.length);
  });

  (hasCases ? it : it.skip)("balances classes, carrier sources, positions and payload sources", () => {
    const { positives, negatives } = load();
    expect(Object.fromEntries(count(negatives, c => facet(c, "negative_type")))).toEqual({ clean_carrier: 100, hard_negative: 150 });
    expect(Object.fromEntries(count(positives, c => facet(c, "payload_source")))).toEqual({ "nemotron-ipi": 70, "llmail-inject": 70, bipia: 70, agentdojo: 40 });
    expect(positives.every(c => facet(c, "control") === String(facet(c, "payload_source") === "agentdojo"))).toBe(true);
    // Same carrier source mix in both classes.
    expect(count(positives, c => facet(c, "carrier_source"))).toEqual(count(negatives, c => facet(c, "carrier_source")));
    // Every payload source appears in both carrier sources.
    for (const source of ["nemotron-ipi", "llmail-inject", "bipia", "agentdojo"]) {
      expect(new Set(positives.filter(c => facet(c, "payload_source") === source).map(c => facet(c, "carrier_source")))).toEqual(new Set(["agentdojo", "nemotron"]));
    }
    const hard = negatives.filter(c => facet(c, "negative_type") === "hard_negative");
    expect(Object.fromEntries(count(hard, c => facet(c, "position")))).toEqual({ start: 50, middle: 50, end: 50 });
    for (const position of ["start", "middle", "end"]) expect(positives.filter(c => facet(c, "position") === position).length).toBeGreaterThanOrEqual(80);
    // Field families with hard negatives also host positives, and clean carriers have no inserted field.
    for (const family of new Set(hard.map(c => facet(c, "carrier_field_family")))) expect(positives.some(c => facet(c, "carrier_field_family") === family)).toBe(true);
    expect(negatives.filter(c => facet(c, "negative_type") === "clean_carrier").every(c => facet(c, "carrier_field") === "none" && facet(c, "position") === "none")).toBe(true);
  });

  (hasCases ? it : it.skip)("has no carrier or payload leakage across classes", () => {
    const { cases, payloads, positives, negatives } = load();
    const classes = new Map<string, Set<string>>();
    for (const item of cases) classes.set(facet(item, "carrier_id"), (classes.get(facet(item, "carrier_id")) ?? new Set()).add(String(item.annotations.prompt_injection_attempt)));
    expect([...classes.values()].every(labels => labels.size === 1)).toBe(true);
    expect(new Set(positives.map(c => facet(c, "payload_id"))).size).toBe(positives.length);
    expect(Object.keys(payloads).sort()).toEqual(positives.map(c => facet(c, "payload_id")).sort());
    for (const item of negatives) {
      const strings = stringLeaves(external(item));
      for (const payload of Object.values(payloads)) expect(strings.some(s => s.includes(payload.text))).toBe(false);
    }
    for (const item of positives) {
      const strings = stringLeaves(external(item));
      for (const template of templateList.templates) expect(strings.some(s => s.includes(template.text))).toBe(false);
    }
  });

  (hasCases ? it : it.skip)("uses every frozen phrasing three times, verbatim, in a field family it fits", () => {
    const { negatives } = load();
    const hard = negatives.filter(c => facet(c, "negative_type") === "hard_negative");
    const byTemplate = count(hard, c => facet(c, "hard_negative_template_id"));
    expect([...byTemplate.keys()].sort()).toEqual(templateList.templates.map(t => t.id).sort());
    expect([...byTemplate.values()].every(n => n === 3)).toBe(true);
    for (const item of hard) {
      const template = templateList.templates.find(t => t.id === facet(item, "hard_negative_template_id"))!;
      expect(facet(item, "hard_negative_kind")).toBe(template.kind);
      expect(template.fits).toContain(facet(item, "carrier_field_family"));
      expect(stringLeaves(external(item)).some(s => s.includes(template.text))).toBe(true);
    }
  });

  (hasCases ? it : it.skip)("places each positive payload verbatim, as recorded in the pinned sidecar", () => {
    const { positives, payloads } = load();
    expect(sha256(readFileSync(`${root}${manifest.provenance.payloadSidecar.path}`))).toBe(manifest.provenance.payloadSidecar.sha256);
    for (const item of positives) {
      const payload = payloads[facet(item, "payload_id")]!;
      expect([payload.source, payload.category, payload.sha256]).toEqual([facet(item, "payload_source"), facet(item, "payload_category"), facet(item, "payload_sha256")]);
      expect(sha256(payload.text)).toBe(payload.sha256);
      expect(stringLeaves(external(item)).some(s => s.includes(payload.text))).toBe(true);
      expect(facet(item, "attack_template_id")).toBe(facet(item, "payload_id"));
      // Never the carrier's original Nemotron injection slot.
      if (facet(item, "carrier_source") === "nemotron") expect(facet(item, "carrier_field")).not.toBe(facet(item, "carrier_original_slot"));
    }
  });

  const nemotron = `${root}evals/private/upstream/nemotron-ipi/train.jsonl`, bipia = `${root}.local/eval-sources/bipia/benchmark`;
  const pool = `${root}evals/private/sources/llmail-inject-payload-pool-v1.jsonl`, dojo = `${root}evals/private/sources/agentdojo-suites-v1.jsonl`;
  (hasCases && [nemotron, `${bipia}/text_attack_test.json`, pool, dojo].every(existsSync) ? it : it.skip)("every positive payload is a published source text, verbatim", () => {
    const { positives, payloads } = load();
    const nemotronTexts = new Map(readFileSync(nemotron, "utf8").trim().split("\n").map(line => JSON.parse(line)).map(row => [`nemotron-ipi:row${row.id}`, row.injection.injection_text.trim()]));
    const bipiaTexts = new Map<string, string>();
    for (const split of ["train", "test"]) {
      for (const [family, texts] of Object.entries(JSON.parse(readFileSync(`${bipia}/text_attack_${split}.json`, "utf8")) as Record<string, string[]>)) {
        texts.forEach((text, variant) => bipiaTexts.set(`bipia:text/${split}/${family}/${variant}`, text));
      }
    }
    const poolCases = readFileSync(pool, "utf8").trim().split("\n").map(line => JSON.parse(line) as { turns: { text: string }[]; facets: { pool_index: number } });
    const llmailTexts = new Map(poolCases.map(c => [`llmail-inject:pool${c.facets.pool_index}`, c.turns[0]!.text.slice(c.turns[0]!.text.indexOf("\n\n") + 2)]));
    const dojoCases = readFileSync(dojo, "utf8").trim().split("\n").map(line => JSON.parse(line) as EvalCase & { label: string });
    for (const item of positives) {
      const id = facet(item, "payload_id"), text = payloads[id]!.text;
      if (id.startsWith("nemotron-ipi:")) expect(nemotronTexts.get(id)).toBe(text);
      else if (id.startsWith("bipia:")) expect(bipiaTexts.get(id)).toBe(text);
      else if (id.startsWith("llmail-inject:")) expect(llmailTexts.get(id)).toBe(text);
      else {
        // AgentDojo control payloads are the payload of an agentdojo-suites-v1 case with the same suite, task and template.
        // There it passes through the environment YAML, which can fold whitespace, so compare whitespace-normalized.
        const [suite, task, template] = id.slice("agentdojo:".length).split("/");
        const peers = dojoCases.filter(c => c.label === "injection" && c.facets.suite === `${suite}-v1` && c.facets.injection_task === task && c.facets.attack === template);
        expect(peers.length).toBeGreaterThan(0);
        const norm = (value: string) => value.replace(/\s+/g, " ").trim();
        expect(peers.some(c => stringLeaves(c.turns.at(-1)!.text).some(s => norm(s).includes(norm(text))))).toBe(true);
      }
    }
  });
});

describe("agent-enhanced tool-output builder", () => {
  const python = (code: string) => spawnSync("python3", ["-B", "-c", `import importlib.util,pathlib,sys,tempfile\nsys.path.insert(0,'evals/scripts')\ns=importlib.util.spec_from_file_location('b','${BUILDER}')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${code}`], { cwd: root, encoding: "utf8" });

  it("loads the pinned template list and rejects an edited one (stdlib only)", () => {
    const result = python(`assert len(m.load_templates())==${templateList.templates.length}\nwith tempfile.TemporaryDirectory() as tmp:\n p=pathlib.Path(tmp)/m.TEMPLATES;p.parent.mkdir(parents=True)\n p.write_text(pathlib.Path(m.TEMPLATES).read_text().replace('HN01','HN99'))\n try: m.load_templates(tmp)\n except ValueError as e: assert 'mismatch' in str(e)\n else: raise AssertionError('edited template list accepted')\nassert m.insert('One two. Three four.','X','middle','k')=='One two. X Three four.'\nassert m.insert('a b','X','start','k')=='X a b' and m.insert('a b','X','end','k')=='a b X'`);
    expect({ status: result.status, stderr: result.status === 0 ? "" : result.stderr }).toEqual({ status: 0, stderr: "" });
  });

  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
  const sources = [".local/eval-sources/dojo/src/agentdojo", "evals/private/upstream/nemotron-ipi/train.jsonl", "evals/private/upstream/llmail-inject/data/scenarios.json", ".local/eval-sources/bipia/benchmark/text_attack_test.json"];
  (uv && sources.every(path => existsSync(`${root}${path}`)) ? it : it.skip)("rebuilds byte-identical cases and sidecar from the pinned sources", () => {
    const result = spawnSync("uv", ["run", "--no-project", "--python", "3.12", "--with-editable", ".local/eval-sources/dojo", "--with", "pyyaml==6.0.3", "--with", "pydantic==2.14.0", "python", "-B", BUILDER], { cwd: root, encoding: "utf8" });
    expect({ status: result.status, stderr: result.status === 0 ? "" : result.stderr.slice(-2000) }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1)!).sha256).toBe(manifest.source.sha256);
    expect(sha256(readFileSync(`${root}${manifest.provenance.payloadSidecar.path}`))).toBe(manifest.provenance.payloadSidecar.sha256);
  }, 300000);
});
