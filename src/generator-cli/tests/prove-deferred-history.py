"""Fresh CLI -> actual browser export -> CLI/Core/Reviews -> C0/C1 acceptance.

Run from any directory after npm ci and Playwright installation. --prepare-only
and --verify-only allow the browser phase to run in the Linux Playwright image.
All outputs are kept in the explicitly supplied work directory for inspection.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
CLI_ROOT = ROOT / 'src/generator-cli'
WEB = ROOT / 'src/web-viewer'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', required=True, type=Path)
phase = parser.add_mutually_exclusive_group()
phase.add_argument('--prepare-only', action='store_true')
phase.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
dotnet = shutil.which('dotnet')
assert dotnet
cli = CLI_ROOT / 'artifacts/bin/Mdpkg.Cli/release/mdpkg.dll'

def run(command, cwd=CLI_ROOT, env=None, expected=0):
    result = subprocess.run(list(map(str, command)), cwd=cwd, env=env, capture_output=True, text=True, encoding='utf-8', timeout=240)
    if result.returncode != expected:
        raise RuntimeError(f'{command}: {result.returncode}\n{result.stdout}\n{result.stderr}')
    return result.stdout

def command(name, *options, expected=0):
    output = run([dotnet, cli, *options, '--format', 'json'], expected=expected)
    value = json.loads(output)
    (work / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    return value

def manifest(name):
    with zipfile.ZipFile(work / (name + '.mdpkg')) as archive:
        return json.loads(archive.read('.mdpkg/manifest.json'))

if not args.verify_only:
    run([dotnet, 'build', '-c', 'Release'])
    source = work / 'source'
    source.mkdir(exist_ok=True)
    (source / 'guide.md').write_text('# Guide\n\nIntro target words.\n\n## Usage\n\nUse the tool.\n', encoding='utf-8', newline='\n')
    (source / 'hidden.txt').write_text('Unselected bytes are still hashed.\n', encoding='utf-8', newline='\n')
    for mode in ('snapshot', 'git'):
        command(mode + '-pack', 'pack', source, '--out', work / (mode + '.mdpkg'), '--namespace',
                'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8', *(['--history', 'git'] if mode == 'git' else []))
        m = manifest(mode)
        assert m['current']['kind'] == ('commit' if mode == 'git' else 'snapshot')
        command(mode + '-validate', 'validate', work / (mode + '.mdpkg'), '--deep')
    print('Prepared two fresh CLI modes.', flush=True)
    if args.prepare_only:
        raise SystemExit(0)
    env = dict(os.environ, MDPKG_ACCEPTANCE_DIR=str(work))
    npm, npx = shutil.which('npm'), shutil.which('npx')
    run([npm, 'run', 'build'], cwd=WEB)
    print(run([npx, 'playwright', 'test', 'tests/integration.spec.js', '--project=chromium'], cwd=WEB, env=env))

for mode in ('snapshot', 'git'):
    command(mode + '-review-validate', 'validate', work / (mode + '-review.mdpkg'), '--deep')
    review = manifest(mode + '-review')
    assert review['review']['of']['current'] == manifest(mode)['current']
    assert review['namespace'] != manifest(mode)['namespace']
command('materialize', 'update', work / 'snapshot.mdpkg', '--materialize', '--out', work / 'materialized.mdpkg')
source = work / 'successor'
source.mkdir(exist_ok=True)
for path in (work / 'source').iterdir():
    shutil.copyfile(path, source / path.name)
with (source / 'guide.md').open('a', encoding='utf-8', newline='\n') as output:
    output.write('Additional usage guidance.\n')
command('update', 'update', work / 'materialized.mdpkg', '--tree', source, '--message', 'Integrated successor', '--out', work / 'child.mdpkg')
command('child-validate', 'validate', work / 'child.mdpkg', '--deep')
command('direct-update', 'update', work / 'snapshot.mdpkg', '--tree', source, '--message', 'Integrated successor', '--out', work / 'direct-child.mdpkg')
assert manifest('child')['current'] == manifest('direct-child')['current']
# Repaired ZIP CRCs cannot conceal modified browser feedback from full hashing.
with zipfile.ZipFile(work / 'snapshot-review.mdpkg') as original, zipfile.ZipFile(work / 'tampered-review.mdpkg', 'w') as changed:
    for entry in original.infolist():
        data = original.read(entry)
        if entry.filename == '.mdpkg/review/comments.json':
            data = data.replace(b'Explain these words.', b'Changed these words.')
        changed.writestr(entry, data)
command('tampered-review-validate', 'validate', work / 'tampered-review.mdpkg', '--deep', expected=3)
project = CLI_ROOT / 'tests/IntegratedAcceptance/IntegratedAcceptance.csproj'
print(run([dotnet, 'run', '--project', project, '-c', 'Release', '--', work]))
print('Fresh two-mode browser pipeline, materialize/direct-and-staged append, and repaired-CRC rejection passed; 0 failures.')
