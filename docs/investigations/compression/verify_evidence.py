"""Audit saved measurements and first-parent corpus continuity. No format tests."""
import json
import subprocess
import sys
from pathlib import Path

OUT=Path(__file__).resolve().parent
WORK=OUT.parents[2]/'.antiphon/compression-work'


def read(name): return json.loads((OUT/name).read_text())


def verify():
    counts={'corpus_continuity':0,'browser_support':0,'native_decode_hash_checks':0,'browser_decode_hash_checks':0}
    for name,repo,prefix in [('npm','npm-cli','docs/lib/content'),('rust','rust-rfcs','text')]:
        d=read(name+'-corpus.json')
        assert len(d['commits'])==32
        assert sum(e['bytes'] for e in d['entries'])==d['raw_bytes']
        prev=d['base']
        for commit in d['commits']:
            subprocess.run(['git','-C',str(WORK/repo),'diff','--quiet',prev,commit+'^','--',f'{prefix}/*.md'],check=True)
            counts['corpus_continuity']+=1
            prev=commit
        subprocess.run(['git','-C',str(WORK/repo),'diff','--quiet',prev,d['head'],'--',f'{prefix}/*.md'],check=True)
        counts['corpus_continuity']+=1
    if '--corpus-only' in sys.argv:
        print(json.dumps(counts,indent=2));return
    for probe in read('browser-support-probes.json'):
        r=probe['result']; supported={'gzip','deflate','deflate-raw'}
        if probe['browser']=='firefox':supported.add('brotli')
        for format,support in r['support'].items():
            assert support==(format in supported);counts['browser_support']+=1
        for format,result in r['decoded'].items():
            assert (result is True)==(format in supported);counts['browser_support']+=1
        assert r['fdict']!='accepted';counts['browser_support']+=1
        for result in r['malformed'].values():
            assert result.startswith('rejected:');counts['browser_support']+=1
        assert r['constructedResponsePreservesCompressedBytes'];counts['browser_support']+=1
    native=read('native-results.json')
    assert len(native)==25
    for row in native:
        assert len(row['samples'])==3
        counts['native_decode_hash_checks']+=2*len(row['samples'])
    for browser,expected in [('chrome',24),('firefox',8)]:
        rows=read(browser+'-decode-results.json')
        assert len(rows)==expected*3,(browser,len(rows))
        for row in rows:
            r=row['result']
            assert 'error' not in r,r
            if r.get('unsupported'):
                assert browser=='chrome' and r['format']=='brotli'
                continue
            assert len(r['timings'])==31
            assert len(row['identity_deltas'])>0
            top=row['identity_deltas'][0][0]
            second=row['identity_deltas'][1][0] if len(row['identity_deltas'])>1 else 0
            assert top>=0.15 and top>second*1.5,(browser,row['config'],row['identity_deltas'])
            assert row['content_pid'] in {p['pid'] for p in row['memory_first']}
            counts['browser_decode_hash_checks']+=2
    sizes=read('size-results.json')
    # These equalities follow from the identical DEFLATE encoder, so also catch
    # accidental corpus/fixture revision mismatches in the saved tables.
    for name in ['npm','rust']:
        n=len(read(name+'-corpus.json')['entries'])
        rows={r['codec']:r for r in sizes['rows'] if r['corpus']==name and 'order' not in r}
        assert rows['gzip-6']['entry_bytes']-rows['deflate-6']['entry_bytes']==12*n
        assert rows['gzip-6']['entry_bytes']-rows['raw-6']['entry_bytes']==18*n
    counts['compression_roundtrips']=sum(len(read(n+'-corpus.json')['entries'])*11+11 for n in ['npm','rust'])+sum(r['test_entries'] for r in sizes['dictionaries'])
    counts['unexpected_failures']=0
    (OUT/'verification.json').write_text(json.dumps(counts,indent=2)+'\n')
    print(json.dumps(counts,indent=2))


if __name__=='__main__':verify()
