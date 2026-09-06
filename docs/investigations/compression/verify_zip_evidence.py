"""Audit the follow-up's artifacts, byte accounting and compatibility outcomes."""
import json
import struct
import zipfile
from benchmark import WORK, OUT, sha, save
from zip_benchmark import EXTRA_ID, COMMENT


def read(name): return json.loads((OUT/name).read_text(encoding='utf-8-sig'))


if __name__=='__main__':
    sizes, js, native, shell = map(read,['zip-results.json','zip-js-results.json','zip-compat-results.json','zip-shell-results.json'])
    artifacts=0
    for c in sizes['corpora']:
        for row in c['rows']:
            assert abs(row['over_best_solid_pct']-(row['bytes']/c['best_solid_bytes']-1)*100)<1e-9
            if 'sha256' not in row: continue
            file = WORK/'zip'/c['corpus']/(row['variant']+'.zip')
            assert file.stat().st_size==row['bytes'] and sha(file.read_bytes())==row['sha256']
            assert row['overhead_bytes']+row['payload_bytes']==row['bytes']
            with zipfile.ZipFile(file) as z: assert z.testzip() is None
            artifacts+=1
    cases = native['cases']+[dict(tool='Windows shell',**r) for r in shell['cases']]+[dict(tool='fflate',**r) for r in js['cases']]
    assert len(cases)==25
    for r in cases:
        expected = 'unadjusted' not in r['case'] or r['tool'] in ['Python zipfile','Info-ZIP unzip']
        assert r['accepted']==expected,r
    for row in js['range']:
        assert row['payloadVerified']
        assert row['wireBytes']==sum(r['bytes'] for r in row['requests'])
        assert row['wireBytes']<=row['totalBytes']
        extents=sorted((r['start'],r['start']+r['bytes']) for r in row['requests'])
        assert all(a[1]<=b[0] for a,b in zip(extents,extents[1:])),row
        assert all(r['status']==206 for r in row['requests'])
    assert len(js['range'])==56 and len(js['metadata'])==3
    extra = (struct.pack('<HH',EXTRA_ID,len(COMMENT))+COMMENT).hex()
    for row in native['rewrites']:
        m=row['metadata']
        preserve = row['tool'] in ['Python copy-ZipInfo-and-comment','7-Zip update']
        assert (m['archive_comment']=='MDPKG/1')==preserve
        assert (m['entry_comment']=='entry-version=1')==preserve
        assert (m['central_extra']==extra)==preserve
        assert (m['local_extra']==extra)==preserve
        assert (m['prefix_bytes']=='01')==(row['tool']=='7-Zip update')
        assert m['manifest_sha256']==json.loads((WORK/'zip/compat-expected.json').read_text())['hashes']['manifest.json']
    assert [x['has_version_stream'] for x in shell['ads']]==[True,True,False]
    assert len({x['sha256'] for x in shell['ads']})==1
    assert not native['ads_zip_transport_survives'] and not js['adsHttpTransportSurvives']
    counts = dict(**sizes['checks'],archive_size_hash_crc_audits=artifacts,
                  tool_fixture_cases=len(cases),successful_tool_extractions=sum(r['accepted'] for r in cases),
                  observed_prefix_failures=sum(not r['accepted'] for r in cases),metadata_rewrites=len(native['rewrites']),
                  http_range_scenarios=len(js['range']),http_metadata_fixtures=len(js['metadata']),
                  http_206_responses=js['serverResponses'],ads_transport_checks=5,unexpected_failures=0)
    save(OUT/'zip-verification.json',counts)
    print(json.dumps(counts,indent=2))
