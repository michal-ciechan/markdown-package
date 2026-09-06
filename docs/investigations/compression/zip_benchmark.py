"""ZIP follow-up: same git payloads/order/codecs as benchmark.py, real containers.

Not a format implementation. Regenerates ignored fixtures and committed evidence.
"""
import io
import json
import platform
import re
import struct
import tarfile
import zipfile
import zlib

from benchmark import WORK, OUT, PIN_NPM, PIN_RUST, blocks, codec, corpus, save, sha

DEST = WORK / 'zip'
MANIFEST = b'{"format":"markdown-package","version":1}\n'
COMMENT = b'MDPKG/1'
EXTRA_ID = 0xD06D  # Experiment only; NOT an allocated production header ID.
CHECKS = dict(corpus_entries=0, baseline_sizes=0, payload_roundtrips=0,
              document_section_hashes=0, metadata_boundaries=0)


def zip_bytes(items, prefix=b'', comment=b''):
    """items = (name, bytes, method), or ZipInfo in place of name."""
    b = io.BytesIO()
    b.write(prefix)
    with zipfile.ZipFile(b, 'w', allowZip64=True) as z:
        z.comment = comment
        for name, data, method in items:
            info = name if isinstance(name, zipfile.ZipInfo) else zipfile.ZipInfo(name)
            info.compress_type = method
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, data, compress_type=method, compresslevel=6)
    return b.getvalue()


def tar_bytes(entries):
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode='w', format=tarfile.PAX_FORMAT) as t:
        for e in entries:
            info = tarfile.TarInfo(e['key'])
            info.size = len(e['data'])
            info.mode = 0o644
            t.addfile(info, io.BytesIO(e['data']))
    return b.getvalue()


def verify_tar(raw, entries):
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        assert t.getnames() == [e['key'] for e in entries]
        for e in entries:
            assert t.extractfile(e['key']).read() == e['data']
            CHECKS['payload_roundtrips'] += 1


def layout(data):
    p = len(data) - 22
    while p >= max(0, len(data)-65557):
        if data[p:p+4] == b'PK\x05\x06' and p+22+struct.unpack_from('<H', data, p+20)[0] == len(data):
            break
        p -= 1
    else:
        raise ValueError('No valid terminal EOCD')
    count, size, offset = struct.unpack_from('<HII', data, p+10)
    assert data[offset:offset+4] == b'PK\x01\x02'
    return dict(eocd_offset=p, cd_offset=offset, cd_bytes=size, count=count,
                comment_bytes=len(data)-p-22)


def first_section(data):
    # Deliberately just the two inspected target fixtures, not a Markdown parser.
    headings = list(re.finditer(rb'^#{1,6} [^\r\n]+', data, re.M))
    a, b = headings[0].start(), headings[1].start()
    return dict(heading=headings[0].group().decode(), offset=a, bytes=b-a,
                sha256=sha(data[a:b]))


