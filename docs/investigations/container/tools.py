"""CARD-0001: real tools against the example package, its path rules and its rewrites.

Windows-only for the Explorer rows. Installed tool paths are explicit, as in CARD-0002.
"""
import hashlib
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import unicodedata
import uuid
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'compression'))
import benchmark as compression  # noqa: E402
from zip_benchmark import zip_bytes  # noqa: E402

WORK = ROOT / '.antiphon/container-work'
RUN = WORK / ('tools-' + uuid.uuid4().hex)
SEVEN = Path('C:/Program Files/7-Zip/7z.exe')
UNZIP = Path('C:/Program Files/Git/usr/bin/unzip.exe')
MANIFEST_NAME = '.mdpkg/manifest.json'
CHECKS = {}


def bump(name, n=1):
    CHECKS[name] = CHECKS.get(name, 0) + n


def rmtree(p):
    if Path(p).exists():
        shutil.rmtree(p, onerror=lambda f, q, e: (os.chmod(q, 0o700), f(q)))


def run(cmd, cwd=None, check=False):
    p = subprocess.run(list(map(str, cmd)), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       cwd=cwd, timeout=300)
    if check and p.returncode:
        raise RuntimeError((cmd, p.stdout.decode('utf-8', 'replace')))
    return dict(returncode=p.returncode, output=p.stdout.decode('utf-8', 'replace').strip()[:2000])


def landed(folder):
    out = {}
    for p in sorted(Path(folder).rglob('*')):
        if p.is_file():
            out[p.relative_to(folder).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    return out


def explorer_extract(src, dest):
    """The actual built-in compressed-folder handler, not .NET Expand-Archive."""
    script = f'''$ErrorActionPreference='Stop'
$s = New-Object -ComObject Shell.Application
$zip = $s.NameSpace((Resolve-Path '{src}').Path)
$out = $s.NameSpace((Resolve-Path '{dest}').Path)
if ($zip -eq $null) {{ 'NAMESPACE-NULL'; exit 3 }}
$items = @($zip.Items())
"count=$($items.Count)"
$out.CopyHere($zip.Items(), 16 -bor 4)
Start-Sleep -Milliseconds 1500
'''
    f = RUN / ('shell-' + uuid.uuid4().hex + '.ps1')
    f.write_text(script, encoding='utf-8')
    return run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(f)])


def path_fixtures():
    """Names that are distinct byte strings to Git but may collide on extraction."""
    nfc = unicodedata.normalize('NFC', 'caf\u00e9.md')
    nfd = unicodedata.normalize('NFD', 'caf\u00e9.md')
    return {
        'case-pair': [('README.md', b'# upper\n'), ('readme.md', b'# lower\n')],
        'unicode-nfc-nfd': [(nfc, b'# nfc\n'), (nfd, b'# nfd\n')],
        'non-ascii-single': [('\u65e5\u672c\u8a9e.md', b'# jp\n')],
        'backslash-in-name': [('a\\b.md', b'# backslash\n')],
    }


def probe_paths():
    rows = []
    for case, items in path_fixtures().items():
        data = zip_bytes([(n, d, 8) for n, d in items])
        src = RUN / (case + '.zip')
        src.write_bytes(data)
        expected = {n: hashlib.sha256(d).hexdigest()[:16] for n, d in items}
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            flags = {i.filename: i.flag_bits for i in z.infolist()}
        for tool in ['Python zipfile', '7-Zip', 'Info-ZIP unzip', 'Windows Explorer']:
            dest = RUN / (case + '-' + tool.split()[0])
            dest.mkdir(parents=True, exist_ok=True)
            if tool == 'Python zipfile':
                with zipfile.ZipFile(src) as z:
                    z.extractall(dest)
                result = dict(returncode=0, output='')
            elif tool == '7-Zip':
                result = run([SEVEN, 'x', '-y', src, '-o' + str(dest)])
            elif tool == 'Info-ZIP unzip':
                result = run([UNZIP, '-o', src, '-d', dest])
            else:
                result = explorer_extract(src, dest)
            files = landed(dest)
            rows.append(dict(case=case, tool=tool, entries=len(items), files_on_disk=len(files),
                             preserved=files == expected, landed=files, returncode=result['returncode'],
                             utf8_flag_bit11={n: bool(f & 0x800) for n, f in flags.items()}))
            bump('path_extractions')
    return rows


