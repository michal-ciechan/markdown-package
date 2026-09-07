"""Independent Git pack dependency probe; not a browser library or format reader.

Use Git's verified index to locate extents, then implement the documented pack
headers/deltas and validate every reconstructed object against its Git object ID.
Counts exact selected object bytes, including recursively required delta bases.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path
import zlib

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_benchmark',HERE/'benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)


def delta(base, code):
    p=0
    def varint():
        nonlocal p
        n,shift=0,0
        while True:
            b=code[p];p+=1;n|=(b&127)<<shift;shift+=7
            if not b&128:return n
    assert varint()==len(base)
    size=varint();out=bytearray()
    while p<len(code):
        c=code[p];p+=1
        if c&128:
            offset,length=0,0
            for bit in range(4):
                if c&(1<<bit):offset|=code[p]<<(8*bit);p+=1
            for bit in range(3):
                if c&(1<<(bit+4)):length|=code[p]<<(8*bit);p+=1
            length=length or 65536
            assert offset+length<=len(base)
            out.extend(base[offset:offset+length])
        else:
            assert c and p+c<=len(code)
            out.extend(code[p:p+c]);p+=c
    assert len(out)==size
    return bytes(out)


class Reader:
    def __init__(self,repo,pack):
        self.data=pack.read_bytes();self.objects={};self.by_offset={}
        assert self.data[:4]==b'PACK'
        raw=h.git(repo,'verify-pack','-v',str(pack.with_suffix('.idx'))).decode()
        for line in raw.splitlines():
            if re.match(r'^[a-f0-9]{40} ',line):
                r=line.split();oid=r[0];at=int(r[4])
                self.objects[oid]=dict(at=at,extent=int(r[3]))
                self.by_offset[at]=oid
        self.cache={};self.decoded={};self.hits=0

    def read(self,oid):
        if oid in self.cache:return self.cache[oid]
        r=self.objects[oid];at=r['at'];p=at
        c=self.data[p];p+=1;kind=(c>>4)&7;size=c&15;shift=4
        while c&128:
            c=self.data[p];p+=1;size|=(c&127)<<shift;shift+=7
        base=None
        if kind==6:
            c=self.data[p];p+=1;back=c&127
            while c&128:
                c=self.data[p];p+=1;back=((back+1)<<7)|(c&127)
            base=self.by_offset[at-back]
        elif kind==7:
            base=self.data[p:p+20].hex();p+=20
        d=zlib.decompressobj();raw=d.decompress(self.data[p:at+r['extent']]);raw+=d.flush()
        assert d.eof and not d.unused_data and len(raw)==size
        self.decoded[oid]=len(raw)
        if base:
            real_kind,previous=self.read(base);out=delta(previous,raw)
        else:
            real_kind={1:'commit',2:'tree',3:'blob',4:'tag'}[kind];out=raw
        assert h.object_id(real_kind,out)==oid
        self.hits+=1;self.cache[oid]=(real_kind,out)
        return real_kind,out

    def document(self,commit,path):
        kind,data=self.read(commit);assert kind=='commit'
        tr=data.splitlines()[0].split()[1].decode()
        for name in path.split('/'):
            kind,data=self.read(tr);assert kind=='tree'
            p=0;entries={}
            while p<len(data):
                end=data.index(b'\0',p);mode,key=data[p:end].split(b' ',1)
                entries[key.decode()]=data[end+1:end+21].hex();p=end+21
            tr=entries[name]
        kind,data=self.read(tr);assert kind=='blob'
        return data


if __name__=='__main__':
    fixtures=json.loads((h.WORK/'fixtures.json').read_text())
    rows=[]
    for f in fixtures:
        repo=h.WORK/f['corpus']/'32/repo.git'
        pack=repo/Path(f['pack_path'].removeprefix('.git/'))
        for target in f['targets']:
            r=Reader(repo,pack)
            for oid,expected in zip(f['commits'],target['versions']):
                b=r.document(oid,target['path'])
                assert h.compression.sha(b)==expected['sha256']
            own=set(v['oid'] for v in target['versions'])
            extra=[oid for oid,(kind,b) in r.cache.items() if kind=='blob' and oid not in own]
            rows.append(dict(corpus=f['corpus'],target=target['label'],path=target['path'],
                             whole_pack_bytes=len(r.data),selected_pack_bytes=sum(r.objects[o]['extent'] for o in r.cache),
                             selected_objects=len(r.cache),inflated_stream_bytes=sum(r.decoded.values()),
                             reconstructed_object_bytes=sum(len(b) for _,b in r.cache.values()),
                             extra_blob_bases=len(extra),extra_blob_base_bytes=sum(len(r.cache[o][1]) for o in extra),
                             object_hash_checks=r.hits,document_hash_checks=len(f['commits'])))
    h.save('pack-access-results.json',rows)
    print(json.dumps(rows,indent=2))
