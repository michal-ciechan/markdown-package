"""Regenerate evidence tables; narrative conclusions remain reviewable Markdown."""
import collections
import json
from pathlib import Path
import re
import statistics

HERE=Path(__file__).resolve().parent
REPORT=HERE.parent/'history.md'
def read(name):return json.loads((HERE/name).read_text())
def n(value):return f'{value:,}'
def table(headers,rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
                     ['| '+' | '.join(map(str,row))+' |' for row in rows])
def replace(name,value):
    global text
    text=re.sub(r'<!-- '+name+r'_START -->.*?<!-- '+name+r'_END -->',
                lambda _:f'<!-- {name}_START -->\n\n{value}\n\n<!-- {name}_END -->',text,flags=re.S)

if __name__=='__main__':
    text=REPORT.read_text(encoding='utf-8')
    sizes=read('size-results.json');models=['git-dir','git-bundle','flat-diffs']
    rows=[]
    for c in sizes['corpora']:
        for r in c['rows']:
            rows.append([c['corpus'],r['scenario']]+[f"{n(r['variants'][m]['bytes'])} ({r['variants'][m]['over_base_pct']:+.2f}%)" for m in models])
    replace('SIZE',table(['Corpus','Updates','A: packed .git ZIP','B: bundle ZIP','C: flat-diff ZIP'],rows))
    rows=[];browsing=[]
    for c in sizes['corpora']:
        r=next(r for r in c['rows'] if r['scenario']=='32');best=r['prior_best_solid']['bytes']
        for name,value in [('Prior best solid '+r['prior_best_solid']['codec'],best)]+[(m,r['variants'][m]['bytes']) for m in models]:
            rows.append([c['corpus'],name,n(value),f'{(value/best-1)*100:+.2f}%'])
        browsing.append([c['corpus'],n(r['current_view_zip_bytes'])]+[n(r['variants'][m]['with_browsable_current_bytes']) for m in models])
    replace('SOLID',table(['Corpus','Variant, 32 updates','Bytes','Over prior best solid'],rows))
    replace('BROWSE',table(['Corpus, 32 updates','Current files alone','A + current files','B + current files','C + current files'],browsing))
    assets=read('browser-assets.json')['assets']
    replace('ASSETS',table(['Browser artifact','Raw JS bytes','Gzip bytes'],[[a['name'],n(a['bytes']),n(a['gzip_bytes'])] for a in assets]))
    imports=read('native-import-results.json')
    replace('IMPORT',table(['Corpus','Native bare bundle import median ms','Range ms','Verified imports'],
                          [[r['corpus'],f'{r["median_ms"]:.1f}',f'{min(r["samples_ms"]):.1f}–{max(r["samples_ms"]):.1f}',r['checked_imports']] for r in imports]))
    groups=collections.defaultdict(list)
    for browser in ('chrome','firefox','edge'):
        p=HERE/(browser+'-results.json')
        if p.exists():
            for r in json.loads(p.read_text()):
                cfg=r['config'];groups[browser,cfg['corpus'],cfg['mode'],cfg['target']].append(r)
    rows=[]
    for (browser,c,mode,target),samples in sorted(groups.items()):
        assert all('error' not in r['result'] for r in samples)
        def med(key):return statistics.median(r['result'][key] for r in samples)
        starts=[r['result']['moduleMs'] for r in samples]
        peaks=[]
        for r in samples:
            pid=r.get('content_pid')
            peak=next((p['peak']/1048576 for p in r.get('memory_first',[]) if p['pid']==pid),None)
            if peak is not None:peaks.append(peak)
        rows.append([browser,c,mode,'original' if target==0 else 'most revised',str(len(samples)),
                     f'{med("moduleMs"):.1f} ({min(starts):.1f}–{max(starts):.1f})',
                     f'{med("prepareMs"):.1f}',f'{med("firstMs"):.1f}',f'{med("warmMedianMs"):.1f}',
                     f'{med("sectionParseMedianMs"):.1f}',f'{statistics.median(peaks):.1f}' if peaks else 'unavailable'])
    replace('BROWSER',table(['Browser','Corpus','Input','Target','Profiles','Module ms (range)','Index ms','First history ms','Warm ms','Section scan ms','Renderer peak MiB'],rows))
    pack=read('pack-access-results.json')
    replace('ACCESS',table(['Corpus / target','Selected pack bytes','Objects','Inflated stream bytes','Reconstructed object bytes'],
                          [[r['corpus']+' / '+r['target'],n(r['selected_pack_bytes']),n(r['selected_objects']),n(r['inflated_stream_bytes']),n(r['reconstructed_object_bytes'])] for r in pack]))
    rows=[]
    for c in sizes['corpora']:
        for f in c['fixtures']:
            for t in f['targets']:
                rows.append([c['corpus']+' / '+t['label'],f'{t["native_log"]["median_ms"]:.2f}',
                             f'{t["native_section_log"]["median_ms"]:.2f}',n(t['flat_payload_bytes']),n(t['flat_decoded_bytes']),
                             f'{t["flat_reconstruct"]["median_ms"]:.4f}'])
    replace('NATIVE',table(['Corpus / target','Git log -p ms','Git log -L ms','Flat payload bytes','Flat decoded bytes','Flat endpoint replay ms'],rows))
    v=read('verification.json');c=v['checks']
    summary=(f"Validation: **{n(c['zip_entry_roundtrips'])} ZIP entry round trips**, **{c['archive_hash_and_metadata_audits']} archive hash/metadata audits**, "
             f"**{c['flat_delta_reconstruction']} original + {c['squash_delta_reconstruction']} squashed patch reconstructions**, **{c['flat_snapshot_reconstruction']} full flat-snapshot comparisons**, "
             f"**{c['git_fsck']} packed repository checks**, **{c['bundle_clone_fsck']} empty-repository bundle imports with strict checks** plus **{c['timed_native_bundle_imports']} timed native imports**, "
             f"**{c['pack_object_hashes']} independently reconstructed Git object hashes**, **{c['pack_document_hashes']} pack-reader document hashes**, "
             f"**{c['browser_document_hashes']} browser document + {c['browser_section_hashes']} browser section hash checks** across **{c['browser_profiles']} completed profiles**, "
             f"and **{c['semantic_cases']} semantic counterexamples/cases**. **0 unexpected validation failures**. "
             f"Two deliberate Git negative operations demonstrate incomplete bundle imports/prerequisites. Complete three-profile browser suites: **{', '.join(v['complete_browser_suites'])}**. "
             f"There were **{v['recorded_browser_launch_failures']} recorded browser startup/teardown failures**, plus one initial unrecorded Chrome launch timeout. "
             "Two preliminary browser runs failed because the experiment build omitted the Buffer shim; the corrected, hash-pinned assets are used for all saved timing samples. "
             "Incomplete launches are excluded from timing, and successful slow samples are retained. See the launch-failure JSON for diagnostics; partial Chrome coverage is not a complete compatibility suite.")
    replace('VALIDATION',summary)
    REPORT.write_text(text,encoding='utf-8')
