# CARD-0044 review of 35b8ad6

Outcome: two confirmed defects; return to implementation before closing CARD-0044.
No application code changed. Temporary browser test was removed after execution.

## Findings

### P1 — Preview budgeting occurs before potentially large renderer expansion

`src/web-viewer/src/ui/markdown-surface.js:70-72` counts the source lines of each
block, then renders it without a rendered-output limit. Full-document reference
definitions can be outside the selected scope and are not charged to this budget.

Executed examples:

- A 12,000-unit document consisting of `![](x)` repeated 2,000 times produces
  18,000 visible text units (`[Image: ]` placeholders), with `excerpt: false`.
- A 20,749-unit document with 100 `[x][r]` references in a 711-unit section and a
  20,000-character URL definition outside that section produces **2,003,775 units
  of HTML**, with `excerpt: false`. This is well below the 2 MiB read threshold.

Increasing the URL and reference count within the existing input limits can
multiply output into gigabytes. The browser must build that output string and
parse it into a DOM; the one-read queue and input caps do not bound this work.
The large-scale crash was not attempted. Fix with a budget that bounds rendering
work/output before allocating expanded markup, in addition to the visible-content
cap. Fall back to a bounded labelled source excerpt when necessary. Merely checking
HTML length after rendering does not prevent the large intermediate allocation.

### P2 — A unique heading can collide with its own legacy alias

`src/web-viewer/src/links/display.js:22,35,43` appends a heading for its generated
slug and again for its legacy alias, then treats the array length as the number
of distinct candidates.

For a document containing only `# mdpkg-section-2`, the first section has index 2.
Both registrations use `mdpkg-section-2`, yielding two references to the *same*
heading. `fragmentScope(model, 'mdpkg-section-2')` returns `choose-section` instead
of the sole section. The main reader also drops the fragment because its candidate
count is two. Deduplicate candidates by heading identity while retaining ambiguity
for collisions involving distinct headings; test both cases.

## Reproduction

Run from `src/web-viewer` using Node in module mode (save the following as a
temporary `.mjs` in that directory and run `node <file>.mjs`):

```js
import {outline} from './src/address/outline.js';
import {previewMarkup} from './src/ui/markdown-surface.js';
import {fragmentScope, displayFor} from './src/links/display.js';
const model = text => outline(new TextEncoder().encode(text), 'a.md');
const images = model('![](x)'.repeat(2000));
const imagePreview = previewMarkup(images, images.scopes[0]);
console.log({visibleUnits: imagePreview.html.replace(/<[^>]*>/g, '').trim().length,
  excerpt: imagePreview.excerpt}); // 18000, false
const text = '# Target\n\n' + '[x][r] '.repeat(100) +
  '\n\n# Outside\n\n[r]: https://example.com/' + 'a'.repeat(20000) + '\n';
const expanded = model(text);
const preview = previewMarkup(expanded, expanded.scopes[2]);
console.log({documentUnits: text.length,
  scopeUnits: expanded.source(expanded.scopes[2]).length,
  htmlUnits: preview.html.length, excerpt: preview.excerpt});
// 20749, 711, 2003775, false
const alias = model('# mdpkg-section-2\n');
console.log(fragmentScope(alias, 'mdpkg-section-2'),
  displayFor(alias).fragments.get('mdpkg-section-2').length);
// { reason: 'choose-section' }, 2
```

## Confirmed working and validation

- Both required addressing changes exist and pass the same 41 loose-URI fixtures
  in Node and Reader: conservative partial coverage including `at=current`, and
  reserved-slot protection. The existing Reader review API retains its established
  current-observation behavior.
- Executed destination fixtures reject traversal, encoded traversal/separators,
  reserved paths, backslashes, controls, protocol-relative paths, malformed escapes
  and relative queries. Ordinary multi-heading slug collisions remain ambiguous.
- The preview is outside the main selection article and uses the factored surface,
  not a second reader. Browser checks verify exact main selection, hidden preview
  selection toolbar, draft continuity, separate IDs, safe tables/images/HTML,
  nested context, Open/Back, disclosure keys and focus restoration.
- An additional temporary browser check selected main text, opened a preview,
  selected preview text and clicked the real **Review selected text** button.
  No review quote/editor became visible; the suspected stale-selection path did
  not reproduce. That check passed and its temporary test file was removed.
- Metadata/actual decoded read caps, same-target read reuse, one active lookup,
  newest-pending replacement, stale dismissal/package/source invalidation and zero
  current-preview Git reads passed. These do not cover the renderer expansion above.
- README accurately distinguishes relative current locations from ledger-backed
  durable URIs, and documents deferred lint/history/cross-package work. Its content
  limit guarantee needs the P1 fix. Both README and implementation report explicitly
  distinguish Chromium touch/CSS zoom from physical iOS and native browser zoom.

Rerun results:

| Command | Result |
| --- | --- |
| `npm test` | 101 passed, 0 failed |
| `npm run test:browser` | 41 passed, 0 failed |
| `dotnet test -c Release` from `src/generator-cli` | 1,105 passed, 0 failed |
| Additional real-button selection browser probe | 1 passed, 0 failed |
| Export browser test rerun to regenerate its output | 1 passed, 0 failed |
| `python tests/validate-export.py test-results/browser-review.mdpkg` | 25 checks passed, 0 failed |

The initial export verification attempt after the isolated browser probe found
the export file absent because Playwright cleared its output directory. Rerunning
the export-producing browser test restored it; independent validation then passed.
Build V-1/V-2/D-1 gates pass; eager gzip remains 129,103 / 133,145 bytes.
Package/consumer gates were inspected in the implementation evidence but were not
rerun in this review. No physical iOS, native zoom or assistive-technology testing
was performed. Existing untracked `docs/design/` files were left untouched.
