# A web-first viewer and reviewer for `.mdpkg`

Status: investigation. Evidence collected and measured on 2026-09-08 and 2026-09-09 on the same
Windows host the earlier investigations used. Nothing here is a design decision or a change to
[spec.md](../spec.md); §7 lists what a designer would still have to choose.

**The finding in one paragraph.** A web app can do the whole job — open a package, browse it, take a
review comment against a character range, and emit a conforming `delta` review package — with no
server and no native code, and the write half is demonstrated below on a real package that native
`git fsck --full --strict` accepts. The part that cannot be done from the web is the *inbound* iOS
Share Sheet: Web Share Target is unimplemented in WebKit and has been open and unassigned since
2019, with a published "neutral" position, so a page cannot appear in the iOS share sheet as a
destination at all. Every substitute is measured below; the only one that costs nothing and works
today is an ordinary `<input type="file">`, and WebKit's own file-picker code says it works *only*
if the `accept` attribute is left off or given an extension, never a MIME type. Outbound sharing is
the opposite story: `navigator.share({files})` is stable and on by default on every Cocoa platform
except watchOS and tvOS, and WebKit preserves the `.mdpkg` filename into the sheet.

---

## 1. What this investigates, and against what

The request had three parts: an evidence-based iOS Share Sheet integration path, in-browser viewing
that reuses the already-measured ZIP and Git-pack costs, and the in-browser review flow. The
existing measurements it reuses rather than repeats are
[compression.md](compression.md) (codec availability, decode timings, decoder delivery bytes),
[history.md](history.md) (isomorphic-git browser bytes, pack access boundaries, import timings),
[container.md](container.md) (the tail probe and file typing) and
[review-comments.md](review-comments.md) (the selector profile, thread shape, review-package
shapes and their measured sizes).

New measurement here is confined to four things: what a viewer's dependency set costs in browser
bytes; whether a bounded read of a real conforming package works and what it touches; whether a
page can *produce* a conforming review package from browser APIs alone; and the iOS platform
evidence, taken from WebKit's own source, MDN's compatibility dataset and Apple's documentation
rather than from blog posts.

The fixture packages are the two that [`docs/spec/worked-example.py`](../spec/worked-example.py)
emits, 4,986 and 6,322 bytes. They are small: they establish that a mechanism works and that three
independent implementations agree byte for byte, not what a read costs at corpus scale. Corpus-scale
byte figures below are quoted from the earlier investigations, which measured them.

---

## 2. iOS: every share-sheet path, and which one survives contact

### 2.1 Web Share Target is not available and is not close

| Manifest member | Chrome | Chrome Android | Safari | Safari iOS | WebView iOS | Firefox |
| --- | --- | --- | --- | --- | --- | --- |
| `share_target` | 89 | 76 | **no** | **no** (mirrors Safari) | **no** | no |
| `file_handlers` | 102 | no | **no** | **no** | **no** | no |
| `protocol_handlers` | 96 | no | **no** | **no** | **no** | no |

