"""Independent Python ZIP/Git fixture producer for CARD-0037. No .NET/CLI dependency."""
import base64, copy, hashlib, io, json, pathlib, subprocess, tempfile, zipfile

HERE = pathlib.Path(__file__).resolve().parent
NS = 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8'
REVIEW_NS = 'e1234567-1234-4321-8123-123456789abc'
ANCHOR = 'cm0312-trail-source-v1'
DIGEST = 'cm0312-source-lf-v1'
SELECTOR = 'cm0312-quote-context-v1'
SOURCE = '# Guide\n\nIntro 😀 before e\u0301 target words.\n\n## Usage\n\nUse the tool.\n'
def canonical(value, manifest=False):
    if manifest:
        value = json.loads(json.dumps(value, ensure_ascii=False, sort_keys=True))
        value = {'mdpkg': value['mdpkg'], **{k: value[k] for k in sorted(value) if k != 'mdpkg'}}
    return (json.dumps(value, ensure_ascii=False, sort_keys=not manifest, separators=(',', ':')) + '\n').encode()
def sha(value): return hashlib.sha256(value).hexdigest()
def utf16(value): return len(value.encode('utf-16-le')) // 2
def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
LOC = ['section', 'guide.md', [['# Guide', 0]]]
ROOT = sha(f'mdpkg-default\0{ANCHOR}\0{NS}\0'.encode() + canonical(LOC))
EXPECT = sha(f'mdpkg\0{DIGEST}\0section\0'.encode() + SOURCE.encode())
quote = 'target words'; start = SOURCE.index(quote); end = start + len(quote)
select = {'start': utf16(SOURCE[:start]), 'end': utf16(SOURCE[:end]), 'quote': quote, 'occurrence': 0,
          'prefix': SOURCE[:start], 'suffix': SOURCE[end:][:30]}
def document(version):
    comments = [dict(id=uid(2), at='2026-09-09T12:00:00+01:00', author='Reviewer', body='Explain these words.'),
                dict(id=uid(3), at='2026-09-09T10:00:00Z', author='Responder', body='This reply keeps source order.', inReplyTo=uid(2))]
    if version == 2:
        comments[0]['kind'] = 'change-request'; comments[1]['kind'] = 'comment'
    return dict(version=version, anchor=ANCHOR, profile=DIGEST, selector=SELECTOR,
        threads=[dict(id=uid(1), root=ROOT, loc=base64.urlsafe_b64encode(canonical(LOC)).decode().rstrip('='),
                      expect=EXPECT, state='open', select=copy.deepcopy(select), comments=comments)])

def git(repo, *args, data=None):
    p = subprocess.run(['git', '-c', 'core.autocrlf=false', *args], cwd=repo, input=data, capture_output=True, check=True)
    return p.stdout
def package(repo, name, namespace, files, parent=None, review=None, coverage='complete'):
    rows=[]
    # Build nested trees without using a working-tree/index or relying on native path quoting.
    def tree(items):
        groups={}
        for path, data in items.items():
            first, _, rest = path.partition('/')
            groups.setdefault(first, {})[rest]=data
        rows=[]
        for first, group in sorted(groups.items()):
            if '' in group:
                oid=git(repo,'hash-object','-w','--stdin',data=group['']).strip().decode(); kind='blob';mode='100644'
            else: oid=tree(group);kind='tree';mode='040000'
            rows.append(f'{mode} {kind} {oid}\t{first}\0'.encode())
        return git(repo,'mktree','-z',data=b''.join(rows)).strip().decode()
    tid=tree(files)
    raw=(f'tree {tid}\n'+(f'parent {parent}\n' if parent else '')+'author Fixture <fixture@example.invalid> 946684800 +0000\ncommitter Fixture <fixture@example.invalid> 946684800 +0000\n\nReview fixture\n').encode()
    head=git(repo,'hash-object','-w','-t','commit','--stdin',data=raw).strip().decode()
    git(repo,'update-ref','refs/heads/main',head)
    git(repo,'fsck','--full','--strict')
    pack=git(repo,'pack-objects','--stdout','--revs','--delta-base-offset',data=(head+'\n').encode())
    stem='pack-'+pack[-20:].hex(); packpath=pathlib.Path(repo)/'objects/pack'/f'{stem}.pack';packpath.write_bytes(pack)
    git(repo,'index-pack','--strict',str(packpath))
    manifest=dict(mdpkg='markdown-package/1', namespace=namespace, current='sha1-'+head,
        addressing=dict(anchor=ANCHOR,digest=DIGEST,coverage=coverage,overrides='.mdpkg/address/overrides.json' if '.mdpkg/address/overrides.json' in files else None),
        history=dict(coverage='complete',transform=[],detail='.mdpkg/history.json'))
    if review: manifest['review']=review
    commits=git(repo,'rev-list','--first-parent','--reverse',head).decode().split()
    history=dict(walk='first-parent',root='original',sourceBase='sha1-'+commits[0],sourceTip='sha1-'+head,retainedCommits=len(commits),
        shallowBoundaries=[],transformations=[],ranges=[],patches=[],addressingCoverage=[dict(coverage=coverage,**{'from':'sha1-'+commits[0],'to':'sha1-'+head})])
    entries={'.mdpkg/manifest.json':canonical(manifest,True),**dict(sorted(files.items())),'.mdpkg/history.json':canonical(history),
        '.git/HEAD':b'ref: refs/heads/main\n','.git/config':b'[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
        '.git/refs/heads/main':(head+'\n').encode(),f'.git/objects/pack/{stem}.idx':packpath.with_suffix('.idx').read_bytes(),f'.git/objects/pack/{stem}.pack':pack}
    output=HERE/name
    with zipfile.ZipFile(output,'w') as z:
        for path,data in entries.items():
            info=zipfile.ZipInfo(path,(2000,1,1,0,0,0));info.external_attr=0o100644<<16;info.internal_attr=0
            info.compress_type=zipfile.ZIP_STORED if path=='.mdpkg/manifest.json' or path.startswith('.git/objects/pack/') else zipfile.ZIP_DEFLATED
            z.writestr(info,data)
    return head,output.read_bytes()

