/** Deterministic stress controls and transformation-eligible existing rows. No API calls. */
import { readFileSync,writeFileSync } from "node:fs";
import { decodedPreviewV1 } from "../../src/techniques.js";
import { sha256 } from "../src/strategies.js";
import type { DatasetManifest } from "../src/types.js";
const sourceIds=["pids-obfuscated-v1","pids-hard-benign-public-v1","notinject-benign-339"];
function save(id:string,rows:unknown[],provenance:unknown){
 const raw=rows.map(x=>JSON.stringify(x)).join("\n")+"\n",path=`evals/private/sources/${id}.jsonl`;
 writeFileSync(path,raw);
 writeFileSync(`evals/datasets/${id}.json`,JSON.stringify({schemaVersion:"security-eval-dataset/v1",id,revision:`sha256:${sha256(raw)}`,source:{path,sha256:sha256(raw),format:"canonical-jsonl",visibility:"public"},expectedCases:rows.length,annotationKey:"prompt_injection_attempt",positiveValues:["injection"],negativeValues:["benign"],provenance},null,2)+"\n");
 console.log(id,rows.length,sha256(raw));
}
const eligible:unknown[]=[];
const controls:unknown[]=[];
const excludedControls:Record<string,number>={};
for(const sourceId of sourceIds){
 const manifest=JSON.parse(readFileSync(`evals/datasets/${sourceId}.json`,"utf8")) as DatasetManifest;
 const raw=readFileSync(manifest.source.path,"utf8");if(sha256(raw)!==manifest.source.sha256)throw Error("Source mismatch");
 // Use normalized loader for historical NotInject shape.
 const {loadDataset}=await import("../src/datasets.js");
 const cases=loadDataset(manifest);
 for(const item of cases){
  const source=item.turns.at(-1)!.text;
  const provenance={parent_dataset:sourceId,parent_revision:manifest.revision,parent_case:item.id,...item.facets};
  if(decodedPreviewV1(source)!==source){
   eligible.push({id:`enc-${sha256(sourceId+"/"+item.id).slice(0,24)}`,label:item.annotations.prompt_injection_attempt,turns:item.turns,text_sha256:item.textSha256,facets:provenance});
  }
  // Every208 external PIDS benign source plus339 NotInject source: no score-driven selection.
  if(sourceId==="notinject-benign-339" || sourceId==="pids-hard-benign-public-v1" && item.facets.source_type==="real"){
   for(const encoding of ["base64","unicode_escape"]){
    const transformed=encoding==="base64"?Buffer.from(source).toString("base64"):source.replace(/[A-Za-z]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,"0")}`);
    if(decodedPreviewV1(transformed)===transformed){const key=sourceId+"/"+encoding;excludedControls[key]=(excludedControls[key]??0)+1;continue;}
    controls.push({id:`ctrl-${sha256(sourceId+"/"+item.id+"/"+encoding).slice(0,24)}`,label:"benign",turns:[{id:"source",role:"document",origin:"external",text:transformed}],text_sha256:sha256(transformed),facets:{...provenance,encoding,parent_family:sourceId+"/"+item.id}});
   }
  }
 }
}
const provenance={sourceDatasets:sourceIds,license:"Inherited public source terms; research/noncommercial restrictions retained. No withheld LMSYS rows.",selection:"Deterministic byte-level transform eligibility, never model scores. Original PIDS/NotInject full-text detections reused for parent comparison, not purchased again.",labelMeaning:"Original source labels preserved through reversible encoding; attempts are not compromise. Encoded benign controls and source families correlated."};
save("encoding-eligible-existing-v1",eligible,provenance);
save("encoding-benign-controls-v1",controls,{...provenance,excludedControls,selection:"208 external PIDS benign sources and339 NotInject sources considered for Base64 and letter-wise Unicode escapes; include only transformations yielding a nonidentical decoder preview (fixed size/text-validity rules). Exclusion counts recorded. Synthetic probes, not naturally observed encodings."});
