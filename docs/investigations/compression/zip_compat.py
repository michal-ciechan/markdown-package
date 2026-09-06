"""Extract real prefix fixtures through installed tools; inspect metadata rewrites."""
import io
import json
import platform
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from benchmark import WORK, OUT, save, sha
from zip_benchmark import EXTRA_ID, COMMENT

DEST = WORK/'zip'
RUN = DEST/('native-'+uuid.uuid4().hex)
RUN.mkdir(parents=True)
EXPECTED = json.loads((DEST/'compat-expected.json').read_text())


def metadata(path):
    data = Path(path).read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        i = z.getinfo('manifest.json')
        # Inspect LOCAL bytes too; ZipInfo.extra contains only central extras.
        offset = i.header_offset
        n = int.from_bytes(data[offset+26:offset+28],'little')
        e = int.from_bytes(data[offset+28:offset+30],'little')
        return dict(prefix_bytes=data[:min(x.header_offset for x in z.infolist())].hex(),
                    archive_comment=z.comment.decode('ascii','replace'),entry_comment=i.comment.decode('ascii','replace'),
                    central_extra=i.extra.hex(),local_extra=data[offset+30+n:offset+30+n+e].hex(),
                    manifest_sha256=sha(z.read(i)),manifest_method=i.compress_type,
                    file_hashes={n:sha(z.read(n)) for n in EXPECTED['hashes']})


def run(cmd):
    p = subprocess.run(list(map(str,cmd)),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
    return dict(returncode=p.returncode,output=p.stdout.decode('utf-8','replace'))


if __name__=='__main__':
    seven = Path('C:/Program Files/7-Zip/7z.exe')
    unzip = Path('C:/Program Files/Git/usr/bin/unzip.exe')
    zipcli = unzip.with_name('zip.exe')
    rows, rewrites = [], []
    for case in EXPECTED['cases']:
        src = DEST/'compat'/(case+'.zip')
        with zipfile.ZipFile(src) as z:
            hashes = {n:sha(z.read(n)) for n in EXPECTED['hashes']}
        rows.append(dict(tool='Python zipfile',version=platform.python_version(),case=case,accepted=hashes==EXPECTED['hashes'],hashes=hashes))
        for tool, command in [('7-Zip',[seven,'x','-y']),('Info-ZIP unzip',[unzip,'-o'])]:
            dest = RUN/(tool.split()[0]+'-'+case)
            dest.mkdir()
            cmd = command+[src]+(['-o'+str(dest)] if tool=='7-Zip' else ['-d',dest])
            result = run(cmd)
            hashes = {n:sha((dest/n).read_bytes()) for n in EXPECTED['hashes'] if (dest/n).exists()}
            rows.append(dict(tool=tool,case=case,accepted=hashes==EXPECTED['hashes'],hashes=hashes,**result))
    source = DEST/'compat/prefix-1-adjusted.zip'
    # Explicit rebuild policies demonstrate why preserved entry bytes != preserved metadata.
    for mode in ['names-only','copy-ZipInfo-and-comment']:
        dst = RUN/('python-'+mode+'.zip')
        with zipfile.ZipFile(source) as a, zipfile.ZipFile(dst,'w') as b:
            if mode=='copy-ZipInfo-and-comment': b.comment=a.comment
            for i in a.infolist():
                b.writestr(i if mode=='copy-ZipInfo-and-comment' else i.filename,a.read(i))
        rewrites.append(dict(tool='Python '+mode,metadata=metadata(dst)))
    added = RUN/'added.txt'
    added.write_text('Archive update probe\n')
    for tool, exe, switches in [('7-Zip',seven,['a']),('Info-ZIP zip',zipcli,['-j'])]:
        if not exe.exists(): continue
        dst = RUN/(tool.replace(' ','-')+'-updated.zip')
        shutil.copyfile(source,dst)
        result = run([exe,*switches,dst,added])
        rewrites.append(dict(tool=tool+' update',metadata=metadata(dst),**result))
    # A byte archive of an NTFS file does not automatically include its ADS.
    shell = json.loads((OUT/'zip-shell-results.json').read_text(encoding='utf-8-sig'))
    rewrites.append(dict(tool='Windows compressed folder extract/repack',metadata=metadata(shell['repacked'])))
    rewrites.append(dict(tool='fflate unzipSync -> zipSync',metadata=metadata(DEST/'fflate-repacked.zip')))
    for rewrite in rewrites:
        assert rewrite['metadata']['file_hashes']==EXPECTED['hashes']
    ads_zip = RUN/'ads-transport.zip'
    with zipfile.ZipFile(ads_zip,'w') as z:
        z.write(shell['ads_source'],'package.zip')
    ads_unpacked = RUN/'ads-unpacked'
    with zipfile.ZipFile(ads_zip) as z: z.extractall(ads_unpacked)
    try:
        Path(str(ads_unpacked/'package.zip')+':mdpkg.version').read_bytes()
        ads_survives = True
    except FileNotFoundError:
        ads_survives = False
    assert not ads_survives
    save(OUT/'zip-compat-results.json',dict(versions=dict(python=platform.python_version(),
         seven_zip=run([seven,'i'])['output'].splitlines()[:3],unzip=run([unzip,'-v'])['output'].splitlines()[:3],
         zip=run([zipcli,'-v'])['output'].splitlines()[:4] if zipcli.exists() else 'Not installed'),cases=rows,rewrites=rewrites,
         ads_zip_transport_survives=ads_survives,macos='Not reachable from this Windows environment'))
    print(json.dumps(dict(cases=len(rows),accepted=sum(r['accepted'] for r in rows),rewrites=len(rewrites))))
