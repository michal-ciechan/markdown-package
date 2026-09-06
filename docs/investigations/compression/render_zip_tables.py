"""Render ZIP report tables from measured JSON, without changing older tables."""
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent
REPORT = OUT.parent/'compression.md'
LABELS = {
 'best-solid-brotli-11':'Best prior solid (Brotli 11 npm / xz 6 Rust)',
 'whole-gzip-6':'Whole gzip 6, payload only',
 'per-entry-gzip-6':'Independent gzip 6, payload only',
 'zip-deflate-6':'ZIP, per-entry DEFLATE 6',
 'zip-stored':'ZIP, stored entries',
 'zip-solid-tar-gzip-6':'ZIP, one stored tar.gz (gzip 6)',
 'zip-solid-tar-zstd-9':'ZIP, one stored tar.zst (zstd 9)',
 'zip-block64k-tar-gzip-6':'Hybrid: ZIP of 64 KiB tar.gz blocks + stored map',
 'zip-dual-deflate-and-solid-gzip':'Hybrid: DEFLATE files + duplicate solid tar.gz',
 'zip-deflate-versioned':'ZIP DEFLATE + stored version manifest + EOCD hint',
}


def table(headers, rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
                     ['| '+' | '.join(map(str,r))+' |' for r in rows])


def render():
    sizes = json.loads((OUT/'zip-results.json').read_text(encoding='utf-8'))
    js = json.loads((OUT/'zip-js-results.json').read_text(encoding='utf-8'))
    a,b = sizes['corpora']
    rows = []
    for x,y in zip(a['rows'],b['rows']):
        rows.append([LABELS[x['variant']],f"{x['bytes']:,}",f"+{x['over_best_solid_pct']:.2f}%",
                     f"{y['bytes']:,}",f"+{y['over_best_solid_pct']:.2f}%"])
    tables = {'ZIP_SIZE':table(['Variant','npm bytes','Over best solid','Rust bytes','Over best solid'],rows)}
    rows=[]
    for x,y in zip(a['access'],b['access']):
        rows.append([LABELS[x['variant']],f"{x['document_payload_bytes']:,} / {x['section_payload_bytes']:,}",
                     f"{x['document_decode_bytes']:,}",f"{y['document_payload_bytes']:,} / {y['section_payload_bytes']:,}",f"{y['document_decode_bytes']:,}"])
    tables['ZIP_ACCESS'] = table(['Variant','npm fetch doc / section','npm decode output','Rust fetch doc / section','Rust decode output'],rows)
    rows=[]
    for v in [r['variant'] for r in a['rows'] if r['variant'].startswith('zip-')]:
        cells=[LABELS[v]]
        for c in ['npm','rust']:
            for tail in [22,65557]:
                pair=[next(r for r in js['range'] if r['corpus']==c and r['variant']==v and r['tailBytes']==tail and r['unit']==unit) for unit in ['document','section']]
                cells.append(' / '.join(f"{r['wireBytes']:,} ({len(r['requests'])})" for r in pair))
        rows.append(cells)
    tables['ZIP_RANGE'] = table(['Variant','npm 22-byte start','npm 65,557-byte start','Rust 22-byte start','Rust 65,557-byte start'],rows)
    text=REPORT.read_text(encoding='utf-8')
    for key,value in tables.items():
        text,n = re.subn(f'<!-- {key}_START -->.*?<!-- {key}_END -->',f'<!-- {key}_START -->\n\n{value}\n\n<!-- {key}_END -->',text,flags=re.S)
        assert n==1,key
    REPORT.write_text(text,encoding='utf-8')


if __name__=='__main__': render()
