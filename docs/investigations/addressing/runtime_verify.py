"""Audit the refinement's zero-metadata range and timing evidence."""
import importlib.util
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_probe',HERE.parent/'history/benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
load=lambda name:json.loads((HERE/name).read_text(encoding='utf-8'))
c=load('runtime-case-results.json');t=load('runtime-timing-results.json');f=load('runtime-fixture-results.json')
assert c['failures']==t['failures']==f['failures']==0
assert len(c['rows'])==384 and len(c['rangeRows'])==20 and c['checks']==len(c['checkNames'])==34
for total in c['totals']:
    rows=[r for r in c['rows'] if r['threshold']==total['threshold']]
    assert len(rows)==total['queries']==192
    assert sum(r['wrongIdentity'] for r in rows)==total['wrongIdentity']==4
    assert sum(r['missedContinuity'] for r in rows)==total['missedContinuity']
assert len(t['rows'])==t['samples']==36 and t['checks']==72
for r in t['rows']:
    assert r['cold']['status']==r['warm']['status']
    if r['method']=='walk':assert r['cold']['status']=='source-changed'
    if r['method']=='bounded64' and r['transitions']>64:
        assert r['cold']['reason']=='history-budget-exceeded' and r['cold']['processed']==64
    if r['method']=='walk':assert r['warm']['cost']['gitCalls']==0
chain_checks=0;metadata_checks=0;missing_checks=0
for name,chain in f['chains'].items():
    repo=h.ROOT/chain['repo'];tip=chain['commits'][-1]
    entries=h.git(repo,'ls-tree','-r','--name-only',tip).decode().splitlines()
    assert not any(p.startswith('.mdpkg/') for p in entries);metadata_checks+=1
    assert int(h.git(repo,'rev-list','--count',tip))==len(chain['commits']);chain_checks+=1
    if 'omitted_review_commit' in chain:
        assert h.git(repo,'cat-file','-e',chain['omitted_review_commit'],check=False).returncode!=0;missing_checks+=1
assert f['chains']['net-squash']['indistinguishable_delete_recreate']
assert f['chains']['net-squash']['commits'][-1]==f['chains']['never-deleted']['commits'][1]
result=dict(adjacent_runtime_queries=384,arbitrary_range_queries=20,range_semantic_assertions=34,
    timed_samples=36,timed_status_checks=72,repository_history_checks=chain_checks,zero_metadata_tree_checks=metadata_checks,
    missing_review_object_checks=missing_checks,identity_metadata_bytes=0,failures=0)
h.compression.save(HERE/'runtime-verification.json',result)
print(json.dumps(result,indent=2))
