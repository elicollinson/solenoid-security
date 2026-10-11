/** No inference: compare actual preserved-window coverage of existing frozen domains. */
import {readFileSync,writeFileSync} from 'node:fs';
import {loadDataset} from '../../src/datasets.ts';
import {segmentCase,sha256} from '../../src/strategies.ts';
const suitePath='evals/suites/prompt-injection-lmstudio-available-panel-thinking1024-v1.json';
const suiteText=readFileSync(suitePath,'utf8'),suite=JSON.parse(suiteText);
const rows=[];
for(const domain of ['paper','code','email','resume']){
 const manifestPath=`evals/datasets/longpibench-${domain}-default-v1.json`;
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 const all=loadDataset(manifest,process.cwd());
 for(const selected of [all.slice(0,80),all]){
  const details=selected.map(c=>{
   const full=segmentCase(c,suite.inputStrategies.full);
   if(full.length!==1)throw Error('Unexpected source selection');
   const windows=segmentCase(c,suite.inputStrategies.preserve512);
   let covered=0;
   const coverageOnly=windows.filter(w=>{if(w.endWord===undefined)throw Error('Missing word boundaries');if(w.endWord<=covered)return false;covered=w.endWord;return true});
   return {caseId:c.id,family:c.facets.document_family,attack:c.facets.attack,words:full[0]!.text.trim().split(/\s+/).length,
    fullInputSha256:full[0]!.textSha256,fullInputRetained:windows.some(w=>w.textSha256===full[0]!.textSha256),
    windowHashes:windows.map(w=>w.textSha256),coverageOnlyHashes:coverageOnly.map(w=>w.textSha256)};
  });
  rows.push({domain,datasetRevision:manifest.revision,cases:details.length,families:new Set(details.map(c=>c.family)).size,
   genuinelyShortenedCases:details.filter(c=>!c.fullInputRetained).length,
   fullRetainedWithExtraTail:details.filter(c=>c.fullInputRetained&&c.windowHashes.length>1).length,
   identicalSingleInput:details.filter(c=>c.fullInputRetained&&c.windowHashes.length===1).length,
   logicalWindows:details.reduce((n,c)=>n+c.windowHashes.length,0),
   distinctWindowInputs:new Set(details.flatMap(c=>c.windowHashes)).size,
   coverageOnlyWindows:details.reduce((n,c)=>n+c.coverageOnlyHashes.length,0),
   distinctCoverageOnlyInputs:new Set(details.flatMap(c=>c.coverageOnlyHashes)).size,
   removedRedundantTails:details.reduce((n,c)=>n+c.windowHashes.length-c.coverageOnlyHashes.length,0),details});
 }
}
writeFileSync('evals/runs/lmstudio-available-panel-2026-10-04/domain-window-coverage.json',JSON.stringify({generatedAt:new Date().toISOString(),suitePath,suiteSha256:sha256(suiteText),note:'Existing frozen inputs only; first 20 ordered families and full cohorts. No model-output-driven case selection or new inference.',rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({details,...summary})=>summary),null,2));
