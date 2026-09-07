import json
from pathlib import Path
import re
HERE=Path(__file__).resolve().parent
load=lambda name:json.loads((HERE/name).read_text(encoding='utf-8'))
c=load('runtime-case-results.json');t=load('runtime-timing-results.json');v=load('runtime-verification.json')
report=HERE.parent/'addressing.md';text=report.read_text(encoding='utf-8')
def put(tag,body):
    global text
    text,n=re.subn(f'<!-- {tag}_START -->.*?<!-- {tag}_END -->',f'<!-- {tag}_START -->\n\n{body}\n\n<!-- {tag}_END -->',text,flags=re.S);assert n==1
def table(head,rows):return '\n'.join(['| '+' | '.join(head)+' |','| '+' | '.join(['---']*len(head))+' |']+['| '+' | '.join(str(x) for x in r)+' |' for r in rows])
put('RUNTIME_ERRORS',table(['Threshold','Queries','Wrong identity matches','Missed true continuations','Total unmatched'],[
    [str(r['threshold'])+'%',r['queries'],r['wrongIdentity'],r['missedContinuity'],r['unmatched']] for r in c['totals']]))
put('RUNTIME_COST',table(['Transitions','Method','Reader-cold median ms','Range ms','Same-reader warm median ms','Git calls / decoded Markdown bytes','Outcome'],[
    [r['transitions'],r['method'],f"{r['coldMedianMs']:.1f}",f"{r['coldRangeMs'][0]:.1f}–{r['coldRangeMs'][1]:.1f}",f"{r['warmMedianMs']:.2f}",f"{r['cost']['gitCalls']} / {r['cost']['blobBytes']:,}",r['reason'] or r['status']] for r in t['summary']]))
put('RUNTIME_VALIDATION',f"Validation: **{v['adjacent_runtime_queries']} runtime queries over the original/extended fixture states**, **{v['arbitrary_range_queries']} arbitrary-range queries**, **{v['range_semantic_assertions']} range/loss assertions**, **{v['timed_samples']} timed samples / {v['timed_status_checks']} cold/warm status checks**, **{v['repository_history_checks']} repository history checks**, **{v['zero_metadata_tree_checks']} zero-identity-metadata tree checks**, and **{v['missing_review_object_checks']} missing-review-object checks**. **{v['failures']} unexpected final validation failures.** Wrong identity matches and misses in the table are measured limitations of the candidate, not successful continuity resolutions.")
report.write_text(text,encoding='utf-8');print('Updated three runtime refinement table blocks.')
