# CARD-0044 review fixes: preview output budgets and legacy alias deduplication

Both findings from review task aedf139a against 35b8ad6 are fixed.

## P1: bound expanded output before allocation

The preview-only renderer checks XML-escaped length before calling the existing
escaper, checks literal output before appending, and checks complete tag size
before the pinned CommonMark renderer writes directly to its buffer. Traversal
stops as soon as a budget is exceeded. It does not first render an oversized
block and then inspect its length.

Two cumulative output budgets apply across the scope's blocks:

- 65,536 UTF-16 units of HTML, including attributes and escaped output.
- 16,000 UTF-16 units of text, including image placeholders and emitted whitespace.

The existing source/read budgets remain in place. Only complete blocks are kept.
If the first block exceeds a budget, the existing bounded source fallback is
explicitly marked as an excerpt even when its source itself is short. The main
renderer, addressing/ledger resolution, read queue, preview lifecycle and review
selection/export code are unchanged.

The review reproduction with a 20,749-unit document and repeated references to a
20,000-character destination now returns 41 HTML units (the heading) with
`excerpt: true`; its overflowing paragraph is excluded. The 12,000-unit image
source returns a labelled canonical source excerpt of 12,001 units, rather than
18,000 units of expanded placeholder text.

## P2: count distinct heading candidates

The fragment multimap registers each heading object only once per fragment.
`# mdpkg-section-2` now has one candidate and resolves in both preview lookup and
main-reader fragment navigation. A slug colliding with a different heading's
legacy alias still has two candidates and remains ambiguous.

## Validation

Ten new Node regressions cover repeated external reference definitions, oversized
attributes, XML-escaped titles from short source, early traversal termination,
HTML and visible-text budgets across blocks, image placeholders, both alias
collision cases, and byte-for-byte preservation of within-budget safe rendering.
Two browser regressions verify excerpt notices/Open actions and alias navigation.

| Command | Result |
| --- | --- |
| `npm test` from `src/web-viewer` | 111 passed, 0 failed |
| `npm run test:browser` from `src/web-viewer` | 43 passed, 0 failed |
| `python tests/validate-export.py test-results/browser-review.mdpkg` from `src/web-viewer` | 25 checks passed, 0 failed |
| `dotnet test -c Release` from `src/generator-cli` | 1,105 passed, 0 failed |

V-1, V-2 and D-1 build gates pass. Eager gzip is 129,459 bytes, up 356 bytes from
129,103; the ceiling remains 133,145 bytes. No dependency was added.

Implementation files: `src/web-viewer/src/ui/preview-renderer.js`,
`src/web-viewer/src/ui/markdown-surface.js`, and
`src/web-viewer/src/links/display.js`. Regression files:
`src/web-viewer/tests/preview-budget.test.mjs` and
`src/web-viewer/tests/preview.spec.js`. The viewer README documents both budgets.

The shared checkout already contained untracked `docs/design/` files and
`docs/investigations/2026-09-11-card-0044-cross-reference-preview-review.md`.
They were left untouched; tracked changes for this fix are committed separately.
