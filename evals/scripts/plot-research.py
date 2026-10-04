"""Offline figures from validated aggregate reports; no raw source text or requests."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'evals/reports/figures';OUT.mkdir(exist_ok=True)
s=json.loads((ROOT/'evals/runs/extended-research-summary.json').read_text())
d=json.loads((ROOT/'evals/runs/decoded-research-summary.json').read_text())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'savefig.facecolor':'white'})
models=[('gemma4-26b','Gemma4 26B-A4B FP8'),('gemma4-31b','Gemma4 31B FP4 route'),('gemma31-fp8','Gemma4 31B FP8 route'),('qwen35-9b','Qwen3.5 9B BF16'),('qwen36-35b','Qwen3.6 35B-A3B FP8'),('qwen36-27b','Qwen3.6 27B FP8'),('jev','Jev1.13 specialist'),('armor-low','Armor low alias'),('armor-base','Armor base alias'),('armor-high','Armor high alias')]
lookup={(r['runId'].split('/')[-2],r['runId'].split('/')[-1]):r['groups'] for r in s['facets']}
fig,ax=plt.subplots(figsize=(10.5,5.8));a=np.full((len(models),4),np.nan)
for i,(key,_) in enumerate(models):
 for j,domain in enumerate(['paper','code','resume','email']):
  g=lookup.get(('longpi-'+domain,key+'-full'));a[i,j]=g['naive']['flagged'] if g else np.nan
im=ax.imshow(a,cmap='YlGnBu',vmin=0,vmax=100,aspect='auto')
ax.set_xticks(range(4),['Paper review','Code review','Résumé ranking','Email reply']);ax.set_yticks(range(len(models)),[name for _,name in models]);ax.set_title('Subtle source instructions expose domain-specific gaps',loc='left',fontweight='bold',pad=16)
for i in range(len(models)):
 for j in range(4):ax.text(j,i,'—' if np.isnan(a[i,j]) else str(int(a[i,j])),ha='center',va='center',color='white' if a[i,j]>55 else '#18232d')
fig.colorbar(im,ax=ax,label='Detected attacks /100');fig.text(.02,.01,'LongPIBench synthetic release • full source • fixed >0.5/native-match rule •100 source families/domain\nEach cell is a template-specific count, not an end-to-end compromise rate. Endpoint precision is advertised, not locally measured.',fontsize=8,color='#4b5563');fig.tight_layout(rect=(0,.08,1,1))
for ext in ['png','svg']:fig.savefig(OUT/f'longpi-naive-domain.{ext}',dpi=180)
plt.close(fig)
controls={r['condition']:r['aggregate']['primary']['matrix']['fp'] for r in d['controls']}
selected=[(k,n) for k,n in models if k+'-full' in controls and k+'-decoded' in controls]
y=np.arange(len(selected));fig,ax=plt.subplots(figsize=(10.5,5.8))
ax.barh(y-.18,[controls[k+'-full']/969*100 for k,_ in selected],.34,color='#b45309',label='Original encoded source')
ax.barh(y+.18,[controls[k+'-decoded']/969*100 for k,_ in selected],.34,color='#0369a1',label='Source + decoded preview')
ax.set_yticks(y,[n for _,n in selected]);ax.invert_yaxis();ax.set_xlim(0,100);ax.set_xlabel('Benign source flags (%)');ax.set_title('Decoding often reduces encoding-triggered false alarms',loc='left',fontweight='bold',pad=16);ax.legend(frameon=False,loc='lower right');ax.grid(axis='x',alpha=.15);ax.set_axisbelow(True)
fig.text(.02,.01,'969 synthetic Base64/Unicode controls from public benign texts; encodings share source families.\nAttack recall can decrease under the same transform. This is one combined-input request, not an OR ensemble.',fontsize=8,color='#4b5563');fig.tight_layout(rect=(0,.08,1,1))
for ext in ['png','svg']:fig.savefig(OUT/f'encoded-benign-flags.{ext}',dpi=180)
plt.close(fig)
print('Wrote four figure files from validated aggregate snapshots')
