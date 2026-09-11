# CARD-0046: browser history and draft resume plan

Planning complete; implementation has not started. Recommended defaults below are
ready for test design and implementation. Repository inspected at
`82e5dc696ab1bdbe348ad831cacdc403cc4666d4` on 2026-09-11.

The full description of CARD-0046 was read from the markdown-package board:
card `91ce2d46-9ee6-4e8c-b184-80892ab73191`, revision count 1. This plan covers its
recently opened packages/documents, optional persisted file handles, debounced
selection/thread drafts, reading position, defensive storage, and reload resume.
The stage brief requests planning only; the card's application changes, tests,
and README update belong to the subsequent implementation stage.

## 1. Recommended behavior and boundaries

Use IndexedDB for browser-local recent history, reading positions, unfinished
editors, and the authored review state needed to resume those editors. Add
persisted **read-only** file handles where supported. On reload, reopen the last
package automatically only if its stored handle already has read permission;
otherwise show a resume entry that requests permission or asks the reader to
pick the package again. Once the matching package is available, restore its
document, position, and matching unfinished editor automatically.

The baseline does not copy whole packages into browser storage. A remembered
filename, path, namespace, or Blob URL cannot authorize reopening a local file.
IndexedDB can store a File/Blob copy, so cross-browser snapshot reopening is
technically possible, but that adds package-size quotas, eviction, stale-copy
semantics and retention choices. Defer that feature explicitly. OPFS also stores
private copies; it is not a route back to an arbitrary original file.
See [IndexedDB's structured storage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
and [the OPFS distinction](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

Persist only in this viewer's browser profile and origin. No backend, device
sync, artifact persistence, changes to the package format, original-file writes,
Git history browsing, browser Back/Forward history integration, new selection
algorithm, or new comment-authoring workflow. Persist existing authored comments
and thread state because a reply cannot resume against a parent that vanished.
Do not import other review packages or relocate feedback onto newer snapshots.

## 2. Browser support investigated on 2026-09-11

This is documentation and compatibility-data evidence, **not a device test
report**. The relevant API is `Window.showOpenFilePicker`, not the umbrella
File System API or the presence of `FileSystemFileHandle` alone.

| Browser/platform | User-file picker returning a reusable handle | Planned experience |
| --- | --- | --- |
| Chrome desktop, Windows/macOS/Linux/ChromeOS | Supported from 86 | Store handle; reuse subject to read permission. |
| Edge desktop | Chromium support mirrored from 86 | Same capability path, with runtime checks. |
| Chrome Android | Supported from 132 | Eligible for handle reuse; real Android/provider acceptance required. |
| Firefox desktop and Android | Unsupported | File input, then restore stored state after identity matches. |
| Safari macOS, iOS and iPadOS | Unsupported | Same file-input resume; retain the unrestricted iOS picker. |
| WebKit-based browsers/webviews on iOS | Unsupported through that engine | Same fallback; browser brand alone does not establish capability. |

Version evidence: MDN browser-compat-data at commit
`5f2d878640190b0793bd631d6900c80a627343f0`,
[`Window.json`, `showOpenFilePicker.__compat.support`](https://github.com/mdn/browser-compat-data/blob/5f2d878640190b0793bd631d6900c80a627343f0/api/Window.json).
The raw fields are Chrome `86`, Chrome Android `132`, Edge `mirror`, Firefox
`false`, Safari `false`, and Safari iOS `mirror`. These are feature introduction
versions, not the minimum supported version of the entire viewer.

`queryPermission` and `requestPermission` have a different Android introduction
version, 109. Their presence therefore does not prove the picker is available.
Firefox/Safari lack these user-file permission methods in the same data.
See [the pinned FileSystemHandle data](https://github.com/mdn/browser-compat-data/blob/5f2d878640190b0793bd631d6900c80a627343f0/api/FileSystemHandle.json).

Other Chromium derivatives and embedded webviews require feature detection and
individual acceptance; do not market universal Chromium support. Google's
capability guide identifies Brave as a flag-dependent exception. The guide's
broad Android statement is refined by the method-specific 132 entry above.
See [Chrome's File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

The picker requires a secure context and user activation. Detect
`isSecureContext && typeof window.showOpenFilePicker === 'function'`; check the
retrieved handle's methods and actual permission separately. Serve over HTTPS or
localhost, consistent with the viewer's existing Web Crypto requirement.
See [showOpenFilePicker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker).

Store handles using IndexedDB structured cloning, not JSON. A persisted handle
does not imply a persisted grant. Chrome introduced an optional permission grant
across visits in version 122; permission can still be temporary or revoked.
Always query on reuse. If it is not granted, expose an explicit **Allow access**
action and call `requestPermission({mode: 'read'})` from that gesture. Preload
the handle before enabling the action so asynchronous database work does not
consume its activation window. Never invoke a picker or permission prompt at
startup. See [Chrome's persistent-permission behavior](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
and [requestPermission's activation requirement](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission).

Current Chrome, Edge, Firefox and Safari provide IndexedDB independently of the
external-file picker. Storage remains fallible and per-origin. Private sessions
may offer temporary storage, quotas can be exhausted, and clearing site data or
eviction can remove everything. Do not detect private mode or promise permanent
retention. See [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
and [storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## 3. Integration with the current viewer

Paths in this table are relative to `src/web-viewer/`.

| Existing code and observed behavior | Planned integration |
| --- | --- |
| `src/main.js`: `receive(blob)` handles file input/drop/paste, resets the active package before validation, and uses open/navigation generations. | Introduce a source descriptor containing a Blob plus optional file handle. Prepare a candidate before replacing the current session; cancel/failure retains the current reader and work. Gate storage hydration and all later callbacks with the existing generations. |
| `src/inbound/open.js`: `openPackage` is the single parse boundary; active document and ledger are lazy/cached. | Retain it as the parser for every open/reopen. No filesystem permissions or database operations inside the parser; no eager archive copy or Git load. |
| `src/main.js`: `showDocument`, `displayDocument`, `resolve`, `navigate` reach documents through several routes. | Centralize successful navigation recording so the document list, relative links, references, section changes and thread navigation all update resume state. |
| `src/ui/reader-view.js`: view/source mode and scopes are private; scope selection is not updated by ordinary scrolling. | Expose capture/restore hooks and position notifications; observe the actual viewport separately from the selected section menu. |
| `src/ui/review-view.js`: `composing` contains live model/anchor/thread references; editor input only invalidates exports; `setPackage` resets review and namespace. | Expose serializable snapshot/hydrate hooks, retaining existing authoring and selection validation. Schedule persistence around inputs and review mutations. |
| `src/review/comments.js`: `newReview`, `newThread`, `validateComments`, `validateAnchors`; `src/review/selector.js`: `makeSelector`. | Reuse these for restored review graphs and exact selector verification. Preserve review namespace, thread/comment IDs and reply targets. |
| `src/main.js`/`review-view.js`: unsaved feedback is currently distinguished only from downloaded/shared feedback. | Separate pending/failed local persistence from unexported feedback. Retain export revision checks and describe the two states independently. |
| `playwright.config.js` and `.github/workflows/pages.yml`: browser coverage is Chromium only. | Add Firefox/WebKit coverage for storage and fallback; use native-browser/device acceptance for real file permissions. |

## 4. Storage schema, identity and retention

Use one small native IndexedDB adapter; no new runtime dependency by default.
Its database name should include an explicit application identifier and normalized
deployment base path, for example `mdpkg-viewer:/markdown-package/`. GitHub Pages
project sites share an origin, so a name based only on the host is insufficient.
The name avoids accidental application collisions; it is not a security boundary
between scripts on the same origin. Keep schema versioning in the database and
record envelopes. Never use `localStorage.clear()` or delete unrelated databases.

Recommended database version 1:

| Store | Key | Stored data |
| --- | --- | --- |
| `packages` | `packageKey` | Manifest identity, display filename, size/lastModified hints when available, last-opened/last-read timestamps, last document path, current review-session pointer. |
| `handles` | `packageKey` | Structured-cloned file handle and last successful retrieval metadata. Store separately so clone failures cannot abort draft/metadata saves. |
| `positions` | `[packageKey, documentPath]` | Selected scope locator, viewport anchor, normalized source digest, source/render mode, offsets and last-viewed time. Also supplies recent-document ordering. |
| `reviews` | `[packageKey, reviewNamespace]` | Existing comments document including threads/replies/states, revision, and last export-requested/shared revision metadata. No prepared Blob or object URL. |
| `drafts` | `[packageKey, targetKey]` | Draft schema version, review namespace, serializable target, exact author/kind/body fields, revision and timestamps. |
| `resume` | fixed application key | Last successfully opened package, document and active draft key; update only after successful open/navigation. |
| `conflicts` | random recovery ID | Preserved conflicting draft/review envelope and logical target, for recovery without silently overwriting another tab. |

Persist a draft and its active-draft/review-session pointers in the same
transaction. Update resume fields individually within transactions so a
position-only write cannot replace a newer draft pointer. Draft removal below
means a logical deletion with a revision tombstone, not loss of concurrency
information; retain that small tombstone for the lifetime of the saved package
record. Explicit deletion of all package work also advances a package generation
so an already-open tab cannot recreate it with a stale save.

Define `packageKey` as a canonical structured tuple of manifest format identifier,
namespace, current commit, addressing anchor and digest profile. Do not join
unescaped strings with delimiters. Both supported manifest versions go through
their existing validation first. Valid packages supply namespace/current; an
invalid file never gets an identity-based resume entry. A filename/size/date is
display or picker guidance only, never evidence of identity.

Two copies of the same manifest identity share a resume record; renamed copies
can therefore resume. A different namespace or commit starts a separate record,
even if the filename matches. Namespace/current is the declared snapshot
identity, not proof that archive bytes are identical: on reattachment verify the
affected document digest and every restored feedback anchor. Preserve discrepant
saved state for recovery instead of attaching it to different text. Whole-archive
hashing is not required on the lazy open path.

For a new comment/change-request, derive `targetKey` from a tagged canonical
tuple containing document path, anchor locator/root/expected digest and the full
selector (`start`, `end`, `quote`, `occurrence`, `prefix`, `suffix`). A SHA-256 of
that tuple can keep the key compact; retain the tuple in the value and compare
it on restore. Use existing canonical JSON/hash helpers. Repeated identical
quotes in different locations must produce distinct targets.

For a reply, use a different tag plus review namespace, thread ID and
`inReplyTo` comment ID. Keep the parent thread's anchor/selector in the review
snapshot. Author and kind are values, not identity: changing them updates the
same draft. Do not serialize DOM Ranges, AST nodes, model instances or thread
object references. Hydration reconstructs them against the opened package.

Bound the visible recent list to 20 packages and 20 documents per package,
ordered by successful last use, deduplicated by the keys above. Prune oldest
history-only records and handles; draft-bearing or unexported-review records
remain discoverable in recovery even when outside the recent list. Do not
silently evict user-authored work or apply a draft expiry timer. **Remove from
recents** removes history/handle access; **Delete saved work** is an explicit
separate action scoped to that package. Cancelling a compose editor discards
that draft only, retaining the existing Cancel meaning.

Keep current review limits (5,000 threads, 20,000 comments, 64 KiB UTF-8 per
submitted body, 8 MiB review JSON). Save unfinished input exactly, including
incomplete author fields, whitespace and text not yet valid for submission; do
not run submitted-comment validation on an unfinished form. Its envelope still
needs structural and size limits. Default to at most 256 KiB UTF-8 for the body
of one unfinished editor, enough for the current 65,536 UTF-16-unit field; this
does not raise the submitted-body limit. Capture existing validated selectors
without truncating their quotes. Large selection envelopes may exceed the
review-export limit: report inability to persist them rather than silently
changing the selection or introducing a new authoring limit.

## 5. Opening, recents and permission recovery

1. Load and validate metadata; render **Recently opened** with filename,
   document/section, time and draft indicator. Show namespace/commit details
   where needed to distinguish identical filenames. Render stored text with
   `textContent` and fields, using existing safe-rendering conventions.
2. On **Open package**, prefer `showOpenFilePicker({multiple: false})` where
   available, then obtain the File from the returned handle. Preserve an
   explicit standard-picker fallback; retain the existing input without an
   `accept` attribute so iOS `public.data` packages remain selectable. Do not
   restrict extension/MIME choices in the enhanced picker either.
3. Pass `{blob, handle?, sourceKind}` to the shared receive controller. Existing
   drop/paste continue as File-only sources. Capturing drag/drop handles is
   optional future work, not a reason to block those paths now.
4. Parse and identify the candidate, flush outgoing work, then install and
   hydrate the candidate. A failed/cancelled picker or bad archive neither adds
   a recent entry nor destroys the old package/editor. If local saves fail,
   retain the existing navigation guard before any destructive replacement.
5. A recent package already in memory opens its selected recent document
   directly. Otherwise preload its saved handle and query read permission.
   Granted permission permits `getFile()` and the normal parse/identity path.
   A prompt state offers **Allow access**. Denial, unavailable methods, a
   moved/deleted file, or a read error offers **Choose file again**. Cancelling
   leaves all stored drafts/positions intact; no automatic prompt retry loop.
6. Verify the newly selected/retrieved package identity before applying state.
   If it differs, show that this is a different package/version, offer to open
   it as a separate record, and keep the expected package's recovery entry.
   Never silently rekey the old draft to the replacement file. A saved handle
   whose contents changed must go through the same mismatch flow.

Use honest copy: **Choose guide.mdpkg again to resume guide.md. Your position
and saved draft will return once it is open.** A stored handle permits skipping
the picker, not promising that permission or the original file will always be
available. Keep history visible when access fails.

## 6. Draft save and reload lifecycle

### Capture and persistence

At the existing editor-open boundary, capture the original model/anchor or
thread/reply target. Compute the durable target from that captured context;
never consult whatever selection happens to be current when the debounce fires.
Reference/digest computation may be asynchronous, so guard it with package,
navigation/editor generation and revision. Maintain the input buffer immediately
while the key is being prepared; stale completions cannot save to a new editor.

Capture input/change events for author, kind and body. Default to a 400 ms
trailing debounce with a 1,500 ms maximum wait while typing continuously.
Flush on editor blur, before supported in-app navigation/package replacement,
and on `visibilitychange` to hidden; use `pagehide` as an additional best-effort
flush. Serialize immutable snapshots and queue writes per logical record. A
successful save is the IndexedDB transaction's completion, not a scheduled
timer or individual request success. Display **Saving…**, **Saved in this
browser**, or **Could not save; keep this tab open**; only announce transitions
through a polite live region, not every keystroke.

On Save comment/reply, use the existing validation and mutation logic, then
persist the resulting review graph, namespace/IDs, new revision and draft
deletion in one transaction. If persistence fails, preserve the in-memory review
and last durable draft, mark local saving failed, and do not claim browser save
success. Retrying stores the same generated IDs rather than creating comments
again. A crash before commit recovers the last draft; after commit it recovers
the submitted comment without a duplicate editor. Thread-state changes also
persist the existing review graph. Cancel must invalidate queued draft writes
and commit deletion so a late debounce cannot resurrect cancelled text; expose
a save failure if deletion could not be persisted.

Existing authoring still allows only its current active editor; persistence
does not add auto-submit, draft switching, automatic quote relocation, or new
comment kinds. Keep an active-draft pointer for reload and preserve the guard
that currently asks the reader to save/cancel before starting another editor.

### Restore ordering

1. Open the scoped database and read the saved resume record without overwriting
   it with empty startup state. A same-tab `sessionStorage` pointer may override
   the global last-used pointer for independent tab reloads; catch failure and
   fall back to the global pointer. A new tab uses the global pointer.
2. If the current browser has a stored handle with granted read permission,
   obtain and validate the package. Otherwise stop at the resume entry; metadata
   and draft indicators can appear before the package is available.
3. After package identity matches, validate the review envelope and existing
   comments graph, preserve its review namespace/IDs, and verify anchors against
   source before making recovered feedback editable/exportable. Check an
   unfinished new-thread target with the same `referenceFor`/`makeSelector`
   comparison used by `validateAnchors`; check a reply's parent IDs too.
4. Restore the remembered document and reader mode/position. For an active draft
   belonging to that document, reconstruct its original model/scope/selector
   and re-show the existing compose form with author, kind, body and exact quote.
   It must be saveable without reselecting text. Do not guess a rendered DOM
   highlight: the validated source anchor/quote is authoritative, and source
   mode remains available for transformed text.
5. If the reader last viewed document B while composing against document A,
   retain B's reading position and show a **Resume draft in A** action. Do not
   relabel A's draft as a draft against B. Activating it opens A and restores
   the original editor. Do not force editor focus/scroll during startup;
   automatic restore should not undo the restored reading position.
6. Hydration is read-only with respect to autosave until complete. Reject stale
   work if the user opens/navigates elsewhere. User input after restore begins
   wins over delayed hydration; never replace text already typed in this session.

Missing documents, changed source, invalid scopes/selectors, or missing reply
parents produce a recoverable entry containing the saved text and reason.
Offer copy and explicit discard; keep the saved envelope. Do not silently delete
it, attach it to the first document, or create a new parent. Invalid review
graphs stay unavailable for export until recovered through valid authoring.

### Durability, export and tabs

The recovery guarantee is the **last successfully committed save**. An abrupt
crash can lose edits in the debounce/in-flight interval, and an OS/storage
failure can lose more. There is no reliable browser API guaranteeing the final
keystroke survives termination. Do not present autosave as backup or a completed
review download. `beforeunload` is unreliable on mobile and should only be
installed while there is unpersisted/failed local work. See
[beforeunload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
and [visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).

Once all local work is committed, permit reload/package switching without the
current misleading discard warning. Continue to show **Review not exported**
where relevant. Preparing/downloading/sharing never deletes saved review work;
preparation is rebuilt after reload. Preserve current stale-export invalidation
and cancellation behavior. A requested download remains only a request, not
proof of an OS file save; local autosave never changes that fact.

Use revision comparison inside the read/write transaction for drafts and review
graphs. A stale tab must not overwrite or resurrect another tab's save/deletion.
On a conflict, save its incoming envelope under a recovery ID and display an
explicit conflict notice; do not merge prose or replace the live form silently.
Keep deletion revision markers as defined in the schema above. Cross-tab
notifications can prompt a reread, but correctness
must come from transactional revision checks, not timestamps or notifications.
Reading positions may use last successful write wins; tab-local resume pointers
prevent unrelated tabs from changing the document chosen by a same-tab reload.

## 7. Reading position

Record both the selected section locator and the actual viewport anchor. A user
can scroll several sections without changing the dropdown; persisting only
`currentScope` misses the requirement. Store a normalized document-source digest
(`sha256(model.text)`, including trailing source, after existing LF normalization),
source/render mode, nearest rendered block's source position plus offset from
its top, and a document-relative scroll fraction as fallback. Use exact scope
locators/occurrences, not heading text or generated DOM IDs alone. For source
mode retain the source block's scroll offset/fraction. Track the page's scrolling
element; the current reader is not a separate vertical scrolling pane.

Sample scroll with a passive listener and animation-frame coalescing; debounce
storage for 250 ms with a 1,000 ms maximum wait. Save on document/section/view
changes and before teardown. Once the same document is rendered, restore after
layout, map the source-position block if available, and clamp the viewport
offset. Different viewport widths may change wrapping: prefer the semantic
anchor over raw absolute `scrollY`. If the source digest changed, leave the
saved entry intact, open at a safe document start and explain why exact resume
was not applied. If the anchor is unavailable with unchanged source, use the
saved section then the clamped document fraction.

Suppress position writes while applying restore. Cancel a delayed scroll restore
after user scroll/navigation/input so it cannot pull the reader back. Explicit
navigation to a reference/fragment or a chosen recent document overrides the
saved destination; ordinary reopening uses it. Resume source mode before
positioning. Table wrap settings remain the separate, currently in-memory
preference; block-based positioning accommodates resulting layout changes.

## 8. Defensive storage and recovery

Wrap database access, structured clone, reads, writes, transaction completion,
deletes, schema migration and optional sessionStorage access. Handle denied
access, `QuotaExceededError`, aborted transactions, invalid records and a
blocked/versionchanged database. Close old connections on version changes;
show a recoverable notice rather than hanging app startup. Bound stored input
before expensive parsing/validation. Unknown newer record versions are retained
and skipped, not overwritten with defaults. Never reset the whole database
automatically to fix one malformed record.

If storage is unavailable, opening/reading/review/export continue in memory
with an accurate notice and the existing loss-prevention navigation guard.
A failed handle save still permits metadata/draft saves. On quota failure,
prune only expendable history/handle records and retry once; if that cannot
help, keep work in memory, retain prior durable values, and offer retry or
export/copy. Do not loop or truncate. IndexedDB is preferable to a giant
localStorage snapshot because reviews alone may reach 8 MiB and need atomic
updates. No dual-write localStorage database is required for this slice.

Cleared site data yields an empty recents view and no restore claim. The next
successful open can create fresh records. Tell users in the persistence note
that filenames, author names, selected quotes and feedback are kept on this
device/profile and can be removed through viewer controls/site-data settings.
There is no persistent-storage permission prompt or telemetry requirement.

## 9. Implementation sequence and acceptance gates

Each step includes its corresponding tests; do not land an interface claiming
autosave before the complete restore path exists.

1. **Persistence model and adapter.** Add proposed `src/persistence/store.js`
   and `src/persistence/session.js` for schema, immutable envelopes, identity,
   revision checks, retention and defensive failures. Unit-test pure identity,
   draft encoding and debounce logic; test real IndexedDB transactions in the
   browser. Establish serializable review/reader hooks without format changes.
2. **Recent history and inbound capability adapter.** Add proposed
   `src/inbound/file-access.js` and `src/ui/recent-view.js`; wire `main.js` to
   candidate opening, handles and honest fallback copy. Cover all existing open
   routes and navigation generation races. Failed opens preserve the old session.
3. **Draft/review autosave and restore.** Add the captured target boundary and
   snapshot/hydrate hooks to `review-view.js`. Persist form input and review
   mutations; transact submit/delete; restore exact selections and replies.
   Separate local save status from export status and preserve export guards.
4. **Reader position and startup resume.** Extend `reader-view.js` hooks and
   `main.js` lifecycle ordering. Restore source/render view and viewport without
   stale scroll jumps, selection guessing or hydration overwrites.
5. **Cross-browser gates and documentation.** Add proposed
   `tests/persistence.test.mjs` and `tests/persistence.spec.js`; update browser
   projects and Pages CI for fallback coverage. Update `src/web-viewer/README.md`
   only once implementation exists, replacing the current memory-only/deferred
   claims with actual storage, support, failure and deletion behavior. Include
   the verified browser/device/version matrix in the build-stage report.

Suggested behavior-based acceptance cases:

| Area | Required proof |
| --- | --- |
| Identity/history | Same name/different namespace or commit never shares work; renamed same snapshot resumes; repeated opens deduplicate; different recent documents navigate correctly; failed opens/cancels do not alter recents or the active editor. |
| Handle reuse | Granted handle bypasses picker; prompt waits for a click; deny/revoke/missing file/cancel/clone failure fall back honestly; changed file goes through identity mismatch; no permission request on reload. |
| Non-handle sources | File input, drop and paste save history/drafts; after reload they ask for a file, then restore automatically on the matching selection. No whole package Blob is retained. |
| Draft input | Comment/change-request, author/kind edits, empty/whitespace/incomplete forms, Unicode and repeated quotes survive the debounce and restore against the exact original target. Continuous typing saves within the maximum wait. |
| Review dependency | Saved parent thread, IDs, reply target, state and review namespace survive reload; submitting a recovered reply exports a valid graph. Saved comments persist even when there is no open editor. |
| Submit/cancel races | Transaction abort leaves a recoverable last draft; success removes it atomically; delayed writes cannot resurrect Cancel or duplicate a submitted comment; retries keep generated IDs. |
| Reload/crash | After a completed save, reload and a fresh page in the same browser context recover work; close without lifecycle flush still recovers that checkpoint. Do not assert survival of uncommitted keystrokes. |
| Position | Same/different viewport sizes, ordinary scrolling past section boundaries, duplicate headings, source/render mode and long/table documents resume close to the semantic anchor; explicit navigation/user scroll wins over delayed restore. |
| Races/tabs | Slow opens/hydration cannot affect a newer package/editor; two tabs cannot silently overwrite feedback; deletion defeats stale writers; conflicts remain recoverable; same-tab reload honors its own document pointer. |
| Recovery failures | Malformed/unsupported stored data, missing document/parent, changed digest/selector, denied storage, quota, transaction abort, blocked upgrade and cleared site data leave reading/export usable and do not claim a save. |
| Existing contracts | Exact selection verification, iOS unrestricted picker, safe rendering, lazy Git loading, original Blob immutability, stale-export prevention and independent review-package validity remain intact. |

Run persistence/fallback browser cases in Chromium, Firefox and WebKit with real
IndexedDB. Keep permission adapter tests deterministic using injected test
doubles, and label them as such: they cannot prove native picker prompts or
handle grants across a browser restart. Existing single-output export tests must
either stay Chromium-only or use per-project output paths to avoid parallel
projects overwriting `test-results/browser-review.mdpkg`.

Before claiming native reuse support, record manual results in current desktop
Chrome and Edge, and Chrome Android 132+ with a real local/cloud file provider:
initial pick, reload, full browser close/reopen, granted/temporary/revoked access,
deleted/moved file and changed package identity. Record Safari macOS/iOS and
Firefox fallback resume, including at least one real iOS device. Playwright
WebKit is engine coverage; Chromium touch emulation is not iOS/device evidence.
If devices are unavailable, report those rows as untested instead of pass.

Existing commands, run from `C:\src\markdown-package\src\web-viewer`:

```powershell
npm ci
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

After browser projects are added, install their runtimes with
`npx playwright install chromium firefox webkit` (CI also needs `--with-deps`).
Keep the existing build/dependency/asset-path gates. The recorded CARD-0045
bundle is 124,805 eager gzip bytes against a 133,145-byte Review ceiling, leaving
8,340 bytes at that measurement; rerun the build against the actual follow-on
baseline. Do not silently raise the budget or load Git eagerly for persistence.

## 10. Stage outcome

This artifact contains the planned decisions, integration boundaries and test
acceptance criteria. No product decision blocks test design: defaults are
metadata plus optional read handles, IndexedDB without archive copies, exact
snapshot/selector reattachment, and retention of authored work until explicit
deletion. Blob caching, cross-snapshot relocation and broader authoring changes
would require separate scope.

Planning validation: full card and current source inspected; pinned primary
compatibility data and permission/storage documentation checked. No application
tests, builds or physical-browser/device tests were run for this documentation
change. The implementation-stage report must state actual test counts/failures
and tested versus documented support instead of copying this research as a
runtime result.
