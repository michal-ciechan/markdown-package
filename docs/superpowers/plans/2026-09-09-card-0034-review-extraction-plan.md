# Investigation and plan: extracting returned review feedback in .NET

CARD-0034. Written 2026-09-09 against `ff8bab5`, the full card description, format
specification §§4 and 6.8, and the CARD-0018 viewer plan. Investigation/planning only:
this document does not implement a schema, library, workflow or authoring UI.

## 1. Outcome and ground truth

**The annotation format already exists.** Implement reading it, not a second feedback
format. The missing pieces are a production author/export path in the web app, a public
.NET extraction API, and a normative way to distinguish a change request from commentary.
Comments can be extracted without the original; verified current locations cannot always
be supplied without it. Preserve both facts in the API.

| Repository evidence | Finding and consequence |
| --- | --- |
| `docs/spec.md` §4 | A manifest `review` object identifies a review package and the reviewed `(namespace, current)` pair, plus optional file digest/length and opaque dispatch metadata. Without `review`, the archive is not a review package. |
| `docs/spec.md` §6.8, D-20–D-26 | Defines canonical `comments.json`, threads, authors/replies, state, anchors/selectors and two return shapes. Review feedback is a separate artifact; do not modify the sender's original file. |
| `src/web-viewer/src/address/resolve.js` | Implements current-reference identity resolution and ledger dispositions. A `dead`, `unknown` or `to` record is producer correspondence evidence, not a human comment or request. |
| `src/web-viewer/src/inbound/open.js` | Lists only non-reserved documents. `.mdpkg/review/comments.json` is deliberately absent from ordinary browse. A delta return has no ordinary document to show; successful container opening does not mean review-thread display exists. |
| `src/web-viewer/src/container/conformance.js` | Checks review declaration, detail existence, shape/namespace relationship and optional correlation metadata. Does not parse threads or establish bundled parent/tree restrictions. |
| `src/web-viewer/src/` and README | Browse/current addressing only. No `review/`, selection mapping, comment editor, review writer, share/export or thread display implementation. README explicitly defers selectors/history/thread display. |
| CARD-0018 plan slices 5–9 | Selection mapping, selector/comments document, emission, outbound and resolution are planned, not shipped. Its default writer is delta only; bundled writing is deferred. |
| `docs/investigations/viewer-app/review_probe.mjs`, `mdpkg_writer.mjs`, `validate_review.py` | Browser-oriented interoperability evidence, not app features. Older `review-comments/roundtrip.py` uses historical shapes/abbreviated IDs; do not accept its data as the current schema solely because it was a probe. |
| `src/generator-cli/src/Mdpkg.Cli/Engine/` | CARD-0035 now provides real ZIP, Git, canonical JSON, inventory/ledger and validator code. All remains internal to the executable; no Core/Reviews NuGet library exists. |
| `Engine/Validation/PackageValidator.cs` | Checks review manifest namespace/shape and, in deep mode, delta history or bundled parent/changed paths. It does not deserialize and validate thread/comment/selector contents. A generic validator success is insufficient feedback validation. |
| `Engine/Container/ZipContainer.cs` | Reads all member payloads into `ZipMember.Bytes`, with no upload-oriented aggregate budget. Reuse profile checks, but refactor into bounded directory indexing and selective entry reads before exposing it to a backend. |

The CARD-0033 plan was written against `e244bd9` and describes a scaffold. Its extraction
inventory must be refreshed against CARD-0035, rather than reimplementing the new engine.
This plan proposes a refinement to its one-library boundary; it does not silently rewrite
that sibling deliverable or claim its work has landed.

## 2. Existing wire contract to retain

Read the manifest first, then the entry named by `review.detail`. The initial implementation
supports the canonical `.mdpkg/review/comments.json` location already required by both
production readers; report an unsupported detail path rather than searching for any JSON
file that resembles feedback. The spec says “normally” for this path, so document this
capability restriction and resolve the general-path contract before broadening it.

