# Markdown Package viewer

Open a local `.mdpkg` through the file picker, drag/drop or paste. The picker has
no `accept` restriction so iOS can select packages typed as `public.data`.
Documents stay on the device. The viewer lists the current view, renders it with
CommonMark 0.31.2 plus a GFM table extension, offers normalized source and section navigation, and resolves
current document/section references against the package's ledger and source.
Reviewers can select text or a section, author comments and change requests,
reply in a thread, set its state, and export a separate v2 delta review package.
On first open, it selects the first `.md` or `.markdown` file (case-insensitive) in
byte order, or the first ordinary file if neither extension is present. Reopening
the same snapshot restores its remembered document and reading position. The
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

### Cross-reference previews (CARD-0044)

Write ordinary inline or reference-style Markdown links, for example
`[retention](reference/storage.md#retention-policy)`. Relative paths start at the
source document's directory, including links inside a preview. A leading `/`
starts at the package root. An empty destination, `#`, or a path without a
fragment selects the whole document. `.md` and `.markdown` links open previews.
Paths retain exact case and Unicode spelling; queries, reserved regions and
traversal above the package root are rejected.

Click, tap, Enter or Space opens a contextual card without navigating or changing
review drafts. On narrow screens the card sits at the bottom. Escape or Close
restores focus to the original phrase; outside pointer/focus dismisses it.
**Open section/document** navigates explicitly, and **Back to reference** restores
the source document, selected scope, scroll and originating link. Links inside
the preview replace the single card. External links remain ordinary links and
have no fetched preview. Source mode stays literal Markdown.

Relative links name current locations; they do not follow renames. Fragments use
lowercased displayed heading text, removing punctuation/emoji and replacing
whitespace with `-`. Repeated bases receive `-1`, `-2`, etc. Lookup is case
sensitive. Collisions such as `Foo`, `Foo`, `Foo-1`, empty slug bases and nested
headings cannot establish a unique canonical section: open the document and use
the section picker. The legacy `mdpkg-section-N` alias remains available.

For a durable link, select its target with the section picker, choose
**Reference to selected section**, edit **Link label**, then **Copy Markdown link**.
**Copy reference** copies just the URI. Both use the ledger's live root and retain
`expect`; a confirmed editorial move can therefore follow to another document.
“Content changed since this link was copied” is advisory for a live target.
Retired or unconfirmed identities never fall back to similarly named headings.
Details preserve the resolver's status/reason and any supplied successor roots.
Copying does not rewrite source or update a link's historical digest. A link
inserted into its own scope can consequently carry a changed-source notice.

Preview reads are local, with a 2 MiB compressed/decoded document cap, enforced
before reading and during decoding. Oversized location-only file links can still
offer **Open document**; identity links require an established live scope before
offering Open. Rich previews use the full document's reference definitions and
canonical section boundaries. A display block crossing a boundary uses labelled
canonical source. Visible content (including image placeholders) is limited to
16,000 UTF-16 units at whole-block boundaries. A separate 65,536-unit HTML budget
checks escaping and markup before allocation/appending, bounding expansion from
repeated reference definitions. Both budgets apply across the entire preview;
an oversized first block uses a labelled bounded source excerpt. Raw HTML
and automatic images stay disabled. Preview tables have independent controls.

Only the active document and one preview target/model are retained. One preview
lookup runs at a time; only the newest pending activation survives. Preview text
can be copied, but reviewing it requires Open section first. The card is outside
the article used for exact source-selection verification. Preview-only actions
read no Git payloads and change no URL history. Cross-package loading, historical
previews, hover activation and optional CLI link linting (Slice D) are deferred.

Automated acceptance uses Chromium, including 390px touch emulation and a 200%
CSS zoom check. Physical iOS and native browser zoom remain manual checks.

### Tables (CARD-0045)

GFM pipe tables render with a header row, left/center/right column alignment,
and inline Markdown (including emphasis, code and links). Escaped pipes work
inside cells and code spans. Missing body cells are empty; extra cells are
ignored. Invalid table delimiters remain ordinary Markdown. Raw HTML and
automatic image requests remain disabled, including inside cells.

The wrap icon in the left margin, level with each table's header row, toggles
**Wrap table text** (CARD-0047). Below 700px it sits above the table on the right,
leaving the reading column at full width. It starts pressed:
cells wrap within equal column widths. Turn it off for content-sized columns
and horizontal scrolling within that table. Both modes contain overflow, even
for many columns or long code. Each table keeps its choice through scrolling,
source/render switching and document navigation until another package is opened
or the tab closes. Preferences are in memory, keyed by document path and table
source position; they are not saved in localStorage or exported in the package.
The button is 32 × 32 px with an invisible 44 × 44 px hit target, an accessible
name and pressed state, and supports Tab, Enter and Space. The default wrapping
state is plain; turning wrapping off gives the button a quiet tint. A shared
ResizeObserver keeps controls centred on their first rows as widths change,
and disconnects when the reader or preview redraws. Without ResizeObserver,
controls align to the table's top edge. The table scroll region is keyboard focusable.
Mobile layout and tap behavior are tested with Chromium emulation.

