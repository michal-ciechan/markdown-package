# CARD-0004: section addressing investigation

Status: investigation and computed-default follow-up complete; proposed semantics and executable evidence, not a production format implementation. Checked on 2026-09-07. The [ZIP container](compression.md) and [real packed `.git` history](history.md) are accepted inputs to this card.

**Current verdict: replace mandatory per-entity UUID maps with computed default identities and confirmed sparse exceptions.** Compute all scoped digests at runtime. Store identity records only when the default stops representing continuity, including rename/move, duplicate displacement, retirement, and reuse of an old location. Under the same identity-aware producer contract as the original proposal, the confirmed sparse model matches all 189 semantic comparisons. Automatic Git-only population does not meet that contract. See the [follow-up recommendation and measurements](#follow-up-computed-default-identities-and-sparse-exceptions).

The original design below is retained as the measured full-map baseline; its mandatory UUID maps and UUID reference grammar are superseded by the follow-up, not a second recommended storage layer. Its source scopes, changed-state semantics, explicit coverage and ordered squash evidence still apply. **Git does have a native shallow marker, `.git/shallow`; synthetic snapshot roots still need an explicit truncation declaration.** [Git shallow repository documentation](https://git-scm.com/docs/shallow).

## Original full-map design: identity, review scope, and producer contract

Allocate a lineage namespace UUID, a UUID per document, a UUID per addressable heading section, and one permanent preamble UUID per document. Use canonical lowercase UUID strings; allocate them once, independently of text, pathname, position, and package bytes. Namespace follows the package lineage through updates and repackaging. Copies into unrelated lineages receive a new namespace; forks must declare whether they retain shared lineage identities. Never infer shared identity from equal content. The deterministic UUID allocation in the fixtures is only reproducibility machinery, not an algorithm for matching revisions.

An external current-review record is keyed by `(namespace, entity kind, entity UUID, digest profile, expected SHA-256)`. A separate `observedAt` commit ID can record when the review happened. It is evidence for a history query, not part of the current-review key. A section with the same identity and expected source digest remains reviewed even after many unrelated commits, repacks, or squashes. Its path and heading are display locators; neither is the key.

| Candidate anchor | Why it does or does not meet the requirement |
| --- | --- |
| Whole-file hash or commit ID | Changes on unrelated edits; unsuitable for the current section-review key |
| Line, byte offset, heading occurrence | Moves on insertion; repeated-heading counterexample can select the wrong original |
| Heading slug or ancestor trail | Heading rename changes identity; duplicate headings need an unstable tie-breaker |
| Section content hash as identity | Useful as expected state, but edits/renames make the old identity disappear; identical copies collide semantically |
| Producer UUID + scoped digest | Stable entity lookup plus explicit changed-state result, conditional on producer continuity |

### Source profile: `cm0312-source-lf-v1`

1. Decode strict UTF-8 and normalize CRLF and lone CR to LF. Do not normalize Unicode; a BOM, if present, is retained as source. Invalid UTF-8 is outside this profile.
2. Parse CommonMark 0.31.2 without smart punctuation. Only headings that are direct children of the document AST open addressable sections. Recognize ATX and Setext headings. Heading-like text in fenced code, HTML blocks, blockquotes, or list items does not open an outline section. This is a deliberate source outline profile, not every possible Markdown dialect. [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), [commonmark.js parser and source positions](https://github.com/commonmark/commonmark.js).
3. A heading section begins at the start of its heading source line and ends immediately before the next top-level heading of equal or lower rank, or at EOF. Include the heading's exact source markup and all descendants. A child edit therefore changes both child and ancestor digests; a sibling edit does not. Changing a heading's rank also changes its source digest.
4. Preamble is everything before the first top-level heading, or the whole source for a headingless document. Keep its ID when it becomes empty or acquires following headings. Preamble addresses use reference kind `section`; the identity record distinguishes the scope.
5. Strip trailing blank separator lines consisting only of spaces or tabs at the scope boundary. End a remaining nonempty scope with exactly one LF. Keep internal whitespace, markup, capitalization, and Unicode exact. Document digests use the same normalization over the whole document. Blank separators and line-ending conversion alone are intentionally not review changes.
6. Hash the UTF-8 bytes of `"mdpkg\0" + profile + "\0" + scopeKind + "\0" + canonicalSource` using SHA-256. `scopeKind` is `document`, `section`, or `preamble`; these domains are distinct. Git blob IDs bind exact stored bytes separately.

This profile reviews **source in a section**, not its entire rendered meaning. The probe changes a link definition under `# B` from `/old` to `/new`; a reference-style link under `# A` renders differently but A's scoped source digest stays equal. Moving unchanged source can likewise change a relative link's base. Show location changes separately and label the review scope. A product promising rendered-output or dependency review needs an additional versioned context digest and invalidation policy; it must not silently extend this source profile. Such a policy can conflict with blanket insensitivity to edits elsewhere.

### Concrete awkward cases

The executable fixture contains `Section 1` with a child, `Other`, two identical `Repeat` headings, and a second headingless document. The producer explicitly carries IDs between the authored states; this tests the proposed contract, not an inferred correspondence algorithm.

| Mutation | Identity action | Resolution of previous review |
| --- | --- | --- |
| Insert a heading before Section 1; edit Other after it | Update locators only for Section 1 | **survives**; whole-document review is **flagged-changed** |
| Rename `Section 1` to `Renamed section` | Retain section UUID | **flagged-changed**, with current heading/location; never a slug lookup failure |
| Insert a third identical `Repeat` before two existing repeats | New UUID for insertion; preserve both existing UUIDs | Each old reference **survives**; an occurrence-based selector selects the wrong original in the counterexample |
| Move Section 1 with its subtree later in the file | Retain section and child UUIDs | **survives** with updated location; document review changes |
| Move that subtree into the second document, within the namespace | Retain section and child UUIDs; change their document owner | **survives** if source stays equal; both document digests change |
| Rename `spec.md` to `folder/renamed.md` | Retain document, preamble, and section UUIDs | Document and section reviews **survive**, location changes |
| Edit the child under Section 1 | Retain all UUIDs | Child and Section 1 **flagged-changed**; Other **survives** |
| Promote the child from `##` to `#` | Retain child UUID; recalculate boundaries | Child and former parent **flagged-changed** |
| Split Other into two sections | New UUIDs for both results; retire Other with `split` and successor IDs | **flagged-changed / superseded**, no automatic review transfer |
| Merge the two Repeat sections | New UUID for result; retire both inputs with `merge` and successor ID | Both prior reviews **flagged-changed / superseded** |
| Delete Other | Carry a `deleted` tombstone | **flagged-changed / deleted**, including after snapshot truncation |
| Add the first heading after existing headingless text | Keep permanent preamble UUID; allocate heading UUID | Preamble **survives** if its canonical source is equal |
| Edit text before the first heading | Retain preamble UUID | Preamble **flagged-changed**; subsequent independent section unchanged |

A split/merge is an explicit editorial operation. If an editor instead keeps one ID and deletes/adds other sections, the reader sees those declared operations, not an inferred split. Copying a section allocates a new ID even when its digest is identical. Moving between namespaces needs explicit cross-lineage provenance; it is not continuity under this reference. Retired IDs cannot be reused for unrelated entities. Keep tombstones and successor links through squash and truncation; if tombstone retention is bounded, declare the resulting entity-coverage limit and return unavailable for excluded IDs. A deliberate restoration of the same entity must be recorded as a lifecycle event, never guessed from matching text.

**Producer compliance is a format requirement, not a property of Git.** Ordinary editors may leave maps stale. An identity-aware editor/exporter must preserve IDs, update locators and blob bindings atomically, allocate new identities on insertion/copy, and resolve ambiguous correspondence before publishing a complete map. On a generic import, bootstrap once and disclose identity coverage starting there. If subsequent correspondence is ambiguous, report unknown continuity or allocate new identities; do not bless a fuzzy match as reviewed. Two indistinguishable duplicate sections can be swapped without any byte-level evidence of the producer's intent. No hash, parser, or full-history walk solves that information loss. Structural validation catches stale maps; it cannot prove honest identity intent.

## Reference syntax and resolution

Proposed URI grammar; `mdpkg` is a format proposal, not a registered scheme or a network endpoint. `N`, `D`, and `S` below denote full UUIDs, `H` a full lowercase SHA-256, and `A`/`B` full object IDs qualified as `sha1-<40 hex>` or `sha256-<64 hex>`.

```text
mdpkg://N/v1/document/D?profile=cm0312-source-lf-v1&expect=H
mdpkg://N/v1/section/S?profile=cm0312-source-lf-v1&expect=H
mdpkg://N/v1/section/S?profile=cm0312-source-lf-v1&expect=H&at=A
mdpkg://N/v1/commit/A
mdpkg://N/v1/diff/A..B?document=D&profile=git-myers-u3-v1
mdpkg://N/v1/hunk/A..B?document=D&profile=git-myers-u3-v1&patch=H&ordinal=0
```

The first two references select the package's manifest-declared current commit. `at` instead requests that exact historical snapshot; do not fall forward to the current snapshot or transparently redirect through a squash binding. Store `observedAt` outside the current reference when it is only a review timestamp/checkpoint. Bind object algorithm and full ID; never use abbreviated Git hashes. Reject unknown versions/profiles, duplicate or unknown query parameters, malformed IDs, and foreign namespaces. Navigation without `expect` may be a separate UI feature; it does not establish reviewed state.

Commit references identify immutable Git objects. Diff references select two exact snapshots and a document identity; resolve its path independently at each endpoint, so a file move is not confused with a new document. A missing side needs an explicit creation/deletion record; missing history is not an empty file. Hunk references additionally bind the SHA-256 of the exact complete patch bytes and a zero-based hunk ordinal. Repeated equal hunks are then unambiguous within that patch. A section filter can be added by resolving its scope at both endpoints; only document-filtered native diffs are exercised here.

`git-myers-u3-v1` in the probe fixes Myers, three context lines, full blob IDs, text output, no rename detection, no indent heuristic, no external diff/textconv, and no color. **For a published hunk reference, retain its exact patch bytes** as `.mdpkg/history/patches/<sha256>.patch`, with a manifest-bound record of endpoint IDs, document ID, profile, tool version/options, paths and patch hash. This avoids depending on identical regeneration across Git versions, path-quoting rules or user configuration. Count this optional evidence storage when promising hunk retention; it is not part of the section-summary size table. Native Git line ranges are presentation evidence, not section identity. If regeneration disagrees with the expected hash, use the verified saved artifact; if both are absent, return unavailable. Do not relocate the hunk by line number, title, or approximate text. [Git diff options](https://git-scm.com/docs/git-diff).

### Tracked identity maps, computed digests

The proposed extra Git-tree files are:

```text
.mdpkg/address/config.json
.mdpkg/address/ids/<UUID prefix>.json
```

`config.json` contains `{version:1, namespace:N, profile:"cm0312-source-lf-v1", shardHex:1}`. Each shard is a UUID-keyed JSON object. Illustrative records (placeholders, not literal valid IDs):

```json
{
  "D": {"k":"document","path":"spec.md","blob":"sha1-<full object id>"},
  "S": {"k":"section","document":"D","line":7},
  "P": {"k":"preamble","document":"D"},
  "OLD": {"k":"retired","kind":"section","reason":"split","successors":["NEW1","NEW2"]}
}
```

Use the first hex nibble for up to 4,096 records (16 possible shards), two above that (256). This is an initial size/read tradeoff, not a measured optimal threshold. Pin layout in config and keep it stable over ordinary commits; a deliberate resize may change all metadata blobs but not identities or review digests. Add hysteresis in a producer so a threshold oscillation does not rewrite the index repeatedly. The config and maps are ordinary tracked Git blobs and benefit from Git reuse/deltas. Lines are **version-local locators**, checked against the bound document blob, never external identity.

Resolution at a selected commit:

1. Validate manifest version, namespace, current commit and coverage. Load the selected commit and tree. If an exact requested commit is not available, return `invalidated / history-unavailable`, with a matching provenance summary if one exists.
2. Read config and the UUID's shard from that tree. Missing metadata is an unindexed snapshot, not permission to reconstruct IDs from headings. An explicit tombstone returns `flagged-changed` with its reason and successors. An unknown ID returns unavailable, not an asserted deletion.
3. Read the owning document's shard if different, resolve its path in the same tree, and verify its exact blob ID. Reject nonunique IDs/locators, invalid paths, wrong shard placement, duplicate document ownership, unsupported kinds, and inconsistent records. Full map validation is a producer/package-validation pass; a targeted reader validates what it consumes and must not imply it audited unseen shards.
4. Load that one document blob, parse this snapshot, locate the heading at the recorded line, and recompute its scoped digest. No preceding revisions are needed. Compare to the external expected digest. Return `survives / same-source` or `flagged-changed / source-changed`, plus current ID, digest and location. Missing content, bad metadata, unsupported profiles, and incomplete coverage return typed `invalidated / unavailable` results.
5. A stored digest is an optional acceleration hint, not independent proof. Verify it from source before trusting it in an untrusted import. A local previously verified cache keyed by `(blob ID, profile, scope)` may avoid repeated parsing. A changed cached digest cannot make changed source reviewed.

The measured targeted native path reads **3 or 4 Git blobs** for live sections: config, section shard, possibly a separate document shard, and source. Tombstones need only config and one shard. It performs **zero log walks**. This does not promise three disk reads or ZIP range requests: tree/index traversal, pack delta dependencies, and the accepted history reader's pack I/O still apply. Recomputing every identity from the full log would cost more and still fail the ambiguity cases; pin identity at publication, compute content from the selected snapshot.

Adding tracked maps changes trees and commit IDs if retrofitted into existing commits. Prefer adoption from a new commit forward, retaining original old commits as unindexed history. If a producer deliberately rewrites legacy history to add maps, declare the projection and source-commit mapping. Do not claim old OIDs or pre-adoption section identities survived that rewrite.

## Stability matrix

The document/section rows below are **current-review references without `at`**. Other rows select immutable historical evidence. “Invalidated” means no valid answer from shipped evidence; it does not erase the external review or prove deletion. Operations retain namespace and compliant identity maps unless stated otherwise.

| Reference kind | Repackage / Git repack, same objects | Squash commits | Truncate to a later base | Move / rename a file | Edit referenced content |
| --- | --- | --- | --- | --- | --- |
| Document | **survives** | **survives** if final digest matches; otherwise **flagged-changed** | **survives** if current ID/source retained and equal; otherwise **flagged-changed** for a known change/tombstone, **invalidated** outside coverage | **survives** for same bytes/ID; location updates | **flagged-changed** |
| Section, including preamble | **survives** | **survives** if final scoped digest matches; changed digest/lifecycle is **flagged-changed** | **survives** if current ID/scope retained and equal; otherwise **flagged-changed** for a known change/tombstone, **invalidated** outside coverage | **survives** for same scope/ID, including cross-document moves | **flagged-changed**, including heading rename and descendant edit |
| Commit | **survives** | **survives** if exact object retained; **invalidated** if discarded/replaced | **survives** if exact object retained; otherwise **invalidated** | **survives** at old snapshot | **survives** at old snapshot |
| Diff | **survives** with same profile/patch definition | **survives** if both endpoints and required maps/blobs retained; otherwise **invalidated** | Same endpoint rule: **survives** or **invalidated** | **survives** at old endpoints | **survives** at old endpoints |
| Hunk | **survives** if exact patch hash/ordinal still verifiable | **survives** as archived evidence if the bound patch is retained; otherwise **invalidated** unless exact regeneration is possible | Same evidence rule: **survives** or **invalidated** | **survives** in old patch | **survives** in old patch |

Changing endpoints creates a new diff/hunk reference; old line numbers do not follow the edit. A document/section reference with `at` follows the immutable-snapshot availability rule and never silently retargets. A saved old patch can remain archived evidence after object removal, but cannot pretend to make an absent commit or full snapshot readable. A review at an intermediate squashed state can still be compared with today's section using its UUID and stored expected digest; if different, it is `flagged-changed` even when that old source can no longer be displayed.

## Closing the three history gaps

### 1. Squash provenance is explicit, review identity is independent

The native probe uses `git merge --squash`, then commits. The result has one parent and exactly the tip tree; an ordinary one-parent commit has the same structural shape. Record each transformation, its source range and emitted commit binding explicitly. Do not infer squash from parent count or a commit message. A current review resolves through UUID plus expected digest, so a new commit hash from squash does not invalidate it. An immutable commit reference stays exact; report a superseding squash as provenance, never as the same commit.

### 2. Truncation has both native and format-level signals

A real depth-two shallow clone in the probe retains the original commit IDs, includes a `.git/shallow` boundary, and omits the older base. Its boundary commit's raw object still names its parent, while Git traversal treats that boundary as shallow. A separately packed synthetic root reports `--is-shallow-repository=false`, even though it deliberately discarded earlier history. Both cases are validated, so “no shallow marker” cannot mean “complete original history.” [Git shallow semantics](https://git-scm.com/docs/shallow).

The manifest must carry independently:

- **Graph coverage:** complete / truncated / unknown within an explicit source repository, path projection, branch/walk and range; original versus synthetic roots; source base/tip and omitted ancestry; native shallow boundaries and any other excluded edges.
- **Identity-index coverage:** which retained commits have usable identity maps, and where adoption begins. A full Git graph can contain unindexed old snapshots.
- **Entity coverage:** whether current live records and retired IDs are complete in the declared namespace/scope, or bounded with explicit limits. This controls unknown-ID interpretation independently of ancestry.
- **Transformation and summary coverage:** ordinary / squash / synthetic-root, emitted commit bindings, summary hashes, and complete / partial / absent evidence for the declared ranges.

Ship `.git/shallow` when retaining a genuinely shallow graph and check it against declared boundary IDs. A missing parent outside a declared shallow boundary is corruption or an incomplete package, not an inferred valid truncation. Preserve prior truncation declarations and tombstones during later squash/export. A producer's “complete” claim is checked against shipped graph/index consistency; it is not external proof that no undisclosed upstream history ever existed.

### 3. Squash summaries preserve edits that endpoint digests lose

The real sequence is **base → heading rename → revert → unrelated edit**. The final Section 1 digest equals the reviewed base digest. Current-source review therefore **survives**. A separate “was this section touched after my review checkpoint?” query must answer **yes** when the review precedes the rename, including after squash. It must answer **no** if the review happened after the revert and only the unrelated edit follows. A touched-ID union cannot distinguish these two queries.

For a declared first-parent range `(base, tip]`, require a versioned summary containing:

- Namespace, digest profile, explicit walk and coverage, source base/tip, and ordered full source commit IDs with 1-based transition ordinals. Base is position 0.
- Per-entity `changedAt` lists of ordinals where canonical digest or live existence changed; a touched-ID union is derivable. Include document, parent section, child, and preamble entities according to the same scope rules, including both an edit and its revert.
- Before/after digest pairs for touched entities, plus hashes of the complete endpoint entity-to-digest maps. `null` denotes absent live content, not an empty digest. This binds composition to the stated endpoint states.
- Creation, retirement, split/merge/deletion/restoration events at their transition ordinals, with successor IDs where applicable. Location-only moves can be separately recorded if an audit policy needs them; they are not source-change events.
- Collapsed input commit IDs, nested-summary hashes and their emitted commits, so repeated squash retains provenance and preserves the original ordered events. Bind each emitted squash commit after it is created.

An exact touched query over checkpoint positions `(from, to]` tests whether an entity has an event with `from < ordinal <= to`. Missing checkpoint membership, identity coverage, any missing subrange, or an unsupported walk returns **unknown**, never “untouched.” The event lists preserve a temporal claim; endpoint digests alone do not. Review policy should expose current-source equivalence separately from “edited since review.” Persist `observedAt` if the latter is required.

Resolve and validate the entity before asking this temporal question; the low-level ordinal predicate in the probe assumes a known identity. An earlier emitted squash commit used as `observedAt` can map to that summary's ending source position through a verified binding. This temporal checkpoint mapping is not an alias for an immutable `at` reference. Retain those older bindings when nesting summaries; without them an emitted checkpoint absent from the expanded source list is unknown.

Store canonical UTF-8 JSON summary bytes in independent ZIP members `.mdpkg/history/ranges/<sha256>.json`. Store emitted-commit associations in `.mdpkg/history/bindings.json`, and bind those member paths and hashes in the first manifest. Creating bindings after the commit avoids the impossible attempt to put a commit's own final OID into its hashed tree. Summary hashes are integrity identifiers, not signatures or proof of producer honesty. Validate events against available source snapshots when generating the summary; a later recipient without those snapshots can validate structure, bindings and endpoints, but depends on the retained producer assertion for omitted transitions.

Prefer these mandatory sidecars over Git notes or trailers. Notes live under separate refs and rewriting/copying them needs explicit configuration; omission of that ref can silently omit the record. Trailers are editable prose and awkward for ordered per-entity data. Notes/trailers may point at the manifest-bound summary for interoperability, but cannot be the sole required carrier. [Git notes and rewrite configuration](https://git-scm.com/docs/git-notes).

Repeated squash must validate nested namespace/profile/walk and endpoint-state bindings, expand original commit positions, shift change/event ordinals, preserve nested bindings, and propagate partial coverage. The executable model tests a nested edit/revert summary followed by an unrelated edit, including a checkpoint inside the original range and a mismatched endpoint rejection. Do not concatenate overlapping ranges or assert a total order over an arbitrary DAG. This card's complete temporal answer is **first-parent scope only**; other merge-parent paths need explicit edge/path coverage and a defined query. Unindexed old ranges can only be partial.

There is an unavoidable information boundary: this compact summary does not retain every intermediate source text, diff, hunk, author record, or rendered output. It can resolve current UUID/digest review and exact touched intervals for its covered checkpoints; it cannot render a removed snapshot. To guarantee old commit/diff/hunk readability, retain those objects or explicit archived patch/snapshot artifacts and pay their storage cost. A range label or touched union is not a substitute.

## Storage and read cost

The corpus experiment allocates identities once over the exact pinned CARD-0002 base blobs: **83 npm documents / 644 headings / 83 preambles = 810 records**, and **633 Rust documents / 9,087 headings / 633 preambles = 10,353 records**. All 716 source lengths and SHA-256s are checked against the existing corpus manifests. This is a metadata snapshot experiment, not an invented identity reconstruction of their upstream histories.

Each row uses the same authored Markdown and a real freshly packed Git repository inside a complete ZIP, manifest first, DEFLATE 6 or stored when smaller, packs stored. Identity-only records carry UUID, owner, line/path, kind, and exact document blob binding; cached rows add each entity digest. All ZIP member names and headers count. Baselines are this experiment's smaller snapshot manifest, not the previous history card's richer provenance package. The tables do not price a final full schema or a duplicate current Markdown view.

<!-- METADATA_START -->

| Corpus | Variant | Raw metadata bytes | Standalone metadata ZIP bytes | Complete Git snapshot ZIP bytes | Over baseline |
| --- | --- | --- | --- | --- | --- |
| npm | No address maps | 0 | 0 | 122,687 | +0.00% |
| npm | Identity only (adaptive) | 96,304 | 39,570 | 161,453 | +31.60% |
| npm | Identity + digests (adaptive) | 157,864 | 66,278 | 188,183 | +53.38% |
| npm | Identity only (fixed 256) | 96,768 | 88,064 | 194,639 | +58.65% |
| rust | No address maps | 0 | 0 | 3,132,664 | +0.00% |
| rust | Identity only (adaptive) | 1,214,224 | 555,724 | 3,671,931 | +17.21% |
| rust | Identity + digests (adaptive) | 2,001,052 | 977,089 | 4,093,314 | +30.67% |
| rust | Identity only (fixed 256) | 1,214,224 | 555,724 | 3,671,931 | +17.21% |

<!-- METADATA_END -->

Fixed 256-way sharding is unnecessarily expensive for small packages because filenames, headers, and separate small objects dominate. The 16-shard npm default lowers that cost at the price of more metadata decoded per targeted read. Rust uses 256 in both layouts. Threshold selection remains a tuning choice; the data establishes the tradeoff rather than a universal optimum.

An optional current-map mirror under `.mdpkg/current/address/` gives independent ZIP entries without consulting Git for those maps. Bind its config/shards to the current commit and exact map object IDs in the manifest; after a mismatch, discard the cache and use Git. This duplicates metadata and does not eliminate source pack access. The measured incremental ZIP cost and target map reads are below. Target sizes are compressed member payload and decoded map bytes; they exclude source, ZIP directory/header fetches, tree traversal, and pack dependencies.

<!-- LOOKUP_START -->

| Corpus | Variant | Added current-map ZIP bytes | Target map entries | Compressed / decoded map bytes |
| --- | --- | --- | --- | --- |
| npm | Identity only (adaptive) | 39,820 | 3 | 4,265 / 10,681 |
| npm | Identity + digests (adaptive) | 66,528 | 3 | 7,232 / 17,445 |
| npm | Identity only (fixed 256) | 92,026 | 3 | 586 / 967 |
| rust | Identity only (adaptive) | 559,814 | 3 | 4,098 / 9,466 |
| rust | Identity + digests (adaptive) | 981,179 | 3 | 7,368 / 15,546 |
| rust | Identity only (fixed 256) | 559,814 | 3 | 4,098 / 9,466 |

<!-- LOOKUP_END -->

The selected sources are npm `docs/lib/content/using-npm/workspaces.md` (6,115 bytes) and Rust `text/3872-crates-io-security.md` (8,057 bytes). Warm median Node parse times were **0.87 / 0.56 ms** and full in-memory resolver times **1.19 / 0.86 ms**, after one recorded initial iteration, over 31 subsequent iterations each. This excludes Git, ZIP and filesystem I/O and follows earlier corpus parsing; it is not a cold-start or browser latency claim. Actual browser Parser import bundles to **159,521 raw / 47,999 gzip bytes**, commonmark.js 0.31.2, esbuild 0.25.9, Node 24.6.0. A viewer already using that parser may share it. Browser execution and other Markdown dialects are not validated in this card.

A tiny two-document, four-snapshot Git history separately measures metadata reuse across real edits. Do not extrapolate its ratios to the corpora. These packages omit the summary sidecar, priced separately below.

<!-- HISTORY_START -->

| Metadata | Four snapshots, ZIP bytes | Base + squash, ZIP bytes | Later synthetic root, ZIP bytes |
| --- | --- | --- | --- |
| No address maps | 2,925 | 2,470 | 2,120 |
| Identity only (adaptive) | 5,972 | 5,112 | 3,984 |
| Identity + digests (adaptive) | 6,711 | 5,653 | 4,338 |

<!-- HISTORY_END -->

<!-- SUMMARY_START -->

The three-transition ordered edit/revert/unrelated summary is **1,955 bytes**, plus **169 bytes** of emitted-commit bindings; their two-member standalone ZIP is **1,397 bytes** including names and headers. Adding these members to an existing ZIP shares its EOCD (22 bytes), before any manifest additions. This example has four touched entities and three source transitions; it is not a full-corpus history estimate.

<!-- SUMMARY_END -->

Summary storage grows with retained source checkpoint IDs and per-entity change events, not just surviving endpoint content. Parent-inclusive scopes create ancestor events too. A bounded union is smaller but cannot satisfy arbitrary interior checkpoint queries; a producer choosing that loss must advertise the reduced capability. Long histories and heavily edited nested documents need a separate event-size benchmark before promising cheap unlimited temporal retention.

## ZIP and packed Git interaction

Keep `.mdpkg/manifest.json` as the first, stored ZIP member with the accepted versioning. Keep curated real `.git` files, packed objects and indexes, and native shallow metadata where applicable. Track identity maps in the same Git trees as their Markdown so historical locators travel with the snapshot. Manifest current-commit selection, scope/coverage, transformations and sidecar hashes are format metadata outside Git; optional current maps are disposable mirrors. No new object format, flat diff store, or mini-git is proposed. Git repacking changes physical pack layout but retains object identity; recompression/reordering changes ZIP bytes without changing entity UUIDs or scoped digests. [Git pack format](https://git-scm.com/docs/gitformat-pack).

A package UUID or archive hash is useful for identifying an individual delivery, but is not this review's lineage/section identity. No network access is required by a reference. Resolving missing history through an explicitly configured source could be a later capability; absent that evidence, return unavailable with the disclosed boundary.

## Reproduction and evidence

Run from `C:\src\markdown-package`, with the existing pinned corpus checkouts and Python environment from [compression.md](compression.md#reproduction-and-evidence). The base-only corpus scripts do not need a rerun of compression/browser benchmarks. They import the existing Git/ZIP helpers without modifying the source repositories. Dependencies and generated Git fixtures remain under ignored `.antiphon/addressing-work/`; each native/size run uses a fresh directory to avoid Windows read-only Git pack cleanup problems.

```powershell
New-Item -ItemType Directory -Force .antiphon/addressing-work/js | Out-Null
Copy-Item docs/investigations/addressing/package*.json .antiphon/addressing-work/js/
npm ci --prefix .antiphon/addressing-work/js --ignore-scripts --no-audit --no-fund
node docs/investigations/addressing/cases.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/native_probe.py
node docs/investigations/addressing/resolve_queries.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/prepare_corpora.py
node docs/investigations/addressing/corpus_metadata.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/measure_metadata.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/verify_evidence.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/render_tables.py
```

Run these sequentially; later probes consume earlier fixture state. Record timings before running other heavy work. Git 2.50.1.windows.1, Python 3.10.2 and zlib 1.2.11 match the prior experiment. Native squash commits include the execution timestamp, so their IDs and summary hashes vary between runs; deterministic size-fixture commits and corpus content stay fixed. Saved JSON is evidence for this run, not a promise that all metadata identifiers/timings are byte-reproducible on every platform.

<!-- VALIDATION_START -->

Validation: **55 model checks**, **25 Git-backed resolution/summary/reference checks** (20 real snapshot resolutions), **716 pinned source checks**, **64 timed resolver result checks**, and **1,175 ZIP entry round trips** across the native and metadata probes. The native probe separately checks real squash, shallow and synthetic roots, file rename, two repacks preserving exact patches, and removed endpoints. The final audit validates **17 saved package archives / 119 members**, summary bindings/hashes, parser/patch hashes and all size arithmetic. **0 unexpected validation failures in final evidence.** Counts describe distinct suites; model checks include expected rejection cases and should not be summed with overlapping native/audit checks as unique scenarios.

<!-- VALIDATION_END -->

Raw evidence: [model cases](addressing/case-results.json), [real Git and ZIP cases](addressing/native-results.json), [Git-backed resolutions and range summary](addressing/resolution-results.json), [corpus/parser measurements](addressing/corpus-results.json), [exact metadata sizes](addressing/metadata-results.json), and [evidence audit](addressing/verification.json). The model deliberately tests negative inputs and unavailable history; these are expected results, not failed validations. During development, a package-export lookup and a rerun deleting Windows read-only pack files failed; direct package-file reading and fresh fixture directories corrected those harness issues. No application build exists for this investigation. URI production validation, SHA-256 Git object-format integration (native probes use SHA-1), a complete format schema, generic-editor identity reconciliation, full-DAG summaries and browser integration remain implementation work.

## Original decision, superseded by the follow-up

The initial recommendation was producer-assigned UUIDs with adaptive identity-only maps. The following experiment replaces that storage recommendation. Parent-inclusive source review, current equivalence versus touched-since-checkpoint, explicit coverage, and immutable historical evidence retain their earlier meaning.

## Follow-up: computed default identities and sparse exceptions

**Recommend the requester's storage direction, with a broader exception contract than “renames/moves only.”** The original **31.60% / 17.21%** costs already excluded stored digests. The avoidable cost was the all-entity identity/locator map. Digests remain runtime computations in both designs. On the identical base snapshots, a sparse table with one binding for 5% of headings costs **2.32% / 0.99%**; at 20%, **7.12% / 3.77%**. A second experiment actually carries controlled rename/move events through the existing 32-transition histories and also favors sparse storage. These are measured encodings and workload sensitivities, not claims about observed real-world rename frequencies.

This replaces the full-map recommendation under its **existing producer-compliance assumption**. It does not replace confirmation with a similarity threshold. The extra storage of full maps does not make arbitrary editors or editorial intent inferable either. Their advantages are simpler fixed-size references, direct UUID lookup, and easier local validation of bound locators; those advantages do not justify making every unchanged entity carry a record in these measured workloads.

### Computed default and exception mechanics

Use the same namespace and `cm0312-source-lf-v1` digest scope. Add anchor profile `cm0312-trail-source-v1`, which defines a locator as `[scopeKind, repositoryRelativePath, headingTrail]`. A trail component is `[exact normalized heading source, zeroBasedOccurrenceAmongEqualSiblings]`; include ancestor components. Document and permanent preamble locators have empty trails and distinct kinds. The CommonMark parser supplies boundaries; absolute lines and byte offsets are not identity. Reordering unique siblings or inserting a differently named sibling does not change their default locators. Renaming an ancestor affects descendant trails and therefore needs descendant exceptions too.

The default root is `SHA256("mdpkg-default\0" + anchorProfile + "\0" + namespace + "\0" + canonicalJson(locator))`. The hash is an encoding of a default anchor, not a digest of the section body. Canonical JSON is UTF-8, sorted object keys, compact separators, no ASCII escaping of Unicode, and a final LF, as in the executable model. Compute these roots and all content digests on read. The common case has no tracked identity file; the measured manifest pays **34 fixed bytes** to select the anchor profile.

When confirmed correspondence differs from the default, store a sparse table in the selected Git tree:

```text
.mdpkg/address/overrides.json
```

```json
{
  "version": 1,
  "anchor": "cm0312-trail-source-v1",
  "entries": {
    "<original root hash>": {"to": ["section", "moved.md", [["# New title", 0]]]},
    "<retired root hash>": {"dead": "split", "next": ["<successor root>", "<successor root>"]},
    "<unresolved root hash>": {"unknown": "unconfirmed-removal"}
  }
}
```

Active bindings go directly from the stable origin root to the **current locator**; flatten chains when updating. Retain the record once an entity becomes exceptional, even if a later revert restores its default location. A review may have been issued at an intermediate renamed location. The probe first exposed this case, then retained the binding so that an intermediate review resolves as changed after the revert instead of becoming unavailable.

When issuing a new reference, use the inverse of the sparse active bindings to recover an already exceptional entity's origin root. Build that inverse in memory; no stored inverse index is required. Otherwise use the computed default root. If a new entity occupies an old entity's reserved root/location, allocate a fresh root **for that exceptional birth only** and store its binding. Retain retirement records so the old review cannot attach to the replacement. Initial/default entities need no allocated UUID. The fixture's hidden UUIDs label editorial ground truth for comparison; they are not written into sparse metadata. A real producer can mint a random fresh root for an exceptional birth instead of the fixture's deterministic allocation.

Proposed current-reference syntax (the v1 UUID grammar above remains legacy):

```text
mdpkg://<namespace>/v2/section/<root-sha256>?anchor=cm0312-trail-source-v1&profile=cm0312-source-lf-v1&expect=<digest>&loc=<base64url-canonical-locator-json>
```

Use `document` in the path for document references; preamble uses `section` with locator kind `preamble`. The external review carries its root, expected digest, and a locator hint. This moves some bytes into external references: path/trail hints are larger than UUID-only references and are not counted as package bytes. The executable URI round trip covers a reference issued after rename and resolved after revert. Historical commit/diff/hunk references remain exact as before; an exact historical section selection applies the same sparse rules to that selected tree, without redirecting unavailable snapshots. The follow-up URI probe covers current references, not a complete historical URI implementation.

Resolve from the manifest-selected tree: verify namespace and profiles, read the optional override blob, use its target or the external default locator, parse that one document, then compare the scoped source digest. Validate descriptor syntax, unique active target ownership, reserved-root reuse and the table's binding to the selected tree. There is no full-log walk and no stored per-section digest. The whole sparse table is read in this encoding; it can be cached and indexed in memory. At high exception density it may be sharded or replaced with a denser encoding in a later profile. That physical change must retain origin roots and historical bindings.

This is a sparse **lifecycle** ledger, not just a list of heuristic rename pairs. The producer/editor can calculate the ordinary case and keep correspondence in memory during an edit, writing exceptions only when needed. An editor's explicit move/rename operation provides confirmation automatically. A generic Git import needs correspondence review when inference is ambiguous; merely writing the heuristic's guess into a table does not confirm it. Both the full and sparse schemes rely on producer intent for strong identity continuity.

### Exact snapshot storage comparison

The following reproduces the earlier no-map and full-map ZIP sizes **exactly**, using the same pinned 83 npm / 633 Rust base documents, real Git packing, stored packs, manifest-first ZIP and per-entry DEFLATE/stored choice. Digests are absent in both identity encodings. Percentages use that corpus's no-map package as denominator.

This table prices a final sparse ledger with 0%, 5%, or 20% of heading records bound from alternate prior anchors to their current locators. It measures table cardinality over identical source bytes; it does **not** reconstruct a coherent earlier authoring history or price descendant propagation for those hypothetical prior labels. The next experiment exercises actual controlled transitions and their propagated exceptions. Rates round to 0 / 32 / 129 npm bindings and 0 / 454 / 1,817 Rust bindings.

<!-- SPARSE_SNAPSHOT_START -->

| Corpus | Alias rate / count | No-map ZIP bytes | Sparse ZIP bytes (over baseline) | Full-map ZIP bytes (over baseline) | Raw sparse ledger bytes |
| --- | --- | --- | --- | --- | --- |
| npm | 0% / 0 | 122,687 | 122,721 (+0.03%) | 161,453 (+31.60%) | 0 |
| npm | 5% / 32 | 122,687 | 125,528 (+2.32%) | 161,453 (+31.60%) | 7,807 |
| npm | 20% / 129 | 122,687 | 131,421 (+7.12%) | 161,453 (+31.60%) | 31,771 |
| rust | 0% / 0 | 3,132,664 | 3,132,698 (+0.00%) | 3,671,931 (+17.21%) | 0 |
| rust | 5% / 454 | 3,132,664 | 3,163,551 (+0.99%) | 3,671,931 (+17.21%) | 80,602 |
| rust | 20% / 1,817 | 3,132,664 | 3,250,827 (+3.77%) | 3,671,931 (+17.21%) | 319,674 |

<!-- SPARSE_SNAPSHOT_END -->

At zero exceptions, sparse metadata has no Git blobs at all; the 34-byte increase is the manifest profile selector. The full-map comparator uses the original 16/256-shard identity-only layout, not the more expensive cached-digest variant. Both remain snapshot metadata costs; full coverage declarations, squash summaries, archived patches and a duplicate current-file view have the same exclusions as the original measurement. Do not subtract those independent features from a package budget merely because identity becomes sparse.

### Rates across the existing histories

Reuse all **64 original first-parent transitions** and verify all **716 base blobs**. For controlled rates, choose deterministic **leaf sections in documents whose blobs are unchanged across all 33 source snapshots**: 310 eligible npm sections and 7,502 Rust sections. This gives known correspondence without guessing whether an upstream edit was a rename. Keep the actual upstream changes and overlay confirmed events evenly across the 32 transitions: roughly half heading renames, half cross-document moves into one generated `addressing-relocated.md`. Selected headings move/rename once. Moved leaves are ordered by decreasing rank so they do not acquire new children. The 0% row means no injected events, not a promise that the real history never changed an anchor.

Natural upstream correspondence has no producer oracle. Unmatched old default anchors are explicitly retained as **unconfirmed**, not labelled confirmed renames or deletions: 22 npm and 200 Rust records at the endpoint. These are unmatched anchors, not empirical rename counts. Default-slot matches on that imported history are not a proof of editorial identity either. The fixture manifest declares original-source correspondence **partial**. Both encodings receive the same assignment policy, authored bytes, event schedule, and retained uncertainty; all injected moves/renames have explicit ground truth and are checked. No claim is made that the upstream repositories adopted this identity contract.

Each full-history row below includes 33 snapshots. Its baseline has the same source modifications and no address metadata, so source compression changes cannot be mistaken for metadata savings. The explicit record count includes uncertainty records; there is no free omission of them in sparse rows. Headers, filenames, config, Git objects, pack indexes, and ZIP overhead are counted.

<!-- SPARSE_HISTORY_START -->

| Corpus | Injected rate / events | Same-source no-map ZIP bytes | Sparse ZIP bytes (over baseline) | Full-map ZIP bytes (over baseline) | Sparse saving versus full, bytes |
| --- | --- | --- | --- | --- | --- |
| npm | 0% / 0 | 159,225 | 162,348 (+1.96%) | 224,762 (+41.16%) | 62,414 |
| npm | 5% / 32 | 169,618 | 180,796 (+6.59%) | 246,225 (+45.16%) | 65,429 |
| npm | 20% / 129 | 187,005 | 204,779 (+9.50%) | 293,825 (+57.12%) | 89,046 |
| rust | 0% / 0 | 3,312,786 | 3,323,633 (+0.33%) | 3,981,589 (+20.19%) | 657,956 |
| rust | 5% / 454 | 3,456,042 | 3,505,264 (+1.42%) | 4,571,770 (+32.28%) | 1,066,506 |
| rust | 20% / 1,817 | 3,823,658 | 3,978,972 (+4.06%) | 5,418,705 (+41.72%) | 1,439,733 |

<!-- SPARSE_HISTORY_END -->

At 5% there are 16 renames + 16 moves for npm and 227 + 227 for Rust; at 20%, 65 + 64 and 909 + 908. Final sparse counts are **22 / 54 / 151** for npm and **200 / 654 / 2,017** for Rust at 0 / 5 / 20%. Direct heading-body edits do not need bindings. These leaf workloads avoid rename fan-out into descendants; they are a controlled common-case sensitivity, not a worst-case upper bound for moving files or renaming high-level headings. A deeply nested rename or file move can make most of a document exceptional.

Endpoint packages also keep the ledger when squashing to base + tip or truncating to a later synthetic root. The table below gives metadata overhead against each operation's own identical-source baseline. Exact byte totals for all 72 packages are retained in the JSON evidence. These rows price identity storage; a squash's required ordered touched summary and archived patch retention remain separate costs.

<!-- SPARSE_ENDPOINT_START -->

| Corpus | Injected rate | Squash: sparse | Squash: full maps | Later root: sparse | Later root: full maps |
| --- | --- | --- | --- | --- | --- |
| npm | 0% | +0.90% | +33.30% | +0.98% | +32.58% |
| npm | 5% | +2.55% | +33.50% | +2.84% | +32.54% |
| npm | 20% | +6.18% | +32.93% | +7.32% | +32.23% |
| rust | 0% | +0.25% | +18.26% | +0.25% | +17.58% |
| rust | 5% | +1.11% | +18.62% | +1.15% | +17.48% |
| rust | 20% | +3.24% | +18.13% | +3.60% | +17.01% |

<!-- SPARSE_ENDPOINT_END -->

The single sparse blob's decoded size at the 20% history endpoint is **27,769 / 321,136 bytes** for npm / Rust. This is substantially smaller than decoding the entire full map but larger than reading one full-map shard. Default lookup reads the ledger (or a cached copy) plus the target document and Git tree/index dependencies. Shared prefix encoding or range bindings for whole-file moves could reduce the measured table further; they are not credited here. Repeated events and long-lived retirement records accumulate. At sufficiently high lifetime exception density the sparse ledger may lose its advantage, so do not promise zero-cost identity forever.

### Can Git populate the table reliably?

**No. Native `git diff -M` detects filepairs, not heading sections.** The default threshold is 50%; `-M80%` requires greater similarity. It is a comparison heuristic, not recorded producer intent. [Git rename options](https://git-scm.com/docs/git-diff), [Git diffcore filepair processing](https://git-scm.com/docs/gitdiffcore).

The probe makes real Git trees for **22 synthetic transitions** using all 16 original states plus complete rewrites, slot reuse, a similar split, unrelated replacement and a long boilerplate replacement. It runs both thresholds on (a) native Markdown file trees and (b) extra parser-generated trees with one scoped section per file named by its computed anchor. That projection is additional tooling; it is not something native `-M` does to Markdown. A third strategy prefers a native file mapping and supplements unmatched sections with projected matches. Each strategy is scored against hidden producer truth, never against Git's own answer.

There are **14 required section-anchor continuations** across the fixture set: five under a file move, parent/child renames, cross-file section moves, promotion, duplicate displacement and complete rewrites. The scoring counts required identity mappings, not body edits whose default anchor remains stable. It excludes document/preamble identity from that denominator. There are 88 actual Git diff runs and 132 strategy evaluations.

<!-- SPARSE_DETECTION_START -->

| Candidate generator | Threshold | Needed mappings | Correct proposals | Wrong proposals | Missed mappings |
| --- | --- | --- | --- | --- | --- |
| Native file mapping | 50% | 14 | 5 | 0 | 9 |
| Native file mapping | 80% | 14 | 5 | 0 | 9 |
| Projected section files | 50% | 14 | 8 | 3 | 6 |
| Projected section files | 80% | 14 | 6 | 3 | 8 |
| Native first + projected | 50% | 14 | 10 | 1 | 4 |
| Native first + projected | 80% | 14 | 8 | 1 | 6 |

<!-- SPARSE_DETECTION_END -->

Concrete failures matter more than an average similarity score:

- **Heading rename in a retained file:** native Git returns a file modification, no rename pair. Lowering `-M` cannot add section awareness. Projecting sections finds some such pairs, including a renamed ancestor's otherwise unchanged child.
- **Duplicate insertion:** two existing identical repeats acquire different occurrence selectors, but their old projected filenames/content still exist. Git emits no rename for either displaced identity. Both thresholds miss them. A plain default lookup can silently mark the wrong identical section reviewed.
- **File move with duplicate sections:** native file mapping retains occurrence correspondence in this fixture. Independent projected matching swaps the two equal repeats at **R100**. A higher similarity threshold cannot disambiguate equal content. The hybrid avoids this particular swap by preferring the file mapping.
- **Rename plus total rewrite:** both original identities in the parent/child fixture are missed even after section projection. A separately moved, completely rewritten headingless document also produces no native rename pair; it is outside the section-pair denominator but included in the case suite.
- **Unrelated replacement with shared boilerplate:** the producer deletes one entity and creates another. Projected Git emits **R099** anyway, a false identity continuation accepted by both thresholds and by the hybrid. A similarity score cannot distinguish replacement from intentional continuity.
- **Split/merge:** these require one-to-many or many-to-one lifecycle records. A rename detector proposes pairs, not those operations. In the small split/merge fixtures it produces no such lifecycle information; accepting a possible pair would still not settle the operation.

Thus the best tested hybrid at 50% proposes **10 correct mappings, 1 wrong mapping, and misses 4 needed mappings**. At 80% it still makes the same wrong proposal and misses 6. These adversarial small fixtures are not an estimate of production precision/recall, but they decisively refute a hard guarantee from automatic similarity matching. Use candidates to reduce producer work, not as authority to transfer review state.

### Awkward cases and the uncaught-change failure mode

All 55 original model checks were rerun. The sparse conformance suite compares every original entity against the original stored-ID resolver across 21 states: **189 comparisons, zero confirmed-model regressions**, plus sparse-specific lifecycle, summary and URI checks. This covers all original state mutations, rather than counting unrelated parser checks as successful rename detections. It uses the **same declared correspondence** as the stored-ID fixture. It does not claim that an automatic importer supplied that correspondence.

| Case | Confirmed sparse behavior / records in the small fixture | Without the needed exception |
| --- | --- | --- |
| Unrelated before/after edits; unique sibling reorder | Same review, **0 records** | Still works while the default identifies the same entity |
| Parent heading rename | Changed parent; descendant identity retained, **2 records** | Parent and child old trails disappear; unconfirmed, not guaranteed changed |
| Insert identical repeat before old repeats | Existing roots preserved and new birth separated, **3 records** | Occurrence-based lookup can silently select the wrong equal section |
| Move subtree to another document | Source-equivalent review survives, **2 records** | Old locator unavailable; possible move cannot be confirmed from absence alone |
| Rename file | Document, preamble and sections survive, **7 records** | All path-based defaults change; native Git can suggest a file mapping |
| Child body edit | Child and parent changed; sibling unchanged, **0 records** | Works with unchanged outline identity |
| Promote/move child | Changed digest, **1 record** | Missing old trail; possible move/rename |
| Split / merge / delete | Changed/superseded with successors or deletion, **1 / 2 / 1 records** | Missing locator does not establish which lifecycle operation occurred |
| Headingless text; first appended heading; preamble edit | Permanent preamble default and scoped digest, **0 records** | Works until document location/identity changes |
| Delete then recreate identical content at the same slot | Old review stays deleted, new root minted, **2 records** | Same locator and same digest can silently inherit the deleted entity's review |
| Rename then revert | Keep origin binding; source review survives and touched summary remembers both edits | Dropping the binding loses references issued at the intermediate locator |

The naïve no-override resolver returns **22 not-found outcomes and 3 wrong-entity resolutions** in the 189 comparisons. The latter comprise displaced duplicates and exact slot reuse; a matching digest does not repair them. A conservative duplicate guard avoids those duplicate transfers by returning unconfirmed even for unresolved unchanged duplicates; the guard yields **60 unconfirmed outcomes** overall and still cannot infer a hidden same-slot replacement from source alone. It is a fallback, not restored identity certainty.

**When a rename/move is missed, a literal computed lookup returns not found.** A safer resolver preserves the external review and returns **`unconfirmed: possibly renamed, moved, or deleted`**, with candidate locations only when evidence supports them. In the complete-rewrite case there may be no useful candidate. It must not assert “renamed,” “deleted,” “unchanged,” or move the reviewed badge to a candidate. If the old locator still exists, absence-based fallback cannot help; ambiguity/slot-reuse records or an incomplete-correspondence declaration are necessary to prevent a false transfer.

Require explicit correspondence coverage per imported transition/range and carry unresolved roots through squash/truncation. Never treat the absence of an override file as proof that a generic editor performed no identity-changing operations. If correspondence for an affected range is incomplete, expose that uncertainty even when current locator/digest happens to match. A complete-coverage claim still depends on producer compliance, exactly as a full map depends on correct UUID assignment. Structural consistency is checkable; intent is not.

This fallback is acceptable for an explicitly best-effort import/recovery view. **It is not acceptable as the sole implementation of the original hard “rename means changed, not missing” requirement.** The recommended default therefore uses confirmed exceptions to retain that requirement, and presents unconfirmed state whenever the producer cannot establish correspondence. Keeping every UUID would not remove that same missing-producer-information problem.

### Squash, truncation, and the revised decision

The override ledger is versioned in Git trees and copied into a retained endpoint on squash/truncation. Keep active exceptional roots, retirement/reuse generations and uncertainty records. Review identity remains independent of the commit ID. An origin root survives the operation when its ledger and current source survive; the original stability matrix applies under this confirmed-correspondence condition. Exact commit/diff/hunk availability remains governed by retained objects or archived patch evidence.

Ordered touched summaries still need source checkpoint positions and edit/revert events. Key them by the computed origin root, declare this anchor profile/identity encoding in their schema, and carry partial correspondence coverage. The sparse probe verifies an edit/revert produces both events for the same origin root and does not touch an unchanged sibling. Current content equivalence cannot substitute for temporal evidence. This follow-up does not remeasure full summary or patch retention; the earlier summary experiment remains separate, and 64-hex root keys can cost more per summary event than UUID strings.

**Replace the original all-ID-map recommendation with computed defaults plus a confirmed sparse lifecycle ledger.** Keep runtime source digests, parent-inclusive scopes, permanent preambles, namespace separation, exact historical references and coverage disclosures. Let explicit editing operations generate exceptions automatically; let Git suggest uncertain correspondences for confirmation. No producer must hand-maintain an ID and digest for every section. No similarity threshold is allowed to silently upgrade an uncertain match to reviewed identity.

### Follow-up reproduction and evidence

Use the same pinned Node dependencies, Git executable, Python environment and source checkouts as above. Run from the repository root, sequentially:

```powershell
node docs/investigations/addressing/cases.mjs
node docs/investigations/addressing/sparse_cases.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/sparse_detect.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/sparse_prepare.py
node docs/investigations/addressing/sparse_corpus.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/sparse_measure.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/sparse_verify.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/addressing/sparse_render.py
```

`sparse_corpus.mjs` generates a roughly 160 MB ignored storage plan and takes several minutes; no browser latency or memory claim is inferred from that offline fixture builder. Every packaging run uses a fresh `.antiphon/addressing-work/sparse-packs/` directory. All 72 real repositories are packed and checked with strict Git `fsck`. The final audit compares their trees to the exact expected source/metadata objects and checks 33 / 2 / 1 retained commits for full / squash / later-root packages. Git 2.50.1.windows.1 and the earlier ZIP settings are pinned by this evidence.

<!-- SPARSE_VALIDATION_START -->

Final validation: **55 original model checks**, **189 confirmed sparse conformance comparisons**, **13 sparse lifecycle/summary/URI/coverage checks**, **88 native diff runs / 132 scored strategies**, **40,174 injected-event resolution checks**, **780 pinned source checks**, and **72 archive hash / tree / history-count audits with 504 ZIP member checks**. The audit reproduces **12 exact prior size comparisons**. **0 unexpected validation failures in final evidence.** The documented wrong heuristic proposals and naïve-reference failures are intentional counterexamples, not hidden successful detections; suite counts overlap and are not a count of independent real-world edits.

<!-- SPARSE_VALIDATION_END -->

Evidence: [semantic comparisons and exceptions](addressing/sparse-case-results.json), [native Git detection](addressing/sparse-detection-results.json), [pinned source checks](addressing/sparse-source-results.json), [controlled event schedules](addressing/sparse-corpus-results.json), [all package sizes and hashes](addressing/sparse-size-results.json), and [independent audit](addressing/sparse-verification.json). A first Windows packaging attempt used the default text code page and rejected a Unicode JSON fixture; explicit UTF-8 fixed that harness issue. The model's initially discarded reverted alias was corrected and regression-tested. Neither issue is included as a successful sample. These are investigation fixtures, not a shipped producer, production schema validator or UI. No new application build or browser integration was claimed.
