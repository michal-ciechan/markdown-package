"""Refresh only the generated numeric portions of spec section 8."""
import json
from pathlib import Path
here=Path(__file__).resolve().parent
path=here.parent/'spec.md';s=path.read_text(encoding='utf-8')
r=json.loads((here/'worked-example.json').read_text(encoding='utf-8'))
p=r['packages']['squashed']; f=r['packages']['full']
def block(kind,text):return f'```{kind}\n{text.rstrip()}\n```'
out=['### 8.2 Package 2, byte by byte',f"{p['bytes']:,} bytes; SHA-256 `{p['sha256']}`.",
    '| # | Local header | Data | End | Method | Compressed | Raw | CRC32 | Name |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for i,e in enumerate(p['entries']):
    out.append(f"| {i} | {e['local']:,} | {e['data']:,} | {e['end']:,} | {e['method']} | {e['csize']:,} | {e['usize']:,} | `{e['crc']}` | `{e['name']}` |")
table='\n'.join(out[2:]);out=out[:2]+[table]
e=p['eocd'];out += [f"Central directory: offset {e['cd_offset']:,}, {e['cd_size']:,} bytes, {e['count']} records. EOCD: offset {e['eocd']:,}, 22 bytes, zero comment.",
    f"Entries 1–3 are the current tree of `s1`; history entries are container-level; Git entries end with the pack. Current-file payloads end at byte {p['entries'][3]['end']:,}.",
    '**The 79-byte typing read:**',block('text',p['typing_hex']),
    f"**The manifest** ({p['entries'][0]['usize']} bytes):",block('json',p['manifest_bytes']),
    '**History descriptor:**',block('json',json.dumps(p['history'],sort_keys=True,separators=(',',':'))),
    '**Range summary:**',block('json',json.dumps(r['summary'],sort_keys=True,separators=(',',':'))),
    '**Squash bindings:**',block('json',json.dumps(r['bindings'],sort_keys=True,separators=(',',':'))),
    '**Tip tree:**',block('text',p['tree']),
    'HEAD is symbolic to main; the raw main ref equals the SHA-1 portion of `current.id`. Every current payload has the exact blob ID shown above.',
    '**EOCD bytes:**',block('text',p['eocd_hex']),
    f"Package 1 retains the full graph: {f['bytes']:,} bytes, {f['eocd']['count']} entries; SHA-256 `{f['sha256']}`. Its manifest is {f['entries'][0]['usize']} bytes:",block('json',f['manifest_bytes'])]
a=s.index('### 8.2 Package 2, byte by byte');b=s.index('### 8.3',a);s=s[:a]+'\n\n'.join(out)+'\n\n'+s[b:]
a=s.index('### 8.4 Extraction check');b=s.index('### 8.5',a)
s=s[:a]+'''### 8.4 Extraction check

Both generated Git-mode packages pass `git fsck --full --strict`. After
`git read-tree HEAD`, Package 2 has four untracked container-sidecar paths and
Package 1 has two. Every extracted current file matches its retained tip blob;
HEAD equals the SHA-1 portion of the typed `current.id`.

'''+s[b:]
v=json.loads((here.parent/'investigations/deferred-history/breaking-revision-vectors.json').read_text(encoding='utf-8'))
guide=v['vectors'][0]; child=v['transitions'][0]
extra='''### 8.6 Initial snapshot, materialization and changed child

The separate minimal guide example contains exactly the eight bytes `# Guide`
and LF. Its full preimage and both canonical manifests appear in §4–§4.1.
`deferred-history.py` emits its packages and shared vectors; the independent
JavaScript oracle recomputes file/state/tree/commit hashes without a product writer.

'''+f"S0: `{guide['snapshotId']}`. C0: `{guide['bootstrapCommitId']}`.\n\n"+f"The changed child adds `Published change.` to guide.md: `{child['manifest']['current']['id']}`. Its sole parent is C0; origin remains frozen at S0. Reconstructing the origin uses C0's eight-byte file, not the child's current file.\n\n"+'''The active [review fixtures](spec/review-fixtures/README.md) include an initial
snapshot with a ledger and reserved birth, Unicode/nested paths, both delta
state kinds targeting both reviewed kinds, and bundled reviews targeting S0 or
C0. Invalid mode, binding, parent and changed-document/ledger cases are supplied.
Comment-document versions 1/2 and URI/addressing profiles are unchanged.

```powershell
python docs/spec/deferred-history.py
python docs/spec/review-fixtures/generate.py
node docs/spec/verify-deferred-history.mjs
node docs/spec/review-fixtures/verify-unicode.mjs
python docs/spec/verify-fixtures.py
python docs/spec/render-worked-example.py
```

These are draft-2 documentation fixtures, not validation results from the old
application schema. Historical investigation archives and size reports retain
their original interpretation; the new fixture byte counts are not performance
claims.

'''
if '### 8.6 ' in s:
    a=s.index('### 8.6 ');b=s.index('## 9.',a);s=s[:a]+extra+'---\n\n'+s[b:]
else:s=s.replace('## 9. Rejected alternatives',extra+'---\n\n## 9. Rejected alternatives')
path.write_text(s,encoding='utf-8',newline='\n')
