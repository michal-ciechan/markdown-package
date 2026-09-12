"""Restore exact Reader/Core into fresh external consumers, then create/deep-validate/read.

The default proof uses nuget.org alone, with no repository build or artifact fallback.
--local-feed enables the pre-publish gate, mapping Mdpkg.* exclusively to that feed.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

PUBLIC_SOURCE = 'https://api.nuget.org/v3/index.json'
CORE_PROGRAM = '''using Mdpkg.Core;
using Mdpkg.Reader;
var request = new DirectoryPackageRequest(args[0], Guid.Parse("c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"));
var created = await new PackageBuilder().CreateFromDirectoryAsync(request, args[1]);
if (created.Status != OperationStatus.Success)
    throw new InvalidOperationException(string.Join("; ", created.Diagnostics.Select(d => d.Message)));
var validation = await new PackageValidator().ValidateFileAsync(args[1], new() { Deep = true });
if (!validation.IsConforming || validation.RequestedLevel != ValidationLevel.Deep)
    throw new InvalidOperationException("Deep validation failed.");
using var input = File.OpenRead(args[1]);
using var archive = await PackageArchive.OpenAsync(input);
if (archive.Identity != created.Identity || archive.VerifySnapshot() != created.Identity)
    throw new InvalidOperationException("Core and Reader identities disagree.");
if (created.Mode != HistoryMode.None || created.Identity!.Current.Kind != "snapshot" || created.Assurance != IdentityAssurance.SnapshotVerified)
    throw new InvalidOperationException("Default creation must emit the typed history-free state.");
Console.WriteLine("Core snapshot create + full hash validation + transitive Reader passed without Git.");
'''
READER_PROGRAM = '''using Mdpkg.Reader;
using System.Text;
using var input = File.OpenRead(args[0]);
using var archive = await PackageArchive.OpenAsync(input);
if (Encoding.UTF8.GetString(archive.ReadEntry("guide.md")) != "# Caf\u00e9\\n\\nPublic library round-trip.\\n")
    throw new InvalidOperationException("Reader content differs.");
Console.WriteLine("Standalone Reader without Git passed.");
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-feed', type=Path)
    parser.add_argument('--attempts', type=int, default=1)
    parser.add_argument('--retry-delay', type=int, default=180)
    args = parser.parse_args()
    if args.attempts < 1 or args.retry_delay < 0:
        parser.error('attempts must be positive and retry-delay nonnegative')
    root = Path(__file__).resolve().parents[1]
    version = ET.parse(root / 'Mdpkg.Pack.props').findtext('./PropertyGroup/Version')
    assert version and re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version), version
    dotnet = shutil.which('dotnet')
    assert dotnet, '.NET 10 SDK is required'
    with tempfile.TemporaryDirectory(prefix='mdpkg-library-proof-') as temp:
        for attempt in range(1, args.attempts + 1):
            # New projects, CLI home, package cache and HTTP cache on every retry.
            work = Path(temp) / str(attempt)
            work.mkdir()
            config = ET.Element('configuration')
            sources = ET.SubElement(config, 'packageSources')
            ET.SubElement(sources, 'clear')
            ET.SubElement(sources, 'add', key='nuget.org', value=PUBLIC_SOURCE)
            ET.SubElement(ET.SubElement(config, 'fallbackPackageFolders'), 'clear')
            if args.local_feed:
                ET.SubElement(sources, 'add', key='local', value=str(args.local_feed.resolve()))
                mapping = ET.SubElement(config, 'packageSourceMapping')
                ET.SubElement(ET.SubElement(mapping, 'packageSource', key='local'), 'package', pattern='Mdpkg.*')
                ET.SubElement(ET.SubElement(mapping, 'packageSource', key='nuget.org'), 'package', pattern='*')
            config_file = work / 'NuGet.Config'
            ET.ElementTree(config).write(config_file, encoding='utf-8', xml_declaration=True)
            env = dict(os.environ)
            env.update(DOTNET_CLI_HOME=str(work / 'cli-home'),
                       DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1', DOTNET_CLI_TELEMETRY_OPTOUT='1',
                       DOTNET_GENERATE_ASPNET_CERTIFICATE='false',
                       NUGET_PACKAGES=str(work / 'packages'), NUGET_HTTP_CACHE_PATH=str(work / 'http-cache'))
            for name, program in (('Core', CORE_PROGRAM), ('Reader', READER_PROGRAM)):
                project = work / name
                project.mkdir()
                (project / f'{name}Consumer.csproj').write_text(f'''<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <RestoreFallbackFolders></RestoreFallbackFolders>
    <DisableImplicitNuGetFallbackFolder>true</DisableImplicitNuGetFallbackFolder>
  </PropertyGroup>
  <ItemGroup><PackageReference Include="Mdpkg.{name}" Version="[{version}]" /></ItemGroup>
</Project>''', encoding='utf-8')
                (project / 'Program.cs').write_text(program, encoding='utf-8')
            solution = work / 'Consumers.slnx'
            solution.write_text('<Solution><Project Path="Core/CoreConsumer.csproj" /><Project Path="Reader/ReaderConsumer.csproj" /></Solution>', encoding='utf-8')
            try:
                restored = subprocess.run([dotnet, 'restore', str(solution), '--configfile', str(config_file),
                                           '--no-http-cache', '--packages', str(work / 'packages')],
                                          cwd=work, env=env, capture_output=True, text=True, timeout=120)
                print(restored.stdout, end='', flush=True)
                print(restored.stderr, end='', flush=True)
                if restored.returncode == 0:
                    break
            except subprocess.TimeoutExpired:
                print('Restore timed out after 120 seconds.', flush=True)
            if attempt == args.attempts:
                raise RuntimeError(f'Reader/Core {version} restore failed after {attempt} attempts. '
                                   'Check package ownership, policy scopes and NuGet validation/indexing; '
                                   'rerun publish-nuget.yml after correcting the cause.')
            print(f'Restore attempt {attempt}/{args.attempts} failed; retrying in {args.retry_delay}s.', flush=True)
            time.sleep(args.retry_delay)

        for name in ('Core', 'Reader'):
            assets = json.loads((work / name / 'obj/project.assets.json').read_text(encoding='utf-8'))
            libraries = assets['libraries']
            expected = {'Mdpkg.Reader', 'Markdig', 'SharpZipLib'}
            if name == 'Core':
                expected.add('Mdpkg.Core')
            assert {key.split('/')[0] for key in libraries} == expected, libraries
            assert all(item['type'] == 'package' for item in libraries.values()), libraries
            for package in expected & {'Mdpkg.Core', 'Mdpkg.Reader'}:
                assert f'{package}/{version}' in libraries, libraries
            if name == 'Core':
                target = next(iter(assets['targets'].values()))
                dependency = target[f'Mdpkg.Core/{version}']['dependencies']['Mdpkg.Reader']
                assert dependency.replace(' ', '') in (f'[{version}]', f'[{version},{version}]'), dependency
            if not args.local_feed:
                assert set(assets['project']['restore']['sources']) == {PUBLIC_SOURCE}
            for key, item in libraries.items():
                if not args.local_feed or not key.startswith('Mdpkg.'):
                    provenance = json.loads((work / 'packages' / item['path'] / '.nupkg.metadata').read_text(encoding='utf-8'))
                    assert provenance['source'] == PUBLIC_SOURCE, (key, provenance)

        def run(*command, command_env=env):
            completed = subprocess.run(command, cwd=work, env=command_env, capture_output=True, text=True, timeout=120)
            if completed.returncode:
                raise RuntimeError(f'{command} exited {completed.returncode}\n{completed.stdout}\n{completed.stderr}')
            return completed.stdout.strip()

        run(dotnet, 'build', str(solution), '--no-restore', '-c', 'Release')
        source = work / 'source'
        source.mkdir()
        (source / 'guide.md').write_text('# Caf\u00e9\n\nPublic library round-trip.\n', encoding='utf-8')
        package_file = work / 'proof.mdpkg'
        reader_env = dict(env)
        reader_env['PATH'] = str(work / 'no-executables')
        print(run(dotnet, str(work / 'Core/bin/Release/net10.0/CoreConsumer.dll'), str(source), str(package_file), command_env=reader_env))
        print(run(dotnet, str(work / 'Reader/bin/Release/net10.0/ReaderConsumer.dll'), str(package_file), command_env=reader_env))
        print(f'Reader/Core {version}: 2 isolated consumers passed from '
              f'{args.local_feed.resolve() if args.local_feed else PUBLIC_SOURCE}; 0 failures.')


if __name__ == '__main__':
    main()
