"""Check S1 recipe data and isolation; does not implement operation semantics."""
import copy, importlib.util, json, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fixture_checks', HERE / 'verify-fixtures.py')
checks = importlib.util.module_from_spec(spec); spec.loader.exec_module(checks)
data = json.loads((HERE.parent / 'investigations/deferred-history/breaking-revision-vectors.json').read_text(encoding='utf-8'))
count = 0


def require(ok):
    global count
    assert ok
    count += 1


def archive(name):
    with zipfile.ZipFile(HERE / 'review-fixtures' / name) as z:
        return {n:z.read(n) for n in z.namelist()}


entries = archive('delta-review-snapshot.mdpkg')
base = json.loads(entries.pop('.mdpkg/manifest.json'))
mutations = {
    'invalid-review-shape': (['review', 'shape'], 'bundled'),
    'invalid-review-detail': (['review', 'detail'], '.mdpkg/review/other.json'),
    'invalid-review-of': (['review', 'of'], None),
    'delta-same-namespace': (['namespace'], base['review']['of']['namespace']),
    'string-reviewed-current': (['review', 'of', 'current'], data['vectors'][0]['snapshotId']),
    'extra-reviewed-key': (['review', 'of', 'extra'], None),
}
for case in data['invalidCases']:
    if case['name'] not in mutations:
        continue
    require(case['base'] == 'delta-review-snapshot.mdpkg')
    require(set(entries) == {base['review']['detail']})
    expected = copy.deepcopy(base)
    keys, value = mutations[case['name']]
    obj = expected
    for key in keys[:-1]: obj = obj[key]
    obj[keys[-1]] = value
    if case['name'] not in ('invalid-review-of', 'string-reviewed-current'):
        review = expected['review']
        header = dict(namespace=expected['namespace'], addressing=expected['addressing'],
                      review=dict(detail=review['detail'], shape=review['shape'],
                                  of={k:review['of'][k] for k in ('current', 'namespace')}))
        expected['current']['id'] = checks.state(entries, header)
    require(case['value'] == expected)
    require(case['expected'] == 'reject')


def references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if (key.lower().endswith('fixture') or key == 'fixture') and item is not None:
                require((HERE / 'review-fixtures' / item).is_file())
            references(item)
    elif isinstance(value, list):
        for item in value: references(item)


ops = {o['name']:o for o in data['operations']}
require(len(ops) == 36)
for op in ops.values():
    require(isinstance(op['input'], dict) and bool(op['input']))
    require(bool(op['expected']))
    references(op['input'])
    observed = op['input'].get('observedAt')
    if observed is not None:
        require(set(observed) == {'id', 'kind'})
    ref = op['input'].get('reference')
    if ref:
        import base64, hashlib
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(ref); query = parse_qs(parsed.query)
        loc = query['loc'][0]
        locator = base64.urlsafe_b64decode(loc + '='*((-len(loc)) % 4))
        require(json.loads(locator) == ['section', 'guide.md', [['# Guide', 0]]])
        root = hashlib.sha256(b'mdpkg-default\0'+query['anchor'][0].encode()+b'\0'+parsed.netloc.encode()+b'\0'+locator).hexdigest()
        require(parsed.path.endswith('/'+root))
        source = data['vectors'][0]['sources']['guide.md'].encode()
        require(query['expect'][0] == hashlib.sha256(b'mdpkg\0'+query['profile'][0].encode()+b'\0section\0'+source).hexdigest())
verified = ops['verified-origin']['input']
require(verified['originProof']['claimedOrigin'] == data['vectors'][0]['origin'])
require(verified['originProof']['expectedCheckpoint']['id'] == data['vectors'][0]['bootstrapCommitId'])
require(verified['observedAt']['id'] != verified['originProof']['expectedCheckpoint']['id'])
full = ops['snapshot-full']['input']
skipped = ops['required-check-skipped']['input']
require(full['targetFixture'] == skipped['targetFixture'])
require(full['checkResults']['snapshotHash'] == 'passed')
require(skipped['checkResults']['snapshotHash'] == 'skipped')
require('snapshotHash' not in skipped['providerRequiredChecks'])
require(ops['partial-without-observedAt']['input']['observedAt'] is None)
require(all(e['value'] == 'partial' for e in ops['partial-without-observedAt']['input']['jsonEdits']))
print(f'6 isolated review negatives; 36 concrete operation inputs; {count} recipe assertions; 0 failures')
