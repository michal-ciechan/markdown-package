"""Independent ZIP/snapshot-hash acceptance for an actual browser download.

python tests/validate-export.py test-results/browser-review.mdpkg
"""
import json
import pathlib
import hashlib
import sys
import tempfile
import zipfile

package = pathlib.Path(sys.argv[1]).resolve()
checks = 0

def check(condition, label):
    global checks
    assert condition, label
    checks += 1

with tempfile.TemporaryDirectory(prefix='mdpkg-browser-review-') as temporary:
    root = pathlib.Path(temporary)
    with zipfile.ZipFile(package) as archive:
        infos = archive.infolist()
        check(archive.testzip() is None, 'ZIP CRCs')
        check(not archive.comment, 'empty archive comment')
        check(all(i.internal_attr == 0 for i in infos), 'internal attributes')
        check(all(i.compress_type in (0, 8) for i in infos), 'ZIP methods')
        check(infos[0].filename == '.mdpkg/manifest.json' and infos[0].header_offset == 0, 'manifest first')
        check(package.read_bytes()[50:79] == b'{"mdpkg":"markdown-package/1"', 'typing magic')
        check({i.filename for i in infos} == {'.mdpkg/manifest.json', '.mdpkg/review/comments.json'} and len(infos) == 2, 'two-file snapshot without Git')
        manifest = json.loads(archive.read('.mdpkg/manifest.json'))
        comments = archive.read('.mdpkg/review/comments.json')
        check(manifest['review']['shape'] == 'delta' and manifest['namespace'] != manifest['review']['of']['namespace'], 'fresh delta namespace')
        for info in infos:
            target = (root / info.filename).resolve()
            check(target.is_relative_to(root), 'safe entry path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
    check(manifest['history'] == {'mode': 'none'}, 'history none')
    check(manifest['current']['kind'] == 'snapshot', 'snapshot current')
    r = manifest['review']
    header = {'addressing': manifest['addressing'], 'namespace': manifest['namespace'],
              'review': {'detail': r['detail'], 'shape': r['shape'],
                         'of': {'namespace': r['of']['namespace'], 'current': r['of']['current']}}}
    preimage = {'entries': [{'bytes': len(comments), 'digest': 'sha256-' + hashlib.sha256(comments).hexdigest(),
                            'mode': '100644', 'path': '.mdpkg/review/comments.json'}],
                'header': header, 'profile': 'mdpkg-snapshot-v1'}
    encoded = (json.dumps(preimage, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
    check(manifest['current']['id'] == 'sha256-' + hashlib.sha256(encoded).hexdigest(), 'exact snapshot hash')
    check(json.loads(comments)['version'] == 2, 'comments v2')
print(f'{checks} independent ZIP/snapshot-hash checks passed; 0 failures: {package}')
