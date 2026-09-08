"""Prints every table and percentage the review-comments investigation quotes."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
A = json.loads((HERE / 'anchor-results.json').read_text())
R = json.loads((HERE / 'return-results.json').read_text())
T = json.loads((HERE / 'roundtrip-results.json').read_text())

pct = lambda a, b: f'{100 * a / b:.2f}%' if b else '-'

print('== selector outcomes, by corpus and distance (anchor placed at revision i, read at i+k) ==')
print('| corpus | k | anchors | selector | resolved to the right place | silently wrong | refused |')
print('| --- | --- | --- | --- | --- | --- | --- |')
for c in A['corpora']:
    for k in A['distances']:
        s = c['byDistance'][str(k)]
        n = s['gtSurvives'] + s['gtDetached']
        for name, b in s['selectors'].items():
            right = b['hit'] + b['correctDetach']
            wrong = b['misplaced'] + b['phantom']
            print(f"| {c['corpus']} | {k} | {n} | {name} | {right} ({pct(right, n)}) | "
                  f"{wrong} ({pct(wrong, n)}) | {b['falseDetach']} ({pct(b['falseDetach'], n)}) |")

print()
print('== how often a byte-intact anchor target sits in a section whose digest changed ==')
print('| corpus | k | anchors whose target survived | section digest also changed | share |')
print('| --- | --- | --- | --- | --- |')
tot_gone, tot_gone_quiet = 0, 0
for c in A['corpora']:
    for k in A['distances']:
        s = c['byDistance'][str(k)]
        d = s['digest']
        live = d['targetIntactSectionDigestChanged'] + d['targetIntactSectionDigestSame']
        print(f"| {c['corpus']} | {k} | {live} | {d['targetIntactSectionDigestChanged']} | "
              f"{pct(d['targetIntactSectionDigestChanged'], live)} |")
        tot_gone += s['gtDetached']
        tot_gone_quiet += d['targetGoneSectionDigestSame']
print(f'destroyed anchor targets whose section digest did NOT change: {tot_gone_quiet} of {tot_gone}')

print()
print('== default roots lost to a changed heading trail, in changed documents (no ledger) ==')
print('| corpus | k | sections matched by trail | sections whose trail changed |')
print('| --- | --- | --- | --- |')
for c in A['corpora']:
    for k in A['distances']:
        s = c['byDistance'][str(k)]
        print(f"| {c['corpus']} | {k} | {s['sectionsChecked']} | {s['sectionsLostByTrail']} |")

print()
print('== the return trip: threads minted at snapshot 0, read at snapshot k ==')
print('| corpus | k | threads | survives | flagged-changed | root missing | document gone |')
print('| --- | --- | --- | --- | --- | --- | --- |')
for c in R['corpora']:
    for k, s in c['byDistance'].items():
        print(f"| {c['corpus']} | {k} | {c['threads']} | {s['sectionSurvives']} "
              f"({pct(s['sectionSurvives'], c['threads'])}) | {s['sectionFlaggedChanged']} | "
              f"{s['sectionRootMissing']} | {s['documentGone']} |")

print()
print('== inside a flagged-changed section: what the sub-section selector does ==')
print('| corpus | k | flagged sections | quote right | quote wrong | quote refused | offset right | offset wrong |')
print('| --- | --- | --- | --- | --- | --- | --- | --- |')
for c in R['corpora']:
    for k, s in c['byDistance'].items():
        d = s['changed']
        if not s['sectionFlaggedChanged']:
            continue
        print(f"| {c['corpus']} | {k} | {s['sectionFlaggedChanged']} | "
              f"{d['quoteRelocatedCorrect'] + d['quoteDetachedCorrect']} | "
              f"{d['quoteRelocatedWrong']} | {d['quoteDetachedFalse']} | {d['offsetCorrect']} | "
              f"{d['offsetWrong'] + d['offsetOutOfRange']} |")

print()
print('== when a stored offset is safe to trust without re-anchoring ==')
for c in R['corpora']:
    for k, s in c['byDistance'].items():
        print(f"{c['corpus']} k={k}: sections resolving survives {s['sectionSurvives']}, "
              f"stored offsets still exact {s['inSurvivingSectionAnchorExact']}, moved "
              f"{s['inSurvivingSectionAnchorMoved']}")

print()
print('== package identity ==')
for k, v in T['identity'].items():
    print(k, json.dumps(v))

print()
print('== review package size ==')
for corpus in ('fixture', 'npm'):
    d = T[corpus]
    print(f"-- {corpus}: {d['documents']} documents, original package {d['originalBytes']} bytes")
    print('| threads | comments | review JSON | anchors | identity | comment text | delta-only pkg | delta+original pkg |')
    print('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for r in d['rows']:
        print(f"| {r['threads']} | {r['comments']} | {r['reviewJsonBytes']} | {r['anchorBytes']} | "
              f"{r['identityBytes']} | {r['commentTextBytes']} | {r['deltaOnlyBytes']} "
              f"({r['deltaOverOriginalPct']}% of original) | {r['mergedBytes']} "
              f"({r['mergedOverOriginalPct']}%) |")
