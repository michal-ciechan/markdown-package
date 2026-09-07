"""CARD-0001 container envelope: build real example packages and measure the layout.

Not a format implementation. Reuses the pinned corpora, deterministic ZIP writer and
projected-Git construction from CARD-0002/0003 so byte totals stay comparable.
"""
import collections
import importlib.util
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import unicodedata
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'compression'))
import benchmark as compression                     # noqa: E402
from zip_benchmark import zip_bytes, layout          # noqa: E402
_spec = importlib.util.spec_from_file_location(
    'history_benchmark', HERE.parent / 'history' / 'benchmark.py')
history = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(history)                    # reuses the same compression module

WORK = ROOT / '.antiphon/container-work'
CHECKS = collections.Counter()

# Reserved container prefixes. Content paths may use neither.
RESERVED = ('.mdpkg/', '.git/')
MANIFEST_NAME = '.mdpkg/manifest.json'
MAGIC = 'markdown-package/1'
COMMENT = b'MDPKG/1'          # CARD-0001 follow-up: the rejected variable-length ASCII form
CMAGIC = b'MDPKG'             # follow-up: fixed binary comment, 5-byte tag + escalating version
FIXED_COMMENT_BYTES = 8       # tag + a version field with tier-1 escalation room
MAX_COMMENT_BYTES = 12        # the same comment once tier 2 is in use; readers read 22 + this
FORMAT_VERSION = 1
ESCAPE = bytes([0xFF])   # tier escape sentinel
PAD = bytes([0x00])     # defined filler in the fixed slot
NAMESPACE = '5cf1f1c1-6a5e-4a2a-9d3e-0b7f2e1c4a80'  # fixture lineage namespace, not a registry entry


def version_field(v):
    """Escalating version field: 1 byte, escape 0xFF to uint16, escape 0xFFFF to uint32.

    Each tier is biased by the count of everything the shorter tiers already encode, so
    every version has exactly one encoding. This is the non-overlong rule UTF-8 enforces
    and that LEB128 and protobuf varints leave to the producer.
    """
    assert v >= 0
    if v < 0xFF:
        return bytes([v])
    v -= 0xFF
    if v < 0xFFFF:
        return ESCAPE + struct.pack('<H', v)
    v -= 0xFFFF
    if v < 0xFFFFFFFF:
        return ESCAPE + ESCAPE * 2 + struct.pack('<I', v)
    raise ValueError('beyond the specified tiers')


def read_version_field(buf):
    """Inverse of version_field; returns (version, width) or raises."""
    if buf[0] != 0xFF:
        return buf[0], 1
    v1 = struct.unpack_from('<H', buf, 1)[0]
    if v1 != 0xFFFF:
        return 0xFF + v1, 3
    v2 = struct.unpack_from('<I', buf, 3)[0]
    if v2 == 0xFFFFFFFF:
        raise ValueError('beyond the specified tiers')
    return 0xFF + 0xFFFF + v2, 7


def fixed_comment(version=FORMAT_VERSION, slot=FIXED_COMMENT_BYTES):
    """Tag, version field, then defined zero padding out to the fixed comment length."""
    field = version_field(version)
    assert len(CMAGIC) + len(field) <= slot, 'version does not fit the fixed slot'
    body = CMAGIC + field
    return body + PAD * (slot - len(body))


