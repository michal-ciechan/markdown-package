"""Price sparse and full identity metadata with identical Markdown per comparison.

Same real Git object/pack + exact ZIP helpers as the initial addressing report.
All repositories use fresh task-owned directories; no recursive cleanup required.
"""
import importlib.util
import io
import json
from pathlib import Path
import uuid
import zipfile
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work';h.WORK=WORK
data=json.loads((WORK/'sparse-storage-plan.json').read_text(encoding='utf-8'))
folder=WORK/'sparse-packs'/uuid.uuid4().hex;source=folder/'source.git';h.init_repo(source)
for oid,text in data['objects'].items():assert h.put(source,'blob',text.encode())==oid
rows=[];entry_checks=0;snapshot_checks=0
for plan in data['plans']:
    for mode in ('none','sparse','identity'):
        sequence=[];trees=[]
        for snapshot,record in zip(plan['snapshots'],plan['records']):
            assert not (snapshot['documents'].keys()&snapshot['metadata'][mode].keys())
            files=dict(snapshot['documents'],**snapshot['metadata'][mode]);tree=h.tree(source,files)
            sequence.append(h.commit(source,tree,sequence[-1] if sequence else None,record));trees.append(tree);snapshot_checks+=1
        scenarios=[('snapshot',sequence[-1])]
        if plan['scenario']=='history32':
            scenarios=[('full32',sequence[-1]),('squash32',h.commit(source,trees[-1],sequence[0],dict(plan['records'][-1],message='Squash 32 fixture transitions'))),
                       ('later-root',h.commit(source,trees[-1],None,dict(plan['records'][-1],message='Later fixture snapshot')))]
        for history_mode,head in scenarios:
            dest=folder/plan['corpus']/plan['scenario']/str(plan['rate'])/mode/history_mode
            packed=dest/'repo.git';h.pack_repo(source,head,packed)
            if plan['scenario']=='exact-base':
                manifest=dict(format='mdpkg-addressing-cost',version=1,profile='cm0312-source-lf-v1',currentCommit=head,coverage='snapshot-only')
            else:
                manifest=dict(format='mdpkg-sparse-cost',version=1,profile='cm0312-source-lf-v1',currentCommit=head,
                    sourceBase=plan['records'][0]['source'],sourceTip=plan['records'][-1]['source'],
                    walk='first-parent',history=history_mode,syntheticEvents=plan['count'],sourceCorrespondence='partial')
            if mode=='sparse':manifest['anchor']='cm0312-trail-source-v1'
            items=[('.mdpkg/manifest.json',h.json_bytes(manifest))]+h.repo_items(packed)
            package=h.archive(items);file=dest/'package.zip';file.write_bytes(package)
            with zipfile.ZipFile(io.BytesIO(package)) as z:
                assert z.testzip() is None
                assert z.infolist()[0].filename=='.mdpkg/manifest.json' and z.infolist()[0].compress_type==0
                for p,b in items:assert z.read(p)==b;entry_checks+=1
            final=plan['snapshots'][-1]['metadata'][mode]
            map_items=[(p,data['objects'][oid].encode()) for p,oid in sorted(final.items())]
            map_zip=h.archive(map_items) if map_items else b''
            row=dict(corpus=plan['corpus'],scenario=plan['scenario'],rate=plan['rate'],events=plan['count'],mode=mode,history=history_mode,
                bytes=len(package),sha256=h.compression.sha(package),metadata_raw_bytes=sum(len(b) for _,b in map_items),
                metadata_zip_bytes=len(map_zip),metadata_members=len(map_items),commit=head,
                file=str(file.relative_to(h.ROOT)).replace('\\','/'))
            rows.append(row)
    print(json.dumps(dict(corpus=plan['corpus'],scenario=plan['scenario'],rate=plan['rate'],packages=len(rows))),flush=True)
for row in rows:
    base=next(r for r in rows if all(r[k]==row[k] for k in ('corpus','scenario','rate','history')) and r['mode']=='none')
    row['metadata_increment']=row['bytes']-base['bytes'];row['over_baseline_pct']=(row['bytes']/base['bytes']-1)*100
prior=json.loads((HERE/'metadata-results.json').read_text())
for corpus in ('npm','rust'):
    for mode in ('none','identity'):
        expected=next(r['packaged_snapshot_bytes'] for r in prior['rows'] if r['corpus']==corpus and r['variant']==mode)
        for r in rows:
            if r['corpus']==corpus and r['scenario']=='exact-base' and r['mode']==mode:assert r['bytes']==expected
output=dict(rows=rows,packed_repositories=len(rows),zip_entry_checks=entry_checks,authored_snapshot_constructions=snapshot_checks,
            prior_exact_size_equalities=12,failures=0)
h.compression.save(HERE/'sparse-size-results.json',output)
print(json.dumps({k:v for k,v in output.items() if k!='rows'},indent=2))
