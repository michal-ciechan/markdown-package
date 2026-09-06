"""CARD-0002 experiment only; concatenated byte fixtures are NOT a package format.

Run with the pinned dependencies and source checkouts described in compression.md.
All source bytes come from git objects (independent of checkout CRLF settings).
"""
import argparse
import gc
import gzip
import hashlib
import io
import json
import lzma
import platform
import random
import re
import statistics
import subprocess
import sys
import time
import zlib
from pathlib import Path

import brotli
import psutil
import zstandard as zstd

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / '.antiphon/compression-work'
OUT = Path(__file__).resolve().parent
PIN_NPM = '3b30e0b1f1ee9c7119d352dc4f9a27d53f24b988'
PIN_RUST = 'f38f19132505ef47c5053cd71ac444932dfd0256'


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def corpus(name, repo, prefix, revision):
    head = git(repo, 'rev-parse', revision).decode().strip()
    # Latest 32 first-parent commits affecting Markdown, including merges. Diffs
    # against parent 1 make this a reproducible linear sequence for CARD-0003.
    commits = git(repo, 'log', '-32', '--first-parent', '--format=%H', head,
                  '--', f'{prefix}/*.md').decode().splitlines()[::-1]
    assert len(commits) == 32, (name, len(commits))
    base = git(repo, 'rev-parse', commits[0] + '^').decode().strip()
    paths = git(repo, 'ls-tree', '-r', '--name-only', base, '--', prefix).decode().splitlines()
    entries = []
    paths=[p for p in paths if p.endswith('.md')]
    batch=subprocess.run(['git','-C',str(repo),'cat-file','--batch'],
                         input=''.join(base+':'+p+'\n' for p in paths).encode(),stdout=subprocess.PIPE,check=True)
    reader=io.BytesIO(batch.stdout)
    for path in paths:
        header=reader.readline().decode().split()
        assert header[1]=='blob',header
        data=reader.read(int(header[2])); assert reader.read(1)==b'\n'
        entries.append(dict(key=path+'@base',path=path,kind='base',data=data))
    base_count = len(entries)
    for n, commit in enumerate(commits):
        changed = git(repo, 'diff', '--name-only', '--no-renames',
                      commit+'^', commit, '--', prefix).decode().splitlines()
        for path in changed:
            if path.endswith('.md'):
                delta = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
                            '--unified=3', '--no-color', commit + '^', commit, '--', path)
                if delta:
                    entries.append(dict(key=f'{path}@diff{n:02}', path=path, kind='diff', data=delta))
    manifest = dict(name=name, repository=f'https://github.com/{"npm/cli" if name == "npm" else "rust-lang/rfcs"}',
                    head=head, base=base, commits=commits, base_count=base_count,
                    diff_count=len(entries)-base_count, raw_bytes=sum(len(e['data']) for e in entries),
                    base_bytes=sum(len(e['data']) for e in entries if e['kind']=='base'),
                    diff_bytes=sum(len(e['data']) for e in entries if e['kind']=='diff'),
                    median_entry_bytes=statistics.median(len(e['data']) for e in entries),
                    entries=[dict(**{k:v for k,v in e.items() if k!='data'}, bytes=len(e['data']), sha256=sha(e['data'])) for e in entries])
    save(OUT / f'{name}-corpus.json', manifest)
    print(json.dumps({k:v for k,v in manifest.items() if k not in ('entries','commits')}), flush=True)
    return entries, manifest


