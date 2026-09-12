"""Prove an installed managed candidate packs with absent Git and a logging poison Git.

Build the local feed with -p:MdpkgManagedSnapshotCandidate=true first. This does
not publish packages or change the production default. Uses an isolated tool path.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-feed', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version = ET.parse(root / 'Mdpkg.Pack.props').findtext('./PropertyGroup/Version')
    dotnet = shutil.which('dotnet')
    assert dotnet
    assertions = 0
    with tempfile.TemporaryDirectory(prefix='mdpkg-managed-proof-') as tmp:
        work = Path(tmp)
        config = ET.Element('configuration')
        sources = ET.SubElement(config, 'packageSources')
        ET.SubElement(sources, 'clear')
        ET.SubElement(sources, 'add', key='candidate', value=str(args.local_feed.resolve()))
        ET.ElementTree(config).write(work / 'NuGet.Config', encoding='utf-8', xml_declaration=True)
        env = dict(os.environ, NUGET_PACKAGES=str(work / 'nuget'), DOTNET_CLI_HOME=str(work / 'home'),
                   DOTNET_ROOT=str(Path(dotnet).resolve().parent), DOTNET_CLI_TELEMETRY_OPTOUT='1')

        def run(command, expected=0, child_env=None):
            result = subprocess.run(command, cwd=work, env=child_env or env, capture_output=True, text=True, timeout=120)
            assert result.returncode == expected, (command, result.returncode, result.stdout, result.stderr)
            return result.stdout

        run([dotnet, 'tool', 'install', 'mdpkg', '--tool-path', str(work / 'tool'), '--version', version,
             '--configfile', str(work / 'NuGet.Config'), '--no-cache'])
        extension = '.exe' if os.name == 'nt' else ''
        tool = str(work / 'tool' / ('mdpkg' + extension))
        poison = work / 'poison'; poison.mkdir()
        (poison / 'git.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
            '<TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>')
        (poison / 'Program.cs').write_text('File.AppendAllText(Environment.GetEnvironmentVariable("MDPKG_GIT_SENTINEL")!, "called\\n"); return 73;')
        run([dotnet, 'build', str(poison / 'git.csproj'), '-c', 'Release', '-o', str(work / 'shim'), '--nologo', '-v', 'quiet'])
        sentinel = work / 'git-invocations'
        child = dict(env, PATH=str(work / 'shim'), MDPKG_GIT_SENTINEL=str(sentinel))
        # Establish that the executable logs and fails if actually launched.
        run([str(work / 'shim' / ('git' + extension))], expected=73, child_env=child)
        assert sentinel.read_text() == 'called\n'; sentinel.unlink(); assertions += 1
        source = work / 'source'; source.mkdir()
        (source / 'doc.txt').write_bytes(b'current\r\ntext\r')
        # Related, distinct blobs exercise the candidate's cross-file delta path.
        common = ''.join(f'Line {i}: {i * 7919:016x} common text.\n' for i in range(2048))
        for i in range(3):
            (source / f'similar{i}.txt').write_text(common + f'Variant {i}\n', encoding='utf-8', newline='\n')
        (source / '.git').write_text('gitdir: deliberately-nonexistent')
        output = work / 'output.mdpkg'
        first = None
        for path in ('', str(work / 'shim')):
            child['PATH'] = path
            result = json.loads(run([tool, 'pack', str(source), '--out', str(output), '--namespace',
                'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8', '--reverse-index', '--data-descriptors', '--format', 'json'], child_env=child))
            assert output.is_file() and not sentinel.exists(); assertions += 2
            assert all(check['status'] == 'pass' for check in result['checks']); assertions += 1
            if first is not None:
                assert output.read_bytes() == first; assertions += 1
            first = output.read_bytes()
        assert (source / 'doc.txt').read_bytes() == b'current\r\ntext\r'; assertions += 1
        assert (source / '.git').read_text() == 'gitdir: deliberately-nonexistent'; assertions += 1
        # Explicit native-only options must hit the same poison executable.
        run([tool, 'pack', str(source), '--out', str(work / 'depth.mdpkg'), '--namespace',
             'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8', '--depth', '1', '--format', 'json'], expected=5, child_env=child)
        assert sentinel.read_text() == 'called\n'; assertions += 1
        assert not (work / 'depth.mdpkg').exists(); assertions += 1
    print(f'{assertions} installed-candidate assertions passed; 0 failures; 0 Git invocations for eligible snapshots.')


if __name__ == '__main__':
    main()
