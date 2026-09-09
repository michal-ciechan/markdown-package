# Build plan: the web-first `.mdpkg` viewer and reviewer

Card 0018. Written 2026-09-09 against
[docs/investigations/viewer-app.md](../../investigations/viewer-app.md) at commit `ccf3869`, and
against [spec.md](../../spec.md) as it stands at that commit.

The card fixes five things before planning starts: **inbound is the file picker only**, **outbound is
`navigator.share`**, **history loads eagerly**, **CommonMark 0.31.2 is mandatory**, and **the
browser-side review-package writer is the reference approach**. Four of the five are exactly what the
evidence supports and are adopted without argument. The fifth — eager history — is the one the
investigation argues against, and §1 row 3 says what it costs and what number would reverse it. It is
planned as directed.

---

## 1. Ground truth: what the card assumes against what the repository actually holds

Ten rows. Rows 1–5 check the card's five fixed points; rows 6–10 are things the card is silent about
that change the shape of the work.

| # | The card assumes | What the evidence and the repository actually hold | Consequence |
| --- | --- | --- | --- |
| 1 | File-picker inbound works on iOS | Confirmed, and the rule is specific: WebKit's `WKFileUploadPanel` builds `_acceptedUTIs` from `accept`, and an **empty** set opens the picker with `UTTypeItem` (matches anything). `accept` absent and `accept=".mdpkg"` both give an empty set today; `accept="application/zip"` gives `public.zip-archive` and **greys the package out**, because a `.mdpkg` types as `public.data` | The plan owns an `accept` decision, not a free choice (D-2), and the negative control is on the device checklist |
| 2 | Outbound is `navigator.share` | Available, but conditional: `WebShareFileAPIEnabled` defaults true only on `PLATFORM(COCOA) && !WATCHOS && !APPLETV`. Firefox and desktop Chrome have no file share. §4.3 lists `<a download>` as the ordinary path and `showSaveFilePicker` as Chromium-only | Outbound is **two** paths behind one `canShare` probe, not one (D-7) |
| 3 | History loads eagerly | §3.3 says the opposite in terms: "a viewer that loads it eagerly pays Rust-scale costs on every package". Priced: **+53,773 gzipped bytes** of isomorphic-git, the **whole** pack and index through `readFile` regardless of target (157,750 npm / 3,310,333 Rust bytes), 234–350 ms warm on Rust scale, and a bundled Pako inflater rather than the native stream. Every one of those timings is desktop; spec §11.2 item 3 leaves mobile open | Implemented as directed (D-3), with the reversal criterion stated as a number and measured in M6 item 8 |
| 4 | CommonMark 0.31.2 is mandatory | Confirmed and stronger than "mandatory": §3.2 measures parsing at 47,999 gz and parsing **plus rendering** at 48,014 — 15 bytes apart. The whole 48 KB is the identity requirement of §6.1 rule 2; display is free | No parser split, no smaller substitute (D-4) |
| 5 | The browser writes the review package | Confirmed for the **`delta`** shape: 4,634 bytes built from `writeBlob`/`writeTree`×3/`writeCommit`/`writeRef`/`packObjects`/`indexPack` plus `CompressionStream`, and `git fsck --full --strict` exits 0 on it. **`bundled` was never built** and its cost is unmeasured (investigation §7 item 5). `CompressionStream` exposes no level, so output is conforming but never byte-identical to a level-6 emitter | v1 emits `delta` only (D-5); `bundled` is deferred with its own measurement |
| 6 | A reader exists | `docs/investigations/viewer-app/mdpkg_reader.mjs` is a **probe**, ~170 lines, and says so. It has no ZIP64 sentinel detection (every field is read as `u32`), no §3.7 recoverable tier, no §3.6 NFC-plus-case-fold uniqueness check, and it reads `internalAttributes` without enforcing spec D-19. Its `bytesSource` returns a `subarray` **view** — the exact thing the investigation records as silently breaking zip.js | Slice 1 is hardening, not a copy |
| 7 | Review capture is solved | §4.1 states the gap in its own words: the probe has no mapping from a DOM `Selection` back to a character offset **in the canonical scope source**. There is no library for it and no code for it in this repository | The single highest-risk novel item; its own slice and its own spike (D-9, slice 5) |
| 8 | The bundle costs add up | §3.2 measured each slice **independently**. `git-read` (53,773) and `git-write-review` (52,363) are both isomorphic-git and would share a chunk in one graph, so the assembled 156,618 figure is an **upper bound** and the shared-chunk figure is unmeasured | The size gate uses the upper bound; M5 re-measures on the real graph with the investigation's own harness |
| 9 | There is somewhere to build | There is **no application code, no root `package.json` and no build** in this repository. `docs/investigations/viewer-app/package.json` is a private probe manifest (6 pinned deps including esbuild) | Slice 0 creates the app, pinning the investigation's exact versions so the golden cross-checks stay valid |
| 10 | (silent on storage) | §3.4: WebKit caps **all** script-writable storage at seven days of Safari use without interaction — IndexedDB, LocalStorage, SessionStorage, service workers, cache. The documented exemption is the home-screen web app. OPFS is available from Safari 15.2 but `createWritable` only from Safari 26 | Persistence is OPFS with a two-branch write path, plus an install prompt (D-8) |

Two things the card gets exactly right and that the plan leans on hard: the identity layer is already
**proven portable** — the probe's JavaScript reproduces root `52f7f274…` and expect `684ba2cd…` for
`## Usage` of `guide.md`, and both strings appear verbatim in `docs/spec/worked-example.json`, which
the Python emitter produced independently. And the container layer is **proven byte-agreeing** — the
minimal reader, zip.js 2.8.7 and fflate 0.8.2 all return the same 163 bytes of `guide.md`, SHA-256
`1cf920f3e2f91322b12e08c6edd7c2532d429a42adb2bcf7b22a96b73172b4f8`. Those two facts are the two
strongest tests in this plan and they cost nothing to write, because the expected values are already
committed data.

---

## 2. Decisions

Numbered in their own sequence. spec.md §10's D-1…D-26 are **format** decisions and are unrelated;
where this plan cites one it writes it as "spec D-17".

**D-1 — Static, serverless, single-origin.** No backend of any kind: no upload endpoint, no token
exchange, no document custody. *Reason:* investigation §5 constraint 4 — nothing in the read or write
path requires a server, and the write path is demonstrated end to end against native `git fsck`.
*Rejected:* the Shortcuts bridge with `Get Contents of URL` POSTing the file to an endpoint (§2.4).
It genuinely works and it is the only way to get an entry in the iOS share sheet without a binary, and
it destroys the property that makes this app defensible. *Rejected:* the base64-in-URL bridge — 4/3
expansion makes an npm-scale 171 KB package a ~228 KB URL, unspecified by iOS and unmeasured at any
scale.

**D-2 — The file input carries no `accept` attribute at all.** *Reason:* `accept` absent produces an
empty `_acceptedUTIs` set unconditionally, today and under any future registration.
`accept=".mdpkg"` produces an empty set only *while* no MIME type is registered for the extension: the
WebKit path is extension → `MIMETypeRegistry::mimeTypeForExtension` → `UTType typeWithMIMEType:`, so
if spec §11.1 item 2 ever registers a media type whose UTI a `public.data` file does not conform to,
`accept=".mdpkg"` silently becomes the `application/zip` failure — the package greys out — and it
does so on users' devices, not in our build. *Rejected:* `accept="application/zip"` (greys it out
today), `accept="application/vnd.mdpkg"` (works only by the accident of `typeWithMIMEType:` returning
nil). *Accepted cost:* an empty UTI set makes the panel also offer the photo and video pickers;
cosmetic, and measured as such on the device checklist. Desktop additionally gets drag-and-drop and
paste, which cost nothing and go through the same one entry point.

**D-3 — History loads eagerly on open, unconditionally, as the card directs.** *Reason:* the card
decided it, and the feature the app exists for — reviewing against a lineage, and answering "has this
changed since I reviewed it" — reads `history.json`, the range summaries and the bindings.
*Stated cost, not hidden:* +53,773 gz on every package, the entire pack and index in memory, 234–350
ms warm on Rust scale **on a desktop**. *Split, so the decision is reversible in one line:*
`history.json`, `bindings.json` and the range summaries are current-view ZIP entries and need no pack
and no Git library at all — those load eagerly and cheaply and give the history *shape*. The
pack-backed isomorphic-git module is a separate esbuild chunk whose import is one call site.
*Reversal criterion, to be measured in M6 item 8:* if a 3.3 MB Rust-scale package on the oldest
supported device fails to reach first render within 3 s, or reloads the tab, D-3 is demoted to
on-demand behind a visible affordance and this plan is amended. *Rejected for now:* §3.3's own
recommendation (lazy history), because the card decided otherwise and the cost of being wrong is one
import site.

**D-4 — `commonmark` 0.31.2 is a hard, non-swappable dependency on the always-loaded path.**
*Reason:* §6.1 rule 2 pins identity to CommonMark 0.31.2 without smart punctuation. A smaller parser
can render the document; it cannot decide where a section starts, and a section boundary that
disagrees with the profile produces a different scoped digest and therefore a wrong `flagged-changed`
— a silently wrong review status, which is the worst failure this app can have. *Rejected:*
markdown-it / micromark (render-correct, identity-wrong). *Rejected:* a two-parser split, commonmark
for identity and something small for display — the measurement kills it, rendering is 15 gzipped
bytes on top of parsing, so the split buys nothing and doubles the surface on which the two can
disagree.

