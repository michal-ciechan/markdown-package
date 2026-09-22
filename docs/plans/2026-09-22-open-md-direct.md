# Opening a loose `.md` directly: what works today, and the smallest way to add it

Date: 2026-09-22. Investigate task `2659ea86`. Investigated at commit
`c725838` (master). **No production code was changed.** Every measurement
below was taken by importing the shipped viewer modules from a throwaway
script outside the repo; the prototype synthesizer in §2.2 exists only in
that script.

**Status (2026-09-22, CARD-0062 follow-on build, task `dd696119`): BUILT.**
Both open decisions in §5 were taken by the user and are recorded as DECIDED
below; §5.3 and §5.4 were taken with them. The "smallest first step" this note
recommends is closed out: `src/web-viewer/src/inbound/loose.js` exists with
Node unit tests (`tests/loose.test.mjs`), `receive()` routes on the ZIP
signature, and the review-export caveat ships. The CLI is untouched, as this
note recommends, and §4's amendments to the native plan still stand as
described (they are that plan's to apply).

**Review 30af66b7 (task `eb6d82e2`): three defects found and fixed.**
(1) The loose flag reached the review panel as a defaulted `setPackage(value,
loose = false)` argument, so the two `persistence/session.js` call sites that
re-run `reviews.setPackage(getPackage())` — "Delete saved work" and the
recovery discard — silently cleared it, and the export caveat disappeared
while the same synthesized package was still open and still exportable.
Looseness now lives in a `WeakSet` keyed on the opened package object
(`markLoose`, `ui/review-view.js`), so every call site preserves it, including
ones written later. (2) `packageBytesFor()` buffered the whole blob with
`arrayBuffer()` before `synthesizeLoose` could reject it, contradicting the
claim in §6 that the cap refuses before decoding; it now refuses on
`blob.size` first and reads nothing. (3) The routing sniff matched only the
two bytes `PK`, so a Markdown file opening with the word PKCS or PKI was sent
to `openPackage` and failed with a container error; it now matches the three
full four-byte ZIP signatures (`PK\x03\x04`, `PK\x05\x06`, `PK\x07\x08`).
A truncated `.mdpkg` still begins `PK\x03\x04` and still reports a container
error. Four regression cases were added to `tests/loose.spec.js`.

**Review 6ad4a13a (task `44f45a6c`): one weak test repaired.** The defect-3
regression case used the fixture `# PKCS #11 notes`, whose first two bytes are
`# ` - the *old* two-byte sniff already routed it to the loose path, so the
case passed identically before and after the fix and guarded nothing. Its
fixture is now a Setext heading (`PKCS#11 notes` over `=====`), so `P` and `K`
really are the file's first two bytes, and a second minimal case opens a file
that is literally `PK

Not a container.
`. Both fail against the old
predicate (main.js at `1b6db9e`) and pass at HEAD.

Scope: the *current* browser web-viewer and the generator CLI. The native
shell's loose-`.md` handling is already decided (D3 and items I, L, M of
`docs/plans/2026-09-18-native-viewer-shells.md`) and is not redesigned here.
This note answers the four questions that decision left open for the
pre-native-app tooling, and says what the native plan must change as a result
(§4).

---

## 0. Outcome

**Q1. Does anything support a bare `.md` today? No — in either tool.**
The web-viewer rejects a loose `.md` at the ZIP layer before any Markdown code
runs (`"No complete EOCD ending at EOF"`), and the CLI has no viewing verb at
all. Reproduced, §1.

**Q2. Can the browser viewer support it with a small, well-scoped change?
Yes.** A ~25-line synthesizer that wraps the file's bytes into an in-memory
conforming snapshot and hands the bytes to the existing `openPackage()` was
prototyped end to end at this commit. The result opens at `conforming` tier
with **zero conformance findings**, outlines, addresses, resolves a generated
reference to `survives / same-source`, passes full `verifySnapshot()`
(`assurance: snapshot-verified`), and exports a delta review. Nothing in the
container reader, addressing, review or persistence *logic* has to change.
Evidence and the prototype, §2.

