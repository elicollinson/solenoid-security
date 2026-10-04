import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import { segmentCase } from "../src/strategies.js";
import type { DatasetManifest, EvalCase, EvalTest } from "../src/types.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const metadata = JSON.parse(readFileSync(`${root}evals/datasets/bipia-email-paired-v1.json`, "utf8")) as DatasetManifest & { provenance: { commit: string; license: string } };
const hasCases = existsSync(`${root}${metadata.source.path}`);
const hasSources = existsSync(`${root}.local/eval-sources/bipia/benchmark/email/test.jsonl`);

describe("paired BIPIA EmailQA cohort", () => {
  it("pins its canonical data, upstream commit, and EmailQA license", () => {
    expect(metadata.expectedCases).toBe(156);
    expect(metadata.revision).toBe(`sha256:${metadata.source.sha256}`);
    expect(metadata.provenance.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(metadata.provenance.license).toContain("MIT");
    expect(metadata.source.path.startsWith("evals/private/sources/")).toBe(true);
  });

  (hasCases ? it : it.skip)("preserves unique paired emails, trusted questions, and source-disjoint splits", () => {
    const cases = loadDataset(metadata, root);
    const test: EvalTest = { id: "bipia-email-mixed", datasetId: metadata.id, datasetRevision: metadata.revision, annotationKey: metadata.annotationKey, caseSelector: "all", metrics: ["detection_rate", "false_positive_rate", "confusion_matrix"] };
    expect(selectTestCases(cases, metadata, { ...test, caseSelector: "positive" })).toHaveLength(78);
    expect(selectTestCases(cases, metadata, { ...test, caseSelector: "negative" })).toHaveLength(78);
    const pairs = new Map<string, EvalCase[]>();
    for (const item of cases) {
      expect(item.id).toMatch(/^be-[a-f0-9]{24}$/);
      expect(item.turns.map(turn => turn.id)).toEqual(["task", "email"]);
      expect(item.turns.map(turn => turn.origin)).toEqual(["operator", "external"]);
      expect(segmentCase(item, { id: "external", kind: "full_text", turnSelection: "last_external" })[0]?.text).toBe(item.turns[1]?.text);
      const key = item.facets.pair_id as string;
      pairs.set(key, [...pairs.get(key) ?? [], item]);
    }
    expect(pairs.size).toBe(78);
    const train = new Set<string>(), testSources = new Set<string>();
    for (const [key, pair] of pairs) {
      expect(pair).toHaveLength(2);
      const clean = pair.find(item => item.annotations.prompt_injection_attempt === "benign")!;
      const attack = pair.find(item => item.annotations.prompt_injection_attempt === "injection")!;
      expect(clean.turns[0]?.text).toBe(attack.turns[0]?.text);
      expect(clean.facets.split).toBe(attack.facets.split);
      const cleanSource = clean.turns[1]!.text, attackSource = attack.turns[1]!.text;
      expect(attackSource).not.toBe(cleanSource);
      expect(attack.facets.insertion_position === "start" ? attackSource.endsWith(`\n${cleanSource}`) : attackSource.startsWith(`${cleanSource}\n`)).toBe(true);
      (clean.facets.split === "train" ? train : testSources).add(key);
    }
    expect(train.size).toBe(34);
    expect(testSources.size).toBe(44);
    expect([...train].some(key => testSources.has(key))).toBe(false);
  });

  (hasSources ? it : it.skip)("rebuilds deterministically and rejects tampered upstream files", () => {
    const code = `import importlib.util, pathlib, tempfile\np=pathlib.Path('evals/scripts/import-bipia-email.py')\ns=importlib.util.spec_from_file_location('bipia',p)\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\nsource=pathlib.Path('.local/eval-sources/bipia')\na=m.canonical_bytes(m.build_cases(source))\nb=m.canonical_bytes(m.build_cases(source))\nassert a == b\nassert m.digest(a) == '${metadata.source.sha256}'\nwith tempfile.TemporaryDirectory() as tmp:\n d=pathlib.Path(tmp)\n name='benchmark/email/train.jsonl'\n target=d/name\n target.parent.mkdir(parents=True)\n target.write_bytes((source/name).read_bytes()+b'corruption')\n try:\n  m.read_source(d,name)\n except ValueError as error:\n  assert 'SHA-256 mismatch' in str(error)\n else:\n  raise AssertionError('tampered source accepted')\n`;
    const result = spawnSync("python3", ["-B", "-c", code], { cwd: root, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, failures: result.status === 0 ? "" : result.stderr }).toEqual({ status: 0, failures: "" });
  });
});