**D-5 — v1 emits the `delta` review shape only.** *Reason:* it is demonstrated end to end and
accepted by native Git, it is §6.8's normal case, and the reviewed party already holds the original it
produced. *Deferred:* `bundled`, which requires reading and re-emitting A's pack and adding a commit
on `review.of.current`; isomorphic-git can do it and nobody has measured what it costs (investigation
§7 item 5). *Consequence recorded in the UI:* a `delta` review is useless to a party that no longer
holds `review.of.current`, so the emitter states which package the review answers, by
`review.of.namespace` + `review.of.current`, and fills the optional `packageDigest` / `packageBytes`
corroboration because the app has the exact bytes in hand and it is free.

**D-6 — Own the container layer; do not adopt zip.js.** *Reason:* 66,076 gz against 1,565, and the
difference is encryption, ZIP64, split archives and worker pools for a profile that permits methods 0
and 8, forbids encryption and has rejection as its only tested ZIP64 behaviour. The 1,565-byte reader
already agrees with zip.js byte for byte on both fixtures. *Adopted from zip.js by shape, not by
dependency:* the `HttpRangeReader`, ~150 lines, when remote packages happen — the minimal reader's
`read(o, n)` source interface is already the same shape. *Rejected:* fflate as the reader — 2,712 gz
but `unzipSync` takes the whole archive, which is the 158,993 / 3,312,561 bytes that spec §3.2's entry
order exists to avoid. fflate stays, for its inflater only (D-12).

**D-7 — Outbound is `navigator.canShare({files})` → `navigator.share({files})`, else `<a download>`
on a blob URL.** The filename is always `<name>.mdpkg` on both paths. *Reason:* §2.2 and §4.3 —
`WKShareSheet` writes the file under its own `name` through `sanitizeSuggestedFilename` and nothing
renames it, and `DownloadAttributeEnabled` defaults true in the WebKit port. *Rejected:*
`showSaveFilePicker`, Chromium-only and absent from WebKit entirely. *Known risk, on the checklist:*
`ShareDataReader` loads every shared file with `ReadAsArrayBuffer` and copies it into a
`SharedBuffer` before the sheet opens — for a Rust-scale package that is a 3.3 MB blob read and
copied in the web process on a phone (M6 item 14).

**D-8 — Persistence is OPFS, and the app offers Add to Home Screen on iOS.** *Reason:* §3.4 — the
seven-day cap covers IndexedDB and everything else script-writable, and the documented exemption is
that home-screen web apps are not part of Safari and keep their own counter. So the home-screen app is
worth having on iOS **not** for share target, which it cannot get, but for storage that survives.
*Two-branch write path, not one:* `createWritable` from Safari 26, `createSyncAccessHandle` in a
worker for Safari 15.2–25. *Rejected:* IndexedDB (same cap, no advantage), `showSaveFilePicker`
(D-7).

**D-9 — Render from source with per-block source offsets, and map the selection back through them.**
The renderer carries commonmark's `sourcepos` onto block elements as data attributes; a line-offset
index over the canonical scope source converts line/column to a character offset; intra-block
position is recovered by locating the selected text within that block's raw source. *Reason:*
investigation §6 item 1 — `sourcepos` already carries what is needed, and rendering from source is the
only way an offset minted in the DOM lands on the same character as an offset computed over the
source. *Rejected:* rendering to HTML and re-finding the selected string in the source, which fails
on every construct the renderer transforms (emphasis markers, list bullets, entity references, link
syntax). *Known limitation and the reason this is a spike, not a slice:* commonmark.js emits
`sourcepos` on **block** nodes; inline source positions are not dependable, so the intra-block step is
arithmetic over the block's own source and must be proven before slices 2, 5 and 6 are built on it.

**D-10 — No native iOS companion in v1.** *Reason:* §2.6 — it costs an Apple Developer Program
membership and a release process, and a wrapper whose only content is the same web app is precisely
the shape App Store guideline 4.2 names. The evidence does not support treating it as an alternative
to the web app; it supports treating it as an optional companion that, once installed, upgrades the
`public.data` share and the dead "Open In" for every app on the device. *Trigger to revisit:* M6
item 12 — if the share sheet for a `public.data` `.mdpkg` offers no useful destination, the companion
becomes the only way to make the round trip work and this decision is reopened.

**D-11 — No Shortcut in v1.** *Reason:* §2.4 — a shortcut that saves the package to a fixed Files
folder cuts the inbound path from two taps to one, and costs every user an install step. One tap is
not worth an install.

**D-12 — fflate is loaded only where `DecompressionStream('deflate-raw')` is absent.** Feature-detect
at open; below Chrome 103 / Firefox 113 / Safari 16.4 import fflate's inflater (2,112 gz, measured in
compression.md). *Reason:* it is the measured floor and the fallback is 2 KB.

**D-13 — Android share target is out of v1, but the inbound path is one function.** Chrome Android
has had `share_target` since 76 and a real PWA there can be an inbound share destination. v1 does not
ship it; the file-picker handler and a future service-worker POST handler call the same
`openPackage(blob)`, so adding it later is a manifest entry and a route. *Reason:* §2.7 — the
platforms differ in kind, and a design that assumes one share story will be wrong on one of them.

---

## 3. Off-the-shelf against novel

### Off-the-shelf, adopted

| Dependency | Version | What it does | Why nothing else | Gz cost |
| --- | --- | --- | --- | ---: |
| `commonmark` | 0.31.2 | Parse for section identity **and** render | The profile names it; a different parser is a different section boundary (D-4) | 48,014 |
| `isomorphic-git` | 1.41.9 | Read history; write the review pack (`writeBlob`, `writeTree`, `writeCommit`, `writeRef`, `packObjects`, `indexPack`) | The Git layer is covered completely and has been measured twice; its output is accepted by native `git fsck --full --strict` | 53,773 read / 52,363 write, sharing one core |
| `fflate` | 0.8.2 | Inflater only, below the `deflate-raw` floor | Smallest measured JS inflater; not used as a reader (D-6) | 2,112 |
| `buffer` | 6.0.3 | The Node `Buffer` shim isomorphic-git needs | Transitive requirement, already counted inside the git slices | (in the above) |
| `esbuild` | 0.25.9 | Bundle, tree-shake, code-split, size-report | The same tool the investigation measured with, so the app's numbers stay comparable to §3.2's | build-time |

Versions are pinned to exactly what `docs/investigations/viewer-app/package.json` pins, because the
golden expectations in slices 1, 3 and 6 are outputs of those versions.

### Novel, must be written

| # | Piece | Size | Prior art in-repo | Risk |
| --- | --- | --- | --- | --- |
| N1 | Container reader, hardened to the conforming **and** recoverable tiers | ~350 lines | `mdpkg_reader.mjs`, probe-grade (~170 lines) | Low — the gaps are enumerable (row 6) |
| N2 | Container writer for a conforming review package | ~200 lines | `mdpkg_writer.mjs`, proven against `git fsck` | Low |
| N3 | Addressing: outline, heading trail with occurrence counting, scoped digest, default root | ~150 lines | `review_probe.mjs` — `outline`, `scopedDigest`, `defaultRoot`, and it **agrees with the Python emitter** | Very low — promotion, with a golden test that already exists |
| N4 | **DOM `Selection` → canonical source offset** | unknown | **none** | **High** — no library, no code, and `sourcepos` is block-level (D-9) |
| N5 | Selector minting: quote, occurrence, 40-char prefix/suffix truncated at the scope boundary | ~80 lines | `makeSelector` in the probe | Low |
| N6 | Resolution: §6.5 root statuses, §6.8's four steps, quote search with prefix/suffix run scoring, refusal on a tie | ~250 lines | none — the probe mints, it never resolves | Medium — the rules are fully specified, so this is careful transcription, not design |
| N7 | ZIP-mounted filesystem for isomorphic-git | ~120 lines | none | Medium — the library reads the whole pack through `readFile`, so the mount is simple but the memory is not |
| N8 | UI: document list, reading view, selection affordance, thread list, six status badges | the bulk of the app | none | Medium — ordinary work, largest by volume |
| N9 | OPFS store with the `createWritable` / `createSyncAccessHandle` branch and the install prompt | ~150 lines | none | Low |

The shape of the split is the point: **the Git layer and the Markdown layer are covered completely by
off-the-shelf software, and the container layer is not** — zip.js is 42× what the profile needs and
fflate cannot do a bounded read. The novel work is small because spec §3 did the design work, with
exactly one exception, N4, which is small in lines and large in unknown.

---

## 4. Milestones

Amended 2026-09-09 for CARD-0024 findings F1/F2: V-2 now has explicit library and
app allowances for each milestone, in gzip bytes. The total ceiling is their sum,
as implemented in `src/web-viewer/build.mjs` (`LIBRARY_BUDGETS` and `APP_BUDGETS`). These are
fixed planning ceilings; the app allowances for future slices are not measured
implementation costs.

| M | Milestone | Ships | Library baseline, gz | App allowance, gz | Total ceiling, gz | Retires |
| --- | --- | --- | ---: | ---: | ---: | --- |
| M1 | **Open and browse.** File picker → 79-byte typing → central directory → document list → one document rendered | slices 0, 1, 2 | 48,014 | 12,288 (12 KiB) | 60,302 | The largest external unknown: does the iOS picker actually hand over a `.mdpkg` |
| M2 | **Identity.** Outline, heading trail, scoped digest, default root, cross-checked against the committed worked example | slice 3 | 48,014 | 16,384 (16 KiB) | 64,398 | That the identity layer is portable to the browser without re-derivation |
| M3 | **History, eagerly.** `history.json` and summaries from the current view; isomorphic-git over the ZIP-mounted pack | slice 4 | 101,787 | 24,576 (24 KiB) | 126,363 | D-3's cost on a real device (M6 item 8) |
| M4 | **Review capture.** Selection → source offset, selector minting, `comments.json` in canonical JSON | slices 5, 6 | 101,787 | 32,768 (32 KiB) | 134,555 | N4, the one piece with no prior art |
| M5 | **Emit and share.** In-memory Git repo → pack → conforming ZIP → `navigator.share` / `<a download>` | slices 7, 8 | 154,150 upper bound | 40,960 (40 KiB) | 195,110 | That a page can emit something native Git accepts, on a phone |
| M6 | **Round trip on real devices.** §6's checklist, end to end, B emits and A resolves | slices 9, 10, 11 | 154,150 upper bound | 49,152 (48 KiB) | 203,302 | Investigation §7 item 1 — every iOS claim is currently source-derived, not device-measured |

