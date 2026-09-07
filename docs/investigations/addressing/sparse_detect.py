"""Measure actual Git -M50/-M80 proposals against hidden producer truth.

Two inputs: native Markdown document trees and projected one-section-per-file
trees. Projection is extra parser work; it is not native section awareness.
"""
import importlib.util
import json
from pathlib import Path
import uuid
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work'
cases=json.loads((WORK/'sparse-native-input.json').read_text(encoding='utf-8'))
folder=WORK/'sparse-detect'/uuid.uuid4().hex;repo=folder/'repo.git';h.init_repo(repo)
rows=[]
def make_tree(items):return h.tree(repo,{p:h.put(repo,'blob',b.encode()) for p,b in items})
def renames(a,b,threshold):
    fields=h.git(repo,'diff','--name-status','-z',f'-M{threshold}%','-l0','--no-ext-diff','--no-textconv',a,b).split(b'\0')
    records=[];i=0
    while i<len(fields) and fields[i]:
        status=fields[i].decode();i+=1;first=fields[i].decode();i+=1
        if status.startswith(('R','C')):records.append(dict(status=status,old=first,new=fields[i].decode()));i+=1
    return records
for case in cases:
    a=case['beforeInventory'];b=case['afterInventory']
    before={e:v for e,v in a['byEntity'].items() if v['kind']=='section'}
    after={e:v for e,v in b['byEntity'].items() if v['kind']=='section'}
    truth={(e,e) for e in before.keys()&after.keys() if before[e]['slot']!=after[e]['slot']}
    trees={};predictions={}
    trees['native']=[make_tree((d['path'],d['source']) for d in case[k]['documents']) for k in ('before','after')]
    trees['projected']=[make_tree((v['slot']+'.md',v['source']) for v in inv.values()) for inv in (before,after)]
    for mode,(ta,tb) in trees.items():
        for threshold in (50,80):
            pairs=renames(ta,tb,threshold);proposed=set()
            if mode=='native':
                for pair in pairs:
                    for e,v in before.items():
                        if v['path']!=pair['old']:continue
                        for f,w in after.items():
                            if w['path']==pair['new'] and v['locator'][2]==w['locator'][2]:proposed.add((e,f))
            else:
                left={v['slot']+'.md':e for e,v in before.items()};right={v['slot']+'.md':e for e,v in after.items()}
                for pair in pairs:proposed.add((left[pair['old']],right[pair['new']]))
            predictions[(mode,threshold)]=proposed
            rows.append(dict(case=case['name'],mode=mode,threshold=threshold,truth=len(truth),proposals=len(proposed),
                true_positive=len(proposed&truth),false_positive=len(proposed-truth),false_negative=len(truth-proposed),
                pairs=pairs,wrong_pairs=[list(p) for p in sorted(proposed-truth)]))
    # Prefer the native file mapping, then supplement unmatched sections. This is
    # a stronger candidate generator, still not evidence of editorial intent.
    for threshold in (50,80):
        native=predictions[('native',threshold)];used_old={p[0] for p in native};used_new={p[1] for p in native}
        proposed=native|{p for p in predictions[('projected',threshold)] if p[0] not in used_old and p[1] not in used_new}
        rows.append(dict(case=case['name'],mode='hybrid',threshold=threshold,truth=len(truth),proposals=len(proposed),
            true_positive=len(proposed&truth),false_positive=len(proposed-truth),false_negative=len(truth-proposed),
            wrong_pairs=[list(p) for p in sorted(proposed-truth)]))
totals=[]
for mode in ('native','projected','hybrid'):
    for threshold in (50,80):
        subset=[r for r in rows if r['mode']==mode and r['threshold']==threshold]
        totals.append(dict(mode=mode,threshold=threshold,**{k:sum(r[k] for r in subset) for k in ('truth','proposals','true_positive','false_positive','false_negative')}))
output=dict(git=h.git(repo,'--version').decode().strip(),fixture=str(repo.relative_to(h.ROOT)).replace('\\','/'),cases=len(cases),diff_runs=4*len(cases),strategy_evaluations=len(rows),totals=totals,rows=rows,failures=0)
h.compression.save(HERE/'sparse-detection-results.json',output)
print(json.dumps(dict(cases=len(cases),diff_runs=4*len(cases),strategy_evaluations=len(rows),totals=totals,failures=0),indent=2))