**Q3. Semantic gaps? Two need a product decision; the rest are empty
states or error messages.** The two are (a) **which namespace a file that
never had one gets** — this is R11, and it is not deferrable to the native
app because browser resume/recents are keyed on it too, and the browser has
no stable file path to derive from; and (b) **what a delta review exported
against a synthesized file means**, because that export *is* published and
its `review.of` then names a (namespace, snapshot id) pair that exists
nowhere. Everything else — no history panel, no author/timestamp — is not a
gap at all: a snapshot-mode `.mdpkg` from `mdpkg pack` carries exactly the
same (absence of) metadata, and the viewer has no history UI to leave empty.
Full table, §3.

**Q4. Effect on the native phase 1 (W1–W5)? Purely additive, and it
*removes* work from W3** — which already owns the synthesizer (item I). Two
one-line amendments to the plan are needed, not a redesign: R11 must be
answered now rather than at W3, and the synthesizer's identity must be a
**caller-supplied parameter** rather than "path-derived", because the browser
has no path. §4.

### Recommendation

Build the synthesizer now, in the browser viewer, as a standalone pure module
with Node unit tests, **before** any UI wiring. It is the single artifact both
paths share; proving it in the browser lane is far cheaper than proving it
behind an ~18-minute Tauri release build (item K), and it is the same artifact
the watcher's identity gate (item L) later needs.

**Smallest first step, in order** (all three DONE — see the status note at the
top; the build is commits `8625827` and `69f63e0`):

1. **`src/web-viewer/src/inbound/loose.js`** — `synthesizeLoose(bytes, name,
   {identity})` returning package bytes, plus `looseNamespace(identity)`.
   Pure, no DOM, no UI. Unit tests in `tests/` (the Node suite already
   exercises `writePackage` + `snapshotIdentity` this way, e.g.
   `tests/snapshot.test.mjs:23`). Ships behind no flag because nothing calls
   it yet. **Gated on decision 1 in §5 only for the default identity; the
   function takes `identity` as a required argument either way.**
2. One route in `receive()` (`src/web-viewer/src/main.js:106-112`), guarded by
   a ZIP-signature test, keeping the *original* `File` as `source.blob` (§2.4).
3. Copy changes (§3, row 10) and one Playwright case.

Step 1 is the deliverable that matters and is independently useful; steps 2
and 3 are small and can follow in the same card.

