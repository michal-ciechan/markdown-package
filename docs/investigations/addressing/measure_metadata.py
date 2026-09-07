"""Exact ZIP metadata/cache costs, including names and headers, on pinned bases."""
import importlib.util
import io
import json
from pathlib import Path
import zipfile
import uuid

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work';h.WORK=WORK
result=json.loads((HERE/'corpus-results.json').read_text())
input=json.loads((WORK/'corpora.json').read_text())
rows=[];checks=0
run_folder=WORK/'metadata-packs'/uuid.uuid4().hex
for c in result['corpora']:
    original=next(x for x in input if x['corpus']==c['corpus'])
    doc_items=[(d['path'],d['source'].encode()) for d in original['documents']]
    # Comparable actual one-snapshot packed Git, with or without address files.
    folder=run_folder/c['corpus'];source=folder/'source.git';h.init_repo(source)
    for variant in ['none','identity','cached','identity256']:
        metadata={} if variant=='none' else json.loads((WORK/c['metadataFixtures'][variant]).read_text())
        items=[(p,b.encode()) for p,b in sorted(metadata.items())]
        zipped=h.archive(items) if items else b''
        obj={p:h.put(source,'blob',b) for p,b in doc_items+items}
        tree=h.tree(source,obj)
        commit=h.commit(source,tree,None,dict(author='Addressing Probe <probe@example.invalid> 1700000000 +0000',
            committer='Addressing Probe <probe@example.invalid> 1700000000 +0000',message='Base snapshot',source=original['base']))
        packed=folder/variant/'repo.git';h.pack_repo(source,commit,packed)
        manifest=dict(format='mdpkg-addressing-cost',version=1,profile=c['assets']['profile'] if 'assets' in c else result['assets']['profile'],
                      currentCommit=commit,coverage='snapshot-only')
        package_items=[('.mdpkg/manifest.json',h.json_bytes(manifest))]+h.repo_items(packed)
        package=h.archive(package_items)
        digits=json.loads(metadata['.mdpkg/address/config.json'])['shardHex'] if metadata else 2
        prefixes=sorted(set(c['target'][k][:digits] for k in ('section','document')))
        target_paths=['.mdpkg/address/config.json']+[f'.mdpkg/address/ids/{x}.json' for x in prefixes]
        with zipfile.ZipFile(io.BytesIO(package)) as z:
            assert z.testzip() is None
            for p,b in package_items:assert z.read(p)==b;checks+=1
        lookups={}
        if items:
            with zipfile.ZipFile(io.BytesIO(zipped)) as z:
                for p,b in items:assert z.read(p)==b;checks+=1
                lookups=dict(target_lookup_compressed_bytes=sum(z.getinfo(p).compress_size for p in target_paths),
                             target_lookup_decoded_bytes=sum(z.getinfo(p).file_size for p in target_paths),target_entries=len(target_paths))
        # Optional independently compressed current-map copy; it duplicates no Markdown.
        cache=[(p.replace('.mdpkg/address/','.mdpkg/current/address/'),b) for p,b in items]
        dual=h.archive(package_items+cache)
        rows.append(dict(corpus=c['corpus'],variant=variant,raw_metadata_bytes=sum(len(b) for _,b in items),
            standalone_metadata_zip_bytes=len(zipped),packaged_snapshot_bytes=len(package),
            with_current_map_copy_bytes=len(dual),current_map_copy_increment=len(dual)-len(package),
            metadata_entries=len(items),**lookups))
        (folder/variant/'package.zip').write_bytes(package)
for c in ('npm','rust'):
    baseline=next(r['packaged_snapshot_bytes'] for r in rows if r['corpus']==c and r['variant']=='none')
    for row in rows:
        if row['corpus']==c:row['over_no_metadata_pct']=(row['packaged_snapshot_bytes']/baseline-1)*100
summary=(WORK/'range-summary.json').read_bytes();bindings=(WORK/'range-bindings.json').read_bytes()
summary_zip=h.archive([('.mdpkg/history/ranges/'+h.compression.sha(summary)+'.json',summary),('.mdpkg/history/bindings.json',bindings)])
with zipfile.ZipFile(io.BytesIO(summary_zip)) as z:assert z.testzip() is None;checks+=2
output=dict(fixture_directory=str(run_folder.relative_to(h.ROOT)).replace('\\','/'),rows=rows,summary=dict(raw_bytes=len(summary)+len(bindings),zip_bytes=len(summary_zip),
                                  summary_bytes=len(summary),bindings_bytes=len(bindings)),zip_roundtrip_checks=checks)
h.compression.save(HERE/'metadata-results.json',output)
print(json.dumps(output,indent=2))
