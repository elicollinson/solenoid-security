"""Exact upstream paper injections at earlier positions; clean sources reused offline."""
import importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('lp_import',ROOT/'evals/scripts/import-longpibench.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
mod.verify();sys.path.insert(0,str(mod.CODE))
from longpibench import benchmark
benchmark.DATA_ROOT=mod.DATA
for position in ['abstract','method']:
 cases=[]
 for ordinal in range(100):
  for attack in ['naive','combine','authority_spoof']:
   e=benchmark.prepare_example('paper',ordinal,attack=attack,position=position)
   turns=[{'id':'task','role':'user','origin':'operator','text':e.system_prompt},{'id':'source','role':'document','origin':'external','text':e.data_prompt}]
   cases.append({'id':'lp-'+mod.sha(f'paper/{ordinal}/{attack}/{e.goal}/{position}'.encode())[:24],'label':'injection','turns':turns,'text_sha256':mod.sha('\n'.join(t['text'] for t in turns).encode()),'facets':{'domain':'paper','document_family':f'paper/{ordinal}','source_item':ordinal,'attack':attack,'goal':e.goal,'position':position,'source':'LongPIBench synthetic','split':'position-stress','parent_default_case':'lp-'+mod.sha(f'paper/{ordinal}/{attack}/{e.goal}/conclusion'.encode())[:24]}})
 ident=f'longpibench-paper-{position}-v1';path=f'evals/private/sources/{ident}.jsonl';raw=''.join(json.dumps(c,ensure_ascii=False,sort_keys=True)+'\n' for c in cases).encode();(ROOT/path).write_bytes(raw)
 manifest={'schemaVersion':'security-eval-dataset/v1','id':ident,'revision':'sha256:'+mod.sha(raw),'source':{'path':path,'sha256':mod.sha(raw),'format':'canonical-jsonl','visibility':'public'},'expectedCases':300,'annotationKey':'prompt_injection_attempt','positiveValues':['injection'],'negativeValues':['benign'],'provenance':{'repository':'https://github.com/liu00222/LongPIBench','commit':mod.CODE_REV,'datasetRevision':mod.DATA_REV,'license':'MIT synthetic data','selection':'All100 papers,3 exact upstream default-goal attack templates, appended to specified section using pinned builder. No selection by detection outcome. Reuse existing identical clean source predictions.','labelMeaning':'Constructed attack attempts, not compromise. Paired positions on same100 document families; not independent from default-position cohort.','builderHashes':mod.CODE_HASHES}}
 (ROOT/f'evals/datasets/{ident}.json').write_text(json.dumps(manifest,indent=2)+'\n');print(ident,len(cases),mod.sha(raw))
