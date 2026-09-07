"""Real Git-only fixtures for read-time addressing. No identity files are shipped."""
import importlib.util
import json
from pathlib import Path
import uuid
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
WORK=h.ROOT/'.antiphon/addressing-work';h.WORK=WORK
folder=WORK/'runtime-git'/uuid.uuid4().hex;source=folder/'source.git';h.init_repo(source)
meta=dict(author='Runtime Probe <probe@example.invalid> 1700000000 +0000',committer='Runtime Probe <probe@example.invalid> 1700000000 +0000',message='Runtime fixture',source='0'*40)
def commit(documents,parent=None):
    tr=h.tree(source,{d['path']:h.put(source,'blob',d['source'].encode()) for d in documents})
    return h.commit(source,tr,parent,meta)
def pack(head,label):
    dest=folder/label/'repo.git';h.pack_repo(source,head,dest)
    return str(dest.relative_to(h.ROOT)).replace('\\','/')
original=json.loads((WORK/'sparse-native-input.json').read_text(encoding='utf-8'))
cases=[]
for i,c in enumerate(original):
    a=commit(c['before']['documents']);b=commit(c['after']['documents'],a)
    (source/'refs/heads'/f'case-{i}').write_text(b+'\n')
    cases.append(dict(name=c['name'],a=a,b=b,namespace=c['before']['namespace'],before=c['beforeInventory'],after=c['afterInventory'],expectedState=c['after']))
chains={}
def chain(name,states):
    commits=[]
    for docs in states:commits.append(commit(docs,commits[-1] if commits else None))
    (source/'refs/heads'/name).write_text(commits[-1]+'\n')
    chains[name]=dict(commits=commits,repo=pack(commits[-1],name))
    return commits
def body(version,lines=32):
    # Short lines keep each changed paragraph wholly different to Git's span matcher.
    # Three lines per paragraph produce a roughly 5.5 KB document.
    return '\n'.join(f'Paragraph {i:02}.{j}: revision {version[i]:05} '+h.compression.sha(f'{i}-{j}-{version[i]}'.encode())[:24]
                     for i in range(lines) for j in range(3))+'\n'
version=[0]*32;states=[]
for i in range(513):
    if i:version[(i-1)%32]=i
    # Gradual rewrite + a heading rename every eighth transition, file move every 32.
    states.append([dict(path=f'spec-{i//32:03}.md',source=f'# Topic {i//8:03}\n'+body(version))])
long=chain('long',states)
versions=[0]*32;shared=[]
for i in range(33):
    if i:versions[(i-1)%32]=i
    shared.append([dict(path=f'spec-{i//32:03}.md',source=f'# Topic {i//8:03}\n'+'\n'.join(
        f'Paragraph {j:02}: source revision {versions[j]:05}; '+'documentation detail '*5 for j in range(32))+'\n')])
chain('shared-tail',shared)
for count in (1,32,128,512):
    chains[f'length-{count}']=dict(commits=long[:count+1],repo=pack(long[count],f'length-{count}'))
base=[dict(path='spec.md',source='# Topic\nOriginal content.\n')]
renamed=[dict(path='moved.md',source='# Renamed\nOriginal content.\n')]
revert=chain('rename-revert',[base,renamed,base,base])
replacement=chain('delete-recreate',[base,[],base,base])
chain('never-deleted',[base,base,base,base])
net_squash=commit(base,revert[0])
assert net_squash==commit(base,replacement[0])
chains['net-squash']=dict(commits=[revert[0],net_squash],repo=pack(net_squash,'net-squash'),
    indistinguishable_delete_recreate=True,omitted_review_commit=revert[1])
long_squash=commit(states[-1],long[0]);chains['long-squash']=dict(commits=[long[0],long_squash],repo=pack(long_squash,'long-squash'),omitted_review_commit=long[256])
root=commit(states[-1]);chains['synthetic-root']=dict(commits=[root],repo=pack(root,'synthetic-root'),omitted_review_commit=long[0])
shallow=folder/'shallow.git';h.git(folder,'clone','--bare','--single-branch','--branch','long','--depth=2',source.as_uri(),str(shallow))
assert (shallow/'shallow').exists();assert h.git(shallow,'cat-file','-e',long[0],check=False).returncode!=0
chains['shallow']=dict(commits=long[-2:],repo=str(shallow.relative_to(h.ROOT)).replace('\\','/'),omitted_review_commit=long[0])
branch=commit([dict(path='spec.md',source='# Branch\nDifferent side branch.\n')],long[0]);(source/'refs/heads/other').write_text(branch+'\n')
chains['other-branch']=dict(commits=[long[0],branch],repo=str(source.relative_to(h.ROOT)).replace('\\','/'))
h.git(source,'fsck','--full','--strict')
for name,c in chains.items():
    if 'omitted_review_commit' in c:assert h.git(h.ROOT/c['repo'],'cat-file','-e',c['omitted_review_commit'],check=False).returncode!=0
output=dict(sourceRepo=str(source.relative_to(h.ROOT)).replace('\\','/'),cases=cases,chains=chains,
    git=h.git(source,'--version').decode().strip(),metadataFiles=0)
h.compression.save(WORK/'runtime-input.json',output)
h.compression.save(HERE/'runtime-fixture-results.json',dict(git=output['git'],sourceRepo=output['sourceRepo'],chains=chains,
    adjacentCases=len(cases),longTransitions=512,identityMetadataBytes=0,failures=0))
print(json.dumps(dict(adjacentCases=len(cases),longTransitions=512,identityMetadataBytes=0,failures=0)))