| Layer | Existing fields and meaning |
| --- | --- |
| Review identity | Review package's own namespace/current, distinct from the reviewed identity. Keep both in extracted results. |
| `review.of` | Required reviewed namespace and qualified commit ID; optional `packageDigest`, `packageBytes`, `dispatch`. Match identity on namespace/current, not filename, dispatch or ZIP digest. A matching commit with a different package digest is re-emission evidence, not a correlation failure. |
| Document header | `version: 1`, anchor `cm0312-trail-source-v1`, digest `profile: cm0312-source-lf-v1`, selector `cm0312-quote-context-v1`, `threads`. Header profiles refer to the reviewed package. |
| Thread | Random UUID `id`, origin `root`, encoded `loc`, scoped digest `expect`, `state`, `select`, ordered `comments`. Anchor is fixed for the thread; replies do not re-anchor. |
| Locator | Decode base64url canonical JSON into scope kind, document path and exact occurrence-counted heading trail. Retain the raw value as well as a typed representation. It is the reviewed locator, not proof of today's location. |
| Selector | `start`, `end`, exact `quote`, zero-based `occurrence`, up-to-40-character `prefix` and `suffix`, all over canonical scope source. It never crosses an entity boundary. |
| Comment | `id`, `at`, `author`, `body`, optional `inReplyTo` naming a sibling. Array order is authoritative; timestamps are display metadata. |
| Workflow state | Thread `open`, `resolved`, `obsolete`, set by its producer. This is separate from anchor validity and does not prove that a backend applied a requested edit. |

There is no structured request-versus-comment field, replacement patch, acceptance decision,
or automatic-application contract in v1. A body saying “please change X” remains authored
prose. Do not infer a normative kind from wording or confuse `flagged-changed` with a human
change request. Do not extract feedback from history range summaries or addressing overrides.

**Return shapes:** default to a separate **delta** return in the reviewer's fresh namespace,
with its own review-only one-commit lineage, as §4 currently requires. It references the
sender's existing package. **Bundled** is also a separate returned file, but continues the
reviewed lineage: namespace equals `review.of.namespace`, parent is `review.of.current`,
and tip changes are only under `.mdpkg/review/`. It contains the documents/history needed
for an archival recipient. It is not an arbitrary ZIP containing an original plus comments.
Implement parsing for both shapes; distinguish parsing from verification of those Git claims.

The spec also says comment edits are commits, which needs reconciliation with the delta
one-commit rule before the authoring app starts retaining multi-commit review histories.
Default initial exports to one-commit delta snapshots; do not expand accepted lineage rules
privately inside the backend.

## 3. Narrow schema decisions for follow-on implementation

Do not change the format as part of this card. Adopt these proposals in a small spec-first
slice shared with the future authoring card, with fixtures proving compatibility.

**F-1 — Read v1 feedback unchanged.** Return `Kind = Unspecified` with
`KindSource = LegacyV1` for every v1 comment. This preserves requests written as prose
without falsely claiming they are classified ordinary comments. Consumers may optionally
classify them downstream, recording that as an inference separate from the authored data.

**F-2 — Add comments-document v2 for authored intent.** Keep the same manifest review object,
detail path, anchors, selector contract and thread states. Require a per-comment
`kind: "comment" | "change-request"` in v2; per-comment is preferable to per-thread because
a discussion may include a request and explanatory replies. A request body describes the
desired change; it is not an executable patch. Replies carry their own kind. Keep resolution
at thread scope; do not add acceptance/rejection or “applied” claims without a separate
workflow design. A schematic new comment is:

```json
{"id":"<uuid>","at":"<timestamp>","author":"<author>",
 "kind":"change-request","body":"State the default explicitly before this paragraph."}
```

The sketch is not a valid complete fixture. Publish full canonical fixtures in the spec
slice. The document version changes because silently ignoring an intent discriminator can
lose meaning. This does not itself require changing ZIP magic `markdown-package/1` or root/
digest profiles. Unsupported document versions/kinds return a capability diagnostic, not
an empty list or a silently downgraded comment. Writer emits v2 only after the receiving
backend supports it; retain a v1 compatibility export with an explicit intent-loss warning
if the product needs older readers.

**F-3 — Close interoperability gaps before declaring selector conformance.** §6.8 calls
offsets “characters” without specifying Unicode scalar values versus UTF-16 code units.
JavaScript and .NET strings naturally support UTF-16 indexing, whereas older Python probes
can count scalars. Proposed clarification: UTF-16 code units, half-open ranges, no split
surrogate pairs, with prefix/suffix lengths in the same units. Check existing fixtures and
producers before applying this to the named profile; if incompatible output exists, introduce
a new selector profile instead of reinterpreting old offsets. Until settled, preserve legacy
selectors but return `UnsupportedOffsetConvention` for non-BMP-sensitive position checks;
never claim offsets verified merely because ASCII fixtures agree.

