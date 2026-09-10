"""Independent ZIP/native Git acceptance for an actual browser download.

python tests/validate-export.py test-results/browser-review.mdpkg
"""
import json
import pathlib
import subprocess
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
        check(infos[-1].filename.endswith('.pack'), 'pack last')
        check(all(i.compress_type == 0 for i in infos if i.filename.endswith(('.pack', '.idx'))), 'stored Git data')
        manifest = json.loads(archive.read('.mdpkg/manifest.json'))
        comments = archive.read('.mdpkg/review/comments.json')
        check(manifest['review']['shape'] == 'delta' and manifest['namespace'] != manifest['review']['of']['namespace'], 'fresh delta namespace')
        for info in infos:
            target = (root / info.filename).resolve()
            check(target.is_relative_to(root), 'safe entry path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
    def git(*args):
        result = subprocess.run(['git', '-c', 'core.autocrlf=false', *args], cwd=root, capture_output=True, check=True)
        return result.stdout
    git('read-tree', 'HEAD'); checks += 1
    git('fsck', '--full', '--strict'); checks += 1
    check(git('rev-parse', 'HEAD').decode().strip() == manifest['current'][5:], 'current = HEAD')
    check(git('rev-list', '--count', 'HEAD').strip() == b'1', 'one-commit lineage')
    check(git('rev-list', '--parents', 'HEAD').decode().split() == [manifest['current'][5:]], 'parentless snapshot')
    check(git('ls-tree', '-r', '--name-only', 'HEAD').strip() == b'.mdpkg/review/comments.json', 'review-only tracked tree')
    check(git('show', 'HEAD:.mdpkg/review/comments.json') == comments, 'current view = Git blob')
    check(json.loads(comments)['version'] == 2, 'comments v2')
print(f'{checks} independent ZIP/Git checks passed; 0 failures: {package}')
