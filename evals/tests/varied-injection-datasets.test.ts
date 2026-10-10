import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { segmentCase } from "../src/strategies.js";
import { validateMatrixSuite } from "../src/researchMatrix.js";
import { SCORE_ONLY_PROMPT } from "../src/engines.js";
import type { DatasetManifest, EvalCase, EvalTest } from "../src/types.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
type Manifest = DatasetManifest & { provenance: { license: string; classCounts: { injection: number; benign: number }; facets: string[] } };
const manifest = (id: string) => JSON.parse(readFileSync(`${root}evals/datasets/${id}.json`, "utf8")) as Manifest;
const hasCases = (id: string) => existsSync(`${root}${manifest(id).source.path}`);
const label = (item: EvalCase) => item.annotations.prompt_injection_attempt;
const external = (item: EvalCase) => item.turns.filter(turn => turn.origin === "external").at(-1)!.text;
const groupBy = <T,>(items: readonly T[], key: (item: T) => string) => items.reduce((map, item) => map.set(key(item), [...map.get(key(item)) ?? [], item]), new Map<string, T[]>());

// [dataset ID, suite test ID, injection, benign]
const DATASETS = [
  ["bipia-table-paired-v1", "bipia-table-mixed", 450, 150],
  ["bipia-code-paired-v1", "bipia-code-mixed", 300, 100],
  ["browsesafe-test-stratified-v1", "browsesafe-mixed", 200, 200],
  ["nemotron-ipi-domain-sample-v1", "nemotron-ipi-attacks", 360, 0],
  ["agentdojo-suites-v1", "agentdojo-suites-mixed", 236, 44],
  ["repoguardbench-carriers-v1", "repoguard-mixed", 480, 95],
  ["inj-squad-v1", "inj-squad-mixed", 900, 300],
  ["inj-triviaqa-v1", "inj-triviaqa-mixed", 900, 300],
  ["llmail-inject-payload-pool-v1", "llmail-pool-attacks", 300, 0],
  ["longpi-email-llmail-v1", "longpi-email-llmail-mixed", 300, 100],
  ["longpi-subtle-paper-v1", "longpi-subtle-paper-mixed", 120, 100],
  ["longpi-subtle-code-v1", "longpi-subtle-code-mixed", 120, 100],
  ["longpi-subtle-resume-v1", "longpi-subtle-resume-mixed", 120, 100],
  ["longpi-authorized-instructions-v1", "longpi-authorized-benign", 0, 384],
] as const;
const SUITE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-extension-v1.json";
const BASELINE = "evals/suites/prompt-injection-lmstudio-studio-baseline-q8-t4096-v1.json";
// Mirrors evals/src/engines.ts: prompt bytes + source bytes + 1,280 <= contextLength.
const SOURCE_BYTE_LIMIT = 65536 - 1280 - Buffer.byteLength(SCORE_ONLY_PROMPT);

