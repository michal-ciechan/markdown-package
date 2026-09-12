"""Regenerate S1 documentation artifacts and require byte-identical output."""
import hashlib, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
fixtures = HERE / 'review-fixtures'
archives = sorted(fixtures.glob('*.mdpkg')) + [fixtures / 'vectors.json']
other = [HERE / 'worked-example.json', HERE / 'link-fixtures.json',
         HERE.parent / 'spec.md',
         HERE.parent / 'investigations/deferred-history/breaking-revision-vectors.json']
other += sorted(p for p in fixtures.glob('*.json') if p.name != 'vectors.json')
paths = archives + other
before = {p:hashlib.sha256(p.read_bytes()).digest() for p in paths}
for script in [HERE / 'worked-example.py', HERE / 'deferred-history.py',
               fixtures / 'generate.py', HERE / 'render-worked-example.py']:
    run = subprocess.run([sys.executable, str(script)], capture_output=True)
    if run.returncode:
        sys.stderr.buffer.write(run.stdout + run.stderr)
        raise SystemExit(run.returncode)
changed = [str(p) for p in paths if hashlib.sha256(p.read_bytes()).digest() != before[p]]
if changed:
    raise SystemExit('Regeneration changed bytes:\n' + '\n'.join(changed))
print(f'{len(archives)} archive/catalog artifacts and {len(other)} documentation/JSON artifacts byte-identical; 0 failures')
