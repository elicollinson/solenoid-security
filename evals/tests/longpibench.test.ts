import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { loadDataset, selectTestCases } from "../src/datasets.js";
import type { DatasetManifest, EvalTest } from "../src/types.js";
for (const domain of ["paper", "resume", "email", "code"]) {
 const manifest = JSON.parse(readFileSync(`evals/datasets/longpibench-${domain}-default-v1.json`, "utf8")) as DatasetManifest;
 (existsSync(manifest.source.path) ? test : test.skip)(`LongPIBench ${domain} preserves100 clean and300 attacks in100 families`, () => {
  const cases=loadDataset(manifest);
  const testSpec: EvalTest={id:"check", datasetId:manifest.id,datasetRevision:manifest.revision,annotationKey:manifest.annotationKey,caseSelector:"positive",metrics:[]};
  expect(selectTestCases(cases,manifest,testSpec)).toHaveLength(300);
  expect(selectTestCases(cases,manifest,{...testSpec,caseSelector:"negative"})).toHaveLength(100);
  const families=new Map<string, typeof cases>();
  for(const item of cases){const key=String(item.facets.document_family); families.set(key,[...(families.get(key)??[]),item]);expect(item.turns.map(t=>t.origin)).toEqual(["operator","external"]);}
  expect(families.size).toBe(100);
  for(const family of families.values()){
   expect(new Set(family.map(c=>c.facets.attack)).size).toBe(4);
   expect(new Set(family.map(c=>c.turns[0]!.text)).size).toBe(1);
   expect(new Set(family.map(c=>c.turns[1]!.text)).size).toBe(4);
  }
 });
}

const emailManifest = JSON.parse(readFileSync('evals/datasets/longpibench-email-default-v1.json','utf8')) as DatasetManifest;
(existsSync(emailManifest.source.path) ? test : test.skip)('Local long-email tranche retains whole families and both labels', async () => {
 const {validateMatrixSuite}=await import('../src/researchMatrix.js');
 const {segmentCase}=await import('../src/strategies.js');
 const suite=validateMatrixSuite(JSON.parse(readFileSync('evals/suites/prompt-injection-lmstudio-long-email-thinking1024-v1.json','utf8')),[],[]);
 const selected=selectTestCases(loadDataset(emailManifest),emailManifest,suite.tests[0]!).slice(0,80);
 expect(selected.filter(c=>c.annotations[emailManifest.annotationKey]==='benign')).toHaveLength(20);
 expect(selected.filter(c=>c.annotations[emailManifest.annotationKey]==='injection')).toHaveLength(60);
 const families=new Map<string,typeof selected>();
 for(const c of selected){const f=String(c.facets.document_family);families.set(f,[...(families.get(f)??[]),c]);}
 expect(families.size).toBe(20);
 for(const siblings of families.values())expect(new Set(siblings.map(c=>c.facets.attack)).size).toBe(4);
 for(const c of selected){
  const full=segmentCase(c,suite.inputStrategies.full!);
  const windows=segmentCase(c,suite.inputStrategies.preserve512!);
  expect(full).toHaveLength(1);
  expect(windows.length).toBeGreaterThan(1);
  expect(windows.some(w=>w.text===full[0]!.text)).toBe(false);
 }
 const prior=Object.assign({},...['prompt-injection-lmstudio-thinking1024-v1','prompt-injection-lmstudio-available-panel-thinking1024-v1'].map(id=>JSON.parse(readFileSync(`evals/suites/${id}.json`,'utf8')).engines));
 expect(Object.keys(suite.engines)).toHaveLength(5);
 for(const [key,engine] of Object.entries(suite.engines)){
  expect(engine).toEqual(prior[key]);
  expect(new Set(suite.conditions.filter(c=>c.engine===key).map(c=>c.inputStrategy))).toEqual(new Set(['full','preserve512']));
 }
});
