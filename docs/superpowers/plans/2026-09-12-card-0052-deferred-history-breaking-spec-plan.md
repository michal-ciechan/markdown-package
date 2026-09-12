# CARD-0052: breaking revision for deferred-history snapshots

Date: 2026-09-12. Design and implementation plan against `732f6da`.
Source: the full CARD-0052 description, card
`f3a69318-6867-423e-88c2-46b5975a18b9`, updated 2026-09-12 10:56:39 UTC,
and the complete [CARD-0051 investigation](../../investigations/2026-09-12-card-0051-deferred-history.md).
The text below is a proposal for the next spec-editing stage. It does not change
[docs/spec.md](../../spec.md), implementation code, existing fixtures or saved work.

## Decision and scope

**Revise the current `markdown-package/1` draft directly. It will have one schema
with two current-state kinds: `snapshot` with no Git entries, and `commit` with a
real curated repository.** Ordinary `pack` and independent delta-review exports
default to history-free snapshots. Existing internal writers and readers change
together; the old string-valued manifest is no longer a valid instance of this
draft. The first 79 typing bytes, extension and URI grammar remain unchanged.

This implements the user's decision to remove package-version coexistence. It
does not depend on CARD-0050 activation or another decision about whether the
size savings justify changing the format. CARD-0050's Git writer remains useful
for committed output; its native-versus-managed rollout is separate.

The substantive model from CARD-0051 remains: a state hash covers exact current
files and semantic declarations; an immutable first snapshot can later become
a deterministic bootstrap commit; a verified origin record connects these two
different identities. That record is part of normal operation within this one
schema, not an adapter for an obsolete package version.

The following defaults are resolved here for review, not left as build-time
choices: retain the `/1` token; one initial history-free state per lineage;
SHA-256 state hash, SHA-1 Git objects; fixed bootstrap bytes; `root: materialized`;
one optional origin record; mode-specific full verification; fresh namespaces
for distinct independent delta-review exports; no implicit origin verification
on ordinary current-reference reads.

## 1. Concrete revision instructions for spec.md

Sections 1.1–1.9 below supply normative replacement/addition text. Keep the
existing container, source-digest, anchor, selector, ledger and Git-format rules
except where an explicit replacement below changes their scope or wording.
The final editing stage must also apply the consistency table in section 2;
adding these clauses while leaving contradictory unconditional claims elsewhere
would not complete the revision.

### 1.1 Header, terminology and typing: §§2, 3.1 and 3.7

Keep the title's `version 1`. Replace the status with “consolidated specification,
draft 2, breaking pre-release revision, 2026-09-12”, and describe implementation
status separately until all slices have shipped. Add:

> `markdown-package/1` is the only package wire token in this draft. Both
> current-state kinds use it. Its earlier pre-release string-valued `current`
> shape is superseded; no alternative manifest interpretation is defined.
> The 79-byte check establishes container typing, not manifest-schema validity.
> Conforming and recoverable openers MUST validate the same revised schema.

Replace or add these §2 definitions:

| Term | Replacement definition |
| --- | --- |
| Current view | The regular-file ZIP entries containing the immutable captured content, including a declared address ledger and review document. In Git mode they MUST equal the complete working tree of `current.id`; in snapshot mode they MUST hash to `current.id` under §4.1. |
| Current state | Exactly `{id, kind}`. `kind: snapshot` names a snapshot state digest; `kind: commit` names a retained Git commit. A state digest is not a Git object ID. |
| Package identity | The triple `(namespace, current.kind, current.id)`, compared by exact string values. The namespace alone and the ID alone are insufficient. |
| History-free snapshot | The first published state of a newly established lineage, with `current.kind: snapshot` and `history.mode: none`. It has no repository, commit metadata or retained transition history. |
| Publication | Handing an immutable package state to another consumer, including another application or a review recipient. Private editing and saving a draft do not constitute new published checkpoints. Re-emitting identical state is not a successor. |
| Container-level entries | The manifest and, only in Git mode, the history descriptor and declared summary/binding/patch sidecars. They are not part of the current view. An origin record resides in the history descriptor, not in a tracked file. |
| Curated repository | The existing allowed `.git/` entries. They are REQUIRED in Git mode and FORBIDDEN in snapshot mode. |

Keep all remaining §2 definitions. Clarify “qualified object ID” means a Git ID
wherever that term occurs in graph endpoints or URI grammar. Snapshot IDs are
separately qualified `sha256-` state digests, even though the prefix resembles
the reserved future Git object-format syntax.

Do not change either typing magic string in §§3.1/3.7 or the 29-byte width at
offset 50. A string-valued `current`, missing discriminator, null identity or
mixed mode is a schema error after typing, not a recoverable older format.

### 1.2 Conditional container and extraction: §§3.2, 3.6 and 3.8

Replace the §3.2 order diagram with:

```text
.mdpkg/manifest.json                         first, stored
<all current-view files>                     recommended bytewise path order
[Git mode only: history descriptor and declared history sidecars]
[Git mode only: curated .git entries, index before pack, pack last]
central directory
EOCD
```

Replace the three normative order rules with:

1. The manifest MUST be the first entry at offset 0.
2. In Git mode the pack MUST be the last entry; every entry needed for current
   document/section resolution MUST precede it.
3. Snapshot mode has no pack or history entries; it has no corresponding last
   data-entry rule. Readers use the central directory in either mode and MUST
   NOT assume current files are in sorted order.

In §3.6 replace the opening sentence with:

> A current file's canonical path is its exact validated UTF-8 ZIP entry name.
> Git mode records those same path bytes in the tip tree. Snapshot hashing and
> later materialization MUST NOT apply Unicode normalization or case conversion
> to path bytes. NFC-plus-simple-case-fold remains the collision check, not a
> path-rewriting rule.

Retain all existing UTF-8, LF, collision, mode, path and reserved-prefix rules.
Replace the explanation of the reserved address/review exceptions with:

> The declared `.mdpkg/address/overrides.json` and
> `.mdpkg/review/comments.json` are current-view files. Their bytes contribute
> to snapshot identity in snapshot mode and are tracked at every applicable
> commit in Git mode. This gives their edits state identity in both modes and
> prevents undeclared sidecar edits from escaping identity. No other current
> file under `.mdpkg/` or `.git/` is admitted by this revision.

The review detail path is fixed to the already supported
`.mdpkg/review/comments.json`; an alternative path requires a later spec change.
Producers omit explicit directory records. A recoverable archive's valid empty
directory records contribute no current-file record or identity; existing path
validation still applies. `.git/` directory records are also forbidden in
snapshot mode. Nonempty directory records and file/directory path conflicts
are invalid. Directory records cannot conceal a regular file from hashing.

Rename §3.8 “Extraction and optional Git working tree”. Replace its first
paragraph with:

> Extraction in either mode writes the exact stored current-file bytes.
> Snapshot mode produces ordinary files with no repository; Git commands are
> unavailable until an explicit materialization operation has emitted a Git-mode
> package. In Git mode, the package ships no index, and `git read-tree HEAD`
> after extraction recreates it without changing current files. The existing
> `fsck`, `HEAD`, container-sidecar and host checkout guarantees apply only in
> Git mode, with `HEAD` resolving to `current.id`.

Keep D-17/D-18a's UTF-8/LF and byte-exact unpack requirements for both modes.
Qualify the Git-specific paragraphs and measurements in §3.8 with “in Git mode”.
Do not create a repository merely because a reader browses or extracts files.

