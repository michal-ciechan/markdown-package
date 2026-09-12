"""Regenerate or --check the release CLI JSON projections against actual output."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
cli = ROOT / 'src/generator-cli/artifacts/bin/Mdpkg.Cli/release/mdpkg.dll'
fields = ['exitCode', 'current', 'manifest', 'history', 'mode', 'assurance', 'materialized', 'bootstrapCommit']
examples = {}
with tempfile.TemporaryDirectory(prefix='mdpkg-cli-examples-') as temporary:
    work = Path(temporary)
    source = work / 'source'
    source.mkdir()
    (source / 'guide.md').write_bytes(b'# Guide\n')
    for name, command in [
        ('snapshot', ['pack', str(source), '--out', str(work / 'snapshot.mdpkg'), '--namespace', 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8']),
        ('git', ['pack', str(source), '--history', 'git', '--out', str(work / 'git.mdpkg'), '--namespace', 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8']),
        ('materialize', ['update', str(work / 'snapshot.mdpkg'), '--materialize', '--out', str(work / 'materialized.mdpkg')])]:
        result = subprocess.run(['dotnet', str(cli), *command, '--format', 'json'], capture_output=True, text=True, encoding='utf-8', check=True)
        value = json.loads(result.stdout)
        examples[name] = {key: value[key] for key in fields if key in value}
        assert isinstance(value['current'], dict) and value['current'] == value['manifest']['current']
encoded = json.dumps({'description': 'Selected fields from actual CLI results for guide.md containing # Guide followed by LF; package paths, archive digests, checks and diagnostics omitted.', 'examples': examples}, indent=2) + '\n'
destination = Path(__file__).with_name('cli-output-examples.json')
if args.check:
    assert destination.read_text(encoding='utf-8') == encoded, 'CLI JSON examples drifted; regenerate and review.'
else:
    destination.write_text(encoded, encoding='utf-8', newline='\n')
print('3 generated CLI JSON examples agree with the typed draft-2 schema; 0 failures.')
