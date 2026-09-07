"""Verify the proposal through real Git objects, shallow clones, squash, and ZIP.

Uses CARD-0003's Git object/pack helper and CARD-0002's deterministic ZIP writer.
Generated repositories stay in .antiphon/addressing-work; evidence JSON is saved here.
"""
import collections
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import uuid
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work'
h.WORK=WORK
COUNTS=collections.Counter()


def save(name,value):h.compression.save(HERE/name,value)
def load(name):return json.loads((HERE/name).read_text())
def commit(repo,state,parent,message,mode='identity'):
    files={d['path']:h.put(repo,'blob',d['source'].encode()) for d in state['documents']}
    if mode!='none':
        for path,text in state['metadata'].items():
            if mode=='cached' and '/ids/' in path:
                records=json.loads(text)
                for sid,record in records.items():
                    if sid in state['views']:record['digest']=state['views'][sid]['digest']
                text=json.dumps(records,sort_keys=True,separators=(',',':'))+'\n'
            files[path]=h.put(repo,'blob',text.encode())
    tree=h.tree(repo,files)
    meta=dict(author='Addressing Probe <probe@example.invalid> 1700000000 +0000',
              committer='Addressing Probe <probe@example.invalid> 1700000000 +0000',
              message=message,source='0'*40)
    return h.commit(repo,tree,parent,meta)


def snapshot_query(repo,oid,uri,kind,sid):
    reads=[]
    def read(path):
        data=h.git(repo,'show',oid+':'+path);reads.append(dict(path=path,bytes=len(data)));return data
    config=json.loads(read('.mdpkg/address/config.json'))
    digits=config['shardHex']
    record_path=f'.mdpkg/address/ids/{sid[:digits]}.json'
    records=json.loads(read(record_path));record=records[sid]
    docs=[]
    if record['k']!='retired':
        did=sid if kind=='document' else record['document']
        if did[:digits]!=sid[:digits]:records.update(json.loads(read(f'.mdpkg/address/ids/{did[:digits]}.json')))
        dr=records[did];source=read(dr['path']).decode()
        docs=[dict(id=did,path=dr['path'],source=source)]
    COUNTS['native_snapshot_queries']+=1
    return dict(uri=uri,state=dict(namespace=config['namespace'],records=records,documents=docs),
                git=dict(commit=oid,reads=reads,log_walks=0))


def pack_zip(repo,oid,folder,manifest,level=6):
    packed=folder/'repo.git';h.pack_repo(repo,oid,packed)
    items=[('.mdpkg/manifest.json',h.json_bytes(manifest))]+h.repo_items(packed)
    raw=h.archive(items);dest=folder/'package.zip';dest.write_bytes(raw)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.infolist()[0].filename=='.mdpkg/manifest.json' and z.infolist()[0].compress_type==0
        assert z.testzip() is None
        for name,data in items:assert z.read(name)==data;COUNTS['zip_entry_roundtrips']+=1
    COUNTS['packed_repositories_checked']+=1
    return dict(bytes=len(raw),sha256=h.compression.sha(raw),pack_bytes=sum(p.stat().st_size for p in packed.glob('objects/pack/*.pack')),
                manifest_bytes=len(items[0][1]),file=str(dest.relative_to(WORK)))


