"""Inspect local packages, restore isolated consumers, and smoke-test the installed tool."""
import argparse, json, os, pathlib, re, shutil, subprocess, tempfile, zipfile, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--local-feed', type=pathlib.Path, default=ROOT / 'src/generator-cli/artifacts/package')
FEED = parser.parse_args().local_feed.resolve()
VERSION = ET.parse(ROOT / 'src/generator-cli/Mdpkg.Pack.props').findtext('./PropertyGroup/Version')
DOTNET = shutil.which('dotnet')
assert DOTNET, 'dotnet is required to build the consumer'

def package_info(package):
    path = FEED / f'{package}.{VERSION}.nupkg'
    with zipfile.ZipFile(path) as archive:
        manifest = next(n for n in archive.namelist() if n.endswith('.nuspec'))
        root = ET.fromstring(archive.read(manifest))
        ns = {'n': root.tag.split('}')[0].removeprefix('{')}
        metadata = root.find('n:metadata', ns)
        assert metadata is not None
        assert metadata.find('n:version', ns).text == VERSION
        return path, VERSION, archive.namelist(), metadata, ns

packages = {name: package_info(name) for name in ('Mdpkg.Reader', 'Mdpkg.Core', 'Mdpkg.Reviews', 'mdpkg')}
_, core_version, core_files, core_metadata, ns = packages['Mdpkg.Core']
reader_version = packages['Mdpkg.Reader'][1]
dependencies = core_metadata.findall('.//n:dependency', ns)
assert [(d.attrib['id'], d.attrib['version']) for d in dependencies] == [('Mdpkg.Reader', f'[{reader_version}]')]
assert 'README.md' in core_files and 'lib/net10.0/Mdpkg.Core.xml' in core_files
assert 'UNICODE-LICENSE.txt' in packages['Mdpkg.Reader'][2]
assert 'UNICODE-LICENSE.txt' in packages['mdpkg'][2]
assert list(FEED.glob('Mdpkg.Core.*.snupkg')), 'Core portable symbols absent'
for field in ('authors', 'description', 'projectUrl', 'repository'):
    assert core_metadata.find('n:' + field, ns) is not None, field
runtime = packages['mdpkg'][2]
for assembly in ('Mdpkg.Core.dll', 'Mdpkg.Reader.dll', 'Markdig.dll', 'ICSharpCode.SharpZipLib.dll', 'System.CommandLine.dll'):
    assert any(n.endswith('/' + assembly) for n in runtime), assembly
print('4 packages inspected; exact Core/Reader dependency, XML docs, symbols, Unicode notice and tool runtime verified.')

