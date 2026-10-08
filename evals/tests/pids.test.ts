import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadDataset } from "../src/datasets.js";
import type { DatasetManifest } from "../src/types.js";

for (const [name, count, positive] of [["hard-benign-public", 808, false], ["obfuscated", 405, true]] as const) {
  const manifest = JSON.parse(readFileSync(`evals/datasets/pids-${name}-v1.json`, "utf8")) as DatasetManifest;
  test(`PIDS ${name} provenance is pinned`, () => {
    expect(manifest.expectedCases).toBe(count);
    expect(manifest.revision).toBe(`sha256:${manifest.source.sha256}`);
  });
  (existsSync(manifest.source.path) ? test : test.skip)(`PIDS ${name} retains labels and family metadata`, () => {
    const cases = loadDataset(manifest);
    expect(cases).toHaveLength(count);
    for (const item of cases) {
      expect(item.annotations.prompt_injection_attempt).toBe(positive ? "injection" : "benign");
      expect(item.turns[0]?.text.trim().length).toBeGreaterThan(0);
      expect(item.turns[0]?.id).toBe("source");
      expect(item.facets.parent_seed_id).toBeString();
      expect(item.facets.source).not.toMatch(/^lmsys/);
    }
  });
}

(existsSync("evals/private/upstream/pids-bench/data/pids_bench_v3/eval_subsets/hard_benign_test.csv") ? test : test.skip)("PIDS import is deterministic and rejects tampering", () => {
  const code = `import importlib.util,pathlib,tempfile\ns=importlib.util.spec_from_file_location('pids','evals/scripts/import-pids.py')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\np=pathlib.Path('evals/private/upstream/pids-bench/data/pids_bench_v3/eval_subsets')\nassert m.build(p,'hard-benign-public')==m.build(p,'hard-benign-public')\nwith tempfile.TemporaryDirectory() as d:\n q=pathlib.Path(d);(q/'hard_benign_test.csv').write_text('tampered')\n try: m.build(q,'hard-benign-public')\n except ValueError: pass\n else: raise AssertionError('tampered source accepted')\n`;
  const result = spawnSync("python3", ["-B", "-c", code], { encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
});