Also specify comment-ID syntax and uniqueness scope (proposed lowercase UUIDs, unique within
the review document), timestamp grammar (proposed RFC 3339 with explicit offset), required
versus optional `select`, empty-thread/body handling, duplicate JSON-key rejection,
unknown-field handling and reply-edge rules. Proposed v2 requires nonempty comments and body,
an explicit selector, unique thread/comment IDs, same-thread reply targets and no self/cyclic
reply edges; timestamp order does not constrain reply order. Read v1 according to its
documented guarantees, reporting ambiguity rather than inventing missing identifiers or
anchors. Preserve unknown non-semantic properties as bounded extension data; reject unknown
semantic discriminators. Finalize these details in a checked-in JSON schema plus prose rules.

§6.8's prose mentions occurrence as a last-resort tiebreak, but its resolution algorithm
requires refusal on context ties. Follow the explicit refusal rule; clarify it in the spec.
Do not copy the older probe's occurrence fallback, which can silently choose a target.

## 4. Library boundary recommendation

**Separate `Mdpkg.Reviews` from creation, sharing a small `Mdpkg.Reader` foundation.** Keep
the sibling package name `Mdpkg.Core` for creation compatibility with its plan. All initially
target the solution's `net10.0`; this is a reuse decision, not a new runtime compatibility
claim. Package names/ownership and publication remain subject to the sibling release plan.

```text
Mdpkg.Cli -> Mdpkg.Core -> Mdpkg.Reader
Mdpkg.Reviews ----------> Mdpkg.Reader
```

| Package | Owns / dependencies |
| --- | --- |
| `Mdpkg.Reader` | Bounded ZIP32 indexing/member access, canonical format reading and common typed identity/locator/profile data; current-view CommonMark source inventory, digest and ledger resolution; structural validation. No CLI, package writer or native Git process dependency. |
| `Mdpkg.Core` | Creation/source enumeration, ZIP emission, Git import/packing and full/deep validation orchestration. Depends on Reader for shared format checks. Native Git remains this implementation's prerequisite. |
| `Mdpkg.Reviews` | Review schema parsing, correlation, thread flattening, selector resolution and extraction diagnostics. Depends on Reader, never Core/CLI. Reuses Reader's parser for verified document/section locations instead of shipping a second CommonMark implementation. |

A creation-only application restores Core and Reader, not review schema/selector processing.
A review-only application restores Reviews and Reader, not writing/import code or native Git.
It does carry CommonMark because resolved section locations are part of the requested API;
raw extraction does not invoke that parser. This is a deliberate modest shared dependency,
not a claim that every code path is a separate assembly. A fourth “abstractions” or optional
selector package is unnecessary for the initial scope. Bundling Reviews into Core would
couple both audiences to unrelated features; making Reviews depend on writer-heavy Core
would not solve the reverse dependency cost. Duplicating ZIP/canonical/address code would
create divergent format behavior.

Refactor existing `Engine/Container/ZipContainer.cs` into Reader-side bounded reading and
Core-side writing. Move reusable parts of `Format/CanonicalJson.cs`, `Sources/CaseFold.cs`,
`Addressing/Inventory.cs` and ledger validation to Reader, preserving Unicode license notices.
Inventory currently exposes entity hashes/locators but not a complete public source-scope
resolver; add canonical source ranges and resolution behavior rather than claiming a class
move implements §6.5. Split writer-side ledger evolution from reader-side interpretation.
Remove existing Engine findings' dependency on CLI `Reporting.DiagnosticCatalog`; share
format diagnostic definitions below CLI, with Reviews-specific codes in Reviews.

Deep Git verification is an optional injected capability for a Reviews consumer, supplied
by an adapter in Core or by a separately trusted backend validation service. Reader/Reviews
must not start `git` implicitly. The result reports which checks actually ran. If the caller
requires full verification and has no provider, fail with `VerificationUnavailable`; never
silently reduce the assurance level. This avoids imposing native Git on feedback-only jobs
while leaving a path to verify bundled parent/tree and current-view/Git consistency.

## 5. Extraction and location API

Proposed signatures and type names, not compiled code:

