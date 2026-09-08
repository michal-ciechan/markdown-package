"""CARD-0010: does any real extractor convert line endings, as D-18 says none may?

Three parts, matching the two halves of the extraction procedure in spec.md section 3.8
and the one container property that turned out to decide the first half:

  1. The ZIP unpack. Nine real tool invocations against the conforming package built
     by fixture.py, including both Info-ZIP text-conversion modes the spec names.
  2. The ZIP internal-attributes text bit, which is what actually gates Info-ZIP's
     conversion: four combinations of content EOL against that bit.
  3. The `git read-tree HEAD` that follows the unpack, under each `core.autocrlf`
     setting, followed by the two operations a consumer runs next.

Windows-only for the Explorer, PowerShell and `tar.exe` rows.

    python docs/investigations/eol/extractors.py
"""
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = ROOT / '.antiphon/eol-work'
RUN = WORK / ('extract-' + uuid.uuid4().hex[:12])
SEVEN = Path('C:/Program Files/7-Zip/7z.exe')
UNZIP = Path('C:/Program Files/Git/usr/bin/unzip.exe')
TAR = Path('C:/Windows/System32/tar.exe')
PKG = WORK / 'conforming-lf.mdpkg'
PKG_CRLF = WORK / 'nonconforming-crlf.mdpkg'

_s = importlib.util.spec_from_file_location('we', ROOT / 'docs/spec/worked-example.py')
we = importlib.util.module_from_spec(_s)
_s.loader.exec_module(we)

CHECKS = {}


def bump(name, n=1):
    CHECKS[name] = CHECKS.get(name, 0) + n


def rmtree(p):
    if Path(p).exists():
        shutil.rmtree(p, onerror=lambda f, q, e: (os.chmod(q, 0o700), f(q)))


def run(cmd, cwd=None):
    p = subprocess.run(list(map(str, cmd)), stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, cwd=cwd, timeout=300)
    return dict(returncode=p.returncode,
                output=p.stdout.decode('utf-8', 'replace').strip()[:1200])


def region(name):
    if name.endswith(('.pack', '.idx', '.rev')):
        return 'git-binary'
    if name.startswith('.git/'):
        return 'git-text'
    if name.startswith('.mdpkg/'):
        return 'container'
    return 'document'


def stored_entries(pkg):
    with zipfile.ZipFile(pkg) as z:
        return {i.filename: z.read(i) for i in z.infolist()}


def landed(folder):
    out = {}
    for p in sorted(Path(folder).rglob('*')):
        if p.is_file():
            out[p.relative_to(folder).as_posix()] = p.read_bytes()
    return out


def compare(stored, disk):
    """Per-region byte fidelity, and every CR byte the extractor added or removed."""
    regions, changed = {}, []
    for name, want in stored.items():
        r = regions.setdefault(region(name), dict(entries=0, identical=0, cr_added=0, cr_removed=0))
        r['entries'] += 1
        got = disk.get(name)
        if got == want:
            r['identical'] += 1
            continue
        if got is not None:          # an absent file is a missing entry, not a conversion
            delta = got.count(b"\r") - want.count(b"\r")
            r['cr_added'] += max(delta, 0)
            r['cr_removed'] += max(-delta, 0)
        changed.append(dict(name=name, region=region(name), present=got is not None,
                            stored_bytes=len(want),
                            extracted_bytes=None if got is None else len(got),
                            stored_cr=want.count(b"\r"),
                            extracted_cr=None if got is None else got.count(b"\r"),
                            became_crlf=got is not None and got == want.replace(b"\n", b"\r\n"),
                            became_lf=got is not None
                            and got == want.replace(b"\r\n", b"\n").replace(b"\r", b"\n")))
    return dict(regions=regions, changed=changed,
                unexpected_files=sorted(set(disk) - set(stored)),
                identical=sum(r['identical'] for r in regions.values()),
                entries=sum(r['entries'] for r in regions.values()),
                cr_added=sum(r['cr_added'] for r in regions.values()),
                cr_removed=sum(r['cr_removed'] for r in regions.values()))