def codec(name, dictionary=None):
    kind, level = name.rsplit('-', 1)
    level = int(level)
    if kind == 'gzip':
        return lambda b: gzip.compress(b, compresslevel=level, mtime=0), gzip.decompress
    if kind == 'deflate':
        return lambda b: zlib.compress(b, level), zlib.decompress
    if kind == 'raw':
        def compress(b):
            c = zlib.compressobj(level, wbits=-15)
            return c.compress(b) + c.flush()
        return compress, lambda b: zlib.decompress(b, -15)
    if kind == 'brotli':
        return lambda b: brotli.compress(b, quality=level, mode=brotli.MODE_TEXT, lgwin=22), brotli.decompress
    if kind == 'zstd':
        c = zstd.ZstdCompressor(level=level, dict_data=dictionary, write_checksum=True, write_content_size=True, threads=0)
        d = zstd.ZstdDecompressor(dict_data=dictionary)
        return c.compress, d.decompress
    if kind == 'xz':
        return lambda b: lzma.compress(b, preset=level, format=lzma.FORMAT_XZ), lzma.decompress
    raise ValueError(name)


def orders(entries):
    path = sorted(entries, key=lambda e:e['key'])
    shuffled = path[:]
    random.Random(42).shuffle(shuffled)
    tokens = [set(re.findall(rb'[a-z]{3,}', e['data'].lower())) for e in path]
    remaining = set(range(1,len(path)))
    chain = [0]
    while remaining:
        prev = tokens[chain[-1]]
        best = max(remaining, key=lambda j:(len(prev & tokens[j]) / max(1,len(prev | tokens[j])), -j))
        chain.append(best)
        remaining.remove(best)
    return {'path':path, 'random42':shuffled, 'similarity':[path[i] for i in chain]}


def blocks(entries, cap):
    result, group, length = [], [], 0
    for e in entries:
        if group and length + len(e['data']) > cap:
            result.append(group)
            group, length = [], 0
        group.append(e)
        length += len(e['data'])
    if group:
        result.append(group)
    return result