def comment_tiers():
    """Priced tiers, plus the fixed-width alternatives that occupy the same comment."""
    rows, low = [], 0
    for width, count in ((1, 0xFF), (3, 0xFFFF), (7, 0xFFFFFFFF)):
        high = low + count - 1
        sample = version_field(low) if low else version_field(0)
        rows.append(dict(tier=len(rows), field_bytes=width, comment_bytes=len(CMAGIC) + width,
                         first_version=low, last_version=high, versions=count,
                         first_encoding=version_field(low).hex(),
                         last_encoding=version_field(high).hex()))
        assert read_version_field(version_field(low)) == (low, width)
        assert read_version_field(version_field(high)) == (high, width)
        assert len(sample) >= 1
        CHECKS['version_field_roundtrips'] += 2
        low = high + 1
    plain = [dict(encoding='plain uint8', comment_bytes=len(CMAGIC) + 1, max_version=0xFF),
             dict(encoding='plain uint16 LE', comment_bytes=len(CMAGIC) + 2, max_version=0xFFFF),
             dict(encoding='plain uint32 LE', comment_bytes=len(CMAGIC) + 4, max_version=0xFFFFFFFF)]
    # Prior art, same value, for the byte counts quoted in the report.
    def leb128(v):
        out = bytearray()
        while True:
            b = v & 0x7F
            v >>= 7
            out.append(b | (0x80 if v else 0))
            if not v:
                return bytes(out)

    def utf8_len(v):
        try:
            return len(chr(v).encode())
        except (ValueError, UnicodeEncodeError):
            return None

    art = [dict(value=v, escalating=len(version_field(v)), leb128=len(leb128(v)),
                utf8=utf8_len(v), protobuf_varint=len(leb128(v)))
           for v in (1, 127, 128, 254, 255, 65535, 65790, 1 << 20)]
    return dict(tiers=rows, fixed_width_alternatives=plain, prior_art=art,
                fixed_comment_hex=fixed_comment().hex(),
                fixed_comment_bytes=FIXED_COMMENT_BYTES,
                max_comment_bytes=MAX_COMMENT_BYTES,
                reader_tail_window=22 + MAX_COMMENT_BYTES)


def canon(obj):
    """Canonical UTF-8 JSON: sorted keys, compact, no ASCII escaping, final LF."""
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def manifest_bytes(obj):
    """The magic key must lead, so the first read from offset 0 types the file."""
    rest = json.dumps({k: v for k, v in obj.items() if k != 'mdpkg'}, sort_keys=True,
                      separators=(',', ':'), ensure_ascii=False)
    return ('{"mdpkg":' + json.dumps(MAGIC) + (',' + rest[1:] if rest != '{}' else '}') + '\n').encode()