def run(*args, cwd, expected=0, env=None):
    result = subprocess.run([DOTNET, *map(str,args)], cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode != expected:
        raise RuntimeError(f'{args}: expected {expected}, got {result.returncode}\n{result.stdout}\n{result.stderr}')
    return result.stdout + result.stderr

with tempfile.TemporaryDirectory(prefix='mdpkg-external-consumers-') as temp:
    work = pathlib.Path(temp)
    config = ET.Element('configuration'); sources = ET.SubElement(config, 'packageSources'); ET.SubElement(sources,'clear')
    ET.SubElement(sources,'add',key='local',value=str(FEED)); ET.SubElement(sources,'add',key='nuget.org',value='https://api.nuget.org/v3/index.json')
    mapping = ET.SubElement(config, 'packageSourceMapping')
    local = ET.SubElement(mapping, 'packageSource', key='local')
    ET.SubElement(local, 'package', pattern='Mdpkg.*'); ET.SubElement(local, 'package', pattern='mdpkg')
    public = ET.SubElement(mapping, 'packageSource', key='nuget.org'); ET.SubElement(public, 'package', pattern='*')
    ET.ElementTree(config).write(work/'NuGet.Config',encoding='utf-8',xml_declaration=True)
    for package in ('Mdpkg.Reviews','Mdpkg.Reader','Mdpkg.Core'):
        project = work/package; project.mkdir()
        csproj = project/'Consumer.csproj'
        csproj.write_text(f'''<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="{package}" Version="{packages[package][1]}" /></ItemGroup></Project>''', encoding='utf-8')
        program = re.findall(r'```csharp\n(.*?)```', (ROOT/'src/generator-cli/src/Mdpkg.Reviews/README.md').read_text(encoding='utf-8'), re.S)[0] if package.endswith('Reviews') else '''using Mdpkg.Reader;
using var input = File.OpenRead(args[0]);
using var archive = await PackageArchive.OpenAsync(input);
Console.WriteLine(archive.Identity.Current.Id);
'''
        if package == 'Mdpkg.Core':
            examples = re.findall(r'```csharp\n(.*?)```', (ROOT/'src/generator-cli/src/Mdpkg.Core/README.md').read_text(encoding='utf-8'), re.S)
            assert len(examples) == 2
            program = examples[0]
        elif package == 'Mdpkg.Reader':
            program += '''
input.Position = 0;
var snapshot = await PackageSnapshot.ReadAsync(input);
var scope = snapshot.GetScopes("guide.md")[0];
var uri = $"mdpkg://{snapshot.Identity.Namespace}/v2/document/{scope.Root}?anchor=cm0312-trail-source-v1&profile=cm0312-source-lf-v1&expect={scope.Digest}&loc={scope.Locator.Encode()}";
LooseReferenceResolution loose = snapshot.ResolveReference(uri);
if (loose.Category != "identity" || loose.Status != "survives" || loose.Scope is null) throw new Exception("Loose-reference consumer failed.");
'''
        (project/'Program.cs').write_text(program, encoding='utf-8')
        run('restore',csproj,'--configfile',work/'NuGet.Config','--packages',work/'packages',cwd=work)
        assets=json.loads((project/'obj/project.assets.json').read_text(encoding='utf-8'))
        names={key.split('/')[0] for key in assets['libraries']}
        assert not names.intersection({'System.CommandLine','mdpkg'}),names
        if package != 'Mdpkg.Core': assert 'Mdpkg.Core' not in names
        else:
            assert 'Mdpkg.Reviews' not in names
            assert {'Mdpkg.Core', 'Mdpkg.Reader', 'Markdig', 'SharpZipLib'}.issubset(names), names
        assert all(value['type']=='package' for value in assets['libraries'].values()),'ProjectReference leaked into consumer'
        if package=='Mdpkg.Reader': assert 'Mdpkg.Reviews' not in names
        else: assert 'Mdpkg.Reader' in names
        run('build',csproj,'--no-restore',cwd=work)
        env=dict(os.environ);env['PATH']=str(work/'no-executables')
        dll=project/'bin/Debug/net10.0/Consumer.dll'; fixtures=ROOT/'docs/spec/review-fixtures'
        if package.endswith('Reviews'):
            output=run(dll,fixtures/'delta-v2.mdpkg',fixtures/'original.mdpkg',cwd=work,env=env)
            assert 'Correlation: Exact' in output and 'ChangeRequest' in output and output.count('TargetIntact')==2,output
            output=run(dll,fixtures/'delta-v2.mdpkg','--full',cwd=work,env=env)
            assert '/Full' in output and output.count('TargetUnavailable')==2,output
            # The standalone Reviews package above has no Core dependency. The full
            # example opts into Core separately to demonstrate the S3 native bridge.
            project_xml=ET.parse(csproj)
            ET.SubElement(project_xml.getroot().find('ItemGroup'),'PackageReference',Include='Mdpkg.Core',Version=core_version)
            project_xml.write(csproj,encoding='utf-8',xml_declaration=True)
            (project/'Program.cs').write_text((ROOT/'examples/review-consumer/Program.cs').read_text(encoding='utf-8'),encoding='utf-8')
            run('restore',csproj,'--configfile',work/'NuGet.Config','--packages',work/'packages',cwd=work)
            run('build',csproj,'--no-restore',cwd=work)
            output=run(dll,fixtures/'delta-v2.mdpkg','--full',cwd=work,env=env)
            assert '/Full' in output,output
            output=run(dll,fixtures/'delta-v2.mdpkg','--target',fixtures/'changed.mdpkg','--newer','--git','--full',cwd=work)
            assert 'Correlation: NewerTarget' in output and output.count('TargetRelocated')==2,output
            output=run(dll,fixtures/'delta-v2.mdpkg','--target',fixtures/'original-git.mdpkg','--git',cwd=work)
            assert 'newer-target-not-selected' in output and output.count('Invalidated')==2,output
            output=run(dll,fixtures/'invalid-bundled-document.mdpkg','--full','--git',cwd=work,expected=2)
            assert '/Full' not in output and 'Explain these words.' in output,output
        elif package == 'Mdpkg.Reader': assert 'sha256-' in run(dll,fixtures/'original.mdpkg',cwd=work,env=env)
        else:
            source = work/'source'; source.mkdir(); (source/'guide.md').write_text('# Guide\n\nHello.\n', encoding='utf-8')
            assert 'sha256-' in run(dll, source, work/'created.mdpkg', cwd=work, env=env)
            (project/'Program.cs').write_text(examples[1], encoding='utf-8')
            run('build',csproj,'--no-restore',cwd=work)
            assert re.search(r'[a-f0-9]{64}', run(dll,cwd=work))
            (project/'Program.cs').write_text('''using Mdpkg.Core;
using Mdpkg.Reader;
var updater = new PackageUpdater();
var first = await updater.MaterializeAsync(new(args[0]), args[1]);
if (first.Status != OperationStatus.Success || !first.Materialized || first.BootstrapCommit != "sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9") throw new Exception("Bootstrap differs from S1.");
var child = await updater.UpdateAsync(new(args[1], args[2], SnapshotMetadata.CliDefault), args[3]);
if (child.Status != OperationStatus.Success || child.Materialized) throw new Exception("Append failed.");
using var input = File.OpenRead(args[3]);
using var archive = await PackageArchive.OpenAsync(input);
IHistoryVerificationBackend backend = new GitHistoryBackend();
var proof = await backend.VerifyAsync(archive);
if (proof.OriginalSnapshot is not { HasOriginalArchiveBytes: false } original || System.Text.Encoding.UTF8.GetString(proof.ReadOriginalEntry("guide.md")) != "# Guide\\n" || proof.GetRelationship(original.Identity.Current).Status != CheckpointStatus.Verified) throw new Exception("Original context failed.");
Console.WriteLine("S3 materialize, append and verified Reader backend passed.");
''', encoding='utf-8')
            run('build',csproj,'--no-restore',cwd=work)
            assert 'S3 materialize' in run(dll,fixtures/'guide-snapshot.mdpkg',work/'bootstrap.mdpkg',source,work/'child.mdpkg',cwd=work)
        print(package+': isolated PackageReference consumer passed' + (' without Git' if package != 'Mdpkg.Core' else ' (both README examples)') + '; dependencies: '+', '.join(sorted(names)))
    tool_env = dict(os.environ)
    tool_env['NUGET_PACKAGES'] = str(work/'tool-cache')
    tool_env['NUGET_HTTP_CACHE_PATH'] = str(work/'http-cache')
    run('tool','install','mdpkg','--version',packages['mdpkg'][1],'--tool-path',work/'tools','--configfile',work/'NuGet.Config',cwd=work,env=tool_env)
    exe = work/'tools'/('mdpkg.exe' if os.name == 'nt' else 'mdpkg')
    for args in (['pack',str(work/'source'),'--out',str(work/'tool.mdpkg'),'--namespace','c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8'], ['validate',str(work/'tool.mdpkg'),'--deep'],
                 ['update',str(work/'tool.mdpkg'),'--materialize','--out',str(work/'tool-bootstrap.mdpkg')],
                 ['update',str(work/'tool-bootstrap.mdpkg'),'--tree',str(work/'source'),'--message','Append from installed tool','--out',str(work/'tool-child.mdpkg')],
                 ['validate',str(work/'tool-child.mdpkg'),'--deep']):
        result = subprocess.run([str(exe), *args], cwd=work, env=tool_env, capture_output=True, text=True)
        assert result.returncode == 0, (args,result.stdout,result.stderr)
    print('Installed local tool: pack, materialize, append and deep validate passed.')
print('3 external consumers, 2 Core README examples and installed-tool smoke passed; 0 failures.')
