"""Markdown tables from sweep-results.json (aggregates only). Usage: python3 tables.py sweep-results.json"""
import json,sys
d=json.load(open(sys.argv[1])); cols=d['cells']['columns']; C=[dict(zip(cols,r)) for r in d['cells']['rows']]
def get(m,k,t,rule='max05',pol='strict',cov='raw'):
  for c in C:
    if c['model']==m and c['key']==k and c['test']==t and c['rule']==rule and c['policy']==pol and c['coverage']==cov: return c
tests=[x['id'] for x in d['tests']]; keys=['w064s064','w064s032','w064s016','w128s128','w128s064','w128s032','w256s256','w256s128','w256s064','w512s512','w512s256','w512s128','w512s384']
lab=lambda k:f"{int(k[1:4])}/{int(k[5:])}"
f=lambda x:'–' if x is None else f"{x:.3f}"
for m in ['flash','mini6']:
  print(f"\n#### {m}: max > 0.5, strict abstention, per cohort\n")
  print("| Cohort | Config (words/stride) | n joint | BA full → windows | gained / lost | FA added / removed | McNemar p | case abst. | window abst. | windows/case | cost × full | coverage-only BA | ignore-invalid BA | cascade BA (cost ×) |")
  print("|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
  for t in tests:
    for k in keys:
      c=get(m,k,t)
      if not c: continue
      cv=get(m,k,t,cov='coverage'); ii=get(m,k,t,pol='ignoreInvalid')
      print(f"| {t} | {lab(k)} | {c['vsFull.jointlyValid']} | {f(c['vsFull.fullBA'])} → {f(c['vsFull.windowBA'])} | +{c['vsFull.detectionsGained']} / −{c['vsFull.detectionsLost']} | +{c['vsFull.falseAlarmsAdded']} / −{c['vsFull.falseAlarmsRemoved']} | {c['vsFull.mcnemarP']:.3g} | {c['caseAbstentions']}/{c['n']} | {c['windowAbstentionRate']*100:.2f}% | {c['windowsPerCase']:.1f} | {c['costVsFull']:.2f} | {f(cv['vsFull.windowBA'])} | {f(ii['vsFull.windowBA'])} | {f(c['cascade.windowBA'])} ({c['cascade.costVsFull']:.2f}) |")
def summ(m,rule,pol,cov,scope): return {r['key']:r for r in d['summaries'][f"{m}|{rule}|{pol}|{cov}|{scope}"]}
for m in ['flash','mini6']:
  print(f"\n#### {m}: mean per-cohort BA (paired vs full on jointly valid cases), max > 0.5\n")
  print("| Config | scope | full | windows (strict) | coverage-only | ignore-invalid | cascade | gained/lost | FA added | mean case abst. | cost × full |")
  print("|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|")
  for scope in ['long3','short5','all8']:
    S=summ(m,'max05','strict','raw',scope); CV=summ(m,'max05','strict','coverage',scope); II=summ(m,'max05','ignoreInvalid','raw',scope)
    for k in keys:
      if k not in S: continue
      r=S[k]; print(f"| {lab(k)} | {scope} | {f(r['meanFullBA'])} | {f(r['meanWindowBA'])} | {f(CV[k]['meanWindowBA'])} | {f(II[k]['meanWindowBA'])} | {f(r['meanCascadeBA'])} | +{r['gained']}/−{r['lost']} | {r['faAdded']} | {r['meanCaseAbstentionRate']*100:.1f}% | {r['meanCostVsFull']:.2f} |")
print("\n#### Flash: aggregation rules, mean per-cohort BA (strict, raw windows; FA added in brackets)\n")
rules=['max05','max07','max09','top2mean05','k2over05','frac25','frac50']
for scope in ['long3','short5']:
  print(f"\n{scope}:\n\n| Config | "+" | ".join(rules)+" |\n|---|"+"---:|"*len(rules))
  for k in keys:
    row=[]
    for rule in rules:
      S=summ('flash',rule,'strict','raw',scope)
      row.append(f"{S[k]['meanWindowBA']:.3f} ({S[k]['faAdded']})" if k in S else '–')
    print(f"| {lab(k)} | "+" | ".join(row)+" |")
print("\n#### Full-text references on the same cases (BA)\n")
print("| Cohort | n | LLaDA flash full | LLaDA mini 6-bit full | Gemma26 Q8 | Qwen3.8 Q8 |\n|---|---:|---:|---:|---:|---:|")
for t in d['tests']:
  g=lambda m:[r for r in d['full']+d['baselines'] if r['model']==m and r['test']==t['id']][0]['ba']
  print(f"| {t['id']} | {t['cases']} | {f(g('flash'))} | {f(g('mini6'))} | {f(g('gemma26-q8'))} | {f(g('qwen38-q8gguf'))} |")