def run_corpus(name, repo, prefix, revision, previous):
    old = json.loads((OUT / f'{name}-corpus.json').read_text())
    entries, manifest = corpus(name, repo, prefix, revision)
    assert old == manifest, 'Corpus drift'
    CHECKS['corpus_entries'] += len(entries)
    entries = sorted(entries, key=lambda e: e['key'])
    raw = b''.join(e['data'] for e in entries)
    target = next(e for e in reversed(entries) if e['kind']=='base' and 1024 <= len(e['data']) <= 8192)
    section = first_section(target['data'])
    target_offset = sum(len(e['data']) for e in entries[:entries.index(target)])
    solid = min((r for r in previous if r['corpus']==name and 'order' not in r), key=lambda r:r['whole_bytes'])
    gzenc, gzdec = codec('gzip-6')
    zsenc, zsdec = codec('zstd-9')
    tar = tar_bytes(entries)
    tgz, tzst = gzenc(tar), zsenc(tar)
    verify_tar(gzdec(tgz), entries)
    verify_tar(zsdec(tzst), entries)
    gzwhole = gzenc(raw)
    gzentries = [gzenc(e['data']) for e in entries]
    oldgz = next(r for r in previous if r['corpus']==name and r['codec']=='gzip-6' and 'order' not in r)
    assert len(gzwhole) == oldgz['whole_bytes']
    assert sum(map(len,gzentries)) == oldgz['entry_bytes']
    CHECKS['baseline_sizes'] += 2
    target_gzip = gzentries[entries.index(target)]
    regular = [(e['key'], e['data'], zipfile.ZIP_DEFLATED) for e in entries]
    stored = [(e['key'], e['data'], zipfile.ZIP_STORED) for e in entries]
    groups = blocks(entries, 65536)
    block_items, block_index, block_raw = [], [], []
    target_block = None
    for i, group in enumerate(groups):
        tr = tar_bytes(group)
        member = f'blocks/{i:04}.tar.gz'
        packed = gzenc(tr)
        block_items.append((member, packed, zipfile.ZIP_STORED))
        block_raw.append(tr)
        with tarfile.open(fileobj=io.BytesIO(tr)) as t:
            block_index.extend([e['key'], i, t.getmember(e['key']).offset_data, len(e['data'])] for e in group)
        verify_tar(gzdec(packed), group)
        if target in group:
            target_block = i
    index_data = json.dumps(dict(format='mdpkg-block-experiment',version=1,entries=block_index),separators=(',',':')).encode()+b'\n'
    variants = {
        'zip-deflate-6': zip_bytes(regular),
        'zip-stored': zip_bytes(stored),
        'zip-solid-tar-gzip-6': zip_bytes([('payload.tar.gz',tgz,0)]),
        'zip-solid-tar-zstd-9': zip_bytes([('payload.tar.zst',tzst,0)]),
        'zip-block64k-tar-gzip-6': zip_bytes([('.mdpkg/blocks.json',index_data,0)]+block_items),
        'zip-dual-deflate-and-solid-gzip': zip_bytes(regular+[('.mdpkg/payload.tar.gz',tgz,0)]),
        'zip-deflate-versioned': zip_bytes([('.mdpkg/manifest.json',MANIFEST,0)]+regular,comment=COMMENT),
    }
    folder = DEST/name
    folder.mkdir(parents=True, exist_ok=True)
    rows, accesses = [], []
    def row(variant, size, **kwargs):
        rows.append(dict(variant=variant,bytes=size,over_best_solid_pct=(size/solid['whole_bytes']-1)*100,**kwargs))
    row('best-solid-'+solid['codec'], solid['whole_bytes'])
    row('whole-gzip-6',len(gzwhole))
    row('per-entry-gzip-6',sum(map(len,gzentries)))
    def access(variant, packed, decoded, **kwargs):
        accesses.append(dict(variant=variant,document_payload_bytes=packed,section_payload_bytes=packed,
                             document_decode_bytes=decoded,section_decode_bytes=decoded,**kwargs))
    access('best-solid-'+solid['codec'],solid['whole_bytes'],len(raw))
    access('whole-gzip-6',len(gzwhole),len(raw))
    access('per-entry-gzip-6',len(target_gzip),len(target['data']))
    assert gzdec(gzwhole)[target_offset:target_offset+len(target['data'])] == target['data']
    assert gzdec(target_gzip) == target['data']
    CHECKS['document_section_hashes'] += 2
    for variant, data in variants.items():
        (folder/(variant+'.zip')).write_bytes(data)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                payload = z.read(info)
                CHECKS['payload_roundtrips'] += 1
                if info.filename in {e['key'] for e in entries}:
                    assert payload == next(e['data'] for e in entries if e['key']==info.filename)
                elif info.filename.endswith('payload.tar.gz'):
                    assert gzdec(payload) == tar
                elif info.filename.endswith('payload.tar.zst'):
                    assert zsdec(payload) == tar
                elif info.filename == '.mdpkg/blocks.json':
                    assert payload == index_data
                elif info.filename == '.mdpkg/manifest.json':
                    assert payload == MANIFEST
                else:
                    i = int(info.filename.split('/')[1].split('.')[0])
                    assert gzdec(payload) == block_raw[i]
            meta = layout(data)
            row(variant,len(data),sha256=sha(data),payload_bytes=sum(i.compress_size for i in z.infolist()),
                overhead_bytes=len(data)-sum(i.compress_size for i in z.infolist()),**meta)
            if variant in ('zip-deflate-6','zip-stored','zip-dual-deflate-and-solid-gzip','zip-deflate-versioned'):
                member = target['key']; decoded = len(target['data']); output = z.read(member)
            elif variant=='zip-solid-tar-gzip-6':
                member = 'payload.tar.gz'; decoded = len(tar)
                output = tarfile.open(fileobj=io.BytesIO(gzdec(z.read(member)))).extractfile(target['key']).read()
            elif variant=='zip-solid-tar-zstd-9':
                member = 'payload.tar.zst'; decoded = len(tar)
                output = tarfile.open(fileobj=io.BytesIO(zsdec(z.read(member)))).extractfile(target['key']).read()
            else:
                member = f'blocks/{target_block:04}.tar.gz'; decoded = len(block_raw[target_block])
                output = tarfile.open(fileobj=io.BytesIO(gzdec(z.read(member)))).extractfile(target['key']).read()
            assert output == target['data']
            assert sha(output[section['offset']:section['offset']+section['bytes']]) == section['sha256']
            CHECKS['document_section_hashes'] += 2
            info = z.getinfo(member)
            local_size = 30 + len(info.filename.encode()) + len(info.extra)
            access(variant, info.compress_size, 0 if info.compress_type==0 and variant=='zip-stored' else decoded,
                   member=member,local_header_offset=info.header_offset,local_header_bytes=local_size,
                   data_offset=info.header_offset+local_size,metadata=meta)
            if variant=='zip-stored':
                accesses[-1]['section_payload_bytes'] = section['bytes']
            if variant=='zip-block64k-tar-gzip-6':
                idx = z.getinfo('.mdpkg/blocks.json')
                accesses[-1]['mapping_bytes'] = idx.file_size
                accesses[-1]['mapping_local_header_bytes'] = 30+len(idx.filename.encode())
    return dict(corpus=name,raw_bytes=len(raw),tar_raw_bytes=len(tar),tar_gzip_bytes=len(tgz),tar_zstd_bytes=len(tzst),
                tar_format='PAX, uid/gid/mtime=0, uname/gname empty, mode=0644, 10240-byte records',
                best_solid_codec=solid['codec'],best_solid_bytes=solid['whole_bytes'],rows=rows,access=accesses,
                block_count=len(groups),block_mapping_bytes=len(index_data),
                target=dict(key=target['key'],bytes=len(target['data']),sha256=sha(target['data']),
                            raw_offset=target_offset,section=section))


