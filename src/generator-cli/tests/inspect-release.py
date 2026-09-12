"""Validate coordinated release metadata and write checksums for the verified artifacts."""
import argparse
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('feed', type=Path)
parser.add_argument('--commit')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
version = ET.parse(root / 'Mdpkg.Pack.props').findtext('./PropertyGroup/Version')
artifacts = []
for name in ('Mdpkg.Reader', 'Mdpkg.Core', 'Mdpkg.Reviews', 'mdpkg'):
    path = args.feed / f'{name}.{version}.nupkg'
    with zipfile.ZipFile(path) as archive:
        metadata = ET.fromstring(archive.read(f'{name}.nuspec'))
        ns = {'n': metadata.tag.split('}')[0][1:]}
        meta = metadata.find('n:metadata', ns)
        assert meta.findtext('n:id', namespaces=ns) == name
        assert meta.findtext('n:version', namespaces=ns) == version
        for field in ('authors', 'description', 'projectUrl', 'readme'):
            assert meta.findtext('n:' + field, namespaces=ns), (name, field)
        license_node = meta.find('n:license', ns)
        assert license_node.get('type') == 'expression' and license_node.text == 'MIT'
        repository = meta.find('n:repository', ns)
        assert repository.get('type') == 'git'
        assert repository.get('url') == 'https://github.com/michal-ciechan/markdown-package'
        if args.commit:
            assert repository.get('commit') == args.commit, (name, repository.attrib)
        for member in ('README.md', 'LICENSE'):
            assert archive.read(member), (name, member)
        readme = archive.read('README.md').decode('utf-8')
        assert 'draft 2' in readme and 'breaking' in readme, (name, 'breaking draft release note missing')
        source_readme = root / 'README.md' if name == 'mdpkg' else root / 'src' / name / 'README.md'
        assert readme.replace('\r\n', '\n') == source_readme.read_text(encoding='utf-8'), (name, 'packaged README differs from source')
        dependencies = {d.get('id'): d.get('version') for d in meta.findall('.//n:dependency', ns)}
        assert 'Microsoft.CodeAnalysis.PublicApiAnalyzers' not in dependencies
        if name == 'Mdpkg.Core':
            assert dependencies == {'Mdpkg.Reader': f'[{version}]'}, dependencies
            assert archive.read('lib/net10.0/Mdpkg.Core.xml')
        if name == 'Mdpkg.Reader':
            assert set(dependencies) == {'Markdig', 'SharpZipLib'}, dependencies
            xml = archive.read('lib/net10.0/Mdpkg.Reader.xml').decode('utf-8')
            assert 'Mdpkg.Reader.CurrentState' in xml and 'Mdpkg.Reader.PackageArchive.VerifySnapshot' in xml
        if name == 'Mdpkg.Reviews':
            assert set(dependencies) == {'Mdpkg.Reader'} and dependencies['Mdpkg.Reader'] in (version, f'[{version}]'), dependencies
            assert archive.read('lib/net10.0/Mdpkg.Reviews.xml')
        if name in ('Mdpkg.Reader', 'mdpkg'):
            assert archive.read('UNICODE-LICENSE.txt')
    artifacts.append(path)
symbols = args.feed / f'Mdpkg.Core.{version}.snupkg'
with zipfile.ZipFile(symbols) as archive:
    assert archive.read('lib/net10.0/Mdpkg.Core.pdb')
artifacts.append(symbols)
(args.feed / 'SHA256SUMS').write_text(''.join(
    f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in artifacts), encoding='utf-8')
print(f'4 package manifests and Core symbols verified; {len(artifacts)} SHA-256 checksums written; 0 failures.')
