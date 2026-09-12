# CARD-0051: deferred history and an uncommitted package

Date: 2026-09-12. Investigation and design proposal only, completed against
revision `96281d5` and the full CARD-0051 description on the markdown-package
board (card `f10e539e-ceb5-4c13-a7a4-1b51d286bb84`, description updated
2026-09-12 09:35:39 UTC). An existing unfinished draft and its eight earlier
measurements against `c1c829b` were checked and extended with eight measurements
after CARD-0050's delta-compression change. No format specification or product
code is changed. The proposed version and field names below are not adopted.

## Recommendation

**A package containing only an immutable current snapshot is feasible, and it
can acquire Git history later. It requires a new wire version, an independently
verifiable snapshot identity, and an explicit bridge to its first commit.**

Recommend **retain version 1 and finish CARD-0050's acceptance work first**. Do
not implement this format change on the strength of the Git dependency or
subprocess complaint: CARD-0050 addresses those without a compatibility change.
At this revision its managed candidate works, and its cross-file deltas have
closed the measured large/similar-file compression gap. Native Git is still the
production default: review, the isolated performance gate and activation remain
separate work. This investigation does not authorize or complete those gates.

There is nevertheless a separate, measured storage problem. In the one-document
case, Git entries occupy 2,248 bytes and the history descriptor another 311 bytes
of a 3,172-byte native package (2,563 of 3,176 bytes for the managed candidate).
Removing those entries would remove 80.7% of that tiny archive before changing
the manifest. Across the larger managed examples the fraction ranges from 5.9%
to 57.3%; it is not uniformly negligible. This warrants
a future **opt-in snapshot format** if download/storage volume or the requirement
to contain no Git data is an actual product constraint. These corpus measurements
do not establish such a workload or its frequency. Introducing a second identity
model, review compatibility rules and a materialization path is disproportionate
to solving an installed-Git requirement already addressed by CARD-0050.

The owner can accept this recommendation, or choose the bounded version-2
proposal below for a separate spec-design stage. No answer was needed to produce
this investigation; proceeding to implementation does require that product choice.

## 1. Starting facts and two corrections to the card