def explorer_extract(src, dest):
    """The built-in compressed-folder shell handler, not .NET Expand-Archive."""
    script = ("$ErrorActionPreference='Stop'\n"
              "$s = New-Object -ComObject Shell.Application\n"
              "$zip = $s.NameSpace((Resolve-Path '%s').Path)\n"
              "$out = $s.NameSpace((Resolve-Path '%s').Path)\n"
              "if ($zip -eq $null) { 'NAMESPACE-NULL'; exit 3 }\n"
              "$out.CopyHere($zip.Items(), 16 -bor 4)\n"
              "Start-Sleep -Milliseconds 2500\n" % (src, dest))
    f = RUN / ('shell-' + uuid.uuid4().hex[:8] + '.ps1')
    f.write_text(script, encoding='utf-8')
    return run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(f)])


def fsck(folder):
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    p = subprocess.run(['git', '-C', str(folder), 'fsck', '--full', '--strict'],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=300)
    return dict(returncode=p.returncode,
                output=p.stdout.decode('utf-8', 'replace').strip()[:400])


# ---------------------------------------------------------------------------
# 1. The unpack
# ---------------------------------------------------------------------------
def probe_unpack(stored):
    zip_copy = RUN / 'explorer-probe.zip'
    shutil.copyfile(PKG, zip_copy)
    tools = [
        ('Python zipfile extractall', 'python', PKG),
        ('Info-ZIP unzip -o', 'unzip', PKG),
        ('Info-ZIP unzip -a -o', 'unzip-a', PKG),
        ('Info-ZIP unzip -aa -o', 'unzip-aa', PKG),
        ('7-Zip x', 'seven', PKG),
        ('PowerShell Expand-Archive', 'expand', PKG),
        ('bsdtar -xf', 'tar', PKG),
        ('Windows Explorer, .mdpkg extension', 'explorer', PKG),
        ('Windows Explorer, renamed .zip', 'explorer', zip_copy),
    ]
    rows = []
    for n, (label, kind, src) in enumerate(tools):
        dest = RUN / ('u%d' % n)
        dest.mkdir(parents=True, exist_ok=True)
        if kind == 'python':
            with zipfile.ZipFile(src) as z:
                z.extractall(dest)
            result = dict(returncode=0, output='')
        elif kind == 'unzip':
            result = run([UNZIP, '-o', src, '-d', dest])
        elif kind == 'unzip-a':
            result = run([UNZIP, '-a', '-o', src, '-d', dest])
        elif kind == 'unzip-aa':
            result = run([UNZIP, '-aa', '-o', src, '-d', dest])
        elif kind == 'seven':
            result = run([SEVEN, 'x', '-y', src, '-o' + str(dest)])
        elif kind == 'expand':
            result = run(['powershell', '-NoProfile', '-Command',
                          "Expand-Archive -LiteralPath '%s' -DestinationPath '%s' -Force"
                          % (src, dest)])
        elif kind == 'tar':
            result = run([TAR, '-xf', src, '-C', str(dest)])
        else:
            result = explorer_extract(src, dest)
        cmp = compare(stored, landed(dest))
        cmp.update(tool=label, returncode=result['returncode'], output=result['output'][:300],
                   directory=str(dest), git_fsck=fsck(dest) if (dest / '.git').is_dir() else None)
        rows.append(cmp)
        bump('unpack_probes')
        bump('entry_byte_comparisons', cmp['entries'])
    return rows


def digest_after(stored, rows):
    """Section 6.1 applied to what each extractor actually left on disk.

    D-18's stated purpose is that hashing an extracted file needs no reconstruction of
    what checkout did to it, so this is the property under test, not a side note.
    """
    want = we.snapshot_inventory({n: d for n, d in stored.items() if n.endswith('.md')})
    out = []
    for row in rows:
        docs = {n: d for n, d in landed(row['directory']).items() if n.endswith('.md')}
        try:
            got = we.snapshot_inventory(docs)
        except Exception as e:  # noqa: BLE001
            out.append(dict(tool=row['tool'], entities=len(want), matches=0,
                            all_match=False, error=str(e)[:160]))
        else:
            matches = sum(1 for r, v in want.items() if r in got and got[r]['digest'] == v['digest'])
            out.append(dict(tool=row['tool'], entities=len(want), matches=matches,
                            resolved=len(got), all_match=matches == len(want) == len(got)))
        bump('digest_after_extraction')
    return out