def probe_git_paths():
    """What Git itself accepts as a tracked path, and what it does on a Windows checkout."""
    repo = RUN / 'gitpaths'
    repo.mkdir(parents=True)
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)

    def g(*args, **kw):
        p = subprocess.run(['git', '-C', str(repo), *map(str, args)], stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, env=env, input=kw.get('data'), timeout=120)
        return dict(returncode=p.returncode, output=p.stdout.decode('utf-8', 'replace').strip()[:400])

    g('init', '-q', '-b', 'main')
    rows = []
    blob = subprocess.run(['git', '-C', str(repo), 'hash-object', '-w', '--stdin'], input=b'x\n',
                          stdout=subprocess.PIPE, env=env).stdout.decode().strip()
    for label, name in [('README.md vs readme.md', 'readme.md'), ('reserved .git/ path', '.git/hooks/x'),
                        ('reserved .GIT/ path', '.GIT/hooks/x'), ('unreserved .mdpkg/ path', '.mdpkg/x.json')]:
        first = 'README.md' if label.startswith('README') else name
        spec = ''.join(f'100644 {blob}\t{p}\n' for p in ({first, name} if first != name else {name}))
        r = g('update-index', '--index-info', data=spec.encode())
        tr = subprocess.run(['git', '-C', str(repo), 'write-tree'], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=env).stdout.decode().strip()
        fsck = g('fsck', '--full', '--strict') if len(tr) == 40 else dict(returncode=None, output=tr)
        wt = RUN / ('wt-' + label.replace(' ', '-').replace('/', '_'))
        wt.mkdir(exist_ok=True)
        co = subprocess.run(['git', '--git-dir', str(repo / '.git'), '--work-tree', str(wt),
                             'checkout-index', '-a', '-f'], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=env)
        rows.append(dict(case=label, path=name, plumbing_update_index=r['returncode'] == 0,
                         write_tree_ok=len(tr) == 40, fsck_returncode=fsck['returncode'],
                         checkout_returncode=co.returncode,
                         checkout_files=sorted(landed(wt)),
                         checkout_output=co.stdout.decode('utf-8', 'replace').strip()[:200],
                         output=r['output']))
        bump('git_path_cases')
        g('read-tree', '--empty')
    # Real Windows checkout of a tree holding both case variants.
    spec = f'100644 {blob}\tREADME.md\n100644 {blob}\treadme.md\n'
    g('update-index', '--index-info', data=spec.encode())
    tree = subprocess.run(['git', '-C', str(repo), 'write-tree'], stdout=subprocess.PIPE, env=env).stdout.decode().strip()
    work = RUN / 'gitpaths-worktree'
    work.mkdir()
    checkout = subprocess.run(['git', '--git-dir', str(repo / '.git'), '--work-tree', str(work),
                               'checkout-index', '-a', '-f'], stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, env=env)
    rows.append(dict(case='checkout of both case variants on NTFS', path='README.md + readme.md',
                     plumbing_update_index=True, write_tree_ok=True, tree=tree, returncode=checkout.returncode,
                     files_on_disk=sorted(landed(work)),
                     output=checkout.stdout.decode('utf-8', 'replace').strip()[:400]))
    bump('git_path_cases')
    return rows