The library baselines cite the exact asset rows in
[`bundle-results.json`](../../investigations/viewer-app/bundle-results.json):
`commonmark-parse-render` is **48,014**, covering `Parser` and `HtmlRenderer`,
which M1 rendering already needs under D-4. The 47,999-byte `commonmark-parse`
row covers parsing alone. M3/M4 add `git-read` at **53,773**; M5/M6 additionally
reserve `git-write-review` at **52,363**. The latter sum remains an upper bound
until M5 measures the shared Git chunk. The investigation's 1,565-byte minimal
reader and 918-byte minimal writer are probe implementations: the app's owned
reader and writer are charged to the app allowance only. They do not also appear
in the library baseline. This replaces the earlier assembled probe floors in
this table without changing the investigation's historical measurements.

The app allowance includes UI, styling, owned container code and addressing.
M1 reserves 12 KiB for opening, hardening and reading; M2 adds 4 KiB for identity
and references. CARD-0024 measured M2 app-only JS plus CSS at **15,139 gzip bytes**,
so its 16 KiB allowance is retained. M3 adds 8 KiB for the ZIP mount, descriptors
and history UI; M4 adds 8 KiB for selection mapping, selectors and review capture;
M5 adds 8 KiB for the owned writer and share UI; M6 adds 8 KiB for resolution and
persistence. These increments reserve room before those slices are implemented.

V-2 sums the actual gzip sizes of the initial static closure, including shared
chunks and CSS, plus Git's package-open closure when shipped, against the total
ceiling. The current browse/identity build selects M2; later milestones require
explicit selection. A ceiling change must amend this section and the matching
build constants together, with measured costs, the cause of growth and the
tradeoff recorded before accepting the change. A failing build alone is not a
reason to increase an allowance.

M1 and M6 are the two that produce evidence nobody in this repository has. M2–M5 are mostly the
promotion of code that already agrees with an independent implementation.

---

## 5. Slices

Each slice names its files and its tests. Paths are proposed; `src/web-viewer/` is new.

**Slice 0 — Skeleton and size gate.**
Files: `src/web-viewer/package.json` (the five pins above), `src/web-viewer/index.html`, `src/web-viewer/src/main.js`,
`src/web-viewer/build.mjs`. `build.mjs` reuses the method of
[`docs/investigations/viewer-app/build_web.mjs`](../../investigations/viewer-app/build_web.mjs) —
esbuild, minified, tree-shaken ESM, gzip level 9 — and emits a per-chunk report.
Tests: the build fails when the always-loaded chunk exceeds its budget; the report's `git-read` slice
still reproduces 166,033 raw / 53,773 gz, which is the cross-check that the app's harness measures
the same thing the investigation's did.

