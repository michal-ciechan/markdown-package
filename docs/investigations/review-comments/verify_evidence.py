"""Re-checks every headline claim of docs/investigations/review-comments.md against the
stored result files, and fails loudly on any internal inconsistency.

    python docs/investigations/review-comments/verify_evidence.py
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
A = json.loads((HERE / 'anchor-results.json').read_text())
R = json.loads((HERE / 'return-results.json').read_text())
T = json.loads((HERE / 'roundtrip-results.json').read_text())
checks, failures = 0, []


def check(label, condition, detail=''):
    global checks
    checks += 1
    if not condition:
        failures.append(f'{label}: {detail}')


# --- anchor probe ---------------------------------------------------------
worst_quote, worst_offset, worst_line = 0.0, 0.0, 0.0
gone_total, gone_quiet = 0, 0
for c in A['corpora']:
    for k in A['distances']:
        s = c['byDistance'][str(k)]
        n = s['gtSurvives'] + s['gtDetached']       # anchors scored; movedOutOfSection is excluded
        check('anchor totals', s['anchors'] == n + s['movedOutOfSection'],
              f"{c['corpus']} k={k}: {s['anchors']} != {n}+{s['movedOutOfSection']}")
        for name, b in s['selectors'].items():
            check('bucket totals', sum(b.values()) == n, f"{c['corpus']} k={k} {name}")
            check('survivors accounted', b['hit'] + b['misplaced'] + b['falseDetach'] == s['gtSurvives'],
                  f"{c['corpus']} k={k} {name}")
            check('detached accounted', b['correctDetach'] + b['phantom'] == s['gtDetached'],
                  f"{c['corpus']} k={k} {name}")
            rate = 100 * (b['misplaced'] + b['phantom']) / n
            if name == 'quoteExact':
                worst_quote = max(worst_quote, rate)
            if name == 'charOffset':
                worst_offset = max(worst_offset, rate)
            if name == 'lineOrdinal':
                worst_line = max(worst_line, rate)
        d = s['digest']
        check('digest strata', d['targetIntactSectionDigestChanged'] + d['targetIntactSectionDigestSame']
              == s['gtSurvives'], f"{c['corpus']} k={k}")
        gone_total += s['gtDetached']
        gone_quiet += d['targetGoneSectionDigestSame']

check('quote selector stays under 0.2% silently wrong', worst_quote < 0.2, f'{worst_quote:.2f}%')
check('char offset exceeds 20% silently wrong somewhere', worst_offset > 20, f'{worst_offset:.2f}%')
check('line ordinal exceeds 30% silently wrong somewhere', worst_line > 30, f'{worst_line:.2f}%')
check('section digest never misses a destroyed target', gone_quiet == 0, f'{gone_quiet} of {gone_total}')

# --- return probe ---------------------------------------------------------
for c in R['corpora']:
    for k, s in c['byDistance'].items():
        total = (s['documentGone'] + s['sectionRootMissing'] + s['sectionSurvives']
                 + s['sectionFlaggedChanged'])
        check('return totals', total == c['threads'], f"{c['corpus']} k={k}: {total} != {c['threads']}")
        check('stored offsets exact whenever the section digest is equal',
              s['inSurvivingSectionAnchorExact'] == s['sectionSurvives'] and
              s['inSurvivingSectionAnchorMoved'] == 0, f"{c['corpus']} k={k}")
        d = s['changed']
        check('flagged-section outcomes accounted',
              d['quoteRelocatedCorrect'] + d['quoteRelocatedWrong'] + d['quoteDetachedCorrect']
              + d['quoteDetachedFalse'] == s['sectionFlaggedChanged'], f"{c['corpus']} k={k}")
        check('quote beats offset inside changed sections',
              d['quoteRelocatedCorrect'] + d['quoteDetachedCorrect'] >= d['offsetCorrect'],
              f"{c['corpus']} k={k}")

# --- round trip -----------------------------------------------------------
i = T['identity']
check('two production runs of identical inputs are byte-identical',
      i['twoRunsSameInputs']['currentEqual'] and i['twoRunsSameInputs']['bytesEqual'])
check('same tip tree, different retained history, different current',
      i['sameTipTruncatedHistory']['tipTreeEqual'] and not i['sameTipTruncatedHistory']['currentEqual'])
check('a re-emission at another DEFLATE level keeps current and changes the file hash',
      i['reemittedLevel9Npm']['bytesEqual'] is False and i['reemittedLevel9Npm']['currentEqual'])
check('identical content committed one second apart gets a different current',
      i['sameContentOneSecondApart']['tipTreeEqual'] and
      not i['sameContentOneSecondApart']['currentEqual'])

for corpus in ('fixture', 'npm'):
    d = T[corpus]
    overheads = []
    for r in d['rows']:
        check('delta-only is smaller than delta plus original',
              r['deltaOnlyBytes'] < r['mergedBytes'], f"{corpus} {r['threads']}")
        overheads.append(r['deltaOnlyBytes'] - (r['mergedBytes'] - d['originalBytes']))
    check('standalone review-package overhead is flat in thread count',
          max(overheads) - min(overheads) < 32, f'{corpus}: {overheads}')

print(f'{checks} checks, {len(failures)} failures')
for f in failures:
    print('  FAIL', f)
sys.exit(1 if failures else 0)