All three shipped in one card. Step 3 became `tests/loose.spec.js` (seven
Chromium cases) plus a persistent `.loose-note` line in `#package-details`
rather than a change to the header copy: the `#activity` status region is
transient (the opened document's name replaces it immediately), so a
synthesized lineage needs a label that stays on screen.

---

## 1. What the current tooling does with a bare `.md`

### 1.1 Web viewer: rejected at the ZIP layer

There is exactly one inbound boundary. The file input
(`main.js:254-258`), the drop handler (`:262-267`) and the paste handler
(`:268-273`) all call `receive()`, which calls
`openPackage(blob)` (`main.js:112`) — the module comment at
`src/inbound/open.js:8` states this is "the one inbound boundary for file
input, drag/drop, paste and future routes". `openPackage` immediately calls
`openContainer(blobSource(blob))` (`open.js:10`), which reads a ZIP end-of-
central-directory record (`container/reader.js:160`) and then demands an
exact `.mdpkg/manifest.json` entry (`reader.js:163-164`).

Measured at `c725838`:

| Input | Result |
| --- | --- |
| `new File(['# Title…'], 'notes.md')`, under 22 bytes | throws `No end of central directory record` (`reader.js:37`) |
| a ~210-byte `.md` | throws `No complete EOCD ending at EOF` (`reader.js:63`) |
| empty file | throws `No end of central directory record` |

The user-visible result is `Could not open package: No complete EOCD ending
at EOF` in the status region (`main.js:163`). This is the same for the
picker, drag-drop and Ctrl+V, because all three share `receive()`.

Two things that are *not* obstacles, worth recording because they are the
usual blockers for this kind of change:

- The file input carries **no `accept` attribute** and that is deliberate
  (`main.js:253`: "the iOS picker must include public.data"), so a `.md`
  is already selectable in the existing picker with no markup change.
- The enhanced File System Access picker calls `showOpenFilePicker({multiple:
  false})` with no type filter (`inbound/file-access.js:4`), so it too already
  offers `.md`.

So the only thing standing between the existing UI and a loose `.md` is the
conversion in `receive()`.

### 1.2 Generator CLI: there is no viewer

`MdpkgCli.Build()` attaches exactly four verbs — `pack`, `update`, `address`,
`validate` (`src/generator-cli/src/Mdpkg.Cli/MdpkgCli.cs:47-50`). None of them
renders or displays a document; `validate` and `address list` print findings
and the ledger. The CLI is a producer and a checker, not a reader UI, so
"open a bare `.md` in the CLI" has no existing surface to extend.

The nearest thing that exists today is the manual workaround: put the `.md`
in a directory and run `mdpkg pack <dir> --out x.mdpkg --namespace <uuid>`
(`Commands/PackCommand.cs:11` takes a `DirectoryInfo`; `--namespace` is
required, `:57-61`), then open `x.mdpkg` in the viewer. That produces exactly
the same class of artifact the synthesizer produces in memory — a
history-free snapshot — which is the core reason §3 has so few real gaps.

---

## 2. The smallest change to the current web viewer

### 2.1 The idea, and why it is small

The viewer already contains every piece: a ZIP writer (`container/writer.js`
`writePackage`), the snapshot identity function (`container/snapshot.js:14-25`
`snapshotIdentity`), the canonical-JSON manifest encoder (`format.js:39`) and
the profile constants (`format.js:3-4`). `emitReview()`
(`src/review/emit.js:8-22`) already assembles a conforming two-entry snapshot
package from those pieces in fourteen lines. The synthesizer is the same
shape with the review fields removed and the document substituted for the
comments file.

Critically, **all of those modules are already in the eager bundle** — they
are reached statically through `main.js` → `persistence/session.js` →
`persistence/model.js` → `review/emit.js` → `container/writer.js`, and
`container/reader.js` → `container/snapshot.js`. Verified: the built
`dist/main.js` contains both `deflate-raw` (writer) and `mdpkg-snapshot-v1`
(snapshot identity). So the synthesizer costs only its own source against the
R9 budget, which currently reads **95,766 / 145,000 eager gzip bytes**
(`node build.mjs`, `build.mjs:34`).

### 2.2 Prototype (proven at `c725838`, not committed)

```js
async function synthesize(file, {namespace}) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const text = decode(raw).replace(/\r\n?/g, '\n');        // snapshotIdentity rejects CR
  const bytes = utf8.encode(text);
  const path = file.name || 'document.md';
  const manifest = {mdpkg: 'markdown-package/1', namespace, current: {kind: 'snapshot', id: ''},
    addressing: {anchor: ANCHOR, digest: DIGEST, coverage: 'complete', overrides: null},
    history: {mode: 'none'}};
  manifest.current.id = await snapshotIdentity(manifest, [path], async () => bytes);
  const manifestText = '{"mdpkg":"markdown-package/1",' +
    canonicalJson(Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'mdpkg'))).slice(1);
  return writePackage([{name: MANIFEST, bytes: utf8.encode(manifestText), stored: true},
                       {name: path, bytes}]);
}
```

Measured result for `notes.md` containing a level-1 heading, prose and a
level-2 heading:

```text
tier conforming | documents ['notes.md'] | entries 2 | issues []
manifest {"mdpkg":"markdown-package/1","addressing":{...,"coverage":"complete","overrides":null},
          "current":{"id":"sha256-42c536bc…","kind":"snapshot"},"history":{"mode":"none"},"namespace":"…"}
scopes  document:[]  preamble:[]  section:[["# Notes",0]]  section:[["# Notes",0],["## Section two",0]]
referenceFor(...) -> mdpkg://…/v2/section/d14c94bb…?anchor=…&profile=…&expect=c0da4363…&loc=…
pkg.resolve(that) -> {"status":"survives","reason":"same-source", …}
pkg.verifySnapshot() -> {"assurance":"snapshot-verified", …}
```

That is the whole feature: reading, the document sidebar, headings,
references, reference resolution and snapshot verification all work with no
further change, because from `openPackage()` down nothing can tell the
difference between this and a `mdpkg pack` output.

Cost, measured on this machine (Node 24.6.0, synthesizer only — parsing is
the viewer's existing cost for a document of that size, paid identically for
a packaged `.md`):

| Source | Synthesize | `openPackage` + outline |
| --- | ---: | ---: |
| 16 KiB | 29 ms | 51 ms |
| 1 MiB | 57 ms | 743 ms |
| 10 MiB | 247 ms | 9,715 ms |

The synthesizer is not the cost; CommonMark parsing is, and that is unchanged
behaviour. A size cap is still wanted (§3, row 12).

### 2.3 Rejected alternative: fake the package object

The obvious "smaller" change is to skip the ZIP entirely and hand `main.js` a
hand-built object with `.documents`, `.document()`, `.ledger()`, `.resolve()`
and `.manifest`. Rejected: it duplicates the contract of `openPackage()`
(`open.js:16-50`) — including the single-document cache, the preview budget
and `releasePreview` — in a second place that no existing test covers, and it
would produce a package object that `verifySnapshot()`, `emitReview()` and
`validateExport()` have never seen. The ZIP round trip costs a few hundred
microseconds and buys reuse of every existing check, as the `verifySnapshot`
result above demonstrates.

### 2.4 Where it plugs into `receive()`, and the one trap

`receive()` (`main.js:106-165`) destructures `const {blob} = source` and then
uses `source` for two *different* purposes: `openPackage(blob)` on line 112,
and `savedSessions.prepare(opened, source)` / `attach()` on lines 116 and 128.
`attach()` records recents metadata from `session.source.blob.size` and
`.lastModified` and stores `session.source.handle` for reopening
(`persistence/session.js:206-216`).

So the synthesized bytes must be passed **only** to `openPackage`, and
`source.blob` must stay the user's original `File`. Otherwise recents would
record the ZIP's size and `Date.now()` as the file's modification time, and
the saved File System Access handle would be meaningless. Concretely:

```js
const input = await packageBytesFor(blob);      // original blob, or synthesized
const opened = await openPackage(input);
```

where `packageBytesFor` returns `blob` unchanged when the first two bytes are
`PK`, and otherwise a synthesized `File` named after the original (so
`pkg.name`, `open.js:17`, still shows `notes.md` in the header).

**Route on the ZIP signature, not on the extension.** Extension sniffing gets
`.markdown`, `.txt` and extensionless files wrong in one direction and a
corrupt `.mdpkg` wrong in the other — a truncated package would be silently
rendered as Markdown source instead of reporting a container error. The
signature test keeps every existing archive diagnostic intact.

### 2.5 Sharing one implementation with the native app

Item I of the native plan specifies exactly this module ("new
`src/inbound/loose.js` (name TBD)"). Building it now satisfies item I; the
native side then calls the same function with bytes from `plugin-fs`
`readFile` (R2) and its own identity string. The only thing that must be
designed for two callers is the identity parameter (§5.1) — with that as an
argument rather than an internal default, there is nothing platform-specific
left in the module.

---

## 3. Format and semantic differences, and which need a decision

The headline: **a synthesized loose `.md` is not a degraded `.mdpkg`. It is
the same *class* of artifact that `mdpkg pack` emits without `--history git`**
— a history-free snapshot with one document, complete correspondence and a
null override ledger. Everything the viewer does with one, it already does
with the other.

| # | Difference | What the user sees | Verdict |
| --- | --- | --- | --- |
| 1 | No history | Nothing. **The viewer has no history or diff UI to leave empty** — confirmed by grep: the only `history` references under `src/web-viewer/src` are the manifest validator, `snapshot.js:28`, and an unrelated selection-toolbar variable. `at=` / commit / diff / hunk references return `unsupported / history-reader-required` (`address/resolve.js:46`) and print "Historical references are not available in this viewer yet" (`main.js:207`) — **identically for a packaged snapshot** | Not a gap |
| 2 | No author or timestamp for the document | Nothing. The format carries no author/timestamp for current files in snapshot mode either; that metadata exists only in Git-mode commits. Review comment authorship comes from the user-entered name (`ui/author-name.js`), not from the package | Not a gap |
| 3 | One document instead of many | A one-item sidebar. `main.js:154` picks the first `.md` as the initial document and finds it | Empty state, fine |
| 4 | **Namespace has to be invented** | Determines whether closing and reopening the same file restores your position, drafts and comments: saved work is keyed by `packageKey` = `[mdpkg, namespace, current.kind, current.id, anchor, digest]` (`persistence/model.js:10-11`). Random-per-open means resume never works and `reopen()` always hits the `mismatch()` offer (`session.js:33-54, 160-161`). The browser **cannot** use the plan's path-derived default: it has no path, only `File.name`/`size`/`lastModified` | **DECIDED: name-derived** — §5.1 |
| 5 | **A delta review exported against it is published** | `emitReview()` succeeds against a synthesized package (measured) and writes `review.of = {namespace: <synthetic>, current: {kind: snapshot, id: sha256-…}}`. That file can be sent to someone else, and §4's correlation key `(review.of.namespace, kind, id)` then names a package that exists nowhere and that nobody can obtain. Editing the file and exporting again produces a second delta claiming a second state in the same synthetic namespace | **DECIDED: allowed, with a caveat notice** — §5.2 |
| 6 | CRLF is normalized before hashing | Nothing visible, but the snapshot is not a byte-faithful copy of the file on disk. `snapshotIdentity` rejects any `\r` (`snapshot.js:21`), so normalizing is mandatory, not optional; digests, quotes and selectors are over the LF text. `outline()` already LF-normalizes for display (`address/outline.js:6`), and the digest profile is literally `cm0312-source-lf-v1`, so this is consistent with the format rather than a compromise | State it; no decision |
| 7 | A leading UTF-8 BOM suppresses the first heading | **Measured:** a file starting `EF BB BF` then `# T` yields **2 scopes (document + preamble) and no sections** — CommonMark treats U+FEFF as text, so the heading is not a heading. The file reads as one unstructured blob with no section references. `decode()` deliberately keeps the BOM ("it is source, per §6.1", `format.js:10`) | **Minor decision** — §5.3 |
| 8 | Invalid UTF-8 | `The encoded data was not valid for encoding utf-8` — accurate but unfriendly for someone who dropped a Latin-1 file | Error message only |
| 9 | Basename is a reserved path | A file literally named `.git` or `.mdpkg` throws `Reserved package path: .mdpkg` (`container/conformance.js:43-45`). `.mdpkg.md`, `A.MD`, `my nøtes (1).md` and an empty file all work | Error message only |
| 10 | Every string says "package" | The header reads "Open a package… Files stay on this device" (`main.js:17-23`), the details line reads `1 documents · 2 entries · conforming typing tier · identity not verified` and `Lineage 9c4f… · snapshot sha256-…` (`main.js:133-135`). For a plain note that is confusing at best | Copy change; low risk |
| 11 | A non-Markdown extension still opens | `README` or `notes.txt` renders (outline works on any UTF-8 text) but `previewDocument()` throws `preview-type` (`open.js:33-35`), so reference previews are silently unavailable | Decide the accepted set — §5.4 |
| 12 | No size cap on the loose path | The container reader caps entries at 64 MiB (`reader.js:9`) *after* the synthesizer has already read, decoded, normalized and deflated the whole file | Add a cap; no decision |
| 13 | One window, one document | Opening a second file replaces the first, through the existing unsaved-work confirm (`main.js:120-121`) | Unchanged (R10) |

---

## 4. Effect on the native plan's phase 1 (W1–W5)

**Purely additive, and it makes W3 smaller.** No milestone changes shape.

| Milestone | Effect |
| --- | --- |
| W1 Shell boots | None |
| W2 OS entry points | None. D2's `.md` "Open with" registration and the `.mdpkg` association are unaffected; this work changes what happens *after* bytes arrive, not how they arrive |
| W3 `.md` and adapter | **Reduced.** Its first line is "Loose-document synthesizer (item I) with unit tests in the Node suite and a Playwright case in the browser lane" — exactly the deliverable proposed here. Doing it now leaves W3 with adapter items B–G and recents-by-path. The item F `window.confirm` gate is untouched: the loose path adds no new confirm site, it reuses `main.js:121` |
| W4 Installer and updates | None |
| W5 Acceptance | None, except that the checklist gains "open a loose `.md`", which W3 already implied |
| Phase 1.5 item L (watcher) | **Helped.** The watcher's identity gate is "re-synthesize and compare the snapshot id", which is this module. Having it tested in the browser lane first avoids iterating it behind the ~18-minute release build (item K) |
| Phase 1.5 item M (diff) | Unchanged; still new code |

**Two amendments the native plan needs** (small, and this note is the
evidence for them):

1. **R11 moves earlier and widens.** The plan reads "Plan-stage design
   decision for W3; path-derived is the working default". Path-derived is
   unavailable in the browser, so the decision must be taken now and the
   *derivation must be a parameter*: the synthesizer takes an `identity`
   string (native: absolute path; browser: see §5.1) and derives the
   namespace from it. Item I's signature should say so.
2. **Item I gains a note that the browser is a first-class caller**, not just
   the native shell — which also means its tests live in the existing Node and
   Playwright suites rather than the shell lane.

Nothing in D2, D3, D4 or D5 changes.

---

## 5. Decisions needed before the UI is wired — all DECIDED

Taken by the user on 2026-09-22 and implemented in the CARD-0062 follow-on
build. Each subsection keeps its original analysis; the decision is stated at
the end of it.

Step 1 of the recommendation (the pure module) can be built before any of
these, because `identity` is an argument. Steps 2 and 3 need 5.1 and 5.2.

### 5.1 How is the namespace derived? (R11, now also a browser question)

A namespace is required by the manifest and must be "a lowercase UUID"
(spec §4). Saved work, reading position and drafts are keyed by it
(`persistence/model.js:10-11`). Options:

| Option | Resume after reopening | Resume after editing the file | Collisions |
| --- | --- | --- | --- |
| Random per open | Never | Never | None |
| Derived from content | Only if unchanged | **No** — defeats the point, and item L requires stability across edits | Two identical files share work |
| Derived from absolute path | Yes (native) | Yes | Same path means same work, which is correct |
| Derived from file **name** (the browser's only stable input) | Yes | Yes | **Two different `README.md` in different folders share saved work** |

Content-derived and random-per-open are ruled out by item L. So: native uses
the absolute path; the browser has only the name. The question for the user
is whether the browser's name collision is acceptable (two unrelated
`notes.md` would show each other's saved comments and reading position), or
whether the browser should instead offer no resume at all for loose files.

Recommended default if no answer is forthcoming: **name-derived**, because the
alternative is a viewer that silently forgets your drafts every time you close
the tab, and the collision is visible and recoverable through the existing
`mismatch()` offer. Derive as a UUIDv8: SHA-256 over a fixed prefix, a NUL and
the identity string, first 16 bytes, with the version and variant nibbles set
so the result is a well-formed lowercase UUID (the viewer's own `UUID` regex,
`format.js:6`, does not check them, but the spec says "UUID").

**DECIDED (user, 2026-09-22): name-derived.** The collision is accepted for
v1: two different files sharing a basename (two `README.md` from different
folders) share saved annotation and review state, and the existing
`mismatch()` offer remains the recovery path. Implemented as `looseNamespace`
in `src/web-viewer/src/inbound/loose.js` — a UUIDv8 over
`"mdpkg-loose-namespace-v1" NUL <identity>`, exactly the derivation described
above. The *identity* itself is a required argument of `synthesizeLoose`, not
derived inside the module (R11/W3): `main.js` passes `File.name`, and the
native shell will pass an absolute path.

### 5.2 May a review be exported against a synthesized file?

Measured: it works today with no extra code, and it publishes a `review.of`
pointing at an identity nobody else can resolve (§3, row 5). Three answers:

- **(a) Allow it**, and add one line of UI copy saying the review targets a
  local file rather than a distributed package. Cheapest; the recipient gets a
  review they cannot verify against an original.
- **(b) Disable export for loose files in v1** — reading and local commenting
  only. Safest for the format's continuity rules; removes a feature the user
  may well expect.
- **(c) Require `mdpkg pack` first** to obtain a real namespace before
  reviewing. Honest, but pushes a CLI into a browser workflow.

Note for whoever decides: spec §5 explicitly permits uncommitted private
candidates ("Private edits before first publication MAY remain uncommitted;
every emitted candidate gets the hash of its own bytes. No historical
checkpoint or published-continuity claim is made"), so re-synthesizing the
same namespace with new snapshot ids is *not* a violation while it stays in
memory. The question is only about the moment an export leaves the machine.

**DECIDED (user, 2026-09-22): (a) allow it, with a caveat notice.** The review
panel shows a standing notice for a loose file, and the prepare, download and
share statuses each append it: "This document was opened as a loose Markdown
file. An exported review references a synthesized snapshot that exists only on
this device, not a packaged .mdpkg the recipient can obtain."
(`LOOSE_EXPORT_CAVEAT`, `src/web-viewer/src/ui/review-view.js`.) The notice is
scoped to the loose case only: a review exported against a real `.mdpkg` is
completely unaffected, which `tests/loose.spec.js` asserts in both directions.

### 5.3 BOM: strip it, or keep it?

Keeping it is spec-faithful (§6.1: the BOM is source) and produces a document
with no sections at all (measured). Stripping it makes the file read the way
its author intended but means the synthesized snapshot no longer contains the
file's bytes. Recommended: **strip, and say so in the status line**, since the
alternative looks like the viewer is broken. Low stakes either way.

**DECIDED: strip, and say so.** A leading U+FEFF is removed before hashing, so
the first heading stays a heading; an interior U+FEFF is ordinary source and is
kept. The notice lands in `#package-details` ("A leading byte order mark was
removed."), not the `#activity` status line, because that line is overwritten
by the opened document's name a moment later. Covered by `L3` in
`tests/loose.test.mjs` and by the browser case in `tests/loose.spec.js`.

### 5.4 Which files count as "a loose document"?

Any UTF-8 text that is not a ZIP, or only `.md` / `.markdown`? Anything else
opens and renders but loses reference previews (§3, row 11). Recommended:
accept any UTF-8 text so drag-drop is predictable, and either fix the preview
gate to key on "is this document's source Markdown" rather than the filename,
or accept the limitation and document it.

---

## 6. Not done, noted

- ~~The synthesizer module is **not written**~~ — **written.**
  `src/web-viewer/src/inbound/loose.js`, with `tests/loose.test.mjs`
  (11 Node cases) and `tests/loose.spec.js` (7 Chromium cases). §2.2 remains
  the prototype the module was built from; the shipped module adds the BOM
  strip, a 64 MiB input cap matching the container reader's own entry limit,
  and a friendlier non-UTF-8 message.
- ~~Not measured: behaviour in a real browser~~ — **measured.** The picker,
  drag-drop and Ctrl+V routes, CRLF, BOM, non-UTF-8, a truncated `.mdpkg`,
  recents metadata and the review export all run in Chromium under
  `tests/loose.spec.js`, and manually in Chrome.
- §5.4 was implemented as recommended: **any UTF-8 text that is not a ZIP** is
  accepted, so drag-drop is predictable. The `preview-type` limitation for a
  non-`.md` name (§3, row 11) stands unchanged and is still worth fixing.
- §3, row 12's size cap is implemented as `MAX_LOOSE_BYTES` (64 MiB, matching
  `reader.js`'s `maxEntryBytes`). It is checked twice: `main.js` refuses on the
  blob's declared size before reading any of it, and `synthesizeLoose` refuses
  on the byte length it is handed, so the module keeps the bound on its own.
- Not investigated: whether the CLI should grow a `pack` shorthand that
  accepts a single file rather than a directory. It would make the manual
  workaround in §1.2 one command instead of three, and it is unrelated to the
  viewer change.
- The native plan's "not done, noted" item about the synthesizer later
  accepting a **dropped folder** (producing what `mdpkg pack` would) is
  unaffected and still attractive; the module proposed here is the first half
  of it.

---

## 7. Evidence and reproduction

Run from `src/web-viewer` at `c725838`, with `node_modules` installed:

```text
# Q1: the current viewer rejects a bare .md
#   import openPackage from src/inbound/open.js and call it with
#   new File(['# Title\n\nHello.\n'], 'notes.md') and with a ~210-byte .md
  -> FAILED: No end of central directory record
  -> FAILED: No complete EOCD ending at EOF

# CLI verbs (no viewer)
grep -n 'root.Subcommands.Add' src/generator-cli/src/Mdpkg.Cli/MdpkgCli.cs
  -> pack, update, address, validate

# Q3 row 1: no history or diff UI in the viewer
grep -rn history src/web-viewer/src
  -> manifest validation, snapshot.js:28, and an unrelated selection-toolbar variable only

# eager budget headroom
node build.mjs
  -> V-1 passed; V-2 passed: 95766/145000 eager gzip bytes (Review)
grep -c 'deflate-raw' dist/main.js ; grep -c 'mdpkg-snapshot-v1' dist/main.js
  -> 2 ; 1     (writer.js and snapshot.js are already eager)
```

The §2.2 prototype and the §3 edge-case matrix were run as scripts importing
the shipped modules by absolute `file://` URL. Edge cases measured, in the
order of §3:

```text
CRLF, not normalized  -> THROW  Current files must be UTF-8 with LF endings
CRLF, normalized      -> OK  conforming, verified
BOM                   -> OK  conforming, verified, but 2 scopes (no sections)
invalid UTF-8         -> THROW  The encoded data was not valid for encoding utf-8
empty file            -> OK  conforming, verified, 2 scopes
A.MD                  -> OK  conforming, verified, preview available
'my notes (1).md'     -> OK  conforming, verified, preview available
README (no extension) -> OK  conforming, verified, preview error code 'preview-type'
.mdpkg  /  .git       -> THROW  Reserved package path
.mdpkg.md             -> OK  conforming, verified

emitReview() against a synthesized package -> OK, 1271 bytes,
  review.of = {"current":{"id":"sha256-22d1e132…","kind":"snapshot"},"namespace":"<synthetic>"}
```

`git status` was clean before and after; the generated `dist/` from
`node build.mjs` was removed and is gitignored.
