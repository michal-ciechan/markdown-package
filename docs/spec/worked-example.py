"""Builds the worked example in docs/spec.md and prints every number it quotes.

This is example machinery for the specification, not a format implementation.
It writes two real Git repositories with fixed identities and dates, packages
each as a conforming markdown-package ZIP, and then resolves three section
references before and after a squash using the confirmed-exception ledger.

Run from the repository root:

    python docs/spec/worked-example.py [output-dir]

Requires Git and Python 3.10+. Package bytes are deterministic for a given Git
version; this file was last run with Git 2.50.1 and Python 3.10.2.
"""
import base64
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'worked-example-out'
NAMESPACE = 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8'   # lineage namespace: a fixture value
ANCHOR = 'cm0312-trail-source-v1'
DIGEST = 'cm0312-source-lf-v1'
MAGIC = 'markdown-package/1'
MANIFEST = '.mdpkg/manifest.json'
LEDGER = '.mdpkg/address/overrides.json'
ENV = dict(os.environ,
           GIT_AUTHOR_NAME='Example Author', GIT_AUTHOR_EMAIL='author@example.invalid',
           GIT_COMMITTER_NAME='Example Author', GIT_COMMITTER_EMAIL='author@example.invalid')


# ----------------------------------------------------------------------------
# Git helpers (plumbing only, fixed dates, one thread, level 6, window 10)
# ----------------------------------------------------------------------------
def git(repo, *args, data=None, env=None):
    p = subprocess.run(['git', '-C', str(repo), '-c', 'core.autocrlf=false',
                        '-c', 'core.compression=6', '-c', 'pack.threads=1',
                        '-c', 'pack.window=10', '-c', 'pack.depth=50',
                        '-c', 'pack.writeReverseIndex=false', *args],
                       input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       env=env or ENV)
    if p.returncode:
        raise RuntimeError((args, p.stderr.decode(errors='replace')))
    return p.stdout


def blob(repo, data):
    return git(repo, 'hash-object', '-w', '--stdin', data=data).decode().strip()


def tree(repo, files):
    """files: path -> blob oid. Builds nested trees with mktree, one level at a time."""
    entries, subdirs = [], {}
    for path, oid in files.items():
        head, _, rest = path.partition('/')
        if rest:
            subdirs.setdefault(head, {})[rest] = oid
        else:
            entries.append(f'100644 blob {oid}\t{head}\n')
    for name, sub in subdirs.items():
        entries.append(f'040000 tree {tree(repo, sub)}\t{name}\n')
    return git(repo, 'mktree', data=''.join(sorted(entries)).encode()).decode().strip()


def commit(repo, tree_oid, parent, message, when):
    env = dict(ENV, GIT_AUTHOR_DATE=f'{when} +0000', GIT_COMMITTER_DATE=f'{when} +0000')
    args = ['commit-tree', tree_oid] + (['-p', parent] if parent else []) + ['-m', message]
    return git(repo, *args, env=env).decode().strip()


