"""Validates the review package that review_probe.mjs emits from browser APIs.

The point of the probe is that a page with no server can produce a package other
tools accept, so the acceptance test has to be other tools: Python's zipfile for
the container, and a native Git for the curated repository (spec.md section 3.8).

    node docs/investigations/viewer-app/review_probe.mjs
    python docs/investigations/viewer-app/validate_review.py
"""
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / '.antiphon/viewer-work/review-delta.mdpkg'
OUT = ROOT / '.antiphon/viewer-work/review-extract'
RESULTS = Path(__file__).resolve().parent / 'validation-results.json'
ENV = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)


def git(cwd, *args):
    p = subprocess.run(('git',) + args, cwd=cwd, capture_output=True, env=ENV)
    return p.returncode, p.stdout.decode(errors='replace').strip(), p.stderr.decode(errors='replace').strip()


def main():
    data = PKG.read_bytes()
    result = {'package': str(PKG), 'bytes': len(data)}

    with zipfile.ZipFile(PKG) as z:
        result['zipfile'] = {
            'testzip': z.testzip(),
            'comment': z.comment.decode(),
            'names': z.namelist(),
            'internal_attr_all_zero': all(i.internal_attr == 0 for i in z.infolist()),
            'methods': sorted({i.compress_type for i in z.infolist()}),
            'manifest_is_first': z.infolist()[0].filename == '.mdpkg/manifest.json',
            'manifest_header_offset': z.infolist()[0].header_offset,
        }
        manifest = json.loads(z.read('.mdpkg/manifest.json'))
        comments = json.loads(z.read('.mdpkg/review/comments.json'))
        if OUT.exists():
            shutil.rmtree(OUT)
        z.extractall(OUT)

    result['manifest_first_29_bytes'] = data[50:79].decode()
    result['manifest'] = manifest
    result['threads'] = len(comments['threads'])

    # section 3.8: extraction is a Git working tree.
    code, head, err = git(OUT, 'read-tree', 'HEAD')
    result['git'] = {'read_tree': {'code': code, 'stderr': err}}
    code, out, err = git(OUT, 'status', '--porcelain')
    result['git']['status'] = {'code': code, 'lines': out.splitlines()}
    code, out, err = git(OUT, 'fsck', '--full', '--strict')
    result['git']['fsck'] = {'code': code, 'stdout': out, 'stderr': err}
    code, out, err = git(OUT, 'rev-parse', 'HEAD')
    result['git']['rev_parse'] = {'code': code, 'head': out}
    result['git']['head_matches_manifest'] = out == manifest['current'][len('sha1-'):]
    code, out, err = git(OUT, 'cat-file', '-p', 'HEAD^{tree}')
    result['git']['tip_tree'] = {'code': code, 'entries': out.splitlines()}
    code, out, err = git(OUT, 'log', '--format=%H %s', '--name-only')
    result['git']['log'] = {'code': code, 'lines': out.splitlines()}

    # The tracked tree must touch only .mdpkg/review/ (review-comments.md section 7.4).
    code, out, err = git(OUT, 'ls-tree', '-r', '--name-only', 'HEAD')
    tracked = out.splitlines()
    result['git']['tracked_paths'] = tracked
    result['git']['only_review_paths'] = all(p.startswith('.mdpkg/review/') for p in tracked)

    ok = (result['zipfile']['testzip'] is None
          and result['zipfile']['comment'] == ''
          and result['zipfile']['internal_attr_all_zero']
          and result['zipfile']['manifest_is_first']
          and result['zipfile']['manifest_header_offset'] == 0
          and set(result['zipfile']['methods']) <= {0, 8}
          and result['manifest_first_29_bytes'] == '{"mdpkg":"markdown-package/1"'
          and result['git']['read_tree']['code'] == 0
          and result['git']['fsck']['code'] == 0
          and result['git']['head_matches_manifest']
          and result['git']['only_review_paths']
          and all(l.startswith('?? ') for l in result['git']['status']['lines']))
    result['accepted'] = ok
    RESULTS.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
