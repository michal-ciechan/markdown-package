"""Audit sparse follow-up evidence, including real packed snapshot equality."""
import importlib.util
import io
import json
from pathlib import Path
import zipfile
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
load=lambda p:json.loads(p.read_text(encoding='utf-8'))
WORK=h.ROOT/'.antiphon/addressing-work'
sizes=load(HERE/'sparse-size-results.json');cases=load(HERE/'sparse-case-results.json')
detect=load(HERE/'sparse-detection-results.json');corpus=load(HERE/'sparse-corpus-results.json')
sources=load(HERE/'sparse-source-results.json');plan=load(WORK/'sparse-storage-plan.json')
assert all(x['failures']==0 for x in (sizes,cases,detect,corpus,sources))
assert len(cases['rows'])==cases['counts']['comparisons']==189
assert all(r['expected']==r['confirmed'] for r in cases['rows'])
assert sum(r['wrongNaiveIdentity'] for r in cases['rows'])==cases['counts']['naiveWrongIdentity']==3
assert sum(r['naive']=='not-found' for r in cases['rows'])==cases['counts']['naiveNotFound']==22
assert len(cases['extraChecks'])==13 and len(set(cases['extraChecks']))==13
assert detect['diff_runs']==4*detect['cases']==88
assert len(detect['rows'])==detect['strategy_evaluations']==132
for total in detect['totals']:
    rows=[r for r in detect['rows'] if all(r[k]==total[k] for k in ('mode','threshold'))]
    for key in ('truth','proposals','true_positive','false_positive','false_negative'):assert total[key]==sum(r[key] for r in rows)
    assert total['truth']==total['true_positive']+total['false_negative']
    assert total['proposals']==total['true_positive']+total['false_positive']
zip_members=0;tree_checks=0;history_checks=0
for r in sizes['rows']:
    p=next(p for p in plan['plans'] if all(p[k]==r[k] for k in ('corpus','scenario','rate')))
    file=h.ROOT/r['file'];payload=file.read_bytes()
    assert len(payload)==r['bytes'] and h.compression.sha(payload)==r['sha256']
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        assert z.testzip() is None
        assert z.infolist()[0].filename=='.mdpkg/manifest.json' and z.infolist()[0].compress_type==0
        manifest=json.loads(z.read('.mdpkg/manifest.json'));assert manifest['currentCommit']==r['commit']
        for entry in z.infolist():
            if entry.filename.startswith('.git/'):assert z.read(entry)==(file.parent/'repo.git'/entry.filename[5:]).read_bytes()
            zip_members+=1
    actual={}
    for e in h.git(file.parent/'repo.git','ls-tree','-rz',r['commit']).split(b'\0'):
        if e:
            meta,name=e.split(b'\t',1);actual[name.decode()]=meta.decode().split()[2]
    expected=dict(p['snapshots'][-1]['documents'],**p['snapshots'][-1]['metadata'][r['mode']])
    assert actual==expected;tree_checks+=1
    count=int(h.git(file.parent/'repo.git','rev-list','--count',r['commit']))
    assert count==({'full32':33,'squash32':2}.get(r['history'],1));history_checks+=1
    baseline=next(b['bytes'] for b in sizes['rows'] if all(b[k]==r[k] for k in ('corpus','scenario','rate','history')) and b['mode']=='none')
    assert r['metadata_increment']==r['bytes']-baseline
    assert abs(r['over_baseline_pct']-(r['bytes']/baseline-1)*100)<1e-9
    final=p['snapshots'][-1]['metadata'][r['mode']]
    items=[(path,plan['objects'][oid].encode()) for path,oid in sorted(final.items())]
    assert sum(len(b) for _,b in items)==r['metadata_raw_bytes']
    assert (len(h.archive(items)) if items else 0)==r['metadata_zip_bytes']
assert tree_checks==sizes['packed_repositories']==72
assert sources['checks']==780 and sources['first_parent_transitions']==64 and sources['base_blob_checks']==716
result=dict(original_model_checks=55,confirmed_sparse_comparisons=189,sparse_extra_checks=13,
    native_git_diff_runs=88,strategy_evaluations=132,injected_resolution_checks=corpus['injectedResolutionChecks'],
    pinned_source_checks=sources['checks'],archive_hash_audits=tree_checks,zip_member_audits=zip_members,
    packed_tree_equalities=tree_checks,commit_count_checks=history_checks,prior_size_equalities=sizes['prior_exact_size_equalities'],
    detected_regressions=dict(naive_wrong_identity=3,naive_not_found=22,hybrid50=next(r for r in detect['totals'] if r['mode']=='hybrid' and r['threshold']==50)),
    failures=0)
h.compression.save(HERE/'sparse-verification.json',result)
print(json.dumps(result,indent=2))