### 1.3 Manifest schema: replace affected §4 fields and validation rules

This is the exact field-level change, not an instruction to edit the file now:

```diff
 "mdpkg":"markdown-package/1"
-"current":"sha1-<commit>"
-"history":{"coverage":"complete","detail":".mdpkg/history.json","transform":[]}
+"current":{"id":"sha256-<state digest>","kind":"snapshot"}
+"history":{"mode":"none"}
```

For a Git-mode package the corresponding replacement is:

```diff
-"current":"sha1-<commit>"
-"history":{"coverage":"complete","detail":".mdpkg/history.json","transform":[]}
+"current":{"id":"sha1-<commit>","kind":"commit"}
+"history":{"coverage":"complete","detail":".mdpkg/history.json","mode":"git","transform":[]}
```

Angle-bracket values in these two diffs are schematic. This complete canonical
manifest is the concrete snapshot vector for `guide.md` containing the eight
bytes `# Guide` followed by LF. Every canonical block includes one trailing LF:

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":null},"current":{"id":"sha256-69b43819687cc0ec576965b514d5d336544966aadddec1310b4b7f242fb3adb4","kind":"snapshot"},"history":{"mode":"none"},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

Its materialized manifest is:

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":null},"current":{"id":"sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9","kind":"commit"},"history":{"coverage":"complete","detail":".mdpkg/history.json","mode":"git","transform":[]},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

The manifest has exactly the required keys `mdpkg`, `addressing`, `current`,
`history`, `namespace`, and optional `review`. No other manifest fields are
admitted. Keep the existing canonical serialization, manifest-first exception
and O(1) admission rule. The nested rules are:

| Field | Exact rule |
| --- | --- |
| `current` | Required object with exactly `id` and `kind`. Neither is nullable. |
| `current.kind` | Exactly `snapshot` or `commit`. |
| Snapshot `current.id` | `sha256-` plus exactly 64 lowercase hex characters, verified by §4.1. |
| Commit `current.id` | `sha1-` plus exactly 40 lowercase hex characters, naming an actual retained commit. SHA-256 Git repositories remain outside this revision. |
| `history`, snapshot | Exactly `{"mode":"none"}`. No `coverage`, `detail`, `transform` or origin fields, even as null/empty values. |
| `history`, commit | Exactly `coverage`, `detail`, `mode`, `transform`; `mode` is `git`; the other values retain §4's existing definitions and `.mdpkg/history.json` detail path. |
| `addressing` | Exactly the existing four required fields. `overrides` is explicitly null or the fixed ledger path. Snapshot coverage is always `complete`; Git coverage remains `complete` or `partial`. |
| `review` | Exactly `detail`, `of`, `shape`, when present. `detail` is the fixed review-document path. `shape` is `delta` or `bundled`. |
| `review.of` | Required `namespace` and typed `current` with the same state-ID rules; optional `packageDigest`, `packageBytes`, `dispatch` retain their existing evidence-only meanings. No other keys. |

Replace the identity portion of a review declaration as follows, independently
of the review package's own current-state kind:

```diff
-"of":{"current":"sha1-<reviewed commit>","namespace":"<reviewed namespace>"}
+"of":{"current":{"id":"sha256-<reviewed state digest>","kind":"snapshot"},"namespace":"<reviewed namespace>"}
```

A committed target instead uses `kind: commit` and its qualified commit ID.
The triple comparison always includes the kind. `review.of.current` is never
changed merely because the reviewed snapshot has been materialized. Optional
digest/length mismatches remain re-emission evidence, not identity mismatch;
dispatch is not interpreted or followed as a path/URL.

A validator MUST reject a mode/current mismatch, missing or extra control
entries, a forbidden history field, an invalid discriminator, or a manifest
whose declared ledger/review presence disagrees with the current view. The
existing path, LF, CRC, canonical JSON and review-shape checks remain mandatory.
Snapshot mode MUST reject partial coverage and any ledger `unknown` record.
All checks are against this single schema; no parser may coerce the old string
into a typed commit or infer a missing mode from ZIP contents.

### 1.4 Add §4.1: exact snapshot identity algorithm

The only snapshot hash profile is `mdpkg-snapshot-v1`. It is implied by
`current.kind: snapshot`; there is no extra manifest selector for this profile.
Let `J` be the exact canonical JSON encoding below, as UTF-8 bytes with a single
final LF, using ordinary key ordering rather than the manifest-first exception.

1. Validate the manifest and archive inventory before selecting entries.
   Current files are **all regular-file entries** except the manifest and the
   permitted Git-mode control/repository entries. In snapshot mode these are
   every ordinary file plus the declared ledger/review document; no history or
   Git entry may exist. Include non-Markdown text files, hidden files and the
   complete ledger/review bytes. Do not filter to displayed Markdown documents.
2. Build a semantic header with exactly `addressing`, `namespace`, `review`.
   Copy all four addressing fields, including explicit null `overrides`.
   `review` is explicitly null when absent; otherwise it contains exactly
   `detail`, `of`, `shape`, where `of` contains only `current` and `namespace`.
   Thus the target identity, shape and detail path are bound, while optional
   `packageDigest`, `packageBytes` and `dispatch` are excluded.
3. For each current file build exactly
   `{"bytes":N,"digest":"sha256-H","mode":"100644","path":P}`.
   `P` is its exact validated path; `N` is its decoded byte length; `H` is SHA-256
   of its exact decoded bytes. `N` is a nonnegative integer serialized as shortest
   unsigned decimal, without an exponent, sign or decimal point. No symlink,
   executable-bit, host stat, timestamp or ZIP attribute contributes a mode.
4. Sort the records by the unsigned bytewise lexicographic order of UTF-8 `P`,
   not locale order, Unicode code-unit order or the collision-check key. Arrays
   preserve that order. No directory record is included.
5. Form an object with exactly `entries`, `header`, `profile`. `entries` is the
   ordered record array, `header` is step 2, and `profile` is the literal
   `mdpkg-snapshot-v1`. Hash its canonical bytes `J` with SHA-256. The result is
   `current.id = "sha256-" + lowercaseHex(SHA256(J))`.

Canonical string encoding is pinned to the already implemented rules: escape
quote and backslash, use `\b`, `\f`, `\n`, `\r`, `\t` for those controls,
lowercase `\u00xx` for other U+0000–U+001F, do not escape `/`, and emit all other
valid Unicode scalars literally. Reject unpaired surrogates and duplicate keys.
Sort object keys bytewise by their UTF-8 bytes, use compact separators and append
exactly one LF. No BOM prefixes canonical control JSON. A BOM **inside a current
file** is retained and hashed. Existing current-file UTF-8/LF validation happens
before hashing; a validator MUST NOT normalize malformed stored CRLF into a
different valid state. A producer normalizes once when capturing source bytes.

The profile binds exact stored bytes, including trailing spaces and trailing
blank lines. It is not the scoped source-digest algorithm. The manifest itself,
`current`, ZIP compression/order/headers/comments and transport evidence are not
inputs. There is no circular self-hash. The header binds every admitted semantic
manifest value not implied by snapshot mode; unknown semantic extensions are
rejected until their hash treatment is specified. Unknown extension data already
permitted inside a review document is covered as part of that file's exact bytes.