def metadata_fixtures():
    folder = DEST/'compat'
    folder.mkdir(parents=True,exist_ok=True)
    extra = struct.pack('<HH',EXTRA_ID,len(COMMENT))+COMMENT
    info = zipfile.ZipInfo('manifest.json')
    info.extra = extra
    info.comment = b'entry-version=1'
    items = [(info,MANIFEST,0),('document.md',b'# Example\n\nVerified payload.\n'*5000,8)]
    normal = zip_bytes(items,comment=COMMENT)
    cases = {'normal':normal,'prefix-1-adjusted':zip_bytes(items,b'\x01',COMMENT),
             'prefix-1-unadjusted':b'\x01'+normal,
             'prefix-3-adjusted':zip_bytes(items,b'\xff\xff\x00',COMMENT),
             'prefix-3-unadjusted':b'\xff\xff\x00'+normal}
    expected = {n.filename if isinstance(n,zipfile.ZipInfo) else n:sha(b) for n,b,_ in items}
    for name, data in cases.items():
        (folder/(name+'.zip')).write_bytes(data)
    maximum = zipfile.ZipInfo('maximum.txt')
    maximum.extra = struct.pack('<HH',EXTRA_ID,65531)+b'e'*65531
    maximum.comment = b'c'*65535
    maxdata = zip_bytes([(maximum,b'x',0)], comment=b'a'*65535)
    (folder/'metadata-maximum.zip').write_bytes(maxdata)
    with zipfile.ZipFile(io.BytesIO(maxdata)) as z:
        i = z.infolist()[0]
        assert len(z.comment)==65535 and len(i.comment)==65535 and len(i.extra)==65535
        assert z.read(i)==b'x'
        CHECKS['metadata_boundaries'] += 4
    local_extra_size = struct.unpack_from('<H',maxdata,28)[0]
    assert local_extra_size==65535
    CHECKS['metadata_boundaries'] += 1
    # EOCD-looking bytes inside the comment must not win the backward scan.
    fake = zip_bytes([('x',b'x',0)],comment=b'prefixPK\x05\x06'+b'\0'*24+b'suffix')
    (folder/'comment-false-signature.zip').write_bytes(fake)
    assert layout(fake)['count']==1
    CHECKS['metadata_boundaries'] += 1
    save(DEST/'compat-expected.json',dict(cases=list(cases),hashes=expected,extra_id=EXTRA_ID,
         manifest=MANIFEST.decode(),comment=COMMENT.decode(),entry_comment=info.comment.decode()))
    return dict(maximum=dict(bytes=len(maxdata),local_extra_bytes=local_extra_size,
                            custom_payload_bytes=65531,entry_comment_bytes=65535,**layout(maxdata)),
                version_profile=dict(manifest_bytes=len(MANIFEST),eocd_comment_bytes=len(COMMENT)))


if __name__=='__main__':
    previous = json.loads((OUT/'size-results.json').read_text())['rows']
    results = [run_corpus(n,WORK/r,p,rev,previous) for n,r,p,rev in
               [('npm','npm-cli','docs/lib/content',PIN_NPM),('rust','rust-rfcs','text',PIN_RUST)]]
    metadata = metadata_fixtures()
    save(OUT/'zip-results.json',dict(versions=dict(python=platform.python_version(),zlib=zlib.ZLIB_VERSION),
                                   corpora=results,metadata=metadata,checks=CHECKS))
    print(json.dumps(CHECKS),flush=True)
