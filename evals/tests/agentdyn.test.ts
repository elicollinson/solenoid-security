import { expect,test } from "bun:test";
import { readFileSync,existsSync } from "node:fs";
import { loadDataset } from "../src/datasets.js";
import { sha256 } from "../src/strategies.js";
import type { DatasetManifest } from "../src/types.js";
for(const [domain,positives,benign] of [["shopping",117,66],["github",190,47],["dailylife",342,69]] as const){
 const manifest=JSON.parse(readFileSync(`evals/datasets/agentdyn-${domain}-exposures-v1.json`,"utf8")) as DatasetManifest & {provenance:{auditPath:string;auditSha256:string;cleanToolAllowlist:string[]}};
 (existsSync(manifest.source.path)?test:test.skip)(`AgentDyn ${domain} retains only exposed positives and source-bearing clean controls`,()=>{
  const cases=loadDataset(manifest);
  expect(cases.filter(x=>x.annotations.prompt_injection_attempt==="injection")).toHaveLength(positives);
  expect(cases.filter(x=>x.annotations.prompt_injection_attempt==="benign")).toHaveLength(benign);
  expect(new Set(cases.map(x=>sha256(x.turns.map(t=>t.text).join("\0"))))).toHaveProperty("size",cases.length);
  expect(sha256(readFileSync(manifest.provenance.auditPath,"utf8"))).toBe(manifest.provenance.auditSha256);
  for(const item of cases){
   expect(item.turns.map(t=>t.origin)).toEqual(["operator","external"]);
   expect(item.facets.task_family).toMatch(/^user_task_\d+$/);
   if(item.annotations.prompt_injection_attempt==="benign")expect(manifest.provenance.cleanToolAllowlist).toContain(item.facets.tool);
   expect(item.facets.source_log_refs).toBeArray();
  }
 });
}