**Slice 1 — Container read, hardened.**
Files: `src/web-viewer/src/container/reader.js` (from `mdpkg_reader.mjs`), `src/web-viewer/src/container/source.js`
(Blob-backed and byte-backed sources that return **standalone buffers, never `subarray` views** — the
half hour the investigation records losing), `src/web-viewer/src/container/conformance.js`.
Adds over the probe: ZIP64 sentinel detection with rejection (spec §3.5's only tested behaviour), the
§3.7 recoverable tier, §3.6 name checks (forward slash, no `..`, NFC-plus-simple-case-fold uniqueness,
reserved-prefix), and internal-attributes-`0` reported as nonconformance rather than ignored.
Tests: both fixtures decode `guide.md` to SHA-256 `1cf920f3…`; a byte ledger asserts the recorded
opening totals — **1,216** on `full.mdpkg` and **1,437** on `squashed.mdpkg`, including the manifest.
Reading `guide.md` adds 149 bytes, giving **1,365 / 1,586** end-to-end (F-4), so a regression that reads the
whole archive fails loudly; the five recorded rejections (random bytes, empty, 78-byte truncation,
bad signature, first entry renamed) each in at most 79 bytes; a ZIP64-sentinel fixture rejects; a
re-zipped fixture types as recoverable, not conforming.

**Slice 2 — Browse.**
Files: `src/web-viewer/src/ui/documents.js`, `src/web-viewer/src/ui/reader-view.js`, `src/web-viewer/src/inbound/open.js` (the single
`openPackage(blob)` entry point of D-13, called by the file input, drag-drop and paste).
Tests: opening `squashed.mdpkg` lists **two documents** out of **12 entries**, hiding the `.mdpkg/`
and `.git/` reserved prefixes; `guide.md` renders and its source is the 163 bytes.

**Slice 3 — Identity.**
Files: `src/web-viewer/src/address/outline.js`, `src/web-viewer/src/address/digest.js`, `src/web-viewer/src/address/root.js` —
promoted from `review_probe.mjs`.
Tests: **the golden cross-check.** For `## Usage` of `guide.md` in `full.mdpkg`, root
`52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70` and expect
`684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa`, asserted against
`docs/spec/worked-example.json` rather than against a hand-written constant. Plus the ledger case: the
default root of `["section","guide.md",[["# Guide",0],["## Setup",0]]]` is `b6564987…7984`, which the
committed 195-byte ledger keys on.

**Slice 4 — History, eagerly.**
Files: `src/web-viewer/src/history/descriptor.js` (`history.json`, `bindings.json`, range summaries — current-view
entries, no pack, no library), `src/web-viewer/src/history/gitfs.js` (N7, the ZIP-mounted filesystem),
`src/web-viewer/src/history/git.js` (the separately-chunked isomorphic-git module, imported eagerly per D-3),
`src/web-viewer/src/history/budget.js` (records bytes read and ms elapsed, for M6 item 8).
Tests: the descriptor parses on both fixtures and its `transform` list agrees with the manifest, which
is the disagreement spec §4 makes a validator reject; a `log` walk on `full.mdpkg` returns
`c0 → c1 → c2` and on `squashed.mdpkg` returns `c0 → s1`; `readBlob` of `guide.md` at `current`
returns bytes identical to the current-view ZIP entry, which is the current-view-equals-tip-tree
property checked from the reader's side; the budget recorder emits a number.

**Slice 5 — Selection to source offset. (Spike first.)**
Files: `src/web-viewer/src/render/annotate.js` (a commonmark renderer subclass carrying `sourcepos` onto block
elements), `src/web-viewer/src/render/line-index.js`, `src/web-viewer/src/render/source-map.js`.
Tests: a table of selections over `guide.md` whose expected offsets are computed from the source
directly, including the investigation's own case — selecting `produce a package` in the 72-character
`## Usage` scope yields `start 25, end 42`; a selection that begins in one block and ends in another;
a selection inside emphasis, inside a code span, and inside a list item, which are the three places
block-level `sourcepos` plus intra-block arithmetic is most likely to break; a selection that spans a
section boundary, which §6.8 says is two anchors or one on the common ancestor and must therefore be
detected rather than silently clamped.

**Slice 6 — Selector and `comments.json`.**
Files: `src/web-viewer/src/review/selector.js` (from `makeSelector`), `src/web-viewer/src/review/comments.js`.
Tests: the §4.1 selector reproduced field for field,

```json
{"start": 25, "end": 42, "quote": "produce a package", "occurrence": 0,
 "prefix": "## Usage\n\nRun `build` to ", "suffix": ".\nRun `check` to validate it.\n"}
```

including prefix and suffix truncation at the scope boundary;
`occurrence` counted correctly when the quote appears twice earlier in the scope; `quote` verified
against the source before emission, as §6.8 requires of a producer; canonical JSON round-trips to
identical bytes; the three profile names at the top of the file equal the reviewed package's
`addressing.anchor`, `addressing.digest` and this selector profile.

**Slice 7 — Review-package emission.**
Files: `src/web-viewer/src/review/emit.js`, `src/web-viewer/src/container/writer.js` (from `mdpkg_writer.mjs`).
Must get right, because the probe hit it and the fix was four lines: the manifest's `mdpkg` key is
written **first** and everything else sorted, so the magic lands at byte 50 — plain canonical JSON puts
`anchor` first and the package fails its own typing check.
Tests: the app's own reader (slice 1) types the app's own output at offset 0; then
[`validate_review.py`](../../investigations/viewer-app/validate_review.py) re-run against it, all
rows green — `zipfile.testzip()` `None`, empty EOCD comment, internal attributes 0 on every record,
methods ⊆ {0, 8}, first entry `.mdpkg/manifest.json` at offset 0, bytes 50–78 the magic,
`git read-tree HEAD` exit 0, **`git fsck --full --strict` exit 0**, `git rev-parse HEAD` equal to the
manifest's `current`, and `git ls-tree -r --name-only HEAD` naming `.mdpkg/review/comments.json` and
nothing else. That last row is §7.4's safety rule checked mechanically and it is the test that stops a
review package from quietly editing a document.

**Slice 8 — Outbound.**
Files: `src/web-viewer/src/share/out.js`.
Tests: with `canShare` stubbed true, `share` receives one `File` whose name ends `.mdpkg` and whose
bytes are the emitter's exact output; with it false, an `<a download>` is created with the same name
and the blob URL is revoked; neither path is reachable without a successful self-type first.

**Slice 9 — Resolution.**
Files: `src/web-viewer/src/review/resolve.js`.
Implements §6.5 root resolution, §6.6 statuses, and §6.8's four steps.
Tests, one per branch, because a wrong branch here is a wrong review status: root `survives` → stored
offsets used, no search; root `flagged-changed` with the quote present exactly once →
`target-relocated` at the found offset; quote absent → `target-detached`, the thread stays on its
section, is not moved and is not dropped; two occurrences with a strict prefix/suffix run winner →
that one; a tie → refused as `target-detached`, never guessed; a `dead: split` retirement →
`flagged-changed` with successors offered as navigation and **the selector not run against the
successor set**, which §6.8 calls the silent review transfer §6.3 forbids; a foreign namespace →
rejected before anything resolves.

**Slice 10 — Persistence.**
Files: `src/web-viewer/src/store/opfs.js`, `src/web-viewer/src/store/sync-worker.js`, `src/web-viewer/src/ui/install-prompt.js`.
Tests: store, reload, reopen — identical bytes; the `createSyncAccessHandle` path exercised in a
worker; a browser with no OPFS degrades to in-memory with a visible statement that the package will
not survive the tab.

**Slice 11 — Device run.** No new files; executes §6 and writes the results back into this plan as an
appendix, which is what turns investigation §7 item 1 from open to closed.

---

## 6. Real-device iOS verification checklist

Every iOS claim this plan rests on is derived from WebKit source, MDN's compatibility dataset and
Apple's documentation. **None of it is a device measurement** (investigation §7 item 1). This
checklist is what converts it, and each item says what a failure would change.

Devices: an iPhone on current iOS (Safari 26+, so `createWritable` exists); an iPhone or iPad on the
oldest intended support — Safari 16.4 is the `deflate-raw` floor and Safari 15.2 the OPFS floor, so a
15.x device is the one that exercises the fflate fallback; an iPad; and one WKWebView host such as an
in-app browser, since WKWebView follows the installed WebKit rather than Safari.

### Inbound

1. **Picker with no `accept`.** Tap the input; the Files browser opens; a `.mdpkg` is selectable.
   *Fails →* the web-first premise fails and D-10 reverses to a native companion.
2. **Picker with `accept=".mdpkg"`**, as a second input on the same page. Expected: also selectable.
   *Differs from 1 →* D-2's caution is confirmed on the device and `.mdpkg` is never used.
3. **Picker with `accept="application/zip"`.** Expected: the package is **greyed out**. This is a
   negative control and it is what proves the mechanism rather than the outcome.
4. **Panel noise.** Record whether the photo and video pickers are offered alongside the document
   picker with an empty UTI set, and whether Files is still one tap away.
5. **A package not on the device** — iCloud Drive, Dropbox, Working Copy. Does the picker download it
   first, and what does the app receive while it is downloading?
6. **Typing.** The app reports `conforming`, 79 bytes read. Repeat with the same file renamed to
   `.txt`: it must still type, because the check is the bytes and not the extension.
7. **`deflate-raw` presence.** Feature-detect and report per device; on the 15.x device confirm the
   fflate fallback fires and yields the identical 163 bytes of `guide.md`.

### The eager-history decision

8. **Rust-scale package, 3.3 MB, cold.** Record: ms to first render, ms to history ready, and whether
   the tab reloads. *This is the measurement D-3 rests on.* Threshold: first render within 3 s and no
   reload. *Fails →* D-3 demotes to on-demand.
9. **Repeat item 8 on the lowest-memory supported device.** Treat a Safari "A problem repeatedly
   occurred" reload as a failure, not a flake, and record it as such.

### Outbound

10. **Emit on device.** Mint a thread, emit the `delta` package, and confirm the app's own reader
    types its own output at offset 0. Transfer to a desktop and run `git fsck --full --strict` —
    expected exit 0, matching the desktop result.
11. **`navigator.canShare({files})`** returns true on iPhone, iPad and in the WKWebView host.
12. **What the share sheet actually offers** for a `public.data` `.mdpkg`. Photograph it. Record
    which of Save to Files, Mail, AirDrop and Messages appear. *Investigation §7 item 1, unverified.*
    *No useful destination →* D-10 reopens; the native companion becomes the only working round trip.
13. **Filename preservation.** Share to Save to Files and to Mail; the saved and attached names must
    be exactly `<name>.mdpkg` with nothing appended. *Investigation §7 item 1 names CFNetwork's
    `suggestedFilename` as the specific unverified path.*
14. **Large-file share.** Share the 3.3 MB package: `ShareDataReader` reads it into an ArrayBuffer
    and copies it into a `SharedBuffer` before the sheet opens. Record success and time to sheet.
    *Fails →* outbound is `<a download>` only above a size, and the review flow says so.
15. **`<a download>` fallback.** With sharing forced off, confirm where the file lands on iOS and
    under what name.

### Round trip and storage

16. **The whole loop.** Machine B (iPhone) opens A's package, mints a thread, emits, sends by AirDrop
    or Mail. Machine A picks the review package with the file input; every thread resolves `survives`
    with exact offsets. Then edit A's document elsewhere in the same section, re-resolve, and confirm
    `flagged-changed / target-intact` via the quote search rather than a moved badge.
17. **OPFS.** Store a package, force-quit Safari, reopen: identical bytes. Record which write path the
    device took, `createWritable` or the sync-access-handle worker.
18. **The seven-day cap, honestly.** It cannot be observed inside a session. Verify the *exemption*
    instead: add to Home Screen, confirm the home-screen app has storage a Safari-tab data clear does
    not remove, and record that the tab-based copy is expected to expire. The seven-day observation is
    a calendar item, not a session item.
19. **The dead end, confirmed.** Long-press a `.mdpkg` in Files: there is no app to open it into
    (§2.5). The app's first-run copy must therefore tell users the picker is the way in, rather than
    letting them find this out.

### Non-iOS smoke

20. Chrome Android: `navigator.share({files})` works; `share_target` is deliberately absent in v1
    (D-13). Chrome desktop: drag-and-drop and the download fallback. Firefox: no file share, so
    `<a download>` is the only path and must be the one taken.

---

## 7. First slice: recommendation

**Build M1 — slices 0, 1 and 2 — deploy it to a URL, and open a real package on a real iPhone.**
Nothing else. A file input with no `accept`, the hardened reader, a document list, one document
rendered.

Why this and not the higher-risk slice 5: there are two large unknowns in this plan and they are
different kinds. Slice 5 (N4, the selection-to-source mapping) is a **design** risk — it is entirely
inside this repository, it can be attacked at any time, and if the block-level `sourcepos` approach
fails the answer is a different rendering strategy, which is expensive but available. The iOS picker
is a **platform** risk with no in-repo answer at all: if it does not work, no amount of design fixes
it and the whole web-first premise collapses to D-10's native companion, which changes the plan, the
budget and the schedule together. It is also the cheapest thing to test — one `<input>` element on top
of code that already exists and already agrees with two independent implementations — and it is the
item every other line of §6 is downstream of, because a device the app cannot receive a file on cannot
verify items 6 through 19 either.

So M1 buys the largest reduction in uncertainty per line written, and it puts a real device in the
loop before any of the novel work is committed to.

**Second slice: the slice-5 spike**, timeboxed, one file and one test table, run before slice 2's UI
hardens around a rendering strategy. A green spike unlocks M4 unchanged. A red one changes slices 2, 5
and 6 together, which is exactly why it should not be discovered after the reading view is built.

---

## 8. What this plan does not close

- **Everything in investigation §7 remains open** until M6 runs. Specifically: no device measurement
  of anything in §2, no mobile timing at all, and the fixtures are 5–6 KB so the bounded-read
  economics at corpus scale are quoted from spec §3.2 rather than re-measured here.
- **The shared-chunk bundle figure** (§1 row 8) is unmeasured; M5 produces it.
- **The `bundled` review shape** is deferred with its cost unmeasured (D-5).
- **spec §11.2 item 2** — whether a browser reader for `at=` / `commit` / `diff` references is
  required at all — is an owner decision this plan does not take; D-3 loads history for the current
  view's sake and stops there.
- **spec §11.1 item 2** — media type and extension registration — is the fact D-2 hedges against. If
  it is decided, D-2 should be revisited rather than left as written.
- **Test design.** This plan names the tests each slice owes; it does not design the harness, the
  fixture generation, the browser-versus-Node split, or how `validate_review.py` is driven from the
  app's output in CI. That is the next stage.

---

## Verification design

Written 2026-09-09 against this plan at commit `75d7846`. §5 names the tests each slice owes; this
section designs the machinery that runs them, the fixtures they run against, the CI that forces
them, and the device session that closes §6. It changes no decision in §1–§8.

Three facts shape everything below.

1. **The strongest oracles are already committed and were produced by a different implementation.**
   `docs/spec/worked-example.json` holds 9 roots with digests, 4 commit OIDs, 3 tree OIDs, 3 resolved
   reviews with and without the ledger, the range summary and its content-addressed name — all emitted
   by `worked-example.py` before any of this app existed. `read-probe-results.json` and
   `review-probe-results.json` hold the browser-side counterparts. A test that asserts against a
   hand-written constant where one of these files holds the same value is a weaker test for no saving.
2. **Some committed constants are toolchain-stable and some are not**, and conflating the two is how
   a golden suite rots. Tiered in "Fixture pipeline" below; the tiering is load-bearing, not tidiness.
3. **The novel risk (N4) and the platform risk (§6) are the only two places where a Node test proves
   nothing.** Everything else is bytes and strings and belongs in the fastest tier available.

### Harness: the Node / browser / oracle split

Four tiers. The rule that decides which tier a test goes in: **a test runs in the cheapest tier that
can actually fail for the right reason.**

| Tier | Runner | Covers | Why not cheaper | Why not dearer |
| --- | --- | --- | --- | --- |
| **T1 Node** | `node --test`, built in, no new dependency (Node 24.6.0 is already the pinned toolchain) | Container read/write, addressing, canonical JSON, selector minting, resolution, ZIP-mounted git fs, the offset **arithmetic** half of N4, fuzz | — | Node 24 has `Blob`, `File`, `CompressionStream`/`DecompressionStream('deflate-raw')`, `crypto.subtle` and `structuredClone`. Every byte-level claim in slices 1, 3, 4, 6, 7, 9 is decidable without a DOM |
| **T2 Browser** | Playwright, three engines (chromium, firefox, webkit), headless | DOM `Selection`, rendering, OPFS with both write branches, the file input, share / `<a download>`, the single `openPackage` entry point, chunk-graph loading | Node has no `Selection`, no OPFS, no `navigator.share`; jsdom implements none of the three usefully | Playwright WebKit is WebCore + JavaScriptCore, **not Safari**: no `WKFileUploadPanel`, no share sheet, no Files app, no ITP. It pre-filters §6, it does not close it |
| **T3 Oracle** | Python `zipfile` + native Git, driven from `validate_review.py` | Acceptance of anything the app **emits** | The whole claim of D-1/D-5 is "a page with no server produces something other tools accept". Checking that with our own reader is circular | — |
| **T4 Device** | Human, on hardware, recorded | §6's 20 items | Nothing else has a `WKFileUploadPanel` or a share sheet | — |

Two consequences that are design decisions, not implementation details:

- **N4 is split at the tier boundary, and the split is what makes it testable.**
  `src/web-viewer/src/render/source-map.js` takes a resolved `(blockElementSourcepos, textOffsetWithinBlockText)`
  pair and returns a canonical-source character offset — pure arithmetic, T1, exhaustively testable.
  `src/web-viewer/src/render/selection.js` takes a live `Selection` and reduces it to that pair — T2 only, and
  thin by construction. If the spike (§7) has to change strategy, it changes `selection.js`; the
  arithmetic and its test table survive. Building N4 as one function that takes a `Selection` would
  push its entire test surface into T2 and is rejected for that reason.
- **T3 never runs the app's own reader as its checker**, and T1 never checks anything whose failure
  mode is browser-specific. The reader-checks-its-own-writer assertion (V-35) exists, but it is the
  *cheap* gate before T3, never a substitute for it.

Suites and their names, used throughout: `app:build`, `app:unit` (T1), `app:browser` (T2),
`app:acceptance` (T3), `fixtures:repro`.

### Fixture pipeline

**Source of truth.** `python docs/spec/worked-example.py <abs-out>` produces `full.mdpkg` (4,986 B,
10 entries) and `squashed.mdpkg` (6,322 B, 12 entries) plus two bare repos, and rewrites
`docs/spec/worked-example.json`. It is the only fixture generator that exists and it stays that way;
nothing in `src/web-viewer/` regenerates the worked example.

**Decision F-1 — the two packages are committed under `src/web-viewer/test/fixtures/`, and CI separately proves
they are still reproducible.** *Reason:* an oracle you regenerate on every run is not an oracle. The
golden cross-check's whole strength (§1) is that a Python emitter produced those bytes independently
and earlier; rebuilding them from the same script in the same job proves only that the script is
deterministic. Committing also takes Git and Python off the critical path of `app:unit`, which is the
suite that must stay fast enough to run on every save. *Cost:* 11 KB of binary in the repository, and
a real risk of silent re-baselining, which F-3 answers. *Rejected:* generating into
`.antiphon/viewer-work/fixture` per run, as §8 of the investigation does — correct for a one-shot
probe, wrong for a suite that must detect the day the constants change.

**Decision F-2 — derived fixtures are generated by a committed, seeded script, not by hand.**
`src/web-viewer/test/fixtures/derive.mjs` reads `full.mdpkg` and writes, deterministically:

| Fixture | Derivation | Used by |
| --- | --- | --- |
| `reject-random.bin` | 79 bytes from a fixed-seed PRNG (the seed is recorded in `fixture-manifest.json`) | V-5 |
| `reject-empty.bin` | zero bytes | V-5 |
| `reject-trunc78.bin` | `full.mdpkg[0..78]` | V-5 |
| `reject-badsig.mdpkg` | `full.mdpkg` with bytes 0–3 set to `PK\x03\x05` | V-5 |
| `reject-renamed.mdpkg` | `full.mdpkg` with the first entry's local **and** central name `.mdpkg/` → `xmdpkg/` | V-5 |
| `zip64-sentinel.mdpkg` | `full.mdpkg` with one central record's uncompressed size set to `0xFFFFFFFF` and a ZIP64 extra field appended | V-6 |
| `recoverable-pyrebuild.mdpkg` | every entry of `full.mdpkg` re-added through Python `zipfile` in name order | V-7 |
| `recoverable-fflate.mdpkg` | `unzipSync` then `zipSync` round trip through fflate 0.8.2 | V-7 |
| `name-backslash`, `name-dotdot`, `name-leadingslash`, `name-nfc-collision` (`café.md` NFC + NFD), `name-casefold-collision` (`README.md` + `readme.md`), `name-reserved` (`.mdpkg/notes.md`) | one entry name rewritten per fixture | V-8 |
| `internal-attr-set.mdpkg` | one central record's internal file attributes set to `1` | V-9 |
| `crlf-source.mdpkg` | `guide.md` re-stored with CRLF terminators, everything else identical | V-19, R-13 |

Each is ≤7 KB, all are committed, and `derive.mjs` re-emits them byte-identically from `full.mdpkg`
so a reviewer can diff rather than trust.

**Decision F-3 — a fixture manifest separates toolchain drift from an app regression.**
`src/web-viewer/test/fixtures/fixture-manifest.json` records, for each committed fixture: byte length, SHA-256,
entry names in order, and the toolchain that produced it (`git --version`, `python --version`,
`zlib.ZLIB_VERSION`, and the blob OID of `worked-example.py`). Constants are then tiered, and the tier
decides what an assertion may say:

| Tier | Examples | Depends on | Assertion style |
| --- | --- | --- | --- |
| **A — toolchain-independent** | content digest `1cf920f3…`; roots `52f7f274…`, `b6564987…7984`; expect `684ba2cd…`; commits `28d8c71e / 08ae3497 / d038a205 / b414f39b`; trees `500c623d / 63cee821 / a15125f8`; summary name `ff2689cd…`; the 195-byte ledger; the selector's six fields; every canonical-JSON byte string | SHA-256, CommonMark 0.31.2, Git's object model — not Git's *packing* | exact equality, always, against `worked-example.json` |
| **B — toolchain-dependent** | package bytes 4,986 / 6,322; package SHA-256; pack and idx bytes; per-entry deflate sizes; opening read ledgers 1,216 / 1,437, or 1,365 / 1,586 including `guide.md` | Git's pack encoder, zlib level 6, Python's `zipfile` | exact equality **only while** `fixture-manifest.json` matches the running toolchain; otherwise the bound below |

`app:unit` reads the manifest first. On a Tier-B mismatch it fails with `fixture toolchain drift:
<field> expected X got Y` **before running a single app assertion**, so drift is never diagnosed as a
reader bug. Tier-A assertions never downgrade and never gate on the manifest.

**Decision F-4 — the byte ledger is asserted twice: exactly, and as a bound.** Exactly:
`openContainer` asks for 1,216 bytes on `full.mdpkg` and 1,437 on `squashed.mdpkg`:
79 typing + 22 EOCD + 719/930 central directory + 30 manifest header + 366/376 manifest payload.
Reading `guide.md` then adds 30 local-header + 119 compressed-payload bytes, so end-to-end
`totalAsked` is **1,365 / 1,586**. The earlier 969 / 1,180 totals belonged to the minimal
investigation probe, which did not read the manifest. The opening totals remain below
`0.25 × packageSize`; the end-to-end totals do not. The corrected end-to-end bound is
`totalAsked < 0.25 × packageSize + targetEntryBytes` (149 here), and `totalAsked` must be
**invariant under padding the package with a second large document** — the ledger read against a
fixture grown 10× must not grow. A bounded read is a property; 1,365 is a tripwire.

**Decision F-5 — scale fixtures are generated on demand, never committed.**
`src/web-viewer/test/fixtures/scale.mjs <repo> <commit>` curates a named public repository at a named commit into
a package and records source repo, commit, resulting bytes and SHA-256 into `device-results.json`.
Targets: an npm-scale package (~158 KB) and the Rust-scale package (~3.3 MB) that M6 items 8, 9 and 14
require. *Reason:* 3.3 MB does not belong in this repository, and the D-3 reversal criterion needs a
package of that size on a phone, not in CI.

### CI wiring, and `validate_review.py` against app output

There is no CI in this repository today. Five jobs, ordered to fail fast and cheap:

| Job | Runs on | Depends on | Gate |
| --- | --- | --- | --- |
| `app:build` | ubuntu | — | esbuild build succeeds; per-chunk size report emitted; budgets not exceeded; chunk graph asserted (V-2, R-8) |
| `app:unit` | ubuntu + windows | `app:build` | fixture manifest matches, then T1 |
| `app:acceptance` | ubuntu + windows | `app:unit` | T3 |
| `app:browser` | ubuntu | `app:build` | T2, three engines |
| `fixtures:repro` | ubuntu, **nightly and on any change to `docs/spec/worked-example.py`**, not per PR | — | regenerate the worked example; Tier-A constants must match `worked-example.json` exactly; Tier-B differences are reported and open an issue, not failed |

**Windows is not optional for `app:acceptance`.** D-17, D-18a and D-19 exist because of Windows, and
spec §3.8 records the two extractor failures (`unzip -aa`, Explorer) on a Windows host. An acceptance
suite that only runs on Linux cannot fail for the reason those decisions were taken.

**Changes to `validate_review.py`, and the one that matters most.** The script is generalised in
place rather than copied:

1. Package path and results path become a positional argument and `--out`. **The existing defaults are
   kept**, so investigation §8's reproduction line still runs verbatim — and PC-9 checks that.
2. The results JSON gains a `toolchain` block (`git --version`, `python --version`, platform,
   `GIT_CONFIG_GLOBAL` state) and an `assertions` array naming every row that was actually evaluated.
3. `--reviewed <path>` supplies the reviewed package, so the corroboration rows below can be checked.
4. A `--autocrlf` mode that does **not** neutralise `GIT_CONFIG_GLOBAL`, for the Windows run.

Rows it checks today and keeps: `testzip() is None`, empty EOCD comment, internal attributes 0 on
every record, methods ⊆ {0, 8}, first entry `.mdpkg/manifest.json` at header offset 0, bytes 50–78 the
magic, `git read-tree HEAD` exit 0, `git fsck --full --strict` exit 0, `rev-parse HEAD` equal to the
manifest's `current`, status lines all `?? `. Rows **added**, each because slice 7 or §6.8 requires
something the current script does not check:

| New row | Rule | Source |
| --- | --- | --- |
| `tracked_paths == ['.mdpkg/review/comments.json']` | exactly one, and that one | §7.4 / slice 7 — today's `only_review_paths` passes a package that also tracks `guide.md` |
| the pack entry is last in the central directory | entry order | spec §3.2 |
| general-purpose bit 11 set on every non-ASCII name | | spec §3.6 |
| `comments.anchor` / `.profile` / `.selector` equal the reviewed package's `addressing.anchor`, `addressing.digest`, and `cm0312-quote-context-v1` | | §6.8 |
| `review.of.namespace != manifest.namespace` for a `delta` package | | §6.8's delta rule |
| `review.of.packageDigest` and `.packageBytes` equal the reviewed fixture's actual SHA-256 and length | | D-5 |
| every thread's `quote` equals the reviewed package's canonical scope source at `[start, end)` | | §6.8's producer rule, checked by the oracle rather than by the producer |

**The wiring itself.** `app:acceptance` is three processes and a file, deliberately:
`node src/web-viewer/test/acceptance/emit.mjs --out $TMP/review.mdpkg` (the app's real emitter, no test double)
→ `python docs/investigations/viewer-app/validate_review.py $TMP/review.mdpkg --reviewed
src/web-viewer/test/fixtures/full.mdpkg --out $TMP/validation.json` → `node src/web-viewer/test/acceptance/assert.mjs
$TMP/validation.json`, which fails unless `accepted === true`, the `toolchain` block is present and
non-empty, and every row in its own expected-rows list appears in `assertions`. **The job must never
skip.** If Git or Python is absent the job fails; a missing oracle reported as a pass is the single
most likely way this whole design quietly stops working (R-11, PC-9).

### Proves it works now

Layer codes: **T1** Node, **T2** browser, **T3** oracle, **T4** device. Every expected value marked
*(golden)* is read from a committed file at test time, never retyped.

**Slice 0 — skeleton and size gate**
- V-1: the app's bundle harness measures what the investigation's did | T1 | `node src/web-viewer/build.mjs --report` | the `git-read` chunk is 166,033 raw / 53,773 gz, SHA-256 `b7beb8e1…` *(golden: `bundle-results.json`)*; all five dependency versions equal `docs/investigations/viewer-app/package.json`
- V-2: the always-loaded chunk stays inside its budget and inside its import graph | T1 | `app:build` with the §4 budget table | non-zero exit naming the offending chunk when the eager gz total exceeds the milestone budget; the report shows `commonmark`, the minimal reader and the history *descriptor* in the eager chunk, and `isomorphic-git` in a separate chunk with exactly one import site

**Slice 1 — container read, hardened**
- V-3: both fixtures decode `guide.md` identically | T1 | reader over `full.mdpkg` and `squashed.mdpkg` | SHA-256 `1cf920f3e2f91322b12e08c6edd7c2532d429a42adb2bcf7b22a96b73172b4f8`, 163 bytes *(golden)*
- V-4: the read is bounded | T1 | counting source through `openContainer` and `read('guide.md')` | opening 1,216 / 1,437 exactly and `< 0.25 × packageSize`; end-to-end `totalAsked` 1,365 / 1,586 exactly and `< 0.25 × packageSize + targetEntryBytes`, unchanged when the package is padded 10× (F-4)
- V-5: the five recorded rejections | T1 | `typePackage` over the five derived fixtures | each rejects with the recorded reason string and asks for ≤79 bytes *(golden: `read-probe-results.json`)*
- V-6: ZIP64 sentinels are rejected, the one tested behaviour | T1 | `zip64-sentinel.mdpkg` | rejected, with a reason naming ZIP64
- V-7: a re-zipped package types recoverable, not conforming | T1 | `recoverable-pyrebuild.mdpkg`, `recoverable-fflate.mdpkg` | tier `recoverable`; manifest bytes recovered from the central directory; the reader reports that bounded-read guarantees no longer hold
- V-8: §3.6 name rules | T1 | the six name fixtures | backslash, `..`, leading slash, NFC collision, case-fold collision and reserved prefix each rejected, each with a distinct reason
- V-9: internal attributes ≠ 0 is nonconformance, not silence | T1 | `internal-attr-set.mdpkg` | reported as nonconforming (D-19)
- V-10: sources return standalone buffers, never views | T1 | read a range, mutate the backing `Uint8Array`, re-inspect the returned bytes | returned bytes unchanged — the half hour the investigation records losing, made mechanical
- V-11: three implementations still agree | T1, dev dependency only | minimal reader vs fflate 0.8.2 vs zip.js 2.8.7 over both fixtures | identical `guide.md` bytes and SHA-256 `1cf920f3…`; zip.js and fflate stay `devDependencies` and are never shipped as the reader (D-6)
- V-12: no malformed input escapes as an unhandled error | T1 | 10,000 seeded single-byte and truncation mutations of `full.mdpkg` through `typePackage` → `readEndOfCentralDirectory` → `readCentralDirectory` → `readEntry` | every case either rejects with a reason or reads successfully; zero unhandled throws; no allocation larger than the input; under 5 s

**Slice 2 — browse**
- V-13: the document list hides the reserved prefixes | T1 | listing over both fixtures | `full` 2 documents of 10 entries, `squashed` 2 of 12 *(golden: `read-probe-results.json`)*
- V-14: one document renders from the exact source | T1 | render `guide.md` | source is the 163 bytes; block count and heading lines match `sections` in `read-probe-results.json` *(golden)*
- V-15: one entry point, three gestures, no `accept` | T2 ×3 engines | file input `change`, `drop`, `paste` | all three reach `openPackage(blob)` exactly once; `input.hasAttribute('accept') === false` (D-2, R-1)

**Slice 3 — identity**
- V-16: the golden cross-check | T1 | root and scoped digest for `## Usage` of `guide.md` in `full.mdpkg` | root `52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70`, expect `684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa`, asserted against `docs/spec/worked-example.json` *(golden)*
- V-17: the whole inventory, not one section | T1 | compute every root and digest at `c2` | equals `worked-example.json.inventories.c2` — all 9 roots, locators and digests *(golden)*. Nine assertions for the price of one, covering the trail, occurrence counting and the default-root rule together
- V-18: the ledger key is derived, not typed | T1 | `defaultRoot(["section","guide.md",[["# Guide",0],["## Setup",0]]])` | equals the sole key of the fixture's 195-byte `.mdpkg/address/overrides.json`, namely `b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984`
- V-19: canonical scope normalisation | T1 | `crlf-source.mdpkg` | every section's scoped digest equals the LF fixture's, **and** the selector offsets over the canonical scope are identical (§6.1 rule 1; R-13)

**Slice 4 — history, eagerly**
- V-20: the descriptor agrees with the manifest | T1 | parse `.mdpkg/history.json` on both fixtures | `transform` `[]` / `["squashed"]` matching each manifest — the disagreement spec §4 makes a validator reject
- V-21: the pack walks | T1 | isomorphic-git `log` over the ZIP-mounted fs | `full` → `d038a205 → 08ae3497 → 28d8c71e`; `squashed` → `b414f39b → 28d8c71e` *(golden: `worked-example.json.commits`)*
- V-22: the current view equals the tip tree, checked from the reader's side | T1 | `readBlob('guide.md', current)` against the current-view ZIP entry, both fixtures | byte-identical; `HEAD` equals the manifest's `current` minus `sha1-`
- V-23: the range summary is content-addressed and intact | T1 | `squashed.mdpkg` | the summary entry name is `.mdpkg/history/ranges/<sha256 of its own bytes>.json` = `ff2689cd…` *(golden)*; `bindings.json` names it; `beforeStateDigest`, `afterStateDigest`, `contentTouched` and `changedAt` equal `worked-example.json.summary` *(golden)*
- V-24: the budget recorder emits real numbers | T1 | open both fixtures | records bytes read and ms elapsed, both non-zero, in the shape M6 item 8 consumes

**Slice 5 — selection to source offset (spike first)**
- V-25: the investigation's own case | T1 | `source-map.js` over the 72-character `## Usage` scope | `start 25, end 42` for `produce a package` *(golden: `review-probe-results.json`)*
- V-26: the three places block-level `sourcepos` is most likely to break | T1 | a table over emphasis, a code span and a list item, expected offsets computed from the source directly | exact offsets
- V-27: **the exhaustive round trip** | T2 ×3 engines | for **every** character offset in `guide.md`, in `notes.md`, and in a synthetic document holding one instance of each CommonMark block type: offset → DOM position → offset | identity at every offset in every engine. This is the test that decides the spike; a table of hand-picked cases is not evidence that N4 works
- V-28: a selection crossing a block boundary is detected | T2 | a real `Selection` spanning two paragraphs | reported as multi-block, never silently clamped
- V-29: a selection crossing a section boundary is detected | T2 | selection spanning `## Setup` into `## Usage` | reported as two anchors or one on the common ancestor (§6.8), never one clamped anchor

**Slice 6 — selector and `comments.json`**
- V-30: the selector reproduced field for field | T1 | mint over the fixture scope | all six fields equal `review-probe-results.json.thread.select` *(golden)*, including `prefix` truncated at the scope start
- V-31: occurrence counting | T1 | a synthetic scope holding the quote three times | `occurrence` 0, 1, 2 for the three selections, and the correct one recovered for each
- V-32: a producer verifies its own quote | T1 | mint with a deliberately mismatched quote | refuses to emit; no `comments.json` produced
- V-33: canonical JSON is byte-stable | T1 | serialise → parse → serialise | identical bytes; the probe's single thread serialises to 1,015 bytes *(golden)*
- V-34: the three profile names are the reviewed package's | T1 | emit against `full.mdpkg` | `anchor` `cm0312-trail-source-v1`, `profile` `cm0312-source-lf-v1`, `selector` `cm0312-quote-context-v1`, each read from the reviewed manifest rather than from a constant

**Slice 7 — review-package emission**
- V-35: the app types its own output | T1 | slice 1's reader over slice 7's output | conforming at offset 0; bytes 50–78 are `{"mdpkg":"markdown-package/1"` — the four-line bug the probe hit, made a test
- V-36: the emitted commit is reproducible | T1 | emit with author and timestamps fixed to the probe's | commit `6e338fb853597e685f40432bda34d6fdb546fbc7`, tree `4f37f3173390e4106755c6dc27dbd5263e602923` *(golden: `review-probe-results.json`)*. Package bytes are **not** compared: `CompressionStream` exposes no level, so structural equality is asserted instead — entry names in order, methods, and per-entry uncompressed bytes
- V-37: native Git and Python accept it | T3 | the emit → validate → assert chain above | `accepted === true`, every row green including `git fsck --full --strict` exit 0 and `git read-tree HEAD` exit 0
- V-38: a review package cannot edit a document | T3 | `git ls-tree -r --name-only HEAD` | exactly `['.mdpkg/review/comments.json']` — §7.4's safety rule checked mechanically
- V-39: acceptance holds on Windows under a hostile Git config | T3, windows | the `--autocrlf` mode, `core.autocrlf=true` globally | `read-tree` exit 0, `fsck` exit 0, and every extracted document still hashes to its tracked blob (D-18a; the checkout half of D-18b is explicitly not asserted)

**Slice 8 — outbound**
- V-40: the share path | T2 | `canShare` stubbed true | `share` receives exactly one `File`, its name ends `.mdpkg`, its bytes are the emitter's exact output
- V-41: the download path | T2 | `canShare` stubbed false | an `<a download>` with the same name; `URL.revokeObjectURL` called with the same URL
- V-42: neither path is reachable without a successful self-type | T1 + T2 | emit a deliberately non-conforming package | both paths refuse; nothing is shared and nothing is downloaded

**Slice 9 — resolution.** One per branch, because a wrong branch here is a wrong review status.
- V-43: the three committed reviews, with and without the ledger | T1 | resolve `setup`, `usage`, `todo` recorded at `c1` against `squashed.mdpkg` | with ledger: `flagged-changed / source-changed`, `survives / same-source`, `survives / same-source`; without: `unconfirmed / possibly-renamed-moved-or-deleted`, `survives / same-source`, `survives / same-source` *(golden: `worked-example.json.reviews`)*. Three §6.5 branches from an independent implementation, free
- V-44: root `survives` → stored offsets used, no search | T1 | spy on the quote search | search never called; offsets returned unchanged (§6.8 step 2)
- V-45: `flagged-changed` with the quote present once → `target-relocated` | T1 | edited scope | status `flagged-changed`, sub-section outcome `target-relocated`, offset equal to the found position
- V-46: quote absent → `target-detached`, the thread neither moved nor dropped | T1 | quote deleted from the scope | `target-detached`; the thread's `root` unchanged and the thread still listed
- V-47: two occurrences with a strict prefix/suffix run winner → that one | T1 | duplicated quote with divergent context | the higher-scoring occurrence, with a non-zero score margin
- V-48: a tie is refused, never guessed | T1 | two occurrences with identical prefix and suffix runs | `target-detached`; no offset returned
- V-49: `dead: split` offers successors and does **not** run the selector | T1 | ledger entry with `dead: split` | `flagged-changed` with successors; the quote-search function never called (spy) — §6.3's forbidden silent transfer
- V-50: a foreign namespace is rejected before anything resolves | T1 | a thread from another namespace | `invalidated`; neither the document entry nor the ledger is read (asserted on the counting source)
- V-51: "touched since" is answered only from a range summary | T1 | `usage` and `setup` roots against `squashed.mdpkg` | `touched_after_review` `[]` and `[2]` respectively *(golden)*; with the summary entry removed, `unknown` — never "unchanged" (§6.7)

**Slice 10 — persistence**
- V-52: store, reload, reopen | T2 ×3 engines | write both fixtures to OPFS, reload the page, read back | byte-identical; the branch taken (`createWritable` vs `createSyncAccessHandle`) is recorded
- V-53: the sync-access-handle branch is really exercised | T2 | force the fallback by shadowing `createWritable` as undefined | the worker path runs and produces identical bytes
- V-54: no OPFS degrades visibly | T2 | delete `navigator.storage.getDirectory` | in-memory mode, and a visible statement that the package will not survive the tab

**Slice 11 — device run**
- V-55: §6's 20 items executed and recorded | T4 | the protocol below | `device-results.json` complete, and the appendix written back into this plan

### Guards the regression

There is no landed defect here; each row names a **future change that would reintroduce a failure the
evidence already paid for**, and the test that stops it.

- R-1: someone adds `accept=".mdpkg"` or `accept="application/zip"` to the file input "so the picker is tidier" | caught by **V-15** because it asserts `hasAttribute('accept') === false`, which is D-2's actual rule rather than its outcome
- R-2: a byte source is optimised back to `bytes.subarray(o, o + n)` | caught by **V-10** because the returned buffer must not change when the backing array is mutated
- R-3: the manifest is written with plain canonical JSON, putting `anchor` first | caught by **V-35** and **V-37** because the magic then lands past byte 50 and the package fails its own typing check
- R-4: a resolver is "improved" to search the successor set of a `dead: split` | caught by **V-49** because the quote-search spy asserts zero calls
- R-5: a tie is broken by taking the first match, or by offset proximity | caught by **V-48** because the expected result is a refusal, not a placement
- R-6: a smaller Markdown parser is swapped in for display, or `smart` punctuation is enabled | caught by **V-16** and **V-17** because a different section boundary yields a different scoped digest for at least one of the 9 committed roots
- R-7: a whole-archive read (`unzipSync`-shaped) creeps into the reader for convenience | caught by **V-4** because `totalAsked` then scales with package size and both the exact value and the bound fail
- R-8: `isomorphic-git` is pulled into the always-loaded chunk, or D-3 is quietly reversed to lazy without amending this plan | caught by **V-2** because the chunk graph is asserted in both directions — a separate chunk **and** exactly one import site
- R-9: an emitter starts setting the ZIP text flag, or drops the internal-attributes rule | caught by **V-37** (`internal_attr_all_zero`) and **V-9**
- R-10: a review package starts tracking a document — the "just include the file being reviewed" refactor | caught by **V-38** because the tracked path list must be exactly one name
- R-11: the acceptance job is made skippable when Python or Git is absent, or `fsck` loses `--full --strict` | caught by **V-37** because `assert.mjs` fails on a missing `toolchain` block and on any expected row absent from `assertions`
- R-12: fixtures are regenerated under a different toolchain and the Tier-B constants are silently re-baselined | caught by the **fixture-manifest check (F-3)** because it runs before any app assertion and names the drifted field
- R-13: line endings are normalised at read time instead of relying on D-17 | caught by **V-19** because the digests would still pass while the selector offsets shift by one per preceding line
- R-14: `occurrence` is recomputed at resolve time instead of being read from the stored selector | caught by **V-47** because the recomputed index disagrees with the stored one in the duplicated case

### Positive controls

Every guard above that protects a safety-critical assertion — a wrong review status, a review package
editing a document, a guessed anchor, an unbounded read, oracle acceptance, shared-output identity —
gets a control. **Build runs each: break, see red, revert, see green, and reports all three**, into a
`src/web-viewer/test/positive-controls.md` table alongside the suite.

- PC-1: break identity by constructing the parser as `new Parser({smart: true})`; expect **V-16 and V-17** red (guards R-6)
- PC-2: break the bound by replacing the bounded entry read with `src.read(0, src.size)`; expect **V-4** red **and V-3 green** — the point being that only the ledger catches it (guards R-7)
- PC-3: return `bytes.subarray(o, o + n)` from `bytesSource`; expect **V-10** red (guards R-2)
- PC-4: emit the manifest in plain canonical key order; expect **V-35 and V-37** red (guards R-3)
- PC-5: add `guide.md` to the review package's tracked tree; expect **V-38** red **and V-37's `fsck` row still green** — proving `fsck` is not what catches this (guards R-10)
- PC-6: take the first match on a tie in the quote search; expect **V-48** red (guards R-5)
- PC-7: run the selector against the successor set on `dead: split`; expect **V-49** red (guards R-4)
- PC-8: flip one byte inside the emitted pack before validation; expect **V-37** red *at the `fsck` row specifically* — proving the oracle is looking rather than merely running (guards R-11)
- PC-9: rename `python` out of `PATH` for one run; expect **`app:acceptance` red, not skipped**, and separately confirm that `python docs/investigations/viewer-app/validate_review.py` with no arguments still reproduces the investigation's own run (guards R-11 and investigation §8's reproduction line)
- PC-10: set `accept="application/zip"` on the file input; expect **V-15** red (guards R-1)
- PC-11: normalise CRLF→LF inside the container reader; expect **V-19's offset assertion red while its digest assertion stays green** — proving the offset half is what catches it (guards R-13)
- PC-12: import `src/web-viewer/src/history/git.js` statically from `main.js`; expect **V-2's chunk-graph assertion** red (guards R-8)
- PC-13: rebuild `full.mdpkg` under a different Git minor version; expect the **fixture-manifest check** red with a toolchain-drift message and **every Tier-A test still green** — the only control that proves the A/B tiering actually holds (guards R-12)
- PC-14: shadow `createWritable` so the worker branch never runs; expect **V-53** red (guards D-8's two-branch write path)

### Device checklist: execution and recording

§6's 20 items are the only part of this design a machine cannot run, so the plan for them is a
protocol, not a suite.

**The instrument.** `src/web-viewer/device/checklist.html` — one page, served from the app's own origin, with 20
numbered cards. Each card states the action, the expected result, the decision it can reverse, and a
**Record** button. Recording captures automatically: `navigator.userAgent`, `canShare` and `share`
presence, `DecompressionStream('deflate-raw')` presence, `createWritable` and `createSyncAccessHandle`
presence, `navigator.storage.estimate()`, viewport, and the relevant `performance` marks. The tester
adds `pass | fail | n/a | deferred` and a free-text note. The log is exported through the app's own
outbound path, which makes items 10 and 13 dogfood themselves.

**Record schema**, one row per (item, device):

```json
{"item": 8, "device": "iphone-a", "os": "iOS 26.0", "engine": "Safari 26.0",
 "result": "pass", "reverses": "D-3",
 "auto": {"deflateRaw": true, "canShareFiles": true, "createWritable": true,
          "msToFirstRender": 1840, "msToHistoryReady": 2960, "tabReloaded": false},
 "note": "3.3 MB Rust-scale, cold", "evidence": ["photos/item08-a.jpg"],
 "at": "2026-09-16T14:02:11Z"}
```

`reverses` is the field that makes a failure actionable: it carries the decision the item can
overturn — item 1 → D-10, item 2 → D-2, items 8 and 9 → D-3, item 12 → D-10, item 14 → D-7 — so a
`fail` mechanically names the plan amendment it forces rather than leaving that to a reader.

**Devices and coverage.** Four targets: **A** an iPhone on Safari 26+ (`createWritable` exists),
**B** an iPhone or iPad on 15.x — below the 16.4 `deflate-raw` floor, and the only device that
exercises both the fflate fallback and the sync-access-handle branch, **C** an iPad, **D** a WKWebView
host such as an in-app browser. Item 16 additionally needs a second device as machine A.

| Items | Scope | Runs |
| --- | --- | ---: |
| 1, 2, 3, 4, 6, 7, 11, 17 | every device | 8 × 4 = **32** |
| 5, 8, 10, 12, 13, 14, 15, 16, 18, 19 | once, on device A (16 needs two devices) | **10** |
| 9 | once, on the lowest-memory device | **1** |
| 20 | Chrome Android, Chrome desktop, Firefox desktop | **3** |

46 recorded runs.

**Order, because the items are not independent.** Gate first: **1 → 2 → 3 → 4 → 6 → 7**, then 5. A
device that cannot receive a file cannot verify 6–19, so a failure at item 1 ends that device's
session and is reported as such rather than leaving eighteen rows blank. Then the D-3 measurement
(**8, 9**), then outbound (**10 → 11 → 12 → 13 → 14 → 15**), then round trip and storage
(**16 → 17 → 19**), and **18** last, because it splits.

**Item 18 splits and is recorded as two rows.** The exemption half — add to Home Screen, confirm the
home-screen app's storage survives a Safari tab-data clear — is a session item. The seven-day cap
itself cannot be observed inside a session; it is recorded `deferred` with a due date eight days out
and a named owner, and closing it is a separate one-line commit. Recording it as a pass because the
exemption passed would be exactly the dishonesty §6 item 18 was written to prevent.

**Item 3 is a negative control and is reported as one.** A `pass` means the package is **greyed out**.
If items 1 and 3 both succeed at selecting the file, the mechanism is not what §1 row 1 says it is and
D-2's reasoning needs re-deriving even though the outcome looks fine.

**What T2 pre-filters, and what it cannot touch.** Running the checklist page under Playwright WebKit
before the device session catches page-level breakage cheaply, and covers, honestly, only item 7
(`deflate-raw` detection and the fflate fallback), item 11 (`canShare` presence, not the sheet), item
17 (an OPFS round trip, not force-quit survival) and item 20's engine matrix. **It cannot test items
1–5, 8, 9, 12–16, 18 or 19 at all** — no `WKFileUploadPanel`, no Files app, no share sheet, no
AirDrop, no ITP, and no phone-class memory. Fourteen of the twenty items require hardware.

**Blocking dependency, stated plainly.** Investigation §7 item 1 is open because no iOS device was
available, and this design does not change that. A real-device cloud (BrowserStack, Sauce) covers
items 1–9, 11, 17 and 20, but **not** 12–15 (share-sheet destinations, the Files app, the saved
filename), **not** 16 (a two-device AirDrop or Mail round trip) and **not** 18 (force-quit plus a
calendar interval). The cloud is therefore a partial substitute worth using for the gate items, and
slice 11 still needs physical hardware for the eight items that decide D-7 and D-10. Acquiring or
borrowing devices A–D is a prerequisite of slice 11 and sits on the critical path of M6, not of M1–M5.

**Where the results land.** `docs/investigations/viewer-app/device-results.json` for the raw rows and
photograph paths, plus an appendix table appended to this plan by slice 11 — which is what turns
investigation §7 item 1 from open to closed, and what §5 slice 11 already promises.

### Out of scope

- **Visual regression and screenshot diffing of the UI (N8).** There is no design specification to
  diff against; a golden-screenshot suite written now would pin arbitrary choices and produce noise on
  every layout change. Revisit once the reading view stabilises after M4.
- **Accessibility auditing.** Real work, but not v1 verification work, and it needs criteria this plan
  has not set.
- **Desktop performance testing beyond the budget recorder.** Every number that changes a decision is
  a mobile number (D-3's reversal criterion, D-7's large-share risk). A desktop benchmark suite would
  measure precisely the thing nobody is deciding on.
- **The `bundled` review shape.** Not built (D-5), so not tested. When it is built it needs V-37 and
  V-38 equivalents plus a test that its `current`'s parent is literally `review.of.current`.
- **Android `share_target`.** Deliberately out of v1 (D-13); only item 20's `navigator.share` check
  touches Android.
- **Corpus-scale byte economics.** Quoted from spec §3.2 rather than re-measured; the only scale
  artefact this design builds is the device fixture (F-5), because scale matters here as a phone
  measurement, not as a CI assertion.
- **`HttpRangeReader` and remote packages.** D-6 adopts the shape for "when remote packages happen";
  they do not happen in v1 and nothing tests them.
- **Cross-engine Markdown rendering fidelity.** commonmark.js is the oracle and it is the same code in
  every engine; V-27 tests the *offset* round trip per engine, which is the part that can differ.
- **The seven-day ITP cap as an observation.** Only its documented exemption is testable in a session
  (item 18); the cap itself is a calendar item, and this design says so rather than approximating it.
- **Unpinned dependency versions.** The five pins are what make the goldens valid; a floating-version
  matrix would test a configuration nobody ships.

### Cost

**Suites forced, per pull request:**

| Suite | Filter / scope | Wall clock |
| --- | --- | ---: |
| `app:build` | esbuild, size report, chunk-graph assertions | ~15 s |
| `app:unit` | `node --test src/web-viewer/test/unit/**` — fixture manifest, then slices 1, 3, 4, 5 (arithmetic), 6, 7 (emit), 9; ~200 assertions plus V-12's 10,000-case fuzz | ~25 s, fuzz dominating |
| `app:acceptance` | emit → `validate_review.py` → assert; ubuntu and windows, windows also in `--autocrlf` mode | ~20 s × 3 |
| `app:browser` | Playwright chromium + firefox + webkit — slices 2, 5 (selection), 8, 10; V-27 sweeps ~500 offsets × 3 engines | ~2 min, engines in parallel |

**Verification floor ≈ 3 min** wall clock with the four jobs parallel (the browser suite is the long
pole), **≈ 4 min serial**. A cold agent adds ~90 s for the Playwright browser download.

**Not per pull request:** `fixtures:repro` nightly, ~40 s. The positive controls run as one sweep —
14 × (break, run the named suite, revert, re-run) ≈ **12 min** — on demand and before each milestone
sign-off, not per commit.

**Device session:** 46 recorded runs across four iOS targets plus three non-iOS browsers, estimated
**2.5 h** of tester time including photographs, plus ~15 min of a second device for item 16, plus one
calendar follow-up eight days later for item 18's cap half. Blocked on hardware acquisition, which is
the only cost in this design that is not developer time.
