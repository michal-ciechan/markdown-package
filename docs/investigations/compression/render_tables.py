"""Refresh generated report tables from saved experiment evidence."""
import json
import re
import statistics
from pathlib import Path

OUT=Path(__file__).resolve().parent
REPORT=OUT.parent/'compression.md'


def inject(text,key,body):
    start,end=f'<!-- {key}_START -->',f'<!-- {key}_END -->'
    region=start+'\n\n'+body+'\n\n'+end
    if start in text:
        return re.sub(re.escape(start)+r'.*?'+re.escape(end),lambda _:region,text,flags=re.S)
    marker=f'<!-- {key} -->'
    assert marker in text
    return text.replace(marker,region)


def ms(v,browser=False):
    return '<1' if browser and v==0 else f'{v:.1f}' if browser else f'{v:.3f}'


def mode(row):
    return ('whole, stream' if row['stream'] else 'whole, materialize') if row['mode']=='whole' else row['mode']


def main():
    summary=json.loads((OUT/'decode-summary.json').read_text())
    text=REPORT.read_text(encoding='utf-8')
    lines=['### Native library decode','',
           '| Codec | Framing / output handling | First ms | Warm median ms | p95 ms | Process peak MiB | New peak increase MiB |',
           '| --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for row in summary['native']:
        lines.append(f"| {row['codec']} | {mode(row)} | {ms(row['first_ms'])} | {ms(row['median_ms'])} | {ms(row['p95_ms'])} | {row['peak_mib']:.2f} | {row['peak_increase_mib']:.2f} |")
    lines+=['','### Actual browser decode','',
      '| Browser / decoder | Framing / output handling | First ms | Warm median ms | p95 ms | Renderer peak MiB | New peak increase MiB |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for browser in ['chrome','firefox']:
        for row in summary[browser]:
            if 'unavailable' in row:continue
            if row['engine']=='native' and row['codec'] in ['raw-6','deflate-6'] and row['mode']!='entry':continue
            label=f"{browser.title()} / {row['codec']} {row['engine']}"
            lines.append(f"| {label} | {mode(row)} | {ms(row['firstMs'],True)} | {ms(row['medianMs'],True)} | {ms(row['p95Ms'],True)} | {row['peak_mib']:.2f} | {row['peak_increase_mib']:.2f} |")
    lines+=['',
      'Firefox timing precision is approximately 1 ms in this configuration; zero-valued samples are shown as `<1`, not zero work. First decode excludes separate decoder module initialization below. Warm p95 is the median of the three per-profile p95 values, not a pooled tail guarantee. Native library, Streams and WASM bindings have different buffering/copying behavior; these are measured read paths, not an intrinsic ranking of algorithms.',
      '',
      'For gzip, native streaming retains a small memory increment but still processes the entire 9.4 MB workload. Chrome streaming also avoids the full-output copy, yet its measured high-water increase remains about 12.5 MiB because Streams/runtime buffers and input ownership still matter. An independently compressed entry limits work and memory much more effectively than merely choosing a streaming API.',
      '',
      'The active renderer PID was identified with a 300 ms CPU pulse before the measurement baseline, and checked for a dominant CPU delta. Spare/browser processes are excluded. The pulse is excluded from timing. Raw evidence: [native-results.json](compression/native-results.json), [Chrome](compression/chrome-decode-results.json), [Firefox](compression/firefox-decode-results.json), and [derived summary](compression/decode-summary.json).']
    text=inject(text,'DECODE_TABLES','\n'.join(lines))
    rows=json.loads((OUT/'chrome-decode-results.json').read_text())
    lines=['Cold-profile initialization of the entry decoder in Chrome (three samples):','',
      '| Decoder / selected entry | Module load + initialization median ms (range) | First decode median ms | Initialization + first decode median ms | WASM linear memory after first decode |',
      '| --- | ---: | ---: | ---: | ---: |']
    for engine,which,label in [('brotli-wasm','entry','Brotli decoder'),('zstd-wasm','entry','zstd, no dictionary'),('zstd-wasm','dict-entry','zstd, trained 16 KiB dictionary'),('fflate','entry','fflate gzip')]:
        samples=[r['result'] for r in rows if r['config']['engine']==engine and r['config']['fixture']['mode']==which]
        starts=[r['startupMs'] for r in samples]
        first=statistics.median(r['firstMs'] for r in samples)
        total=statistics.median(r['startupMs']+r['firstMs'] for r in samples)
        mem=samples[0]['wasmMemoryAfterFirst']
        linear=f'{mem/1048576:.3f} MiB' if mem else 'None'
        lines.append(f'| {label} | {statistics.median(starts):.1f} ({min(starts):.1f}–{max(starts):.1f}) | {first:.1f} | {total:.1f} | {linear} |')
    lines+=['',
      'These include loopback module/asset loading, parsing, compilation and instantiation, with warm OS file caches; they are not isolated WASM compiler timings or WAN download predictions. Input/dictionary bytes were preloaded. Browser launch and the renderer-identification pulse are excluded. Timing differences of a few milliseconds should not drive codec selection on this shared host. WASM linear-memory byte length is an address-space allocation, not the same as resident physical memory; zstd reserves about 16.125 MiB even for one small entry. Brotli materializing the whole fixture grew linear memory to 34.5 MiB, versus 1.25 MiB for its entry.']
    text=inject(text,'STARTUP_TABLE','\n'.join(lines))
    v=json.loads((OUT/'verification.json').read_text())
    validation=(f"Validation: **{v['compression_roundtrips']:,} compression round-trip comparisons**, "
      f"**{v['native_decode_hash_checks']} native target hash comparisons**, "
      f"**{v['browser_decode_hash_checks']} browser target hash comparisons**, "
      f"**{v['browser_support']} browser support/framing checks**, and "
      f"**{v['corpus_continuity']} corpus continuity checks**; **0 unexpected failures in the final evidence**. "
      "Native decode covers 25 scenarios × 3 processes. Browser decode covers 24 Chrome and 8 Firefox scenarios × 3 profiles; four Chrome native-Brotli scenarios correctly report unsupported. "
      "Four preliminary browser-launch attempts timed out (Firefox updater/startup and a Chrome network-service failure); completed retries are used in the results. "
      "No application build or format implementation tests exist or were added. "
      "[verify_evidence.py](compression/verify_evidence.py) audits saved evidence and source continuity; [verification.json](compression/verification.json) records counts. "
      "Run it after the measurement commands, then run [render_tables.py](compression/render_tables.py) to refresh derived report tables.")
    text=inject(text,'VALIDATION',validation)
    REPORT.write_text(text,encoding='utf-8')
    copy=OUT.parents[2]/'.antiphon/task-5fcf9acc.md'
    copy.write_text(text.replace('(compression/','(../docs/investigations/compression/'),encoding='utf-8')
    print(f'Wrote {REPORT} ({len(text):,} characters) and {copy}')


if __name__=='__main__':main()
