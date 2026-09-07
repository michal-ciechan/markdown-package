"""CARD-0003 evidence, not a format implementation. Reuses CARD-0002 verbatim.

Run with the compression venv. Only task-owned .antiphon/history-work is written.
No source repository history or configuration is modified.
"""
import collections
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import statistics
import subprocess
import sys
import time
import zipfile
import zlib

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'compression'))
import benchmark as compression
from zip_benchmark import zip_bytes, layout, first_section

WORK = ROOT / '.antiphon/history-work'
CHECKS = collections.Counter()
ENV = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
           GIT_TERMINAL_PROMPT='0', GIT_NO_REPLACE_OBJECTS='1')


def git(repo, *args, data=None, check=True):
    p = subprocess.run(['git', '-C', str(repo), '-c', 'core.autocrlf=false',
                        '-c', 'core.compression=6', '-c', 'pack.threads=1',
                        '-c', 'pack.window=10', '-c', 'pack.depth=50', *args],
                       input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       env=ENV)
    if check and p.returncode:
        raise RuntimeError((args, p.returncode, p.stderr.decode(errors='replace')))
    return p.stdout if check else p


def save(name, obj):
    compression.save(HERE / name, obj)


def json_bytes(obj):
    return (json.dumps(obj, separators=(',', ':'), ensure_ascii=False)+'\n').encode()


def init_repo(repo):
    repo.mkdir(parents=True, exist_ok=True)
    git(repo, 'init', '--bare', '--initial-branch=main', '--template=')
    (repo / 'config').write_bytes(b'[core]\n\trepositoryformatversion = 0\n\tbare = true\n')


def object_id(kind, data):
    return hashlib.sha1(kind.encode()+b' '+str(len(data)).encode()+b'\0'+data).hexdigest()


def put(repo, kind, data):
    raw = kind.encode()+b' '+str(len(data)).encode()+b'\0'+data
    oid = hashlib.sha1(raw).hexdigest()
    dest = repo / 'objects' / oid[:2] / oid[2:]
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zlib.compress(raw, 6))
    return oid


def tree(repo, files):
    nested = {}
    for path, oid in files.items():
        node = nested
        parts = path.split('/')
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = oid
    def emit(node):
        data = bytearray()
        for name in sorted(node, key=lambda n: (n+('/' if isinstance(node[n], dict) else '')).encode()):
            v = node[name]
            directory = isinstance(v, dict)
            oid = emit(v) if directory else v
            data.extend((b'40000' if directory else b'100644')+b' '+name.encode()+b'\0'+bytes.fromhex(oid))
        return put(repo, 'tree', bytes(data))
    return emit(nested)


def source_snapshot(repo, revision, prefix):
    entries = git(repo, 'ls-tree', '-rz', revision, '--', prefix).split(b'\0')
    result = {}
    for entry in entries:
        if not entry:
            continue
        meta, path = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        if path.endswith(b'.md'):
            assert mode == '100644' and kind == 'blob'
            result[path.decode()] = oid
    return result


def blobs(repo, oids):
    ordered = sorted(set(oids))
    data = git(repo, 'cat-file', '--batch', data=''.join(o+'\n' for o in ordered).encode())
    stream, result = io.BytesIO(data), {}
    for oid in ordered:
        header = stream.readline().decode().split()
        assert header[:2] == [oid, 'blob']
        result[oid] = stream.read(int(header[2]))
        assert stream.read(1) == b'\n'
        assert object_id('blob', result[oid]) == oid
        CHECKS['source_blob_hashes'] += 1
    return result


def source_metadata(repo, revision):
    raw = git(repo, 'cat-file', 'commit', revision)
    header, message = raw.split(b'\n\n', 1)
    lines = header.splitlines()
    return dict(author=next(x[7:].decode() for x in lines if x.startswith(b'author ')),
                committer=next(x[10:].decode() for x in lines if x.startswith(b'committer ')),
                message=message.decode(), source=revision,
                source_parents=[x[7:].decode() for x in lines if x.startswith(b'parent ')])