Tables remain ordinary source within their enclosing document/preamble/section.
The addressing inventory, heading trails and digests still use unextended
CommonMark 0.31.2 as required by spec §6.1–6.2. Display parsing is separate: a
rare Setext-looking table sequence can therefore appear differently in the
section inventory and rendered view. No table/row/cell locator or format change
is introduced. Cell text can be selected for review, including repeated values
in separate cells; click/expand treats a cell as a paragraph boundary. Exact
source verification remains mandatory, with **View source** for transformed or
ambiguous text (such as entities and escaped pipes).

The table-only display parser extends the pinned CommonMark parser's block and
inline hooks; no dependency or bundle budget was added. Its internal hook
assumptions must be checked if CommonMark is upgraded. The parser regression
tests cover the [GFM table rules](https://github.github.com/gfm/#tables-extension-),
block boundaries, nested containers, inline safety and the unchanged inventory.

### Authoring feedback

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

Drafts and authored reviews are saved in this browser as described below.
Closing or replacing a package warns while local feedback is pending or failed.
Download is the handoff to the recipient; the app cannot confirm that a browser
saved the file. Changes invalidate prepared
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
against newer packages, retained Git-history browsing and real
iOS share-sheet/device acceptance remain deferred. Send the delta to a recipient
that retains the original; it contains no ordinary documents. No backend code is
part of this change.

## Browser history and resume (CARD-0046)

**Recently opened** lists up to 20 packages and 20 documents per package. It
remembers successful opens, section selection, actual scrolling, and source/render
mode. Renamed copies of the same declared snapshot share work; a different
namespace or commit gets its own record even when the filename is identical.
Reattachment checks normalized document digests and exact review/draft selectors.
Changed or missing text is retained in recovery with copy/discard controls instead
of being attached to a different target. A draft in another document has a
**Resume draft in …** action; it does not change the last reading destination.
Explicit document/reference navigation takes precedence over a saved destination.

The standard picker, drop and paste work without file-handle support. On reload,
**Choose file again** asks for the package; matching state restores automatically.
No package File/Blob, source document, prepared export or object URL is cached.
Where a secure-context `showOpenFilePicker` is available, **Open package** uses
that unrestricted picker and stores its read-only handle separately. The standard
picker remains available and has no `accept` restriction. Already granted read
access permits automatic reopening. **Allow access** requests read permission
only on a click; reload never prompts. Revoked permission, a moved/deleted file or
unavailable APIs fall back to choosing the file again. Changed handle contents
require an explicit **Open as separate package** action if identity differs.
Picker cancellation and invalid archives leave the current editor/package intact.

Author, kind and exact unfinished body text save after 400 ms of inactivity,
with a 1,500 ms maximum wait while typing. Blur, navigation, hidden visibility and
pagehide also attempt a flush. **Saved in this browser** means the IndexedDB
transaction committed. Only that checkpoint is recoverable after a crash; final
keystrokes or in-flight writes can be lost. **Could not save; keep this tab open**
offers retry, while in-memory reading, authoring and export continue to work.
**Review not exported** is independent of browser saving. Submitted thread/reply
IDs, state and review namespace survive reload; submission and draft deletion
commit together. Cancel deletes the editor draft, including pending writes.

Storage is IndexedDB schema version 1, named `mdpkg-viewer:<deployment base path>`.
It contains package metadata, optional handles, positions, review graphs, drafts,
resume pointers and conflict recovery records. Session storage optionally remembers
each tab's own last document. Draft/review writes compare revisions transactionally;
a stale tab preserves its version in recovery instead of overwriting or resurrecting
work. Deletions advance revisions/package generations. Unknown versions are retained
for recovery; no automatic database reset or unrelated storage clearing occurs.

**Remove from recents** removes history and handle access while retaining authored
work. **Delete saved work** separately confirms deletion of that package's local
drafts/reviews/recovery. Older authored work remains discoverable beyond the recent
list. Quota recovery prunes expendable history/handles and retries once; it never
silently evicts feedback. Unfinished bodies allow at most 256 KiB UTF-8, with an
8 MiB editor-envelope ceiling; oversized selections report a save failure without
truncation. Submitted review limits remain unchanged.

Filenames, names, selected quotes and feedback are private to this browser profile
and origin, with no backend or device sync. Clearing site data or browser eviction
can remove everything; autosave is not a backup. Whole-package caching, original-file
writes, cross-snapshot relocation and browser Back/Forward integration are deferred.
Real IndexedDB/fallback tests run in Chromium, Firefox and WebKit. Permission tests
use injected doubles; native Chrome/Edge/Android grants and real Safari/iOS providers
remain untested. WebKit automation and Chromium touch emulation are not device tests.

## Tests

From `src/web-viewer/`:

```powershell
npm test
npx playwright install chromium firefox webkit
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
Persistence/fallback cases run in all three browser projects; existing authoring
and single-output export cases remain Chromium-only. Run only the new cases with
`npx playwright test persistence.spec.js`.

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

Browser persistence is an isolated capability chunk requested at startup; a failed
load leaves in-memory reading/authoring available. Its transfer cost is reported
separately in `build-report.json`'s chunk list and is not part of the existing V-2
static-plus-Git closure. The gate and its 133,145-byte ceiling are unchanged.

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
  limits, not format limits. The active document, one preview target and one ledger are cached;
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

Current references without `expect` select `loc` with navigation-only semantics (rendered
links preview it; the addressing form navigates). They do not
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
