"""CARD-0010: does D-17 hold, and what does it cost, when the source repository is CRLF?

Builds a CRLF source repository, projects it into a conforming package under D-17
(LF on write, for every entry outside `.git/`), and projects the same source again
without normalizing, to produce the nonconforming CRLF-storing package that spec.md
section 4 says nothing but a validator would ever notice.

Everything addressing-related is imported from the shipped worked example so this
card cannot drift from docs/spec/worked-example.json; that artifact is never written.

    python docs/investigations/eol/fixture.py
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = ROOT / '.antiphon/eol-work'

_spec = importlib.util.spec_from_file_location('we', ROOT / 'docs/spec/worked-example.py')
we = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(we)

MANIFEST = we.MANIFEST
ANCHOR = we.ANCHOR
DIGEST = we.DIGEST
MAGIC = we.MAGIC
NAMESPACE = we.NAMESPACE

CHECKS = {}


def bump(name, n=1):
    CHECKS[name] = CHECKS.get(name, 0) + n


def rmtree(p):
    if Path(p).exists():
        shutil.rmtree(p, onerror=lambda f, q, e: (os.chmod(q, 0o700), f(q)))


# ---------------------------------------------------------------------------
# The source documents. Authored on a Windows host: CRLF throughout, one file
# with a lone CR (classic Mac), one already LF as a control.
# ---------------------------------------------------------------------------
GUIDE_LF = (b"# Guide\n\nRead this before the notes.\n\n## Setup\n\n"
            b"Install the tool, then run `init`.\n\n## Usage\n\n"
            b"Run `build` to produce a package.\n")
GUIDE_LF_1 = GUIDE_LF.replace(b"Run `build` to produce a package.\n",
                              b"Run `build` to produce a package.\nRun `check` to validate it.\n")
GUIDE_LF_2 = GUIDE_LF_1.replace(b"## Setup\n", b"## Installation\n")
NOTES_LF = b"# Notes\n\n## Todo\n\n- write the guide\n"
CONTROL_LF = b"# Control\n\nThis file was authored with LF and is never rewritten.\n"
MIXED_LF = b"# Mixed\n\nA CRLF line.\nA lone-CR line.\nAn LF line.\n"


def crlf(data):
    return data.replace(b"\n", b"\r\n")


def mixed(data):
    """CRLF, then a lone CR, then LF, cycling: one file that carries all three."""
    lines = data.split(b"\n")
    out = []
    for i, line in enumerate(lines[:-1]):
        out.append(line + (b"\r\n" if i % 3 == 0 else b"\r" if i % 3 == 1 else b"\n"))
    return b"".join(out) + lines[-1]


def to_lf(data):
    """D-17 as written: CRLF and lone CR both become LF."""
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


SNAPSHOTS_CRLF = [
    {'guide.md': crlf(GUIDE_LF), 'notes.md': crlf(NOTES_LF), 'control.md': CONTROL_LF},
    {'guide.md': crlf(GUIDE_LF_1), 'notes.md': crlf(NOTES_LF), 'control.md': CONTROL_LF},
    {'guide.md': crlf(GUIDE_LF_2), 'notes.md': crlf(NOTES_LF), 'control.md': CONTROL_LF,
     'mixed.md': mixed(MIXED_LF)},
]
MESSAGES = ['Base: guide and notes', 'Document the check command', 'Rename Setup to Installation']
DATES = [1700000000, 1700000100, 1700000200]


# ---------------------------------------------------------------------------
# Building a source repository and projecting it
# ---------------------------------------------------------------------------
def build_repo(dest, snapshots):
    """A bare repository holding `snapshots` as a first-parent chain. Bytes go in verbatim."""
    rmtree(dest)
    dest.mkdir(parents=True)
    we.git(dest, 'init', '--bare', '--initial-branch=main', '--template=')
    trees, commits, parent = [], [], None
    for snap, message, when in zip(snapshots, MESSAGES, DATES):
        oids = {path: we.blob(dest, data) for path, data in sorted(snap.items())}
        t = we.tree(dest, oids)
        c = we.commit(dest, t, parent, message, when)
        trees.append(t)
        commits.append(c)
        parent = c
    (dest / 'refs/heads/main').write_bytes((commits[-1] + '\n').encode())
    we.git(dest, 'fsck', '--full', '--strict')
    return dict(trees=trees, commits=commits, head=commits[-1])


def object_table(snapshots):
    """Per snapshot, per path: the blob oid Git assigns to those exact bytes."""
    rows = []
    for n, snap in enumerate(snapshots):
        for path, data in sorted(snap.items()):
            oid = hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
            rows.append(dict(ordinal=n, path=path, bytes=len(data), oid=oid,
                             cr_bytes=data.count(b"\r"),
                             crlf=data.count(b"\r\n"),
                             lone_cr=data.count(b"\r") - data.count(b"\r\n")))
    return rows


def project(snapshots, normalize):
    return [{p: (to_lf(d) if normalize else d) for p, d in s.items()} for s in snapshots]


# ---------------------------------------------------------------------------
# Packaging, reusing the worked example's assembler unchanged
# ---------------------------------------------------------------------------
def package(label, snapshots, source_repo_dir, repo):
    head = repo['head']
    repo_items = we.curated_repo(source_repo_dir, head, WORK / (label + '.git'))
    manifest = {'mdpkg': MAGIC, 'namespace': NAMESPACE, 'current': 'sha1-' + head,
                'addressing': {'anchor': ANCHOR, 'digest': DIGEST, 'coverage': 'complete',
                               'overrides': None},
                'history': {'coverage': 'complete', 'transform': [],
                            'detail': '.mdpkg/history.json'}}
    history = {'walk': 'first-parent', 'root': 'original', 'shallowBoundaries': [],
               'retainedCommits': len(repo['commits']),
               'sourceBase': 'sha1-' + repo['commits'][0], 'sourceTip': 'sha1-' + head,
               'addressingCoverage': [{'from': 'sha1-' + repo['commits'][0],
                                       'to': 'sha1-' + head, 'coverage': 'complete'}],
               'transformations': [], 'ranges': [], 'patches': []}
    items = [(MANIFEST, we.manifest_bytes(manifest))]
    items += sorted(snapshots[-1].items())
    items += [('.mdpkg/history.json', we.canonical_json(history).encode())]
    items += repo_items
    data = we.assemble(items)
    (WORK / (label + '.mdpkg')).write_bytes(data)
    rows, eocd = we.entry_table(data)
    return dict(label=label, path=str(WORK / (label + '.mdpkg')), bytes=len(data),
                sha256=we.sha256(data), head=head, entries=rows, eocd=eocd,
                tree=we.git(WORK / (label + '.git'), 'ls-tree', '-r', head).decode())


def eol_scan(pkg_path):
    """The section 4 validator check: CR bytes in any entry outside `.git/`."""
    rows, scanned = [], 0
    with zipfile.ZipFile(pkg_path) as z:
        for info in z.infolist():
            if info.filename.startswith('.git/'):
                continue
            data = z.read(info)
            scanned += len(data)
            if b"\r" in data:
                rows.append(dict(name=info.filename, cr_bytes=data.count(b"\r"),
                                 crlf=data.count(b"\r\n"),
                                 lone_cr=data.count(b"\r") - data.count(b"\r\n")))
    return dict(offending_entries=rows, conforms=not rows, payload_bytes_scanned=scanned)


def inventories(snapshot):
    """Section 6.1 / 6.2: every addressable entity of the tip snapshot."""
    inv = we.snapshot_inventory({p: d for p, d in snapshot.items() if p.endswith('.md')})
    return {root: dict(locator=r['locator'], digest=r['digest']) for root, r in inv.items()}


def main():
    rmtree(WORK)
    WORK.mkdir(parents=True)

    # 1. The CRLF source, exactly as a Windows author would have committed it.
    src_crlf = WORK / 'source-crlf.git'
    repo_crlf = build_repo(src_crlf, SNAPSHOTS_CRLF)
    bump('source_commits', len(repo_crlf['commits']))

    # 2. D-17 projection: normalize every non-`.git/` entry, in every retained snapshot.
    snaps_lf = project(SNAPSHOTS_CRLF, normalize=True)
    src_lf = WORK / 'projected-lf.git'
    repo_lf = build_repo(src_lf, snaps_lf)

    # 3. The nonconforming control: the same source projected with no normalization.
    src_raw = WORK / 'projected-crlf.git'
    repo_raw = build_repo(src_raw, SNAPSHOTS_CRLF)

    # 4. The identity control: an already-LF source projected under D-17 changes nothing.
    src_ctrl = WORK / 'source-lf.git'
    repo_ctrl = build_repo(src_ctrl, snaps_lf)

    # --- blob / tree / commit identity, per F-9 -----------------------------
    src_objs = object_table(SNAPSHOTS_CRLF)
    lf_objs = object_table(snaps_lf)
    rewrites = []
    for a, b in zip(src_objs, lf_objs):
        assert (a['ordinal'], a['path']) == (b['ordinal'], b['path'])
        rewrites.append(dict(ordinal=a['ordinal'], path=a['path'],
                             source_oid=a['oid'], projected_oid=b['oid'],
                             source_bytes=a['bytes'], projected_bytes=b['bytes'],
                             source_cr_bytes=a['cr_bytes'], projected_cr_bytes=b['cr_bytes'],
                             rewritten=a['oid'] != b['oid']))
        bump('blob_identity_comparisons')
    distinct_src = {r['source_oid'] for r in rewrites}
    distinct_lf = {r['projected_oid'] for r in rewrites}

    tree_rewrites = [dict(ordinal=n, source=a, projected=b, rewritten=a != b)
                     for n, (a, b) in enumerate(zip(repo_crlf['trees'], repo_lf['trees']))]
    commit_rewrites = [dict(ordinal=n, source=a, projected=b, rewritten=a != b)
                       for n, (a, b) in enumerate(zip(repo_crlf['commits'], repo_lf['commits']))]
    identity_control = dict(
        trees=[dict(ordinal=n, source=a, projected=b, rewritten=a != b)
               for n, (a, b) in enumerate(zip(repo_ctrl['trees'], repo_lf['trees']))],
        commits=[dict(ordinal=n, source=a, projected=b, rewritten=a != b)
                 for n, (a, b) in enumerate(zip(repo_ctrl['commits'], repo_lf['commits']))])
    bump('tree_identity_comparisons', len(tree_rewrites) + len(identity_control['trees']))
    bump('commit_identity_comparisons', len(commit_rewrites) + len(identity_control['commits']))

    # --- the two packages ---------------------------------------------------
    conforming = package('conforming-lf', snaps_lf, src_lf, repo_lf)
    nonconforming = package('nonconforming-crlf', SNAPSHOTS_CRLF, src_raw, repo_raw)
    for pkg in (conforming, nonconforming):
        pkg['eol_scan'] = eol_scan(pkg['path'])
        bump('validator_scans')

    inv_lf = inventories(snaps_lf[-1])
    inv_crlf = inventories(SNAPSHOTS_CRLF[-1])
    digest_rows = []
    for root in sorted(set(inv_lf) | set(inv_crlf)):
        a, b = inv_lf.get(root), inv_crlf.get(root)
        digest_rows.append(dict(root=root,
                                locator=(a or b)['locator'],
                                lf_digest=a and a['digest'],
                                crlf_digest=b and b['digest'],
                                identical=bool(a and b and a['digest'] == b['digest'])))
        bump('digest_comparisons')

    # --- what a reader can and cannot tell apart ----------------------------
    entry_bytes = {}
    for pkg in (conforming, nonconforming):
        with zipfile.ZipFile(pkg['path']) as z:
            entry_bytes[pkg['label']] = {i.filename: (i.CRC, i.file_size) for i in z.infolist()}
    common = sorted(set(entry_bytes['conforming-lf']) & set(entry_bytes['nonconforming-crlf']))
    crc_rows = [dict(name=n,
                     lf_crc='%08x' % entry_bytes['conforming-lf'][n][0],
                     crlf_crc='%08x' % entry_bytes['nonconforming-crlf'][n][0],
                     lf_size=entry_bytes['conforming-lf'][n][1],
                     crlf_size=entry_bytes['nonconforming-crlf'][n][1])
                for n in common if n.endswith('.md')]
    bump('crc_comparisons', len(crc_rows))

    out = dict(
        git=subprocess.run(['git', '--version'], stdout=subprocess.PIPE).stdout.decode().strip(),
        python=sys.version.split()[0],
        work_directory=str(WORK),
        source=dict(commits=repo_crlf['commits'], trees=repo_crlf['trees'], objects=src_objs),
        projected=dict(commits=repo_lf['commits'], trees=repo_lf['trees'], objects=lf_objs),
        blob_rewrites=rewrites,
        distinct_source_blobs=len(distinct_src), distinct_projected_blobs=len(distinct_lf),
        blobs_rewritten=sum(r['rewritten'] for r in rewrites),
        tree_rewrites=tree_rewrites, commit_rewrites=commit_rewrites,
        identity_control=identity_control,
        packages={p['label']: p for p in (conforming, nonconforming)},
        digest_equivalence=digest_rows,
        entry_crc=crc_rows,
        checks=CHECKS)
    (HERE / 'fixture-results.json').write_text(
        json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    print(json.dumps(CHECKS, indent=1))
    print('blobs rewritten by D-17: %d/%d (%d distinct source blobs, %d distinct projected)'
          % (out['blobs_rewritten'], len(rewrites), len(distinct_src), len(distinct_lf)))
    print('trees rewritten: %d/%d' % (sum(r['rewritten'] for r in tree_rewrites), len(tree_rewrites)))
    print('commits rewritten: %d/%d' % (sum(r['rewritten'] for r in commit_rewrites),
                                        len(commit_rewrites)))
    print('identity control (LF source): trees rewritten %d, commits %d'
          % (sum(r['rewritten'] for r in identity_control['trees']),
             sum(r['rewritten'] for r in identity_control['commits'])))
    print('digests identical: %d/%d' % (sum(r['identical'] for r in digest_rows), len(digest_rows)))
    for pkg in (conforming, nonconforming):
        s = pkg['eol_scan']
        print('%s: %d bytes sha256 %s conforms=%s offending=%d scanned=%d'
              % (pkg['label'], pkg['bytes'], pkg['sha256'][:16], s['conforms'],
                 len(s['offending_entries']), s['payload_bytes_scanned']))


if __name__ == '__main__':
    main()