def pack_repo(source, head, dest, window=10):
    """Curated bare repository: HEAD, config, one ref, one pack and its index."""
    resolved = dest.resolve()
    assert resolved.is_relative_to(WORK.resolve()) and resolved != WORK.resolve()
    if dest.exists():
        shutil.rmtree(resolved, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    history.init_repo(dest)
    packed = history.git(source, 'pack-objects', '--revs', '--stdout', '--delta-base-offset',
                         '--window=' + str(window), '--depth=50', data=(head + '\n').encode())
    digest = packed[-20:].hex()
    assert hashlib.sha1(packed[:-20]).digest() == packed[-20:]
    folder = dest / 'objects/pack'
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / ('pack-' + digest + '.pack')
    p.write_bytes(packed)
    history.git(dest, 'index-pack', str(p))
    (dest / 'refs/heads/main').write_bytes((head + '\n').encode())  # LF, not the host newline
    history.git(dest, 'fsck', '--full', '--strict')
    CHECKS['git_fsck'] += 1
    return dest


def repo_items(repo):
    """Small repository files first, pack index next, the pack itself last.

    Keeping the single largest member at the end makes one contiguous prefix range
    cover every other entry.
    """
    def rank(name):
        return (2 if name.endswith('.pack') else 1 if name.endswith('.idx') else 0, name)
    files = [('.git/' + p.relative_to(repo).as_posix(), p.read_bytes())
             for p in repo.rglob('*') if p.is_file()]
    # Ship a non-bare config so the extracted directory is an ordinary working tree.
    config = b'[core]\n\trepositoryformatversion = 0\n\tbare = false\n'
    files = [(n, config if n == '.git/config' else d) for n, d in files]
    return sorted(files, key=lambda kv: rank(kv[0]))


def headings(data):
    """Deliberately shallow ATX scan: sizing input for the ledger fixture only."""
    out, fence = [], False
    for line in data.decode('utf-8', 'replace').splitlines():
        if line.lstrip().startswith('```'):
            fence = not fence
        elif not fence and line.startswith('#') and line.lstrip('#').startswith(' '):
            out.append(line.rstrip())
    return out


def overrides_ledger(snapshot_sources, rate):
    """Sparse ledger with CARD-0004's record shape at a chosen cardinality.

    Root keys are placeholder SHA-256 values over real heading trails. This sizes the
    entry and exercises the read path; it does not re-derive CARD-0004's semantics.
    """
    trails = []
    for path in sorted(snapshot_sources):
        for n, text in enumerate(headings(snapshot_sources[path])):
            trails.append((path, text, n))
    step = max(1, int(round(1 / rate))) if rate else 0
    entries = {}
    for i, (path, text, n) in enumerate(trails):
        if not step or i % step:
            continue
        root = hashlib.sha256(f'mdpkg-default\0{NAMESPACE}\0{path}\0{text}\0{n}'.encode()).hexdigest()
        entries[root] = {'to': ['section', path, [[text, 0]]]}
    return {'version': 1, 'anchor': 'cm0312-trail-source-v1', 'entries': entries}, len(trails)


def entry_table(data):
    """Physical entry extents straight out of the archive bytes."""
    rows = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for i in z.infolist():
            off = i.header_offset
            assert data[off:off + 4] == b'PK\x03\x04'
            nlen = int.from_bytes(data[off + 26:off + 28], 'little')
            elen = int.from_bytes(data[off + 28:off + 30], 'little')
            flags = int.from_bytes(data[off + 6:off + 8], 'little')
            start = off + 30 + nlen + elen
            rows.append(dict(name=i.filename, offset=off, data_offset=start, method=i.compress_type,
                             compressed=i.compress_size, uncompressed=i.file_size,
                             local_extra=elen, flags=flags, crc=i.CRC,
                             end=start + i.compress_size))
    return rows


def regions(rows, data):
    directory = layout(data)
    groups = collections.OrderedDict()
    for r in rows:
        if r['name'] == MANIFEST_NAME:
            key = 'manifest'
        elif r['name'].endswith(('.pack', '.idx')):
            key = 'git pack + index'
        elif r['name'].startswith('.git/'):
            key = 'git repository files'
        elif r['name'].startswith('.mdpkg/'):
            key = 'container metadata'
        else:
            key = 'markdown documents'
        g = groups.setdefault(key, dict(region=key, entries=0, first=r['offset'], last=0, bytes=0))
        g['entries'] += 1
        g['first'] = min(g['first'], r['offset'])
        g['last'] = max(g['last'], r['end'])
        g['bytes'] += r['end'] - r['offset']
    out = list(groups.values())
    out.append(dict(region='central directory', entries=len(rows), first=directory['cd_offset'],
                    last=directory['cd_offset'] + directory['cd_bytes'],
                    bytes=directory['cd_bytes']))
    out.append(dict(region='EOCD (+ comment)', entries=0, first=len(data) - 22 - directory['comment_bytes'],
                    last=len(data), bytes=22 + directory['comment_bytes']))
    return out, directory


def assemble(items, comment=b''):
    chosen = []
    for name, data in items:
        method = 8
        if name == MANIFEST_NAME or name.endswith(('.pack', '.idx')):
            method = 0  # manifest: readable with no codec. pack/idx: preserve internal offsets.
        elif len(zlib.compress(data, 6)) >= len(data):
            method = 0
        chosen.append((name, data, method))
    return zip_bytes(chosen, comment=comment)


def verify(data, items):
    expected = dict(items)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert [i.filename for i in z.infolist()] == [n for n, _ in items]
        for i in z.infolist():
            assert z.read(i) == expected[i.filename]
            CHECKS['zip_entry_roundtrips'] += 1
    return len(data)


def path_audit(paths):
    """Collision risk once git's byte paths are extracted onto real filesystems."""
    folded, normalized, issues = {}, {}, []
    for p in paths:
        key = unicodedata.normalize('NFC', p).casefold()
        if key in folded and folded[key] != p:
            issues.append(dict(kind='casefold-nfc', a=folded[key], b=p))
        folded[key] = p
        nk = unicodedata.normalize('NFC', p)
        if nk in normalized and normalized[nk] != p:
            issues.append(dict(kind='nfc', a=normalized[nk], b=p))
        normalized[nk] = p
    return dict(paths=len(paths), non_ascii=sum(1 for p in paths if not p.isascii()),
                already_nfc=sum(1 for p in paths if unicodedata.normalize('NFC', p) == p),
                reserved_prefix_hits=sum(1 for p in paths if p.startswith(RESERVED)),
                collisions=issues)


def typing_probe(data):
    """Fixed-offset dispatch from the head of the file; no directory walk."""
    need = 4 + 26 + len(MANIFEST_NAME)
    head = data[:need]
    ok_sig = head[:4] == b'PK\x03\x04'
    flags = int.from_bytes(data[6:8], 'little')
    method = int.from_bytes(data[8:10], 'little')
    nlen = int.from_bytes(data[26:28], 'little')
    elen = int.from_bytes(data[28:30], 'little')
    name = data[30:30 + nlen].decode('utf-8', 'replace')
    body = data[30 + nlen + elen:30 + nlen + elen + 32]
    magic_prefix = b'{"mdpkg":"' + MAGIC.encode() + b'"'
    return dict(bytes_needed=30 + nlen + elen + len(magic_prefix), signature=ok_sig,
                local_flags=flags, streamed_bit3=bool(flags & 0x8), method=method,
                name=name, name_ok=name == MANIFEST_NAME,
                magic_ok=body.startswith(magic_prefix),
                magic_bytes=len(magic_prefix))


def run_corpus(name, repo, prefix, revision):
    old = json.loads((compression.OUT / (name + '-corpus.json')).read_text())
    entries, cm = compression.corpus(name, repo, prefix, revision)
    assert old == cm
    CHECKS['corpus_entry_continuity'] += len(entries)
    revisions = [cm['base']] + cm['commits']
    snapshots = [history.source_snapshot(repo, r, prefix) for r in revisions]
    blob_data = history.blobs(repo, (o for s in snapshots for o in s.values()))
    records = [history.source_metadata(repo, r) for r in revisions]

    source = WORK / name / 'source.git'
    if source.exists():
        shutil.rmtree(source, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)))
    history.init_repo(source)
    for oid, data in blob_data.items():
        assert history.put(source, 'blob', data) == oid
    tip_files = dict(snapshots[-1])
    sources = {p: blob_data[o] for p, o in tip_files.items()}

    ledger, heading_count = overrides_ledger(sources, 0.05)
    ledger_bytes = canon(ledger)
    tracked_variants = {'no-overrides': dict(tip_files),
                        'sparse-overrides': dict(tip_files, **{'.mdpkg/address/overrides.json':
                                                               history.put(source, 'blob', ledger_bytes)})}
    packages, sizes = {}, {}
    for variant, files in tracked_variants.items():
        commits = []
        for n, (snapshot, meta) in enumerate(zip(snapshots, records)):
            snap = dict(files) if n == len(snapshots) - 1 else snapshot
            tr = history.tree(source, snap)
            commits.append(history.commit(source, tr, commits[-1] if commits else None, meta))
        (source / 'refs/heads/main').write_text(commits[-1] + '\n')
        head = commits[-1]
        packed = pack_repo(source, head, WORK / name / (variant + '.git'))
        worktree = {p: (blob_data[o] if p in tip_files else ledger_bytes) for p, o in files.items()}
        assert history.source_snapshot(packed, head, prefix) == tip_files
        CHECKS['tip_snapshot_matches_worktree'] += 1

        mf = {'mdpkg': MAGIC, 'namespace': NAMESPACE, 'current': 'sha1-' + head,
              'addressing': {'coverage': 'confirmed',
                             'overrides': None if variant == 'no-overrides'
                             else '.mdpkg/address/overrides.json'},
              'history': {'coverage': 'truncated', 'transform': ['projected'],
                          'detail': '.mdpkg/history.json'}}
        detail = {'sourceRepository': cm['repository'], 'scope': prefix + '/**/*.md',
                  'sourceBase': revisions[0], 'sourceTip': revisions[-1],
                  'root': 'synthetic-snapshot', 'projection': 'markdown-only-first-parent',
                  'sourceCommits': len(cm['commits']), 'retainedCommits': len(commits),
                  'shallowBoundaries': [], 'sectionSummary': 'absent'}
        items = ([(MANIFEST_NAME, manifest_bytes(mf))]
                 + sorted(worktree.items())
                 + [('.mdpkg/history.json', canon(detail))]
                 + repo_items(packed))
        data = assemble(items, comment=b'')
        verify(data, items)
        rows = entry_table(data)
        reg, directory = regions(rows, data)
        packages[variant] = dict(bytes=len(data), sha256=compression.sha(data), head=head,
                                 manifest_bytes=len(manifest_bytes(mf)), manifest=mf,
                                 entries=rows, regions=reg, directory=directory,
                                 typing=typing_probe(data),
                                 first_git_offset=min(r['offset'] for r in rows
                                                      if r['name'].startswith('.git/')),
                                 ledger_records=len(ledger['entries']),
                                 ledger_raw_bytes=len(ledger_bytes), headings=heading_count)
        (WORK / name).mkdir(parents=True, exist_ok=True)
        (WORK / name / (variant + '.mdpkg')).write_bytes(data)
        if variant == 'no-overrides':
            (WORK / name / (variant + '-comment.mdpkg')).write_bytes(assemble(items, comment=COMMENT))
            fixed = assemble(items, comment=fixed_comment())
            (WORK / name / (variant + '-fixed.mdpkg')).write_bytes(fixed)
            packages['no-overrides-fixed'] = dict(
                bytes=len(fixed), sha256=compression.sha(fixed), head=head,
                manifest_bytes=len(manifest_bytes(mf)), manifest=mf,
                entries=entry_table(fixed), regions=regions(entry_table(fixed), fixed)[0],
                directory=layout(fixed), typing=typing_probe(fixed),
                first_git_offset=min(r['offset'] for r in entry_table(fixed)
                                     if r['name'].startswith('.git/')),
                ledger_records=0, ledger_raw_bytes=0, headings=heading_count,
                comment_hex=fixed_comment().hex())
        sizes[variant] = len(data)

    base_items = ([(MANIFEST_NAME, manifest_bytes(packages['no-overrides']['manifest']))]
                  + sorted({p: blob_data[o] for p, o in tip_files.items()}.items())
                  + [('.mdpkg/history.json', canon(dict(sourceRepository=cm['repository'],
                                                        scope=prefix + '/**/*.md',
                                                        sourceBase=revisions[0], sourceTip=revisions[-1],
                                                        root='synthetic-snapshot',
                                                        projection='markdown-only-first-parent',
                                                        sourceCommits=len(cm['commits']),
                                                        retainedCommits=len(revisions),
                                                        shallowBoundaries=[], sectionSummary='absent')))]
                  + repo_items(WORK / name / 'no-overrides.git'))
    variants = layout_variants(base_items)

    if name == 'npm':
        write_typing_fixtures(base_items)
    manifest_forms = manifest_variants(packages['no-overrides']['manifest'], sources, tip_files)
    return dict(corpus=name, packages=packages, variants=variants, manifests=manifest_forms,
                paths=path_audit(sorted(tip_files)),
                documents=len(tip_files), document_bytes=sum(len(v) for v in sources.values()))


