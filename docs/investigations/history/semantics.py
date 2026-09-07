"""Executable counterexamples for shallow, synthetic-root, squash and section claims."""
import importlib.util
import json
from pathlib import Path
import uuid

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_benchmark',HERE/'benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)


def main():
    work=h.WORK/'semantics'/str(uuid.uuid4());work.mkdir(parents=True)
    repo=work/'source.git';h.init_repo(repo)
    # Stable IDs deliberately survive a heading rename; A also changes and reverts.
    texts=[b'<!-- section:a -->\n## Alpha\nold\n\n<!-- section:b -->\n## Beta\nold\n',
           b'<!-- section:a -->\n## Alpha\nnew\n\n<!-- section:b -->\n## Beta\nold\n',
           b'<!-- section:a -->\n## Alpha\nold\n\n<!-- section:b -->\n## Beta\nold\n',
           b'<!-- section:a -->\n## Alpha\nold\n\n<!-- section:b -->\n## Renamed\nnew\n']
    meta=dict(author='History Probe <probe@example.invalid> 1700000000 +0000',
              committer='History Probe <probe@example.invalid> 1700000000 +0000',source='0'*40)
    commits=[];trees=[]
    for i,b in enumerate(texts):
        trees.append(h.tree(repo,{'doc.md':h.put(repo,'blob',b)}))
        commits.append(h.commit(repo,trees[-1],commits[-1] if commits else None,dict(meta,message=f'Change {i}\n')))
    (repo/'refs/heads/main').write_text(commits[-1]+'\n')
    shallow=work/'shallow.git'
    h.git(work,'clone','--bare','--depth=2',repo.as_uri(),str(shallow))
    boundary=(shallow/'shallow').read_text().strip()
    assert boundary==commits[2]
    raw=h.git(shallow,'cat-file','commit',boundary).decode()
    assert 'parent '+commits[1] in raw
    traversal=h.git(shallow,'rev-list','--parents','main').decode().splitlines()
    assert traversal[-1]==boundary
    assert h.git(shallow,'rev-parse','--is-shallow-repository').strip()==b'true'
    h.git(shallow,'fsck','--full','--strict')
    shallow_bundle=work/'shallow.bundle'
    create=h.git(shallow,'bundle','create','--version=2',str(shallow_bundle),'main',check=False)
    shallow_result=dict(create_exit=create.returncode,create_stderr=create.stderr.decode(),
                        is_shallow=True,boundary=boundary,raw_parent_preserved=True,log_treats_boundary_as_root=True)
    empty=work/'empty.git';h.init_repo(empty)
    if create.returncode==0:
        verify=h.git(empty,'bundle','verify',str(shallow_bundle),check=False)
        fetch=h.git(empty,'fetch',str(shallow_bundle),'main:main',check=False)
        shallow_result.update(verify_exit=verify.returncode,verify_stderr=verify.stderr.decode(),
                              fetch_exit=fetch.returncode,fetch_stderr=fetch.stderr.decode(),
                              header=shallow_bundle.read_bytes().split(b'\n\n')[0].decode())
        assert fetch.returncode!=0
    incremental=work/'incremental.bundle'
    h.git(repo,'bundle','create','--version=2',str(incremental),'main~2..main')
    verify_empty=h.git(empty,'bundle','verify',str(incremental),check=False)
    assert verify_empty.returncode!=0
    h.git(repo,'bundle','verify',str(incremental))
    # Rewriting to a new root makes valid, self-contained Git, but loses native shallow evidence.
    root=h.commit(repo,trees[2],None,dict(meta,message='Snapshot\n'))
    tip=h.commit(repo,trees[3],root,dict(meta,message='Next\n'))
    synthetic=work/'synthetic.git';h.pack_repo(repo,tip,synthetic)
    assert h.git(synthetic,'rev-parse','--is-shallow-repository').strip()==b'false'
    synthetic_bundle=work/'synthetic.bundle'
    h.git(synthetic,'bundle','create',str(synthetic_bundle),'main')
    h.git(empty,'bundle','verify',str(synthetic_bundle))
    # Execute actual porcelain squash merge, then compare ordinary commit structure.
    (repo/'refs/heads/topic').write_text(commits[-1]+'\n')
    (repo/'refs/heads/main').write_text(commits[0]+'\n')
    checkout=work/'checkout'
    h.git(work,'clone','--no-hardlinks',str(repo),str(checkout))
    h.git(checkout,'merge','--squash','origin/topic')
    merge_head=(checkout/'.git/MERGE_HEAD').exists()
    assert not merge_head
    h.git(checkout,'-c','user.name=History Probe','-c','user.email=probe@example.invalid',
          '-c','commit.gpgsign=false','commit','-m','Collapsed update')
    squashed=h.git(checkout,'rev-parse','HEAD').decode().strip()
    parents=h.git(checkout,'rev-list','--parents','-1','HEAD').decode().split()[1:]
    assert parents==[commits[0]]
    assert h.git(checkout,'rev-parse','HEAD^{tree}').decode().strip()==trees[-1]
    # A normal commit-tree with the same ordinary fields has the identical object ID.
    raw=h.git(checkout,'cat-file','commit','HEAD')
    metadata=h.source_metadata(checkout,'HEAD')
    author=metadata['author'];committer=metadata['committer']
    old_env=h.ENV.copy()
    import re
    def set_identity(label,value):
        match=re.fullmatch(r'(.*) <(.*)> (\d+ [+-]\d{4})',value)
        h.ENV['GIT_'+label+'_NAME']=match[1];h.ENV['GIT_'+label+'_EMAIL']=match[2];h.ENV['GIT_'+label+'_DATE']=match[3]
    set_identity('AUTHOR',author);set_identity('COMMITTER',committer)
    try:
        ordinary=h.git(checkout,'commit-tree',trees[-1],'-p',commits[0],data=metadata['message'].encode()).decode().strip()
    finally:
        h.ENV.clear();h.ENV.update(old_env)
    assert ordinary==squashed
    def sections(b):
        chunks=re.split(rb'(?=<!-- section:)',b)
        return {re.match(rb'<!-- section:([^ ]+) -->',c)[1].decode():c for c in chunks if c}
    states=list(map(sections,texts))
    touched=set()
    for a,b in zip(states,states[1:]):touched|={k for k in a.keys()|b.keys() if a.get(k)!=b.get(k)}
    net={k for k in states[0].keys()|states[-1].keys() if states[0].get(k)!=states[-1].get(k)}
    assert touched=={'a','b'} and net=={'b'}
    result=dict(shallow=shallow_result,incremental_bundle=dict(header=incremental.read_bytes().split(b'\n\n')[0].decode(),
                empty_verify_exit=verify_empty.returncode,empty_verify_stderr=verify_empty.stderr.decode(),source_verify_exit=0),
                synthetic_root=dict(is_shallow=False,bundle_verify_exit=0,rewritten_commit_ids=True),
                squash=dict(parent_count=len(parents),merge_head_written=merge_head,ordinary_commit_same_oid=True,oid=squashed),
                sections=dict(touched_across_range=sorted(touched),net_changed=sorted(net),
                              heading_rename_retains_id='b',after_truncation_old_a_change='unknown',
                              retained_touched_summary_bytes=len(h.json_bytes(sorted(touched)))),
                semantic_cases=5,unexpected_failures=0)
    h.save('semantics-results.json',result)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