```csharp
Task<ReviewExtractionResult> ExtractAsync(
    Stream returnedPackage, ReviewReadOptions options,
    CancellationToken cancellationToken = default);

Task<ReviewResolutionResult> ResolveAsync(
    ReviewExtractionResult review, ReviewedPackageContext context,
    CancellationToken cancellationToken = default);
```

`ReviewedPackageContext` supplies backend-owned package data, not a path/URL to fetch from
the return. It may contain the exact reviewed snapshot, a selected newer target and an
optional history/verification provider. Expose convenience orchestration later; two phases
make “feedback readable without original” and “anchor verified against these bytes” explicit.
Accept readable streams; spool non-seekable input to a bounded private temporary file and
delete it on completion/cancellation. Leave caller streams open; document that positions
advance. Returned results own their data and do not depend on a disposed archive handle.

`ReviewExtractionResult` contains package identity and shape, `ReviewedIdentity`, optional
corroboration/dispatch values, document/profile versions, ordered thread records, a flat
`Items` projection and diagnostics. Include separate `ContainerStatus`, `SchemaStatus` and
`VerificationLevel` (structural / full) rather than one misleading `IsValid` flag. `NotReview`,
`UnsupportedVersionOrProfile`, `Malformed`, `ResourceLimitExceeded` and
`VerificationUnavailable` are distinct outcomes. A conforming empty review returns success
and zero items if the agreed schema permits it. No review declaration returns `NotReview`,
not success with zero feedback.

| Flat `ReviewItem` field | Meaning |
| --- | --- |
| Review identity, thread ID, comment ID | Stable provenance/deduplication keys. Store package commit/digest as revision evidence; never deduplicate by body or timestamp alone. |
| Thread index, comment index, `InReplyTo` | Preserve source order and flat reply links. One row per comment, including replies, resolved and obsolete threads by default. |
| `Kind`, `KindSource`, `Body`, `Author`, `At` | Authored content and declared intent; v1 intent unspecified. Keep timestamp offset/original text and author claim. No claim of authenticated authorship. |
| `ThreadState` | Open/resolved/obsolete as authored, independent of resolution outcome. |
| `ReviewedAnchor` | Reviewed namespace/current, origin root, expect, typed original locator, raw locator and stored selector/quote/context. |
| `DeclaredDocumentPath`, `DeclaredHeadingTrail` | Decoded from `loc`, available even for a standalone delta. Label as declared, not resolved. |
| `ResolvedLocation` | Nullable target namespace/current, verified path, exact heading trail/scope kind and optional canonical-source range. Range units/profile explicitly included. |
| `IdentityStatus`, `TargetStatus`, `Reason` | Separate §6.6 identity verdict from §6.8 selector outcome; preserve unconfirmed, invalidated and detached feedback. Include capability statuses such as target unavailable/history required separately from format verdicts. |
| `CurrentDigest`, successor navigation | Evidence when available. Successors are navigation choices, never silently reassigned request targets. |

Resolve once per thread, flatten the result onto its comments. Do not sort comments by
`at`, discard replies, hide resolved threads or drop detached requests unless the caller
explicitly filters the returned list. Conflicting repeated IDs across returned revisions
must not be silently last-write-wins: the backend can store `(review namespace, thread ID,
comment ID)` plus revision provenance and decide how to reconcile updates. Cross-review
discussion/merge is outside this reader's scope.

A backend can hand an AI a structured record such as:

```text
kind: change-request; threadState: open
document: guide.md; sectionTrail: # Guide[0] / ## Usage[0]
locationBasis: verified against <target current>
identity: survives; target: target-intact
quotedText: produce a package
body: Explain which command creates the package.
```

With no target supplied, output `locationBasis: declared; resolution: target-unavailable`
and preserve the same quote/body. Do not fabricate a line number or heading title. Text
rendering for AI is a convenience over the typed DTOs; no model SDK or network calls belong
in the library. Feedback and author/dispatch strings are untrusted content, not instructions
or authenticated routing authority; downstream applications decide whether to propose or
apply edits, never this extractor.

## 6. Correlation, resolution and validation pipeline

1. Enforce stream/package limits, inspect typing and authoritative directory, reject unsafe
   or ambiguous paths/extents, and validate supported manifest/schema values. Decompress
   the manifest and declared comments entry with size and CRC checks; never extract all
   archive paths into the backend's filesystem just to obtain one JSON document.