def main():
    for version in (1,2): (HERE/f'comments-v{version}.json').write_bytes(canonical(document(version)))
    empty=document(2);empty['threads']=[];(HERE/'comments-empty.json').write_bytes(canonical(empty))
    bad=document(2);bad['threads'][0]['comments'][0]['kind']='apply-patch';(HERE/'invalid-kind.json').write_bytes(canonical(bad))
    bad=document(2);bad['threads'][0]['comments'][0]['inReplyTo']=uid(3);(HERE/'invalid-cycle.json').write_bytes(canonical(bad))
    bad=document(2);bad['threads'][0]['select']['start']=-1;(HERE/'invalid-selector.json').write_bytes(canonical(bad))
    measurements={}
    with tempfile.TemporaryDirectory() as tmp:
        repo=pathlib.Path(tmp)/'repo.git';repo.mkdir();git(repo,'init','--bare','--initial-branch=main')
        original, data=package(repo,'original.mdpkg',NS,{'guide.md':SOURCE.encode()})
        of=dict(namespace=NS,current='sha1-'+original,packageDigest='sha256-'+sha(data),packageBytes=len(data),dispatch='opaque dispatch, never authority')
        delta_head = None
        for version in (1,2): delta_head,_ = package(repo,f'delta-v{version}.mdpkg',REVIEW_NS,{'.mdpkg/review/comments.json':canonical(document(version))},review=dict(shape='delta',detail='.mdpkg/review/comments.json',of=of))
        package(repo,'bundled-v2.mdpkg',NS,{'guide.md':SOURCE.encode(),'.mdpkg/review/comments.json':canonical(document(2))},parent=original,review=dict(shape='bundled',detail='.mdpkg/review/comments.json',of=of))
        changed=SOURCE.replace('Intro 😀', 'Some new text. Intro 😀')
        changed_head,_ = package(repo,'changed.mdpkg',NS,{'guide.md':changed.encode()},parent=original)
        movedloc=['section','moved.md',[['# Guide',0]]]
        # Every document/preamble/section root needs a confirmed move for a fully complete transition.
        entries={}
        for kind,trail in [('document',[]),('preamble',[]),('section',[['# Guide',0]]),('section',[['# Guide',0],['## Usage',0]])]:
            old=[kind,'guide.md',trail];root=sha(f'mdpkg-default\0{ANCHOR}\0{NS}\0'.encode()+canonical(old))
            entries[root]={'to':[kind,'moved.md',trail]}
        package(repo,'moved.mdpkg',NS,{'moved.md':SOURCE.encode(),'.mdpkg/address/overrides.json':canonical(dict(version=1,anchor=ANCHOR,entries=entries))},parent=original)
        bundle=dict(shape='bundled',detail='.mdpkg/review/comments.json',of=of)
        files={'guide.md':SOURCE.encode(),'.mdpkg/review/comments.json':canonical(document(2))}
        package(repo,'invalid-bundled-parent.mdpkg',NS,files,parent=changed_head,review=bundle)
        package(repo,'invalid-bundled-document.mdpkg',NS,{**files,'guide.md':changed.encode()},parent=original,review=bundle)
        package(repo,'invalid-bundled-ledger.mdpkg',NS,{**files,'.mdpkg/address/overrides.json':canonical(dict(version=1,anchor=ANCHOR,entries={'f'*64:{'dead':'deleted'}}))},parent=original,review=bundle)
        package(repo,'invalid-delta-history.mdpkg',REVIEW_NS,{'.mdpkg/review/comments.json':canonical(document(2))},parent=delta_head,review=dict(shape='delta',detail='.mdpkg/review/comments.json',of=of))
        measurements={'producer':'Python stdlib ZIP + native Git plumbing; no application writer','git':git(repo,'--version').decode().strip(),
            'root':ROOT,'expect':EXPECT,'locator':LOC,'source':SOURCE,'selector':select,'utf16SourceLength':utf16(SOURCE),
            'files':{p.name:dict(bytes=p.stat().st_size,sha256=sha(p.read_bytes())) for p in sorted(HERE.glob('*.mdpkg'))}}
    (HERE/'vectors.json').write_bytes(canonical(measurements))
    print(json.dumps(measurements['files'],indent=2))
if __name__=='__main__': main()