The record array is computed and may be fed incrementally into the hash; it is
not shipped as a second document index. Producers spool/capture the content once
so files changing on disk cannot make the manifest hash one set of bytes and
the ZIP contain another. Identity is content state, not authentication, prior
publication evidence or a unique send identifier.

The full canonical `guide` preimage is:

```json
{"entries":[{"bytes":8,"digest":"sha256-bc553ffe57e544498b12a9865dbf3abc2004c474e349c52c378eaa402287424b","mode":"100644","path":"guide.md"}],"header":{"addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":null},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8","review":null},"profile":"mdpkg-snapshot-v1"}
```

### 1.5 History eligibility and Git obligations: §§5.1–5.3

Prepend this eligibility contract to §5:

| Circumstance | Required behavior |
| --- | --- |
| First publication of a newly established ordinary lineage | MAY use snapshot mode; a producer MAY choose Git mode immediately. |
| Recompression/reordering or resending exactly the same snapshot state | MAY stay snapshot mode and MUST retain its identity. Evidence-only manifest changes do not make a new state. |
| Private edits before first publication | MAY remain uncommitted; every emitted candidate gets the hash of its own bytes. No historical checkpoint or published-continuity claim is made. |
| First changed published successor in the same namespace | MUST be Git mode. If its predecessor was a snapshot, materialize that exact predecessor as C0 and append the successor C1. A changed semantic header also counts as a changed state. |
| Further updates of a committed lineage | MUST remain Git mode. An edited current tree cannot silently become another initial snapshot in the same namespace. |
| Published historical `at=`, commit, diff or hunk reference | Its Git endpoints MUST exist first. Snapshot digest syntax cannot substitute for an endpoint. Existing patch-retention rules then apply. |
| Bundled review | MUST be Git mode and satisfy the parent/binding rules in section 1.8. |
| Native Git working-tree export, explicit history import, retaining declared prior history, or partial/unconfirmed correspondence | MUST be Git mode. |
| Current viewing, current links/selectors, an endpoint comparison of two supplied trees, or an independent delta review | Does not by itself require materialization. An endpoint comparison supplies no hidden event history. |

Snapshot coverage `complete` means complete correspondence for this one initial
state; it is not a zero-commit graph-coverage declaration. An authoritative
ledger from preparation of that state is allowed, with its targets, retirements
and reserved births validated. A producer MUST NOT use this rule to erase an
already published lineage. A validator checks internal consistency; it cannot
prove from one archive that the producer has never published something else.

A deliberately independent package copied from existing content uses a fresh
namespace and makes no continuity claim. A distinct delta-review export is such
an independent package, not another published state in the previous delta's
namespace. Preserving a review lineage instead requires the ordinary Git update
path. This revision defines no graph of multiple uncommitted published states.

In §§5.1/5.2 scope the entire existing curated-repository contract to Git mode.
Replace the branch rule and object-format sentence with:

> In Git mode exactly one branch, `refs/heads/main`, MUST exist; `HEAD` MUST be
> symbolic to it, and its raw target MUST equal the SHA-1 portion of
> `current.id`. That object MUST be a real commit and its tree MUST equal the
> current view. Exactly one pack and its index are required; an optional reverse
> index and genuine shallow boundaries follow the existing rules. Snapshot mode
> MUST contain none of these entries. Git objects use SHA-1; snapshot state
> hashes use SHA-256. The latter does not enable SHA-256 Git repositories.

§5.3 retains its existing fields and commit-valued endpoints. Change `root` to
`original | synthetic | materialized` and add one optional `origin` object:

| Origin field | Exact rule |
| --- | --- |
| `profile` | Exactly `mdpkg-bootstrap-v1`. |
| `snapshot` | Qualified SHA-256 snapshot state ID. |
| `commit` | Qualified SHA-1 bootstrap commit ID. |
| `header` | Exactly the semantic header from §4.1, including explicit null `review` if absent. Its namespace MUST equal the package namespace. |

`origin` has exactly these four fields. It is REQUIRED if and only if
`root: materialized`; it is not allowed elsewhere. This is a singleton because
the format admits only one initial history-free state per lineage. It belongs
in the unbounded history descriptor, not the manifest. It is distinct from the
existing squash-summary `bindings` and is not a new sidecar or versioned file.

`root: materialized` declares that the oldest retained commit is exactly the
deterministic bootstrap of that initial snapshot. It is parentless, reachable
on the first-parent path from current, and is not a shallow boundary. Fixed
synthetic bootstrap authorship is not truncation: history starts at the declared
initial checkpoint. `root: synthetic` keeps its existing meaning of lost prior
history and requires truncated coverage.

The exact first commit-message line `mdpkg-bootstrap-v1` is reserved for this
protocol. A retained commit carrying that marker MUST be the oldest parentless
root and have `root: materialized` plus its valid origin record. Full validation
therefore detects deleting origin and merely relabeling C0 as an original or
synthetic root. Ordinary commit metadata must not use this reserved first line.

For initial materialization without edits, `sourceBase = sourceTip = C0`,
`retainedCommits = 1`, empty transformations/ranges/patches/shallow boundaries,
and one complete addressing range C0→C0. For a complete untransformed C0→C1
update, `sourceBase = C0`, `sourceTip = C1`, `retainedCommits = 2` and the range
is C0→C1. History coverage describes retained published checkpoints only.
Imports, projections and later transforms keep their existing source-endpoint
semantics; these values are not globally overwritten with current.

### 1.6 Add §5.6: deterministic materialization and origin verification

Let S0 have identity `(N, snapshot, H0)`. To materialize it:

1. Obtain S0's exact current-file bytes and semantic header. Validate all files,
   ledger and declarations, and recompute H0 before creating any relationship.
   A hash or an endpoint diff alone cannot reconstruct S0. Capture it immutably
   for the operation; do not rewrite the input archive in place.
2. Construct the ordinary SHA-1 Git tree T0 over all and only S0's current files,
   including declared ledger/review content, using exact paths, bytes and
   regular-file mode `100644`. Directories use ordinary Git tree mode `40000`;
   omit empty directories. No manifest, history file or origin record is tracked.
3. Construct C0 with exactly the UTF-8/LF payload below. Substitute T0's raw
   lowercase 40-hex ID, the lowercase namespace N and qualified H0. There is
   exactly one final LF; no parent, encoding, signature or other header is
   allowed. The author/committer fields and epoch are literal service metadata,
   not the time or identity of the original author.

```text
tree <T0>
author mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000
committer mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000

mdpkg-bootstrap-v1
namespace <N>
snapshot <H0>
```

4. Compute the normal Git SHA-1 commit ID from `commit`, an ASCII space, the
   decimal payload byte length, NUL and that payload. Emit the curated pack/index
   and a Git-mode manifest, with the origin record naming H0 and C0. When there
   is no edit, current is C0 and all semantic manifest declarations are retained.
   No artificial child is needed.
5. To publish a changed successor, derive S1 and its ledger from S0 with the
   existing producer-confirmation rules. Keep all exceptional origin roots,
   flatten confirmed moves, retain retirements, mint reserved births and mark
   unresolved correspondence partial. Create an ordinary C1 with parent C0 and
   the actual successor's commit metadata. C1 does not use bootstrap metadata.
   Its current view and manifest declarations describe S1; origin.header stays
   frozen at S0. An unchanged file tree with changed semantic declarations still
   needs a successor state/commit; do not rewrite C0's origin header.
