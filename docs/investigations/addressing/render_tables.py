"""Refresh the report's measured tables from audited JSON evidence."""
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
load=lambda name:json.loads((HERE/name).read_text())
m=load('metadata-results.json');n=load('native-results.json');v=load('verification.json')
report=HERE.parent/'addressing.md';text=report.read_text(encoding='utf-8')
def put(tag,body):
    global text
    pattern=f'<!-- {tag}_START -->.*?<!-- {tag}_END -->'
    text,count=re.subn(pattern,f'<!-- {tag}_START -->\n\n{body}\n\n<!-- {tag}_END -->',text,flags=re.S)
    assert count==1
def table(headers,rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
                     ['| '+' | '.join(str(x) for x in row)+' |' for row in rows])
labels={'none':'No address maps','identity':'Identity only (adaptive)','cached':'Identity + digests (adaptive)','identity256':'Identity only (fixed 256)'}
put('METADATA',table(['Corpus','Variant','Raw metadata bytes','Standalone metadata ZIP bytes','Complete Git snapshot ZIP bytes','Over baseline'],[
    [r['corpus'],labels[r['variant']],f"{r['raw_metadata_bytes']:,}",f"{r['standalone_metadata_zip_bytes']:,}",f"{r['packaged_snapshot_bytes']:,}",f"+{r['over_no_metadata_pct']:.2f}%"] for r in m['rows']]))
put('LOOKUP',table(['Corpus','Variant','Added current-map ZIP bytes','Target map entries','Compressed / decoded map bytes'],[
    [r['corpus'],labels[r['variant']],f"{r['current_map_copy_increment']:,}",r['target_entries'],f"{r['target_lookup_compressed_bytes']:,} / {r['target_lookup_decoded_bytes']:,}"] for r in m['rows'] if r['variant']!='none']))
put('HISTORY',table(['Metadata','Four snapshots, ZIP bytes','Base + squash, ZIP bytes','Later synthetic root, ZIP bytes'],[
    [labels[mode]]+[f"{next(r['bytes'] for r in n['size_rows'] if r['mode']==mode and r['scenario']==scenario):,}" for scenario in ('full','squash','later-root')] for mode in ('none','identity','cached')]))
s=m['summary']
put('SUMMARY',f"The three-transition ordered edit/revert/unrelated summary is **{s['summary_bytes']:,} bytes**, plus **{s['bindings_bytes']:,} bytes** of emitted-commit bindings; their two-member standalone ZIP is **{s['zip_bytes']:,} bytes** including names and headers. Adding these members to an existing ZIP shares its EOCD (22 bytes), before any manifest additions. This example has four touched entities and three source transitions; it is not a full-corpus history estimate.")
put('VALIDATION',f"Validation: **{v['model_checks']} model checks**, **{v['git_resolution_checks']} Git-backed resolution/summary/reference checks** (20 real snapshot resolutions), **{v['corpus_source_checks']} pinned source checks**, **{v['corpus_timed_resolution_checks']} timed resolver result checks**, and **{v['native_checks']['zip_entry_roundtrips']+v['metadata_zip_roundtrips']:,} ZIP entry round trips** across the native and metadata probes. The native probe separately checks real squash, shallow and synthetic roots, file rename, two repacks preserving exact patches, and removed endpoints. The final audit validates **{v['audited_archives']} saved package archives / {v['audited_archive_members']} members**, summary bindings/hashes, parser/patch hashes and all size arithmetic. **{v['failures']} unexpected validation failures in final evidence.** Counts describe distinct suites; model checks include expected rejection cases and should not be summed with overlapping native/audit checks as unique scenarios.")
report.write_text(text,encoding='utf-8')
print('Updated metadata, lookup, history, summary and validation tables.')
