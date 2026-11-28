from pathlib import Path
from collections import Counter
import json, subprocess, math
p=Path('docs/experiments/2026-11-28-router')
def read(n):return json.loads((p/(n+'.json')).read_text(encoding='utf-8-sig'))
d,pack,rec,review,s=map(read,['design','candidates','score/receipt','review','summary'])
assert json.loads(subprocess.check_output(['git','show',pack['commit']+':'+p.as_posix()+'/design.json']))==d
assert len(rec['rows'])==len(pack['results'])==192
approved=set(review['acceptedBodyHashes'])
raw={}
for j,r,c in zip(d['schedule'],rec['rows'],pack['results'],strict=True):
 k=tuple(j[f] for f in ['caseId','repeat','group'])
 assert k==tuple(c[f] for f in ['caseId','repeat','group'])==tuple(r[f] for f in ['caseId','repeat','group'])
 assert k not in raw
 raw[k]=(r['status']=='passed' and c.get('codeSha256') in approved,c['usage']['prompt_tokens'],c['usage']['completion_tokens'])
cases=read('transfer')
for t,design in zip(cases,d['cases'],strict=True):
 assert t['id']==design['id']
 x,y=[json.loads(design['requests'][g]['messages'][1]['content']) for g in ('L','A')]
 assert x['documents']==y['documents'][:1]
 assert y['documents'][1]['id']=='node-members' and y['documents'][2]['id']=='option-match'
 del x['documents'],y['documents']; assert x==y
for panel in ['new','prior']:
 for pol in ['J','S','L','A']:
  rows=[raw[c['id'],r,c['policy'][pol]] for c in d['cases'] if c['panel']==panel for r in (1,2,3)]
  m=s['panels'][panel][pol];assert tuple(map(sum,zip(*rows)))==(m['passed'],m['input'],m['output'])
for k,v in s['differences'].items():
 a,b=k.split('-');deltas=Counter()
 for c in d['cases']:
  if c['panel']=='new':
   for r in (1,2,3):deltas[c['pair']]+=int(raw[c['id'],r,c['policy'][a]][0])-int(raw[c['id'],r,c['policy'][b]][0])
 assert len(deltas)==12 and [sum(deltas.values()),sum(n>0 for n in deltas.values()),sum(n==0 for n in deltas.values()),sum(n<0 for n in deltas.values())]==[v['net'],v['better'],v['same'],v['worse']]
assert math.isclose(sum(x[1]*2+x[2]*8 for x in raw.values())/1e6,s['conservativeCNY'])
print('Independent receipt replay agrees on 192 physical calls, both panels, four policies, five paired comparisons and cost.')
