"""Derive compact, reviewable tables from measured JSON, without re-benchmarking."""
import collections
import json
import statistics
from pathlib import Path

OUT=Path(__file__).resolve().parent
MIB=1024**2


def summary():
    result={}
    if (OUT/'native-results.json').exists():
        rows=[]
        for case in json.loads((OUT/'native-results.json').read_text()):
            s=case['samples']; f=case['fixture']
            rows.append(dict(codec=f['codec'],mode=f['mode'],stream=s[0]['streamed'],
              first_ms=statistics.median(x['first_ms'] for x in s),median_ms=statistics.median(x['median_ms'] for x in s),
              p95_ms=statistics.median(x['p95_ms'] for x in s),
              peak_mib=statistics.median(x['peak_rss'] for x in s)/MIB,
              peak_increase_mib=statistics.median(x['peak_increase'] for x in s)/MIB,
              baseline_mib=statistics.median(x['rss_before'] for x in s)/MIB))
        result['native']=rows
    for browser in ['chrome','firefox']:
        file=OUT/f'{browser}-decode-results.json'
        if not file.exists():continue
        groups=collections.defaultdict(list)
        for sample in json.loads(file.read_text()):
            c=sample['config']; f=c['fixture']
            groups[(c['engine'],f['codec'],f['mode'],c['stream'])].append(sample)
        rows=[]
        for key,samples in groups.items():
            row=dict(zip(['engine','codec','mode','stream'],key))
            row['samples']=len(samples)
            r=[s['result'] for s in samples]
            if any('error' in x or 'unsupported' in x for x in r):
                row['unavailable']=r; rows.append(row);continue
            for field in ['startupMs','firstMs','medianMs','p95Ms','wasmMemoryBefore','wasmMemoryAfterFirst']:
                values=[x[field] for x in r if x[field] is not None]
                row[field]=statistics.median(values) if values else None
            peaks,baselines,increases=[],[],[]
            for s in samples:
                # Active renderer identified by a pre-baseline 300ms CPU pulse.
                before=next(p for p in s['memory_before'] if p['pid']==s['content_pid'])
                after=next(p for p in s['memory_first'] if p['pid']==before['pid'])
                baselines.append(before['rss']/MIB)
                peaks.append(after['peak']/MIB)
                increases.append(max(0,after['peak']-before['peak'])/MIB)
            row.update(baseline_mib=statistics.median(baselines),peak_mib=statistics.median(peaks),peak_increase_mib=statistics.median(increases))
            rows.append(row)
        result[browser]=rows
    (OUT/'decode-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    for name,rows in result.items():
        print(name)
        for r in rows:
            print(' '.join(f'{k}={v:.3f}' if isinstance(v,float) else f'{k}={v}' for k,v in r.items() if k!='unavailable'))


if __name__=='__main__': summary()