function python(code: string) {
  const result = spawnSync("python3", ["-B", "-c", `import importlib.util,pathlib,sys,tempfile,shutil,json\nsys.path.insert(0,'evals/scripts')\ndef load(name):\n s=importlib.util.spec_from_file_location(name.replace('-','_'),f'evals/scripts/{name}.py')\n m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m\ndef rejects(fn):\n try: fn()\n except ValueError as error: assert 'mismatch' in str(error), error\n else: raise AssertionError('tampered source accepted')\n${code}`], { cwd: root, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect({ status: result.status, stderr: result.status === 0 ? "" : result.stderr }).toEqual({ status: 0, stderr: "" });
}

describe("varied prompt-injection datasets: manifests and suite", () => {
  it("pins provenance, license, private source path and class counts", () => {
    for (const [id, , injection, benign] of DATASETS) {
      const m = manifest(id);
      expect(m.revision).toBe(`sha256:${m.source.sha256}`);
      expect(m.source.path).toBe(`evals/private/sources/${id}.jsonl`);
      expect(m.source.format).toBe("canonical-jsonl");
      expect(m.provenance.license.length).toBeGreaterThan(10);
      expect(m.provenance.classCounts).toEqual({ injection, benign });
      expect(m.expectedCases).toBe(injection + benign);
      expect(m.provenance.facets.length).toBeGreaterThan(0);
    }
  });

  it("extension suite tests every new dataset and copies the running baseline's engines and conditions byte-for-byte", () => {
    const text = readFileSync(`${root}${SUITE}`, "utf8"), base = readFileSync(`${root}${BASELINE}`, "utf8");
    const marker = '  "engines": {';
    expect(text.slice(text.indexOf(marker))).toBe(base.slice(base.indexOf(marker)));
    const suite = validateMatrixSuite(JSON.parse(text), [], []);
    expect(suite.conditions).toHaveLength(8);
    expect(suite.tests.map(test => test.id)).toEqual(DATASETS.map(([, testId]) => testId));
    for (const [id, testId, injection, benign] of DATASETS) {
      const test = suite.tests.find(item => item.id === testId)!, m = manifest(id);
      expect([test.datasetId, test.datasetRevision, test.annotationKey]).toEqual([id, m.revision, m.annotationKey]);
      // Mixed labels use all cases with detection and false-positive metrics; single-class tests select their class.
      expect(test.caseSelector).toBe(injection && benign ? "all" : injection ? "positive" : "negative");
      if (test.caseSelector === "all") expect(test.metrics).toEqual(["detection_rate", "false_positive_rate", "confusion_matrix"]);
    }
  });
});

describe("varied prompt-injection datasets: generated cases", () => {
  for (const [id, , injection, benign] of DATASETS) {
    (hasCases(id) ? it : it.skip)(`${id} loads, selects both classes and fits the local engine bound`, () => {
      const m = manifest(id);
      const cases = loadDataset(m, root);
      const test: EvalTest = { id: "check", datasetId: id, datasetRevision: m.revision, annotationKey: m.annotationKey, caseSelector: "positive", metrics: ["detection_rate"] };
      expect(selectTestCases(cases, m, test)).toHaveLength(injection);
      expect(selectTestCases(cases, m, { ...test, caseSelector: "negative" })).toHaveLength(benign);
      const screened = new Set<string>();
      for (const item of cases) {
        const segments = segmentCase(item, { id: "full", kind: "full_text", turnSelection: "last_external" });
        expect(segments).toHaveLength(1);
        expect(segments[0]!.text).toBe(external(item));
        expect(Buffer.byteLength(segments[0]!.text)).toBeLessThanOrEqual(SOURCE_BYTE_LIMIT);
        expect(item.turns.every(turn => turn.origin !== "external" || turn.text.trim().length > 0)).toBe(true);
        screened.add(segments[0]!.text);
      }
      // No duplicate model inputs within a cohort.
      expect(screened.size).toBe(cases.length);
    });
  }

  (hasCases("longpi-subtle-paper-v1") ? it : it.skip)("subtle template cohorts cover every frozen template five times with paired clean siblings", () => {
    const templates = JSON.parse(readFileSync(`${root}evals/datasets/templates/varied-injection-templates-v1.json`, "utf8"));
    for (const domain of ["paper", "code", "resume"]) {
      const cases = loadDataset(manifest(`longpi-subtle-${domain}-v1`), root);
      const frozen = templates.subtle[domain] as { id: string; position: string; text: string }[];
      expect(frozen.length).toBeGreaterThanOrEqual(20);
      const byTemplate = groupBy(cases.filter(item => label(item) === "injection"), item => String(item.facets.attack_template_id));
      expect([...byTemplate.keys()].sort()).toEqual(frozen.map(t => `${domain}:${t.id}`).sort());
      const clean = new Map(cases.filter(item => label(item) === "benign").map(item => [String(item.facets.document_family), item]));
      expect(clean.size).toBe(100);
      for (const template of frozen) {
        const attacked = byTemplate.get(`${domain}:${template.id}`)!;
        expect(attacked).toHaveLength(5);
        expect(new Set(attacked.map(item => item.facets.document_family)).size).toBe(5);
        for (const item of attacked) {
          expect(item.facets.template_position).toBe(template.position);
          const sibling = clean.get(String(item.facets.document_family))!;
          expect(item.turns[0]!.text).toBe(sibling.turns[0]!.text);
          // Code comments flatten newlines; every other insertion keeps the template verbatim.
          expect(external(item)).toContain(template.text);
          expect(external(sibling)).not.toContain(template.text);
          // The attacked document is the clean sibling plus the inserted template (and its separator/comment prefix).
          expect(external(item).length - external(sibling).length).toBeGreaterThanOrEqual(template.text.length);
          expect(external(item).length - external(sibling).length).toBeLessThanOrEqual(template.text.length + 64);
        }
      }
    }
  });

  (hasCases("longpi-subtle-paper-v1") && existsSync(`${root}evals/private/sources/longpibench-paper-default-v1.jsonl`) ? it : it.skip)("clean subtle siblings are byte-identical to the baseline LongPIBench clean cases", () => {
    for (const domain of ["paper", "code", "resume"]) {
      const base = loadDataset(manifest(`longpibench-${domain}-default-v1`), root).filter(item => label(item) === "benign");
      const ours = loadDataset(manifest(`longpi-subtle-${domain}-v1`), root).filter(item => label(item) === "benign");
      expect(new Set(ours.map(external))).toEqual(new Set(base.map(external)));
    }
  });

  (hasCases("longpi-authorized-instructions-v1") ? it : it.skip)("authorized-instruction controls are benign and cover every phrasing in four domains", () => {
    const cases = loadDataset(manifest("longpi-authorized-instructions-v1"), root);
    expect(cases.every(item => label(item) === "benign")).toBe(true);
    const byDomain = groupBy(cases, item => String(item.facets.domain));
    expect([...byDomain.keys()].sort()).toEqual(["code", "email", "paper", "resume"]);
    for (const items of byDomain.values()) {
      const byPhrasing = groupBy(items, item => String(item.facets.authorized_phrasing_id));
      expect(byPhrasing.size).toBe(24);
      for (const group of byPhrasing.values()) expect(group).toHaveLength(4);
    }
  });

  (hasCases("bipia-table-paired-v1") ? it : it.skip)("BIPIA table/code place every attack once per position and pair three attacks with each clean context", () => {
    for (const id of ["bipia-table-paired-v1", "bipia-code-paired-v1"]) {
      const cases = loadDataset(manifest(id), root);
      for (const split of ["train", "test"]) {
        const attacks = cases.filter(item => item.facets.split === split && label(item) === "injection");
        for (const position of ["start", "middle", "end"]) {
          const ids = attacks.filter(item => item.facets.insertion_position === position).map(item => `${item.facets.attack_family}/${item.facets.attack_variant}`);
          expect(new Set(ids).size).toBe(ids.length);
          expect(ids.length).toBe(id.includes("table") ? 75 : 50);
        }
      }
      for (const pair of groupBy(cases, item => String(item.facets.pair_id)).values()) {
        expect(pair).toHaveLength(4);
        const clean = pair.find(item => label(item) === "benign")!;
        expect(new Set(pair.filter(item => item !== clean).map(item => item.facets.insertion_position))).toEqual(new Set(["start", "middle", "end"]));
        for (const item of pair.filter(entry => entry !== clean)) {
          const source = external(item), base = external(clean);
          if (item.facets.insertion_position === "start") expect(source.endsWith(`\n${base}`)).toBe(true);
          if (item.facets.insertion_position === "end") expect(source.startsWith(`${base}\n`)).toBe(true);
        }
      }
    }
  });

  (hasCases("inj-squad-v1") ? it : it.skip)("Inj-SQuAD/TriviaQA place each of 300 instructions at all three positions", () => {
    for (const id of ["inj-squad-v1", "inj-triviaqa-v1"]) {
      const attacks = loadDataset(manifest(id), root).filter(item => label(item) === "injection");
      const byInstruction = groupBy(attacks, item => String(item.facets.instruction_id));
      expect(byInstruction.size).toBe(300);
      for (const group of byInstruction.values()) expect(new Set(group.map(item => item.facets.insertion_position))).toEqual(new Set(["start", "middle", "end"]));
    }
  });

  (hasCases("nemotron-ipi-domain-sample-v1") && hasCases("agentdojo-suites-v1") ? it : it.skip)("Nemotron and AgentDojo keep task context separate and stratify domains/suites", () => {
    const nemotron = loadDataset(manifest("nemotron-ipi-domain-sample-v1"), root);
    for (const group of groupBy(nemotron, item => String(item.facets.domain)).values()) expect(group).toHaveLength(40);
    expect(groupBy(nemotron, item => String(item.facets.domain)).size).toBe(9);
    const dojo = loadDataset(manifest("agentdojo-suites-v1"), root);
    expect(new Set(dojo.map(item => item.facets.suite))).toEqual(new Set(["workspace-v1", "travel-v1", "banking-v1", "slack-v1"]));
    expect(new Set(dojo.filter(item => label(item) === "injection").map(item => item.facets.attack)).size).toBe(5);
    for (const item of [...nemotron, ...dojo]) {
      expect(item.turns.some(turn => turn.origin === "operator")).toBe(true);
      expect(item.turns.at(-1)!.origin).toBe("external");
    }
  });
});

describe("varied prompt-injection importers: determinism and tamper rejection", () => {
  (existsSync(`${root}evals/private/upstream/longpibench-data/checksums.sha256`) ? it : it.skip)("LongPIBench template cohorts rebuild identically and reject an edited template list", () => {
    python(`m=load('build-longpi-template-cohorts')\nc=__import__('canonical_cohort')\nt=m.load_templates()\nfor d in ('code','resume'):\n a=c.canonical_bytes(m.subtle_cases(d,t['subtle'][d]));b=c.canonical_bytes(m.subtle_cases(d,t['subtle'][d]))\n assert a==b and c.digest(a)==json.load(open(f'evals/datasets/longpi-subtle-{d}-v1.json'))['source']['sha256']\nwith tempfile.TemporaryDirectory() as tmp:\n p=pathlib.Path(tmp)/m.TEMPLATES;p.parent.mkdir(parents=True)\n p.write_text(pathlib.Path(m.TEMPLATES).read_text().replace('P01','P99'))\n rejects(lambda: m.load_templates(tmp))\n`);
  });

  (existsSync(`${root}.local/eval-sources/bipia/benchmark/table/test.jsonl`) ? it : it.skip)("BIPIA table/code rebuild identically and reject tampering", () => {
    python(`m=load('import-bipia-table-code')\nc=__import__('canonical_cohort')\nsrc=pathlib.Path('.local/eval-sources/bipia')\nfor task,spec in m.TASKS.items():\n a=c.canonical_bytes(m.build_task(src,task));assert a==c.canonical_bytes(m.build_task(src,task))\n assert c.digest(a)==json.load(open(f"evals/datasets/{spec['dataset']}.json"))['source']['sha256']\nwith tempfile.TemporaryDirectory() as tmp:\n n='benchmark/code_attack_test.json';t=pathlib.Path(tmp)/n;t.parent.mkdir(parents=True);t.write_bytes((src/n).read_bytes()+b' ')\n rejects(lambda: m.read_source(tmp,n))\n`);
  });

  (existsSync(`${root}.local/eval-sources/injpia/LICENSE`) && existsSync(`${root}.local/eval-sources/repoguard/LICENSE`) ? it : it.skip)("Inj-QA and RepoGuardBench rebuild identically and reject tampering", () => {
    python(`c=__import__('canonical_cohort')\nq=load('import-inj-qa');src=pathlib.Path('.local/eval-sources/injpia')\nfor key in q.DATASETS:\n i,_,a=q.build(src,key);assert c.canonical_bytes(a)==c.canonical_bytes(q.build(src,key)[2])\n assert c.digest(c.canonical_bytes(a))==json.load(open(f'evals/datasets/{i}.json'))['source']['sha256']\nr=load('import-repoguard');rsrc=pathlib.Path('.local/eval-sources/repoguard')\na=c.canonical_bytes(r.build(rsrc));assert a==c.canonical_bytes(r.build(rsrc))\nassert c.digest(a)==json.load(open('evals/datasets/repoguardbench-carriers-v1.json'))['source']['sha256']\nfor mod,base in ((q,src),(r,rsrc)):\n with tempfile.TemporaryDirectory() as tmp:\n  shutil.copytree(base,tmp,dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git'))\n  p=pathlib.Path(tmp)/'LICENSE';p.write_text(p.read_text()+'x')\n  rejects(lambda: mod.build(tmp,'squad') if mod is q else mod.build(tmp))\n`);
  });

  (existsSync(`${root}evals/private/upstream/nemotron-ipi/train.jsonl`) ? it : it.skip)("Nemotron sample rebuilds identically and rejects tampering", () => {
    python(`c=__import__('canonical_cohort');m=load('import-nemotron-ipi');src=pathlib.Path('evals/private/upstream/nemotron-ipi')\na=c.canonical_bytes(m.build(src));assert a==c.canonical_bytes(m.build(src))\nassert c.digest(a)==json.load(open('evals/datasets/nemotron-ipi-domain-sample-v1.json'))['source']['sha256']\nwith tempfile.TemporaryDirectory() as tmp:\n shutil.copy(src/'README.md',tmp);p=pathlib.Path(tmp)/'train.jsonl';p.write_bytes((src/'train.jsonl').read_bytes()+b' ')\n rejects(lambda: m.build(tmp))\n`);
  });

  (existsSync(`${root}evals/private/upstream/llmail-inject/data/scenarios.json`) ? it : it.skip)("LLMail payload pool and email cohort rebuild identically and reject tampering", () => {
    python(`c=__import__('canonical_cohort');m=load('import-llmail-pool');src=pathlib.Path('evals/private/upstream/llmail-inject')\npool,_=m.select_pool(src)\nassert c.digest(c.canonical_bytes(m.pool_cases(pool)))==json.load(open('evals/datasets/llmail-inject-payload-pool-v1.json'))['source']['sha256']\na=c.canonical_bytes(m.cohort_cases(pool));assert a==c.canonical_bytes(m.cohort_cases(pool))\nassert c.digest(a)==json.load(open('evals/datasets/longpi-email-llmail-v1.json'))['source']['sha256']\nassert len({p['submission_sha256'] for p in pool})==300\nwith tempfile.TemporaryDirectory() as tmp:\n d=pathlib.Path(tmp)/'data';d.mkdir()\n for n in m.SOURCE_HASHES:\n  t=pathlib.Path(tmp)/n\n  if t.name.startswith('labelled'): t.symlink_to((src/n).resolve())\n  else: t.write_bytes((src/n).read_bytes())\n (d/'scenarios.json').write_text('{}')\n rejects(lambda: m.select_pool(tmp))\n`);
  }, 120000);

  (existsSync(`${root}evals/private/upstream/browsesafe-bench/test.parquet`) ? it : it.skip)("BrowseSafe sampling is deterministic and pins its parquet before reading it", () => {
    // Synthetic rows exercise the stratified sampler without pyarrow; the real parquet is checked by hash first.
    python(`m=load('import-browsesafe');c=__import__('canonical_cohort')\nrows=[{'label':l,'content':f'<p>{l} {i}</p>'+'x'*(i*37%9000)} for l in ('yes','no') for i in range(300)]\na=m.build_from_rows(rows)[0]\nassert c.canonical_bytes(a)==c.canonical_bytes(m.build_from_rows(rows)[0]) and len(a)==400\nsrc=pathlib.Path('evals/private/upstream/browsesafe-bench')\nwith tempfile.TemporaryDirectory() as tmp:\n for n in m.SOURCE_HASHES: shutil.copy(src/n,tmp)\n p=pathlib.Path(tmp)/'LICENSE';p.write_text(p.read_text()+' ')\n rejects(lambda: m.load_rows(tmp))\n`);
  });
});