6. Verify the complete result before atomic publication. On cancellation,
   resource exhaustion, bad source or failed verification, publish nothing and
   preserve an existing output file. The stream API keeps its documented partial
   output-copy limitation after private validation.

Tree/object creation is ordinary Git semantics; [Git's commit construction
documentation](https://git-scm.com/docs/git-commit-tree) supports explicit tree
and parent inputs. The fixed bootstrap encoding above is this proposal's
additional deterministic policy, not Git's default metadata. Pack representation
may vary under [Git's pack format](https://git-scm.com/docs/gitformat-pack) without
changing these object IDs.

A full validator of an origin MUST:

1. Validate the origin field set, profiles, namespace and header as a valid
   snapshot semantic header, including complete addressing and delta-only review.
2. Find origin.commit as the oldest retained first-parent commit; require no
   parents or shallow boundary, and verify its object and complete tree/blobs.
3. Reconstruct §4.1's entry records from **that commit's tree**, not the current
   ZIP view if current is C1 or later. Recompute H0 using origin.header and
   require equality with origin.snapshot.
4. Rebuild the exact bootstrap payload from that tree ID, N and H0, and require
   byte-for-byte equality with the retained commit. Checking only a declared
   H0→C0 mapping, equal tree IDs or a commit-message substring is insufficient.
5. Validate the original ledger/review files and reserved-path rules under the
   stored header. Verify ordinary current-tree and declared history obligations
   independently for the package's current state.

Only successful verification produces a usable origin relationship. It does not
make `(N, snapshot, H0)` equal to `(N, commit, C0)` as identity keys. It permits
retrieval of the exact reviewed **state** and translation of its checkpoint to
C0. Optional transport evidence and original ZIP encoding are not reconstructed;
a resolver must not claim possession of the exact old archive bytes on that basis.

Backend proof results carry the verified namespace, H0, C0, semantic header and
selected target commit/validation context. Consumers must not accept a raw alias
dictionary or reuse an assurance result on a different unverified archive solely
because its declared namespace/current strings match.

Later updates retain origin unchanged while C0 remains the oldest retained root.
Squashes excluding C0 can retain it and follow existing summary rules. A
transform that removes or rewrites C0 MUST remove origin; it cannot retain an
unverifiable alias. In that existing lineage the result declares a synthetic
root and truncated coverage, plus the relevant transformation metadata, or is
explicitly emitted as a fresh namespace. An exact original snapshot retained
elsewhere may still be read, but the removed origin is not a verified checkpoint
in the new package. Missing originals/bindings yield unavailable or unknown,
never invented continuity. Endpoint equality cannot recover edit/revert or
delete/recreate events; summaries must be made before discarding transitions.

A rewritten root that no longer qualifies as C0 uses ordinary transformation
metadata/message and MUST NOT retain the reserved bootstrap first message line.
It may retain the old message as quoted provenance below a different first line;
that text supplies no origin authority.

Two materializers of the same S0 produce the same C0. Independent branches may
share C0 but have different children. This adds no merge policy and no promise
to recover unpublished editor keystrokes or original authorship dates.

### 1.7 Addressing and history availability: §§6.3–6.7

Keep the §6.1 digest and §6.2 root/locator algorithms byte-for-byte unchanged.
In §6.3 replace unconditional statements that the ledger is “tracked” with:

> The ledger is an identity-bearing current-view file in both modes. Its exact
> bytes are hashed into a snapshot state; in Git mode it is also tracked and
> survives a squash as an ordinary tree copy. Confirmation belongs to the
> producer, not to the availability of Git objects or a similarity heuristic.

Replace the coverage explanation at the end of §6.3 with:

> Complete initial snapshot coverage and Git transition coverage follow §5.
> Unconfirmed transitions use Git mode, `addressing.coverage: partial` and
> covered ranges in the history descriptor. A consumer MUST NOT treat missing
> history as evidence of complete correspondence for a claimed prior lineage.

Keep §6.4's `/v2/` URI grammar and all reference profile strings. Replace its
`at` and external `observedAt` rules with:

> Without `at`, a document/section reference selects the current view regardless
> of current-state kind. With `at`, it selects exactly the named Git commit.
> `at`, commit, diff and hunk endpoints MUST NOT contain snapshot state IDs.
> In snapshot mode these history-dependent references return
> `invalidated / history-unavailable`; readers must not substitute current.
> An implementation lacking a history reader for a Git-mode package reports a
> capability failure (`history-reader-required`), not a malformed identity.
>
> External `observedAt`, when supplied, is a typed current-state object.
> `review.of.current` supplies it for all threads. It is checkpoint evidence,
> never part of the URI key. Snapshot observedAt can be translated to C0 only
> through a verified origin matching the exact namespace and snapshot ID.

For §6.5 step 1, retain profile/namespace rejection and add this ordered gate
before the existing ledger/digest steps:

1. When observedAt is supplied, validate its typed shape. If it equals the
   selected current state, no cross-checkpoint mapping is needed.
2. If observedAt is a different snapshot identity, a snapshot-mode target cannot
   establish that earlier checkpoint. Return `unconfirmed /
   history-unavailable`. For a Git target require the matching verified origin;
   otherwise return `unconfirmed / origin-unverified` (or
   `origin-unavailable` when no binding is present). The proof may be supplied
   by a backend; the current read does not implicitly decode the pack.
3. If the target is snapshot mode and observedAt names a commit, it likewise
   cannot establish continuity; return `unconfirmed / history-unavailable`.
4. For partial Git coverage, absence of observedAt, unavailable membership or
   an uncovered interval yields `unconfirmed / incomplete-correspondence`.
   Translate a verified snapshot checkpoint to C0 before checking ranges.
5. Otherwise apply the existing ledger-first and scoped-digest steps unchanged.
   A loose at-less reference with no observedAt remains supported; in complete
   coverage it needs no origin lookup. It proves current entity/source state,
   not a historical assertion about when a prior package was published.

For exact `at` reads, use the named retained commit and its ledger/document;
never follow an origin or squash binding to a different commit. Materialization
does not add snapshot-pinned URI syntax.

In §6.6 add a “materialize initial snapshot” column: at-less current references
retain their roots/locators/expect values and resolve the same source at C0;
snapshot-valued review correlation uses the verified origin; Git references
can first be minted after their endpoints exist. Retain the four identity
statuses and selector outcomes. Capability/assurance reasons refine results;
they do not grant a successful review badge.

Add to §6.7:

> In snapshot mode the touched-since query returns `unknown`: there is no retained
> transition evidence. Materialization alone does not create it retrospectively.
> In Git mode a verified snapshot origin supplies checkpoint C0, after which
> the existing summary/ordinal/coverage rules apply. If membership, summaries
> or coverage are missing, the answer remains unknown. Endpoint comparison and
> current source equality are not proofs of no intervening changes.

### 1.8 Reviews and full verification: §§4, 6.8, 7.1–7.2

Replace the review-shape obligations with:

| Shape | Normative requirement |
| --- | --- |
| Delta | Its namespace differs from `review.of.namespace`. It may be history-free as an independent initial state, or Git mode if its producer chooses/retains history. Its current view is exactly the declared review document, with null address overrides and no reviewed original. |
| Bundled targeting commit | It is Git mode in the reviewed namespace. Its current commit has exactly one parent equal to `review.of.current.id`. The child changes only paths under `.mdpkg/review/`. |
| Bundled targeting snapshot | It is Git mode in the reviewed namespace. The verified origin.snapshot equals the typed reviewed snapshot ID; its current commit has exactly one parent equal to origin.commit C0. The child changes only paths under `.mdpkg/review/`. |

Bundled validation checks the complete parent/child tree diff, including ledger
and document files, and the parent/binding rules. The snapshot target's manifest
declaration stays snapshot-valued. Merely copying documents alongside review JSON
is not a valid bundled review. A reviewer receives no authority to confirm a
document move, edit or ledger change from either shape.

Revise §6.8's “Where the anchors live”, “Shapes”, comment-order rationale and
final paragraph to say: the review is still a second package; changing review
content changes its state identity; history exists only in Git mode; array order
remains authoritative in both modes. Do not claim a history-free review records
the order of discarded drafts. Exact UTF-8/LF source equality under the current
state identity, rather than an unconditional Git tree, is the offset guarantee.

The review-comment document versions 1/2, authored kinds, root/digest/selector
profiles, thread UUIDs, quote relocation, reply validation and user-facing intent
remain unchanged. Their versions are independent of the package schema. This
card adds no package compatibility reader or migration path; the already defined
comment-document contracts are a separate matter and need no rewrite here.

Exact review context requires either the supplied original state with a matching
typed identity or a reconstruction from a verified origin and C0. Resolving onto
a different current target still requires explicit newer-target selection. A
materialized C0 is a different target key even if its files equal S0; a verified
bridge establishes correspondence, not permission to silently switch targets.
Preserve every feedback item when context, origin proof or selectors cannot be
verified. Never look up an original via untrusted dispatch metadata.

Close §11.2 item 13 by adding this assurance contract to §7:

> An ordinary selective reader MAY expose a declared identity after structural
> validation and verify payloads as they are read. It MUST distinguish declared
> identity from fully verified identity; a successful current scope/selector
> result does not assert full-package integrity. A full validator MUST check all
> applicable obligations below. Re-ZIP changes do not turn declared identity
> into verified identity. No reader may report nonexistent Git integrity as a
> passed check.

| Obligation | Snapshot | Git |
| --- | --- | --- |
| Container, mode, manifest, every payload, paths, UTF-8/LF, ledger/review rules | Required | Required |
| Snapshot hash over all current files and semantic header | Required | Not applicable to current; required for origin when present |
| Git object/reachability/ref/index integrity and exact current tree equality | Not applicable | Required |
| Bootstrap origin checks | Not applicable | Required iff origin is present |
| Delta namespace or bundled parent/review-only diff rules | Required when review declared; bundled forbidden | Required when review declared |

For Reviews, derive required verification checks from the already parsed
mode/review shape/origin, rather than accepting a provider-supplied list of
requirements or the current unconditional `VerificationChecks.Full` mask.
Add snapshot-identity and origin-verification obligations. `Full` assurance is
accepted only when every applicable check passes; failed, skipped or unavailable
required checks cannot produce it. Nonapplicable Git checks remain explicitly
nonapplicable. Verifying a delta package does not prove the external reviewed
source or its selectors; source-dependent assurance remains separate.

Update §7.2 with these additional/changed rows:

| Operation | Entries read | Git pack required |
| --- | --- | --- |
| Current browse/link/selector in either mode | Manifest, directory, declared ledger and requested document | No |
| Verify whole snapshot identity | All current files plus semantic manifest header | No |
| Translate a snapshot checkpoint using origin | History descriptor and exact C0 tree/commit/blobs, or an already verified backend proof | Yes for initial proof; no implicit read on the ordinary current path |
| Historical Git reference or native Git export | Existing Git-mode read/extraction path | Yes; unavailable in snapshot mode |
| Touched-since | Applicable verified checkpoint context and retained summary/bindings | No extra pack read if that context is already verified; snapshot mode returns unknown |

All read budgets, cancellation and explicit resource failures still apply. A
full hash may stream bytes and sorted entry records; it must not require one
in-memory copy of the entire package. A reader without an origin/history backend
can remain a selective reader with explicit capability results.

### 1.9 Numerical and worked-example changes

CARD-0051's [post-delta byte measurements](../../investigations/deferred-history/size-results-after-deltas.json)
remain historical measurements of the superseded manifest shape. They are not
re-run here and are not new-format performance claims. The source bytes and Git
compression findings remain informative; archive sizes, entry counts and hashes
in active examples must be regenerated after the spec edit.

For §8 retain the explanatory committed-history example and its original commit
IDs where the tracked trees/commit payloads are unchanged. Rewrite both manifests
to typed commit identities and `history.mode: git`, then regenerate ZIP lengths,
offsets, hashes and executable assertions. Add the guide snapshot→C0 example
from [the design vectors](../../investigations/deferred-history/breaking-revision-vectors.json),
and add a changed C1 plus snapshot-targeted delta and bundled review fixtures in
the spec-edit/test-design slice. An old binary archive is not an active fixture
for the revised schema merely because its typing prefix still passes.

## 2. Remaining spec consistency edits

This table is part of the revision, not optional editorial follow-up.

| Location | Required replacement or qualification |
| --- | --- |
| Introductory source table | Historical findings about every package carrying a history descriptor are identified as prior measurements. State that the revised normative mode rules supersede them. |
| §1 C4/current view, C6/coverage, C8/history pointer, C9/store pack, C11/refs | Current view is mode-independent; transition coverage/history pointers/pack/ref obligations apply to Git mode. No pack/data descriptor is invented for snapshot mode. |
| §4 validator statements and O(1) field rationale | Branch/transform checks are conditional; current hash verification is added. Reject undeclared current sidecars in either mode. Add typed review keys and conditional bundled-parent rules from section 1.8. |
| §5.4 summaries and §5.5 patches | Their graph endpoint IDs remain Git commit strings. Before materialization no such sidecars exist; a snapshot checkpoint is translated by verified origin before graph queries. Existing squash bindings do not serve as origin records. |
| §6.5 “never reads the pack” | Scope to current ledger/digest resolution after any required checkpoint proof has been supplied. Origin verification is a separately requested operation. |
| §6.8 historical review-size statements | Label measurements as the earlier always-Git encoding; do not claim their fixed overhead remains mandatory. |
| §7.1 compression/duplication narrative | Git pack and duplicated tip blobs exist only in Git mode. Snapshot full hash is computed, not a stored file-digest index. History sidecars are container-level, not current-view files. |
| §9 rejection of raw package self-hash | Keep rejection of raw ZIP hashing; distinguish the accepted non-self-referential canonical state digest. |
| §9 rejection of namespace-only/random instance GUIDs | Retain; the typed state identity still binds namespace and exact state. |
| §9 “review edits change the tip commit”, untracked ledger/review sidecars | Replace with “change the current-state identity”; hashed snapshot files are not identity-free sidecars. Review content still lives in a separate artifact. |
| §10 D-1/D-3/D-4 | Initial snapshot complete addressing; Git-only transition/transform/detail fields; add materialized-root distinction. |
| §10 D-7/D-8 | Required main ref and optional reverse index are Git-mode decisions; ref equals `current.id`. |
| §10 D-9 | Recommended order covers current-view files in both modes. |
| §10 D-14 | SHA-1 is the Git object format; SHA-256 is the snapshot state hash. SHA-256 Git remains open. |
| §10 D-17/D-18a/D-18b | LF/unpack applies to both modes; Git blob/checkout statements are conditional. |
| §10 D-23 | Review document is in a second package and is identity-bearing in either mode; remove unconditional curated-repository cost. |
| §10 D-24/D-25 | Replace with section 1.8 shape rules and triple correlation. Snapshot state identity distinguishes bytes/declarations, while Git commits additionally distinguish ancestry/commit metadata. |
| §10 new D-27–D-30 | Record typed states/hash, initial-snapshot eligibility, deterministic materialization/origin and mode-specific assurance as explicit adopted decisions. |
| §11.2 item 13 | Closed by the declared/full verification contract above. |
| §11.2 items 1/2/4/9 | SHA-256 Git, a general browser history reader, full upstream DAGs and merge-parent queries remain open; snapshot support does not decide them. |
| Source and fixture references throughout | Replace strings used as package identities with typed states; keep actual commit IDs in trees, refs, source endpoints, patches, summaries and the URI grammar as commit strings. Do not perform a blind global substitution of every `current` or `sha1-` occurrence. |

Other independent open questions stay open. This card does not define binary
current files, signatures, new URI forms, merge policy, automatic rename
authority, arbitrary review merging or unlimited history-free publications.

## 3. What is removed from CARD-0051 and what remains

| CARD-0051 assumption | Resolution here |
| --- | --- |
| New `markdown-package/2` alongside unchanged `/1` | Removed. Rewrite the single `/1` schema, including committed packages. |
| Dual-version dispatch in typing/openers | Removed. Same magic and one schema parser; dispatch is only by current/history mode. |
| Old-reader rejection rollout and compatible defaults | Removed as release requirements. Replace the internal tools and default writer behavior together. Old manifests are ordinary invalid input under the revised draft. |
| Additive versioned public APIs/adapters | Removed. Change current .NET record types and callers directly. No obsolete overloads or conversion layer. |
| V1 downgrade/interchange path | Removed. Explicit materialization emits the same revised schema's Git mode. |
| Preserve old browser session keys and migrate old files/drafts | Removed. Use a fresh development storage database name for this revised app; do not inspect, merge, convert or automatically delete the old database. No migration UI is built. |
| Snapshot→C0 origin bridge | Retained and fully specified: this connects two valid states of the current format during normal use. |
| Typed identity, full snapshot hashing, required-check changes | Retained: these are necessary even with one schema. |
| Preserve snapshots, producer evidence and atomic output | Retained: dropping them loses actual history/feedback, not compatibility with an old format. |
| Default activation of CARD-0050 before considering this change | Removed as a dependency. Preserve that candidate's separate Git-mode rollout status. |

The development storage choice is a new constant such as
`mdpkg-viewer:snapshot-draft2:<base-path>` in `databaseName`, with normal schema
version 1 inside that fresh database. This is a reset of this development app's
storage domain, not a second package version. No database is changed by this
planning task. Within the revised app, keys use the typed state; S0 and C0 remain
different saved packages even when a verified relationship is available.

## 4. Concrete CLI and API behavior for the follow-on build

These are proposed commands/options, not available commands to run today:

| Surface | Result / validation |
| --- | --- |
| `mdpkg pack tree --namespace N --out S0.mdpkg` | Default `--history none`; new initial snapshot, complete addressing, no Git process or repository bytes, full snapshot self-validation before publication. |
| `pack ... --history git` | Eager ordinary Git snapshot; existing author/committer/message policy applies, root original, no origin record unless it is actually materializing an existing S0. Retains CARD-0050's gated/native backend policy. |
| `pack ... --from-git` | Defaults to Git mode; explicit `--history none` is an option error. Import/source selection remains existing behavior. |
| `--scope`, `--depth`, `--reverse-index`, explicitly supplied Git commit metadata/object-format options | Require Git output. Do not implicitly switch an explicitly selected snapshot output or invent ignored commit metadata. Existing scoped snapshot/import behavior is retained when Git mode is chosen. |
| `pack ... --correspondence file` | Allowed in snapshot mode only for authoritative preparation of the initial state; unknown/partial results fail with obligation-unmet and no output. Use explicit Git mode for partial correspondence. |
| `mdpkg update S0.mdpkg --materialize --out C0.mdpkg` | Validate S0, create deterministic C0 and origin. No `--tree`, custom bootstrap message, squash or truncate option combined with this action. On a Git-mode input this explicit action is an identity-preserving re-emission after validation, not another bootstrap commit. |
| `mdpkg update base.mdpkg --tree tree --message text --out next.mdpkg` | If base is snapshot, materialize then append C1; for a supported Git base as bounded below, append to current. Preserve namespace, origins and ledger; use producer correspondence and partial coverage where appropriate. Output always Git mode. |
| `update` without an implemented action, or unsupported `--squash`/`--truncate` combinations | Explicit unsupported/usage result. Do not treat their currently advertised stubs as implemented by this card. General history-transform construction can follow separately; its format rules are preserved. |
| `validate` on snapshot | Recompute full state hash and payload checks without Git. Git checks are not applicable. |
| `validate --deep` on snapshot | Same exhaustive snapshot obligations; succeeds without Git when valid. No dummy fsck success. |
| `validate` / `validate --deep` on Git | Retain the distinction between payload/structural checks and requested full Git proof. Report completed assurance accurately; verify origin on a full/deep request. |

The first append implementation accepts snapshot inputs and untransformed Git
lineages with a complete retained graph: root `original` or `materialized`, no
shallow boundaries, empty transformations/ranges/patches, sourceBase equal to
the oldest retained commit and sourceTip equal to current. Addressing coverage
may be partial; preserve existing covered/uncovered intervals and extend them
with the newly assessed transition. On append, preserve sourceBase, set sourceTip
to the new child and increment retainedCommits. A materialized origin stays
unchanged. Other valid Git packages still open and validate, but `update --tree`
returns an explicit capability failure before writing them. Appending across
import projections, discarded source checkpoints and summary transforms needs
its own source-range policy and is not silently included in S3. Identity-preserving
`--materialize` re-emission of a Git input does not have this append restriction.

Separate source selection from output history mode in the public API. Replace
`PackageIdentity` and manifest `Current` strings with a tagged state record;
replace unconditional history metadata with the mode union. Make commit metadata
optional/forbidden according to mode; do not synthesize and discard it on a
history-free path. Add materialize/update requests with explicit input package,
destination, successor metadata and correspondence. Directory/stream creation,
resource options, cancellation and atomic publication retain their existing
contracts. Results carry typed identity, mode, assurance and whether
materialization occurred; an optional C0 ID belongs in the operation result,
not an extra manifest field.

For an update input tree, `.mdpkg/address/overrides.json` is owned by the
package/update operation: carry the base ledger, apply explicit correspondence
and reserved births. If the source tree supplies the ledger, require byte equality
with the base ledger before processing; reject conflicting edits instead of
silently replacing it. Absent source ledger means carry the base ledger, not
delete it. Source-tree enumeration/normalization and reserved review-authoring
rules otherwise stay as today. Changing comment content is handled by an
explicit review-authoring path, not ordinary document `pack` accepting arbitrary
reserved review files.

## 5. Six implementation slices

These are delivery slices with concrete exits, not estimates of engineer-days.
They remove coexistence work but still touch the same applications. Keep the
development release coherent: do not publish half-updated NuGet/browser/CLI
artifacts as a functioning revised format.

### S1 — Adopt spec clauses and shared conformance data

After this plan is reviewed, edit `docs/spec.md` according to sections 1–2,
update the CLI reference's proposed behavior and regenerate the active worked
examples/review fixtures. Extend the supplied design vectors with ledger,
changed-child, delta/bundled and malformed-mode/binding cases. Retain historical
investigation data as evidence with its original interpretation.

Exit: no unconditional Git/current-string claim remains in normative prose;
each field/identity/operation above has at least one positive or negative fixture;
new expected hashes are independently checked. The revision is explicit about
implementation still being in progress. No product implementation in this slice.

### S2 — One schema, typed contracts and complete snapshot creation/reading

Change Reader's public identity/internal models and format/archive checks, Core's
public/internal result and request models, CLI JSON contracts and direct callers
together. Add the shared exact state-hash routine in the lowest suitable Reader
layer so Core can reuse it without Reader depending on Core. Reader's selective
opener distinguishes declared identity from full hash verification; hash every
current file only on explicit verification/creation paths.

Implement Core history-free capture, hashing, ZIP emission and independent
post-write verification. `pack` defaults to none; existing Git output writes
the revised typed schema. A missing Git installation cannot prevent snapshot
creation, standalone validation or reading. Preserve old Git implementation and
malformed-history tests under explicit Git mode. Update all affected call sites
to compile directly against the new types, including Reviews declarations.

Exit: both modes parse through one schema, all current-file mutation classes
invalidate the snapshot hash, non-Markdown/ledger/review bytes are included,
poison/absent-Git snapshot proofs pass, and output failure/cancellation preserves
the destination. No old wire parser or record overload is retained.

### S3 — Bootstrap, origin proof and real update command

Build new materializer/update orchestration using existing repository/tree/pack
facilities and ledger operations. Add the fixed bootstrap serializer and an
independent verifier. The existing managed verifier is a **single-commit**
snapshot verifier; do not pretend it already validates arbitrary appended/imported
history. Native Git may service multi-commit construction/verification in this
slice, with existing isolation and resource limits. Snapshot mode never falls
back to native Git.

Expose verified original-state reconstruction and checkpoint relationship through
a bounded Reader/backend contract so Reviews need not accept an unchecked alias.
Implement `update --materialize` and the bounded `update --tree` contract from
section 4 only; leave general squash,
truncate and a browser historical backend explicitly unsupported where not built.

Exit: same S0 gives exact C0 across two implementations/oracles; altered header,
tree, commit metadata, parent, namespace, mapping or missing blob is rejected;
C0→C1 preserves ledger roots and exact original context; absent S0 gives no output.
Full validation proves materialized roots and partial coverage, and a failed
append cannot replace a good destination.

### S4 — Reviews correlation and mode-specific verification

Complete typed `review.of`, verification-obligation computation and origin-aware
exact-context/newer-target resolution in `Mdpkg.Reviews`. Change provider contracts
and the review-consumer example directly. Validate delta namespace separation
and snapshot-targeted bundled parent/review-only constraints through the full
provider. Read anchors, authored kinds and selectors with the existing algorithms.

This slice covers consuming and validating bundled artifacts, with fixtures as
their producer. The current public Core API has no general bundled-review writer;
adding a product UI or general authoring API for that shape is separate. A caller
using a capable producer must obey section 1.8; absence of an authoring UI does
not excuse a validator from rejecting forged bundles.

Exit: delta packages in either mode can target either state kind; matching
snapshot context and verified C0 reconstruction produce the same original
selectors; wrong/missing origin and non-selected newer targets preserve all
feedback with explicit failures. No provider can claim Full through a missing
required Git repository or an incomplete required-check set. Full verification
of a delta package remains possible without its external reviewed source;
unverified source prevents verified selector/location claims, not verification
of the delta artifact's own bytes and declarations.

### S5 — Browser schema, export and persistence

Change web container/format/conformance checks and current resolvers to the same
typed schema and capability rules. Keep the current link adapter and preview
rendering logic; update comparisons and context values, not CommonMark/root or
selector algorithms. A general Git-history reader is not required for this
slice: unsupported origin/history-dependent operations must remain explicit.

Make normal delta export a two-file snapshot (manifest and comments) with full
hash/CRC/schema/selector self-checks. It must not import
the Git writer for this operation. Remove the now-unused export-only Git bundle
dependency if the build graph proves it has no remaining product use; measure
the actual build result rather than predicting a bundle-size reduction.

Separate the private editing workspace key from exported package namespace.
For each distinct prepared review revision and typed reviewed target, allocate
and persist one fresh artifact namespace with its prepared bytes. Download/share
retries of that unchanged prepared artifact reuse it. A changed prepared export
gets a fresh namespace; keep authored thread/comment UUIDs and the typed target.
This avoids claiming successive history-free checkpoints in one namespace. It
also avoids moving drafts to a new key just because a file was exported. Keep
existing stale-export, draft, quota, conflict, restore and failed-share safeguards.

Use the fresh development database domain described in section 3. Revised
package cache keys are canonical tuples of format, namespace, state kind, state
ID and the two addressing profiles. All equality is by fields, not JS object
reference or default string conversion. Materialization opens a separate saved
package; do not silently move S0 drafts to C0/C1. Explicit reviewed-context use
and original feedback remain available under their original typed identities.

Exit: open/browse/link/preview/review/prepare/download/restore work on snapshot
and committed originals; returned snapshots validate in Core and Reviews; no
Git code loads on ordinary snapshot delta export; namespace and identity keys
survive retry/reload and stay distinct across changed revisions and kinds.

### S6 — Integrated acceptance and release documentation

Run end-to-end CLI→web→review→Core/Reviews fixtures, the materialization/update
roundtrip, both mode matrices and installed consumer/tool proofs. Update READMEs,
help, XML docs, JSON-output examples, NuGet consumer examples, fixture generators,
release inspection and build-graph expectations. Remove old-manifest positive
fixtures; a small malformed string-current case is enough to check schema
rejection. Do not maintain a second compatibility test matrix.

Measure actual snapshot package sizes and creation/full-validation costs against
explicit Git-mode output on CARD-0050's four shapes. Verify bounded current reads
and full-hash resource limits. Keep the existing distinction between exploratory
timing samples and an isolated performance gate; zero Git bytes/calls must be
proved, while a new speed/memory benefit must be measured before being claimed.

Exit: supported applications agree on state hashes and origin relationships,
all required tests pass, generated examples match the spec, no default path
emits obsolete manifests, and release notes describe one breaking draft update.

Dependencies: S1 → S2 → S3 → S4 → S6; S5 uses the S1 schema/S2 vectors and joins
S6. S5 can implement current reading/export while S3 is developed, but no
delegation or parallel execution is required by this plan.

## 6. Code locations and retained work

| Surface | Owning locations and practical scope |
| --- | --- |
| Reader contracts, schema, hashing and origin projection | [ReadLimits.cs](../../../src/generator-cli/src/Mdpkg.Reader/ReadLimits.cs), [PackageArchive.cs](../../../src/generator-cli/src/Mdpkg.Reader/PackageArchive.cs), internal models/format/ZIP reader, [Addressing.cs](../../../src/generator-cli/src/Mdpkg.Reader/Addressing.cs), [LooseReference.cs](../../../src/generator-cli/src/Mdpkg.Reader/LooseReference.cs). Package opens currently read history/main ref unconditionally. |
| Core creation/validation/update | [Contracts.cs](../../../src/generator-cli/src/Mdpkg.Core/Contracts.cs), public/internal PackageBuilder and PackageValidator, Git/CommitSerializer/Repository and [LedgerEngine.cs](../../../src/generator-cli/src/Mdpkg.Core/Internal/Addressing/LedgerEngine.cs). Capture, LF normalization, inventory, ZIP emission, confirmation operations and atomic output remain reusable. Materialize/update orchestration is new. |
| Reviews | [ReviewParser.cs](../../../src/generator-cli/src/Mdpkg.Reviews/ReviewParser.cs), [ReviewExtractor.cs](../../../src/generator-cli/src/Mdpkg.Reviews/ReviewExtractor.cs), [ReviewResolver.cs](../../../src/generator-cli/src/Mdpkg.Reviews/ReviewResolver.cs), [Models.cs](../../../src/generator-cli/src/Mdpkg.Reviews/Models.cs). Replace `Profile.Oid(reviewed.Current)`, identity equality and unconditional Full mask assumptions. |
| CLI | [PackCommand.cs](../../../src/generator-cli/src/Mdpkg.Cli/Commands/PackCommand.cs), [UpdateCommand.cs](../../../src/generator-cli/src/Mdpkg.Cli/Commands/UpdateCommand.cs), common options, reporting and help/tests. Update currently calls Stub.Run; advertised transform options do not imply working update logic. |
| Browser | [format.js](../../../src/web-viewer/src/format.js), container reader/conformance, inbound open, address/resolve and links/resolve, [review/emit.js](../../../src/web-viewer/src/review/emit.js), [ui/review-view.js](../../../src/web-viewer/src/ui/review-view.js), persistence model/store/session. Namespace reuse on repeated review export needs the explicit artifact/workspace split in S5. |
| Proofs and examples | [worked-example.py](../../spec/worked-example.py), [review fixture generator](../../spec/review-fixtures/generate.py), .NET fixture support/producer/spec/review suites, web fixtures/persistence/export/build-graph tests, installed library/tool/consumer scripts and examples/review-consumer. Regeneration and output assertions remain real work without migration support. |

The plan is smaller because every consumer has one schema and one set of public
types, with no adapters, downgrade writer, old-session converter, format-version
dispatch or interoperability rollout. It still requires two **capability modes**,
an all-content hash, a new update path, full origin validation and review/export
identity work. Removing compatibility does not remove those correctness costs.
There is no calibrated engineer-day estimate in the repository; six slices are
a review/release structure, not a claim that this is a six-day change.

## 7. Required test-design matrix

Test design should attach named cases to these properties and the S1 vectors.
These are independent behavioral obligations, not a request to duplicate
implementation internals in tests.

| Group | Required cases / failure boundary |
| --- | --- |
| Schema and inventory | Valid ordinary/delta snapshots and ordinary/materialized/bundled Git; both mode mismatches; string/null/unknown current; extra forbidden history field; absent/extra Git or history entry; extra control file; ledger/review presence mismatch; invalid Unicode/path collision and directory masquerading. |
| Exact hashing | Entry reorder/recompression and transport evidence unchanged; edit every path/file/ledger/comment/header field and require a changed state hash; BOM/trailing whitespace/non-Markdown bytes included; Unicode byte ordering, escaping, zero-length files, explicit nulls and duplicate properties; no recursive self-hash. |
| Bootstrap | Exact three supplied C0 vectors plus ledger/nested trees; two oracles agree; wrong time/name/message/namespace/header/tree/parent/hash/extra header, absent object, false root and unverified mapping fail. Changes to current C1 do not change the S0 reconstruction. |
| Successors and evidence | C0→C1 append, unchanged-tree semantic change, confirmed move/rename, reserved-slot replacement, split/merge/deletion, unknown correspondence and partial coverage; equal endpoints after lost edit/revert never claim untouched; missing S0 cannot append a fabricated predecessor. |
| Origin lifetime | Repack retains proof; retained-root squash keeps origin; removed/rewritten root cannot retain its alias; truncated history and lost original report unavailable; no origin follows an exact at-reference to another commit. |
| Reviews | Both delta current kinds × both reviewed kinds; snapshot/commit-targeted bundles; modified document/ledger or wrong parent fails bundle validation; exact source, explicit newer-target choice, namespace/kind mismatch, retained feedback on missing proof and required-check mask manipulation. |
| Browser persistence/export | Retry unchanged prepared export, edit after preparation, repeated changed exports, save/reload, two-tab conflict and canceled/failed share; private workspace stays stable while artifact namespaces vary; no accidental `[object Object]` key/equality; old database is not opened or erased. |
| Budgets and publication | Stream/source mutation capture, aggregate decoded limits, cancellation while hashing/tree/pack/origin traversal, no unbounded preimage allocation, failed validation never replaces output; missing/poison Git does not affect snapshot paths. |
| Integrated regressions | Existing Git import/deep-validation behavior under the new manifest, native default still gated as before, at-less preview/read budgets, comments-document kind/selector/reply semantics, fresh fixtures and installed public-library consumers. |

Future verification commands retain the existing test entry points after the
relevant fixtures/contracts have been updated:

```powershell
dotnet test -c Release --no-progress --output Normal
```

Run that command from `src/generator-cli` on Windows and the existing Linux
verification environment. From `src/web-viewer`, use:

```powershell
npm test
npm run test:browser
```

The build stage must also run the repository's installed tool/library/consumer
proof scripts with its actual feed/artifact paths. Their parameters are owned by
those scripts; do not invent a passing proof from a build alone. Count expanded
tests and report failures when the implementation stage runs them. No such
application regression or build run was necessary for this planning-only change.

## 8. Design verification and handoff

The companion [breaking-revision-vectors.json](../../investigations/deferred-history/breaking-revision-vectors.json)
contains three complete designs: the guide, Unicode/nested-path content including
BOM/trailing whitespace, and an empty version-2 delta review targeting the guide
snapshot. Each carries exact source bytes as UTF-8 strings, canonical preimage,
snapshot ID, native Git tree, exact bootstrap payload/ID, origin record and both
mode manifests/history. They are design data, not a new package implementation.

The canonical preimages/state IDs are independently checked with Python and the
existing JavaScript canonical serializer/SHA-256. Native Git constructs the trees,
checks the exact commit payloads/IDs and verifies all three isolated repositories;
Python independently recomputes the Git commit hashes. These checks establish
encoding agreement for the vectors, not complete protocol or application
conformance. Git commands ran only in ignored scratch repositories under
`.antiphon/task-22cec9a1-vectors/`; the format specification was not modified.

Results: **3 vectors, 24 JavaScript encoding/hash assertions passed, 0 failed**;
all three native Git repositories passed `fsck --full --strict`. Python also
checked each native commit's exact payload and object hash. No application
regression suite, new-format package build or performance benchmark was run.

Recommended next stage: **review this plan**, especially snapshot/header identity,
materialized-root lifetime, the review export namespace rule and checkpoint-proof
gating. Then proceed to S1 and test design, followed by S2–S6. The product choice
to make a direct breaking revision is already settled; no compatibility or
CARD-0050 activation decision is a prerequisite to this handoff.
