"""Globally install the exact release in an isolated CLI home, then pack/deep-validate.

Default source is nuget.org alone. --local-feed is only for the pre-publish gate.
No project build or locally packed fallback is used by the public-feed proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-feed', type=Path)
    parser.add_argument('--evidence-dir', type=Path,
                        help='Retain proof JSON, command results and generated archives in a new directory')
    parser.add_argument('--attempts', type=int, default=1)
    parser.add_argument('--retry-delay', type=int, default=180)
    args = parser.parse_args()
    if args.attempts < 1 or args.retry_delay < 0:
        parser.error('attempts must be positive and retry-delay nonnegative')
    root = Path(__file__).resolve().parents[1]
    version = ET.parse(root / 'Mdpkg.Pack.props').findtext('./PropertyGroup/Version')
    assert version and re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version), version
    source = str(args.local_feed.resolve()) if args.local_feed else 'https://api.nuget.org/v3/index.json'
    evidence_dir = args.evidence_dir.resolve() if args.evidence_dir else None
    if evidence_dir:
        evidence_dir.mkdir(parents=True, exist_ok=False)
    commands = []
    package_sha256 = None
    if args.local_feed:
        package_path = args.local_feed / f'mdpkg.{version}.nupkg'
        package_sha256 = hashlib.sha256(package_path.read_bytes()).hexdigest()
        with zipfile.ZipFile(package_path) as package:
            metadata = ET.fromstring(package.read('mdpkg.nuspec'))
            ns = {'n': metadata.tag.split('}')[0].removeprefix('{')}
            assert metadata.findtext('n:metadata/n:id', namespaces=ns) == 'mdpkg'
            assert metadata.findtext('n:metadata/n:version', namespaces=ns) == version
            props = ET.parse(root / 'Mdpkg.Pack.props')
            assert metadata.findtext('n:metadata/n:authors', namespaces=ns) == props.findtext('./PropertyGroup/Authors')
            assert metadata.findtext('n:metadata/n:description', namespaces=ns).strip()
            repository = metadata.find('n:metadata/n:repository', ns)
            assert repository is not None and repository.get('type') == 'git'
            assert repository.get('url') == 'https://github.com/michal-ciechan/markdown-package'
            tags = metadata.findtext('n:metadata/n:tags', namespaces=ns) or ''
            assert set(re.split(r'[;\s]+', tags.strip())) == set(props.findtext('./PropertyGroup/PackageTags').split(';'))
            license_node = metadata.find('n:metadata/n:license', ns)
            assert license_node is not None and license_node.text == 'MIT'
            assert license_node.get('type') == 'expression'
            assert not metadata.findall('.//n:dependency', ns), 'tool must bundle its runtime dependencies'
            package_type = metadata.find('n:metadata/n:packageTypes/n:packageType', ns)
            assert package_type is not None and package_type.get('name') == 'DotnetTool'
            for name in ('LICENSE', 'README.md', 'UNICODE-LICENSE.txt'):
                assert package.read(name), name
            settings = ET.fromstring(package.read('tools/net10.0/any/DotnetToolSettings.xml'))
            command = settings.find('./Commands/Command')
            assert command is not None and command.get('Name') == 'mdpkg'
            assert command.get('EntryPoint') == 'mdpkg.dll' and command.get('Runner') == 'dotnet'
            for name in ('mdpkg.dll', 'Mdpkg.Core.dll', 'Mdpkg.Reader.dll',
                         'System.CommandLine.dll', 'Markdig.dll', 'ICSharpCode.SharpZipLib.dll'):
                assert package.read('tools/net10.0/any/' + name), name
        print(f'Local mdpkg {version} metadata, licenses and tool command verified.', flush=True)
    dotnet = shutil.which('dotnet')
    assert dotnet, '.NET SDK is required'

    with tempfile.TemporaryDirectory(prefix='mdpkg-global-proof-') as temp:
        work = Path(temp)
        config = ET.Element('configuration')
        sources = ET.SubElement(config, 'packageSources')
        ET.SubElement(sources, 'clear')
        ET.SubElement(sources, 'add', key='proof', value=source)
        config_file = work / 'NuGet.Config'
        ET.ElementTree(config).write(config_file, encoding='utf-8', xml_declaration=True)
        env = dict(os.environ)
        env.update(DOTNET_CLI_HOME=str(work / 'cli-home'),
                   DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1',
                   DOTNET_CLI_TELEMETRY_OPTOUT='1',
                   DOTNET_GENERATE_ASPNET_CERTIFICATE='false',
                   DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='0')
        for attempt in range(1, args.attempts + 1):
            # Each retry starts with empty caches, including cached feed misses.
            env['NUGET_PACKAGES'] = str(work / f'packages-{attempt}')
            env['NUGET_HTTP_CACHE_PATH'] = str(work / f'http-cache-{attempt}')
            try:
                result = subprocess.run(
                    [dotnet, 'tool', 'install', '--global', 'mdpkg', '--version', version,
                     '--add-source', source, '--configfile', str(config_file), '--no-cache'],
                    cwd=work, env=env, capture_output=True, text=True, timeout=120)
                commands.append({'command': result.args, 'exitCode': result.returncode,
                                 'stdout': result.stdout, 'stderr': result.stderr})
                print(result.stdout, end='', flush=True)
                print(result.stderr, end='', flush=True)
                if result.returncode == 0:
                    break
            except subprocess.TimeoutExpired:
                print('Install timed out after 120 seconds.', flush=True)
            if attempt == args.attempts:
                raise RuntimeError(f'mdpkg {version} not installable from {source} after {attempt} attempts. '
                                   'Check NuGet validation/indexing and ownership, then rerun publish-nuget.yml '
                                   'on master; already published versions are skipped.')
            print(f'Install attempt {attempt}/{args.attempts} failed; retrying in {args.retry_delay}s.', flush=True)
            time.sleep(args.retry_delay)

        tool_dir = work / 'cli-home/.dotnet/tools'
        env['PATH'] = str(tool_dir) + os.pathsep + env.get('PATH', '')
        tool = shutil.which('mdpkg', path=env['PATH'])
        assert tool and Path(tool).parent == tool_dir, 'global shim was not installed in the isolated home'

        def run(*command):
            completed = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=120)
            commands.append({'command': list(command), 'exitCode': completed.returncode,
                             'stdout': completed.stdout, 'stderr': completed.stderr})
            if completed.returncode:
                raise RuntimeError(f'{command} exited {completed.returncode}\n{completed.stdout}\n{completed.stderr}')
            return completed.stdout.strip()

        installed = run(dotnet, 'tool', 'list', '--global')
        assert re.search(r'^mdpkg\s+' + re.escape(version) + r'\s+mdpkg\s*$', installed, re.M), installed
        actual_version = run(tool, '--version')
        assert actual_version.split('+')[0] == version, actual_version
        assert 'pack' in run(tool, '--help')
        source_dir = work / 'source'
        source_dir.mkdir()
        document = '# Caf\u00e9\n\nInstalled global tool round-trip.\n'
        (source_dir / 'guide.md').write_text(document, encoding='utf-8')
        output = work / 'proof.mdpkg'
        run(tool, 'pack', str(source_dir), '--out', str(output), '--namespace',
            'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8')
        assert output.is_file() and output.stat().st_size > 0
        with zipfile.ZipFile(output) as archive:
            assert archive.testzip() is None, 'archive CRC failure'
            first = archive.infolist()[0]
            assert first.filename == '.mdpkg/manifest.json' and first.header_offset == 0
            assert first.compress_type == zipfile.ZIP_STORED and not first.flag_bits & 8
            assert archive.read('guide.md').decode('utf-8') == document
            manifest_bytes = archive.read('.mdpkg/manifest.json')
            assert manifest_bytes.startswith(b'{"mdpkg":"markdown-package/1",')
            manifest = json.loads(manifest_bytes)
            assert set(manifest) == {'mdpkg', 'addressing', 'current', 'history', 'namespace'}
            assert set(manifest['current']) == {'kind', 'id'}
            assert manifest['history'] == {'mode': 'none'} and manifest['current']['kind'] == 'snapshot'
            assert re.fullmatch(r'sha256-[0-9a-f]{64}', manifest['current']['id'])
            assert manifest['addressing'] == {'anchor': 'cm0312-trail-source-v1', 'coverage': 'complete',
                                               'digest': 'cm0312-source-lf-v1', 'overrides': None}
            assert manifest['namespace'] == 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8'
            assert not any(name.startswith('.git/') for name in archive.namelist())
            assert '.mdpkg/history.json' not in archive.namelist()
        validation = json.loads(run(tool, 'validate', str(output), '--deep', '--format', 'json'))
        assert validation['exitCode'] == 0 and validation['package']['tier'] == 'conforming', validation
        assert validation['current'] == manifest['current'] and validation['assurance'] == 'snapshot-verified'
        committed = work / 'git.mdpkg'
        run(tool, 'pack', str(source_dir), '--out', str(committed), '--namespace', manifest['namespace'], '--history', 'git')
        git_validation = json.loads(run(tool, 'validate', str(committed), '--deep', '--format', 'json'))
        assert git_validation['current']['kind'] == 'commit' and git_validation['assurance'] == 'git-verified'
        materialized = work / 'materialized.mdpkg'
        converted = json.loads(run(tool, 'update', str(output), '--materialize', '--out', str(materialized), '--format', 'json'))
        assert converted['materialized'] and converted['bootstrapCommit'] == converted['current']['id']
        if evidence_dir:
            artifacts = {}
            for path in (output, committed, materialized):
                shutil.copyfile(path, evidence_dir / path.name)
                artifacts[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            (evidence_dir / 'guide.md').write_bytes((source_dir / 'guide.md').read_bytes())
            (evidence_dir / 'manifest.json').write_bytes(manifest_bytes)
            proof = {'version': version, 'source': source, 'packageSha256': package_sha256,
                     'installedVersion': actual_version, 'commands': commands, 'artifacts': artifacts,
                     'snapshotValidation': validation, 'gitValidation': git_validation,
                     'materialization': converted}
            (evidence_dir / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
            print(f'Proof artifacts retained in {evidence_dir}', flush=True)
        print(f'mdpkg {version}: global install, version/help, both history modes, full/deep validation and materialization passed; 0 failures.')


if __name__ == '__main__':
    main()