def probe_extraction(pkg, label):
    """The extracted directory form must be an ordinary, clean Git working tree."""
    dest = RUN / ('extract-' + label)
    dest.mkdir(parents=True)
    with zipfile.ZipFile(pkg) as z:
        z.extractall(dest)
        names = [i.filename for i in z.infolist()]
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)

    def g(*args):
        p = subprocess.run(['git', '-C', str(dest), '-c', 'core.autocrlf=false',
                            '-c', 'core.fileMode=false', *map(str, args)],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=300)
        return dict(returncode=p.returncode, output=p.stdout.decode('utf-8', 'replace').strip())

    manifest = json.loads((dest / MANIFEST_NAME).read_text(encoding='utf-8'))
    head = manifest['current'].split('-', 1)[1]
    # No .git/index is shipped, so an untouched extraction reports every file untracked.
    before = g('status', '--porcelain')
    read_tree = g('read-tree', 'HEAD')
    index_bytes = (dest / '.git/index').stat().st_size if (dest / '.git/index').exists() else 0
    status = g('status', '--porcelain')
    fsck = g('fsck', '--full', '--strict')
    rev = g('rev-parse', 'HEAD')
    tracked = g('ls-files')
    untracked = g('status', '--porcelain', '--untracked-files=all')
    ignored_by_design = sorted(n for n in untracked['output'].splitlines() if n.startswith('?? '))
    bump('extraction_checks')
    return dict(package=label, entries=len(names), files_after_read_tree=len(landed(dest)),
                status_lines_before_read_tree=len(before['output'].splitlines()),
                read_tree_returncode=read_tree['returncode'],
                index_bytes_if_shipped=index_bytes,
                head_matches_manifest=rev['output'] == head,
                worktree_clean_ignoring_container_metadata=all(
                    n[3:].strip('"').startswith('.mdpkg/') for n in ignored_by_design),
                status_lines=len(status['output'].splitlines()),
                untracked_entries=[n[3:] for n in ignored_by_design],
                tracked_files=len(tracked['output'].splitlines()),
                fsck_returncode=fsck['returncode'], fsck_output=fsck['output'][:300],
                status_output=status['output'][:400])


def probe_rewrites(pkg):
    """Does the manifest-first typing invariant survive ordinary archive rewrites?"""
    original = Path(pkg).read_bytes()
    rows = []

    def inspect(data, op):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = [i.filename for i in z.infolist()]
                info = z.getinfo(MANIFEST_NAME)
                body = z.read(MANIFEST_NAME)
                first = names[0] == MANIFEST_NAME
                stored = info.compress_type == 0
                offset_zero = info.header_offset == 0
        except Exception as e:  # noqa: BLE001
            rows.append(dict(operation=op, readable=False, error=str(e)[:200]))
            return
        rows.append(dict(operation=op, readable=True, entries=len(names),
                         manifest_content_preserved=body == ORIGINAL_MANIFEST,
                         manifest_first=first, manifest_stored=stored,
                         fast_typing_ok=first and stored and offset_zero,
                         first_entry=names[0]))
        bump('rewrite_cases')

    with zipfile.ZipFile(io.BytesIO(original)) as z:
        globals()['ORIGINAL_MANIFEST'] = z.read(MANIFEST_NAME)
    inspect(original, 'as produced')

    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as src, zipfile.ZipFile(out, 'w') as dst:
        for i in src.infolist():
            dst.writestr(i.filename, src.read(i))
    inspect(out.getvalue(), 'Python rebuild by filename and bytes')

    seven = RUN / 'sevenzip-add.zip'
    shutil.copyfile(pkg, seven)
    extra = RUN / 'extra.txt'
    extra.write_text('added\n')
    r = run([SEVEN, 'a', seven, extra])
    inspect(seven.read_bytes(), f'7-Zip a (add one file), exit {r["returncode"]}')

    ex = RUN / 'winshell-src'
    ex.mkdir(parents=True)
    with zipfile.ZipFile(pkg) as z:
        z.extractall(ex)
    rebuilt = RUN / 'winshell-rebuilt.zip'
    r = run(['powershell', '-NoProfile', '-Command',
             f"Compress-Archive -Path '{ex}\\*' -DestinationPath '{rebuilt}' -Force"])
    if rebuilt.exists():
        inspect(rebuilt.read_bytes(), f'PowerShell Compress-Archive of the extraction, exit {r["returncode"]}')
    else:
        rows.append(dict(operation='PowerShell Compress-Archive of the extraction',
                         readable=False, error=r['output'][:200]))

    node = RUN / 'fflate.mjs'
    js = RUN / 'fflate-out.zip'
    fflate = (ROOT / '.antiphon/compression-work/js/node_modules/fflate/esm/browser.js').as_uri()
    node.write_text(f'''import {{unzipSync, zipSync}} from '{fflate}';
import fs from 'node:fs';
const u = unzipSync(new Uint8Array(fs.readFileSync({json.dumps(str(pkg))})));
fs.writeFileSync({json.dumps(str(js))}, Buffer.from(zipSync(u)));
''')
    r = run(['node', node])
    if js.exists():
        inspect(js.read_bytes(), 'fflate unzipSync then zipSync')
    else:
        rows.append(dict(operation='fflate unzipSync then zipSync', readable=False, error=r['output'][:200]))
    return rows