2. Check shape/namespace relation and review-document profiles/schema, JSON uniqueness,
   IDs/replies, selector integer/range shape and body fields. Without original source,
   bounds against scope length and quote equality are unverified, not passed. Without an
   original manifest, profile support is checkable but agreement with that original is not.
3. Return all structurally accepted feedback with explicit verification scope. Default
   extraction is bounded structural parsing, not a claim of full package conformance.
   Full mode additionally validates all payload requirements, Git/current-view agreement
   and shape lineage obligations via the verification provider. Bundled packages must
   not be treated as authoritative originals until their parent/review-only-tree restriction
   is verified. Delta's review-only one-commit claim also needs Git evidence in full mode.
4. Backend matches `review.of.namespace` plus `review.of.current` to its authorized stored
   dispatch/snapshot. Compare optional file hash/length as corroboration; report repacking
   differences without substituting file hashes for identity. An opaque echoed dispatch
   value is only a lookup hint within the backend's authenticated tenant/job context.
5. For exact-snapshot resolution, require both identity values to match. For a newer target,
   require the same namespace and explicitly identify the selected target commit; resolve
   the historical reviewed identity as context, never pretend the newer commit is an exact
   match. If the original snapshot or coverage evidence is unavailable, preserve feedback
   and return the appropriate unconfirmed/capability result. Do not fetch anything from
   user-authored metadata. Complete coverage and an authoritative ledger allow current-view
   resolution without walking a Git pack; partial coverage needs proven relevant ranges.
6. Apply §6.5 root/ledger resolution using the **reviewed** namespace. The ledger's unknown,
   retirement and missing-override states govern identity; quote search cannot establish it.
   Honor the reviewed commit when checking coverage; the present JS implementation's
   conservative partial-coverage result is a safe fallback, not a completed history resolver.
7. On `survives`, use stored offsets only after checking bounds and exact quote (malicious
   producers may violate the emission requirement). On a live `flagged-changed` scope,
   search only that canonical scope: unique quote or strict context winner relocates;
   absent/tied matches detach. For dead split/merge/deletion records, preserve successors
   as navigation and do not run selector search over them. Unconfirmed/invalidated identity
   never triggers detached-quote searches elsewhere. Keep thread workflow state unchanged.

Initially, resolve against a supplied current-view target and return `HistoryRequired`
where retained historical evidence is needed. Extraction of bundled feedback is supported
even if deep verification cannot run; a caller requiring full verification receives an
explicit failure instead. Automatic historical target materialization and touched queries
are later scope; they are unnecessary to extract the author's actual feedback.

**Backend resource policy:** proposed configurable defaults are 128 MiB total input/spool,
16 MiB central directory, 1 MiB manifest, 8 MiB decoded comments, 10,000 entries, 5,000
threads, 20,000 comments, 64 KiB UTF-8 bytes per body and JSON depth 32. Bound compressed
and expanded selected payloads before allocation and count actual decoded bytes. Resolution
defaults to 16 MiB per document and 128 MiB aggregate decoded bytes. These are service limits,
not format limits; report rejection instead of truncating feedback. Full verification needs
its own bounded aggregate work/temp-disk/Git limits. Cancellation must reach decompression,
JSON work, target reading and any provider. Finalize defaults with fixture measurements in
implementation, not by copying the CLI's `Int32.MaxValue` per-entry buffering policy.

## 7. Implementation slices, evidence and dependencies

