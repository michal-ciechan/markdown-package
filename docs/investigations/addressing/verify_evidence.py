"""Audit saved measurements against the generated Git/ZIP and corpus fixtures."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work'
load=lambda p:json.loads(p.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
canonical=lambda x:(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
cases=load(HERE/'case-results.json');native=load(HERE/'native-results.json')
resolved=load(HERE/'resolution-results.json');corpora=load(HERE/'corpus-results.json')
metadata=load(HERE/'metadata-results.json');source=load(WORK/'corpora.json')
assert cases['failures']==native['failures']==resolved['failures']==0
assert cases['checks']==len(cases['checkNames'])==len(set(cases['checkNames']))
assert resolved['checks']==len(resolved['rows'])+5
assert len(resolved['rows'])==native['checks']['native_snapshot_queries']
for row in resolved['rows']:
    assert row['git']['log_walks']==0
    if row['reason'] in ('same-source','source-changed'):
        assert 3<=len(row['git']['reads'])<=4
    else:assert len(row['git']['reads'])==2

summary=resolved['summary'];raw=(WORK/'range-summary.json').read_bytes()
assert raw==canonical(summary['body']) and len(raw)==summary['bytes']
assert sha(raw)==summary['id']
binding=(WORK/'range-bindings.json').read_bytes()
assert len(binding)==summary['bindingsBytes']
assert load(WORK/'range-bindings.json')['ranges']==[
    dict(summary='sha256-'+sha(raw),emitted='sha1-'+native['commits']['squash'])]
s=summary['body'];sid=cases['ids']['S']
assert s['sourceCommits']==['sha1-'+native['commits'][k] for k in ('renamed','reverted','tip')]
assert s['changedAt'][sid]==[1,2] and s['endpoints'][sid]['before']==s['endpoints'][sid]['after']
for ordinals in s['changedAt'].values():
    assert ordinals==sorted(set(ordinals)) and all(1<=i<=len(s['sourceCommits']) for i in ordinals)
summary_zip=h.archive([('.mdpkg/history/ranges/'+sha(raw)+'.json',raw),('.mdpkg/history/bindings.json',binding)])
assert metadata['summary']==dict(raw_bytes=len(raw)+len(binding),zip_bytes=len(summary_zip),
                               summary_bytes=len(raw),bindings_bytes=len(binding))
assert sha((WORK/'immutable.patch').read_bytes())==native['refs']['patch_sha256']
assert (WORK/'immutable.patch').stat().st_size==native['refs']['patch_bytes']
assert sha((WORK/'parser-browser.js').read_bytes())==corpora['assets']['sha256']

archives=[];member_checks=0
for row in native['size_rows']:
    file=WORK/row['file'];payload=file.read_bytes()
    assert len(payload)==row['bytes'] and sha(payload)==row['sha256']
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        assert z.testzip() is None
        assert z.infolist()[0].filename=='.mdpkg/manifest.json' and z.infolist()[0].compress_type==0
        for entry in z.infolist():
            b=z.read(entry)
            if entry.filename.startswith('.git/'):
                assert b==(file.parent/'repo.git'/entry.filename[5:]).read_bytes()
            member_checks+=1
    archives.append(dict(file=str(file.relative_to(h.ROOT)).replace('\\','/'),bytes=len(payload),sha256=sha(payload)))

source_checks=0
for c in corpora['corpora']:
    original=next(x for x in source if x['corpus']==c['corpus'])
    pinned=load(HERE.parent/'compression'/f"{c['corpus']}-corpus.json")
    entries={e['path']:e for e in pinned['entries'] if e['kind']=='base'}
    assert c['base']==original['base']==pinned['base']
    assert c['documents']==len(original['documents'])==len(entries)
    for d in original['documents']:
        b=d['source'].encode();expected=entries[d['path']]
        assert len(b)==expected['bytes'] and sha(b)==d['sha256']==expected['sha256'];source_checks+=1
    assert c['totalRecords']==c['headingSections']+2*c['documents']
    baseline=next(r['packaged_snapshot_bytes'] for r in metadata['rows'] if r['corpus']==c['corpus'] and r['variant']=='none')
    for row in [r for r in metadata['rows'] if r['corpus']==c['corpus']]:
        variant=row['variant'];files={} if variant=='none' else load(WORK/c['metadataFixtures'][variant])
        items=[(p,b.encode()) for p,b in sorted(files.items())]
        assert sum(len(b) for _,b in items)==row['raw_metadata_bytes']
        assert len(items)==row['metadata_entries']
        assert (len(h.archive(items)) if items else 0)==row['standalone_metadata_zip_bytes']
        file=h.ROOT/metadata['fixture_directory']/c['corpus']/variant/'package.zip'
        payload=file.read_bytes();assert len(payload)==row['packaged_snapshot_bytes']
        assert abs(row['over_no_metadata_pct']-(len(payload)/baseline-1)*100)<1e-9
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            assert z.testzip() is None
            assert z.infolist()[0].filename=='.mdpkg/manifest.json' and z.infolist()[0].compress_type==0
            package_items=[(e.filename,z.read(e)) for e in z.infolist()]
            for p,b in package_items:
                if p.startswith('.git/'):assert b==(file.parent/'repo.git'/p[5:]).read_bytes()
                member_checks+=1
        mirrors=[(p.replace('.mdpkg/address/','.mdpkg/current/address/'),b) for p,b in items]
        dual=h.archive(package_items+mirrors)
        assert len(dual)==row['with_current_map_copy_bytes']
        assert len(dual)-len(payload)==row['current_map_copy_increment']
        if items:
            digits=json.loads(files['.mdpkg/address/config.json'])['shardHex']
            paths=['.mdpkg/address/config.json']+[f'.mdpkg/address/ids/{p}.json' for p in sorted(set(c['target'][k][:digits] for k in ('section','document')))]
            with zipfile.ZipFile(io.BytesIO(h.archive(items))) as z:
                assert sum(z.getinfo(p).compress_size for p in paths)==row['target_lookup_compressed_bytes']
                assert sum(z.getinfo(p).file_size for p in paths)==row['target_lookup_decoded_bytes']
        archives.append(dict(file=str(file.relative_to(h.ROOT)).replace('\\','/'),bytes=len(payload),sha256=sha(payload)))

result=dict(model_checks=cases['checks'],git_resolution_checks=resolved['checks'],
    native_checks=native['checks'],corpus_source_checks=source_checks,
    corpus_timed_resolution_checks=sum(c['checks'] for c in corpora['corpora']),
    metadata_zip_roundtrips=metadata['zip_roundtrip_checks'],audited_archives=len(archives),
    audited_archive_members=member_checks,archives=archives,failures=0)
h.compression.save(HERE/'verification.json',result)
print(json.dumps({k:v for k,v in result.items() if k!='archives'},indent=2))