def main():
    states=json.loads((WORK/'states.json').read_text());cases=load('case-results.json')
    folder=WORK/'git'/str(uuid.uuid4());folder.mkdir(parents=True)
    repo=folder/'source.git';h.init_repo(repo)
    base=commit(repo,states['base'],None,'Base')
    branches={'base':base}
    for name,state in states.items():
        if name!='base':branches[name]=commit(repo,state,base,name)
    renamed=branches['heading-rename']
    reverted=commit(repo,states['base'],renamed,'Revert heading rename')
    tip=commit(repo,states['unrelated'],reverted,'Unrelated later edit')
    (repo/'refs/heads/main').write_text(tip+'\n')
    # Keep the independently constructed awkward-case branches reachable for fsck.
    for name,oid in branches.items():(repo/'refs/heads'/name).write_text(oid+'\n')
    h.git(repo,'fsck','--full','--strict');COUNTS['source_repository_checks']+=1
    queries=[]
    ids=cases['ids'];S=ids['S'];D=ids['D'];O=ids['O'];R1=ids['R1'];NP=ids['NP'];P=ids['P'];C=ids['C']
    selections=[('base',S,'section','survives'),('unrelated',S,'section','survives'),
        ('heading-rename',S,'section','flagged-changed'),('duplicate-insert',ids['R2'],'section','survives'),
        ('move-within',S,'section','survives'),('move-across',S,'section','survives'),
        ('file-rename',D,'document','survives'),('child-edit',S,'section','flagged-changed'),
        ('promote-child',C,'section','flagged-changed'),('split',O,'section','flagged-changed'),
        ('merge',R1,'section','flagged-changed'),('delete',O,'section','flagged-changed'),
        ('first-heading',NP,'section','survives'),('preamble-edit',P,'section','flagged-changed'),
        ('crlf',S,'section','survives'),('separator-blanks',S,'section','survives')]
    def uri(sid,kind='section'):
        return f"mdpkg://{cases['namespace']}/v1/{kind}/{sid}?profile={cases['profile']}&expect={states['base']['views'][sid]['digest']}"
    for name,sid,kind,status in selections:
        q=snapshot_query(repo,branches[name],uri(sid,kind),kind,sid);q.update(name=name,expected=status);queries.append(q)
    # Real porcelain squash: checkout base, merge the actual three-update branch.
    (repo/'refs/heads/base').write_text(base+'\n')
    checkout=folder/'checkout'
    h.git(folder,'clone','--no-hardlinks',str(repo),str(checkout))
    h.git(checkout,'switch','--detach',base)
    h.git(checkout,'merge','--squash','origin/main')
    assert not (checkout/'.git/MERGE_HEAD').exists();COUNTS['squash_semantics']+=1
    h.git(checkout,'-c','user.name=Addressing Probe','-c','user.email=probe@example.invalid','-c','commit.gpgsign=false',
          'commit','-m','Squashed range')
    squash=h.git(checkout,'rev-parse','HEAD').decode().strip()
    assert h.git(checkout,'rev-parse','HEAD^{tree}')==h.git(repo,'rev-parse',tip+'^{tree}')
    assert h.git(checkout,'rev-list','--parents','-1','HEAD').decode().split()[1:]==[base]
    COUNTS['squash_semantics']+=2
    q=snapshot_query(checkout,squash,uri(S),'section',S);q.update(name='after-real-squash',expected='survives');queries.append(q)
    # Real shallow clone from just main; the old commit OIDs genuinely disappear.
    shallow=folder/'shallow.git'
    h.git(folder,'clone','--bare','--single-branch','--branch','main','--depth=2',repo.as_uri(),str(shallow))
    boundary=(shallow/'shallow').read_text().strip();assert boundary==reverted
    assert h.git(shallow,'rev-parse','--is-shallow-repository').strip()==b'true'
    assert h.git(shallow,'cat-file','-t',base,check=False).returncode!=0
    assert ('parent '+renamed) in h.git(shallow,'cat-file','commit',boundary).decode()
    h.git(shallow,'fsck','--full','--strict');COUNTS['shallow_semantics']+=5
    q=snapshot_query(shallow,tip,uri(S),'section',S);q.update(name='after-shallow-truncation',expected='survives');queries.append(q)
    # New root copies the metadata; it is self-contained but not natively shallow.
    synthetic=commit(repo,states['unrelated'],None,'Truncated synthetic snapshot')
    packed_synthetic=folder/'synthetic.git';h.pack_repo(repo,synthetic,packed_synthetic)
    assert h.git(packed_synthetic,'rev-parse','--is-shallow-repository').strip()==b'false'
    assert h.git(packed_synthetic,'cat-file','-t',base,check=False).returncode!=0
    COUNTS['synthetic_root_semantics']+=2
    q=snapshot_query(packed_synthetic,synthetic,uri(S),'section',S);q.update(name='after-synthetic-truncation',expected='survives');queries.append(q)
    tomb_root=commit(repo,states['delete'],None,'Truncated snapshot with tombstones')
    q=snapshot_query(repo,tomb_root,uri(O),'section',O);q.update(name='tombstone-carried-through-truncation',expected='flagged-changed');queries.append(q)
    # Standard Git file history observes a rename; IDs resolve without its heuristic.
    rename_output=h.git(repo,'diff','--name-status','--find-renames',base,branches['file-rename']).decode()
    assert 'R100\tspec.md\tfolder/renamed.md' in rename_output;COUNTS['native_file_rename_checks']+=1
    # Exact commit/diff/hunk references bind retained immutable endpoints and patch.
    patch=h.git(repo,'diff','--full-index','--text','--no-ext-diff','--no-textconv','--no-renames','--no-color','--no-indent-heuristic',
                '--diff-algorithm=myers','--unified=3',base,renamed,'--','spec.md')
    assert b'@@ ' in patch
    first_hunk=patch[patch.index(b'@@ '):]
    patch_hash=h.compression.sha(patch)
    immutable=dict(commit=f"mdpkg://{cases['namespace']}/v1/commit/sha1-{renamed}",
        diff=f"mdpkg://{cases['namespace']}/v1/diff/sha1-{base}..sha1-{renamed}?document={D}&profile=git-myers-u3-v1",
        hunk=f"mdpkg://{cases['namespace']}/v1/hunk/sha1-{base}..sha1-{renamed}?document={D}&profile=git-myers-u3-v1&patch={patch_hash}&ordinal=0",
        patch_sha256=patch_hash,patch_bytes=len(patch),hunk_sha256=h.compression.sha(first_hunk))
    (WORK/'immutable.patch').write_bytes(patch)
    # Compare same endpoints after repack; all retained Git identities are unchanged.
    p1=folder/'repack1/repo.git';h.pack_repo(repo,tip,p1)
    p2=folder/'repack2/repo.git';h.pack_repo(repo,tip,p2,window=250)
    for packed in (p1,p2):
        assert h.git(packed,'diff','--full-index','--text','--no-ext-diff','--no-textconv','--no-renames','--no-color','--no-indent-heuristic',
                     '--diff-algorithm=myers','--unified=3',base,renamed,'--','spec.md')==patch
        COUNTS['immutable_patch_after_repack']+=1
    manifest=dict(format='mdpkg-addressing-experiment',version=1,namespace=cases['namespace'],
                  currentCommit=tip,addressProfile=cases['profile'],history=dict(coverage='complete',walk='first-parent'))
    size_rows=[]
    # Actual four-snapshot Git pack overhead, with identical authored source in each row.
    for mode in ('none','identity','cached'):
        scratch=folder/(mode+'.git');h.init_repo(scratch)
        seq=[]
        for i,name in enumerate(['base','heading-rename','base','unrelated']):
            seq.append(commit(scratch,states[name],seq[-1] if seq else None,'Revision '+str(i),mode))
        (scratch/'refs/heads/main').write_text(seq[-1]+'\n')
        for scenario,head in [('full',seq[-1]),('squash',commit(scratch,states['unrelated'],seq[0],'Squash',mode)),
                              ('later-root',commit(scratch,states['unrelated'],None,'Later root',mode))]:
            mf=dict(manifest,currentCommit=head,history=dict(coverage='complete' if scenario!='later-root' else 'truncated',
                walk='first-parent',transform='squashed' if scenario=='squash' else 'original' if scenario=='full' else 'synthetic-root'))
            row=pack_zip(scratch,head,folder/(mode+'-'+scenario),mf);row.update(mode=mode,scenario=scenario);size_rows.append(row)
    # Repackage the same repository with a different member order after the manifest.
    items=[('.mdpkg/manifest.json',h.json_bytes(manifest))]+h.repo_items(p1)
    z1=h.archive(items);z2=h.archive(items[:1]+list(reversed(items[1:])))
    assert z1!=z2
    with zipfile.ZipFile(io.BytesIO(z1)) as a,zipfile.ZipFile(io.BytesIO(z2)) as b:
        for name,_ in items:assert a.read(name)==b.read(name);COUNTS['repackage_member_equalities']+=1
    # The exact old endpoints are unavailable when only the squash pack is shipped.
    shipped_squash=folder/'shipped-squash/repo.git';h.pack_repo(checkout,squash,shipped_squash)
    assert h.git(shipped_squash,'cat-file','-t',renamed,check=False).returncode!=0;COUNTS['removed_endpoint_checks']+=1
    result=dict(git=h.git(repo,'--version').decode().strip(),fixture_repo=str(repo.relative_to(WORK)),commits=dict(base=base,renamed=renamed,reverted=reverted,tip=tip,squash=squash,synthetic=synthetic),
                refs=immutable,shallow=dict(boundary=boundary,native_marker=True,old_commit_available=False),
                synthetic=dict(native_shallow_marker=False,explicit_coverage_required=True),
                size_rows=size_rows,checks=dict(COUNTS),failures=0)
    save('native-results.json',result)
    h.compression.save(WORK/'queries.json',queries)
    h.compression.save(WORK/'range-input.json',dict(states=[states[n] for n in ['base','heading-rename','base','unrelated']],
                                                  commits=['sha1-'+x for x in [base,renamed,reverted,tip]],emitted='sha1-'+squash))
    print(json.dumps(dict(checks=dict(COUNTS),sizes=[{k:r[k] for k in ('mode','scenario','bytes')} for r in size_rows]),indent=2))

if __name__=='__main__':main()
