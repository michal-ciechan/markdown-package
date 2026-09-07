"""Generate follow-up tables only; preserve the original investigation evidence."""
import json
from pathlib import Path
import re
HERE=Path(__file__).resolve().parent
load=lambda name:json.loads((HERE/name).read_text(encoding='utf-8'))
size=load('sparse-size-results.json');detection=load('sparse-detection-results.json');verification=load('sparse-verification.json')
report=HERE.parent/'addressing.md';text=report.read_text(encoding='utf-8')
def put(tag,body):
    global text
    text,n=re.subn(f'<!-- {tag}_START -->.*?<!-- {tag}_END -->',f'<!-- {tag}_START -->\n\n{body}\n\n<!-- {tag}_END -->',text,flags=re.S)
    assert n==1
def table(head,rows):return '\n'.join(['| '+' | '.join(head)+' |','| '+' | '.join(['---']*len(head))+' |']+['| '+' | '.join(str(x) for x in row)+' |' for row in rows])
def get(corpus,scenario,rate,mode,history):return next(r for r in size['rows'] if (r['corpus'],r['scenario'],r['rate'],r['mode'],r['history'])==(corpus,scenario,rate,mode,history))
def cell(row):return f"{row['bytes']:,} (+{row['over_baseline_pct']:.2f}%)"
rows=[]
for corpus in ('npm','rust'):
    for rate in (0,5,20):
        base=get(corpus,'exact-base',rate,'none','snapshot');sparse=get(corpus,'exact-base',rate,'sparse','snapshot');full=get(corpus,'exact-base',rate,'identity','snapshot')
        rows.append([corpus,f"{rate}% / {sparse['events']:,}",f"{base['bytes']:,}",cell(sparse),cell(full),f"{sparse['metadata_raw_bytes']:,}"])
put('SPARSE_SNAPSHOT',table(['Corpus','Alias rate / count','No-map ZIP bytes','Sparse ZIP bytes (over baseline)','Full-map ZIP bytes (over baseline)','Raw sparse ledger bytes'],rows))
rows=[]
for corpus in ('npm','rust'):
    for rate in (0,5,20):
        base=get(corpus,'history32',rate,'none','full32');sparse=get(corpus,'history32',rate,'sparse','full32');full=get(corpus,'history32',rate,'identity','full32')
        rows.append([corpus,f"{rate}% / {sparse['events']:,}",f"{base['bytes']:,}",cell(sparse),cell(full),f"{full['bytes']-sparse['bytes']:,}"])
put('SPARSE_HISTORY',table(['Corpus','Injected rate / events','Same-source no-map ZIP bytes','Sparse ZIP bytes (over baseline)','Full-map ZIP bytes (over baseline)','Sparse saving versus full, bytes'],rows))
rows=[]
for corpus in ('npm','rust'):
    for rate in (0,5,20):
        vals=[get(corpus,'history32',rate,m,h) for h in ('squash32','later-root') for m in ('sparse','identity')]
        rows.append([corpus,f'{rate}%']+[f"+{v['over_baseline_pct']:.2f}%" for v in vals])
put('SPARSE_ENDPOINT',table(['Corpus','Injected rate','Squash: sparse','Squash: full maps','Later root: sparse','Later root: full maps'],rows))
labels={'native':'Native file mapping','projected':'Projected section files','hybrid':'Native first + projected'}
put('SPARSE_DETECTION',table(['Candidate generator','Threshold','Needed mappings','Correct proposals','Wrong proposals','Missed mappings'],[
    [labels[r['mode']],f"{r['threshold']}%",r['truth'],r['true_positive'],r['false_positive'],r['false_negative']] for r in detection['totals']]))
v=verification
put('SPARSE_VALIDATION',f"Final validation: **{v['original_model_checks']} original model checks**, **{v['confirmed_sparse_comparisons']} confirmed sparse conformance comparisons**, **{v['sparse_extra_checks']} sparse lifecycle/summary/URI/coverage checks**, **{v['native_git_diff_runs']} native diff runs / {v['strategy_evaluations']} scored strategies**, **{v['injected_resolution_checks']:,} injected-event resolution checks**, **{v['pinned_source_checks']} pinned source checks**, and **{v['archive_hash_audits']} archive hash / tree / history-count audits with {v['zip_member_audits']} ZIP member checks**. The audit reproduces **{v['prior_size_equalities']} exact prior size comparisons**. **{v['failures']} unexpected validation failures in final evidence.** The documented wrong heuristic proposals and naïve-reference failures are intentional counterexamples, not hidden successful detections; suite counts overlap and are not a count of independent real-world edits.")
report.write_text(text,encoding='utf-8')
print('Updated five sparse follow-up table blocks.')