def write_typing_fixtures(items):
    """Negative and recoverable inputs for the fast-fail dispatch probe."""
    docs = [i for i in items if not i[0].startswith(RESERVED)]
    manifest = [i for i in items if i[0] == MANIFEST_NAME]
    rest = [i for i in items if i[0] != MANIFEST_NAME]
    (WORK / 'typing-plain.zip').write_bytes(assemble(docs[:5]))
    (WORK / 'typing-manifest-last.mdpkg').write_bytes(assemble(rest + manifest))
    (WORK / 'typing-streamed.mdpkg').write_bytes(stream_write(items))


def prefix_cost(data, rows=None):
    """One contiguous range covering every non-.git entry, plus the directory tail."""
    rows = rows or entry_table(data)
    plain = [r for r in rows if not r['name'].startswith('.git/')]
    span = max(r['end'] for r in plain) - min(r['offset'] for r in plain)
    d = layout(data)
    return dict(plain_span_bytes=span, tail_bytes=len(data) - d['cd_offset'],
                without_git=span + (len(data) - d['cd_offset']))


def layout_variants(items):
    """Order and naming choices, priced on identical payload bytes."""
    docs = [i for i in items if not i[0].startswith(RESERVED)]
    meta = [i for i in items if i[0].startswith('.mdpkg/') and i[0] != MANIFEST_NAME]
    manifest = [i for i in items if i[0] == MANIFEST_NAME]
    gitfiles = [i for i in items if i[0].startswith('.git/')]
    out = []

    def add(label, ordered, comment=b'', note=''):
        data = assemble(ordered, comment=comment)
        verify(data, ordered)
        rows = entry_table(data)
        has_git = any(r['name'].startswith('.git/') for r in rows)
        row = dict(variant=label, bytes=len(data), note=note,
                   typing_bytes=typing_probe(data)['bytes_needed'] if typing_probe(data)['name_ok'] else None,
                   comment_bytes=len(comment))
        row.update(prefix_cost(data, rows) if has_git else {})
        out.append(row)
        return data

    add('recommended: manifest, documents, metadata, .git; no comment',
        manifest + docs + meta + gitfiles, note='baseline')
    add('same order with a 7-byte MDPKG/1 EOCD comment',
        manifest + docs + meta + gitfiles, comment=COMMENT, note='variable-length version hint')
    add('same order with the fixed 8-byte binary EOCD comment',
        manifest + docs + meta + gitfiles, comment=fixed_comment(),
        note='fixed-length version hint')
    add('documents under a content/ prefix',
        manifest + [('content/' + n, d) for n, d in docs] + meta + gitfiles,
        note='reserved-prefix alternative')
    add('.git first, documents last',
        manifest + gitfiles + meta + docs, note='prefix read must span the pack')
    add('manifest last (nonconforming)',
        docs + meta + gitfiles + manifest, note='typing needs the central directory')
    streamed = stream_write(manifest + docs + meta + gitfiles)
    rows = entry_table(streamed)
    t = typing_probe(streamed)
    out.append(dict(variant='streamed write, data descriptors (nonconforming)',
                    bytes=len(streamed), note='local sizes are zero; bit 3 set',
                    typing_bytes=None if t['streamed_bit3'] else t['bytes_needed'],
                    comment_bytes=0, streamed_bit3=t['streamed_bit3'],
                    manifest_local_sizes=list(struct.unpack_from('<II', streamed, 18)),
                    **prefix_cost(streamed, rows)))
    return out


