"""Draft-2 documentation vectors; not an application writer or validator.

Python computes state preimages and Git object IDs. Native Git independently
checks tree/commit bytes. verify-deferred-history.mjs supplies another hash oracle.
"""
import copy, hashlib, importlib.util, json, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VECTORS = HERE.parent / 'investigations/deferred-history/breaking-revision-vectors.json'
spec = importlib.util.spec_from_file_location('worked', HERE / 'worked-example.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)

def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode()

def digest(data): return 'sha256-'+hashlib.sha256(data).hexdigest()
def state(namespace, files, addressing=None, review=None):
    addressing = addressing or dict(anchor=w.ANCHOR, digest=w.DIGEST, coverage='complete', overrides=None)
    semantic_review = None if review is None else dict(detail=review['detail'], shape=review['shape'],
        of={k:copy.deepcopy(review['of'][k]) for k in ('current','namespace')})
    header=dict(addressing=copy.deepcopy(addressing), namespace=namespace, review=semantic_review)
    entries=[dict(bytes=len(data),digest=digest(data),mode='100644',path=path)
        for path,data in sorted(files.items(),key=lambda row:row[0].encode('utf-8'))]
    preimage=dict(entries=entries,header=header,profile='mdpkg-snapshot-v1')
    current=dict(id=digest(canonical(preimage)),kind='snapshot')
    manifest=dict(mdpkg=w.MAGIC,addressing=addressing,current=current,history=dict(mode='none'),namespace=namespace)
    if review is not None: manifest['review']=copy.deepcopy(review)
    return manifest,preimage

def snapshot(namespace,files,addressing=None,review=None):
    manifest,preimage=state(namespace,files,addressing,review)
    data=w.assemble([(w.MANIFEST,w.manifest_bytes(manifest)),*sorted(files.items(),key=lambda row:row[0].encode())])
    return manifest,preimage,data

def bootstrap(repo,namespace,files,header,snapshot_id):
    tid=w.tree(repo,{path:w.blob(repo,data) for path,data in files.items()})
    raw=(f'tree {tid}\nauthor mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n'
         'committer mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n\n'
         f'mdpkg-bootstrap-v1\nnamespace {namespace}\nsnapshot {snapshot_id}\n').encode()
    head=w.git(repo,'hash-object','-w','-t','commit','--stdin',data=raw).decode().strip()
    assert head==hashlib.sha1(b'commit '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    assert w.git(repo,'cat-file','commit',head)==raw
    origin=dict(profile='mdpkg-bootstrap-v1',snapshot=snapshot_id,commit='sha1-'+head,header=copy.deepcopy(header))
    return tid,head,raw,origin

def history(head,origin=None,parent_root=None,count=1,coverage='complete'):
    first=origin['commit'] if origin else 'sha1-'+(parent_root or head)
    result=dict(walk='first-parent',root='materialized' if origin else 'original',sourceBase=first,sourceTip='sha1-'+head,
        retainedCommits=count,shallowBoundaries=[],transformations=[],ranges=[],patches=[],
        addressingCoverage=[dict(coverage=coverage,**{'from':first,'to':'sha1-'+head})])
    if origin: result['origin']=copy.deepcopy(origin)
    return result

def committed(repo,manifest,files,head,descriptor,destination):
    m=copy.deepcopy(manifest);m['current']=dict(id='sha1-'+head,kind='commit')
    m['history']=dict(mode='git',coverage='complete',detail='.mdpkg/history.json',transform=[])
    items=[(w.MANIFEST,w.manifest_bytes(m)),*sorted(files.items(),key=lambda row:row[0].encode()),
        ('.mdpkg/history.json',canonical(descriptor)),*w.curated_repo(repo,head,destination)]
    return m,w.assemble(items)

def main():
    prior=json.loads(VECTORS.read_text(encoding='utf-8'))
    inputs=[(v['name'],v['namespace'],{p:s.encode() for p,s in v['sources'].items()},v['preimage']['header']['addressing'],v['preimage']['header']['review']) for v in prior['vectors'][:3]]
    ledger=canonical(dict(anchor=w.ANCHOR,version=1,entries={
        'a'*64:dict(to=['section','guide.md',[['# Guide',0]]]),
        'b'*64:dict(dead='deleted'),
        'c'*64:dict(to=['section','replacement.md',[['# Replacement',0]]]),
    }))
    # The retired root reserves the replacement's default slot; use that actual slot.
    ledger_obj=json.loads(ledger); reserved=w.default_root(['section','replacement.md',[['# Replacement',0]]])
    ledger_obj['entries'][reserved]=ledger_obj['entries'].pop('b'*64)
    inputs.append(('ledger',w.NAMESPACE,{'guide.md':b'# Guide\n','replacement.md':b'# Replacement\n',w.LEDGER:canonical(ledger_obj)},dict(anchor=w.ANCHOR,digest=w.DIGEST,coverage='complete',overrides=w.LEDGER),None))
    vectors=[]; packages={}; transitions=[]; cases=[]
    with tempfile.TemporaryDirectory(prefix='mdpkg-s1-vectors-') as tmp:
        repo=Path(tmp)/'source.git';repo.mkdir();w.git(repo,'init','--bare','--template=','--initial-branch=main')
        for name,namespace,files,addressing,review in inputs:
            manifest,preimage,data=snapshot(namespace,files,addressing,review)
            tid,head,raw,origin=bootstrap(repo,namespace,files,preimage['header'],manifest['current']['id'])
            descriptor=history(head,origin)
            materialized,git_data=committed(repo,manifest,files,head,descriptor,Path(tmp)/(name+'.git'))
            vector=dict(name=name,namespace=namespace,sources={p:b.decode() for p,b in files.items()},preimage=preimage,
                preimageCanonical=canonical(preimage).decode(),snapshotId=manifest['current']['id'],treeId='sha1-'+tid,
                bootstrapCommitBytes=raw.decode(),bootstrapCommitId='sha1-'+head,origin=origin,
                snapshotManifestCanonical=w.manifest_bytes(manifest).decode(),materializedManifestCanonical=w.manifest_bytes(materialized).decode(),
                materializedHistoryCanonical=canonical(descriptor).decode())
            if name!='ledger':
                old=next(v for v in prior['vectors'] if v['name']==name)
                for key in ('snapshotId','treeId','bootstrapCommitId','preimageCanonical'): assert vector[key]==old[key],(name,key)
            vectors.append(vector)
            for label,content in [('snapshot',data),('materialized',git_data)]:
                file=HERE/'review-fixtures'/f'{name}-{label}.mdpkg';file.write_bytes(content)
                packages[file.name]=dict(bytes=len(content),sha256=hashlib.sha256(content).hexdigest())
            if name=='guide':
                changed={**files,'guide.md':b'# Guide\n\nPublished change.\n'}
                child_tree=w.tree(repo,{path:w.blob(repo,b) for path,b in changed.items()})
                child=w.commit(repo,child_tree,head,'Publish changed guide',1700000400)
                h=history(child,origin,count=2)
                cm,child_data=committed(repo,manifest,changed,child,h,Path(tmp)/'changed.git')
                (HERE/'review-fixtures/guide-changed-child.mdpkg').write_bytes(child_data)
                transitions.append(dict(name='guide-changed-child',sources={p:b.decode() for p,b in changed.items()},
                    manifest=cm,history=h,commitBytes=w.git(repo,'cat-file','commit',child).decode(),treeId='sha1-'+child_tree,
                    expected=dict(parent=origin['commit'],originSnapshot=origin['snapshot'],originalSources=vector['sources'])))
        guide=vectors[0]; base=json.loads(guide['snapshotManifestCanonical']); origin=guide['origin']
        def invalid(name,target,value,reason): cases.append(dict(name=name,target=target,value=value,expected='reject',reason=reason))
        def mutate(name,change,reason):
            m=copy.deepcopy(base);change(m);invalid(name,'manifest',m,reason)
        mutate('string-current',lambda m:m.update(current=origin['commit']),'current must be typed')
        mutate('null-current',lambda m:m.update(current=None),'current cannot be null')
        mutate('unknown-kind',lambda m:m['current'].update(kind='other'),'unknown discriminator')
        mutate('missing-kind',lambda m:m['current'].pop('kind'),'required kind')
        mutate('snapshot-git-mode',lambda m:m['history'].update(mode='git'),'mode mismatch')
        mutate('commit-none-mode',lambda m:m.update(current=dict(kind='commit',id=origin['commit'])),'mode mismatch')
        mutate('snapshot-history-detail',lambda m:m['history'].update(detail=None),'forbidden field, even null')
        mutate('partial-snapshot',lambda m:m['addressing'].update(coverage='partial'),'snapshot must have complete addressing')
        mutate('wrong-state-id',lambda m:m['current'].update(id=origin['commit']),'state ID algorithm/length')
        mutate('extra-current-key',lambda m:m['current'].update(extra=True),'exact current field set')
        for field,value in [('anchor','unknown'),('digest','unknown'),('coverage',None),('overrides','.mdpkg/address/other.json')]:
            mutate('invalid-addressing-'+field,lambda m,f=field,v=value:m['addressing'].update({f:v}),'fixed addressing contract')
        mutate('extra-manifest-key',lambda m:m.update(extra=None),'exact manifest field set')
        mutate('null-state-id',lambda m:m['current'].update(id=None),'nonnull state ID')
        mutate('uppercase-state-id',lambda m:m['current'].update(id=m['current']['id'].upper()),'lowercase qualified state ID')
        review_base=json.loads(vectors[2]['snapshotManifestCanonical'])
        for field,value in [('shape','bundled'),('detail','.mdpkg/review/other.json'),('of',None)]:
            m=copy.deepcopy(review_base);m['review'][field]=value
            invalid('invalid-review-'+field,'manifest',m,'fixed review contract or mode')
        m=copy.deepcopy(review_base);m['namespace']=m['review']['of']['namespace']
        invalid('delta-same-namespace','manifest',m,'independent delta namespace')
        m=copy.deepcopy(review_base);m['review']['of']['current']=origin['snapshot']
        invalid('string-reviewed-current','manifest',m,'typed reviewed state')
        m=copy.deepcopy(review_base);m['review']['of']['extra']=None
        invalid('extra-reviewed-key','manifest',m,'exact reviewed field set')
        for label,change,reason in [
            ('wrong-origin-snapshot',lambda o:o.update(snapshot='sha256-'+'0'*64),'reconstructed H0 mismatch'),
            ('wrong-origin-commit',lambda o:o.update(commit='sha1-'+'0'*40),'missing C0'),
            ('wrong-origin-namespace',lambda o:o['header'].update(namespace=inputs[1][1]),'namespace mismatch'),
            ('wrong-origin-profile',lambda o:o.update(profile='other'),'unknown bootstrap profile'),
            ('extra-origin-field',lambda o:o.update(extra=None),'exact origin field set'),
        ]:
            o=copy.deepcopy(origin);change(o);invalid(label,'origin',o,reason)
        for name,entries,reason in [
            ('snapshot-git-entry',{'.git/HEAD':'ref: refs/heads/main\n'},'Git forbidden'),
            ('snapshot-git-directory',{'.git/': ''},'Git directory forbidden'),
            ('snapshot-history-entry',{'.mdpkg/history.json':'{}\n'},'history forbidden'),
            ('undeclared-review',{'.mdpkg/review/comments.json':'{}\n'},'undeclared review'),
            ('undeclared-ledger',{w.LEDGER:ledger.decode()},'undeclared ledger'),
            ('extra-control',{'.mdpkg/other.json':'{}\n'},'unknown control'),
            ('nonempty-directory',{'folder/':'content'},'directory data'),
            ('file-directory-conflict',{'guide.md/':''},'file/directory conflict'),
        ]: invalid(name,'additionalEntries',entries,reason)
        for name,reason in [('missing-git-pack','commit mode requires repository'),('missing-history','commit mode requires descriptor'),
            ('missing-declared-ledger','declaration/inventory mismatch'),('missing-declared-review','declaration/inventory mismatch'),
            ('snapshot-unknown-ledger','unknown correspondence requires Git'),('materialized-without-origin','origin required'),
            ('original-with-origin','origin forbidden'),('bootstrap-marker-without-origin','reserved marker requires verified origin'),
            ('origin-nonroot','C0 must be oldest parentless retained root'),('origin-wrong-payload','exact bootstrap metadata required')]:
            invalid(name,'obligation',dict(base='guide',violation=name),reason)
        # Turn obligation names into executable edit recipes over an explicit base.
        edits={
            'missing-git-pack':('guide-materialized.mdpkg',dict(removeSuffix='.pack')),
            'missing-history':('guide-materialized.mdpkg',dict(removeEntry='.mdpkg/history.json')),
            'missing-declared-ledger':('ledger-snapshot.mdpkg',dict(removeEntry=w.LEDGER)),
            'missing-declared-review':('delta-review-snapshot.mdpkg',dict(removeEntry='.mdpkg/review/comments.json')),
            'snapshot-unknown-ledger':('ledger-snapshot.mdpkg',dict(jsonEntry=w.LEDGER,path=['entries','b'*64],value=dict(unknown='unconfirmed-removal'),rehashSnapshot=True)),
            'materialized-without-origin':('guide-materialized.mdpkg',dict(jsonEntry='.mdpkg/history.json',removeKey='origin')),
            'original-with-origin':('guide-materialized.mdpkg',dict(jsonEntry='.mdpkg/history.json',path=['root'],value='original')),
            'bootstrap-marker-without-origin':('guide-materialized.mdpkg',dict(jsonEntry='.mdpkg/history.json',removeKey='origin',setRoot='original')),
            'origin-nonroot':('guide-changed-child.mdpkg',dict(jsonEntry='.mdpkg/history.json',path=['origin','commit'],value=transitions[0]['manifest']['current']['id'])),
            'origin-wrong-payload':('guide-materialized.mdpkg',dict(rebuildCommit=True,replaceText=['946684800','946684801'],repairObjectBindings=True)),
        }
        for case in cases:
            if case['name'] in edits:
                fixture,edit=edits[case['name']];case['target']='archive-edit';case['value']=dict(fixture=fixture,edit=edit)
            else:case['base']='guide-snapshot.mdpkg' if case['target']!='origin' else 'guide-materialized.mdpkg'
        operations=[
            ('initial-publication','snapshot','allowed'),('identical-resend','snapshot','same-identity'),
            ('private-edit','snapshot','rehash'),('changed-published-successor','git','materialize-exact-S0-then-append'),
            ('missing-S0','update','reject-without-output'),('committed-successor','git','append'),
            ('snapshot-current-reference','resolve','current-view'),('snapshot-at-reference','resolve','invalidated / history-unavailable'),
            ('snapshot-touched','resolve','unknown'),('different-snapshot-observedAt','resolve','unconfirmed / history-unavailable'),
            ('git-unverified-origin','resolve','unconfirmed / origin-unverified'),('git-missing-origin','resolve','unconfirmed / origin-unavailable'),
            ('partial-without-observedAt','resolve','unconfirmed / incomplete-correspondence'),
            ('verified-origin','resolve','C0-checkpoint; typed identities remain distinct'),('exact-at','resolve','never redirect'),
            ('newer-review-target','review','explicit selection required'),('delta-external-source-absent','verify','artifact-full; selectors unverified'),
            ('changed-delta-export','export','fresh namespace; retain thread IDs'),('unchanged-delta-retry','export','reuse namespace and bytes'),
            ('remove-C0','transform','remove origin; synthetic/truncated or fresh namespace'),
            ('retained-C0-repack','transform','retain origin'),('unchanged-tree-semantic-edit','update','new C1; freeze origin.header'),
            ('snapshot-full','verify','all files/hash; Git not applicable'),('required-check-skipped','verify','not Full'),
            ('explicit-import','pack --from-git --history none','option error'),
            ('scope-snapshot','pack --history none --scope guide.md','option error'),
            ('depth-snapshot','pack --history none --depth 1','option error'),
            ('reverse-snapshot','pack --history none --reverse-index','option error'),
            ('metadata-snapshot','pack --history none --message text','option error'),
            ('partial-correspondence','pack --history none','obligation-unmet; no output'),
            ('materialize-Git','update --materialize','identity-preserving re-emission'),
            ('materialize-with-tree','update --materialize --tree tree','option error'),
            ('unsupported-append-transform','update --tree tree','capability failure; no output'),
            ('source-ledger-conflict','update --tree tree','reject conflicting ledger edit'),
            ('snapshot-native-export','export','materialize first'),
            ('cancel-before-publication','update','preserve destination'),
        ]
        # Mutations specify concrete input edits, expected state relation and reason.
        hash_cases=[]
        for name,target,value,equal in [('content','sources/guide.md','# Guide\n ',False),('path','rename/guide.md','guide2.md',False),
            ('namespace','header/namespace',inputs[1][1],False),('evidence','review.of/dispatch','second send',True),
            ('zip-order','transport/order','reverse',True),('compression','transport/level',9,True),
            ('empty-directory','transport/entry','empty/',True),('stored-CRLF','sources/guide.md','# Guide\r\n',False)]:
            hash_cases.append(dict(name=name,base='guide',target=target,value=value,expected='reject-before-hashing' if name=='stored-CRLF' else 'same' if equal else 'different'))
        hash_cases[3]['base']='delta-review'
        for name,base,target,value in [('ledger-bytes','ledger','sources/'+w.LEDGER,'replace retired reason deleted with split and successors'),
            ('comment-bytes','delta-review','sources/.mdpkg/review/comments.json','add bounded non-semantic extension'),
            ('review-target','delta-review','header/review/of/current',dict(kind='commit',id=origin['commit'])),
            ('review-shape','delta-review','header/review/shape','bundled'),
            ('review-detail','delta-review','header/review/detail','.mdpkg/review/other.json'),
            ('BOM','guide','sources/guide.md','\ufeff# Guide\n'),('empty-file','guide','sources/empty.txt','')]:
            hash_cases.append(dict(name=name,base=base,target=target,value=value,expected='reject-before-hashing' if name in ('review-shape','review-detail') else 'different'))
        for case in hash_cases:
            v=next(v for v in vectors if v['name']==case['base'])
            files={n:b.encode() for n,b in v['sources'].items()};header=copy.deepcopy(v['preimage']['header'])
            if case['name']=='ledger-bytes':
                doc=json.loads(files[w.LEDGER]);key=next(k for k,e in doc['entries'].items() if 'dead' in e)
                doc['entries'][key]=dict(dead='split',next=['a'*64,'c'*64]);case['value']=canonical(doc).decode()
            if case['name']=='comment-bytes':
                doc=json.loads(files['.mdpkg/review/comments.json']);doc['fixtureNote']='extension bytes bear identity'
                case['value']=canonical(doc).decode()
            if case['expected']=='reject-before-hashing':continue
            target=case['target']
            if target.startswith('sources/'):files[target[8:]]=case['value'].encode()
            elif target.startswith('rename/'):files[case['value']]=files.pop(target[7:])
            elif target.startswith('header/'):
                keys=target[7:].split('/');obj=header
                for k in keys[:-1]:obj=obj[k]
                obj[keys[-1]]=case['value']
            _,preimage=state(header['namespace'],files,header['addressing'],header['review'])
            case['expectedId']=digest(canonical(preimage))
            assert (case['expectedId']==v['snapshotId'])==(case['expected']=='same'),case['name']
        result=dict(purpose='S1 shared draft-2 conformance data; product implementation pending. Historical source measurements remain unchanged.',
            sourceRevision=prior['sourceRevision'],vectors=vectors,transitions=transitions,invalidCases=cases,
            operations=[dict(name=n,operation=o,expected=e) for n,o,e in operations],hashCases=hash_cases,packages=packages)
        VECTORS.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(f'{len(vectors)} state/bootstrap vectors; {len(transitions)} changed-child vector; {len(cases)} invalid cases; {len(operations)} operation cases; {len(hash_cases)} identity mutations')

if __name__=='__main__':main()
