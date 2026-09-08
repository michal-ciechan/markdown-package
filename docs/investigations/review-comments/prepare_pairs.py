"""Extract real (before, after) Markdown document revision pairs from the two corpus repositories."""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / '.antiphon/review-work'
WORK.mkdir(parents=True, exist_ok=True)
CORPORA = [('npm', ROOT/'.antiphon/compression-work/npm-cli', 'docs/lib/content', 4000),
           ('rust', ROOT/'.antiphon/compression-work/rust-rfcs', 'text', 1500)]

out = []
for name, repo, prefix, cap in CORPORA:
    raw = subprocess.run(['git','log','--first-parent','--format=%x00%H','--raw','--no-abbrev','--diff-filter=M','--','%s'%prefix],
                         cwd=repo, capture_output=True, text=True, check=True).stdout
    pairs, commit = [], None
    for line in raw.splitlines():
        if line.startswith('\x00'):
            commit = line[1:]
        elif line.startswith(':'):
            meta, path = line.split('\t', 1)
            parts = meta.split()
            old, new = parts[2], parts[3]
            if not path.endswith('.md') or old.startswith('0'*10) or new.startswith('0'*10):
                continue
            pairs.append({'commit': commit, 'path': path, 'a': old, 'b': new})
        if len(pairs) >= cap:
            break
    oids = sorted({o for p in pairs for o in (p['a'], p['b'])})
    blobs = {}
    proc = subprocess.run(['git','cat-file','--batch'], cwd=repo, input=('\n'.join(oids)+'\n').encode(),
                          capture_output=True, check=True)
    buf, i = proc.stdout, 0
    for _ in oids:
        nl = buf.index(b'\n', i)
        oid, kind, size = buf[i:nl].split()
        i = nl + 1
        data = buf[i:i+int(size)]
        i += int(size) + 1
        try:
            blobs[oid.decode()] = data.decode('utf-8')
        except UnicodeDecodeError:
            pass
    pairs = [p for p in pairs if p['a'] in blobs and p['b'] in blobs and blobs[p['a']] != blobs[p['b']]]
    out.append({'corpus': name, 'repo': repo.name, 'pairs': pairs, 'blobs': blobs})
    print(f'{name}: {len(pairs)} modification pairs, {len(blobs)} distinct blobs', file=sys.stderr)
(WORK/'pairs.json').write_text(json.dumps(out))
print(json.dumps({r['corpus']: len(r['pairs']) for r in out}))