This builds on the [CARD-0050 plan](2026-09-12-card-0050-git-independent-snapshot-plan.md)
and [candidate results](2026-09-12-card-0050-managed-snapshot-results.md), including
the [delta-compression follow-up](2026-09-12-card-0050-managed-delta-results.md), without
rerunning their addressing or missing-Git proofs. Live addressing needs no Git
objects; version 1 nevertheless requires a real current commit and a curated
repository in every package ([spec §§4, 5.1–5.2](../spec.md#4-the-manifest)).
An ordinary snapshot already contains only one parentless commit, rather than
the source repository's accumulated history.

Two claims in CARD-0051 need narrowing:

1. **Not every `mdpkg://` reference contains a commit.** The current document and
   section forms carry namespace, root, locator, profiles and expected scoped
   digest. Only `at=`, commit, diff and hunk references require commit IDs.
   CARD-0044's link adapter calls `formatReference(namespace, root, locator,
   expect)`, which deliberately omits a commit. See [spec §6.4](../spec.md#64-references),
   [reference.js](../../src/web-viewer/src/address/reference.js),
   [resolve.js](../../src/web-viewer/src/links/resolve.js) and
   [reference-preview.js](../../src/web-viewer/src/ui/reference-preview.js).
   The package opener beneath the adapter is still version-1-only.
2. **A real Git diff is neither necessary nor sufficient for confirmed moves.**
   The ledger is defined in §6.3; §6.5 consumes it. An identity-aware editor can
   confirm moves, retirements and reserved-slot births as edits happen. Two
   retained file trees suffice for an endpoint comparison; even Git explicitly
   supports filesystem comparison with [`diff --no-index`](https://git-scm.com/docs/git-diff).
   Similarity cannot establish editorial continuity. The specification already
   rejects automatic rename detection as identity authority. In code,
   [LedgerEngine](../../src/generator-cli/src/Mdpkg.Core/Internal/Addressing/LedgerEngine.cs)
   applies producer correspondence and checks root sets without a Git API.

“Untracked/unstaged” describes a working directory relative to a repository and
index. A no-Git archive has neither. Prefer **snapshot with no history** in its
user interface. Each emitted package still captures exact immutable bytes;
editing its contents requires a new state identity.

## 2. Measured remaining cost

Eight packages were freshly emitted using the existing native CLI and the
post-delta CARD-0050 managed-candidate CLI binaries, with identical namespace,
default metadata and compression settings. Their sizes reproduce CARD-0050's
latest measurements. This measures version-1 artifacts, not a new writer or its
performance. Raw entry sizes, archive hashes, CLI/Core/Reader binary hashes and
accounting are in
[size-results-after-deltas.json](deferred-history/size-results-after-deltas.json).
The checked earlier measurements remain in
[size-results.json](deferred-history/size-results.json); they describe the older
full-object candidate and must not be used as the current savings baseline.

| Input | Source bytes | Native / managed archive bytes | Native / managed Git entries, including ZIP overhead | History entry, including ZIP overhead | Remainder with the same manifest, either backend |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny: 1 Markdown file | 1,289 | 3,172 / 3,176 | 2,248 / 2,252 | 311 | 613 |
| Many small: 20 Markdown files | 25,790 | 7,426 / 7,565 | 3,887 / 4,026 | 312 | 3,227 |
| Large: 2 text files | 1,648,948 | 398,961 / 397,646 | 155,184 / 153,869 | 310 | 243,467 |
| Similar: 20 text files | 1,780,250 | 319,042 / 318,670 | 18,933 / 18,561 | 312 | 299,797 |

**The remainder is an accounting counterfactual, not a conforming package or a
measured version-2 size.** Its unchanged v1 manifest still requires the removed
entries. A new manifest, identity and any future provenance metadata have their
own costs. The current-view payloads and ZIP overhead remain in every column.

The tiny native archive decomposes exactly as follows:

| Region | Payload bytes stored in ZIP | Local + central headers/names | Total bytes |
| --- | ---: | ---: | ---: |
| `.git/HEAD`, config and main ref | 112 | 308 | 420 |
| Pack, holding 1 commit, 1 tree and 1 blob | 250 | 212 | 462 |
| Pack index | 1,156 | 210 | 1,366 |
| History descriptor | 197 | 114 | 311 |
| Manifest | 339 | 116 | 455 |
| Current document | 44 | 92 | 136 |
| ZIP end record | — | 22 | 22 |
| **Total** | | | **3,172** |

Thus the required **pack plus index payload** is 1,406 bytes; their full ZIP
contribution is 1,828 bytes. The full Git contribution is 2,248 bytes. Calling
all 2,559 Git-plus-history bytes “the commit” would misstate what is being saved:
the pack also stores the current document and tree, and the index dominates this
small case. The managed candidate adds four pack bytes, leaving the fixed costs.

CARD-0050's latest Windows managed creation-and-verification medians are
268.74 ms for large and 266.54 ms for similar, versus native 1,827.68 and
5,574.19 ms. The managed runs made zero Git calls. Its corresponding Linux
medians are 436.18/251.87 ms managed versus 1,135.72/937.24 ms native.
These are that investigation's timings, with its stated harness limitations.
**No deferred-writer speedup, memory saving or mobile improvement has been
measured here.** Snapshot identity would still hash every included byte; full
validation still needs decompression, path checks, ledger checks and digest
verification.

The older managed similar-files pack was 298,334 bytes. The current candidate's
pack is 16,031 bytes, slightly below native's 16,403. CARD-0050 already recovered
282,303 package bytes on that corpus while preserving v1. Deferred history's
remaining removable-entry cost is **18,873 bytes (5.9%)**, not the old 301,176
bytes. For large files, CARD-0050 recovered 91,213 package bytes; the remaining
Git-plus-history cost is **154,179 bytes (38.8%)**. Tiny and many-small retain
**2,563 bytes (80.7%)** and **4,338 bytes (57.3%)**, respectively. The remaining
cost includes both fixed repository/index overhead and duplication of current
content. It is not just an old full-history archive or a few commit-header bytes.

These four synthetic text shapes establish exact byte costs, not production
frequency, a typical savings percentage, or an economic break-even. At a million
tiny-package transfers, 2,563 bytes each is 2.563 GB decimal of removable entries
before replacement metadata; that is an illustrative multiplication, not an
observed workload. Distribution volume and actual document mix are the missing
product evidence. Browser current reads already skip the pack: deleting it does
not remove a history decode those reads perform today. A history-free writer
would avoid pack/index work on that path, but dual-format support and later
materialization add overall implementation complexity.

Review-only packages have the same fixed-cost issue. The existing spec's
[D-23 measurement](../spec.md#10-decisions-taken-in-this-specification-under-stated-defaults)
prices being a package rather than bare review JSON at about 2,613–2,615 bytes.
That is prior evidence, not a fresh review-size measurement here. A design that
still materializes Git on the first delta-review export would lose some of the
benefit it promises.

## 3. Candidate identity and package shape

If pursued, introduce `markdown-package/2` with a discriminated current state.
Keep the extension and ordinary ZIP envelope; retain the manifest-first bounded
typing scheme. This sketch is illustrative, with the digest abbreviated:

```json
{
  "mdpkg": "markdown-package/2",
  "addressing": {
    "anchor": "cm0312-trail-source-v1",
    "coverage": "complete",
    "digest": "cm0312-source-lf-v1",
    "overrides": null
  },
  "current": {"id": "sha256-<64 hex>", "kind": "snapshot"},
  "history": {"mode": "none"},
  "namespace": "c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"
}
```

The correlation key is **`(namespace, current.kind, current.id)`**. A committed
v2 state instead has `kind: commit`, a qualified Git ID, and `history.mode: git`
with the existing graph declarations and detail pointer. V1 inputs map to the
commit branch of this API model. A snapshot SHA-256 is never parsed as a SHA-256
Git commit: Git's reserved `sha256-` syntax is not a new snapshot capability.

Proposed snapshot hash contract:

- Hash a domain-separated canonical JSON preimage for `mdpkg-snapshot-v1`,
  including namespace, addressing declarations, the semantic review declaration
  if present, and a bytewise-path-sorted list of entry records. Each record binds
  exact path, fixed `100644` mode, byte length and SHA-256 of the stored decoded
  bytes. Canonical JSON follows the existing strict ordering/UTF-8/LF rules.
  The manifest remains O(1): the list is computed, not shipped as an index.
- Include **every current file**, the complete sparse ledger and review comment
  document when present. Hash exact LF-normalized stored bytes, including BOMs
  and trailing whitespace. Scoped source-digest normalization is not sufficient
  to identify the whole package state. Bind the addressing coverage and profiles
  so identical documents with different resolution semantics cannot share a key.
- Exclude `current` itself, ZIP headers/compression/order, and corroborating
  `review.of.packageDigest`, `packageBytes` and `dispatch`. Include the review's
  target identity, shape and detail path. Snapshot mode forbids Git and history
  entries and undeclared control sidecars, so omitted semantic payload cannot
  evade the hash. Specify extension admission before allowing new semantic fields.
- A full validator recomputes this digest. A selective opener may expose the
  declared identity without reading every document, but must distinguish declared
  from verified identity. Requiring verified identity during every preview/open
  would destroy the bounded current-view read advantage. The v1 reader-versus-
  validator distinction in §11.2 item 13 needs an explicit v2 resolution.

This is a content-state identity, not authentication or a send identifier.
Re-ZIP/recompression preserves it. Changing a path, source byte, ledger record
or semantic declaration changes it. Identical states in the same namespace
share it; optional dispatch still distinguishes separate sends. Historical
commits continue to distinguish identical trees reached through different
parents or commit metadata.

Identity alternatives and tradeoffs:

| Alternative | Problem |
| --- | --- |
| Namespace alone, missing/null `current`, or a constant “uncommitted” token | Different snapshots collide in review correlation and saved-work keys. |
| Raw ZIP SHA-256 | Recompression changes identity despite identical state; already measured and rejected in D-25. |
| Random package UUID | Distinguishes instances without binding their bytes or proving a future commit relationship; repeats §9's rejected instance GUID. |
| Existing section roots or digests combined without exact entry bytes | Misses files, paths or source differences outside that scoped normalization. |
| Git tree ID | A viable file-tree identity without stored objects, but requires Git tree encoding and does not bind addressing/review declarations outside that tree. A semantic wrapper and a distinct identity kind remain necessary for the proposed state identity. It still changes the wire and consumer contracts. |
| Precompute a virtual commit ID, omit its repository | A viable storage-only design under a new wire version. It retains commit-shaped keys if every commit byte, tree and metadata value is fixed and hashed up front, and must expose that Git objects are unavailable until reconstructed. It violates v1's required repository; it defers storage, not commit identity construction. |

The virtual-commit alternative could reduce identity migration and deserves
reconsideration if bytes become the sole requirement. It does not deliver the
card's stronger premise of deferring Git identity itself. The proposed snapshot
hash instead avoids a Git serialization requirement for initial producers, at
the explicit cost of a second identity kind and a later verified bridge. This
is a design choice, not a claim that SHA-256 snapshots are the only feasible
representation.

Initially bound snapshot mode to **one newly established lineage state**, with
no imported or discarded history and no unknown correspondence. Its `complete`
addressing declaration covers that singleton, not an undisclosed earlier chain.
An authoritative nonempty ledger from preparation of that first published state
may be carried and is hash-bound; its targets, retirements and reserved births
must be checked. This is not a way to relabel discarded published history as a
new complete lineage. Do not introduce a zero-commit
`history.coverage: complete`: use explicit `mode: none`, with no history detail.
Partial/unverified imports remain on the existing committed path. Broader chains
of history-free snapshots require a checkpoint/coverage model of their own and
are outside this first proposal.

## 4. What works, what is unavailable, and what can be deferred

| Operation | Snapshot with no history |
| --- | --- |
| Browse current files, ordinary relative links, CARD-0044 preview | Works after the container opener understands v2; addressing/preview algorithms need no new Git operations. |
| Current document/section reference, same-source or source-changed result | Existing root/digest/ledger procedure applies. Loose links remain at-less and select the package the caller opened. |
| Confirmed move, heading rename, split/merge/deletion, reserved-slot birth | Needs producer evidence and retained ledger, not commit storage. Never infer identity from endpoint similarity. |
| Compare two supplied file snapshots | Can produce an endpoint diff before committing. It is not yet a v1 commit/diff/hunk reference with verified Git endpoints. |
| Current selector/quote review | Works with typed reviewed identity and the exact reviewed snapshot. A v2 delta review may itself be a history-free snapshot in a fresh reviewer namespace. |
| Existing `at=<commit>`, commit, diff and hunk URI | No matching Git object exists. Report history unavailable/capability unavailable; never silently use current. Require materialization before minting these references. |
| “Touched since review,” edit/revert, deleted/recreated between publications | Cannot recover unretained transitions from equal endpoints. Return unknown; preserve transitions/events when they occur if this query is promised. |
| Git author/committer/message or ancestry | Absent until materialization; do not fabricate historical authorship or timestamps. |
| Bundled review under D-24 | Requires the reviewed parent commit and a review-only child diff. Materialize first and define the verified snapshot-to-parent bridge. |
| ZIP extraction | Still ordinary files, but `git read-tree HEAD`/`fsck` cannot work until repository materialization; §3.8's extraction guarantee is conditional in v2. |

The difficult boundary is **evidence retention, not commit creation time**.
Deferring bytes that can be regenerated from a preserved snapshot is safe;
discarding the only snapshot, transition or editorial decision is not.

## 5. Clean materialization from first snapshot to a second version

Let `S0` be the published uncommitted snapshot with identity `(N, snapshot, H0)`.
Let `S1` be a new captured tree. Git allows creating a root commit from a tree
and then a child with an explicit parent; it does not require those objects to
have been written when the files were first published
([`git commit-tree`](https://git-scm.com/docs/git-commit-tree)). The following
protocol is feasible but is not implemented in this repository:

1. Retain or obtain the **exact S0 bytes and semantic manifest**. Recompute H0;
   a digest alone cannot reconstruct deleted files, old source, or the old ledger.
   Preserve S0 as the immutable review target rather than rewriting it in place.
2. Create a deterministic parentless bootstrap commit `C0` with S0's exact
   current files and ledger. Specify a bootstrap serialization profile: fixed
   service author/committer and time, and a message binding N and H0. These are
   explicitly synthetic metadata, not the original author's claimed date.
   Two implementations given S0 must produce the same C0.
3. Process S0→S1 correspondence with the existing producer obligations. Preserve
   origin roots and old ledger entries, flatten confirmed moves, mint reserved
   births, record retirements, and mark unresolved correspondence partial. Capture
   the decisions when they happen, or require confirmation later. A diff alone
   does not authorize `to`/`dead` records.
4. Commit S1 as `C1` with parent C0, track its resulting ledger, and emit a real
   curated Git repository. Declare coverage for retained published checkpoints
   only. `root: original` is justified for this explicitly new lineage beginning
   at S0; it is not a claim to imported history or unpublished editor keystrokes.
5. Extend v2 `history.json` with an origin-binding record containing H0, C0, the
   bootstrap profile and S0's semantic hash header. This is outside the Git tree,
   avoiding commit self-reference. Verify the binding by reconstructing H0 from
   C0's tree and header and checking the exact bootstrap commit serialization,
   no-parent rule and namespace. Merely storing an arbitrary `H0 → C0` pair is
   not evidence. Unbounded bindings belong in history detail, not the manifest.
6. Keep existing reviews' `review.of` pointed at the snapshot identity. A v2
   resolver can use the verified binding to locate its original checkpoint and
   interpret coverage from C0 to a caller-selected newer target. This is a
   verified relationship, not blanket equality of all snapshots and commits
   with the same files. No review selector, root or `expect` is rewritten.

If history is requested before any edit, materialization stops at C0 with its
binding; it does not invent a changed child. The bootstrap's synthetic service
metadata must be visibly distinguished from historical authorship. Its proposed
`root: original` means the first checkpoint of a newly declared lineage, while
v1's `root: synthetic` denotes truncated earlier history. The v2 spec must state
that distinction explicitly, or choose a dedicated bootstrap-root value.

Use materialization on the first **published successor in the same lineage**,
or earlier for commit-pinned export, Git extraction or a bundled review. A simple
current review or endpoint comparison need not trigger it. Publication is the
bounded rule that avoids an additional uncommitted checkpoint graph: repeatedly
exporting edited history-free snapshots and keeping only the latest cannot
promise continuity or touched-since answers. To postpone beyond that boundary,
retain every promised checkpoint and its correspondence evidence somewhere;
the storage obligation is deferred or externalized, not eliminated.

That publication trigger is a recommended first-release scope restriction,
not a mathematical requirement of addressing or diffs. A product needing many
history-free publications can choose a broader retention model in spec design;
it then owns the checkpoint identity, event coverage and retrieval contract.

If S0 has been lost, materialization cannot recover it from H0. Reject an exact
continuation request; an explicitly chosen fresh/truncated lineage must report
the lost evidence and cannot claim old reviews survive. If C0 is later removed
by squash/truncation, its binding alone cannot supply the old document or answer
an exact historical query. Retain the original snapshot, or return unavailable.
Summaries needed for touched queries must be made before discarding transitions,
as §5.4 already requires. Competing branches from the same S0 share C0 under the
bootstrap profile, but their children remain distinct; this proposal adds no
automatic merge policy.

For a bundled v2 review of S0, C0 is the materialized reviewed parent and the
child changes only `.mdpkg/review/`. The validator checks the binding plus the
review-only tree diff. Restrict `snapshot` packages with a review declaration to
`shape: delta`; a bundled package is committed. This preserves the authority
boundary behind D-24 rather than weakening it.

## 6. Versioning and compatibility

The authoritative carrier is `mdpkg: markdown-package/1`, not an addressing
profile ([spec §§3.1, 4](../spec.md#31-file-typing-one-79-byte-read)). The
`cm0312-…-v1` tokens version hashing and locator semantics. Changing them cannot
make optional the commit, refs, history descriptor or pack. A flag such as
`profile: uncommitted` inside an otherwise v1 manifest cannot override those
unconditional obligations. Neither `history.coverage: unknown` nor a fake
all-zero commit is a valid escape hatch.

Therefore use a **new package wire version**, with snapshot and Git modes within
it, rather than weakening v1. New readers accept both versions; old readers must
reject v2 explicitly. The one-digit `/2` token can retain the same prefix width,
but both fixed-offset typing and central-directory fallback need version-aware
dispatch. Generic ZIP readers can still list files; that does not make old
package-aware readers compatible.

No new anchor or digest profile is needed if those algorithms remain unchanged.
The existing `/v2/` **URI grammar version is independent of package version**.
Keep its current forms and Git-only endpoint meanings. This first proposal does
not mint snapshot-pinned URIs: exact snapshot targets exist in typed review/API
identities, and a user needing a commit-pinned URI materializes first. If a future
requirement needs URI pinning directly to H0, introduce a separate reference
grammar revision with a typed snapshot target. Do not silently broaden `at` or
pass a snapshot digest through the existing Git-ID regex.

Review-comment document versions 1/2 are independent too. Their
[existing schema](../spec/review-comments.schema.json) carries roots, locators,
digests and selectors; the package target identity lives in manifest `review.of`.
This proposal changes that declaration and its API validation. It does not by
itself require a new comment-document or selector profile version.

V1 interchange remains available by explicitly materializing a commit and
emitting a v1 package. Its identity is then `(N, C0)`. V1 cannot carry the proposed
origin binding or a snapshot-valued `review.of.current`, so this is **not a
transparent identity-preserving downgrade**. Keep S0 and its v2 reviews available
to a v2-aware bridge; creating a new v1 review artifact is a separate conversion,
not permission to edit an existing review's correlation key. Do not change the
default writer format until consumer support and interoperability have shipped.

## 7. Consumer ripple at the inspected revision

| Surface and evidence | Required change or retained behavior | Scope |
| --- | --- | --- |
| [Core contracts](../../src/generator-cli/src/Mdpkg.Core/Contracts.cs), [builder](../../src/generator-cli/src/Mdpkg.Core/Internal/PackageBuilder.cs) | Explicit output version/mode; typed identity and history availability; snapshot hashing; mode validation; deterministic materializer and transition path. Existing source capture, normalization, ledger and atomic publication remain reusable. | High; new producer feature and public contract work. |
| [Core validator](../../src/generator-cli/src/Mdpkg.Core/Internal/Validation/PackageValidator.cs), managed snapshot verifier | Branch validation by mode; validate state hash and forbidden mixtures; bootstrap bindings; mode-specific checks instead of treating missing Git as successful Git verification. Managed v1 verification remains required for v1. | High; an additional conformance model. |
| [Reader archive](../../src/generator-cli/src/Mdpkg.Reader/PackageArchive.cs), [ZIP typing](../../src/generator-cli/src/Mdpkg.Reader/Internal/Container/ZipReader.cs), [format validation](../../src/generator-cli/src/Mdpkg.Reader/Internal/Format/FormatValidation.cs) | Current opener validates v1, reads history and main ref unconditionally. Add early version/mode dispatch and snapshot identity verification capability; update reserved control paths. | High; all package opens flow through this boundary. |
| [Reader identity](../../src/generator-cli/src/Mdpkg.Reader/ReadLimits.cs), [addressing](../../src/generator-cli/src/Mdpkg.Reader/Addressing.cs), [loose references](../../src/generator-cli/src/Mdpkg.Reader/LooseReference.cs) | `PackageIdentity(string Namespace, string Current)` and `Profile.Oid(reviewed.Current)` assume commits. Add a tagged identity and explicit availability. Keep root/digest/locator parsing and current ledger logic. | Medium/high; API equality, serialization and downstream callers. |
| [Reviews parser](../../src/generator-cli/src/Mdpkg.Reviews/ReviewParser.cs), [resolver](../../src/generator-cli/src/Mdpkg.Reviews/ReviewResolver.cs), [models](../../src/generator-cli/src/Mdpkg.Reviews/Models.cs) | Typed `review.of`, exact-source correlation, verified origin bridge, coverage and bundled-lineage verification. Preserve feedback on unsupported targets. `VerificationLevel.Full` currently includes Git integrity; define mode-appropriate verification rather than reporting an absent repository verified. | High; schema and safety of returned feedback. |
| [Web format](../../src/web-viewer/src/format.js), [container conformance](../../src/web-viewer/src/container/conformance.js), [reader](../../src/web-viewer/src/container/reader.js), [inbound open](../../src/web-viewer/src/inbound/open.js) | Exact `/1` magic, SHA-1 current, history presence and one-pack rule currently block or flag the new shape. Add dispatch and explicit capabilities while retaining selective reads. | Medium/high. |
| [Web reference resolution](../../src/web-viewer/src/address/resolve.js), [link adapter](../../src/web-viewer/src/links/resolve.js), [preview](../../src/web-viewer/src/ui/reference-preview.js) | At-less references and relative links retain their format. Adjust `observedAt`, comparison to current, coverage and history-availability messaging. No preview rendering or CommonMark rewrite is indicated. | Low/medium once the opener and identity model work. |
| [Web review export](../../src/web-viewer/src/review/emit.js), [Git writer](../../src/web-viewer/src/review/git.js) | Export currently always creates a one-commit v1 delta and self-checks its Git/history fields. Add v2 target and output-mode handling; keep v1 output for v1 targets. Snapshot export could avoid loading the Git writer for that operation. | Medium/high; new interoperable export branch. |
| [Persistence model](../../src/web-viewer/src/persistence/model.js), [session](../../src/web-viewer/src/persistence/session.js), [store](../../src/web-viewer/src/persistence/store.js) | Saved-package key includes format, namespace, current and profiles. Keep existing v1 keys stable, introduce typed v2 keys, and define explicit migration/alias handling when materialized. Do not merge drafts or revisions merely on namespace or equal tree content. | Medium; recent items, drafts, export recovery and cache identity. |
| CLI, examples, NuGet consumers and release checks | Update pack/validate options, JSON output contracts, diagnostics, help and extraction examples; qualify supported package versions. External adoption and persisted identities need a migration policy. | Medium; coordinated release beyond one library. |

The CLI's [update command](../../src/generator-cli/src/Mdpkg.Cli/Commands/UpdateCommand.cs)
currently calls [Stub.Run](../../src/generator-cli/src/Mdpkg.Cli/Commands/Stub.cs).
The materialization/update path is **new implementation**, not a small branch in
an existing working incremental writer. The web resolver currently reports
`history-reader-required` for non-current historical references; it does not
already implement the historical backend this design will eventually need.

Planning estimate: six coordinated workstreams—format/identity, producers and
materialization, validation/Reader, Reviews, web read/export/persistence, and
compatibility/release fixtures. These affect all three public .NET libraries,
the CLI and browser. They are several separately reviewable changes plus an
integration phase, not a one-field relaxation. No calibrated engineer-day
estimate or count of affected third-party consumers is available from this repo.
Directly replacing public record field types would break source/binary contracts;
prefer additive v2 contracts/adapters, or deliberately version the library API.

## 8. Acceptance requirements if the owner pursues v2

Before implementation, settle the canonical snapshot preimage and extension
rules, bootstrap serialization/binding, review schema and verification contract.
Then test at least these independent properties:

- Same decoded state survives ZIP reorder/recompression; every file/path/ledger
  and semantic-header mutation changes H0; dispatch and ZIP changes do not.
  Equal current trees with different committed ancestry retain distinct commit
  identities. Namespace collisions and mixed identity kinds are rejected.
- First snapshot → deterministic C0 → changed C1 preserves old current links,
  review target and selector evidence. Two materializers agree on C0. Reject
  forged aliases, missing S0, wrong original header/tree and wrong namespaces.
- Confirmed rename, heading change, split/merge, delete/recreate and reserved
  births preserve the existing ledger outcomes. Unconfirmed transitions remain
  unconfirmed; edit/revert with lost checkpoints remains unknown.
- V1 outputs and old saved sessions remain usable. Old readers reject v2;
  v2 readers accept both. No null/current coercion, fallback to a different
  snapshot, or false verification success on a missing repository.
- Delta reviews can target and originate from snapshots. Bundled reviews require
  verified materialization and review-only changes. Exact-source resolution,
  explicit newer-target selection and recovery of drafts retain their safeguards.
- Measure actual snapshot writer size/time/memory against the final accepted
  CARD-0050 implementation on representative production inputs. Verify bounded
  current reads, full hash validation budgets, cancellation and atomic publication.

## 9. Evidence and reproduction

This completion ran **8 successful post-delta pack probes**, returning **184
passed self-validation check rows and 0 failed rows**. All 8 archives passed
Python ZIP CRC checks and exact byte-accounting reconciliation; all declare one
retained commit. The eight earlier archives were independently checked against
their recorded SHA-256, CRCs and size accounting, and each input file was checked
against the existing benchmark's corpus recipe. Earlier pack check counts are
retained evidence, not additional tests run during this completion.
No application regression suite or new-format build was run. Source
inspection establishes the consumer findings; materialization and v2 behavior
above are proposals, not experimentally verified implementations.

Measurements used Windows, Git 2.50.1.windows.1 and pre-existing Release CLI
binaries from CARD-0050's completed delta-compression work. SHA-256 of each
CLI, Core and Reader binary is recorded with the new data. No rebuild was needed.
The source inspection revision and binary hashes distinguish inspected source
from the pre-existing artifacts actually executed; package/pack sizes match the
committed delta benchmark on both target corpora.
The four shapes reproduce
[ManagedSnapshotBenchmarks.cs](../../src/generator-cli/tests/Mdpkg.Core.Tests/ManagedSnapshotBenchmarks.cs):
tiny/many use `# File i\n` plus 64 repetitions of `Snapshot paragraph.\n`;
large has 16,384 numbered lines per file using the benchmark's hexadecimal
sequence; similar has 2,048 shared numbered lines plus one variant line. Files
are named `file0.md`, etc., UTF-8 with LF, and have no ledger. No optional reverse
index or data descriptors were requested.

Local, ignored inputs and earlier outputs are at
`C:\src\markdown-package\.antiphon\task-c5a157c4-probes\`; fresh packages and
their individual CLI JSON results are at
`C:\src\markdown-package\.antiphon\task-3980a077-probes\`. The durable results
include every entry's decoded size, compressed size, ZIP contribution and method,
so their conclusions do not depend on these scratch packages surviving.

The exact native invocation pattern, from the repository root, is:

```powershell
dotnet src/generator-cli/artifacts/bin/Mdpkg.Cli/release/mdpkg.dll pack .antiphon/task-c5a157c4-probes/tiny --out .antiphon/task-3980a077-probes/tiny-native.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8 --format json
```

Repeat for `tiny`, `many-small`, `large` and `similar`. The managed invocation
substitutes
`.antiphon/task-288d65a9-delta-windows-candidate/bin/Mdpkg.Cli/release/mdpkg.dll`
and a separate `*-managed-delta.mdpkg` output filename. If these binaries no
longer exist, build `96281d5` in an isolated checkout, once normally and once with
`-p:MdpkgManagedSnapshotCandidate=true`, using separate artifacts paths. Build
the CLI project in Release; the existing benchmark source supplies the complete
corpus recipe if scratch inputs have gone. Rebuilding later code measures a
different candidate. The older JSON instead corresponds to `c1c829b` and
`.antiphon/task-288d65a9-candidate/`. There is no deferred-format executable to rerun.

For these ZIP32 files without extras, comments or descriptors, each member's
contribution is exactly `compressedSize + 30 + 46 + 2 * utf8PathLength`.
The sum of member contributions plus the 22-byte end record must equal archive
length. Sum `.git/` members and the `.mdpkg/history.json` member separately.
Archives with descriptors, extras or directory records need their actual extra
bytes counted rather than using this restricted formula.

## Decision handoff

Recommended decision: leave v1 unchanged and complete CARD-0050's remaining
review, isolated performance and activation gates. Its measured compression gap
is already closed. Retain this proposal as a separate size/format option.
If no-Git artifacts or measured distribution costs justify it, approve a v2
spec-design stage using typed snapshot identity, one initial history-free state,
verified deterministic materialization and dual-version consumers. Do not proceed
directly to code or silently redefine current v1 packages.
