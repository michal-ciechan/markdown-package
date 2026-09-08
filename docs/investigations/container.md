# CARD-0001: container envelope investigation

Status: investigation complete; a proposed envelope and executable evidence, not an implemented format. Checked on 2026-09-07. The [ZIP container decision](compression.md), [real packed `.git` history](history.md) and [section addressing](addressing.md) are accepted inputs; this card only settles how they occupy one byte layout.

**Verdict: the three accepted decisions fit one ordinary ZIP with no new container machinery.** The recommended envelope is a single ZIP whose first entry is a stored `.mdpkg/manifest.json`, followed by the current Markdown documents as ordinary entries, then the remaining `.mdpkg/` container metadata, then a curated `.git/` directory with its pack last. Two real example packages were assembled from the pinned corpora — **288,637 bytes for npm (91 entries) and 6,664,426 for Rust (658 entries)** — and a byte-accounting reader retrieves one document, and one section of it, in **6 requests / 10,369 bytes (npm) and 6 / 54,440 (Rust)**, touching **zero bytes of the `.git` tree and zero bytes of any other document**. A **79-byte read from offset 0** types the file or rejects it.

Four findings changed a choice rather than confirming one:

- **Drop the EOCD comment.** It is measured to *cost* the bounded-access property, not to help it. A 7-byte `MDPKG/1` comment defeats a reader's fixed 22-byte tail probe; the fallback 65,557-byte suffix then reads **57,797 bytes of the npm pack and 14,715 of the Rust pack** that the query never needed. Version discovery is already stronger and cheaper at offset 0. **§7 re-examines this for a fixed, spec-declared comment length** at the requester's ask: the tail-probe cost does disappear for a reader that honours the declared length, and the comment then saves 37 bytes and no extra requests per cold read — but it survives only two of five archive rewrites, so it cannot be authoritative and removes no reader tier. The recommendation stands.
- **The addressing override table is an ordinary tracked file, and therefore already a plain ZIP entry.** No mirror, no separate binding mechanism: the package's plain entries *are* the working tree of the manifest-declared commit, so `.mdpkg/address/overrides.json` appears there for the same reason `README.md` does. That is what makes a section reference resolvable without touching the pack.
- **Git reserves `.git` for you; it does not reserve `.mdpkg`.** `git fsck --strict` rejects a tree containing `.git/…` or `.GIT/…` (exit 2, nothing checked out), but accepts and checks out `.mdpkg/x.json` cleanly. The format must enforce its own prefix reservation.
- **The duplicated "current file view" from [history.md](history.md#ordinary-zip-browsing-is-a-separate-cost) is not dead weight — it is the working tree.** Extracting the package and running one plumbing command (`git read-tree HEAD`) yields an ordinary clean Git working tree: **83 / 650 tracked files, nothing modified or missing, one remaining untracked path (`.mdpkg/`, holding the two container-level files), `git fsck` clean, and `HEAD` equal to the manifest's `current`**.

Nothing in items 1–5 required inventing a mechanism ZIP already has. The one place the profile adds a rule rather than using a feature is entry *order*, because ZIP deliberately does not constrain it.

## The recommended envelope

```text
byte 0    PK\x03\x04  local header   .mdpkg/manifest.json      stored, no data descriptor
          ...........................  <current Markdown documents>   DEFLATE 6, or stored when smaller
          ...........................  .mdpkg/history.json        coverage descriptor
          ...........................  .mdpkg/address/overrides.json  (tracked; present only when non-empty)
          ...........................  .git/HEAD, .git/config, .git/refs/heads/main
          ...........................  .git/objects/pack/pack-<oid>.rev
          ...........................  .git/objects/pack/pack-<oid>.idx    stored
          ...........................  .git/objects/pack/pack-<oid>.pack   stored, last and largest
          PK\x01\x02  central directory (one record per entry)
          PK\x05\x06  EOCD, zero-length comment, at EOF
```

The `.rev` reverse index is what `git index-pack` produced; it is derivable and a producer may omit it. Measured region map of the npm example package:

<!-- LAYOUT_START -->

| Region, in file order | Entries | First byte | Last byte | Bytes |
| --- | --- | --- | --- | --- |
| manifest | 1 | 0 | 337 | 337 |
| markdown documents | 83 | 337 | 121,592 | 121,255 |
| container metadata | 1 | 121,592 | 121,891 | 299 |
| git repository files | 4 | 121,891 | 122,939 | 1,048 |
| git pack + index | 2 | 122,939 | 280,884 | 157,945 |
| central directory | 91 | 280,884 | 288,615 | 7,731 |
| EOCD (+ comment) | — | 288,615 | 288,637 | 22 |

<!-- LAYOUT_END -->

<!-- SIZES_START -->

| Corpus | Documents | Raw document bytes | ZIP entries | Manifest bytes | Package bytes | With an override ledger | Ledger records |
| --- | --- | --- | --- | --- | --- | --- | --- |
| npm | 83 | 287,267 | 91 | 287 | 288,637 | 292,648 | 29 of 564 |
| rust | 650 | 9,245,527 | 658 | 287 | 6,664,426 | 6,726,561 | 478 of 9,549 |

<!-- SIZES_END -->

The document count is the **tip** snapshot after the 32 retained first-parent updates, not CARD-0002's 83 / 633 base snapshot; Rust gains 17 documents over that range. These totals are within **1,004 / 1,020 bytes** of [history.md](history.md#ordinary-zip-browsing-is-a-separate-cost)'s `A + current files` rows (287,633 / 6,663,406), the difference being this card's larger manifest, the added `.mdpkg/history.json`, a non-bare `config` and a pack `.rev` file. They are complete archives, including every local and central header, name, CRC and the EOCD. The override-ledger column carries a sized placeholder with CARD-0004's record shape at a 5% exception rate; it exercises the read path and is not a re-derivation of that card's semantics.

## 1. The manifest

`.mdpkg/manifest.json` is the first ZIP entry, **stored**, with no data descriptor, and its content is canonical UTF-8 JSON. The `mdpkg` key is written first so a fixed-offset read reaches it (§5). Every other key is emitted in sorted order.

The `addressing` object below is the fixture as measured and is superseded: spec.md D-1 (C6) replaced `coverage: confirmed` with `complete | partial`, and D-2 (C7) added the required `anchor` and `digest` fields. spec.md §4 has the current shape; the byte figures in this document predate both.

```json
{"mdpkg":"markdown-package/1","addressing":{"coverage":"confirmed","overrides":null},
 "current":"sha1-5c3e0ffdc40df11a74024b12ee97c9d15afad99b",
 "history":{"coverage":"truncated","detail":".mdpkg/history.json","transform":["projected"]},
 "namespace":"5cf1f1c1-6a5e-4a2a-9d3e-0b7f2e1c4a80"}
```

That is **287 bytes on both corpora** — the manifest is O(1) in package size by construction. A field earns its place only if a reader needs it *before it can do anything else*, it must be readable with no decompressor, and it does not grow with the package.

| Field | Why it is in the manifest |
| --- | --- |
| `mdpkg` | Format magic and version in one token. It is the dispatch key and the only authoritative version (§5). Written first so it lands at a fixed offset. |
| `namespace` | CARD-0004 keys every external review by package lineage. A reader must reject a reference from a foreign namespace before resolving anything, so this cannot live behind a decompressor or inside the pack. |
| `current` | The commit whose working tree the plain ZIP entries mirror. Without it the plain document entries are unbound: a reader could not tell a stale mirror from a fresh one, and resolving `refs/heads/main` instead would require reading the `.git` tree — which is exactly what §4 must avoid. Qualified as `sha1-…` / `sha256-…`, per CARD-0004, so no separate `objectFormat` field is needed. |
| `addressing.coverage` | CARD-0004 is explicit that *"the absence of an override file"* is not proof that no identity-changing operation occurred. Absence must therefore be **declared**, not inferred. `confirmed` / `best-effort` / `none` selects between that card's confirmed-exception contract and its zero-metadata best-effort contract. |
| `addressing.overrides` | The entry name of the override ledger, or `null`. A reader learns in the same read whether a section resolution needs a second entry, and `null` is a positive statement that there are no exceptions. |
| `history.coverage`, `history.transform` | CARD-0003 requires that a package never present a synthetic root as complete upstream history. A one-word disclosure belongs where it cannot be missed; a reader that ignores `.mdpkg/history.json` still cannot claim the history is complete. |
| `history.detail` | Pointer to the unbounded part. Boundary lists, source ranges and nested squash bindings grow with history, so they must not be in an O(1) manifest. |

Rejected fields, each with its measured cost on the two corpora:

<!-- MANIFEST_START -->

| Manifest content | npm bytes | Rust bytes |
| --- | --- | --- |
| minimal (magic, namespace, current commit) | 140 | 140 |
| recommended (adds addressing + history coverage) | 287 | 287 |
| + codec declaration already in the central directory | 329 | 329 |
| + document index already in the central directory | 3,814 | 22,515 |
| + per-document SHA-256 already bound by the tip tree | 9,373 | 66,063 |

<!-- MANIFEST_END -->

- **No codec/compression id.** Every entry's method is a 16-bit field in its central-directory record, already readable without decompressing anything ([compression.md](compression.md#what-can-be-read-without-decompression)). A manifest codec list would be a second, non-authoritative copy of per-entry state. The format version fixes the *permitted* set — methods 0 and 8 only — and a reader rejects anything else from the directory record it already has. This is the clearest case of ZIP supplying the field.
- **No document index.** The central directory is a complete name-to-extent index. A duplicate costs 3,814 / 22,515 bytes and can disagree with the archive.
- **No per-document digests.** 9,373 / 66,063 bytes to restate what the tip tree's blob object IDs already bind, and ZIP's per-entry CRC32 already detects accidental corruption. Content integrity beyond that is the Git object model's job, not the envelope's.
- **No entry count, offsets or sizes.** EOCD and the central directory.
- **No package self-hash.** A document cannot contain its own container's digest; delivery identity belongs to the transport.

**The EOCD comment is not authoritative, and the recommendation is to omit it entirely.** [compression.md](compression.md#version-placement-and-archive-rewrites) established the comment is lost by three of five rewrite operations while the manifest entry's content survived all five; this card re-measured the same asymmetry on the real package (§5) and adds a cost the earlier work flagged but did not price: a comment breaks fixed-tail discovery. See §4. If a producer emits one anyway, it is a **hint** — a reader that finds a comment version disagreeing with the manifest must reject the package, never prefer the comment, and never infer version 1 from the mere presence of `PK`. The fixed-length form of that hint is measured in §7.

## 2. Where the addressing exception table lives

**Decision: the sparse override ledger is an ordinary Git-tracked file at `.mdpkg/address/overrides.json`, and therefore appears in the archive as an ordinary ZIP entry with that exact name. There is no separate copy, mirror or binding record.**

The three candidates in the brief resolve as follows.

| Candidate | Outcome |
| --- | --- |
| Inside the manifest | Rejected. The ledger is not O(1): the measured 5% fixture is 4,640 / 73,838 raw bytes, and CARD-0004 measured 7,807 / 80,602 for its own 5% ledger and 31,771 / 319,674 at 20%. Putting it in a mandatory stored first entry would make the typing read and every version probe pay for it. |
| A sibling `.mdpkg/` container entry, untracked | Rejected. It would exist only for the current snapshot. CARD-0004 requires historical locators to travel with the snapshot they describe, and requires the ledger to survive squash and truncation as retained data. An untracked sidecar has no history. |
| Tracked in the Git tree | **Adopted.** It is versioned with the documents it addresses, reachable at any retained commit, and copied into a retained endpoint by an ordinary squash — exactly CARD-0004's stated requirement. |

The apparent tension — a tracked file is inside the pack, and §4 requires section resolution without touching the pack — dissolves because **the package's plain ZIP entries are the working tree of `current`**. `.mdpkg/address/overrides.json` is checked out for the same reason every `.md` file is. Nothing extra is specified, and the invariant is machine-checkable: *plain entries = worktree(`current`) ∪ `.git/**` ∪ the declared container-level entries*. The build asserts the tip tree equals the shipped document set on every package.

A reader finds it in one step, without walking the archive: the manifest names it (`addressing.overrides`), and the name resolves against the already-fetched central directory. Measured, a section read on the ledger-bearing packages costs **8 requests / 12,312 bytes (npm) and 8 / 85,447 (Rust)** — two requests and one entry more than the ledger-free package, still with zero `.git` bytes touched.

Consistency between the ZIP entry and the tracked blob needs no new field. The manifest binds `current`; the entry's bytes either hash to the blob that commit's tree names, or the package is malformed. A reader that has already decided to trust the plain-entry view does not need to open the pack to use the ledger; a validator that wants proof can check it in the pack it was going to read anyway.

Two container-level entries are deliberately **not** tracked, and this asymmetry is stated rather than hidden:

- `.mdpkg/manifest.json` names `current`, and a commit's own object ID cannot appear inside the tree it commits. CARD-0004 hit the same ordering problem with squash bindings.
- `.mdpkg/history.json` binds emitted commit identities for the same reason.

Both appear as untracked files after extraction, which is exactly what the extraction check reports (§4). CARD-0004's archived evidence entries (`.mdpkg/history/ranges/<sha256>.json`, `.mdpkg/history/patches/<sha256>.patch`) belong in the same untracked container region, listed in `.mdpkg/history.json`; they are not priced here, and the earlier card's measurements for them still apply.

## 3. Entry layout, paths, case and Unicode

### Order

Entry order is a profile rule because ZIP does not constrain it. Three constraints fix it:

1. The manifest is first, at offset 0, so typing is a fixed-offset read (§5).
2. The single largest member — the pack — is last, so one contiguous range covers everything else.
3. Everything a document or section read can need sits before the pack.

<!-- VARIANTS_START -->

| Layout variant | npm bytes | Rust bytes | Typing read | npm no-.git span | Rust no-.git span |
| --- | --- | --- | --- | --- | --- |
| recommended: manifest, documents, metadata, .git; no comment | 288,637 | 6,664,426 | 79 | 129,644 | 3,351,865 |
| same order with a 7-byte MDPKG/1 EOCD comment | 288,644 | 6,664,433 | 79 | 129,651 | 3,351,872 |
| same order with the fixed 8-byte binary EOCD comment | 288,645 | 6,664,434 | 79 | 129,652 | 3,351,873 |
| documents under a content/ prefix | 289,965 | 6,674,826 | 79 | 130,972 | 3,362,265 |
| .git first, documents last | 288,637 | 6,664,426 | 79 | 288,637 | 6,664,426 |
| manifest last (nonconforming) | 288,637 | 6,664,426 | directory walk | 288,637 | 6,664,426 |
| streamed write, data descriptors (nonconforming) | 290,096 | 6,674,956 | directory walk | 130,988 | 3,362,281 |

<!-- VARIANTS_END -->

"No-`.git` span" is one contiguous range covering every non-`.git` entry, plus the directory and EOCD: what a reader fetches to obtain the whole browsable document set and all container metadata without the pack. Ordering costs nothing in bytes and is worth **158,993 npm / 3,312,561 Rust** bytes of avoided transfer. Putting `.git` first forfeits all of it.

### The reserved prefix, and why the format must enforce it itself

`.mdpkg/` and `.git/` are reserved: no content path may begin with either. `.git/` is reserved by Git, but only Git's own porcelain and integrity checks enforce it — and `.mdpkg/` is reserved by nobody.

<!-- GITPATHS_START -->

| Case | Path | update-index accepts | git fsck --strict | Files after checkout-index on NTFS |
| --- | --- | --- | --- | --- |
| README.md vs readme.md | readme.md | yes | accepts | readme.md |
| reserved .git/ path | .git/hooks/x | yes | rejects (exit 2) | nothing written |
| reserved .GIT/ path | .GIT/hooks/x | yes | rejects (exit 2) | nothing written |
| unreserved .mdpkg/ path | .mdpkg/x.json | yes | accepts | .mdpkg/x.json |
| checkout of both case variants on NTFS | README.md + readme.md | yes | n/a | readme.md |

<!-- GITPATHS_END -->

Git's plumbing `update-index` accepts every one of these paths; the protection lives in `fsck` and checkout, and it covers `.git` and `.GIT` but not `.mdpkg`. So a producer that imports an arbitrary source repository containing a real `.mdpkg/` directory will silently produce a package whose content collides with its own metadata. **A conforming producer must reject such a source, or relocate the colliding paths and declare that it did.** Neither corpus hits it: **0 of 83 and 0 of 650** document paths start with a reserved prefix.

The alternative — prefixing all content, e.g. `content/` — was measured and rejected: **+1,328 npm / +10,400 Rust bytes** (8 characters, in both the local and central header of every entry), it makes the extracted directory stop being a Git working tree at its natural paths, and it does not remove the need for a reserved region anyway.

### Path normalization, case and Unicode

The package's canonical path for a document is **the exact byte sequence Git records in the tip tree**, and the ZIP entry name is those same bytes. Git treats paths as bytes and is case-sensitive; ZIP entry names have no case or normalization rules at all. Extraction is where they meet real filesystems, so the rules belong to the producer:

- **Separator:** forward slash only, no leading slash, no `.` or `..` component, no drive letter, no backslash. A backslash is not a ZIP separator, yet every tested extractor treats it as one: an `a\b.md` entry lands as `a/b.md` in all four, so a producer that emitted a legal Git path containing a backslash would silently create a directory.
- **Encoding:** UTF-8, with general-purpose bit 11 set whenever a name is not pure ASCII (Python's writer does this automatically). A single non-ASCII name round-tripped intact through all four extractors.
- **Uniqueness:** entry names must be **unique under Unicode NFC followed by simple case folding**. This is stricter than Git, and deliberately so. The specification adopts this as a decided default (D-16 in spec.md §10), not an open question: only its verification against a real normalization-insensitive filesystem remains open (spec.md §11.1).

<!-- PATHS_START -->

| Fixture | ZIP entries | Python zipfile | 7-Zip | Info-ZIP unzip | Windows Explorer |
| --- | --- | --- | --- | --- | --- |
| case-pair | 2 | 1 file(s), content lost | 1 file(s), content lost | 1 file(s), content lost | 1 file(s), content lost |
| unicode-nfc-nfd | 2 | 2 file(s), all preserved | 2 file(s), all preserved | 2 file(s), all preserved | 2 file(s), all preserved |
| non-ascii-single | 1 | 1 file(s), all preserved | 1 file(s), all preserved | 1 file(s), all preserved | 1 file(s), all preserved |
| backslash-in-name | 1 | 1 file(s), content lost | 1 file(s), content lost | 1 file(s), content lost | 1 file(s), content lost |

<!-- PATHS_END -->

`README.md` plus `readme.md` is a valid Git tree — `fsck` accepts it — but **every tested extractor, and Git's own checkout on NTFS, keeps only one of the two**, with no error. That is silent data loss inside a format whose whole point is stable references to document sections, so the constraint is a producer requirement, not a warning. The NFC/NFD pair survived on this Windows host; it is included because a normalization-insensitive filesystem would collide it exactly as the case pair collides here, and **no macOS run was available** — the NFC rule is adopted from that documented risk, not from a local failure. Neither corpus violates either rule: **0 collisions across 733 paths, all pure ASCII, all already NFC.**

Nothing else is normalized at the container level beyond the one EOL rule the format defines (spec.md D-17): a conforming producer normalizes CRLF and lone CR to LF before storing content, so document *content* keeps the producer's exact bytes only in the sense that ZIP entry payloads and Git blobs alike hold that already-normalized, LF-only source. CARD-0004's `cm0312-source-lf-v1` digest profile then normalizes CRLF and lone CR to LF again when decoding for hashing (a no-op on conforming stored content), so the rule is applied at write time and not only at digest time. That scope is the current view as defined (§2 of spec.md): Markdown documents and the JSON control files under `.mdpkg/`, all UTF-8 text. This format has no mechanism for tracking an opaque or binary current-view entry, so D-17 needs no binary-detection step to decide what to leave alone — there is nothing else in scope to leave alone.

### ZIP64

Both example packages are far below the 4 GiB / 65,535-entry classic limits, and the reader explicitly rejects ZIP64 sentinels rather than pretending to handle them. The profile should state a ZIP64 policy — permitted with mandatory locator handling, or excluded — before any package can exceed those limits. [compression.md](compression.md#what-can-be-read-without-decompression) documents the locator walk that support would require.

## 4. Single file versus directory, and streamability

**Decision: one file for exchange. The directory form is not a competing design — it is the extraction, and it is defined to be an ordinary Git working tree.**

A single file is what makes everything else work: EOCD-anchored random access, one HTTP range target, atomic replacement, one digest, manifest-first typing, and a defined entry order. A directory has no central directory, no order, no atomic swap and no single identity; every property this card measures would have to be re-specified against a filesystem. The compensating advantage of a directory — cheap local random access and in-place editing — is exactly what the extracted form provides.

<!-- EXTRACT_START -->

| Extracted package | ZIP entries | Tracked files | status lines before read-tree | after read-tree | Remaining untracked | .git/index bytes if it were shipped | fsck |
| --- | --- | --- | --- | --- | --- | --- | --- |
| npm | 91 | 83 | 85 | 1 | .mdpkg/history.json, .mdpkg/manifest.json | 9,043 | clean |
| rust | 658 | 650 | 652 | 1 | .mdpkg/history.json, .mdpkg/manifest.json | 63,610 | clean |

<!-- EXTRACT_END -->

The package ships **no `.git/index`**, so an untouched extraction reports every file as untracked. One plumbing call, `git read-tree HEAD`, rebuilds it, after which the working tree is clean except the two untracked container-level files, `git fsck --full --strict` passes, and `HEAD` equals the manifest's `current`. Shipping the index instead would cost **9,043 / 63,610 raw bytes** to save that one command, and an index binds host-specific stat data; the recommendation is to keep omitting it and document the command. The package ships `core.bare = false` so the extraction is a working tree rather than a bare repository.

Neither step touches content bytes: a ZIP unpack writes the entry payload verbatim, and `git read-tree` only builds an index from the tree already on disk. Nothing here plays the role of Git's `core.autocrlf` smudge filter on checkout, and the package ships no `.gitattributes` to configure one, so the extracted files are exactly the LF-normalized bytes D-17 stored — on Windows as much as anywhere else (spec.md D-18). That is `core.autocrlf=input` behavior (normalize on the way in, do nothing on the way out), not `core.autocrlf=true` (also convert to CRLF on checkout). The alternative was not measured because it does not exist for this container as specified: platform-native checkout is a filter Git itself only applies through configuration this format does not ship, and adding one would cost the extracted file's one useful property — that it is the tracked blob byte for byte, so a reader can hash it under CARD-0004's profile without first undoing what checkout did to it.

### Streamability

Two different claims must not be merged.

- **Streaming production is permitted but constrained.** A producer that cannot seek must use data descriptors (general-purpose bit 3), which write zero into the local header's size and CRC fields. Measured on the npm package that costs **1,459 bytes** — roughly a 16-byte descriptor per entry — and, more importantly, **destroys the offset-0 typing path**: the reader rejects the streamed package with *"first entry uses a data descriptor"*. The profile therefore requires the **manifest entry** to carry true sizes in its local header with bit 3 clear. Producers must buffer that one small stored entry; everything after it may stream.
- **Streaming consumption is not a supported read mode.** Local headers are advisory: ZIP permits them to disagree with the central directory, and the streamed variant proves they can be empty. Readers must treat the central directory as authoritative and take entry extents from it. Sequential local-header scanning is a recovery technique, not a conforming read.

### Bounded access is preserved, and measured

The requirement is a walk of EOCD → central directory → one entry, for a document *and* for a section, without touching the `.git` tree or any other document. The reader records every byte range it fetches and intersects them with the exact measured extents of all `.git/**` entries and all other `.md` entries.

<!-- ACCESS_START -->

| Package / initial tail request | Read | Requests | Bytes read | Payload bytes | .git bytes touched | Other-document bytes |
| --- | --- | --- | --- | --- | --- | --- |
| npm: no comment, 22-byte start | document | 6 | 10,369 | 6,101 | 0 | 0 |
| npm: no comment, 22-byte start | section | 6 | 10,369 | 981 | 0 | 0 |
| npm: override ledger, 22-byte start | document | 8 | 12,312 | 6,101 | 0 | 0 |
| npm: override ledger, 22-byte start | section | 8 | 12,312 | 981 | 0 | 0 |
| npm: 7-byte EOCD comment, naive 22-byte start | document | 6 | 68,195 | 6,101 | 57,797 | 0 |
| npm: 7-byte EOCD comment, naive 22-byte start | section | 6 | 68,195 | 981 | 57,797 | 0 |
| npm: 7-byte EOCD comment, profile-aware 29-byte start | document | 6 | 10,376 | 6,101 | 0 | 0 |
| npm: 7-byte EOCD comment, profile-aware 29-byte start | section | 6 | 10,376 | 981 | 0 | 0 |
| npm: fixed 8-byte comment, naive 22-byte start | document | 6 | 68,195 | 6,101 | 57,796 | 0 |
| npm: fixed 8-byte comment, naive 22-byte start | section | 6 | 68,195 | 981 | 57,796 | 0 |
| npm: fixed 8-byte comment, profile 34-byte window | document | 6 | 10,381 | 6,101 | 0 | 0 |
| npm: fixed 8-byte comment, profile 34-byte window | section | 6 | 10,381 | 981 | 0 | 0 |
| npm: fixed 8-byte comment, typed from the tail | document | 6 | 10,332 | 6,101 | 0 | 0 |
| npm: fixed 8-byte comment, typed from the tail | section | 6 | 10,332 | 981 | 0 | 0 |
| rust: no comment, 22-byte start | document | 6 | 54,440 | 8,057 | 0 | 0 |
| rust: no comment, 22-byte start | section | 6 | 54,440 | 2,053 | 0 | 0 |
| rust: override ledger, 22-byte start | document | 8 | 85,447 | 8,057 | 0 | 0 |
| rust: override ledger, 22-byte start | section | 8 | 85,447 | 2,053 | 0 | 0 |
| rust: 7-byte EOCD comment, naive 22-byte start | document | 6 | 69,184 | 8,057 | 14,715 | 0 |
| rust: 7-byte EOCD comment, naive 22-byte start | section | 6 | 69,184 | 2,053 | 14,715 | 0 |
| rust: 7-byte EOCD comment, profile-aware 29-byte start | document | 6 | 54,447 | 8,057 | 0 | 0 |
| rust: 7-byte EOCD comment, profile-aware 29-byte start | section | 6 | 54,447 | 2,053 | 0 | 0 |
| rust: fixed 8-byte comment, naive 22-byte start | document | 6 | 69,184 | 8,057 | 14,714 | 0 |
| rust: fixed 8-byte comment, naive 22-byte start | section | 6 | 69,184 | 2,053 | 14,714 | 0 |
| rust: fixed 8-byte comment, profile 34-byte window | document | 6 | 54,452 | 8,057 | 0 | 0 |
| rust: fixed 8-byte comment, profile 34-byte window | section | 6 | 54,452 | 2,053 | 0 | 0 |
| rust: fixed 8-byte comment, typed from the tail | document | 6 | 54,403 | 8,057 | 0 | 0 |
| rust: fixed 8-byte comment, typed from the tail | section | 6 | 54,403 | 2,053 | 0 | 0 |

<!-- ACCESS_END -->

The npm walk is: 79 bytes at offset 0 (type), 287 bytes (manifest), 22 bytes (EOCD), 7,731 bytes (central directory), 30 bytes (local header), 2,220 bytes (the DEFLATE member). Section and document cost identically, confirming [compression.md](compression.md#one-document-and-one-section-card-0004)'s finding that a section read is a whole-document entry read plus parsing; the container adds nothing to it. A repeat query on a warm reader fetches **0 further bytes**. Rust's larger figure is almost entirely its 50,813-byte central directory, which a reader caches once per package.

**The EOCD comment rows are the counterexample that decides §1.** A reader that probes the fixed 22-byte tail cannot find the EOCD when a comment is present, falls back to the conservative 65,557-byte suffix that [compression.md](compression.md#tail-only-js-and-real-http-ranges) specified, and that suffix runs straight into the pack: 57,797 npm and 14,715 Rust bytes of `.git` payload fetched for a query that needed none of it. A reader that knows the profile's exact comment length can start at 29 bytes and stay clean — but that only recovers what omitting the comment gives for free. The comment is not free, is not authoritative, and is dropped. §7 measures the fixed-length form of the same idea, whose profile window is 34 bytes: the damage to a naive reader is unchanged (57,796 npm and 14,714 Rust `.git` bytes) and a profile-aware reader gains 37 bytes.

## 5. Magic bytes and file typing

**Decision: no bytes outside ZIP. Typing is `PK\x03\x04` at offset 0, plus a required first-entry name, plus a required magic member at the head of the manifest. One 79-byte read decides.**

[compression.md](compression.md#raw-prefix-compatibility-actual-tools) showed a raw prefix before `PK` is technically viable with corrected offsets but survives no rewrite and breaks two of five tested readers when offsets are stale. The manifest-first requirement supplies the same dispatch without leaving the ZIP grammar. The check is:

| Offset | Length | Required value |
| --- | --- | --- |
| 0 | 4 | `50 4B 03 04` — local file header signature |
| 6 | 2 | general-purpose flags with bit 3 clear (no data descriptor) |
| 8 | 2 | compression method `0` (stored) |
| 26 | 2 | file name length `20` |
| 30 | 20 | `.mdpkg/manifest.json` |
| 50 + extra | 29 | `{"mdpkg":"markdown-package/1"` |

Requiring the manifest as the first entry is **necessary but not sufficient**: without the in-manifest magic, any ZIP whose first entry happened to be a stored file of that name would type as a package, and a reader would have to parse the whole JSON before discovering the version. The magic member costs 29 bytes of the manifest it was going to read anyway, gives a stable version token at a fixed offset, and makes the version unambiguous when the JSON is otherwise unrecognizable.

<!-- TYPING_START -->

| Input | Input bytes | Accepted | Bytes read to decide | Rejection reason | Central-directory fallback |
| --- | --- | --- | --- | --- | --- |
| valid package | 288,637 | yes | 79 | — | — |
| random bytes | 4,096 | no | 79 | no local file header signature at offset 0 | no readable central directory |
| empty file | 0 | no | 0 | shorter than the fixed manifest header | no readable central directory |
| plain ZIP, first entry is not the manifest | 7,928 | no | 79 | first entry name length differs | no manifest entry |
| manifest present but not first | 288,637 | no | 79 | first entry name length differs | manifest found in the central directory |
| streamed write, data descriptors | 290,096 | no | 79 | first entry uses a data descriptor | manifest found in the central directory |
| truncated to 40 bytes | 40 | no | 40 | shorter than the fixed manifest header | no readable central directory |

<!-- TYPING_END -->

Every rejection costs at most 79 bytes and never walks the central directory. The fallback column matters because ordinary archive tools do not preserve entry order:

<!-- REWRITE_START -->

| Operation | Still opens | Manifest bytes preserved | First entry | Manifest stored | Offset-0 typing still works |
| --- | --- | --- | --- | --- | --- |
| as produced | yes | yes | .mdpkg/manifest.json | yes | yes |
| Python rebuild by filename and bytes | yes | yes | .mdpkg/manifest.json | yes | yes |
| 7-Zip a (add one file), exit 0 | yes | yes | .git/config | yes | no |
| PowerShell Compress-Archive of the extraction, exit 0 | yes | yes | .git/objects/ | no | no |
| fflate unzipSync then zipSync | yes | yes | .mdpkg/manifest.json | no | no |

<!-- REWRITE_END -->

**The manifest's bytes survived all five operations; the fast path survived two.** 7-Zip reordered entries, `Compress-Archive` reordered *and* compressed the manifest, and fflate kept the order but re-compressed it — reproducing CARD-0002's fflate observation on this package. So the reader must be specified in two tiers: a **conforming** package types at offset 0 in 79 bytes, and a package that fails that check is **recoverable** if the central directory contains a `.mdpkg/manifest.json` entry that decodes to valid manifest bytes. A recovered package should be re-emitted in conforming form rather than treated as valid; a repacked archive preserving payload bytes is not a format-preserving package rewrite. §7.3 runs the same five operations against an EOCD comment and finds it survives two of them — a different two.

An extension (`.mdpkg`) and a media type (`application/vnd.…+zip`, unregistered here) are worth specifying for dispatch, but neither is evidence: the leading `PK` must stay so ordinary ZIP tools keep working, which means extension- and sniffer-based dispatch will sometimes see a generic ZIP. That is the accepted cost of adopting ZIP.

## 6. Adopt versus invent

Nothing in §§1–5 forced a mechanism ZIP lacks.

| Need | Supplied by | Container invented anything? |
| --- | --- | --- |
| Per-entry compression codec | Central-directory method field, readable with no decompressor | No |
| Entry extents, decoded lengths | Central-directory sizes and local offsets | No |
| Name-to-entry index | Central directory | No |
| Accidental-corruption detection | Per-entry CRC32 | No |
| Random access to one entry | EOCD → central directory → local header | No |
| Version and format identity | First stored entry's content, plus its own PK signature | No — but the *first-entry* rule is a profile constraint, not a ZIP feature |
| Metadata namespace separation | Entry names only | No, but the reservation must be enforced by the producer (§3) |
| Content integrity and history identity | Git object IDs inside the packaged repository | No |
| Ordering guarantees | — | **Yes: a profile rule.** ZIP deliberately permits any order, and the rewrite table shows real tools reorder. |
| Atomic in-place update | — | Not attempted. Rewrite the file. |
| >4 GiB / >65,535 entries | ZIP64, explicitly out of the tested profile | Deferred, not invented |

Two honest gaps, neither requiring a new container. First, ZIP has no way to *mark* an entry as metadata, so the reservation is by name and must be producer-enforced — measured above, because Git will not do it for you. Second, ZIP guarantees nothing about order, so the manifest-first rule survives production but not arbitrary repacking; §5's two-tier reader is the answer, and it is cheaper than any custom container that would have had to abandon ordinary ZIP tooling to get it.

## 7. Follow-up: a fixed-length EOCD comment carrying the version

§1 dropped the archive comment on evidence gathered against a *variable-length* one. This section re-runs the question for a **mandatory, spec-declared, fixed-length** comment whose first byte is the format version, with the escalating overflow rule from the original CARD-0001 version-prefix proposal scoped to that field. Everything below is measured on the same two packages; nothing in §§1–6 changed as a result.

**Answer, in one line: a declared length does remove the tail-probe cost for a reader that honours it, and the comment then saves 37 bytes and no extra requests per cold read — but it survives only two of five archive rewrites, so it cannot be authoritative, cannot remove a reader tier, and is not recommended.**

### 7.1 The byte layout

The measured comment is 8 bytes, `4d 44 50 4b 47 01 00 00`:

| Offset | Bytes | Field | Value |
| --- | --- | --- | --- |
| 0 | 5 | tag | `MDPKG`, ASCII, no separator |
| 5 | 1–7 | version field | escalating, little-endian, see below |
| 5 + width | rest | reserved padding | `0x00`, must be zero, rejected otherwise |

The version field is the requested rule: one byte; the maximum byte value `0xFF` escapes to the next 2 bytes read as `uint16` LE; `0xFFFF` there escapes to the next 4 bytes as `uint32` LE. Little-endian matches every multi-byte field ZIP already defines, so a parser sitting on an EOCD needs no second convention.

<!-- COMMENTTIERS_START -->

| Tier | Field bytes | Comment bytes | First version | Last version | Versions | First encoding | Last encoding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 6 | 0 | 254 | 255 | `00` | `fe` |
| 1 | 3 | 8 | 255 | 65,789 | 65,535 | `ff0000` | `fffeff` |
| 2 | 7 | 12 | 65,790 | 4,295,033,084 | 4,294,967,295 | `ffffff00000000` | `fffffffeffffff` |

<!-- COMMENTTIERS_END -->

Each tier is **biased** by the count of everything the shorter tiers encode — tier 1 starts at 255, tier 2 at 65,790 — so every version has exactly one legal encoding. Without the bias, versions 0–254 would each have three encodings, and comparing two packages' comment bytes would stop being the same thing as comparing their versions. This is precisely UTF-8's non-overlong rule; LEB128 and protobuf varints leave the same redundancy open and simply tolerate it.

The tension the fixed-length requirement creates is real and unavoidable: **an escalating field cannot have a fixed width, so "fixed-length comment" and "escalating version field" are compatible only if the escalation room is pre-allocated.** Reserving tier 1's room makes the comment a constant 8 bytes for every version through 65,789, and 12 once tier 2 is in use, which is why a conforming reader reads the last `22 + 12 = 34` bytes rather than one exact length. Bounded, not fixed, is the property that actually buys anything.

Against the prior art, and against simply declaring the field a fixed-width integer in the same comment:

<!-- PRIORART_START -->

| Version value, or whole-field alternative | Field bytes | LEB128 | UTF-8 | protobuf varint |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 1 | 1 |
| 127 | 1 | 1 | 1 | 1 |
| 128 | 1 | 2 | 2 | 2 |
| 254 | 1 | 2 | 2 | 2 |
| 255 | 3 | 2 | 2 | 2 |
| 65,535 | 3 | 3 | 3 | 3 |
| 65,790 | 7 | 3 | 4 | 3 |
| 1,048,576 | 7 | 3 | 4 | 3 |
| plain uint8 field, whole range to 255 | 1 | — | — | — |
| plain uint16 LE field, whole range to 65,535 | 2 | — | — | — |
| plain uint32 LE field, whole range to 4,294,967,295 | 4 | — | — | — |

<!-- PRIORART_END -->

The escalating field is one byte for versions 128–254 where LEB128 and UTF-8 both need two — and then loses, needing 3 bytes at version 255 where LEB128 needs 2, and 7 at 65,790 where LEB128 needs 3. That trade only pays in a stream where short values are common and the length is discovered by reading. **Inside a comment whose room is pre-allocated anyway, it pays nothing**: a plain `uint32` LE makes the comment 9 bytes and covers 4,294,967,296 versions, where the escalating field needs 12 bytes to cover 4,295,033,085 — three more bytes and two extra parser states for 0.0015% more range. If a fixed-length comment is adopted, the escalation rule should not come with it.

### 7.2 Does a declared length remove the tail-probe cost?

Partly, and not because it is *fixed*. Two rows in §4's access table decide it — the same package and the same reader, differing only in whether the reader honours the declared length.

A reader that starts from the profile's 34-byte window is clean: **10,381 bytes for npm and 54,452 for Rust**, against a no-comment baseline of 10,369 / 54,440, the 12-byte difference being the window itself. A reader that starts from the fixed 22-byte tail probe still fails to find the EOCD, still falls back to the conservative 65,557-byte suffix, and still reads **57,796 bytes of the npm pack and 14,714 of the Rust pack**. That is within one byte of the variable-length comment's measured damage. **Making the length fixed does nothing for a reader that does not know the length; the property that helps is that the length is declared at all, which §4's 29-byte row already showed for the variable comment.**

What the fixed comment adds over that is genuine but small. Because the tag and version sit inside the tail read a bounded reader must make anyway, typing can come out of it instead of out of a separate read at offset 0:

<!-- VERSIONPROBE_START -->

| Corpus | Package | Route | Decides | Version | Requests | Bytes read | Why not |
| --- | --- | --- | --- | --- | --- | --- | --- |
| npm | no comment | tail comment, 34-byte window | no | — | 1 | 34 | no archive comment |
| npm | no comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |
| npm | variable 7-byte ASCII comment | tail comment, 34-byte window | no | — | 1 | 34 | reserved padding is not zero |
| npm | variable 7-byte ASCII comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |
| npm | fixed 8-byte binary comment | tail comment, 34-byte window | yes | 1 | 1 | 34 | — |
| npm | fixed 8-byte binary comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |
| rust | no comment | tail comment, 34-byte window | no | — | 1 | 34 | no archive comment |
| rust | no comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |
| rust | variable 7-byte ASCII comment | tail comment, 34-byte window | no | — | 1 | 34 | reserved padding is not zero |
| rust | variable 7-byte ASCII comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |
| rust | fixed 8-byte binary comment | tail comment, 34-byte window | yes | 1 | 1 | 34 | — |
| rust | fixed 8-byte binary comment | offset 0 manifest header, 79 bytes | yes | 1 | 1 | 79 | — |

<!-- VERSIONPROBE_END -->

A version-only decision costs **34 bytes from the tail against 79 at offset 0**, one request either way. Folded into a full document-and-section read, the saving is **37 bytes and zero requests**: 10,332 against 10,369 for npm and 54,403 against 54,440 for Rust, both still 6 requests, both still touching zero `.git` and zero other-document bytes. The comment adds 8 bytes to the archive, so a package pays for itself after roughly one cold read.

The table also records that the two comment forms are mutually unreadable: the fixed reader rejects the earlier `MDPKG/1` ASCII comment (`/` decodes as version 47, and `1` is a non-zero byte in reserved padding) and rejects a comment-free package outright. A comment format is a one-way door in a way the manifest is not.

### 7.3 Rewrite survival — the crux

The same five operations §5 ran against entry order, run against the fixed comment, with each route to a version priced on the rewritten archive:

<!-- COMMENTREWRITE_START -->

| Operation | Comment bytes after | Outcome | 34-byte tail route | 79-byte offset-0 route | Recoverable directory walk |
| --- | --- | --- | --- | --- | --- |
| as produced | 8 | preserved unmodified | 34 B | 79 B | 7,753 B |
| Python rebuild by filename and bytes | 0 | stripped | unavailable | 79 B | 7,753 B |
| 7-Zip a (add one file), exit 0 | 8 | preserved unmodified | 34 B | unavailable | 7,852 B |
| PowerShell Compress-Archive of the extraction, exit 0 | 0 | stripped | unavailable | unavailable | 7,986 B |
| fflate unzipSync then zipSync | 0 | stripped | unavailable | unavailable | 7,753 B |

<!-- COMMENTREWRITE_END -->

**The comment survived two of five operations unmodified, was stripped by three, and was never replaced with a foreign comment.** That is the same score entry order got, and worse than the manifest entry's content, which survived all five. No tool rewrote the comment into something else, so a reader never has to arbitrate between two live version claims — it only ever has the comment or nothing.

The failures are not the same failures, which is the one interesting result here. Python's rebuild preserves manifest-first order and strips the comment; 7-Zip's add preserves the comment and breaks manifest-first order. So the comment does rescue exactly one of the five cases from the recoverable central-directory walk — **34 bytes instead of 7,852 for the 7-Zip output, a factor of 231**. But `Compress-Archive` and fflate destroy both cheap routes, leaving the directory walk (7,986 and 7,753 bytes) as the only way in. Adding the comment therefore takes the number of rewrites with a cheap typing route from two of five to three of five; it does not take it to five, and it does not let a reader stop implementing the recoverable tier.

### 7.4 Authority, and whether it is worth the bytes

It cannot be authoritative. Three of five ordinary rewrites remove it, so a reader that treated a missing comment as "not a markdown-package" would reject packages whose every byte of content is intact — and a reader that does not treat it that way has, by construction, made it a hint. The manifest stays the single source of truth on the same evidence as §1: its bytes survived all five operations, and it is reachable through the central directory in every one of them.

Given that, the ledger for adding it:

| For | Against |
| --- | --- |
| 37 bytes and 0 extra requests per cold document read (0.36% of the npm read, 0.07% of the Rust read) | +8 bytes on every package |
| 34-byte instead of 79-byte version-only probe | A second version location that is absent from 3 of 5 real round trips |
| 34 bytes instead of 7,852 for one of the five rewritten archives | The recoverable central-directory tier stays mandatory, so no reader gets simpler |
| One tail read serves typing, version and the central directory | A tag check, a tier decoder and a padding validator — which must also reject the format's own earlier comment form |
| | A reader that ignores the declared length is damaged exactly as much as by the variable comment (57,796 / 14,714 `.git` bytes) |

**Recommendation: still no.** The measured benefit is a 0.36% reduction in a read that is already three orders of magnitude below the package size, bought with a second version location that three of five ordinary tools silently delete. Nothing in the ledger changes what a reader must implement. §1 stands, with its reasoning narrowed: the comment's cost is a hazard for readers that ignore a declared length rather than an unconditional cost, and its benefit is real but too small to justify a second place where the version lives.

If the owner adopts it regardless — a defensible call, since the tail read is where a range reader starts and the byte cost is trivial — then the layout above is the one measured, with two amendments the evidence supports: **drop the escalation rule** in favour of a plain `uint32` LE (§7.1), and **specify that a missing or unrecognised comment is not a rejection**, only a fall-through to offset-0 typing and then to the central-directory walk.

## Handoff

1. **Owner decision, since closed (spec.md C5: confirmed exceptions are final; the zero-metadata mode is rejected in spec.md §9).** [addressing.md](addressing.md#refinement-zero-stored-identity-or-rename-metadata)'s latest refinement supersedes the sparse-exception recommendation this brief described as settled, and leaves the choice between a confirmed-exception ledger and zero identity metadata with a best-effort contract. The envelope supports both without change: `addressing.coverage` selects the contract, and `addressing.overrides` is `null` in the zero-metadata mode. The measured override-ledger packages price the confirmed option; the ledger-free packages price the other.
2. **CARD-0005:** the recommended manifest is 287 bytes, fixed. Its cost is negligible against the 288,637 / 6,664,426-byte packages; the material envelope costs are the current-file view and the central directory, both already visible in the region map.
3. **Specify before implementation:** the ZIP64 policy, the media type and extension registration, the two-tier conforming/recoverable reader, and the producer's path-uniqueness check. None blocks the layout.
4. **Owner decision, answered but reversible:** §7 measured the fixed-length EOCD comment the requester asked about and recommends against it — 37 bytes saved per cold read, survived by two of five archive rewrites, never authoritative. If it is adopted anyway, §7.1 carries the exact layout, with the escalation rule replaced by a plain `uint32` LE and a missing comment defined as a fall-through rather than a rejection.
5. **Not measured here:** browser range access against a served package (CARD-0002 measured that protocol on its own fixtures), macOS or normalization-insensitive filesystems, packages large enough to need ZIP64,, any encrypted or split archive, and Info-ZIP `zip` as a rewrite tool (not installed on this host).

## Reproduction and evidence

Run from `C:\src\markdown-package`, after the pinned corpus and virtual-environment setup in [compression.md](compression.md#reproduction-and-evidence). No new dependencies. Generated packages and extraction directories stay under ignored `.antiphon/container-work/`; each `tools.py` run uses a fresh directory, so saved scratch paths change between runs.

```powershell
.antiphon/compression-work/venv/Scripts/python docs/investigations/container/build.py
node docs/investigations/container/reader.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/container/tools.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/container/verify_evidence.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/container/render_tables.py
```

Run them in this order; `reader.mjs` and `tools.py` consume `build.py`'s packages. Environment: Windows 10 Pro 19045, Git 2.50.1.windows.1, Python 3.10.2, Node 24.6.0, 7-Zip 21.07 x64, Info-ZIP UnZip 6.00, and the Windows built-in compressed-folder shell handler. Package bytes are deterministic for these pinned inputs; the Explorer and PowerShell rows are Windows-only and macOS was not reachable.

<!-- VALIDATION_START -->

Validation: **60** package structure checks (manifest first, stored, offset zero, no data descriptors, methods in profile, packs stored, entries non-overlapping, directory placement, reserved prefixes), **24** package hash/size/stock-library CRC audits, **88** bounded-access boundary assertions, **14** typing accept/reject decisions, **16** real-tool path extractions, **3** Git path-reservation cases, **8** extraction / working-tree checks, **5** archive-rewrite cases, **25** fixed-length EOCD comment checks (tier encoding, comment bytes, version routes, tail-typed access, comment rewrite survival), **4** recorded counterexamples (EOCD-comment fallback, case collision, NFC/NFD survival, rewrite breaking fast typing). **247 checks in total, 0 unexpected failures in final evidence.** The recorded counterexamples are deliberate measured limitations, not failed assertions.

<!-- VALIDATION_END -->

The reader is an evidence probe over trusted fixtures: it rejects ZIP64, split archives, encryption and data descriptors, and its ATX section scan bounds a read rather than implementing CARD-0004's CommonMark resolver. The override ledger is a sized fixture with that card's record shape, not a semantic re-derivation. No format implementation, production validator or application build exists or was added.

Raw evidence: [packages, layout variants and manifest forms](container/container-results.json), [bounded access and typing](container/reader-results.json), [real tools, paths, extraction and rewrites](container/tools-results.json), and [the audit](container/verification.json).