# ---------------------------------------------------------------------------
# 2. The internal-attributes text bit
# ---------------------------------------------------------------------------
def retag(src, dest, text_bit):
    with zipfile.ZipFile(src) as z, zipfile.ZipFile(dest, 'w') as d:
        for i in z.infolist():
            ni = zipfile.ZipInfo(i.filename)
            ni.compress_type = i.compress_type
            ni.create_system = i.create_system
            ni.external_attr = i.external_attr
            ni.internal_attr = 1 if (text_bit and i.filename.endswith('.md')) else 0
            d.writestr(ni, z.read(i), compress_type=i.compress_type)
    return dest


def probe_text_bit():
    """Info-ZIP converts only what the archive itself declares to be text."""
    rows = []
    for content, base in (('LF (conforming)', PKG), ('CRLF (nonconforming)', PKG_CRLF)):
        for bit in (False, True):
            tag = ('%s-%s' % ('lf' if base is PKG else 'crlf', 'text' if bit else 'binary'))
            archive = retag(base, RUN / (tag + '.zip'), bit)
            stored = stored_entries(archive)
            dest = RUN / ('t-' + tag)
            dest.mkdir(parents=True, exist_ok=True)
            r = run([UNZIP, '-a', '-o', archive, '-d', dest])
            cmp = compare(stored, landed(dest))
            docs = cmp['regions']['document']
            rows.append(dict(content=content, internal_attr_text_bit=bit,
                             mode='unzip -a', returncode=r['returncode'],
                             documents=docs['entries'], documents_identical=docs['identical'],
                             cr_removed=cmp['cr_removed'], cr_added=cmp['cr_added'],
                             converted=docs['identical'] != docs['entries']))
            bump('text_bit_probes')
    with zipfile.ZipFile(PKG) as z:
        produced = {i.filename: i.internal_attr for i in z.infolist()}
    return dict(rows=rows, internal_attr_as_produced=produced,
                all_entries_flagged_binary=set(produced.values()) == {0})