def eocd_comment(data):
    """The terminal EOCD's comment bytes, straight out of the archive tail."""
    p = len(data) - 22
    while p >= max(0, len(data) - 65557):
        if data[p:p + 4] == b'PK' + bytes([5, 6]):
            n = int.from_bytes(data[p + 20:p + 22], 'little')
            if p + 22 + n == len(data):
                return data[p + 22:]
        p -= 1
    raise ValueError('no terminal EOCD')


def _eocd_field(data, offset, size=4):
    p = len(data) - 22
    while p >= max(0, len(data) - 65557):
        if data[p:p + 4] == b'PK' + bytes([5, 6]):
            n = int.from_bytes(data[p + 20:p + 22], 'little')
            if p + 22 + n == len(data):
                return data[p + offset:p + offset + size]
        p -= 1
    raise ValueError('no terminal EOCD')


def probe_comment_rewrites(pkg):
    """Does a fixed-length EOCD comment survive the same rewrites the manifest did?

    Each row also prices the three typing routes on the rewritten archive: the 34-byte
    tail window, the 79-byte read at offset 0, and the recoverable central-directory walk.
    """
    original = Path(pkg).read_bytes()
    want = eocd_comment(original)
    rows = []

    def inspect(data, op):
        try:
            got = eocd_comment(data)
        except ValueError as e:  # noqa: BLE001
            rows.append(dict(operation=op, readable=False, error=str(e)))
            return
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                info = z.infolist()
                offset_zero_ok = (info[0].filename == MANIFEST_NAME
                                  and info[0].compress_type == 0
                                  and info[0].header_offset == 0)
            cd_bytes = int.from_bytes(_eocd_field(data, 12), 'little')
        except Exception:  # noqa: BLE001
            offset_zero_ok, cd_bytes = False, None
        rows.append(dict(operation=op, readable=True, comment_bytes=len(got),
                         comment_hex=got.hex(), preserved=got == want,
                         outcome='preserved unmodified' if got == want
                         else 'stripped' if not got
                         else 'replaced with a different comment',
                         tail_typing_bytes=22 + 12 if got == want else None,
                         offset0_typing_bytes=79 if offset_zero_ok else None,
                         directory_typing_bytes=None if cd_bytes is None else 22 + cd_bytes))
        bump('comment_rewrite_cases')

    inspect(original, 'as produced')

    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as src, zipfile.ZipFile(out, 'w') as dst:
        for i in src.infolist():
            dst.writestr(i.filename, src.read(i))
    inspect(out.getvalue(), 'Python rebuild by filename and bytes')

    seven = RUN / 'sevenzip-comment.zip'
    shutil.copyfile(pkg, seven)
    extra = RUN / 'extra-comment.txt'
    extra.write_text('added\n')
    r = run([SEVEN, 'a', seven, extra])
    inspect(seven.read_bytes(), f'7-Zip a (add one file), exit {r["returncode"]}')

    ex = RUN / 'winshell-comment-src'
    ex.mkdir(parents=True)
    with zipfile.ZipFile(pkg) as z:
        z.extractall(ex)
    rebuilt = RUN / 'winshell-comment-rebuilt.zip'
    r = run(['powershell', '-NoProfile', '-Command',
             f"Compress-Archive -Path '{ex}\\*' -DestinationPath '{rebuilt}' -Force"])
    if rebuilt.exists():
        inspect(rebuilt.read_bytes(), f'PowerShell Compress-Archive of the extraction, exit {r["returncode"]}')
    else:
        rows.append(dict(operation='PowerShell Compress-Archive of the extraction',
                         readable=False, error=r['output'][:200]))

    node = RUN / 'fflate-comment.mjs'
    js = RUN / 'fflate-comment-out.zip'
    fflate = (ROOT / '.antiphon/compression-work/js/node_modules/fflate/esm/browser.js').as_uri()
    node.write_text(f"""import {{unzipSync, zipSync}} from '{fflate}';
import fs from 'node:fs';
const u = unzipSync(new Uint8Array(fs.readFileSync({json.dumps(str(pkg))})));
fs.writeFileSync({json.dumps(str(js))}, Buffer.from(zipSync(u)));
""")
    r = run(['node', node])
    if js.exists():
        inspect(js.read_bytes(), 'fflate unzipSync then zipSync')
    else:
        rows.append(dict(operation='fflate unzipSync then zipSync', readable=False, error=r['output'][:200]))
    return rows