class _Unseekable(io.RawIOBase):
    """Forces zipfile onto its streaming path so entries get data descriptors."""
    def __init__(self):
        self.buffer = bytearray()

    def writable(self):
        return True

    def seekable(self):
        return False

    def write(self, b):
        self.buffer += b
        return len(b)

    def tell(self):
        return len(self.buffer)


def stream_write(items):
    sink = _Unseekable()
    with zipfile.ZipFile(sink, 'w', allowZip64=True) as z:
        for name, data in items:
            method = 0 if name == MANIFEST_NAME or name.endswith(('.pack', '.idx')) else 8
            info = zipfile.ZipInfo(name)
            info.compress_type = method
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, data, compress_type=method, compresslevel=6)
    return bytes(sink.buffer)


def manifest_variants(recommended, sources, tip_files):
    forms = []
    minimal = {'mdpkg': MAGIC, 'namespace': recommended['namespace'], 'current': recommended['current']}
    forms.append(dict(variant='minimal (magic, namespace, current commit)', bytes=len(manifest_bytes(minimal))))
    forms.append(dict(variant='recommended (adds addressing + history coverage)',
                      bytes=len(manifest_bytes(recommended))))
    with_codec = dict(recommended, compression={'methods': [0, 8], 'level': 6})
    forms.append(dict(variant='+ codec declaration already in the central directory',
                      bytes=len(manifest_bytes(with_codec))))
    with_index = dict(recommended, documents=sorted(tip_files))
    forms.append(dict(variant='+ document index already in the central directory',
                      bytes=len(manifest_bytes(with_index))))
    with_digests = dict(recommended, digests={p: compression.sha(d) for p, d in sorted(sources.items())})
    forms.append(dict(variant='+ per-document SHA-256 already bound by the tip tree',
                      bytes=len(manifest_bytes(with_digests))))
    return forms


if __name__ == '__main__':
    WORK.mkdir(parents=True, exist_ok=True)
    results = [run_corpus('npm', compression.WORK / 'npm-cli', 'docs/lib/content', compression.PIN_NPM),
               run_corpus('rust', compression.WORK / 'rust-rfcs', 'text', compression.PIN_RUST)]
    compression.save(HERE / 'container-results.json',
                     dict(git=subprocess.check_output(['git', '--version']).decode().strip(),
                          reserved_prefixes=list(RESERVED), magic=MAGIC,
                          manifest_name=MANIFEST_NAME, corpora=results,
                          comment=comment_tiers(), checks=dict(CHECKS)))
    print(json.dumps({r['corpus']: {k: v['bytes'] for k, v in r['packages'].items()} for r in results}))
    print(dict(CHECKS))
