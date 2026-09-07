"""Reuse the exact base blobs pinned by CARD-0002 for metadata-size measurements."""
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
work=h.ROOT/'.antiphon/addressing-work'
rows=[]
for name,folder in [('npm','npm-cli'),('rust','rust-rfcs')]:
    manifest=json.loads((HERE.parent/'compression'/f'{name}-corpus.json').read_text())
    entries=[e for e in manifest['entries'] if e['kind']=='base']
    repo=h.compression.WORK/folder
    snapshot=h.source_snapshot(repo,manifest['base'],'docs/lib/content' if name=='npm' else 'text')
    blobs=h.blobs(repo,snapshot.values());docs=[]
    for e in entries:
        b=blobs[snapshot[e['path']]]
        assert len(b)==e['bytes'] and h.compression.sha(b)==e['sha256']
        docs.append(dict(path=e['path'],source=b.decode(),sha256=e['sha256']))
    target=next(e for e in sorted(entries,key=lambda e:e['key'],reverse=True) if 1024<=e['bytes']<=8192)
    rows.append(dict(corpus=name,base=manifest['base'],documents=docs,target=target['path']))
h.compression.save(work/'corpora.json',rows)
print(json.dumps({r['corpus']:len(r['documents']) for r in rows}))
