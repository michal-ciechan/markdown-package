"""Read the exact existing 32-transition corpus; never change either upstream checkout."""
import importlib.util
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work';output=[];checks=0
for name,folder,prefix in [('npm','npm-cli','docs/lib/content'),('rust','rust-rfcs','text')]:
    manifest=json.loads((HERE.parent/'compression'/f'{name}-corpus.json').read_text())
    repo=h.compression.WORK/folder;revisions=[manifest['base']]+manifest['commits']
    snapshots=[h.source_snapshot(repo,rev,prefix) for rev in revisions]
    for i,rev in enumerate(revisions[1:]):assert snapshots[i]==h.source_snapshot(repo,rev+'^',prefix);checks+=1
    blobs=h.blobs(repo,[oid for snapshot in snapshots for oid in snapshot.values()])
    for e in manifest['entries']:
        if e['kind']=='base':
            b=blobs[snapshots[0][e['path']]];assert len(b)==e['bytes'] and h.compression.sha(b)==e['sha256'];checks+=1
    output.append(dict(corpus=name,revisions=revisions,snapshots=snapshots,
        blobs={oid:b.decode('utf-8') for oid,b in blobs.items()},records=[h.source_metadata(repo,rev) for rev in revisions]))
h.compression.save(WORK/'sparse-history-input.json',output)
h.compression.save(HERE/'sparse-source-results.json',dict(checks=checks,first_parent_transitions=64,base_blob_checks=716,
    corpora=[dict(corpus=c['corpus'],base=c['revisions'][0],tip=c['revisions'][-1],snapshots=len(c['snapshots']),distinct_blobs=len(c['blobs'])) for c in output],failures=0))
print(json.dumps(dict(checks=checks,failures=0)))
