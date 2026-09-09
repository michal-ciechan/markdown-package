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

Gz figures are library bytes on the always-loaded path; UI, styling and a diff renderer are on top,
and the same caveat the investigation made about its own numbers applies here.

| M | Milestone | Ships | Eager gz | Retires |
| --- | --- | --- | ---: | --- |
| M1 | **Open and browse.** File picker → 79-byte typing → central directory → document list → one document rendered | slices 0, 1, 2 | ~1,565 | The largest external unknown: does the iOS picker actually hand over a `.mdpkg` |
| M2 | **Identity.** Outline, heading trail, scoped digest, default root, cross-checked against the committed worked example | slice 3 | ~49,564 | That the identity layer is portable to the browser without re-derivation |
| M3 | **History, eagerly.** `history.json` and summaries from the current view; isomorphic-git over the ZIP-mounted pack | slice 4 | ~103,337 | D-3's cost on a real device (M6 item 8) |
| M4 | **Review capture.** Selection → source offset, selector minting, `comments.json` in canonical JSON | slices 5, 6 | no new libs | N4, the one piece with no prior art |
| M5 | **Emit and share.** In-memory Git repo → pack → conforming ZIP → `navigator.share` / `<a download>` | slices 7, 8 | ≤156,618 upper bound; the shared-chunk figure gets measured here | That a page can emit something native Git accepts, on a phone |
| M6 | **Round trip on real devices.** §6's checklist, end to end, B emits and A resolves | slices 9, 10, 11 | — | Investigation §7 item 1 — every iOS claim is currently source-derived, not device-measured |

M1 and M6 are the two that produce evidence nobody in this repository has. M2–M5 are mostly the
promotion of code that already agrees with an independent implementation.

---

## 5. Slices

Each slice names its files and its tests. Paths are proposed; `app/` is new.

**Slice 0 — Skeleton and size gate.**
Files: `app/package.json` (the five pins above), `app/index.html`, `app/src/main.js`,
`app/build.mjs`. `build.mjs` reuses the method of
[`docs/investigations/viewer-app/build_web.mjs`](../../investigations/viewer-app/build_web.mjs) —
esbuild, minified, tree-shaken ESM, gzip level 9 — and emits a per-chunk report.
Tests: the build fails when the always-loaded chunk exceeds its budget; the report's `git-read` slice
still reproduces 166,033 raw / 53,773 gz, which is the cross-check that the app's harness measures
the same thing the investigation's did.

**Slice 1 — Container read, hardened.**
Files: `app/src/container/reader.js` (from `mdpkg_reader.mjs`), `app/src/container/source.js`
(Blob-backed and byte-backed sources that return **standalone buffers, never `subarray` views** — the
half hour the investigation records losing), `app/src/container/conformance.js`.
Adds over the probe: ZIP64 sentinel detection with rejection (spec §3.5's only tested behaviour), the
§3.7 recoverable tier, §3.6 name checks (forward slash, no `..`, NFC-plus-simple-case-fold uniqueness,
reserved-prefix), and internal-attributes-`0` reported as nonconformance rather than ignored.
Tests: both fixtures decode `guide.md` to SHA-256 `1cf920f3…`; a byte ledger asserts the recorded
totals — **969** on `full.mdpkg` and **1,180** on `squashed.mdpkg` — so a regression that reads the
whole archive fails loudly; the five recorded rejections (random bytes, empty, 78-byte truncation,
bad signature, first entry renamed) each in at most 79 bytes; a ZIP64-sentinel fixture rejects; a
re-zipped fixture types as recoverable, not conforming.

**Slice 2 — Browse.**
Files: `app/src/ui/documents.js`, `app/src/ui/reader-view.js`, `app/src/inbound/open.js` (the single
`openPackage(blob)` entry point of D-13, called by the file input, drag-drop and paste).
Tests: opening `squashed.mdpkg` lists **two documents** out of **12 entries**, hiding the `.mdpkg/`
and `.git/` reserved prefixes; `guide.md` renders and its source is the 163 bytes.

**Slice 3 — Identity.**
Files: `app/src/address/outline.js`, `app/src/address/digest.js`, `app/src/address/root.js` —
promoted from `review_probe.mjs`.
Tests: **the golden cross-check.** For `## Usage` of `guide.md` in `full.mdpkg`, root
`52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70` and expect
`684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa`, asserted against
`docs/spec/worked-example.json` rather than against a hand-written constant. Plus the ledger case: the
default root of `["section","guide.md",[["# Guide",0],["## Setup",0]]]` is `b6564987…7984`, which the
committed 195-byte ledger keys on.

**Slice 4 — History, eagerly.**
Files: `app/src/history/descriptor.js` (`history.json`, `bindings.json`, range summaries — current-view
entries, no pack, no library), `app/src/history/gitfs.js` (N7, the ZIP-mounted filesystem),
`app/src/history/git.js` (the separately-chunked isomorphic-git module, imported eagerly per D-3),
`app/src/history/budget.js` (records bytes read and ms elapsed, for M6 item 8).
Tests: the descriptor parses on both fixtures and its `transform` list agrees with the manifest, which
is the disagreement spec §4 makes a validator reject; a `log` walk on `full.mdpkg` returns
`c0 → c1 → c2` and on `squashed.mdpkg` returns `c0 → s1`; `readBlob` of `guide.md` at `current`
returns bytes identical to the current-view ZIP entry, which is the current-view-equals-tip-tree
property checked from the reader's side; the budget recorder emits a number.

**Slice 5 — Selection to source offset. (Spike first.)**
Files: `app/src/render/annotate.js` (a commonmark renderer subclass carrying `sourcepos` onto block
elements), `app/src/render/line-index.js`, `app/src/render/source-map.js`.
Tests: a table of selections over `guide.md` whose expected offsets are computed from the source
directly, including the investigation's own case — selecting `produce a package` in the 72-character
`## Usage` scope yields `start 25, end 42`; a selection that begins in one block and ends in another;
a selection inside emphasis, inside a code span, and inside a list item, which are the three places
block-level `sourcepos` plus intra-block arithmetic is most likely to break; a selection that spans a
section boundary, which §6.8 says is two anchors or one on the common ancestor and must therefore be
detected rather than silently clamped.

**Slice 6 — Selector and `comments.json`.**
Files: `app/src/review/selector.js` (from `makeSelector`), `app/src/review/comments.js`.
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
Files: `app/src/review/emit.js`, `app/src/container/writer.js` (from `mdpkg_writer.mjs`).
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
Files: `app/src/share/out.js`.
Tests: with `canShare` stubbed true, `share` receives one `File` whose name ends `.mdpkg` and whose
bytes are the emitter's exact output; with it false, an `<a download>` is created with the same name
and the blob URL is revoked; neither path is reachable without a successful self-type first.

**Slice 9 — Resolution.**
Files: `app/src/review/resolve.js`.
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
Files: `app/src/store/opfs.js`, `app/src/store/sync-worker.js`, `app/src/ui/install-prompt.js`.
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