def measure(name, entries, manifest):
    ordering = orders(entries)
    path = ordering['path']
    raw = b''.join(e['data'] for e in path)
    candidates = ['gzip-6','gzip-9','deflate-6','raw-6','brotli-5','brotli-9','brotli-11','zstd-3','zstd-9','zstd-19','xz-6']
    rows, fixtures = [], []
    # Small document near the end, rather than the package's large outlier.
    target = next(e for e in reversed(path) if e['kind']=='base' and 1024 <= len(e['data']) <= 8192)
    fixture_dir = WORK / 'fixtures' / name
    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / 'target.raw').write_bytes(target['data'])
    for candidate in candidates:
        enc, dec = codec(candidate)
        start = time.perf_counter()
        whole = enc(raw)
        enc_ms = (time.perf_counter()-start)*1000
        assert dec(whole) == raw
        start = time.perf_counter()
        compressed = [enc(e['data']) for e in path]
        per_ms = (time.perf_counter()-start)*1000
        for e, b in zip(path, compressed):
            assert dec(b) == e['data']
        row = dict(corpus=name, codec=candidate, whole_bytes=len(whole),
                   entry_bytes=sum(map(len,compressed)), stored_or_entry_bytes=sum(min(len(b),len(e['data'])) for e,b in zip(path,compressed)),
                   whole_encode_ms=enc_ms, entry_encode_ms=per_ms,
                   base_entry_bytes=sum(len(b) for e,b in zip(path,compressed) if e['kind']=='base'),
                   diff_entry_bytes=sum(len(b) for e,b in zip(path,compressed) if e['kind']=='diff'))
        groups = blocks(path,65536)
        group_encoded = [enc(b''.join(e['data'] for e in g)) for g in groups]
        row['block64k_bytes'] = sum(map(len,group_encoded))
        row['block64k_count'] = len(groups)
        rows.append(row)
        if candidate in ['gzip-6','deflate-6','raw-6','brotli-5','zstd-9','xz-6']:
            pos = path.index(target)
            target_offset = sum(len(e['data']) for e in path[:pos])
            group_index = next(i for i,g in enumerate(groups) if target in g)
            group = groups[group_index]
            group_offset = sum(len(e['data']) for e in group[:group.index(target)])
            for mode,b,offset,total in [('whole',whole,target_offset,len(raw)),('entry',compressed[pos],0,len(target['data'])),
                                        ('block64k',group_encoded[group_index],group_offset,sum(len(e['data']) for e in group))]:
                file = f'{candidate}-{mode}.bin'
                (fixture_dir/file).write_bytes(b)
                fixtures.append(dict(corpus=name, codec=candidate, mode=mode, file=f'{name}/{file}',
                                     offset=offset, raw_bytes=total, target_bytes=len(target['data']), target_key=target['key'],
                                     compressed_bytes=len(b), target_sha256=sha(target['data'])))
        print(name,candidate,row['whole_bytes'],row['entry_bytes'],flush=True)
    for order_name, order in ordering.items():
        for candidate in ['gzip-6','brotli-5','zstd-9','xz-6']:
            enc,_ = codec(candidate)
            rows.append(dict(corpus=name, codec=candidate, order=order_name,
                             whole_bytes=len(enc(b''.join(e['data'] for e in order))),
                             block64k_bytes=sum(len(enc(b''.join(e['data'] for e in g))) for g in blocks(order,65536)),
                             block256k_bytes=sum(len(enc(b''.join(e['data'] for e in g))) for g in blocks(order,262144))))
    dictionary_rows = []
    for size in [16384,65536]:
        # In-package training is legitimate but optimistic; held-out experiment splits
        # by original path so a path's base and diffs can never straddle train/test.
        for split in ['package','heldout']:
            train = [e for e in path if split == 'package' or int(sha(e['path'].encode())[:8],16)%5 != 0]
            evaluate = path if split == 'package' else [e for e in path if int(sha(e['path'].encode())[:8],16)%5 == 0]
            dictionary = zstd.train_dictionary(size, [e['data'] for e in train], k=2000,d=8,steps=4,threads=0)
            print(name,'dictionary',size,split,flush=True)
            enc,dec = codec('zstd-9',dictionary)
            without,_ = codec('zstd-9')
            sizes = []
            for e in evaluate:
                b = enc(e['data'])
                assert dec(b) == e['data']
                sizes.append(len(b))
            dictionary_rows.append(dict(corpus=name, split=split, dictionary_bytes=len(dictionary.as_bytes()),
                                        dictionary_sha256=sha(dictionary.as_bytes()), train_entries=len(train), test_entries=len(evaluate),
                                        raw_test_bytes=sum(len(e['data']) for e in evaluate), frames_bytes=sum(sizes),
                                        total_bytes=sum(sizes)+len(dictionary.as_bytes()),
                                        without_dictionary_bytes=sum(len(without(e['data'])) for e in evaluate)))
            if split=='package' and size==16384:
                (fixture_dir/'dictionary.bin').write_bytes(dictionary.as_bytes())
                b = enc(target['data'])
                (fixture_dir/'zstd-dict-entry.bin').write_bytes(b)
                fixtures.append(dict(corpus=name,codec='zstd-9',mode='dict-entry',file=f'{name}/zstd-dict-entry.bin',
                                     dictionary=f'{name}/dictionary.bin',offset=0,raw_bytes=len(target['data']),
                                     target_bytes=len(target['data']),target_key=target['key'],compressed_bytes=len(b),target_sha256=sha(target['data'])))
    return rows, dictionary_rows, fixtures


def stream_decode(name, data, offset, size, dictionary):
    kind = name.rsplit('-',1)[0]
    if kind == 'zstd':
        reader = zstd.ZstdDecompressor(dict_data=dictionary).stream_reader(io.BytesIO(data))
        def chunks():
            with reader:
                while True:
                    b = reader.read(65536)
                    if not b: break
                    yield b
    else:
        d = (zlib.decompressobj(31 if kind=='gzip' else 15 if kind=='deflate' else -15) if kind in ['gzip','deflate','raw']
             else brotli.Decompressor() if kind=='brotli' else lzma.LZMADecompressor())
        def chunks():
            for i in range(0,len(data),4096):
                b = data[i:i+4096]
                yield d.process(b) if kind=='brotli' else d.decompress(b)
    pos, target = 0, bytearray()
    for b in chunks():
        a, end = max(0,offset-pos), min(len(b),offset+size-pos)
        if end>a: target.extend(b[a:end])
        pos += len(b)
    return bytes(target)


