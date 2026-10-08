"""Offline, hash-verified import of the released LongPIBench synthetic benchmark.

Uses the inspected, pinned upstream pure prompt builder. Does not run any model,
LaTeX, supplied code, or example instruction. Sources remain ignored.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODE = ROOT / 'evals/private/upstream/longpibench'
DATA = ROOT / 'evals/private/upstream/longpibench-data'
CODE_REV = 'c7b80114ae56f65fb8019ec82afdb3df91e4ed65'
DATA_REV = 'cdfdfdba8838911ec3d120d5bbf584c0afb280f2'
CODE_HASHES = {
 'benchmark.py':'cf7f06e36dea747b038f35af9fcaf8bfacd756bf1ac21c9437fb77a687c429c3',
 'attacks.py':'9edfc687950befac7f1fd22e50f0231c7d42f24caf71d6b58312886740aa2ea8',
 'prompts.py':'d75883ce33a94f589793ee4509843bf2657681a7b268be1b1c4a0d25c2851755',
 'data.py':'55856653925b5dba4c11e4c8801e301a11b83c23134263659ce67c10c23748cf',
}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def verify():
 for name, expected in CODE_HASHES.items():
  if sha((CODE/'longpibench'/name).read_bytes()) != expected: raise ValueError('Upstream code hash mismatch')
 checksums=(DATA/'checksums.sha256').read_bytes()
 if sha(checksums) != 'a9ff2d010ebe5349098707e6fbb9d028922672bdf84ce87869c8bdd46dbcdefe': raise ValueError('Upstream checksums mismatch')
 for line in checksums.decode().splitlines():
  expected,name=line.split(maxsplit=1)
  path=DATA/name
  if not path.resolve().is_relative_to(DATA.resolve()) or sha(path.read_bytes()) != expected: raise ValueError('Upstream data mismatch')

def main():
 verify()
 sys.path.insert(0,str(CODE))
 from longpibench import benchmark
 benchmark.DATA_ROOT=DATA
 for domain in benchmark.SUITES:
  cases=[]
  for ordinal in range(100):
   for attack in ('no','naive','combine','authority_spoof'):
    example=benchmark.prepare_example(domain,ordinal,attack=attack)
    turns=[{'id':'task','role':'user','origin':'operator','text':example.system_prompt},
           {'id':'source','role':'document','origin':'external','text':example.data_prompt}]
    identity=sha(f'{domain}/{ordinal}/{attack}/{example.goal}/{example.position}'.encode())
    cases.append({'id':'lp-'+identity[:24], 'label':'benign' if attack=='no' else 'injection',
     'turns':turns,'text_sha256':sha('\n'.join(x['text'] for x in turns).encode()),
     'facets':{'domain':domain,'document_family':f'{domain}/{ordinal}','source_item':ordinal,'attack':attack,
      'goal':example.goal,'position':example.position,'source':'LongPIBench synthetic','split':'research-evaluation',
      'source_chars':len(example.data_prompt),'source_words':len(example.data_prompt.split())}})
  raw=''.join(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n' for x in cases).encode()
  ident=f'longpibench-{domain}-default-v1'; path=f'evals/private/sources/{ident}.jsonl'
  (ROOT/path).write_bytes(raw)
  manifest={'schemaVersion':'security-eval-dataset/v1','id':ident,'revision':'sha256:'+sha(raw),
   'source':{'path':path,'sha256':sha(raw),'format':'canonical-jsonl','visibility':'public'},
   'expectedCases':400,'annotationKey':'prompt_injection_attempt','positiveValues':['injection'],'negativeValues':['benign'],
   'provenance':{'repository':'https://github.com/liu00222/LongPIBench','commit':CODE_REV,
    'dataset':'https://huggingface.co/datasets/RainWatcher/LongPIBench','datasetRevision':DATA_REV,
    'license':'MIT; released synthetic sources only, no real-world subset',
    'selection':'All100 source documents per domain; exact upstream clean, naive, combine, authority_spoof with default goal and position. Preserve paired document families. No model-driven filtering.',
    'labelMeaning':'Constructed injection attempts, not measured downstream success. Four variants per document are correlated; bootstrap or split at document-family level. All templates shared across documents.',
    'adapterCodeHashes':CODE_HASHES}}
  (ROOT/f'evals/datasets/{ident}.json').write_text(json.dumps(manifest,indent=2)+'\n')
  lengths=sorted(x['facets']['source_chars'] for x in cases)
  print(ident,len(cases),sha(raw),'chars min/median/max',lengths[0],lengths[len(lengths)//2],lengths[-1])
if __name__=='__main__': main()
