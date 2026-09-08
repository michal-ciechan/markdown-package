"""Round-trip probe: package identity stability, and the size of a review package
in its delta-only and delta-plus-original shapes.

Reuses docs/spec/worked-example.py's deterministic Git and ZIP writers unchanged,
so every byte count here is produced by the same emitter the specification measured.

Run from the repository root:  python docs/investigations/review-comments/roundtrip.py
"""
import base64
import hashlib
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.antiphon/review-work/roundtrip'
spec = importlib.util.spec_from_file_location('worked', ROOT / 'docs/spec/worked-example.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

NS = w.NAMESPACE
REVIEW_NS = 'd2c3b4a5-6f70-4b81-9c02-b3c4d5e6f708'


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def cj(obj):
    return w.canonical_json(obj).encode()


def build_repo(name, snapshots):
    """snapshots: list of (files dict, message, timestamp). Returns (repo, [commit oids])."""
    repo = OUT / name
    if repo.exists():
        shutil.rmtree(repo, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    repo.mkdir(parents=True)
    w.git(repo, 'init', '--bare', '--initial-branch=main', '--template=')
    parent, oids = None, []
    for files, message, when in snapshots:
        blobs = {p: w.blob(repo, d) for p, d in files.items()}
        parent = w.commit(repo, w.tree(repo, blobs), parent, message, when)
        oids.append(parent)
    return repo, oids


def package(repo, head, files, manifest_extra, history):
    items = [(w.MANIFEST, w.manifest_bytes(dict(
        {'mdpkg': w.MAGIC, 'namespace': NS, 'current': 'sha1-' + head,
         'addressing': {'anchor': w.ANCHOR, 'digest': w.DIGEST, 'coverage': 'complete',
                        'overrides': None},
         'history': history}, **manifest_extra)))]
    items += [(p, d) for p, d in sorted(files.items())]
    items += [('.mdpkg/history.json', cj(dict(walk='first-parent', root='original',
                                              retainedCommits=history['retained'],
                                              shallowBoundaries=[], transformations=[],
                                              ranges=[], patches=[],
                                              addressingCoverage=[])))]
    items += w.curated_repo(repo, head, OUT / (repo.name + '-curated'))
    return w.assemble(items)


# ---------------------------------------------------------------------------
# 1. Package identity: what is stable, what is not
# ---------------------------------------------------------------------------
GUIDE, NOTES = w.GUIDE_0, w.NOTES_0
GUIDE_NEXT = GUIDE.replace(b'Run `build` to produce a package.\n',
                           b'Run `build` to produce a package.\nRun `check` to validate it.\n')
snaps = [({'guide.md': GUIDE, 'notes.md': NOTES}, 'base', 1700000000),
         ({'guide.md': GUIDE_NEXT, 'notes.md': NOTES}, 'add check line', 1700000100)]

repo_a, oids_a = build_repo('run-a', snaps)
repo_b, oids_b = build_repo('run-b', snaps)          # independent production run, same inputs
files_tip = {'guide.md': GUIDE_NEXT, 'notes.md': NOTES}
hist_full = {'coverage': 'complete', 'detail': '.mdpkg/history.json', 'transform': [], 'retained': 2}
hist_trunc = {'coverage': 'truncated', 'detail': '.mdpkg/history.json', 'transform': [], 'retained': 1}

pkg_a = package(repo_a, oids_a[-1], files_tip, {}, hist_full)
pkg_b = package(repo_b, oids_b[-1], files_tip, {}, hist_full)

# Same tip commit, different retained history: a second producer run that truncated.
repo_c, oids_c = build_repo('run-c', snaps[1:])       # tip only, synthetic root
pkg_c = package(repo_c, oids_c[-1], files_tip, {}, hist_trunc)

# Same content and same current, different pack layout (a legitimate re-emission).
repo_d, oids_d = build_repo('run-d', snaps)
w.git(repo_d, '-c', 'pack.window=250', 'repack', '-a', '-d', '-f')
pkg_d = package(repo_d, oids_d[-1], files_tip, {}, hist_full)

# Same content, same current, re-emitted by a different but conforming writer.
items_e = [(w.MANIFEST, w.manifest_bytes({'mdpkg': w.MAGIC, 'namespace': NS,
            'current': 'sha1-' + oids_a[-1],
            'addressing': {'anchor': w.ANCHOR, 'digest': w.DIGEST, 'coverage': 'complete',
                           'overrides': None}, 'history': hist_full}))]
import io as _io, zipfile as _zip, zlib as _zlib
with _zip.ZipFile(_io.BytesIO(pkg_a)) as _z:
    entries_a = [(i.filename, _z.read(i.filename)) for i in _z.infolist()]
buf = _io.BytesIO()
with _zip.ZipFile(buf, 'w', allowZip64=False) as z:                 # level 9, same entries and order
    for name, data in entries_a:
        method = 0 if (name == w.MANIFEST or name.endswith(('.pack', '.idx'))
                       or len(_zlib.compress(data, 9)) >= len(data)) else 8
        info = _zip.ZipInfo(name)
        info.compress_type = method
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        z.writestr(info, data, compress_type=method, compresslevel=9)
pkg_e = buf.getvalue()

# Two productions of identical content one second apart, with real commit timestamps.
snaps_t1 = [({'guide.md': GUIDE, 'notes.md': NOTES}, 'base', 1700000000),
            ({'guide.md': GUIDE_NEXT, 'notes.md': NOTES}, 'add check line', 1700000101)]
repo_f, oids_f = build_repo('run-f', snaps_t1)
pkg_f = package(repo_f, oids_f[-1], files_tip, {}, hist_full)

identity = {
    'twoRunsSameInputs': {
        'currentEqual': oids_a[-1] == oids_b[-1],
        'bytesEqual': pkg_a == pkg_b,
        'sizeA': len(pkg_a), 'sizeB': len(pkg_b),
        'sha256A': sha(pkg_a), 'sha256B': sha(pkg_b)},
    'sameTipTruncatedHistory': {
        'currentEqual': oids_a[-1] == oids_c[-1],
        'currentA': oids_a[-1], 'currentC': oids_c[-1],
        'tipTreeEqual': w.git(repo_a, 'rev-parse', oids_a[-1] + '^{tree}') ==
                        w.git(repo_c, 'rev-parse', oids_c[-1] + '^{tree}'),
        'bytesEqual': pkg_a == pkg_c, 'sizeA': len(pkg_a), 'sizeC': len(pkg_c),
        'sha256C': sha(pkg_c)},
    'repackedSameCurrent': {
        'currentEqual': oids_a[-1] == oids_d[-1],
        'bytesEqual': pkg_a == pkg_d, 'sizeD': len(pkg_d), 'sha256D': sha(pkg_d)},
    'reemittedLevel9': {
        'entryPayloadsEqual': True,
        'bytesEqual': pkg_a == pkg_e, 'sizeE': len(pkg_e), 'sha256E': sha(pkg_e),
        'currentEqual': True},
    'sameContentOneSecondApart': {
        'currentEqual': oids_a[-1] == oids_f[-1],
        'currentF': oids_f[-1],
        'tipTreeEqual': w.git(repo_a, 'rev-parse', oids_a[-1] + '^{tree}') ==
                        w.git(repo_f, 'rev-parse', oids_f[-1] + '^{tree}'),
        'bytesEqual': pkg_a == pkg_f, 'sha256F': sha(pkg_f)},
}

# ---------------------------------------------------------------------------
# 2. Review payloads
# ---------------------------------------------------------------------------
BODY = ('This paragraph asserts a default the surrounding text never states; either name the '
        'default here or drop the sentence, because a reader cannot tell which applies. ')


def anchor_for(doc_path, data, index, quote_len=40, ctx=40):
    """A concrete sub-section anchor over a real document, as section 3 of the design defines it."""
    text, secs = w.sections(data)
    sect = [s for s in secs if s['kind'] == 'section'] or secs
    s = sect[index % len(sect)]
    body = w.canonical_scope(s['source'])
    start = min(max(0, len(body) // 3), max(0, len(body) - quote_len))
    quote = body[start:start + quote_len]
    return dict(start=start, end=start + len(quote), quote=quote,
                occurrence=body[:start].count(quote),
                prefix=body[max(0, start - ctx):start],
                suffix=body[start + len(quote):start + len(quote) + ctx])


def thread(root, locator, expect, anchor, n_comments, body_len):
    return {
        'id': sha(root + str(n_comments))[:32],
        'root': root,
        'loc': base64.urlsafe_b64encode(cj(locator)).decode().rstrip('='),
        'expect': expect,
        'select': anchor,
        'comments': [{'id': sha(root + str(i))[:16],
                      'at': f'2026-09-0{1 + i % 8}T10:0{i % 6}:00Z',
                      'author': 'reviewer@example.invalid',
                      'body': ((sha(root + 'body' + str(i)) + ' ' + BODY) * 4)[:body_len]}
                     for i in range(n_comments)],
        'state': 'open'}


def review_doc(link, threads):
    return {'version': 1, 'namespace': REVIEW_NS, 'anchor': w.ANCHOR, 'profile': w.DIGEST,
            'reviewOf': link, 'threads': threads}


def link_block(pkg_bytes, current, retained, namespace=NS):
    return {'namespace': namespace, 'current': 'sha1-' + current,
            'packageDigest': 'sha256-' + sha(pkg_bytes),
            'packageBytes': len(pkg_bytes), 'retainedCommits': retained}


def make_threads(docs, count, comments_per_thread=2, body_len=len(BODY), targets=None):
    if targets is not None:
        return [thread(t['root'], t['locator'], t['expect'], t['select'],
                       comments_per_thread, body_len) for t in targets[:count]]
    out, i = [], 0
    while len(out) < count:
        path, data = docs[i % len(docs)]
        inv = w.inventory(path, data)
        rows = [r for r in inv if r['locator'][0] == 'section'] or inv
        r = rows[(i // len(docs)) % len(rows)]
        out.append(thread(r['slot'], r['locator'], r['digest'],
                          anchor_for(path, data, i // len(docs)), comments_per_thread, body_len))
        i += 1
    return out


def review_packages(label, docs, original_pkg, original_repo, original_head, retained, counts, targets=None):
    rows = []
    for n in counts:
        threads = make_threads(docs, n, targets=targets)
        link = link_block(original_pkg, original_head, retained)
        doc = cj(review_doc(link, threads))
        # (a) delta-only: a package whose tracked content is the review document itself
        repo, oids = build_repo(f'{label}-review-{n}',
                                [({'.mdpkg/review/comments.json': doc}, 'review', 1700001000)])
        delta = package(repo, oids[-1], {'.mdpkg/review/comments.json': doc},
                        {}, {'coverage': 'complete', 'detail': '.mdpkg/history.json',
                             'transform': [], 'retained': 1})
        # (b) delta plus original: the original working tree and history, with the review added
        files = dict(docs)
        files['.mdpkg/review/comments.json'] = doc
        repo2, oids2 = build_repo(f'{label}-merged-{n}',
                                  [(dict(docs), 'original', 1700000000), (files, 'review', 1700001000)])
        merged = package(repo2, oids2[-1], files, {},
                         {'coverage': 'complete', 'detail': '.mdpkg/history.json',
                          'transform': [], 'retained': 2})
        anchor_bytes = sum(len(cj(t['select'])) for t in threads)
        comment_bytes = sum(len(c['body']) for t in threads for c in t['comments'])
        ident_bytes = sum(len(t['root']) + len(t['loc']) + len(t['expect']) for t in threads)
        rows.append(dict(threads=n, comments=n * 2, reviewJsonBytes=len(doc),
                         anchorBytes=anchor_bytes, identityBytes=ident_bytes,
                         commentTextBytes=comment_bytes,
                         deltaOnlyBytes=len(delta), mergedBytes=len(merged),
                         originalBytes=len(original_pkg),
                         deltaOverOriginalPct=round(100 * len(delta) / len(original_pkg), 2),
                         mergedOverOriginalPct=round(100 * len(merged) / len(original_pkg), 2)))
    return rows


fixture_docs = [('guide.md', GUIDE_NEXT), ('notes.md', NOTES)]
fixture_rows = review_packages('fixture', fixture_docs, pkg_a, repo_a, oids_a[-1], 2, [1, 5, 20])

corpora = json.loads((ROOT / '.antiphon/addressing-work/corpora.json').read_text())
npm = next(c for c in corpora if c['corpus'] == 'npm')
npm_docs = [(d['path'], d['source'].encode()) for d in npm['documents']]
repo_npm, oids_npm = build_repo('npm-base', [(dict(npm_docs), 'npm base snapshot', 1700000000)])
pkg_npm = package(repo_npm, oids_npm[-1], dict(npm_docs), {},
                  {'coverage': 'complete', 'detail': '.mdpkg/history.json', 'transform': [], 'retained': 1})
with _zip.ZipFile(_io.BytesIO(pkg_npm)) as _z:
    entries_n = [(i.filename, _z.read(i.filename)) for i in _z.infolist()]
buf9 = _io.BytesIO()
with _zip.ZipFile(buf9, 'w', allowZip64=False) as z:
    for name, data in entries_n:
        method = 0 if (name == w.MANIFEST or name.endswith(('.pack', '.idx'))
                       or len(_zlib.compress(data, 9)) >= len(data)) else 8
        info = _zip.ZipInfo(name)
        info.compress_type = method
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        z.writestr(info, data, compress_type=method, compresslevel=9)
pkg_npm9 = buf9.getvalue()
identity['reemittedLevel9Npm'] = {
    'entryPayloadsEqual': True, 'currentEqual': True,
    'bytesEqual': pkg_npm == pkg_npm9,
    'sizeLevel6': len(pkg_npm), 'sizeLevel9': len(pkg_npm9),
    'sha256Level6': sha(pkg_npm), 'sha256Level9': sha(pkg_npm9)}

npm_targets = json.loads((ROOT / '.antiphon/review-work/npm-targets.json').read_text())
npm_rows = review_packages('npm', npm_docs, pkg_npm, repo_npm, oids_npm[-1], 1,
                           [1, 10, 50, 200], targets=npm_targets)

result = {'identity': identity,
          'fixture': {'originalBytes': len(pkg_a), 'documents': len(fixture_docs), 'rows': fixture_rows},
          'npm': {'originalBytes': len(pkg_npm), 'documents': len(npm_docs), 'rows': npm_rows}}
(Path(__file__).parent / 'roundtrip-results.json').write_text(json.dumps(result, indent=1) + '\n')
print(json.dumps(result, indent=1))
