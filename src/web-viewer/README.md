# Markdown Package viewer

Open a local `.mdpkg` through the file picker, drag/drop or paste. The picker has
no `accept` restriction so iOS can select packages typed as `public.data`.
Documents stay on the device. The viewer lists the current view, renders it with
CommonMark 0.31.2, offers normalized source and section navigation, and resolves
current document/section references against the package's ledger and source.
Reviewers can select text or a section, author comments and change requests,
reply in a thread, set its state, and export a separate v2 delta review package.
On open, it selects the first `.md` or `.markdown` file (case-insensitive) in
byte order, or the first ordinary file if neither extension is present. The
document list keeps its existing order and includes all ordinary files.

From `C:\src\markdown-package\src\web-viewer`:

```powershell
npm ci
npm run build
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/`. Production serving needs HTTPS for Web Crypto and
clipboard access. The build emits JS, CSS, the optional inflater chunk,
`build-report.json`, and a copy of `index.html` whose asset paths lose their
`./dist/` prefix. `dist/` is therefore a complete deployable root on its own,
while serving `src/web-viewer/` still works for development. Nothing is fetched from an
origin the page did not come from, and every asset path stays relative so the
app works under a `/<repo>/` subpath; gate D-1 fails the build if a published
path turns absolute or keeps pointing into `dist/`.

## Review authoring and export (CARD-0038)

1. Open the original package and select text in the rendered reader. Choose
   **Review selected text**, or use the section menu and **Review selected section**.
2. Check the exact source quote shown above the editor. Enter your name, choose
   **Comment** or **Change request**, and save the feedback. A change request is prose,
   not an executable patch. Replies each have their own kind; thread state is
   open/resolved/obsolete and does not claim an edit was applied.
3. **Prepare review file** builds and structurally validates a snapshot. Then
   **Download review** saves `<original>-review.mdpkg`. **Share review** appears when
   file sharing is supported; cancelling or failing share retains the download.
   Preparation is separate so the share gesture keeps browser user activation.

### Click selection (CARD-0040)

Click or tap a word in the rendered document to select the entire word, including
words split across inline formatting. A floating toolbar offers **Expand selection**
(＋), **Collapse selection** (−), and **Leave comment**, with at least 44 × 44 px
button targets. Expand snaps outward through word, sentence, paragraph and the
containing outline section, including its child sections. Identical boundaries
are skipped. Collapse restores each visited range exactly, including a manual
range; adjusting the selection starts a new history. The section menu remains
independent of this text selection.
Touch interaction has been tested only with Chromium emulation; physical devices
remain untested.

Sentence boundaries use punctuation and whitespace, preserving closing quotes
and common abbreviations such as `e.g.` and `Dr.`. Paragraph boundaries follow
rendered blocks, including list items, blockquotes and code blocks. These are
prose heuristics; manual forward/backward dragging, double-click selection,
**Review selected text**, and **Review selected section** remain available.
Links retain their normal navigation behavior. In **View source**, select text
manually and use **Leave comment** or **Review selected text**; automatic expansion
is available only in rendered mode.

**Leave comment** opens the existing review editor with the exact source quote
from the existing anchor checks. Ambiguous/transformed selections still request
**View source**. The toolbar follows the visible selection on scroll/resize and
hides when selection clears, navigation changes the view, or focus moves to the
comment editor. Tab reaches its buttons, Left/Right arrows move between enabled
buttons, Enter/Space activate them, and Escape dismisses the toolbar.

Selection uses UTF-16 offsets, exact canonical source, occurrence and up to 40
units of context without splitting surrogate pairs. Rendered endpoints use
CommonMark block positions and a unique complete text-node match, then re-render
perturbed source to verify the exact DOM position. Ambiguous or transformed
endpoints explicitly require **View source**; they are never guessed. Source mode
supports exact selection of Markdown syntax, entities and repeated text. A range
across child sections anchors to their deepest common containing scope, shown in
the editor, without clamping. Empty canonical scopes cannot receive a selector.
Rendering verification reparses the document twice per captured selection;
large-document selection performance has not been measured on phones.

Drafts live in memory in this tab. Opening another package or closing the tab
warns about feedback not yet downloaded/shared. Download is the durable handoff;
the app cannot confirm that a browser saved the file. Changes invalidate prepared
files, including changes made while preparation is in flight. Thread/comment IDs
and the review namespace persist across this tab's exports; each export is a new
parentless, one-commit snapshot. The original Blob is read-only. Optional dispatch
and original-file digest/length metadata are not emitted; correlation uses the
required original namespace/current pair.

