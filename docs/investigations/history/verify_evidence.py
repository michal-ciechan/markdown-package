"""Audit saved evidence and generated artifacts; fail on missing coverage or drift."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import zipfile

HERE=Path(__file__).resolve().parent
WORK=HERE.parents[2]/'.antiphon/history-work'


def read(name):return json.loads((HERE/name).read_text())


def main():
    sizes=read('size-results.json');checks=collections.Counter(sizes['checks'])
    assert checks['corpus_entry_continuity']==799
    assert checks['first_parent_continuity']==64
    scenarios={'base','5','5-squash','20','20-squash','32','32-squash'}
    for c in sizes['corpora']:
        assert {r['scenario'] for r in c['rows']}==scenarios
        base=c['rows'][0]
        for row in c['rows']:
            for model,stats in row['variants'].items():
                file=WORK/c['corpus']/row['scenario']/(model+'.zip')
                raw=file.read_bytes()
                assert len(raw)==stats['bytes'] and hashlib.sha256(raw).hexdigest()==stats['sha256']
                assert abs(stats['over_base_pct']-(len(raw)/base['variants'][model]['bytes']-1)*100)<1e-8
                with zipfile.ZipFile(file) as z:
                    assert z.testzip() is None
                    manifest=json.loads(z.read('.mdpkg/manifest.json'))
                    assert manifest['squashed']==row['squashed'] and manifest['sourceCommits']==row['n']
                    assert manifest['ancestry']=='truncated'
                checks['archive_hash_and_metadata_audits']+=1
    assets=read('browser-assets.json')
    assert assets['isomorphic_git']=='1.41.9'
    for a in assets['assets']:
        if a['name'].startswith('git-'):
            raw=(WORK/(a['name']+'.js')).read_bytes()
            assert len(raw)==a['bytes'] and hashlib.sha256(raw).hexdigest()==a['sha256']
            checks['browser_asset_hashes']+=1
    pack=read('pack-access-results.json')
    assert len(pack)==4
    checks['pack_object_hashes']=sum(r['object_hash_checks'] for r in pack)
    checks['pack_document_hashes']=sum(r['document_hash_checks'] for r in pack)
    for r in pack:assert r['selected_pack_bytes']<r['whole_pack_bytes']
    coverage=collections.Counter();browsers=[]
    for path in sorted(HERE.glob('*-results.json')):
        if path.stem.split('-')[0] not in ('chrome','firefox','edge'):continue
        rows=json.loads(path.read_text());browsers.append(path.stem)
        for row in rows:
            r=row['result'];cfg=row['config']
            f=next(c['fixtures'][0] for c in sizes['corpora'] if c['corpus']==cfg['corpus'])
            assert cfg['fixture_head']==f['head']
            assert 'error' not in r
            assert r['hashChecks']==r['sectionChecks']==33
            assert len(r['warmSamplesMs'])==7
            checks['browser_document_hashes']+=r['hashChecks']
            checks['browser_section_hashes']+=r['sectionChecks']
            checks['browser_profiles']+=1
            coverage[row['browser'],f['corpus'],cfg['mode'],cfg['target']]+=1
            assert r['firstReads']['unique_bytes']>0
            if cfg['mode']=='bundle':assert r['indexedObjects']>0 and r['prepareMs']>0
    complete=[]
    for browser in ('chrome','firefox','edge'):
        if all(coverage[browser,c,m,t]>=3 for c in ('npm','rust') for m in ('directory','bundle') for t in (0,1)):
            complete.append(browser)
    assert complete,'No complete three-profile browser suite'
    sem=read('semantics-results.json')
    assert sem['shallow']['raw_parent_preserved'] and sem['shallow']['log_treats_boundary_as_root']
    assert sem['shallow']['fetch_exit']!=0
    assert sem['incremental_bundle']['empty_verify_exit']!=0
    assert sem['synthetic_root']['is_shallow'] is False
    assert sem['squash']['parent_count']==1 and sem['squash']['ordinary_commit_same_oid']
    assert sem['sections']['touched_across_range']==['a','b'] and sem['sections']['net_changed']==['b']
    checks['semantic_cases']=5
    checks['expected_negative_git_operations']=2
    imports=read('native-import-results.json')
    assert len(imports)==2 and all(r['checked_imports']==3 for r in imports)
    checks['timed_native_bundle_imports']=sum(r['checked_imports'] for r in imports)
    failure_rows=sum(len(json.loads(p.read_text())) for p in HERE.glob('*-launch-failures.json'))
    result=dict(checks=dict(checks),complete_browser_suites=complete,
                browser_scenario_coverage=[dict(browser=b,corpus=c,mode=m,target=t,profiles=n) for (b,c,m,t),n in sorted(coverage.items())],
                recorded_browser_launch_failures=failure_rows,unexpected_validation_failures=0)
    (HERE/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
