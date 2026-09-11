# CARD-0044: cross-reference preview implementation (Slices A–C)

Implemented against the approved [plan](2026-09-11-card-0044-cross-reference-preview.md).
Slice D (optional CLI author link linting) remains deferred. No package format,
addressing profile, spec text, source-rewriting pass or new dependency was added.

## Delivered behavior

- Browser addressing now refuses an absent default root when another live root
  owns its locator (`unconfirmed / reserved-slot`). Reader's new
  `PackageSnapshot.ResolveReference` parses strict v2 loose URIs and shares the
  existing ledger/scope routine with review resolution. Loose references with
  `expect` remain unconfirmed under partial coverage, including `at=current`.
  The existing review API still permits its established current-observation case.
- `src/web-viewer/src/links/` owns destination normalization, display fragment
  multimaps and the navigation/identity/capability/resource adapter. Relative
  destinations never acquire a root or historical identity verdict. Fragment
  lookup preserves exact case and source-directory context; collisions and
  noncanonical headings require a section choice. Canonical inventory remains
  unextended CommonMark.
- The section-reference flow now offers an editable displayed title, Copy
  Markdown link and Copy reference. Labels are escaped; generated URIs retain
  `expect` and use the live ledger root. Clipboard failure exposes copyable text.
- The single disclosure card is outside the source-selection article. It renders
  blocks from the full target display parse, retaining reference definitions;
  canonical/display boundary disagreement uses labelled source. Nested links
  replace the card using the previewed document's path, retaining the main origin.
  Open/Back restores document, selected scope, scroll and focus. Preview actions
  preserve review drafts and add no URL history or Git reads.
- Per-document compressed and decoded preview reads are capped at 2 MiB,
  including resolver-triggered reads and deceptive DEFLATE sizes. Rich/source
  excerpts are bounded to 16,000 UTF-16 units without splitting surrogate pairs.
  Only Markdown targets preview. One in-flight lookup and the newest pending
  request bound obsolete work; the document cache retains one preview target.
  Oversized identity lookups never offer Open for an unestablished scope.
- Source-selection regression fixes ensure an unrelated old selection does not
  block a link activation and section navigation clears its old selection toolbar.
  Selecting preview text cannot reuse the main document's cached review anchor.

## Executable evidence

Shared contract: `docs/spec/link-fixtures.json`, with 41 loose URI cases and
21 relative destination cases. Regenerate using
`node src/web-viewer/tests/generate-links.mjs`; Node and .NET consume the same URI
expectations. Cases cover body/heading/ancestor/file/cross-file moves and move-back,
retirement, reserved births, partial coverage, locator-only references, malformed
syntax and locators, foreign lineage, current/historical targets and noncurrent
reference kinds. Relative fixtures additionally cover encoded Unicode/spaces,
traversal, separators, reserved paths and query rejection.

From `src/web-viewer/`:

```powershell
npm ci
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

Node: **101 tests**. Chromium: **41 tests**, including 14 preview integration
checks, existing review export, table rendering and selection regressions.
Independent ZIP/Git export verification: **25 checks**. Final failures: **0**.
Screenshots and the reproducible heap sample are written under
`src/web-viewer/test-results/`; these generated artifacts are not committed.

From `src/generator-cli/`:

```powershell
dotnet test -c Release
dotnet pack src/Mdpkg.Reader --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Core --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Reviews --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Cli --no-build -c Release -o artifacts/release
python tests/verify-consumers.py --local-feed artifacts/release
python tests/prove-libraries.py --local-feed artifacts/release
python tests/prove-tool.py --local-feed artifacts/release
python tests/inspect-release.py artifacts/release --commit (git rev-parse HEAD)
```

.NET: **1,105 tests**, zero failures. Package gates inspect four manifests and Core
symbols; consumer verification exercises three isolated PackageReference consumers,
both Core README examples and installed-tool pack/deep validation. The Reader
consumer also compiles and invokes the new loose-reference API without Git.
Library proof adds two isolated consumers; global tool proof checks installation,
version/help, package creation, contents and deep validation. All pass.
These are local package/consumer gates; no NuGet publication was performed by this task.

## Bundle and resource measurements

Same checkout/toolchain baseline before implementation: **124,848 eager gzip bytes**.
Final: **129,103 bytes**, **+4,255**; ceiling unchanged at **133,145 bytes**
(4,042 bytes remaining). V-1 dependency/calibration, V-2 budget and D-1
asset-path gates pass. The Git-read calibration remains 53,773 gzip bytes; there
is no new preview library or eager Git import.

Chromium retained JS heap, after explicit GC, alternating six previews between
two 1,048,576-byte documents (not a portable memory budget):

| State | JS heap bytes |
| --- | ---: |
| Main reader baseline | 2,269,052 |
| Active samples | 4,448,340, 4,483,992, 4,540,844, 4,566,716, 4,595,020, 4,476,836 |
| After Close | 2,376,296 |

The source excerpt stays at 16,000 units. Tests also assert one concurrent lookup,
newest-pending replacement, same-target document promise reuse, metadata rejection
before payload reads, bounded dishonest inflation, and zero Git payload reads.

## Review handoff and remaining manual checks

Review the adapter/result categories, Reader public API and preview lifecycle.
The visible card can occlude adjacent text; keyboard activation or dismissal still
reaches the next link. Test layouts cover 1280px, 640px, 390px, touch emulation and
200% CSS zoom, with viewport-bounded tables and source excerpts. Physical iOS,
actual native browser zoom and assistive-technology testing were not performed.
No claim of physical-device acceptance is made.

The public API is additive and the packaged external consumers pass. This task
has not introduced the broader public-API analyzer baseline project described in
the release guidance; that repository-wide analyzer decision still needs its own
review. Reader's snapshot API continues to load the bounded current Markdown
view rather than claiming the browser's one-target read cost.

Slice D remains a separate future card. Cross-package loading, historical preview,
hover activation, automatic binding/source rewriting and successor-root guessing
remain deferred. Concurrent untracked `docs/design/` artifacts were left untouched.