def commit(repo, tr, parent, meta):
    lines = ['tree '+tr] + (['parent '+parent] if parent else [])
    lines += ['author '+meta['author'], 'committer '+meta['committer']]
    message = meta['message'].rstrip()+'\n\nSource-Commit: '+meta['source']+'\n'
    return put(repo, 'commit', ('\n'.join(lines)+'\n\n'+message).encode())


def archive(items):
    # Reuse exact ZIP construction and level 6 from the compression report.
    chosen = []
    for name, data in items:
        enc, _ = compression.codec('raw-6')
        method = 8 if len(enc(data)) < len(data) else 0
        # Keep .pack STORED for future range readers. Double DEFLATE measured separately.
        if name.endswith(('.pack', '.bundle')) or name == '.mdpkg/manifest.json':
            method = 0
        chosen.append((name, data, method))
    return zip_bytes(chosen)


def pack_repo(source, head, dest, window=10):
    if dest.exists():
        resolved=dest.resolve()
        assert resolved.is_relative_to(WORK.resolve()) and resolved != WORK.resolve()
        assert resolved.name in ('repo.git','wide.git','synthetic.git')
        shutil.rmtree(resolved)
    init_repo(dest)
    packed = git(source, 'pack-objects', '--revs', '--stdout', '--delta-base-offset',
                 '--window='+str(window), '--depth=50', data=(head+'\n').encode())
    digest = packed[-20:].hex()
    assert hashlib.sha1(packed[:-20]).digest() == packed[-20:]
    folder = dest / 'objects/pack'
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / ('pack-'+digest+'.pack')
    p.write_bytes(packed)
    git(dest, 'index-pack', str(p))
    (dest / 'refs/heads/main').write_text(head+'\n')
    git(dest, 'fsck', '--full', '--strict')
    CHECKS['git_fsck'] += 1
    return p


def describe_zip(data, items):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        expected = dict(items)
        assert len(z.infolist()) == len(items)
        for i in z.infolist():
            assert z.read(i) == expected[i.filename]
            CHECKS['zip_entry_roundtrips'] += 1
        return dict(bytes=len(data), sha256=compression.sha(data),
                    payload_bytes=sum(i.compress_size for i in z.infolist()),
                    overhead_bytes=len(data)-sum(i.compress_size for i in z.infolist()),
                    **layout(data))


def repo_items(repo):
    # Minimal actual repository, not somebody's worktree, config, hooks or reflogs.
    return [('.git/'+p.relative_to(repo).as_posix(), p.read_bytes())
            for p in sorted(repo.rglob('*')) if p.is_file()]


def apply_patch_bytes(before, patch):
    """Strict text patch reconstruction for these pinned unified-diff fixtures only."""
    lines = patch.splitlines(keepends=True)
    # Git's no-newline marker removes the previous patch payload's LF.
    cooked = []
    for line in lines:
        if line.startswith(b'\\ No newline at end of file'):
            cooked[-1] = cooked[-1][:-1]
        else:
            cooked.append(line)
    original = before.splitlines(keepends=True)
    out, cursor, i = [], 0, 0
    while i < len(cooked):
        match = re.match(rb'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', cooked[i])
        if not match:
            i += 1
            continue
        old_start, old_count, new_start, new_count = match.groups()
        old_count = int(old_count or b'1')
        new_count = int(new_count or b'1')
        at = int(old_start) - (1 if old_count else 0)
        assert at >= cursor
        out.extend(original[cursor:at]); cursor = at
        assert len(out) == int(new_start) - (1 if new_count else 0)
        used, produced = 0, 0
        i += 1
        while i < len(cooked) and not cooked[i].startswith(b'@@ '):
            line = cooked[i]
            if line[:1] in (b' ', b'-'):
                assert original[cursor] == line[1:]
                cursor += 1; used += 1
            if line[:1] in (b' ', b'+'):
                out.append(line[1:]); produced += 1
            i += 1
        assert (used, produced) == (old_count, new_count)
    out.extend(original[cursor:])
    return b''.join(out)


def timed(call, repeats=7):
    values = []
    for _ in range(repeats):
        start = time.perf_counter()
        result = call()
        values.append((time.perf_counter()-start)*1000)
    return dict(first_ms=values[0], median_ms=statistics.median(values[1:]),
                samples_ms=values, output_bytes=len(result))


