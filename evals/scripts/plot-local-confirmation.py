"""Plot completed local comparisons from audited snapshots, without new inference."""
import hashlib,json,os
from pathlib import Path
os.environ.setdefault('MPLCONFIGDIR','/tmp/solenoid-matplotlib-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'evals/reports/figures';OUT.mkdir(exist_ok=True)
BASE=ROOT/'evals/runs/lmstudio-thinking1024-2026-10-03'
def read(path): return json.loads(path.read_text())
def events(path): return [json.loads(x) for x in (ROOT/path).read_text().split('\n') if x]
def verify(path,sha,n=None):
 b=(ROOT/path).read_bytes();assert hashlib.sha256(b if n is None else b[:n]).hexdigest()==sha,path
rows=[]
for model,probe in [('E2B','e2b-thinking1024'),('E4B','e4b')]:
 original=read(BASE/f'lmstudio-{model.lower()}-paper-window-first20-2026-10-03.json')
 numeric=read(ROOT/f'evals/runs/lmstudio-score-counterfactual-{probe}-preserve-2026-10-03/window-score-diagnostic.json')
 for s in original['sources'].values():verify(s['path'],s['capturedSha256'],s['capturedBytes'])
 for key in ['full','window']:verify(numeric['sources'][key],numeric['sources'][key+'Sha256'])
 for cohort,data,negative in [('Original papers',original,'no'),('Numeric probe',numeric,'numeric_fact')]:
  attacks=[r for r in data['rows'] if r['attack']!=negative];clean=[r for r in data['rows'] if r['attack']==negative]
  count=lambda rs,k:sum(r[k]>.5 for r in rs)
  source={k:(data['sources'][k]['path'] if cohort=='Original papers' else data['sources'][k]) for k in ['full','window']}
  selected={r['caseId'] for r in data['rows']}
  native={k:[e['value'] for e in events(p) if e['type']=='observation' and e['caseId'] in selected] for k,p in source.items()}
  unique={e['value']['inputSha256']:e['value'] for e in events(source['window']) if e['type'] in ['observation','derived_observation'] and e['caseId'] in selected}
  full_time=sum(o['durationMs'] for o in native['full']);window_time=sum(o['durationMs'] for o in unique.values())
  rows.append(dict(model=model,cohort=cohort,attacks=len(attacks),clean=len(clean),full=count(attacks,'fullScore'),window=count(attacks,'windowScore'),coverage=count(attacks,'coverageScore'),fullFP=count(clean,'fullScore'),windowFP=count(clean,'windowScore'),gains=sum(r['fullScore']<=.5<r['windowScore'] for r in attacks),losses=sum(r['windowScore']<=.5<r['fullScore'] for r in attacks),fullRecordedMs=full_time,distinctWindowRecordedMs=window_time,windowTimeRatio=window_time/full_time,source=source))
assert [(r['full'],r['window'],r['coverage']) for r in rows]==[(37,47,45),(34,34,30),(43,53,52),(36,45,45)]
(OUT/'local-small-model-confirmation-data.json').write_text(json.dumps(rows,indent=2)+'\n')
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'savefig.facecolor':'white'})
fig,axs=plt.subplots(2,2,figsize=(12,8),gridspec_kw={'height_ratios':[1.15,1]})
colors=['#64748b','#007a9b','#d78b24']
for ax,cohort in zip(axs[0],['Original papers','Numeric probe']):
 subset=[r for r in rows if r['cohort']==cohort];x=np.arange(2)
 for j,(key,label) in enumerate([('full','Full input'),('window','512-word windows'),('coverage','Without redundant tails')]):
  heights=[r[key]/r['attacks']*100 for r in subset]
  ax.bar(x+(j-1)*.24,heights,.22,color=colors[j],label=label)
  for i,r in enumerate(subset):ax.text(x[i]+(j-1)*.24,heights[i]+2,f"{r[key]}/{r['attacks']}",ha='center',fontsize=9)
 ax.set_xticks(x,['Gemma 4 E2B','Gemma 4 E4B']);ax.set_ylim(0,105);ax.set_yticks([0,25,50,75,100]);ax.set_ylabel('Attacks detected (%)');ax.set_title(cohort+('\n20 paper families' if cohort=='Original papers' else '\n6 shared paper families'),loc='left',fontweight='bold');ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
fig.legend(*axs[0,0].get_legend_handles_labels(),frameon=False,fontsize=10,loc='upper left',bbox_to_anchor=(.065,.93),ncol=3)
ax=axs[1,0];x=np.arange(4)
ax.bar(x,[r['gains'] for r in rows],color='#007a9b',label='New detections');ax.bar(x,[-r['losses'] for r in rows],color='#b4533c',label='New misses')
for i,r in enumerate(rows):
 ax.text(i,r['gains']+.3,f"+{r['gains']}",ha='center')
 if r['losses']:ax.text(i,-r['losses']-.4,f"−{r['losses']}",ha='center',va='top')
ax.axhline(0,color='#555',lw=.8);ax.set_xticks(x,[r['model']+'\n'+('Original' if r['cohort']=='Original papers' else 'Numeric') for r in rows]);ax.set_ylim(-7,14);ax.set_title('Paired attack changes: full → windows',loc='left',fontweight='bold');ax.set_ylabel('Number of cases');ax.legend(frameon=False,fontsize=8,loc='upper right')
ax=axs[1,1];ax.axis('off');ax.set_title('False alarms and recorded request time',loc='left',fontweight='bold',pad=12)
table=ax.table(cellText=[[r['model']+' / '+('original' if r['cohort']=='Original papers' else 'numeric'),f"{r['fullFP']}/{r['clean']} → {r['windowFP']}/{r['clean']}",f"{r['windowTimeRatio']:.2f}×"] for r in rows],colLabels=['Model / cohort','Clean flags','Time ratio'],loc='upper center',cellLoc='center',colWidths=[.42,.32,.26],bbox=[0,.25,1,.7]);table.auto_set_font_size(False);table.set_fontsize(10)
for (r,c),cell in table.get_celld().items():
 cell.set_edgecolor('#dbe1e8')
 if r==0:cell.set_facecolor('#eef3f7');cell.set_text_props(weight='bold')
ax.text(0,.09,'Time: distinct window inputs / full inputs.\nCached-source work counted once; repeated papers aid reuse.',transform=ax.transAxes,fontsize=9,color='#475569')
fig.suptitle('Chunking gains depend on the model and attack construction',fontsize=16,fontweight='bold',x=.065,ha='left')
fig.text(.065,.025,'Gemma 4 Q4_K_M • requested high reasoning, 1,024-token cap • preserved 512-word windows, stride 384 • max score >0.5\nCorrelated, ordered samples; the numeric probe is post-hoc. Counts are descriptive, not deployment accuracy. Time is not energy or uncached latency.',fontsize=9,color='#475569')
fig.tight_layout(rect=(.025,.095,.99,.945),h_pad=3,w_pad=2)
for ext in ['png','svg','pdf']:fig.savefig(OUT/f'local-small-model-confirmation.{ext}',dpi=180)
plt.close(fig)
print(json.dumps([{'model':r['model'],'cohort':r['cohort'],'ratio':r['windowTimeRatio']} for r in rows]))
