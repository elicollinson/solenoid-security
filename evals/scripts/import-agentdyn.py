"""Import observed injected tool exposures and clean tool text from frozen AgentDyn logs.

Offline only: never execute the upstream agent tools. Tool strings and fake
credentials are benchmark data. Do not interpret attacker success as a label.
"""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
UP=ROOT/'evals/private/upstream/agentdyn'
COMMIT='5353cf7615b135cace8d07c8f12dac53a16b6db3'
PIPELINE='gpt-5.1-2025-11-13'
# Restrict clean controls to source-bearing tools, excluding mutation/status APIs.
TOOLS={'read_file','browse_webpage','get_shopping_linked_unread_emails','get_github_linked_unread_emails','get_unread_emails','get_received_emails','get_shopping_linked_received_emails','search_emails','get_sent_emails','search_product','get_invoice','view_order_history','view_available_discounts','get_github_repository_information'}
def sha(b):return hashlib.sha256(b).hexdigest()
def norm(s):return re.sub(r'\s+',' ',s).strip()
def text(message):
 c=message['content']
 if isinstance(c,str):return c
 if any(x['type']!='text' for x in c):raise ValueError('Nontext source')
 return '\n'.join(x['content'] for x in c)
def main():
 if subprocess.check_output(['git','-C',str(UP),'rev-parse','HEAD'],text=True).strip()!=COMMIT:raise ValueError('Upstream commit mismatch')
 for domain in ['shopping','github','dailylife']:
  rows={};source_files=[];counts={'logs':0,'exposed_turns':0,'clean_turns':0,'unexposed_attack_logs':0,'excluded_clean_status_turns':0}
  paths=sorted((UP/'runs'/PIPELINE/domain).glob('user_task_*/*/*.json'))
  for path in paths:
   if path.parent.name not in ['none','important_instructions']:continue
   raw=path.read_bytes();x=json.loads(raw);attack=x['attack_type']; clean=attack is None
   if not clean and attack!='important_instructions':raise ValueError('Unexpected attack')
   counts['logs']+=1; source_files.append({'path':str(path.relative_to(UP)),'sha256':sha(raw)})
   task='\n'.join(text(m) for m in x['messages'] if m['role']=='user')
   if not task.strip():raise ValueError('Missing trusted user task')
   payloads=[norm(a) for a in (x['injections'] or {}).values() if a.strip()]
   exposed=False
   for idx,m in enumerate(x['messages']):
    if m['role']!='tool':continue
    source=text(m);tool=m.get('tool_call',{}).get('function','unknown')
    if not source.strip():continue
    matches=[a for a in payloads if a in norm(source)]
    if not clean and not matches:continue
    if clean and tool not in TOOLS:counts['excluded_clean_status_turns']+=1;continue
    counts['clean_turns' if clean else 'exposed_turns']+=1;exposed|=not clean
    identity=sha((task+'\0'+source).encode());label='benign' if clean else 'injection'
    if identity in rows:
     if rows[identity]['label']!=label:raise ValueError('Conflicting source labels')
     rows[identity]['facets']['source_log_refs'].append(str(path.relative_to(UP))+':'+str(idx))
     continue
    turns=[{'id':'task','role':'user','origin':'operator','text':task},{'id':'source','role':'tool','origin':'external','text':source}]
    rows[identity]={'id':'ad-'+identity[:24],'label':label,'turns':turns,'text_sha256':sha('\n'.join(t['text'] for t in turns).encode()),
     'facets':{'domain':domain,'task_family':x['user_task_id'],'source_pipeline':PIPELINE,'tool':tool,'attack':'none' if clean else attack,
      'source_log_refs':[str(path.relative_to(UP))+':'+str(idx)],'source_chars':len(source),
      'source':'AgentDyn observed tool exposures','match_rule':'whitespace-collapsed substring of recorded injected payload; retain original source text'}}
   if not clean and not exposed:counts['unexposed_attack_logs']+=1
  cases=list(rows.values());raw=''.join(json.dumps(c,sort_keys=True,ensure_ascii=False)+'\n' for c in cases).encode()
  ident=f'agentdyn-{domain}-exposures-v1';path=f'evals/private/sources/{ident}.jsonl';(ROOT/path).write_bytes(raw)
  audit={'commit':COMMIT,'pipeline':PIPELINE,'counts':counts,'sourceFiles':source_files}
  audit_path=f'evals/private/sources/{ident}-provenance.json';audit_raw=(json.dumps(audit,indent=2)+'\n').encode();(ROOT/audit_path).write_bytes(audit_raw)
  manifest={'schemaVersion':'security-eval-dataset/v1','id':ident,'revision':'sha256:'+sha(raw),'source':{'path':path,'sha256':sha(raw),'format':'canonical-jsonl','visibility':'public'},'expectedCases':len(cases),'annotationKey':'prompt_injection_attempt','positiveValues':['injection'],'negativeValues':['benign'],
   'provenance':{'repository':'https://github.com/SaFo-Lab/AgentDyn','commit':COMMIT,'license':'MIT','pipeline':PIPELINE,'auditPath':audit_path,'auditSha256':sha(audit_raw),'counts':counts,
    'selection':'All observed tool exposures containing a whitespace-normalized recorded important_instructions payload, plus source-bearing tool turns from unmodified clean trajectories. Deduplicate exact task/source pairs. No model-score or outcome filtering. Frozen historical trajectory model is source provenance, not a detector evaluated here.',
    'labelMeaning':'Detection of observed injected tool content versus clean environment source text. Unexposed planned attacks excluded, other turns in attacked trajectories not labeled benign. Trajectory/task families and attack templates are correlated. Does not reproduce560-case end-to-end AgentDyn evaluation.',
    'cleanToolAllowlist':sorted(TOOLS)}}
  (ROOT/f'evals/datasets/{ident}.json').write_text(json.dumps(manifest,indent=2)+'\n')
  print(ident,len(cases),sum(c['label']=='injection' for c in cases),counts)
if __name__=='__main__':main()