| Slice | Deliverable | Acceptance gate |
| --- | --- | --- |
| R0: reconcile contract | Spec/schema fixtures for v1, proposed v2 kind, offset convention, reply/ID rules, detail-path scope and delta history policy. Refresh CARD-0033 extraction map for CARD-0035. | Full valid/invalid JSON examples and cross-language Unicode fixtures; unresolved conventions reported explicitly, no guessed offsets. |
| R1: shared reading boundary | Extract/refactor Reader and bounded member access; split writing/CLI dependencies; preserve current producer behavior. | Creation/validation regression suite remains green; package dependency graph contains no CLI/native Git in Reader or Reviews. |
| R2: feedback extraction | Reviews package, typed schema parser, structural verification, delta/bundled discrimination, flat DTO projection and provenance. | Reads canonical probe-derived fixtures without original documents; returns all bodies/order/replies/states; rejects malformed/oversized input and exposes unsupported versions. |
| R3: location resolution | Source-scope resolver, coverage/ledger integration and strict selector algorithm; optional verification provider contract. | Independent root/digest fixtures plus unchanged, moved, changed, dead, detached and unavailable-target cases; never guesses a location. |
| R4: backend acceptance/docs | External .NET consumer example using only Reviews PackageReference; local package restore; documented verification modes and resource policy. | Fresh application extracts and optionally resolves fixtures without CLI/native Git for structural/current-view paths; full-required fails clearly when provider is missing. |
| Separate web card | CARD-0018 selection mapping, comment/thread authoring, explicit kind UI after v2 agreement, state/replies, delta writer, self-validation, export/share fallback and review display. | Actual app-generated return passes backend extraction/resolution, independent ZIP/Git validation and original-byte preservation checks. No claim of a real person-to-backend round trip before this exists. |

Do not hold parser development for the UI: use regenerated spec-conforming probe fixtures.
Do not treat old successful measurements as current fixture validation. Existing browser
and Python probes can disagree on canonical details, IDs and offset units. Freeze reviewed
fixture bytes, producer revision and expected parsed DTOs; use independent Git/ZIP tools as
the full-validation oracle. When the app ships its writer, add its actual exports as fixtures.

Focused tests belong in `Mdpkg.Reader.Tests` and `Mdpkg.Reviews.Tests`; retain CLI tests for
command behavior. Include these failure-sensitive cases:

- Valid v1 delta with no original; v2 comment/request/reply mix; empty review versus ordinary
  package; resolved/obsolete threads preserved; unknown version/profile/kind rejected.
- Multiple threads on one root and identical selectors; ordered replies with skewed timestamps;
  duplicate IDs/JSON keys, dangling/cross-thread/cyclic replies and invalid locator encoding.
- Exact reviewed pair, same commit repacked, wrong namespace, wrong snapshot, replayed dispatch,
  later target and missing original; optional corroboration never overrides identity.
- Surviving quote, unchanged digest with false quote/offset, context winner, tie, missing quote,
  live ledger move, dead split and reserved-slot birth; no global/successor quote search.
- Non-BMP Unicode before/inside selectors, combining characters, BOM, CRLF/lone CR, top-level
  ATX/Setext, duplicate heading occurrence and nested scopes. Match independent profile vectors.
- Missing detail, reserved/colliding paths, truncated/overlapping ZIP extents, CRC/DEFLATE errors,
  oversized JSON, expansion/aggregate limits, non-seekable input and cancellation/temp cleanup.
- Forged bundled parent or non-review document/ledger edit: structural status must not claim
  deep verification; full-required must reject. Delta wrong namespace/multi-commit lineage
  similarly cannot receive full verified status.
- Two consumers restore independently: Core does not restore Reviews; Reviews does not restore
  Core/System.CommandLine. Use package artifacts rather than project references for this check.

## 8. Documentation updates and handoff

During implementation update `docs/spec.md` §§4/6.8 only for the agreed narrow schema/profile
clarifications; preserve review identity and separate-return semantics. Add a review schema
and fixture documentation, a packed `Mdpkg.Reviews` README with compilable extraction and
resolution examples, and Reader/Core package-boundary documentation. Refresh the sibling
CARD-0033 plan and solution README for actual engine ownership and package dependencies.
Update `src/web-viewer/README.md` and the CARD-0018 plan only as authoring/export capabilities
land. No new CLI verb is required for the programmatic task; an optional future command
would be a thin adapter, separately scoped. Publish packages through the sibling release
scheme rather than introducing another credential/publishing flow here.

The plan is complete under these defaults: existing separate delta returns first, read both
declared shapes with explicit assurance levels, separate Reviews over a shared Reader,
legacy v1 intent unspecified, proposed v2 authored request kind, and optional target
resolution that preserves unresolved feedback. Owner/spec review should accept or amend
the package-boundary refinement and schema proposals before implementation. No decision
was required to finish this planning artifact.

The missing web authoring/export slices block the complete user workflow, not the parser
plan. Offset/schema clarifications gate verified cross-language selectors and v2 emission;
full Git verification gates trusting bundled lineage claims. No implementation, builds,
tests, account configuration or publishing were performed for this documentation-only card.
