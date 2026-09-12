"""Independent archive/native-Git checks for the active S1 documentation fixtures.
Not an application validator; invalid model/operation recipes remain S2+ test inputs.
"""
import hashlib, json, os, subprocess, tempfile, zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
checked=0
def require(ok,message):
    global checked
    checked+=1
    if not ok:raise ValueError(message)
def canonical(v):return (json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n').encode()
def digest(b):return 'sha256-'+hashlib.sha256(b).hexdigest()
def state(files,header):
    return digest(canonical(dict(profile='mdpkg-snapshot-v1',header=header,entries=[
        dict(bytes=len(b),digest=digest(b),mode='100644',path=n)
        for n,b in sorted(files.items(),key=lambda row:row[0].encode())])))
def git(repo,*args):
    env=dict(os.environ,GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='NUL' if os.name=='nt' else '/dev/null')
    r=subprocess.run(['git','-C',str(repo),*args],capture_output=True,env=env)
    require(r.returncode==0,'native Git: '+r.stderr.decode(errors='replace'))
    return r.stdout
def tree(repo,commit):
    files={}
    for row in git(repo,'ls-tree','-rz',commit).split(b'\0'):
        if not row:continue
        meta,path=row.split(b'\t',1);mode,kind,oid=meta.split()
        require(mode==b'100644' and kind==b'blob','regular-file modes')
        files[path.decode()]=git(repo,'cat-file','blob',oid.decode())
    return files
def check(file):
    with zipfile.ZipFile(file) as z:
        require(z.testzip() is None,'ZIP CRC')
        names=z.namelist();require(len(names)==len(set(names)),'duplicate ZIP names')
        require(names[0]=='.mdpkg/manifest.json','manifest first')
        require(file.read_bytes()[50:79]==b'{"mdpkg":"markdown-package/1"','typing bytes')
        entries={n:z.read(n) for n in names};m=json.loads(entries['.mdpkg/manifest.json'])
        require(set(m)=={'mdpkg','addressing','namespace','current','history'}|({'review'} if 'review' in m else set()),'manifest field set')
        require(isinstance(m['current'],dict) and set(m['current'])=={'id','kind'},'typed current')
        kind=m['current']['kind'];require(kind in ('snapshot','commit'),'current kind')
        files={n:b for n,b in entries.items() if not n.startswith('.git/') and n!='.mdpkg/manifest.json' and not n.startswith('.mdpkg/history')}
        for n,b in files.items():
            b.decode('utf-8',errors='strict');require(b'\r' not in b,'LF content')
        require((m['addressing']['overrides'] is not None)==('.mdpkg/address/overrides.json' in files),'ledger declaration')
        require(('review' in m)==('.mdpkg/review/comments.json' in files),'review declaration')
        review=m.get('review')
        header=dict(addressing=m['addressing'],namespace=m['namespace'],review=None if review is None else dict(
            detail=review['detail'],shape=review['shape'],of={k:review['of'][k] for k in ('current','namespace')}))
        if kind=='snapshot':
            require(m['history']==dict(mode='none'),'snapshot history fields')
            require(not any(n.startswith(('.git/','.mdpkg/history')) for n in names),'snapshot inventory')
            require(m['addressing']['coverage']=='complete','snapshot coverage')
            require(state(files,header)==m['current']['id'],'snapshot hash')
            if m['addressing']['overrides']:
                ledger=json.loads(files[m['addressing']['overrides']]);require(all('unknown' not in e for e in ledger['entries'].values()),'snapshot correspondence')
            if review: require(review['shape']=='delta','snapshot bundled forbidden')
        else:
            require(m['history']['mode']=='git','Git mode')
            require(set(m['history'])=={'mode','coverage','detail','transform'},'Git history field set')
            require(names[-1].endswith('.pack'),'pack last')
            h=json.loads(entries[m['history']['detail']]);origin=h.get('origin')
            require((h['root']=='materialized')==(origin is not None),'root/origin relation')
            with tempfile.TemporaryDirectory(prefix='mdpkg-s1-check-') as tmp:
                repo=Path(tmp);z.extractall(repo)
                git(repo,'fsck','--full','--strict');git(repo,'read-tree','HEAD')
                head=git(repo,'rev-parse','HEAD').decode().strip()
                require(m['current']['id']=='sha1-'+head,'current ref')
                require(tree(repo,head)==files,'current tree/view equality')
                if origin:
                    require(set(origin)=={'profile','snapshot','commit','header'},'origin field set')
                    require(origin['profile']=='mdpkg-bootstrap-v1','origin profile')
                    require(origin['header']['namespace']==m['namespace'],'origin namespace')
                    commits=git(repo,'rev-list','--first-parent','--reverse','HEAD').decode().split()
                    c0=origin['commit'][5:];require(commits[0]==c0,'oldest origin root')
                    raw=git(repo,'cat-file','commit',c0);tid=raw.split(b'\n',1)[0].decode()[5:]
                    require(state(tree(repo,c0),origin['header'])==origin['snapshot'],'origin state hash')
                    expected=(f'tree {tid}\nauthor mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\ncommitter mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n\nmdpkg-bootstrap-v1\nnamespace {m["namespace"]}\nsnapshot {origin["snapshot"]}\n').encode()
                    require(raw==expected,'exact bootstrap payload')
                if review and review['shape']=='bundled':
                    target=review['of']['current']
                    require(m['namespace']==review['of']['namespace'],'bundled namespace')
                    parent=target['id'] if target['kind']=='commit' else origin['commit']
                    if target['kind']=='snapshot':require(origin['snapshot']==target['id'],'bundled origin target')
                    parents=git(repo,'rev-list','--parents','-n','1',head).decode().split()[1:]
                    require(parents==[parent[5:]],'bundled parent')
                    changed=git(repo,'diff-tree','--no-commit-id','--name-only','-r',parent[5:],head).decode().splitlines()
                    require(all(p.startswith('.mdpkg/review/') for p in changed),'bundled changed paths')
        if review and review['shape']=='delta':
            require(m['namespace']!=review['of']['namespace'],'delta namespace')
            require(set(files)=={'.mdpkg/review/comments.json'} and m['addressing']['overrides'] is None,'delta view')

if __name__=='__main__':
    good=bad=0
    for file in sorted((HERE/'review-fixtures').glob('*.mdpkg')):
        expected_bad=file.name.startswith('invalid-')
        try:check(file)
        except ValueError as ex:
            if not expected_bad:raise
            bad+=1;print(file.name+': expected rejection: '+str(ex))
        else:
            require(not expected_bad,'negative fixture unexpectedly accepted: '+file.name);good+=1
    print(f'{good} accepted fixtures; {bad} expected rejections; {checked} checks; 0 unexpected failures')
