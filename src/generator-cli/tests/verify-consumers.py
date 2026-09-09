"""Restore fresh external consumers from packed artifacts; run with no Git on PATH."""
import json, os, pathlib, shutil, subprocess, tempfile, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
FEED = ROOT / 'src/generator-cli/artifacts/package'
DOTNET = shutil.which('dotnet')
assert DOTNET, 'dotnet is required to build the consumer'

def run(*args, cwd, expected=0, env=None):
    result = subprocess.run([DOTNET, *map(str,args)], cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode != expected:
        raise RuntimeError(f'{args}: expected {expected}, got {result.returncode}\n{result.stdout}\n{result.stderr}')
    return result.stdout + result.stderr

with tempfile.TemporaryDirectory(prefix='mdpkg-external-consumers-') as temp:
    work = pathlib.Path(temp)
    config = ET.Element('configuration'); sources = ET.SubElement(config, 'packageSources'); ET.SubElement(sources,'clear')
    ET.SubElement(sources,'add',key='local',value=str(FEED)); ET.SubElement(sources,'add',key='nuget.org',value='https://api.nuget.org/v3/index.json')
    ET.ElementTree(config).write(work/'NuGet.Config',encoding='utf-8',xml_declaration=True)
    for package in ('Mdpkg.Reviews','Mdpkg.Reader'):
        project = work/package; project.mkdir()
        csproj = project/'Consumer.csproj'
        csproj.write_text(f'''<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="{package}" Version="0.1.0-preview.1" /></ItemGroup></Project>''', encoding='utf-8')
        program = (ROOT/'examples/review-consumer/Program.cs').read_text(encoding='utf-8') if package.endswith('Reviews') else '''using Mdpkg.Reader;
using var input = File.OpenRead(args[0]);
using var archive = await PackageArchive.OpenAsync(input);
Console.WriteLine(archive.Identity.Current);
'''
        (project/'Program.cs').write_text(program, encoding='utf-8')
        run('restore',csproj,'--configfile',work/'NuGet.Config','--packages',work/'packages',cwd=work)
        assets=json.loads((project/'obj/project.assets.json').read_text(encoding='utf-8'))
        names={key.split('/')[0] for key in assets['libraries']}
        assert not names.intersection({'Mdpkg.Core','System.CommandLine','mdpkg'}),names
        assert all(value['type']=='package' for value in assets['libraries'].values()),'ProjectReference leaked into consumer'
        if package=='Mdpkg.Reader': assert 'Mdpkg.Reviews' not in names
        else: assert 'Mdpkg.Reader' in names
        run('build',csproj,'--no-restore',cwd=work)
        env=dict(os.environ);env['PATH']=str(work/'no-executables')
        dll=project/'bin/Debug/net10.0/Consumer.dll'; fixtures=ROOT/'docs/spec/review-fixtures'
        if package.endswith('Reviews'):
            output=run(dll,fixtures/'delta-v2.mdpkg',fixtures/'original.mdpkg',cwd=work,env=env)
            assert 'Correlation: Exact' in output and 'ChangeRequest' in output and output.count('TargetIntact')==2,output
            output=run(dll,fixtures/'delta-v2.mdpkg','--full',cwd=work,env=env,expected=2)
            assert 'VerificationUnavailable' in output,output
        else: assert 'sha1-' in run(dll,fixtures/'original.mdpkg',cwd=work,env=env)
        print(package+': isolated PackageReference restore and no-Git runtime passed; dependencies: '+', '.join(sorted(names)))
print('2 external consumers passed; full-required without provider rejected as expected; 0 failures.')
