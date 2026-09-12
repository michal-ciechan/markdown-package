# S5 browser schema, snapshot export and persistence

Task `10111445`, implemented against `b2458b3` under the approved
[CARD-0052 plan, S5](../superpowers/plans/2026-09-12-card-0052-deferred-history-breaking-spec-plan.md).

## Result and scope

The browser consumes the revised typed schema and produces two-file snapshot delta
reviews without a Git writer. Prepared exports persist their bytes and fresh
artifact namespace independently from the private editing workspace. Both actual
snapshot-targeted and commit-targeted browser downloads validate in Core and Reviews.

The existing CommonMark outline, root, selector, link adapter and preview rendering
algorithms are retained. Comparisons use `(kind, id)` fields; display no longer
converts a state object to `[object Object]`. A non-current typed reviewed context
returns `history-unavailable`, `history-required` or `origin-unverified`. Exact
commit `at=` references remain current-view operations; all other historical
endpoints remain explicitly unsupported. No browser origin verification or
general Git-history reader has been invented.

## Verification boundary

Opening checks the revised manifest and conditional inventory but remains selective,
reporting `assurance: declared` and showing that identity has not been verified.
Current links can compare scoped source evidence; this is not full package identity
or historical continuity evidence. Git packages cannot obtain snapshot assurance.

Explicit `verifySnapshot()` hashes every current file, including non-Markdown text,
ledger and review bytes, from the immutable Blob/owned byte source used for reading.
It uses the S1 semantic header, exact UTF-8 path ordering and canonical encoding,
preserving BOMs and trailing whitespace. It validates UTF-8/LF, CRCs, ledger targets
and comments schema before reporting `snapshot-verified`. Manifest objects are
frozen. String-valued current, mode mismatch, unexpected fields, forbidden controls,
coercible non-string identities and unpaired JSON surrogates are rejected.
Full verification requires the built-in immutable Blob or owned-byte source;
custom random-access adapters remain selective. Blob capture uses native slicing
so a caller's subclass or replaced instance methods cannot substitute verified
content. Source objects are frozen. Tests separately reject mutable adapters and
prove that supplied Blob subclasses cannot change captured data.

The verifier reads decoded files one at a time, retains only file records for the
state-hash preimage, and uses the existing per-entry limits plus a 128 MiB aggregate
decoded-read budget and 10,000-record cap. Repeated control/ledger validation reads
also consume that budget. It does not allocate an archive-sized hash preimage.

Export clones authored content, checks selectors against the opened source, writes
manifest plus comments with `current.kind: snapshot` and `history.mode: none`, then
independently reopens the ZIP and checks inventory, schema, CRC, exact state hash,
reply graph and selectors. Artifact verification is independent from source package
assurance: a recipient still needs its own verified original or a real backend
proof before trusting source/location claims, as required by S4.

## Persistence and publication

The existing persisted `namespace`/`reviewNamespace` fields identify the **private
editing workspace**. They are never passed as the artifact namespace. Each prepared
revision stores `{namespace, target, revision, bytes}` with a fresh UUID and
bounded ArrayBuffer. This avoids the Blob storage error reproduced in Windows and
Linux WebKit's IndexedDB; download/share still constructs a File from the exact bytes.
Unchanged preparations, download/share retries and reloads reuse those bytes.
Changed revisions discard the prepared candidate and allocate a new namespace.
Thread/comment UUIDs and the typed target remain unchanged. Preparation waits for
the browser save attempt before exposing download/share. If storage fails, existing
unsaved-work warnings and in-memory export remain available to prevent feedback loss.

Restore validates the stored artifact's target, revision, namespace, 16 MiB size
bound, ZIP/hash and selectors before exposing it. Invalid saved data stays available
for recovery. Prepared data participates in the same optimistic revision transaction
as review content; quota, conflict, stale-export, canceled/failed share and draft
deletion safeguards remain in place.

IndexedDB uses `mdpkg-viewer:snapshot-draft2:<base-path>` with schema version 1.
The app does not open, convert, merge or automatically delete the old database.
Package keys are canonical tuples of format, namespace, kind, ID and both addressing
profiles. Materialized states open as separate saved packages; drafts never move
from S0 to C0/C1 implicitly. Browser tests retain an old-domain sentinel to check this.

## Build evidence

The baseline production build measured 143,404 counted gzip bytes and 145,747 total
gzip bytes. Its export graph contained the Git writer and Buffer support. After
snapshot emission, a measured intermediate graph had no Git chunk; the old gate
correctly failed because it still required one. The unused Git writer, memory
filesystem and Buffer shim were then removed together with `isomorphic-git` and
`buffer` from the package and lock files.