The writer emits canonical v2 `.mdpkg/review/comments.json` in a **delta** return:
fresh namespace, review-only tracked tree, its own manifest/history and one Git
pack/index. Native raw DEFLATE is used when available; ZIP entries fall back to
STORE otherwise. Self-validation reopens the ZIP, reads every payload for CRCs,
checks review identity, entries, history/refs, schema, reply graph and each
anchor/selector against the original source. It makes no deep Git verification
claim. Limits are 5,000 threads, 20,000 comments, 64 KiB UTF-8 per body and 8 MiB
comments JSON, with explicit rejection and no truncation. The writer's timestamp
validator accepts its generated UTC millisecond RFC 3339 subset.

Bundled returns, v1 export, imported-review display/editing, quote relocation
against newer packages, retained-history browsing, durable draft storage and real
iOS share-sheet/device acceptance remain deferred. Send the delta to a recipient
that retains the original; it contains no ordinary documents. No backend code is
part of this change.

## Tests

From `src/web-viewer/`:

```powershell
npm test
npx playwright install chromium
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

The Node suite covers word/sentence boundaries, Unicode/source selectors, v2 validation,
ledger roots, writer round trips, corruption and compression fallback. Playwright exercises
actual DOM selections and the author/reply/state/download flow, unsafe-body
rendering, share cancellation, unsaved navigation and stale-export protection,
plus click/tap selection, exact expansion/collapse, manual selection, source
fallback, toolbar lifecycle, keyboard controls and mobile viewport positioning.
Mobile viewport and touch coverage uses Chromium emulation only; physical devices
remain untested.
The Python acceptance test uses independent ZIP and native Git checks. Pages CI
runs these tests before publishing. The browser fixture and .NET rerun commands
are in [tests/fixtures/README.md](tests/fixtures/README.md).

## Deployment

`.github/workflows/pages.yml` runs `npm ci` and `npm run build` on every push
touching `src/web-viewer/**` (or the `docs/investigations/viewer-app/` evidence that V-1
pins against) and publishes `src/web-viewer/dist/` to GitHub Pages at
<https://michal-ciechan.github.io/markdown-package/>. A failed gate withholds
the assets, so a red build cannot deploy.

Pages must be enabled once by hand: Settings -> Pages -> Source -> "GitHub
Actions". The workflow token cannot do it -- `actions/configure-pages` with
`enablement: true` was tried and the API answered "Resource not accessible by
integration". Until that setting is made, the build job still runs as the
check and only the deploy job fails.

Every build first cleans `src/web-viewer/dist/` and checks the five dependency pins against
`docs/investigations/viewer-app/package.json`, including installed versions. V-1
also rebuilds the isolated Git reader using the investigation's ESM exports and
Buffer shim, comparing its raw size, gzip size and SHA-256 with
`bundle-results.json`. This calibration bundle is not published in `dist/`.

V-2 defaults to **Review**, the CARD-0038 branch of the milestone plan. Its
48,014-byte CommonMark plus 52,363-byte Git writer library baselines and 32 KiB
app allowance give a **133,145-byte gzip ceiling**. The gate conservatively counts
the writer's complete graph, although Git is only loaded on preparation. The
older milestone app allowances are fixed per
milestone at 12/16/24/32/40/48 KiB for M1–M6, with their library baselines, total
ceilings and rationale in [plan §4](../../docs/superpowers/plans/2026-09-09-card-0018-viewer-app-build-plan.md#4-milestones).
The gate counts shared static chunks and CSS toward the total; Git, when shipped,
also counts through its dynamic import. The
graph rejects Git in the initial static closure and requires exactly one dynamic
Git import site in that closure. M3+ additionally requires the history descriptor
and Git reader components, which are not yet shipped. Select a later milestone explicitly
with `npm run build -- --milestone=M3` when implementing it; the ceiling does not
grow automatically with the bundle. Changing an allowance requires amending
plan §4 and `APP_BUDGETS` together with measured costs and the tradeoff; a gate
failure alone does not justify a raise.

`node src/web-viewer/build.mjs --report` from the repository root prints the full JSON report;
all invocations save it as `src/web-viewer/dist/build-report.json`. A version, calibration,
budget or graph failure exits nonzero and leaves the diagnostic report without
deployable assets. Redirected `dist/` directories are rejected before deletion.

## Reader contract

- `src/container/source.js` provides Blob and byte sources with exact standalone
  buffers and bounds checks. `src/container/reader.js` also accepts a source
  exposing `{size, read(offset, length)}` for future range access.
- `typePackage` reads at most 79 bytes. `openContainer` proceeds to the EOCD and
  authoritative central directory and can recover a reordered/recompressed
  archive whose canonical manifest payload is intact. It never scans payloads
  to guess the format version.
- ZIP64 sentinels/extra fields/locators, multi-disk or encrypted entries,
  unsupported methods, malformed extents, path traversal, ambiguous names,
  reserved-region collisions, and symlinks/special files are rejected.
- Reads use central-directory sizes, methods and CRCs. Each requested DEFLATE
  member gets a fresh decoder, a decoded-size ceiling and CRC verification.
  Native raw DEFLATE is preferred; only the fallback imports fflate's inflater.
  Both decoders accept trailing bytes after a complete DEFLATE stream within
  the declared compressed size; the fallback still requires a final block and
  no active Huffman block. Decoding failures identify the affected entry.
- `tier` describes the section 3.7 **typing** tier. `issues` separately reports
  detected nonconformance, including nonzero internal attributes on every
  central-directory entry (D-19), comments and pack layout. Findings remain
  visible while the package is browsed; a typing pass is not a validator pass.
- Default per-entry decoded/compressed ceilings are 64 MiB, with a 16 MiB central
  directory ceiling and 1 MiB manifest ceiling. Override through
  `openPackage(blob, {limits: {...}})` when integrating. These are viewer resource
  limits, not format limits. The active document and one ledger are cached;
  opening further documents does not retain their predecessors.
- Name uniqueness uses host-engine NFC (`String.prototype.normalize`), followed
  by Unicode 17.0.0 **simple** case folding (C + S mappings, no full or Turkic
  folding), as pinned by spec D-16. Only the fold table is pinned; NFC follows
  the Unicode version supplied by the JavaScript engine. The checked-in table
  is generated by `node scripts/generate-case-fold.mjs` from the
  [Unicode data](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt), with
  its license in `UNICODE-LICENSE.txt`; it is never downloaded at runtime.

The reader does not validate the Git tree against the current-view payloads,
walk retained history, or scan every stored payload for LF-only conformance.
Strict UTF-8 decoding preserves the BOM and digest canonicalization defensively
normalizes CRLF/CR as required by section 6.1. Raw HTML and automatic image
fetches are disabled in the reading view. Ordinary external links open only on
user action; package-relative links stay in the reader.

## Addressing scope and handoff

`src/address/` implements the section 6.1–6.5 current-view path: top-level ATX
and Setext headings, exact occurrence-counted trails, permanent preambles,
scoped digests, default roots, direct ledger overrides, retirement records and
unknown correspondence. Generated references use the live root from the ledger,
including reserved-slot births. A resolved reference with `expect` displays its status,
current digest and target section; similarity and quote search never establish
identity. A malformed ledger invalidates resolution instead of falling back to
the default root. Section source positions now support the review selection
mapping described above.

Current references without `expect` navigate directly to `loc`. They do not
consult coverage or the override ledger, verify the root, or compute/compare a
scoped digest. The UI reports navigation only, with no reviewed-state verdict;
a missing document or section produces a navigation error. Namespace, profile,
locator and snapshot validation still apply, and a present but empty or malformed
`expect` is rejected.

CARD-0021 shipped browse and current addressing; retained Git history remains deferred.
Historical `at=` (except `at=current`), commit, diff and hunk references are
parsed and validated but return the application capability result
`unsupported / history-reader-required`; this is deliberately distinct from
the spec's `invalidated / history-unavailable`, which requires checking shipped
history. No historical reference falls forward to the current view.

Loose references with `expect` to packages with partial correspondence coverage return
`unconfirmed / incomplete-correspondence`. A later history integration must
establish coverage for a supplied `observedAt` before upgrading that answer;
this slice conservatively returns unconfirmed even when an `observedAt` is
supplied. Touched queries, eager history loading and imported-review thread
display remain in their later slices. Authored threads and selectors are available
in the Review panel; resolution against newer snapshots remains deferred.