Source: MDN's compatibility dataset at the commit compression.md already pinned
([share_target](https://raw.githubusercontent.com/mdn/browser-compat-data/8f78ef6691bea90b55a975344ad7323130f20f36/manifests/webapp/share_target.json),
[file_handlers](https://raw.githubusercontent.com/mdn/browser-compat-data/8f78ef6691bea90b55a975344ad7323130f20f36/manifests/webapp/file_handlers.json),
[protocol_handlers](https://raw.githubusercontent.com/mdn/browser-compat-data/8f78ef6691bea90b55a975344ad7323130f20f36/manifests/webapp/protocol_handlers.json)),
hashed in [ios-evidence.json](viewer-app/ios-evidence.json). The dataset's own `impl_url` for the
Safari cell is [WebKit bug 194593](https://bugs.webkit.org/show_bug.cgi?id=194593), *Add support for
Web Share Target API*: reported 2019-02-13, status NEW, unassigned, no resolution as of
2026-09-09. WebKit's published standards position on the specification is
[neutral](https://github.com/WebKit/standards-positions/issues/11) — not harmful, not convinced it
is worth working on. WebKit's preference file, which names every gated feature including
`WebShareFileAPIEnabled`, contains no Web Share Target preference at all, so there is not even a
flag to turn on. The [Safari 27 beta feature list](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
names 58 features and none of them is share target, file handling, File System Access, downloads or
web-app installation.

Three consequences that should not be softened: a `.mdpkg` in the Files app cannot be sent *to* a
web app through the share sheet; a home-screen web app cannot register `.mdpkg` as a file it opens;
and a custom URL scheme cannot be registered either, so a `mdpkg://` deep link into the viewer is
also unavailable on iOS.

### 2.2 What iOS does give: outbound sharing, and it is better than expected

`Navigator.share` is Safari 12.1 and `Navigator.canShare` Safari 14, both mirrored to Safari iOS.
Files are behind a WebKit setting, and the default is in WebKit's own preference file:

```yaml
WebShareFileAPIEnabled:
  type: bool
  status: stable
  humanReadableName: "Web Share API Level 2"
  defaultValue:
    default: false
    WebKit:
      "PLATFORM(COCOA) && !PLATFORM(WATCHOS) && !PLATFORM(APPLETV)": true
      default: false
```

So file sharing is on by default in the modern WebKit port on iOS, iPadOS and macOS, in Safari and
in WKWebView, and off on watchOS and tvOS. Four details from the implementation matter to a package
viewer, and each is a line of WebKit source rather than an inference:

- **No MIME-type or size filter.** `Navigator::canShare` checks only that the setting is on and the
  file list is non-empty; there is no allowlist of shareable types. A package with an invented MIME
  type is not rejected at this layer.
- **The filename survives, so `.mdpkg` reaches the sheet.** `WKShareSheet` writes each file into a
  random temporary directory under `ResourceResponseBase::sanitizeSuggestedFilename(fileName)`, and
  `fileName` is the `File`'s own `name`. Nothing renames it.
- **But an unregistered extension shares as `public.data`.** `typeIdentifierForFileURL` asks
  `[UTType typeWithFilenameExtension:]` and falls back to `UTTypeData.identifier` when nothing is
  registered. "Save to Files", Mail and AirDrop accept `public.data`; an app that declares an
  interest in a narrower type will not offer itself. Until some app on the device declares the
  `.mdpkg` extension, the share sheet's app row is effectively empty and the useful destinations are
  the file-and-transport ones.
- **The whole package is copied into memory twice.** `ShareDataReader` loads every shared file with
  `FileReaderLoader::ReadAsArrayBuffer` and then copies the result into a `SharedBuffer` before the
  sheet opens. For the Rust-scale package in history.md that is a 3.3 MB blob, read into an array
  buffer and copied, in the web process, on a phone. This is the one measured-adjacent risk in the
  outbound path and it is a memory risk, not a compatibility one.

### 2.3 The inbound path that works today: the file input, with no `accept`

WebKit's iOS upload panel builds its picker types like this
(`WKFileUploadPanel.mm`): each `accept` MIME type goes through `UTType typeWithMIMEType:`, and each
`accept` *extension* is first mapped through `MIMETypeRegistry::mimeTypeForExtension` and only then
to a UTI. If the resulting set is empty, the picker is opened with `UTTypeItem.identifier` — which
matches anything.

That produces a rule with no ambiguity:

| `accept` value | `_acceptedUTIs` | What the Files picker allows |
| --- | --- | --- |
| absent | empty | any item |
| `.mdpkg` | empty — no MIME type is registered for the extension | any item |
| `application/zip` | `public.zip-archive` | only files that conform; a `.mdpkg` is `public.data`, so it is greyed out |
| `application/vnd.mdpkg` | empty — `typeWithMIMEType:` returns nil | any item |

So `<input type="file">` with no `accept`, or with `accept=".mdpkg"`, opens the Files browser and
lets the user pick the package; `accept="application/zip"` is the one plausible-looking choice that
breaks it. An empty accepted-UTI set also causes the panel to offer the photo and video pickers
alongside the document picker, which is cosmetic noise, not a failure.

This path needs no manifest, no installation and no Apple relationship, and it is the same code path
on macOS, Android and desktop. It costs the user two taps and it is the only inbound path in this
section that is not conditional on something Apple has declined to build.

### 2.4 The Shortcuts bridge: it can receive the file and cannot hand it over

The Shortcuts app *can* be a share-sheet destination for arbitrary files. Apple's own list of Share
Sheet input types includes **Files**, "any file, including documents, images, PDFs, zips, and more".
So a shortcut named "Review in mdpkg" genuinely appears in the sheet for a `.mdpkg`, and this is the
only way to get an entry in that sheet without shipping a binary.

The bridge breaks at the next step. The documented way for a shortcut to reach a web page is
`shortcuts://run-shortcut?name=[name]&input=[input]&text=[text]`, and `input` accepts "either a text
string or the word clipboard" — there is no file parameter, in either direction. A shortcut holding
a file therefore has exactly three ways to move it:

| Bridge | What it costs | Verdict |
| --- | --- | --- |
| `Get Contents of URL` POSTs the file to an endpoint, then `Open URL` opens the viewer with a token | a server that receives and stores the user's document; the whole "no server" property is gone | works, and defeats the point |
| Base64-encode the file into a URL the viewer opens | base64 is 4/3 of the input, so the npm-scale 171 KB package becomes a ~228 KB URL; iOS URL handling is not specified to carry that and no local device was available to find the real limit | not viable at package scale, unmeasured at any scale |
| `Save File` to a Files location, then the user picks it with §2.3's input | the shortcut adds a step and removes none | strictly worse than §2.3 |

The Shortcuts route is therefore a way to put a *name* in the share sheet, not a way to move bytes
into a web app. It is worth exactly one thing: a shortcut that saves the shared package to a known
folder so that §2.3's picker opens on it. That is a user-experience gain of one tap, at the cost of
asking every user to install a shortcut.

### 2.5 A Files-app "Open In" association requires a bundle, full stop

Apple's type-declaration documentation puts `UTExportedTypeDeclarations`, `UTImportedTypeDeclarations`
and `CFBundleDocumentTypes` in the app bundle's `Info.plist`, and there is no mechanism to declare a
type from outside a bundle. There is no web equivalent: `file_handlers` is the web platform's answer
and Safari does not implement it (§2.1). So "tap a `.mdpkg` in Files and it opens in the viewer" is
unavailable to a pure web app on iOS, by construction and not by oversight.

This has a Windows precedent already recorded in this repository: spec.md §3.8 measured that
"Windows Explorer refused the `.mdpkg` extension outright and wrote nothing". An unregistered
extension is inert on every platform that dispatches by extension or UTI; the format's answer so far
has been the 79-byte typing read, which is a reader's answer, not an operating system's.

### 2.6 The native wrapper, and what it actually buys

A thin WKWebView wrapper is the only thing that can declare the type, and it buys three things a web
app cannot have: the UTI declaration (so `.mdpkg` gets an icon, an "Open In" entry and a real type in
every share sheet on the device, including other apps' shares of the same file), a Share Extension
so the app is an inbound share destination, and `LSSupportsOpeningDocumentsInPlace` for editing
without a copy. It costs an Apple Developer Program membership, a release process, and exposure to
[guideline 4.2](https://developer.apple.com/app-store/review/guidelines/): "Your app should include
features, content, and UI that elevate it beyond a repackaged website." A wrapper whose only content
is the same web app is precisely the shape that guideline names, so the wrapper has to carry
something native — the type declaration and share extension are a start but are not obviously
"features, content, and UI".

The evidence does not support treating the wrapper as an alternative to the web app. It supports
treating it as an *optional companion* that, once installed, upgrades §2.2's `public.data` share and
§2.5's dead "Open In" for every other app on the device, including the web app's own downloads.

### 2.7 Android, for contrast, is not the same problem

Chrome Android has supported `share_target` since 76 and `navigator.share` since 61. An installed
PWA on Android can be a real inbound share destination for a `.mdpkg` with a manifest entry and a
POST handler in a service worker. `file_handlers` is desktop-Chrome only (102), so double-clicking a
package opens the app on Chrome desktop but not on Chrome Android. Any design that assumes one
share story across platforms will be wrong on one of them; the platforms differ in kind, not degree.

---

## 3. In-browser viewing

### 3.1 A bounded read works on a real package, and three implementations agree

[`viewer-app/mdpkg_reader.mjs`](viewer-app/mdpkg_reader.mjs) is a dependency-free conforming-tier
reader written for this investigation: §3.1 typing, the §3.5 tail read with its permitted
65,557-byte fallback, the central directory as the sole authority for names, methods, extents, CRCs
and sizes, and one entry decoded over an exact extent through
`DecompressionStream('deflate-raw')` with the CRC32 and length checked against the directory.
[`viewer-app/read_probe.mjs`](viewer-app/read_probe.mjs) runs it, and zip.js and fflate, over both
fixture packages through a source that counts every byte asked for.

<!-- READ_TABLE_START -->

| Package | Size | Reader | Typing | EOCD | Central directory | Entry | Total asked |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `full.mdpkg` | 4,986 | minimal | 79 | 22 | 719 | 149 | **969** |
| `full.mdpkg` | 4,986 | zip.js 2.8.7 | — | 22 | 719 | 149 | **890** |
| `full.mdpkg` | 4,986 | fflate 0.8.2 | — | — | — | — | **4,986** |
| `squashed.mdpkg` | 6,322 | minimal | 79 | 22 | 930 | 149 | **1,180** |
| `squashed.mdpkg` | 6,322 | zip.js 2.8.7 | — | 22 | 930 | 149 | **1,101** |
| `squashed.mdpkg` | 6,322 | fflate 0.8.2 | — | — | — | — | **6,322** |

<!-- READ_TABLE_END -->

All three return the same 163 bytes of `guide.md`, SHA-256
`1cf920f3e2f91322b12e08c6edd7c2532d429a42adb2bcf7b22a96b73172b4f8`. The 149-byte entry figure is 30
bytes of local header plus the 119-byte DEFLATE stream; §3.4's rule that nothing is taken from the
local header is why only its two length fields are read.

The structural checks the probe makes on both fixtures — manifest first at offset 0, pack last, only
methods 0 and 8, internal attributes zero on every entry (D-19), EOCD comment length zero — all pass.
The typing check accepts both packages in exactly 79 bytes and rejects random bytes, an empty file, a
78-byte truncation, a corrupted signature and a renamed first entry, each in at most 79 bytes and
without reading the archive. That reproduces container.md's typing result on a second implementation.

Two honest qualifications. The fixtures are small, so 969 of 4,986 bytes is 19.4% and means nothing
about corpus scale; spec.md §3.2 measured the real prize, which is not transferring the pack —
158,993 bytes on npm and 3,312,561 on Rust for a full no-history browse. And zip.js reads slightly
less than the minimal reader only because it does not do the 79-byte typing read; it is not a
cheaper reader, it is a reader that skips a check the format requires.

One implementation detail cost half an hour and belongs here so it costs nobody else any: zip.js
constructs `DataView`s from the returned array's `buffer`, so a custom range `Reader` must return a
standalone buffer, not a `subarray` view into the package. A view silently yields "Central directory
header not found".

### 3.2 What the viewer's dependencies cost in browser bytes

Measured the same way [`history/build_web.mjs`](history/build_web.mjs) measured its own: exact
minified, tree-shaken ESM bundles from esbuild 0.25.9, gzip level 9, no worker assets, no UI, no
persistent filesystem. The Buffer shim is injected only into the isomorphic-git slices and its bytes
are counted there.

<!-- ASSETS_START -->

| Slice | What it is | Raw JS bytes | Gzip bytes |
| --- | --- | ---: | ---: |
| `mdpkg-minimal-reader` | this investigation's §3.1 reader | 3,347 | **1,565** |
| `mdpkg-minimal-writer` | this investigation's §4.2 writer | 2,125 | **918** |
| `fflate-unzip` | `unzipSync` only | 5,397 | **2,712** |
| `fflate-zip-unzip` | `zipSync` + `unzipSync` | 12,449 | **6,047** |
| `zip-read-native` | zip.js reader, native-codec build | 138,212 | **66,076** |
| `zip-readwrite-native` | zip.js reader and writer, native-codec build | 155,923 | **71,883** |
| `zip-read-wasm-fallback` | zip.js reader, WASM build (plus a 50,195-byte `.wasm` at runtime) | 124,658 | **58,505** |
| `commonmark-parse` | `Parser` only | 159,521 | **47,999** |
| `commonmark-parse-render` | `Parser` + `HtmlRenderer` | 159,549 | **48,014** |
| `git-read` | isomorphic-git `log`, `readBlob` | 166,033 | **53,773** |
| `git-write-review` | isomorphic-git `init`, `writeBlob`, `writeTree`, `writeCommit`, `writeRef`, `packObjects`, `indexPack` | 160,804 | **52,363** |

<!-- ASSETS_END -->

`git-read` reproduces history.md's 166,033 raw / 53,773 gzip exactly, which is the cross-check that
this harness is measuring the same thing that one did.

Reading those numbers:

- **zip.js is 42× the minimal reader gzipped, and buys things this format does not need.** It is
  excellent general-purpose software — encryption, ZIP64, split archives, multi-core workers,
  `HttpRangeReader` — and the container profile permits methods 0 and 8, no encryption, and rejects
  ZIP64 as the only tested behaviour (§3.5). Most of those 66 KB implement cases a conforming
  package cannot contain. Its `HttpRangeReader` is a genuine asset and is ~150 lines of the total.
- **fflate at 2,712 gzipped is the right *fallback*, not the right reader.** It has no range reader:
  `unzipSync` takes the whole archive, which is exactly the 158,993/3,312,561 bytes §3.2 exists to
  avoid. Its value is its JS inflater for engines below Chrome 103 / Firefox 113 / Safari 16.4, the
  `deflate-raw` floor compression.md established, at the 2,112-gzipped figure that investigation
  already measured for the gunzip import.
- **CommonMark is the largest fixed cost in the viewer and it is not optional.** §6.1 rule 2 pins
  identity to "CommonMark 0.31.2 without smart punctuation". A smaller Markdown parser can render
  the document; it cannot decide where a section starts, and a section boundary that disagrees with
  the profile produces a different scoped digest and therefore a wrong `flagged-changed`. Rendering
  costs 15 more gzipped bytes on top of parsing, so the split is 48 KB for identity and nothing for
  rendering — the whole cost is the conformance requirement, not the display.

Assembled floors, gzipped, decoder and parser only:

| Capability | Bytes |
| --- | ---: |
| Type, list and read one document, no identity | 1,565 |
| The above with the pre-`deflate-raw` JS fallback | 4,277 |
| Browse with correct section identity | 49,564 |
| The above plus document history | 103,337 |
| The above plus emitting a review package | 156,618 |

These are library bytes. A production reader adds a UI, a Markdown renderer's output styling, a diff
renderer and a ZIP mount; history.md said the same about its own numbers and it is still true.

### 3.3 What the earlier measurements already settle about the read path

Nothing here needs to re-measure decode. From compression.md: a native `DecompressionStream` entry
decode is 1.4 ms first / 0.2 ms warm in Chrome and 1.0 ms / <1 ms in Firefox, against 51.7–75.0 ms
and 12.5–31.1 MiB of renderer growth for materializing the whole 9.4 MB workload; `deflate-raw` is
native from Chrome 103, Firefox 113 and Safari 16.4, with WKWebView following its installed WebKit.
From history.md: a document's whole history in the browser is 76–136 ms warm on npm and 234–350 ms on
Rust, isomorphic-git reads the entire `.pack` and `.idx` through `readFile` regardless of target
(157,750 / 3,310,333 bytes), and its bundled inflater is Pako rather than the native stream.

Two things follow for a viewer and neither is new evidence, only its consequence. First, the fast
path — open, list, read one document — is genuinely free and needs no history machinery at all,
which is what makes the 1,565-byte reader a real option rather than a curiosity. Second, history is
a separate 53,773-gzipped-byte, hundreds-of-milliseconds feature over a library that pulls the whole
pack into memory, so a viewer that loads it eagerly pays Rust-scale costs on every package.
compression.md's "mobile qualification is open" caveat is unresolved and applies here directly:
every timing in both investigations is a desktop timing.

### 3.4 Keeping a package between visits, and the seven-day cap

Origin Private File System is available in Safari 15.2 (`FileSystemFileHandle`, `getFile`,
`createSyncAccessHandle`), with `createWritable` only from Safari 26; WebKit's preference file has
`FileSystemWritableStreamEnabled` true on Cocoa. There is no `showSaveFilePicker` in WebKit at all,
which is the same fact from the other side: the File System Access API's local-disk half is
Chromium-only, and OPFS is the portable half.

The constraint on top of it is WebKit's [seven-day cap on all script-writable
storage](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) — IndexedDB,
LocalStorage, media keys, SessionStorage, service worker registrations and cache — after seven days
of Safari use without user interaction on the site. A package a user opened once and came back to a
fortnight later is gone. The documented exemption is the one that matters here: "Web applications
added to the home screen are not part of Safari and thus have their own counter of days of use."
So the home-screen web app is worth having on iOS not for share target, which it does not get, but
for storage that survives.

---

## 4. In-browser review

### 4.1 From a text selection to a `cm0312-quote-context-v1` selector

[`viewer-app/review_probe.mjs`](viewer-app/review_probe.mjs) implements §6.1 rules 2–5 over a real
CommonMark 0.31.2 parse (top-level headings only, via `sourcepos`), §6.2's heading trail with
occurrence counting, §6.1 rule 6's scoped digest and §6.2's default root, all through Web Crypto and
`TextEncoder` — browser APIs, not Node ones. For `## Usage` of `guide.md` in `full.mdpkg` it produces

```
root   52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70
expect 684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa
```

and both strings appear verbatim in [`docs/spec/worked-example.json`](../spec/worked-example.json),
which the Python emitter produced independently. A JavaScript implementation of the two profiles
agrees with the specification's own emitter on a real package. That is the single most useful result
in this section: the identity layer is portable to the browser without a re-derivation.

Selector creation from a selection is then arithmetic on the canonical scope source. Selecting
"produce a package" in a 72-character scope yields

```json
{"start": 25, "end": 42, "quote": "produce a package", "occurrence": 0,
 "prefix": "## Usage\n\nRun `build` to ", "suffix": ".\nRun `check` to validate it.\n"}
```

with `prefix` and `suffix` truncated at the scope boundary as §2.4 of review-comments.md requires,
and `occurrence` counted by scanning for earlier matches. The one piece a browser adds and this probe
does not have is the mapping from a DOM `Selection` back to a character offset in the *source*: the
selection is over rendered HTML, and the offset must be in the canonical scope source. That is a
real gap and §7 records it.

### 4.2 A page can emit a conforming review package, and native Git accepts it

The probe builds a `delta`-shape review package (review-comments.md §7.4) with no server and no
native Git:

1. `.mdpkg/review/comments.json` in canonical JSON, one thread, one comment: **1,015 bytes**.
2. A curated repository built with isomorphic-git 1.41.9 in an in-memory filesystem —
   `writeBlob`, three `writeTree` calls for `.mdpkg/review/`, `writeCommit`, `writeRef`, then
   `packObjects` and `indexPack`: a **966-byte** pack of 5 objects and a **1,212-byte** index.
3. The ZIP assembled by [`viewer-app/mdpkg_writer.mjs`](viewer-app/mdpkg_writer.mjs), 2,125 raw
   bytes of code, using `CompressionStream('deflate-raw')`: manifest stored first at offset 0 with
   the `mdpkg` key written first so the magic lands at byte 50, method 8 elsewhere and 0 where
   DEFLATE does not help, pack and index stored, internal attributes 0 on every record, zero-length
   EOCD comment.

Total: **4,634 bytes**, against review-comments.md §5.2's 4,832 bytes for the Python emitter's
one-thread fixture review package. Different content, so not a byte comparison, but the same order
and the same shape.

[`viewer-app/validate_review.py`](viewer-app/validate_review.py) then checks it with tools that know
nothing about the browser:

| Check | Result |
| --- | --- |
| `zipfile.testzip()` | `None` |
| EOCD comment | empty |
| Internal attributes on every record | 0 |
| Compression methods present | {0, 8} |
| First entry, header offset | `.mdpkg/manifest.json`, 0 |
| Bytes 50–78 | `{"mdpkg":"markdown-package/1"` |
| `git read-tree HEAD` | exit 0 |
| `git status --porcelain` | only `?? .mdpkg/history.json`, `?? .mdpkg/manifest.json` |
| `git fsck --full --strict` | **exit 0**, no output |
| `git rev-parse HEAD` vs manifest `current` | equal |
| `git ls-tree -r --name-only HEAD` | `.mdpkg/review/comments.json` only |

The last row is review-comments.md §7.4's safety rule for the `bundled` shape — "a review commit MUST
change only paths under `.mdpkg/review/`" — checked mechanically; the same check is what a validator
would run on a `bundled` package to decide whether B stayed inside its lane.

Two limits of the browser writer, both real and neither fatal. `CompressionStream` exposes no level,
so a page cannot emit §3.3's "producer level 6"; §3.3 makes level producer policy and readers accept
any valid DEFLATE stream, so the output is conforming but not byte-identical to a level-6 emitter,
and a page therefore cannot reproduce another producer's package byte for byte. And §4's manifest
exception — `mdpkg` written first, everything else sorted — is a rule a writer must know: emitting
plain canonical JSON puts `anchor` first, the magic never reaches byte 50, and the package fails its
own §3.1 typing check. The probe hit exactly that and the fix was four lines.

### 4.3 Getting the file back out

| Path | Availability | Notes |
| --- | --- | --- |
| `navigator.share({files})` | Safari 12.1/14 + files on by default on Cocoa except watchOS/tvOS; Chrome Android 61+ | §2.2. Filename preserved, UTI `public.data`, whole file copied into memory twice |
| `<a download>` on a blob URL | `DownloadAttributeEnabled` defaults true in the WebKit port | the ordinary path; on iOS it lands in the Downloads folder the user has configured |
| `showSaveFilePicker` | Chromium only; absent from WebKit entirely | not a portable option |
| OPFS | Safari 15.2, `createWritable` Safari 26 | keeps it in the app, not on the user's disk (§3.4) |

The honest shape of the round trip on iOS is therefore asymmetric: **out** is a first-class share
sheet with the right filename, **in** is a file picker the user drives. Machine B can share the
review package straight into Mail or Files; machine A gets it back by picking it.

---

## 5. What the evidence constrains, without deciding it

Stated as constraints a design must satisfy, not as a design:

1. The inbound iOS path is `<input type="file">` with no MIME `accept`, or a native companion. There
   is no third option that moves bytes.
2. The outbound iOS path is `navigator.share({files})` with a `.mdpkg` filename, falling back to
   `<a download>`. Both are available; neither needs a server.
3. A viewer that only browses needs 1,565 gzipped bytes of container reader; everything above that
   is identity (48 KB, mandatory for correct section boundaries), history (54 KB, optional and
   expensive) and review emission (53 KB, only on the reviewer's machine). These separate cleanly and
   the measurements say what each costs.
4. Nothing in the read or write path requires a server. The write path is demonstrated end to end
   against native `git fsck`.
5. Storage that survives requires the home-screen web app on iOS, and even then OPFS rather than
   IndexedDB is the durable half.
6. Off-the-shelf covers the Git layer completely (isomorphic-git, already measured twice) and the
   Markdown layer completely (commonmark, pinned by the profile). It does not cover the container
   layer: zip.js is 42× the size of what the profile needs and fflate cannot do a bounded read. The
   ~150 lines measured here are the novel work, and they are small because §3 did the design work.

---

## 6. Not done, noted

One line each, as ideas for whoever plans this, not as design:

- A `Selection` → canonical-source-offset mapping could be got for free by rendering from the source
  with a per-node source-offset attribute, since commonmark's `sourcepos` already carries it.
- zip.js's `HttpRangeReader` is the one part of zip.js worth having; the minimal reader's `read(o,n)`
  source interface is already the same shape.
- A shortcut that saves a shared package into a fixed Files folder would cut §2.3 from two taps to
  one, at the cost of an install step.
- The native companion, if it happens, is worth more as a type declaration plus share extension than
  as a wrapper around the web app.

---

## 7. Open questions this investigation could not close

1. **No iOS device was available.** Every iOS claim above is from WebKit source, MDN's dataset or
   Apple documentation; none is a device measurement. Specifically unverified: whether CFNetwork's
   `suggestedFilename` path leaves `.mdpkg` alone or appends an extension for a disagreeing MIME
   type; what the share sheet actually offers for a `public.data` file; whether a multi-megabyte
   `navigator.share` succeeds on a phone; the real URL-length ceiling for §2.4's base64 bridge.
2. **No mobile browser measurement at all**, which is the same gap compression.md and history.md
   left open. Every timing reused here is desktop.
3. **The fixtures are 5–6 KB.** The bounded-read mechanism is demonstrated; its byte economics at
   corpus scale are quoted from spec.md §3.2, not re-measured here.
4. **Whether `.mdpkg` should be registered as a MIME type or a UTI at all** is spec.md §11.1's open
   question, and §2.2's `public.data` fallback and §2.5's Windows precedent are two more data points
   for it rather than an answer.
5. **The `bundled` review shape was not built in the browser** — only `delta`. Bundling requires
   copying A's pack and adding a commit on top of `reviewOf.current`, which needs the reviewer to
   read and re-emit A's pack; isomorphic-git can do it and the cost was not measured.
6. **Multi-package and multi-thread scale untested.** One thread, one package, one document.

---

## 8. Reproduction and evidence

```
mkdir -p .antiphon/viewer-work/js
cp docs/investigations/viewer-app/package.json docs/investigations/viewer-app/package-lock.json .antiphon/viewer-work/js/
npm --prefix .antiphon/viewer-work/js ci
python docs/spec/worked-example.py <abs-path>/.antiphon/viewer-work/fixture
node   docs/investigations/viewer-app/build_web.mjs    # -> bundle-results.json
node   docs/investigations/viewer-app/read_probe.mjs   # -> read-probe-results.json
node   docs/investigations/viewer-app/review_probe.mjs # -> review-probe-results.json
python docs/investigations/viewer-app/validate_review.py   # -> validation-results.json, exit 0
```

`worked-example.py` needs Git and writes to an absolute output path. Node 24.6.0, npm 11.5.1,
Python 3.10.2, Git 2.50.1 on Windows 10. Pinned: `@zip.js/zip.js` 2.8.7, `fflate` 0.8.2,
`commonmark` 0.31.2, `isomorphic-git` 1.41.9, `buffer` 6.0.3, `esbuild` 0.25.9.

| Artifact | What it holds |
| --- | --- |
| [`viewer-app/mdpkg_reader.mjs`](viewer-app/mdpkg_reader.mjs) | the §3.1/§3.3/§3.5 bounded reader |
| [`viewer-app/mdpkg_writer.mjs`](viewer-app/mdpkg_writer.mjs) | the browser-API ZIP writer |
| [`viewer-app/build_web.mjs`](viewer-app/build_web.mjs) | bundle-size harness |
| [`viewer-app/read_probe.mjs`](viewer-app/read_probe.mjs) | bounded read, three implementations, rejection cases |
| [`viewer-app/review_probe.mjs`](viewer-app/review_probe.mjs) | selector creation and review-package emission |
| [`viewer-app/validate_review.py`](viewer-app/validate_review.py) | acceptance by `zipfile` and native Git |
| [`viewer-app/bundle-results.json`](viewer-app/bundle-results.json) | §3.2, with per-slice SHA-256 |
| [`viewer-app/read-probe-results.json`](viewer-app/read-probe-results.json) | §3.1, with every range asked for |
| [`viewer-app/review-probe-results.json`](viewer-app/review-probe-results.json) | §4.1, §4.2 |
| [`viewer-app/validation-results.json`](viewer-app/validation-results.json) | §4.2's table |
| [`viewer-app/ios-evidence.json`](viewer-app/ios-evidence.json) | every §2 source, with URL, size and SHA-256 |

The WebKit files in `ios-evidence.json` were fetched from the tip of the default branch, which
moves; they are hashed so a re-reader can tell whether the quoted code has changed. The MDN
compatibility files are pinned to commit `8f78ef66` — the same commit compression.md pinned, so the
two investigations quote one dataset.