The final measured build is **94,665 counted gzip bytes**, **96,992 total gzip
bytes**, four JS/CSS assets including the optional inflater, and **zero Git chunks
or import sites**. Counted size fell **48,739 bytes** (about 34.0%) with the existing
145,000-byte ceiling unchanged. All dynamic imports and CSS remain counted except
the explicitly deferred inflater. An independent esbuild export graph inspection
found 37 modules and zero Git/Buffer modules. No runtime-speed or memory benchmark
improvement is claimed.

V-1 now checks the three remaining pinned build/runtime libraries; historical Git
calibration stays in its investigation. V-2 requires snapshot emission and rejects
Git in the Review product graph. Pages CI validates both browser downloads with
independent Python ZIP/state-hash checks.

## Validation

The final Node suite passes **182 tests, zero failures or skips**. Full .NET suites
pass **1,447 tests, zero failures or skips on each of Windows and Linux**. Windows
uses .NET 10.0.300; the Linux run uses 10.0.401. An earlier concurrent Windows run
had 1,446 passes and one failure in the unchanged cancellation/staging test
`CancellationDuringGitWorkCleansStagingAndPreservesExistingOutput`; its isolated
rerun and the subsequent full suite both passed. No C# production code changed.

Both committed actual browser downloads passed the two Core/Reviews acceptance
cases and **14 independent Python checks each**. The fixtures and their byte hashes are documented in
[the browser fixture README](../../src/web-viewer/tests/fixtures/README.md).

The installed consumer proof passed for four packages, three external consumers,
two Core README examples, the explicit Reviews/Core bridge and installed CLI
pack/materialize/append/deep verification. The history-free proof passed **26
checks with zero Git invocations**; the separate existing managed-candidate feed
passed **12 checks with zero Git invocations**. That candidate feed was retained
from S4 because S5 changes no backend product code.

The final Linux browser matrix passes **189 tests, zero failures**, across
Chromium, Firefox and WebKit. Both newly downloaded files then passed **14
independent ZIP/hash checks each**. The final Windows review/export run passes
**19 tests, zero failures** across the same three browser engines.

Windows browser validation is **not wholly green**: the final targeted persistence
run passed **13 of 15**, with two WebKit timeouts. An isolated retry of those two
also timed out: `changed text under the same declared identity preserves feedback
for recovery` timed out while reading saved rows through `page.evaluate`, and
`two tabs preserve conflicting text and deletion defeats stale writers` timed out
during `browserContext.newPage`. Both pass in the final Linux WebKit matrix. The
earlier Windows full matrix was **181 passes / 8 failures**; the subsequent focused
runs cover its failing cases. No platform-specific product cause is claimed for
the two remaining timeouts; Windows WebKit stability remains a review limitation.

Initial failures exposed obsolete database names and a stale Git-chunk test hook, then an actual
WebKit IndexedDB Blob-storage failure. Tests now use the fresh domain and a real
hash boundary; product persistence stores exact ArrayBuffers. New authoring tests
wait for the document to load, and the existing delayed-scroll test lets explicit
navigation paint before taking its baseline (the original Firefox failure was
1218 versus 1219 pixels). No assertion tolerances or test timeouts were increased.
The first Windows run before those test updates was **162 passes / 12 failures**;
the first Linux matrix before the Blob/readiness/paint fixes was **184 / 5**.
The Blob-era Windows focused WebKit retry was **0 / 5**; the final **19 / 0**
review/export run includes all five of those cases on each engine.

From `src/web-viewer`:

```powershell
npm ci
npm test
npm run test:browser
python tests/validate-export.py tests/fixtures/browser-v2.mdpkg
python tests/validate-export.py tests/fixtures/browser-commit-target.mdpkg
```

From `src/generator-cli`:

```powershell
dotnet test -c Release --solution Mdpkg.slnx
dotnet pack -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
```

The separate managed-candidate proof uses
`python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed`;
that feed must have been built with `-p:MdpkgManagedSnapshotCandidate=true`.
Keep it separate from the ordinary release feed. Browser CI uses Playwright 1.55.1;
the Linux matrix here ran in `mcr.microsoft.com/playwright:v1.55.1-noble` with
Node 22.19.0, and Windows used the locally pinned browser installations.

Review focus: selective versus verified assurance, exact S1 state-hash/schema parity,
prepared-artifact restore checks, namespace rotation/reuse and storage isolation.
Native mobile share destinations and a general browser history backend remain
outside this slice. S6 integrated release documentation/acceptance remains separate.