def run_corpus(name, repo, prefix, revision):
    old = json.loads((compression.OUT / (name+'-corpus.json')).read_text())
    entries, manifest = compression.corpus(name, repo, prefix, revision)
    assert old == manifest
    CHECKS['corpus_entry_continuity'] += len(entries)
    revisions = [manifest['base']]+manifest['commits']
    snapshots = [source_snapshot(repo, r, prefix) for r in revisions]
    for previous, revision in zip(snapshots, revisions[1:]):
        assert previous == source_snapshot(repo, revision+'^', prefix)
        CHECKS['first_parent_continuity'] += 1
    blob_data = blobs(repo, (o for snapshot in snapshots for o in snapshot.values()))
    base_entries = sorted((e for e in entries if e['kind']=='base'), key=lambda e:e['key'])
    for e in base_entries:
        assert blob_data[snapshots[0][e['path']]] == e['data']
        CHECKS['base_blob_continuity'] += 1
    records = [source_metadata(repo, r) for r in revisions]
    source = WORK/name/'source.git'
    init_repo(source)
    for oid, data in blob_data.items():
        assert put(source, 'blob', data) == oid
    trees, commits = [], []
    for snapshot, meta in zip(snapshots, records):
        tr = tree(source, snapshot); trees.append(tr)
        commits.append(commit(source, tr, commits[-1] if commits else None, meta))
    (source/'refs/heads/main').write_text(commits[-1]+'\n')
    # Independent replay validates every selected delta, including add/delete.
    reconstructed = {e['path']:e['data'] for e in base_entries}
    for n in range(32):
        for e in entries:
            if e['kind']=='diff' and e['key'].endswith(f'@diff{n:02}'):
                value = apply_patch_bytes(reconstructed.get(e['path'], b''), e['data'])
                if e['path'] not in snapshots[n+1]:
                    assert value == b''; reconstructed.pop(e['path'])
                else:
                    assert value == blob_data[snapshots[n+1][e['path']]]
                    reconstructed[e['path']] = value
                CHECKS['flat_delta_reconstruction'] += 1
        assert {p:object_id('blob', b) for p,b in reconstructed.items()} == snapshots[n+1]
        CHECKS['flat_snapshot_reconstruction'] += 1
    rows, browser_fixtures = [], []
    for n, squashed in [(0, False)]+[(n,s) for n in (5,20,32) for s in (False,True)]:
        label = 'base' if n == 0 else str(n)+('-squash' if squashed else '')
        folder = WORK/name/label
        folder.mkdir(parents=True, exist_ok=True)
        meta = dict(format='mdpkg-history-experiment', version=1, source=manifest['repository'],
                    scope=prefix+'/**/*.md' if name=='npm' else prefix+'/*.md',
                    sourceBase=revisions[0], sourceTip=revisions[n],
                    ancestry='truncated', root='synthetic-snapshot',
                    projection='markdown-only-first-parent', sourceCommits=n,
                    retainedCommits=1 if squashed else n, squashed=squashed,
                    sectionSummary='absent')
        common = [('.mdpkg/manifest.json', json_bytes(meta))]
        head = commits[n]
        retained = records[:n+1]
        if squashed:
            sm = dict(records[n], message=f'Squash {n} selected Markdown commits\n')
            head = commit(source, trees[n], commits[0], sm)
            retained = [records[0], sm]
        packed_repo = folder/'repo.git'
        packpath = pack_repo(source, head, packed_repo)
        repo_payload = repo_items(packed_repo)
        a_items = common+repo_payload
        bundle_path = folder/'history.bundle'
        git(packed_repo, 'bundle', 'create', '--version=2', str(bundle_path), 'refs/heads/main')
        git(packed_repo, 'bundle', 'verify', str(bundle_path))
        CHECKS['bundle_verify'] += 1
        # Consume every bundle with real Git into a new empty repository.
        clone = folder/'bundle-clone.git'
        init_repo(clone)
        git(clone, 'fetch', str(bundle_path), 'refs/heads/main:refs/heads/main')
        assert git(clone, 'rev-parse', 'main').decode().strip() == head
        git(clone, 'fsck', '--full', '--strict'); CHECKS['bundle_clone_fsck'] += 1
        assert source_snapshot(clone, 'main', prefix) == snapshots[n]
        CHECKS['bundle_head_snapshot'] += 1
        b_items = common+[('history.bundle', bundle_path.read_bytes())]
        flat_entries = [(e['key'], e['data']) for e in base_entries]
        if squashed:
            for path in sorted(set(snapshots[0]) | set(snapshots[n])):
                if snapshots[0].get(path) != snapshots[n].get(path):
                    delta = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
                                '--unified=3', '--no-color', revisions[0], revisions[n], '--', path)
                    value = apply_patch_bytes(blob_data.get(snapshots[0].get(path), b''), delta)
                    assert value == blob_data.get(snapshots[n].get(path), b'')
                    CHECKS['squash_delta_reconstruction'] += 1
                    flat_entries.append((path+'@diff00', delta))
        else:
            flat_entries += [(e['key'],e['data']) for e in entries
                             if e['kind']=='diff' and int(e['key'][-2:]) < n]
        flat_entries.sort()
        # Ordered records preserve authors, commit messages and source identity, like Git.
        # Match Git's retained provenance: original merge-parent IDs are not shipped
        # by the projected commits, so do not charge them only to the flat variant.
        flat_records=[{k:v for k,v in m.items() if k!='source_parents'} for m in retained]
        c_items = common + [('.mdpkg/commits.json', json_bytes(flat_records))] + flat_entries
        variants = {'git-dir': a_items, 'git-bundle': b_items, 'flat-diffs': c_items}
        row = dict(corpus=name, scenario=label, n=n, squashed=squashed, head=head,
                   manifest_bytes=len(common[0][1]), variants={})
        current = sorted((path, blob_data[oid]) for path,oid in snapshots[n].items())
        row['current_view_zip_bytes'] = len(archive(current))
        for variant, items in variants.items():
            data = archive(items)
            (folder/(variant+'.zip')).write_bytes(data)
            info = describe_zip(data, items)
            info['with_browsable_current_bytes'] = len(archive(current+items))
            # Sensitivity only: generic ZIP writers may recompress already-compressed pack data.
            info['all_deflated_bytes'] = len(zip_bytes([(p,b,8) for p,b in items]))
            row['variants'][variant] = info
        verification = git(packed_repo, 'verify-pack', '-v', str(packpath.with_suffix('.idx'))).decode()
        object_rows = [l.split() for l in verification.splitlines() if re.match(r'^[0-9a-f]{40} ', l)]
        row['pack'] = dict(bytes=packpath.stat().st_size, index_bytes=packpath.with_suffix('.idx').stat().st_size,
                           objects=len(object_rows), delta_objects=sum(len(r)==7 for r in object_rows),
                           blob_delta_objects=sum(r[1]=='blob' and len(r)==7 for r in object_rows),
                           max_depth=max([int(r[5]) for r in object_rows if len(r)==7] or [0]))
        if n==32 and not squashed:
            wide = folder/'wide.git'
            wide_pack = pack_repo(source, head, wide, window=250)
            row['wide_window_git_dir_bytes'] = len(archive(common+repo_items(wide)))
            row['wide_window_pack_bytes'] = wide_pack.stat().st_size
            # Existing best-solid numbers are precisely the same original base+diff bytes.
            old_sizes=json.loads((compression.OUT/'size-results.json').read_text())
            if isinstance(old_sizes, dict): old_sizes=old_sizes['rows']
            candidates=[r for r in old_sizes if r['corpus']==name and 'order' not in r]
            best=min(candidates,key=lambda r:r['whole_bytes'])
            row['prior_best_solid'] = dict(codec=best['codec'],bytes=best['whole_bytes'])
            target = next(e for e in reversed(base_entries) if 1024<=len(e['data'])<=8192)
            frequencies=collections.Counter(e['path'] for e in entries if e['kind']=='diff' and e['path'] in snapshots[0] and e['path'] in snapshots[-1])
            hottest=min(frequencies, key=lambda p:(-frequencies[p],p))
            targets=[]
            for label2,path in [('compression-target',target['path']), ('most-revised',hottest)]:
                versions=[blob_data.get(s.get(path), b'') for s in snapshots]
                sections=[first_section(b) if len(re.findall(rb'^#{1,6} [^\r\n]+',b,re.M))>=2 else None for b in versions]
                # For the history probe, hold heading text fixed to the initial section.
                heading=sections[0]['heading'] if sections[0] else None
                def section_bytes(b):
                    hs=list(re.finditer(rb'^#{1,6} [^\r\n]+',b,re.M))
                    found=next((i for i,h in enumerate(hs) if h.group().decode()==heading),None)
                    return None if found is None else b[hs[found].start():hs[found+1].start() if found+1<len(hs) else len(b)]
                targets.append(dict(label=label2,path=path, heading=heading,
                                    versions=[dict(oid=s.get(path),sha256=compression.sha(b),bytes=len(b),
                                        section_sha256=compression.sha(section_bytes(b)) if section_bytes(b) is not None else None)
                                        for s,b in zip(snapshots,versions)],
                                    unique_blobs=len(set(s.get(path) for s in snapshots)),
                                    changed_transitions=sum(a!=b for a,b in zip(versions,versions[1:])),
                                    native_log=timed(lambda:git(packed_repo,'log','--format=fuller','-p','main','--',path))))
                # Flat document-only chain cost starts with already-read ZIP member bytes.
                deltas=[e['data'] for e in entries if e['kind']=='diff' and e['path']==path]
                def flat_read():
                    b=versions[0]
                    for delta in deltas: b=apply_patch_bytes(b,delta)
                    assert b==versions[-1]
                    return b
                targets[-1]['flat_reconstruct']=timed(flat_read)
                with zipfile.ZipFile(folder/'flat-diffs.zip') as z:
                    selected=[i for i in z.infolist() if i.filename.startswith(path+'@')]
                    targets[-1]['flat_payload_bytes']=sum(i.compress_size for i in selected)
                    targets[-1]['flat_decoded_bytes']=sum(i.file_size for i in selected)
                if heading:
                    lines=versions[-1].splitlines()
                    start=next((i+1 for i,l in enumerate(lines) if l.decode()==heading),None)
                    if start:
                        end=next((i for i in range(start,len(lines)) if re.match(rb'^#{1,6} ',lines[i])),len(lines))
                        targets[-1]['native_section_log']=timed(lambda:git(packed_repo,'log','--format=fuller',f'-L{start},{end}:{path}','main'))
            fixture=dict(corpus=name,head=head,commits=commits,targets=targets,
                         files=[dict(path=p,url='/'+(packed_repo/Path(p.removeprefix('.git/'))).relative_to(WORK).as_posix(),bytes=len(b)) for p,b in repo_payload],
                         bundle_url='/'+bundle_path.relative_to(WORK).as_posix(), bundle_bytes=bundle_path.stat().st_size,
                         pack_path='.git/'+packpath.relative_to(packed_repo).as_posix())
            browser_fixtures.append(fixture)
        rows.append(row)
        print(name,label,[(v,r['bytes']) for v,r in row['variants'].items()],flush=True)
    for row in rows:
        for v, info in row['variants'].items():
            info['over_base_pct']=(info['bytes']/rows[0]['variants'][v]['bytes']-1)*100
    return dict(corpus=name, rows=rows, fixtures=browser_fixtures,
                source_commits=revisions, projected_commits=commits,
                original_merge_commits=sum(len(m['source_parents'])>1 for m in records[1:]))


if __name__=='__main__':
    WORK.mkdir(parents=True,exist_ok=True)
    result=dict(versions=dict(git=git(ROOT,'--version').decode().strip(),python=platform.python_version(),
                             zlib=zlib.ZLIB_VERSION,platform=platform.platform()),corpora=[])
    for name,folder,prefix,rev in [('npm','npm-cli','docs/lib/content',compression.PIN_NPM),
                                   ('rust','rust-rfcs','text',compression.PIN_RUST)]:
        result['corpora'].append(run_corpus(name,compression.WORK/folder,prefix,rev))
        save('size-results.json',result)
    result['checks']=dict(CHECKS)
    save('size-results.json',result)
    compression.save(WORK/'fixtures.json',[f for c in result['corpora'] for f in c['fixtures']])
    print(json.dumps(result['checks']),flush=True)