def curated_repo(source, head, dest):
    """HEAD, non-bare config, one ref, one pack and its index. Nothing else."""
    if dest.exists():
        shutil.rmtree(dest, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    dest.mkdir(parents=True)
    git(dest, 'init', '--bare', '--initial-branch=main', '--template=')
    packed = git(source, 'pack-objects', '--revs', '--stdout', '--delta-base-offset',
                 data=(head + '\n').encode())
    name = packed[-20:].hex()
    (dest / 'objects/pack').mkdir(parents=True, exist_ok=True)
    pack_path = dest / 'objects/pack' / f'pack-{name}.pack'
    pack_path.write_bytes(packed)
    git(dest, 'index-pack', str(pack_path))
    (dest / 'refs/heads/main').write_bytes((head + '\n').encode())
    (dest / 'HEAD').write_bytes(b'ref: refs/heads/main\n')
    (dest / 'config').write_bytes(b'[core]\n\trepositoryformatversion = 0\n\tbare = false\n')
    for extra in ('description', 'info', 'hooks'):
        p = dest / extra
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
    git(dest, 'fsck', '--full', '--strict')
    files = {('.git/' + p.relative_to(dest).as_posix()): p.read_bytes()
             for p in dest.rglob('*') if p.is_file()}
    order = lambda n: (2 if n.endswith('.pack') else 1 if n.endswith('.idx') else 0, n)
    return [(n, files[n]) for n in sorted(files, key=order)]


# ----------------------------------------------------------------------------
# Addressing profiles, exactly as the addressing investigation's model defines them
# ----------------------------------------------------------------------------
def canonical_json(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n')


def sha256(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def canonical_scope(text):
    lines = text.split('\n')
    while lines and lines[-1].strip(' \t') == '':
        lines.pop()
    return '\n'.join(lines) + '\n' if lines else ''


def scoped_digest(kind, source):
    return sha256(f'mdpkg\0{DIGEST}\0{kind}\0{canonical_scope(source)}')


def default_root(locator):
    return sha256(f'mdpkg-default\0{ANCHOR}\0{NAMESPACE}\0{canonical_json(locator)}')


def sections(data):
    """ATX-only outline for this fixture. The fixture has no fences, Setext headings,
    lists or HTML, so this equals the CommonMark top-level-heading outline."""
    text = data.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
    assert '```' not in text and '<' not in text
    lines = text.split('\n')
    heads = [(i, len(l) - len(l.lstrip('#'))) for i, l in enumerate(lines)
             if l.startswith('#') and l.lstrip('#').startswith(' ')]
    out = [dict(kind='preamble', start=0, end=heads[0][0] if heads else len(lines), parent=None)]
    stack = []
    for n, (start, level) in enumerate(heads):
        while stack and heads[stack[-1]][1] >= level:
            stack.pop()
        end = next((s for s, lv in heads[n + 1:] if lv <= level), len(lines))
        out.append(dict(kind='section', start=start, end=end, level=level,
                        parent=stack[-1] if stack else None, title=lines[start]))
        stack.append(n)
    for s in out:
        s['source'] = '\n'.join(lines[s['start']:s['end']])
        s['digest'] = scoped_digest(s['kind'], s['source'])
    return text, out


def inventory(path, data):
    """Locator -> (root, digest) for every entity of one document."""
    text, secs = sections(data)
    rows = [dict(locator=['document', path, []], digest=scoped_digest('document', text))]
    trails, counts = [], {}
    for s in secs:
        if s['kind'] == 'preamble':
            rows.append(dict(locator=['preamble', path, []], digest=s['digest']))
            continue
        parent = [] if s['parent'] is None else trails[s['parent']]
        key = json.dumps([parent, s['title']])
        occ = counts.get(key, 0)
        counts[key] = occ + 1
        trail = parent + [[s['title'], occ]]
        trails.append(trail)
        rows.append(dict(locator=['section', path, trail], digest=s['digest']))
    for r in rows:
        r['slot'] = default_root(r['locator'])
    return rows


def snapshot_inventory(files):
    inv = {}
    for path, data in files.items():
        if path.endswith('.md'):
            for r in inventory(path, data):
                inv[r['slot']] = r
    return inv


def reference(root, row):
    loc = base64.urlsafe_b64encode(canonical_json(row['locator']).encode()).decode().rstrip('=')
    kind = 'document' if row['locator'][0] == 'document' else 'section'
    return (f'mdpkg://{NAMESPACE}/v2/{kind}/{root}?anchor={ANCHOR}&profile={DIGEST}'
            f'&expect={row["digest"]}&loc={loc}')


def resolve(ref_root, ref_locator, ref_expect, inv, overrides):
    """The current-reference resolution procedure of spec section 6.5."""
    entry = overrides.get(ref_root)
    if entry and 'dead' in entry:
        return dict(status='flagged-changed', reason=entry['dead'], successors=entry.get('next', []))
    if entry and 'unknown' in entry:
        return dict(status='unconfirmed', reason=entry['unknown'])
    if not entry and ref_root != default_root(ref_locator):
        return dict(status='unconfirmed', reason='missing-override')
    target = default_root(entry['to']) if entry else ref_root
    v = inv.get(target)
    if not v:
        return dict(status='unconfirmed', reason='possibly-renamed-moved-or-deleted')
    same = v['digest'] == ref_expect
    return dict(status='survives' if same else 'flagged-changed',
                reason='same-source' if same else 'source-changed',
                locator=v['locator'], actual=v['digest'])


# ----------------------------------------------------------------------------
# ZIP assembly, the same deterministic writer the investigations measured
# ----------------------------------------------------------------------------
def manifest_bytes(obj):
    rest = json.dumps({k: v for k, v in obj.items() if k != 'mdpkg'}, sort_keys=True,
                      separators=(',', ':'), ensure_ascii=False)
    return ('{"mdpkg":' + json.dumps(MAGIC) + ',' + rest[1:] + '\n').encode()


def assemble(items):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', allowZip64=False) as z:
        for name, data in items:
            method = 0 if (name == MANIFEST or name.endswith(('.pack', '.idx'))
                           or len(zlib.compress(data, 6)) >= len(data)) else 8
            info = zipfile.ZipInfo(name)          # date_time 1980-01-01, no extra field
            info.compress_type = method
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, data, compress_type=method, compresslevel=6)
    return b.getvalue()


def entry_table(data):
    rows = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for i in z.infolist():
            off = i.header_offset
            nlen = int.from_bytes(data[off + 26:off + 28], 'little')
            elen = int.from_bytes(data[off + 28:off + 30], 'little')
            start = off + 30 + nlen + elen
            rows.append(dict(name=i.filename, local=off, data=start, method=i.compress_type,
                             csize=i.compress_size, usize=i.file_size, crc=f'{i.CRC:08x}',
                             end=start + i.compress_size, flags=int.from_bytes(data[off + 6:off + 8], 'little')))
    p = len(data) - 22
    assert data[p:p + 4] == b'PK\x05\x06'
    count, cd_size, cd_off = struct.unpack_from('<HII', data, p + 10)
    comment = struct.unpack_from('<H', data, p + 20)[0]
    return rows, dict(eocd=p, count=count, cd_size=cd_size, cd_offset=cd_off, comment=comment)


def hexdump(b, base=0):
    out = []
    for i in range(0, len(b), 16):
        chunk = b[i:i + 16]
        out.append(f'{base + i:06x}  {chunk.hex(" "):<47}  '
                   + ''.join(chr(c) if 32 <= c < 127 else '.' for c in chunk))
    return '\n'.join(out)


# ----------------------------------------------------------------------------
# The fixture
# ----------------------------------------------------------------------------
GUIDE_0 = b"""# Guide

Read this before the notes.

## Setup

Install the tool, then run `init`.

## Usage

Run `build` to produce a package.
"""
GUIDE_1 = GUIDE_0.replace(b"Run `build` to produce a package.\n",
                          b"Run `build` to produce a package.\nRun `check` to validate it.\n")
GUIDE_2 = GUIDE_1.replace(b"## Setup\n", b"## Installation\n")
NOTES_0 = b"""# Notes

## Todo

- write the guide
"""


def main():
    if OUT.exists():
        shutil.rmtree(OUT, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    OUT.mkdir(parents=True)
    src = OUT / 'source.git'
    src.mkdir()
    git(src, 'init', '--bare', '--initial-branch=main', '--template=')

    # Base, two commits. The rename at c2 is confirmed by the producer and recorded
    # in the tracked ledger, in the same commit as the rename.
    snap0 = {'guide.md': GUIDE_0, 'notes.md': NOTES_0}
    snap1 = {'guide.md': GUIDE_1, 'notes.md': NOTES_0}
    inv0, inv1 = snapshot_inventory(snap0), snapshot_inventory(snap1)
    setup_root = default_root(['section', 'guide.md', [['# Guide', 0], ['## Setup', 0]]])
    ledger = {'version': 1, 'anchor': ANCHOR, 'entries': {
        setup_root: {'to': ['section', 'guide.md', [['# Guide', 0], ['## Installation', 0]]]}}}
    ledger_bytes = canonical_json(ledger).encode()
    snap2 = {'guide.md': GUIDE_2, 'notes.md': NOTES_0, LEDGER: ledger_bytes}
    inv2 = snapshot_inventory(snap2)

    oids = {}
    for snap in (snap0, snap1, snap2):
        for p, d in snap.items():
            oids[(p, sha256(d))] = blob(src, d)
    t0, t1, t2 = (tree(src, {p: oids[(p, sha256(d))] for p, d in snap.items()})
                  for snap in (snap0, snap1, snap2))
    c0 = commit(src, t0, None, 'Base: guide and notes', 1700000000)
    c1 = commit(src, t1, c0, 'Document the check command', 1700000100)
    c2 = commit(src, t2, c1, 'Rename Setup to Installation', 1700000200)
    s1 = commit(src, t2, c0, 'Squash: check command; rename Setup to Installation', 1700000300)
    assert git(src, 'rev-parse', f'{c2}^{{tree}}').decode().strip() == \
        git(src, 'rev-parse', f'{s1}^{{tree}}').decode().strip() == t2

    # Range summary for the squash, keyed by origin root, first-parent walk c0 -> c1 -> c2.
    def state_digest(inv):
        return sha256(canonical_json({root: r['digest'] for root, r in inv.items()}))
    roots1 = {root: root for root in inv1}               # every entity still at its default
    roots2 = {root: root for root in inv2}
    roots2[setup_root] = setup_root                       # exceptional: reached via ledger
    del roots2[default_root(ledger['entries'][setup_root]['to'])]
    def digest_by_root(inv, roots, overrides):
        out = {}
        for root in roots:
            e = overrides.get(root)
            slot = default_root(e['to']) if e else root
            out[root] = inv[slot]['digest']
        return out
    d0 = digest_by_root(inv0, {r: r for r in inv0}, {})
    d1 = digest_by_root(inv1, roots1, {})
    d2 = digest_by_root(inv2, roots2, ledger['entries'])
    changed_at = {}
    for root in sorted(set(d0) | set(d1) | set(d2)):
        for n, (a, b) in enumerate(((d0, d1), (d1, d2)), start=1):
            if a.get(root) != b.get(root):
                changed_at.setdefault(root, []).append(n)
    summary = {'version': 1, 'namespace': NAMESPACE, 'anchor': ANCHOR, 'profile': DIGEST,
               'walk': 'first-parent', 'coverage': 'complete',
               'base': 'sha1-' + c0, 'tip': 'sha1-' + c2,
               'sourceCommits': ['sha1-' + c1, 'sha1-' + c2], 'collapsedInputs': ['sha1-' + c1, 'sha1-' + c2],
               'beforeStateDigest': sha256(canonical_json(d0)), 'afterStateDigest': sha256(canonical_json(d2)),
               'nested': [], 'contentTouched': sorted(changed_at), 'changedAt': changed_at,
               'endpoints': {r: {'before': d0.get(r), 'after': d2.get(r)} for r in sorted(changed_at)},
               'identityEvents': []}
    summary_bytes = canonical_json(summary).encode()
    summary_name = f'.mdpkg/history/ranges/{sha256(summary_bytes)}.json'
    bindings = {'version': 1, 'bindings': [
        {'emitted': 'sha1-' + s1, 'summary': summary_name, 'hash': sha256(summary_bytes)}]}
    bindings_bytes = canonical_json(bindings).encode()

    packages = {}
    for label, head, transform, retained, history_extra in (
            ('full', c2, [], [c0, c1, c2], {}),
            ('squashed', s1, ['squashed'], [c0, s1],
             {'transformations': [{'kind': 'squashed', 'sourceBase': 'sha1-' + c0,
                                   'sourceTip': 'sha1-' + c2, 'emitted': 'sha1-' + s1,
                                   'summary': summary_name}],
              'ranges': [summary_name], 'bindings': '.mdpkg/history/bindings.json'})):
        repo_items = curated_repo(src, head, OUT / f'{label}.git')
        manifest = {'mdpkg': MAGIC, 'namespace': NAMESPACE, 'current': 'sha1-' + head,
                    'addressing': {'anchor': ANCHOR, 'digest': DIGEST, 'coverage': 'complete',
                                   'overrides': LEDGER},
                    'history': {'coverage': 'complete', 'transform': transform,
                                'detail': '.mdpkg/history.json'}}
        history = {'walk': 'first-parent', 'root': 'original', 'shallowBoundaries': [],
                   'retainedCommits': len(retained),
                   'sourceBase': 'sha1-' + c0, 'sourceTip': 'sha1-' + (c2 if label == 'full' else c2),
                   'addressingCoverage': [{'from': 'sha1-' + c0, 'to': 'sha1-' + head, 'coverage': 'complete'}],
                   'transformations': [], 'ranges': [], 'patches': []}
        history.update(history_extra)
        items = [(MANIFEST, manifest_bytes(manifest))]
        items += sorted(snap2.items())
        items += [('.mdpkg/history.json', canonical_json(history).encode())]
        if label == 'squashed':
            items += [('.mdpkg/history/bindings.json', bindings_bytes), (summary_name, summary_bytes)]
        items += repo_items
        data = assemble(items)
        (OUT / f'{label}.mdpkg').write_bytes(data)
        rows, eocd = entry_table(data)
        packages[label] = dict(head=head, manifest=manifest, manifest_bytes=manifest_bytes(manifest).decode(),
                               history=history, bytes=len(data), sha256=sha256(data), entries=rows, eocd=eocd,
                               typing_hex=hexdump(data[:79]), eocd_hex=hexdump(data[eocd['eocd']:], eocd['eocd']),
                               tree=git(OUT / f'{label}.git', 'ls-tree', '-r', head).decode())

    # Three reviews recorded at c1, resolved against the squashed package (tree t2).
    usage_root = default_root(['section', 'guide.md', [['# Guide', 0], ['## Usage', 0]]])
    todo_root = default_root(['section', 'notes.md', [['# Notes', 0], ['## Todo', 0]]])
    reviews = {}
    for name, root in (('setup', setup_root), ('usage', usage_root), ('todo', todo_root)):
        row = inv1[root]
        reviews[name] = dict(root=root, locator=row['locator'], expect=row['digest'],
                             reviewedAt='sha1-' + c1, uri=reference(root, row),
                             with_ledger=resolve(root, row['locator'], row['digest'], inv2, ledger['entries']),
                             without_ledger=resolve(root, row['locator'], row['digest'], inv2, {}),
                             touched_after_review=[n for n in changed_at.get(root, []) if n > 1])

    # Extraction check: the plain entries are the working tree of `current`.
    verification = {}
    for label, pkg in packages.items():
        dest = OUT / f'extract-{label}'
        with zipfile.ZipFile(OUT / f'{label}.mdpkg') as z:
            z.extractall(dest)
            for info in z.infolist():
                if not info.filename.startswith(('.git/', '.mdpkg/manifest.json', '.mdpkg/history')):
                    raw = z.read(info)
                    oid = hashlib.sha1(b'blob %d\0' % len(raw) + raw).hexdigest()
                    assert f' {oid}\t{info.filename}' in pkg['tree'], info.filename
        before = git(dest, 'status', '--porcelain', '--untracked-files=all').decode().splitlines()
        git(dest, 'read-tree', 'HEAD')
        after = git(dest, 'status', '--porcelain', '--untracked-files=all').decode().splitlines()
        git(dest, 'fsck', '--full', '--strict')
        head = git(dest, 'rev-parse', 'HEAD').decode().strip()
        assert head == pkg['head'] == pkg['manifest']['current'][5:]
        assert all(line.startswith('?? .mdpkg/') for line in after), after
        verification[label] = dict(status_lines_before_read_tree=len(before),
                                   untracked_after_read_tree=[l[3:] for l in after],
                                   head=head, fsck='clean', blob_bindings='verified')

    result = dict(namespace=NAMESPACE, commits=dict(c0=c0, c1=c1, c2=c2, s1=s1),
                  verification=verification,
                  trees=dict(t0=t0, t1=t1, t2=t2),
                  blobs={f'{p}@{h[:8]}': o for (p, h), o in oids.items()},
                  ledger=ledger, ledger_bytes=ledger_bytes.decode(),
                  summary=summary, summary_name=summary_name, bindings=bindings,
                  inventories={'c1': {r: dict(locator=v['locator'], digest=v['digest']) for r, v in inv1.items()},
                               'c2': {r: dict(locator=v['locator'], digest=v['digest']) for r, v in inv2.items()}},
                  reviews=reviews, packages=packages)
    (HERE / 'worked-example.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    # Human-readable report
    print(f'namespace {NAMESPACE}')
    print(f'c0 {c0}\nc1 {c1}\nc2 {c2}\ns1 {s1}\nt0 {t0}\nt1 {t1}\nt2 {t2}')
    for (p, h), o in sorted(oids.items()):
        print(f'blob {o} {p} (content sha256 {h[:8]})')
    print('\n== ledger ==\n' + ledger_bytes.decode())
    print('== summary ==\n' + summary_bytes.decode())
    print('== bindings ==\n' + bindings_bytes.decode())
    for label, pkg in packages.items():
        print(f'\n== package {label}: {pkg["bytes"]} bytes, sha256 {pkg["sha256"]} ==')
        print('manifest: ' + pkg['manifest_bytes'].rstrip())
        print('history.json: ' + canonical_json(pkg['history']).rstrip())
        print(f'{"#":>2} {"local":>6} {"data":>6} {"end":>6} m {"csize":>6} {"usize":>6} crc      name')
        for n, r in enumerate(pkg['entries']):
            print(f'{n:>2} {r["local"]:>6} {r["data"]:>6} {r["end"]:>6} {r["method"]} {r["csize"]:>6} {r["usize"]:>6} {r["crc"]} {r["name"]}')
        e = pkg['eocd']
        print(f'central directory at {e["cd_offset"]}, {e["cd_size"]} bytes, {e["count"]} records; EOCD at {e["eocd"]}, comment {e["comment"]} bytes')
        print('typing read (79 bytes):\n' + pkg['typing_hex'])
        print('EOCD:\n' + pkg['eocd_hex'])
        print('tip tree:\n' + pkg['tree'].rstrip())
    print('\n== reviews recorded at c1, resolved against the squashed package ==')
    for name, r in reviews.items():
        print(f'\n[{name}] root {r["root"]}\n  locator {json.dumps(r["locator"])}\n  expect  {r["expect"]}')
        print(f'  uri     {r["uri"]}')
        print(f'  with ledger:    {json.dumps(r["with_ledger"])}')
        print(f'  without ledger: {json.dumps(r["without_ledger"])}')
        print(f'  touched after review (ordinals > 1): {r["touched_after_review"]}')
    print('\n== extraction check ==')
    for label, v in verification.items():
        print(f'{label}: {v}')
    print('\n== c2 inventory ==')
    for root, v in inv2.items():
        print(f'{root} {v["digest"]} {json.dumps(v["locator"])}')


if __name__ == '__main__':
    main()