if __name__ == '__main__':
    rmtree(RUN)
    RUN.mkdir(parents=True)
    pkg = WORK / 'npm/no-overrides.mdpkg'
    out = dict(platform=platform.platform(),
               python=platform.python_version(),
               git=run(['git', '--version'])['output'],
               seven_zip=next((l for l in run([SEVEN])['output'].splitlines() if '7-Zip' in l), 'unknown')
               if SEVEN.exists() else 'absent',
               unzip=run([UNZIP, '-v'])['output'].splitlines()[0] if UNZIP.exists() else 'absent',
               run_directory=str(RUN),
               paths=probe_paths(), git_paths=probe_git_paths(),
               extraction=[probe_extraction(WORK / f'{c}/no-overrides.mdpkg', c) for c in ('npm', 'rust')],
               rewrites=probe_rewrites(pkg),
               comment_rewrites=probe_comment_rewrites(WORK / 'npm/no-overrides-fixed.mdpkg'),
               checks=CHECKS)
    compression.save(HERE / 'tools-results.json', out)
    print(json.dumps(dict(checks=CHECKS), indent=1))
    for r in out['paths']:
        print(r['case'], '|', r['tool'], '| files', r['files_on_disk'], '| preserved', r['preserved'])
    for r in out['git_paths']:
        print('git:', r['case'], '| update-index', r.get('plumbing_update_index'), '| fsck',
              r.get('fsck_returncode'), '| checkout', r.get('checkout_returncode'),
              r.get('checkout_files', r.get('files_on_disk', '')))
    for r in out['extraction']:
        print('extract:', r['package'], '| head', r['head_matches_manifest'], '| status before',
              r['status_lines_before_read_tree'], '| after', r['status_lines'], '| index',
              r['index_bytes_if_shipped'], '| untracked', r['untracked_entries'])
    for r in out['rewrites']:
        print('rewrite:', r['operation'], r.get('fast_typing_ok'), r.get('manifest_content_preserved'), r.get('error', ''))
    for r in out['comment_rewrites']:
        print('comment:', r['operation'], '|', r.get('outcome', r.get('error')), '| tail',
              r.get('tail_typing_bytes'), '| offset0', r.get('offset0_typing_bytes'),
              '| directory', r.get('directory_typing_bytes'))