def native_case(fixture, streamed):
    data = (WORK/'fixtures'/fixture['file']).read_bytes()
    dictionary = zstd.ZstdCompressionDict((WORK/'fixtures'/fixture['dictionary']).read_bytes()) if 'dictionary' in fixture else None
    gc.collect()
    p = psutil.Process()
    before = p.memory_info()
    start = time.perf_counter()
    kind=fixture['codec'].rsplit('-',1)[0]
    dec = (gzip.decompress if kind=='gzip' else zlib.decompress if kind=='deflate' else
           (lambda b:zlib.decompress(b,-15)) if kind=='raw' else brotli.decompress if kind=='brotli' else
           zstd.ZstdDecompressor(dict_data=dictionary).decompress if kind=='zstd' else lzma.decompress)
    def run():
        if streamed:
            return stream_decode(fixture['codec'],data,fixture['offset'],fixture['target_bytes'],dictionary)
        result = dec(data)
        return result[fixture['offset']:fixture['offset']+fixture['target_bytes']]
    output = run()
    first_ms = (time.perf_counter()-start)*1000
    after = p.memory_info()
    assert sha(output)==fixture['target_sha256']
    timings=[]
    for _ in range(31):
        start=time.perf_counter()
        output=run()
        timings.append((time.perf_counter()-start)*1000)
    assert sha(output)==fixture['target_sha256']
    return dict(codec=fixture['codec'],mode=fixture['mode'],streamed=streamed,first_ms=first_ms,
                median_ms=statistics.median(timings),p95_ms=sorted(timings)[29],
                rss_before=before.rss,peak_rss=after.peak_wset,
                peak_increase=max(0,after.peak_wset-before.peak_wset),rss_after=after.rss)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--native-case')
    parser.add_argument('--native',action='store_true')
    parser.add_argument('--stream',action='store_true')
    args=parser.parse_args()
    if args.native_case:
        print(json.dumps(native_case(json.loads(args.native_case),args.stream)))
    elif args.native:
        fs=json.loads((WORK/'fixtures/index.json').read_text())
        results=[]
        for f in fs:
            if f['corpus']!='rust': continue
            for streamed in ([False,True] if f['mode']=='whole' else [False]):
                cmd=[sys.executable,__file__,'--native-case',json.dumps(f)] + (['--stream'] if streamed else [])
                samples=[json.loads(subprocess.check_output(cmd)) for _ in range(3)]
                result=dict(fixture=f,samples=samples)
                results.append(result)
                print(f['codec'],f['mode'],streamed,statistics.median(s['median_ms'] for s in samples),flush=True)
        save(OUT/'native-results.json',results)
    else:
        all_rows,all_dicts,all_fixtures=[],[],[]
        for name,repo,prefix,rev in [('npm',WORK/'npm-cli','docs/lib/content',PIN_NPM),('rust',WORK/'rust-rfcs','text',PIN_RUST)]:
            entries,manifest=corpus(name,repo,prefix,rev)
            rows,dicts,fixtures=measure(name,entries,manifest)
            all_rows.extend(rows); all_dicts.extend(dicts); all_fixtures.extend(fixtures)
            save(OUT/'size-results.json',dict(versions=dict(python=platform.python_version(),brotli=brotli.__version__,zstandard=zstd.__version__,libzstd=zstd.ZSTD_VERSION,zlib=zlib.ZLIB_VERSION), rows=all_rows,dictionaries=all_dicts))
            save(WORK/'fixtures/index.json',all_fixtures)