# ---------------------------------------------------------------------------
# 3. The Git half
# ---------------------------------------------------------------------------
def probe_git(stored):
    rows = []
    for setting in ('false', 'input', 'true', 'shipped-config-plus-false'):
        dest = RUN / ('g-' + setting)
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(PKG) as z:
            z.extractall(dest)
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        cfg = (dest / '.git/config').read_bytes()
        if setting == 'shipped-config-plus-false':
            # Counterfactual measurement only: what a repository-level pin would do.
            (dest / '.git/config').write_bytes(cfg + b"\tautocrlf = false\n")
            args = []
        else:
            args = ['-c', 'core.autocrlf=' + setting]

        def g(*a, **kw):
            cwd = kw.get('cwd', dest)
            p = subprocess.run(['git', '-C', str(cwd), *args, *map(str, a)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               env=env, timeout=300)
            return dict(returncode=p.returncode,
                        output=p.stdout.decode('utf-8', 'replace').strip())

        after_unpack = compare(stored, landed(dest))
        read_tree = g('read-tree', 'HEAD')
        status = g('status', '--porcelain', '--untracked-files=all')
        eol = g('ls-files', '--eol')
        after_read_tree = compare(stored, landed(dest))

        # What a consumer does next, one: restore a file it deleted or edited.
        for name in [n for n in stored if n.endswith('.md')]:
            (dest / name).unlink()
        checkout = g('checkout', '--', '.')
        after_checkout = compare(stored, landed(dest))

        # What a consumer does next, two: clone the extracted repository.
        clone = RUN / ('clone-' + setting)
        cl = subprocess.run(['git', *args, 'clone', '--quiet', str(dest), str(clone)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=env, timeout=300)
        after_clone = compare({n: d for n, d in stored.items() if n.endswith('.md')},
                              {n: d for n, d in landed(clone).items() if n.endswith('.md')})

        docs = lambda c: c['regions']['document']  # noqa: E731
        rows.append(dict(
            autocrlf=setting,
            shipped_config_declares_autocrlf=b'autocrlf' in cfg,
            read_tree_returncode=read_tree['returncode'],
            modified_after_read_tree=len([l for l in status['output'].splitlines()
                                          if not l.startswith('??')]),
            untracked_after_read_tree=[l[3:] for l in status['output'].splitlines()
                                       if l.startswith('??')],
            ls_files_eol=eol['output'].splitlines(),
            documents=docs(after_unpack)['entries'],
            identical_after_unpack=docs(after_unpack)['identical'],
            identical_after_read_tree=docs(after_read_tree)['identical'],
            checkout_returncode=checkout['returncode'],
            identical_after_checkout=docs(after_checkout)['identical'],
            cr_added_by_checkout=after_checkout['cr_added'],
            all_became_crlf_on_checkout=bool(after_checkout['changed'])
            and all(c['became_crlf'] for c in after_checkout['changed']),
            clone_returncode=cl.returncode,
            identical_after_clone=docs(after_clone)['identical'],
            cr_added_by_clone=after_clone['cr_added'],
            fsck=fsck(dest)))
        bump('git_probes')
        bump('entry_byte_comparisons', after_unpack['entries'] * 3 + after_clone['entries'])
    return rows


if __name__ == '__main__':
    rmtree(RUN)
    RUN.mkdir(parents=True)
    stored = stored_entries(PKG)
    unpack = probe_unpack(stored)
    out = dict(
        platform=platform.platform(), python=platform.python_version(),
        git=run(['git', '--version'])['output'],
        git_global_autocrlf=run(['git', 'config', '--global', '--get', 'core.autocrlf'])['output'],
        unzip=run([UNZIP, '-v'])['output'].splitlines()[0] if UNZIP.exists() else 'absent',
        unzip_path=str(UNZIP),
        seven_zip=next((l for l in run([SEVEN])['output'].splitlines() if '7-Zip' in l), 'unknown')
        if SEVEN.exists() else 'absent',
        tar=run([TAR, '--version'])['output'].splitlines()[0] if TAR.exists() else 'absent',
        package=str(PKG), package_sha256=hashlib.sha256(PKG.read_bytes()).hexdigest(),
        run_directory=str(RUN),
        unpack=unpack,
        digests_after_extraction=digest_after(stored, unpack),
        text_bit=probe_text_bit(),
        git_checkout=probe_git(stored),
        checks=CHECKS)
    (HERE / 'extractor-results.json').write_text(
        json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    print(json.dumps(CHECKS, indent=1))
    for r in out['unpack']:
        print('%-38s exit %-3s identical %2d/%-2d changed %d  cr+ %d cr- %d  fsck %s'
              % (r['tool'], r['returncode'], r['identical'], r['entries'], len(r['changed']),
                 r['cr_added'], r['cr_removed'],
                 r['git_fsck']['returncode'] if r['git_fsck'] else '-'))
    for r in out['digests_after_extraction']:
        print('digest %-38s %s' % (r['tool'], r['all_match']))
    for r in out['text_bit']['rows']:
        print('text-bit %-22s bit=%-5s converted=%-5s docs identical %d/%d cr- %d cr+ %d'
              % (r['content'], r['internal_attr_text_bit'], r['converted'],
                 r['documents_identical'], r['documents'], r['cr_removed'], r['cr_added']))
    for r in out['git_checkout']:
        print('autocrlf=%-26s unpack %d read-tree %d checkout %d clone %d of %d docs; '
              'modified after read-tree %d; cr+ checkout %d clone %d; fsck %d'
              % (r['autocrlf'], r['identical_after_unpack'], r['identical_after_read_tree'],
                 r['identical_after_checkout'], r['identical_after_clone'], r['documents'],
                 r['modified_after_read_tree'], r['cr_added_by_checkout'],
                 r['cr_added_by_clone'], r['fsck']['returncode']))
