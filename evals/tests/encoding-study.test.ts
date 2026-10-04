import { expect,test } from "bun:test";
import { existsSync,readFileSync } from "node:fs";
import { loadDataset } from "../src/datasets.js";
import { decodedPreviewV1 } from "../../src/techniques.js";
import type { DatasetManifest } from "../src/types.js";
for(const [id,count,positive] of [["encoding-eligible-existing-v1",229,191],["encoding-benign-controls-v1",969,0]] as const){
 const m=JSON.parse(readFileSync(`evals/datasets/${id}.json`,"utf8")) as DatasetManifest;
 (existsSync(m.source.path)?test:test.skip)(`${id} only purchases changed inputs and preserves parents`,()=>{
  const rows=loadDataset(m);expect(rows.length).toBe(count);
  expect(rows.filter(r=>r.annotations.prompt_injection_attempt==="injection").length).toBe(positive);
  for(const r of rows){expect(decodedPreviewV1(r.turns.at(-1)!.text)).not.toBe(r.turns.at(-1)!.text);expect(r.facets.parent_case).toBeString();expect(r.facets.parent_revision).toMatch(/^sha256:/);}
 });
}
