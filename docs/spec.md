# markdown-package format specification, version 1

Status: consolidated specification, draft 1, written 2026-09-08. This document merges four closed investigations into one format description. It is a specification, not an implementation: nothing here has been built beyond the worked example in §8, and the numbers it quotes are the investigations' measurements, not promises about an implementation that does not yet exist.

Sources, all in `docs/investigations/`, each with its reproducible evidence directory beside it:

| Investigation | Commits | What it settled |
| --- | --- | --- |
| [compression.md](investigations/compression.md) (CARD-0002) | `7c32a97` | ZIP as the container, per-entry raw DEFLATE (method 8) at producer level 6 or stored (method 0) when smaller; nothing solid; no mandatory codec beyond DEFLATE |
| [history.md](investigations/history.md) (CARD-0003) | `06aea0f` | A real, curated, packed `.git` directory inside the ZIP is the history representation; the pack is stored, not deflated; every package carries an explicit history coverage descriptor |
| [addressing.md](investigations/addressing.md) (CARD-0004) | `4b12c42`, `d0590d0`, `381b874` | Section identity is a computed default anchor plus a sparse, Git-tracked table of producer-confirmed exceptions; digests are computed at read time; the zero-metadata read-time Git-walking alternative measured in `381b874` is closed and rejected (§9) |
| [container.md](investigations/container.md) (CARD-0001) | `8d05889`, `d49793e` | One manifest-first ZIP; `.mdpkg/` and `.git/` reserved; two-tier reader (79-byte offset-0 typing, central-directory fallback); the EOCD comment is rejected as a version carrier in both its variable-length and fixed-length forms |

The words MUST, MUST NOT, SHOULD and MAY are used in their usual normative sense. "Producer" means whatever writes a package; "reader" means whatever opens one; "validator" means a reader that additionally proves internal consistency.

---

## 1. Ground truth and resolved conflicts

### 1.1 What the consolidation brief assumed versus what the sources say

| The brief said | What the investigations actually established | Effect on this spec |
| --- | --- | --- |
| The addressing card uses a "read-time git-walking approach" | The **final** addressing design (`d0590d0`, reaffirmed by the requester after `381b874`) does not walk Git history at read time. It reads one ledger and one document from the selected tree. The Git-walking design is the **rejected** zero-metadata alternative. | §6 specifies the non-walking resolver. Walking appears only in §9 as a rejected alternative. |
| Per-entry ZIP DEFLATE, the pack's internal compression and read-time digests might do redundant work | They act on disjoint bytes: ZIP DEFLATE covers the current-view entries, pack zlib and deltas cover history objects, and digests are computed once over one decoded document per resolution. The pack and index are stored, so no byte is compressed twice. | §7.1 states the layering and what each read path decodes. |
| Walking Git history might require the `.git` tree to be intact even in the fast path | Current-reference resolution touches zero `.git` bytes (measured: 6 requests / 10,369 bytes for npm, 54,440 for Rust, with 0 pack bytes). Only historical `at=`, `commit`, `diff` and `hunk` references and validation need the pack. The typing tier (offset 0 versus directory walk) is orthogonal to whether the pack is touched. | §7.2 read-path table. |
| The manifest must declare how to use `.git` and the overrides together | The container's 287-byte manifest lacked the anchor and digest profile identifiers the addressing design needs to compute default roots. | §4 adds `addressing.anchor` and `addressing.digest`; conflict C7 below. |

### 1.2 Conflicts between the four investigations and how each was resolved

Each of these is a real disagreement between two source documents. None was papered over; the later, measured finding wins unless stated otherwise.

- **C1. EOCD comment.** compression.md recommended "optionally mirror `MDPKG/<version>` in EOCD". container.md measured that a comment defeats a reader's fixed 22-byte tail probe (57,797 npm / 14,715 Rust bytes of pack read for a query that needed none), survives only 2 of 5 archive rewrites, and saves at best 37 bytes per cold read. **Resolved: no comment.** If one is present it is a hint; disagreement with the manifest is a rejection; absence is never a rejection (§3.5).
- **C2. Raw version byte before `PK`.** The original CARD-0001 brief required a first-byte version. compression.md showed it is viable only with corrected offsets and survives no rewrite; container.md replaced it with manifest-first typing. **Resolved: the file begins with `PK\x03\x04`; typing is the 79-byte check in §3.1.**
- **C3. Bare versus non-bare `.git/config`.** history.md's option A shipped a portable bare config. container.md ships `core.bare = false` so that the extracted directory is an ordinary working tree. **Resolved: non-bare** (§5.1). This is part of the 1,004 / 1,020-byte difference between the two cards' package totals.
- **C4. The duplicated current-file view.** history.md measured "A + current files" as a straightforward duplication and explicitly did not recommend it as an optimised final layout. container.md adopted it and proved it is the working tree of the manifest's commit. **Resolved: adopted.** The current view is the read path for documents and sections; the pack is the read path for history. The cost is the "current files alone" row: 128,359 npm / 3,350,579 Rust bytes on the corpora.
- **C5. Addressing's own headline.** The text of addressing.md at `381b874` calls the zero-metadata mechanism "the primary candidate" and says the refinement "explicitly excludes even the sparse table". The requester, having seen both results, reaffirmed the sparse confirmed-exception design. **Resolved: sparse confirmed exceptions are final** (§6). The zero-metadata mechanism is listed as rejected in §9 with its measured failures. addressing.md's header is therefore out of date relative to this decision; this specification is authoritative.
- **C6. `addressing.coverage` values.** container.md proposed `confirmed / best-effort / none` while the zero-metadata contract was still open. With that contract closed there is one resolution contract, and the field only needs to say whether confirmed correspondence covers the whole retained history. **Resolved: `complete | partial`** (§4), with per-range detail in `.mdpkg/history.json`.
- **C7. Profile identifiers in the manifest.** addressing.md states the manifest "pays 34 fixed bytes to select the anchor profile"; container.md's 287-byte manifest has no such field. A reader cannot compute a default root without the anchor profile and the namespace, and cannot reject a foreign-profile reference without the digest profile. **Resolved: `addressing.anchor` and `addressing.digest` are required manifest fields** (§4).
- **C8. Where range summaries and squash bindings are bound.** addressing.md says to "bind those member paths and hashes in the first manifest". container.md requires the manifest to be O(1) in package size. **Resolved: the manifest points at `.mdpkg/history.json` through `history.detail`, and that file lists every summary, patch and binding entry with its hash** (§5.3). The manifest stays fixed-size.
- **C9. "DEFLATE every entry" versus "store the pack".** compression.md's rule is method 8 or stored-when-smaller; history.md measured that deflating the pack saves 2.44% on npm only by forcing whole-member inflation and makes Rust larger. **Resolved: manifest, `.pack` and `.idx` are always stored; every other entry follows the smaller-of rule** (§3.3).
- **C10. Reference grammar version.** addressing.md defines a `v1` UUID grammar and then a `v2` computed-root grammar for document and section references, leaving commit, diff and hunk references "exact as before". **Resolved (stated default D-6): one `v2` path segment for all five reference kinds; the commit, diff and hunk forms are carried over unchanged** (§6.4).
- **C11. Allowed refs.** history.md asked for allowed refs and object format to be defined; container.md shipped only `refs/heads/main` and asserted `HEAD` equals `current` without stating it as a rule. **Resolved (D-7): exactly one branch ref, `HEAD` symbolic to it, and its target MUST equal `current`** (§5.2).
- **C12. The pack reverse index.** container.md shipped the `.rev` file `git index-pack` produced and noted it is derivable. **Resolved (D-8): MAY be present, MUST NOT be required.** The worked example omits it.

---

## 2. Terminology

- **Package**: one ZIP file conforming to §3. The working file extension is `.mdpkg` (registration is open, §11.1).
- **Current view**: the plain ZIP entries that are the Git working tree of the commit named by the manifest's `current` field. Every Markdown document, and the override ledger, is here.
- **Container-level entries**: the entries under `.mdpkg/` that are *not* tracked in Git, because they name commit identities that cannot appear inside the tree they describe: `.mdpkg/manifest.json`, `.mdpkg/history.json`, `.mdpkg/history/bindings.json`, `.mdpkg/history/ranges/*.json`, `.mdpkg/history/patches/*.patch`.
- **Curated repository**: the entries under `.git/`: `HEAD`, `config`, `refs/heads/main`, optionally `shallow`, one pack, its index, and optionally its reverse index. Nothing else.
- **Namespace**: the lowercase UUID identifying a package lineage. All addressing roots are derived within it.
- **Entity**: a document, a document's permanent preamble, or a heading section. Each has a **locator** (§6.2) and, at any snapshot, a **scoped digest** (§6.1).
- **Root**: the 64-hex SHA-256 that is an entity's stable identity: its default root unless the ledger says otherwise.
- **Qualified object ID**: `sha1-<40 hex>` or `sha256-<64 hex>`. Abbreviated hashes are never valid anywhere in the format.
- **Canonical JSON**: UTF-8, object keys sorted bytewise, compact separators (`,` and `:`), no ASCII-escaping of non-ASCII characters, exactly one trailing LF. Every JSON file this format defines is written this way, with one exception: the manifest writes its `mdpkg` key first (§4).

---

## 3. Container profile

The container is an ordinary ZIP archive (PKWARE APPNOTE 6.3.10), single-disk, unencrypted, with the constraints below. Ordinary ZIP tools open it; the constraints exist so a package-aware reader can do more with fewer bytes.

### 3.1 File typing: one 79-byte read

A conforming package is identified by reading bytes 0–78 and checking:

| Offset | Length | Required value |
| --- | --- | --- |
| 0 | 4 | `50 4B 03 04` (local file header signature) |
| 6 | 2 | general-purpose flags with bit 3 clear (no data descriptor on this entry) |
| 8 | 2 | compression method `0` (stored) |
| 26 | 2 | file name length `20` |
| 28 | 2 | extra field length `0` |
| 30 | 20 | `.mdpkg/manifest.json` |
| 50 | 29 | `{"mdpkg":"markdown-package/1"` |

Any failure at or before byte 78 rejects the package from the *conforming* tier without reading anything else. The measured typing probe accepted the valid package and rejected random bytes, an empty file, a plain ZIP, a manifest-not-first archive, a streamed archive and a 40-byte truncation, each in at most 79 bytes. The magic member inside the manifest is necessary: a stored first entry with the right name is not enough, because any ZIP could contain one.

A reader MUST NOT infer format version 1 from the presence of `PK` alone.

### 3.2 Entry order

ZIP does not constrain order; this profile does, because order is what makes bounded reads cheap. A conforming producer writes:

```text
offset 0   .mdpkg/manifest.json                     stored, no data descriptor, no extra field
           <working tree of `current`>              every tracked file, bytewise path order
           .mdpkg/history.json                      container-level
           .mdpkg/history/bindings.json             container-level, when present
           .mdpkg/history/ranges/<sha256>.json      container-level, when present
           .mdpkg/history/patches/<sha256>.patch    container-level, when present
           .git/HEAD  .git/config  .git/refs/heads/main  [.git/shallow]
           .git/objects/pack/pack-<name>.rev        optional
           .git/objects/pack/pack-<name>.idx        stored
           .git/objects/pack/pack-<name>.pack       stored, last
           central directory
           EOCD, comment length 0, at EOF
```

Three rules are normative; the rest is the recommended order:

1. `.mdpkg/manifest.json` MUST be the first entry, at offset 0.
2. The pack MUST be the last entry, so one contiguous range from offset 0 to the pack's local header covers everything a document or section read can need. On the corpora this ordering costs 0 bytes and avoids transferring 158,993 (npm) / 3,312,561 (Rust) bytes for a full no-history browse.
3. Every entry a current-reference resolution can need (§7.2) MUST precede the pack.

Readers MUST NOT depend on any order beyond rule 1, because ordinary archive rewrites reorder entries (§3.7).

### 3.3 Compression per entry

| Entry | Method |
| --- | --- |
| `.mdpkg/manifest.json` | `0` (stored) always: readable with no decoder |
| `.git/objects/pack/*.pack`, `*.idx`, `*.rev` | `0` (stored) always: internal offsets stay valid; the pack's own zlib streams and deltas are its compression |
| Everything else | `8` (raw DEFLATE), producer level 6, or `0` when the DEFLATE output is not smaller than the input |

Only methods `0` and `8` are permitted. A reader that finds any other method in the central directory MUST reject the package. Level is producer policy: readers accept any valid DEFLATE stream. Each entry is decoded with a fresh decoder over exactly the extent the central directory gives, drained to completion, and checked against the directory's CRC32 and uncompressed size; the decoded-length limit comes from the directory, never from the stream.

Why not smaller: per-entry DEFLATE is 69.82% (npm) / 17.36% (Rust) larger than a whole-package gzip stream and 118% / 58% larger than the best solid codec measured. That gap is the price of decoding one document without decoding the package (0.1 ms and one entry instead of 50–70 ms and 9.4 MB), of ordinary ZIP tools listing the documents, and of corruption stopping at an entry boundary. The measured alternatives are in §9.

Browser note: raw DEFLATE is native in `DecompressionStream('deflate-raw')` from Chrome 103, Firefox 113 and Safari 16.4; older engines need a JavaScript inflater (fflate's gunzip import measured at 2,112 gzipped bytes). Mobile qualification is open (§11.2).

### 3.4 Local headers, descriptors and extra fields

- The manifest entry MUST carry true sizes and CRC in its local header, with flag bit 3 clear and an empty extra field. A producer that cannot seek MUST buffer this one small entry.
- Other entries MAY use data descriptors (bit 3 set). Measured cost on the npm package: 1,459 bytes. Readers MUST take every entry's extent, method, sizes and CRC from the central directory, never from the local header, which ZIP permits to be empty or wrong.
- Extra fields are permitted but carry no format meaning. No format information is stored in extra fields, entry comments or the archive comment, because rewrites drop them (§3.7).
- Streaming *consumption* by sequential local-header scanning is a recovery technique, not a conforming read.

### 3.5 Central directory and end of central directory

- The central directory is authoritative for names, methods, extents, CRCs and sizes.
- The EOCD record MUST have a zero-length comment. A reader whose fixed 22-byte tail read does not find a valid EOCD MAY fall back to a 65,557-byte suffix; if it then finds a comment it MUST treat any version token in it as a hint only: disagreement with the manifest is a rejection, absence is not.
- ZIP64 sentinels: no policy is decided (§11.1). The only tested reader behaviour is rejection.

### 3.6 Paths

The canonical path of a document is the exact byte sequence Git records in the tip tree, and its ZIP entry name is those same bytes. Producer requirements:

- Forward slash only; no leading slash; no `.` or `..` component; no drive letter; no backslash. Every tested extractor turns `a\b.md` into a directory `a/`.
- UTF-8 names with general-purpose bit 11 set whenever a name is not pure ASCII.
- Entry names MUST be unique under Unicode NFC followed by simple case folding (D-16). This is stricter than Git and deliberately so: `README.md` plus `readme.md` is a valid Git tree, and every tested extractor and Git's own NTFS checkout silently keeps one of the two.
- `.mdpkg/` and `.git/` are reserved. No tracked path may begin with either prefix after NFC and case folding, except the tracked addressing paths under `.mdpkg/address/` (§6.3). Git enforces `.git/` and `.GIT/` in `fsck` and checkout; it accepts `.mdpkg/x.json` without complaint, so the producer MUST enforce the `.mdpkg/` reservation itself. A producer importing a source tree that contains a real `.mdpkg/` directory MUST reject it or relocate the colliding paths and declare that it did.

Document *content* is normalized to LF line endings on write (D-17); beyond that EOL rule, the container does not otherwise normalize content, and the source profile in §6.1 decides what a review covers.

### 3.7 Two-tier reader

Ordinary tools reorder entries and recompress them: of five real rewrites (Python rebuild, 7-Zip add, PowerShell `Compress-Archive`, fflate round trip, and the as-produced case), manifest-first order survived two and the manifest's *bytes* survived all five. The reader is therefore specified in two tiers:

1. **Conforming**: §3.1 passes at offset 0. The manifest is read from the stored first entry; everything else proceeds from the central directory.
2. **Recoverable**: §3.1 fails, but the central directory contains an entry named exactly `.mdpkg/manifest.json` whose decoded bytes begin with `{"mdpkg":"markdown-package/1"` and parse as a valid manifest. The reader MAY proceed, but the package is nonconforming: it SHOULD be re-emitted in conforming form by a package-aware producer rather than passed on. A recovered package's entry order gives no bounded-read guarantees.

A repacked archive that preserves payload bytes is not a format-preserving package rewrite. If files change, the ledger, digests and history sidecars can only be regenerated by a package-aware producer.

### 3.8 Extraction is a Git working tree

The package ships no `.git/index`. After extracting every entry with any ZIP tool, running `git read-tree HEAD` in the extracted directory rebuilds the index; thereafter `git status` reports only the container-level entries as untracked, `git fsck --full --strict` passes, and `HEAD` resolves to `current`. Measured on both corpora (83 / 650 tracked files, clean). Shipping the index would cost 9,043 / 63,610 bytes and bind host-specific stat data.

Extraction is a plain ZIP unpack followed by `git read-tree`, neither of which rewrites a byte of any entry, and the package ships no `.gitattributes` and no smudge/clean filter configuration. So a conforming extractor MUST NOT convert line endings on checkout: every extracted file is exactly the LF-normalized bytes D-17 put in the ZIP entry and the Git blob, on every platform (D-18). This mirrors `core.autocrlf=input`, not `core.autocrlf=true`: the format has a write-time normalization and no matching read-time reversal. A platform-native checkout would need a filter mechanism this container does not define, and it would break the one property the current view exists to give a reader for free — that the extracted file *is* the tracked blob, byte for byte, so hashing it under §6.1 needs no reconstruction of what checkout did to it. A consumer who wants CRLF locally applies its own tool's conversion (a Windows editor's line-ending setting, `git config core.autocrlf=true` before re-committing, and so on); that conversion is outside the format, exactly as it is outside Git's own object model.

---

## 4. The manifest

`.mdpkg/manifest.json` is canonical JSON with one deliberate exception: the `mdpkg` key is written first so it lands at byte 50 of the file. All other keys are in sorted order. It MUST be O(1) in package size: a field earns its place only if a reader needs it before it can do anything else, it must be readable without a decoder, and it does not grow with the package.

```json
{"mdpkg":"markdown-package/1",
 "addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":".mdpkg/address/overrides.json"},
 "current":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c",
 "history":{"coverage":"complete","detail":".mdpkg/history.json","transform":["squashed"]},
 "namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `mdpkg` | string, exactly `markdown-package/1` | Format magic and version. The only authoritative version token in the file. |
| `namespace` | lowercase UUID | Package lineage. Every addressing root is derived within it; a reference from another namespace is rejected before anything is resolved. |
| `current` | qualified object ID | The commit whose working tree the current view mirrors. MUST equal the target of `refs/heads/main`. Its prefix (`sha1-` / `sha256-`) is the repository's object format; no separate field is needed. |
| `addressing.anchor` | string | Anchor profile used to compute default roots. Version 1 defines only `cm0312-trail-source-v1`. |
| `addressing.digest` | string | Source digest profile. Version 1 defines only `cm0312-source-lf-v1`. |
| `addressing.coverage` | `complete` or `partial` | Whether producer-confirmed correspondence (§6.3) covers every retained transition. `partial` requires `history.json` to enumerate the covered ranges; a resolution whose reviewed commit falls in an uncovered range returns `unconfirmed`. |
| `addressing.overrides` | entry name or `null` | The ledger's tracked path, or `null` as a positive statement that there are no exceptions at `current`. |
| `history.coverage` | `complete`, `truncated` or `unknown` | Whether the retained graph is the whole history of the declared scope. A synthetic root is `truncated`. |
| `history.transform` | array of `projected`, `squashed` | Transformations applied to produce the retained graph, in order. Empty means the retained graph is the original graph. |
| `history.detail` | entry name | The unbounded descriptor, §5.3. |

Fields deliberately absent, with their measured cost on the npm / Rust corpora: a codec declaration (+42 / +42 bytes; the central directory already holds every entry's method), a document index (+3,527 / +22,228; the central directory is the index), per-document digests (+9,086 / +65,776; the tip tree already binds them and ZIP CRCs catch accidental corruption), entry counts or offsets (EOCD), and a package self-hash (a file cannot contain its own digest).

A validator MUST reject a package whose manifest disagrees with the archive: `current` not equal to the branch target, `overrides` naming an entry that is absent or absent when the tree contains the ledger, or a `transform` list inconsistent with `history.json`.

---

## 5. History

### 5.1 The curated repository

The `.git/` entries are a real Git repository and nothing more than one:

| Entry | Content |
| --- | --- |
| `.git/HEAD` | `ref: refs/heads/main\n` |
| `.git/config` | `[core]\n\trepositoryformatversion = 0\n\tbare = false\n` (for SHA-256 repositories, additionally `repositoryformatversion = 1` and `[extensions]\n\tobjectFormat = sha256\n`; see D-14) |
| `.git/refs/heads/main` | the commit ID of `current`, followed by LF |
| `.git/shallow` | present only when the retained graph is a genuine shallow clone; lists boundary commit IDs, one per line |
| `.git/objects/pack/pack-<name>.pack` | exactly one pack containing every retained object, offset deltas permitted, stored in the ZIP |
| `.git/objects/pack/pack-<name>.idx` | its index, stored |
| `.git/objects/pack/pack-<name>.rev` | optional reverse index |

No loose objects, no working index, no hooks, reflogs, remote URLs, `description`, `info/` or `packed-refs`. The pack is a storage choice: repacking changes offsets and delta bases but not object IDs, so no format identity depends on pack layout. A document's blob may be a delta against any other object, so independent document decoding from the pack cannot be promised at the entry level; that is what the current view is for.

Measured sizes (32 retained updates): 159,296 npm / 3,312,849 Rust bytes for the packed repository ZIP, against 148,080 / 3,288,503 for a bundle and 171,192 / 3,423,817 for flat base-plus-diffs. Git finds 48 / 23 blob deltas among 333 / 767 objects; it does not provide solid cross-document compression and this format does not pretend it does.

### 5.2 Refs and object format

Exactly one branch ref, `refs/heads/main`, MUST exist. `HEAD` MUST be a symbolic ref to it. Its target MUST equal `current` (D-7). Tags, notes refs, remote-tracking refs and replace refs MUST NOT be shipped; Git notes and `refs/replace` are local overlays and are not portable evidence of anything (§9).

Version 1 packages use the SHA-1 object format and qualify every ID as `sha1-…`. The grammar reserves `sha256-…`; see D-14 and §11.2.

### 5.3 `.mdpkg/history.json`

This is the unbounded part of the history declaration. It is container-level (untracked) because it names emitted commit IDs, which cannot appear inside the trees those commits commit. Canonical JSON:

| Field | Type | Meaning |
| --- | --- | --- |
| `walk` | `first-parent` | The only walk version 1 defines. Second-parent paths of merges are not retained (§11.2). |
| `root` | `original` or `synthetic` | Whether the oldest retained commit is the lineage's true root or a snapshot the producer made into one. |
| `sourceRepository`, `scope` | strings, optional | For packages projected from another repository: what was imported and which path projection. |
| `sourceBase`, `sourceTip` | qualified object IDs | The source-lineage range the retained graph represents. |
| `retainedCommits` | integer | Count of commits on the retained first-parent path. Membership of a specific commit is answered by the pack index. |
| `shallowBoundaries` | array of qualified IDs | MUST equal the contents of `.git/shallow`, or be empty when that file is absent. |
| `transformations` | array | Each `{kind, sourceBase, sourceTip, emitted, summary?}`; `kind` is `projected` or `squashed`; `emitted` is the commit that replaced the range; `summary` names the range summary entry when one exists. |
| `ranges` | array of entry names | Every `.mdpkg/history/ranges/<sha256>.json` shipped. The file name is the SHA-256 of the file's bytes. |
| `patches` | array | Each `{entry, sha256, from, to, document, profile}` for an archived patch under `.mdpkg/history/patches/`. |
| `bindings` | entry name, optional | `.mdpkg/history/bindings.json`, required when any transformation carries a summary. |
| `addressingCoverage` | array of `{from, to, coverage}` | Ranges of the retained path over which confirmed correspondence is `complete` or `partial`. When the manifest says `complete` this is one range spanning the whole path. |

Coverage semantics, from the measured counterexamples: a squash commit is structurally identical to an ordinary one-parent commit (the same tree, parent, author, committer and message produce the identical object ID), so squash is declared, never inferred. The absence of `.git/shallow` proves nothing about completeness: a synthetic root repacks as a normal repository with `--is-shallow-repository=false`. A missing parent outside a declared shallow boundary is corruption, not an inferred truncation. "Complete" always names a scope and walk; it is a producer claim checked for internal consistency, not proof that no upstream history was omitted.

### 5.4 Range summaries and bindings

Squashing discards the intermediate revisions that answer "was this section touched after my review?". A producer that squashes MUST compute a range summary **before** discarding them and ship it as `.mdpkg/history/ranges/<sha256>.json` (canonical JSON, named by its own hash):

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `namespace`, `anchor`, `profile`, `walk` | MUST match the manifest and be `first-parent` |
| `coverage` | `complete` or `partial` |
| `base`, `tip` | Source-range endpoints, qualified IDs |
| `sourceCommits` | Ordered source commit IDs; position 0 is `base`, ordinal *n* is the *n*-th transition |
| `collapsedInputs` | The commits this squash replaced |
| `beforeStateDigest`, `afterStateDigest` | SHA-256 of the canonical JSON map from every root to its scoped digest at each endpoint; binds the summary to exact states |
| `contentTouched` | Sorted roots whose digest or live existence changed anywhere in the range |
| `changedAt` | root → ordinals at which it changed; an edit and its revert both appear |
| `endpoints` | root → `{before, after}` digests, `null` for absent |
| `identityEvents` | `{at, root, event, …}` for creation, retirement (`split`, `merge`, `deleted`), restoration, with successor roots |
| `nested` | `{summary, emitted}` hashes of earlier summaries this one expands, for repeated squash |

Keys are origin roots (§6.2), so a summary remains valid across renames recorded in the ledger. The measured three-transition example is 1,955 bytes plus 169 bytes of bindings; long histories need a separate event-size benchmark before cheap unlimited retention is promised (§11.2).

`.mdpkg/history/bindings.json` is `{"version":1,"bindings":[{"emitted":<qualified ID>,"summary":<entry name>,"hash":<sha256>}]}`. It exists because a commit's own ID cannot be written into its tree; the binding is created after the squash commit exists.

The exact touched query over checkpoint positions `(from, to]` is: does the root have an ordinal *n* with `from < n ≤ to`? Missing checkpoint membership, `partial` coverage, an unsupported walk or an absent summary returns **unknown**, never "untouched".

### 5.5 Archived patches

A published hunk reference (§6.4) binds the SHA-256 of a complete patch. Because regeneration across Git versions and configurations is not byte-stable, a producer that promises hunk retention stores the exact patch bytes at `.mdpkg/history/patches/<sha256>.patch` and lists it in `history.json`. If regeneration disagrees with the bound hash, the archived artifact is used; if both are absent, the reference is unavailable. A patch is never relocated by line number, title or approximate text.

---

## 6. Addressing

### 6.1 Source digest profile `cm0312-source-lf-v1`

1. Decode strict UTF-8; normalize CRLF and lone CR to LF (D-17). This normalization already happened when the content was written, so it is a no-op here on any conforming package; it is applied again so the profile is well-defined over nonconforming input too. Do not normalize Unicode. A BOM, if present, is retained as source. Invalid UTF-8 is outside the profile.
2. Parse CommonMark 0.31.2 without smart punctuation. Only headings that are direct children of the document open addressable sections; ATX and Setext both count. Heading-like text inside fenced code, HTML blocks, blockquotes or list items does not.
3. A heading section runs from the start of its heading's source line to just before the next top-level heading of equal or lower rank, or to end of file. It includes the heading's exact markup and all descendant sections. A child edit therefore changes the child's and every ancestor's digest; a sibling edit does not. A rank change changes the digest.
4. The preamble is everything before the first top-level heading, or the whole document when it has none. Its identity is permanent even when it is empty.
5. At the scope boundary, strip trailing lines consisting only of spaces or tabs; end a non-empty scope with exactly one LF. Everything internal is exact.
6. `digest = SHA-256("mdpkg" 0x00 profile 0x00 scopeKind 0x00 canonicalSource)` with `scopeKind` one of `document`, `section`, `preamble`.

This reviews *source in a scope*, not rendered meaning: a link definition changed under another heading does not change this section's digest. Rendered-output review would need a separate context digest and is out of scope (§11.2).

### 6.2 Anchor profile `cm0312-trail-source-v1`

A **locator** is `[scopeKind, path, headingTrail]`:

- `scopeKind`: `document`, `preamble` or `section`.
- `path`: the repository-relative path (§3.6).
- `headingTrail`: empty for `document` and `preamble`; for a section, one `[headingSource, occurrence]` pair per ancestor heading and then the section's own, where `headingSource` is the heading's exact normalized source line(s) including markup (`## Setup`, not `Setup`) and `occurrence` is the zero-based index among siblings with the same parent trail and identical heading source.

The **default root** is:

```text
SHA-256("mdpkg-default" 0x00 anchorProfile 0x00 namespace 0x00 canonicalJson(locator))
```

It encodes *where the entity is*, not what it contains. Reordering unique siblings, inserting a differently named sibling, or editing a body does not change a default root. Renaming a heading, renaming an ancestor, moving a file or moving a section between documents does.

### 6.3 The override ledger

When a producer confirms that an entity's current locator differs from the one its root was minted for, it records the exception in the Git-tracked file `.mdpkg/address/overrides.json`:

```json
{"anchor":"cm0312-trail-source-v1",
 "entries":{
   "<origin root>":  {"to":["section","guide.md",[["# Guide",0],["## Installation",0]]]},
   "<retired root>": {"dead":"split","next":["<successor root>","<successor root>"]},
   "<retired root>": {"dead":"deleted"},
   "<unknown root>": {"unknown":"unconfirmed-removal"}},
 "version":1}
```

- `to`: the entity now lives at this locator. Bindings go directly from origin root to **current** locator; chains are flattened on update. Once an entity is exceptional its record is retained even if a later edit restores the default location, because a review may have been issued against the intermediate locator.
- `dead` with optional `next`: the entity was retired by an explicit editorial operation (`split`, `merge`, `deleted`); references to it resolve `flagged-changed` with the reason and successors, never silently transferred.
- `unknown`: the producer could not establish correspondence; references resolve `unconfirmed`.
- **Reserved-slot births**: if a new entity is created at a locator whose default root is still held by a retired or moved entity, the producer mints a fresh random root for the newcomer and records `{"to": <its locator>}` under that fresh root. The old review cannot attach to the replacement.

The file MUST be absent when it would have no entries, and the manifest's `overrides` MUST be `null` in that case (D-12). Because it is tracked, it appears at every retained commit that had exceptions, survives squash as an ordinary tree copy, and is present in the current view as a plain ZIP entry.

Measured cost: 0 bytes at zero exceptions; +2.32% npm / +0.99% Rust at 5% of headings exceptional; +7.12% / +3.77% at 20%. A full identity map costs +31.60% / +17.21% on the same snapshots and +41.16% / +20.19% across the 33-snapshot histories, where the sparse ledger with no injected exceptions costs +1.96% / +0.33%. At very high lifetime exception density a denser encoding may be needed (§11.2).

**Producer obligation.** Confirmation is a producer act. An identity-aware editor confirms a rename or move as it performs it. A generic Git import must review correspondence; writing a similarity heuristic's guess into the ledger does not confirm it. Native `git diff -M` detects file pairs, not heading sections, and the best measured section-projection hybrid got 10 right, 1 wrong and 4 missed of 14 required mappings, including a false `R099` continuation on unrelated boilerplate. Candidates reduce producer work; they are never authority. Where correspondence over a range was not confirmed, the producer declares `addressing.coverage: partial` with the covered ranges in `history.json`.

### 6.4 References

```text
mdpkg://<namespace>/v2/section/<root>?anchor=<anchorProfile>&profile=<digestProfile>&expect=<digest>&loc=<base64url(canonicalJson(locator))>
mdpkg://<namespace>/v2/document/<root>?anchor=…&profile=…&expect=…&loc=…
mdpkg://<namespace>/v2/section/<root>?…&at=<qualified commit ID>
mdpkg://<namespace>/v2/commit/<qualified commit ID>
mdpkg://<namespace>/v2/diff/<A>..<B>?document=<root>&profile=git-myers-u3-v1
mdpkg://<namespace>/v2/hunk/<A>..<B>?document=<root>&profile=git-myers-u3-v1&patch=<sha256>&ordinal=<n>
```

- Preamble references use the `section` path with a locator whose `scopeKind` is `preamble`.
- `loc` is a navigation and default-root hint, not identity; `root` is identity; `expect` is the reviewed state. Both `root` and `expect` are 64 lowercase hex characters.
- Without `at`, a reference selects `current`. With `at`, it selects that exact snapshot and MUST NOT fall forward or redirect through a squash binding; an absent commit is `invalidated / history-unavailable`.
- `git-myers-u3-v1` fixes Myers, three context lines, full blob IDs, no rename detection, no indent heuristic, no external diff, no colour.
- Readers MUST reject unknown versions or profiles, duplicate or unknown parameters, malformed IDs and foreign namespaces. Navigation without `expect` is a UI feature and establishes no reviewed state.

The external review record that produces such a reference SHOULD also keep `observedAt` (the commit at which the review was made). It is evidence for the touched query, not part of the reference.

### 6.5 Resolution of a current document or section reference

Given the manifest and central directory:

1. Reject if `namespace`, `anchor` or `profile` differ from the manifest. If `addressing.coverage` is `partial` and the review's `observedAt` (when supplied) lies in an uncovered range, return `unconfirmed / incomplete-correspondence`.
2. If `addressing.overrides` is non-null, read that one entry and look up `root`:
   - `dead` → `flagged-changed` with reason and successors.
   - `unknown` → `unconfirmed` with reason.
   - `to` → the target locator is the recorded one.
   - absent → if `root` equals the default root of `loc`, the target locator is `loc`; otherwise `unconfirmed / missing-override` (the reference claims an exception the package does not confirm).
3. Read the one document entry the target locator names, apply §6.1, and locate the entity by trail. If it is not there: `unconfirmed / possibly-renamed-moved-or-deleted`. Absence is never reported as deletion.
4. Compute the scoped digest and compare with `expect`: equal → `survives / same-source`; different → `flagged-changed / source-changed`. Return the current locator and digest either way.

This reads the manifest, the ledger (when present) and one document. It never reads the pack, never walks history and stores no digest. Measured on the corpora: 6 requests / 10,369 (npm) and 54,440 (Rust) bytes without a ledger, 8 / 12,312 and 85,447 with one, 0 pack bytes and 0 bytes of any other document in every case; a warm reader fetches 0 further bytes. Parsing and hashing one document took 0.87 / 0.56 ms.

With `at=A`: locate `A` in the pack index (absent → `invalidated / history-unavailable`, and `history.json` says whether it was collapsed or truncated); read `A`'s tree, its `.mdpkg/address/overrides.json` blob if any, and the document blob; then apply steps 2–4 against that snapshot.

### 6.6 Result statuses and stability

| Status | Meaning |
| --- | --- |
| `survives` | Same entity, same scoped source. |
| `flagged-changed` | Same entity, different source, or retired with a declared reason. The external review stays on record. |
| `unconfirmed` | The package cannot confirm correspondence. The review is preserved externally and the current section is treated as unreviewed relative to it. Candidate locations MAY be offered; the review badge MUST NOT be moved. |
| `invalidated` | No valid answer from shipped evidence: wrong namespace or profile, malformed reference, unavailable snapshot, malformed package. |

| Reference | Repack / re-ZIP | Squash | Truncate to later base | File move | Content edit |
| --- | --- | --- | --- | --- | --- |
| Document, section (current) | survives | survives if digest equal, else flagged-changed; ledger copied with the tree | survives if entity and ledger retained; unconfirmed outside `addressingCoverage` | survives via ledger `to` | flagged-changed, including heading rename and descendant edit |
| Section with `at` | survives | invalidated if the snapshot was collapsed | invalidated if discarded | survives at old snapshot | survives at old snapshot |
| Commit | survives | invalidated if the object was replaced | invalidated if discarded | survives | survives |
| Diff | survives (same profile) | survives only if both endpoints retained | same | survives at old endpoints | survives at old endpoints |
| Hunk | survives if patch hash verifiable | survives as archived evidence if the patch is retained | same | survives in old patch | survives in old patch |

### 6.7 Two questions the format keeps apart

- **Net change**: "does this section differ now from the state I reviewed?" Answered by §6.5 from the current snapshot alone, after any squash.
- **Touched since**: "was this section edited at any time after my review?" Answered only from a range summary (§5.4) whose ordinals cover the interval; otherwise `unknown`. A rename then revert leaves the digest equal and the section touched; endpoint comparison cannot see it. The format never upgrades a missing trail to "unchanged since review".

---

## 7. How the layers fit together

### 7.1 Three compressions, no overlap

| Layer | Covers | Decoded when |
| --- | --- | --- |
| ZIP DEFLATE (method 8) | Current-view entries: documents, ledger, `history.json`, summaries | One entry per document a resolution or browse touches |
| Git pack (zlib per object + deltas) | Every retained object: blobs, trees, commits, including old versions of the ledger | Only for `at=`, `commit`, `diff`, `hunk` references, validation and Git tooling after extraction |
| None | Scoped digests | Computed on demand over decoded source; never stored in the package |

The pack and its index are stored, so nothing is compressed twice and the index's offsets are valid straight out of the archive. A current-reference resolution decodes exactly one DEFLATE member (plus the small ledger entry) and hashes one document; no work is repeated because no cached digest has to be re-validated. A validator that wants proof that the current view equals `current`'s tree hashes each current-view entry as a Git blob (`"blob " length 0x00 bytes`, SHA-1) and compares with the tree it reads from the pack; that is a validation path, not a read path.

The current view duplicates the tip blobs that also sit in the pack. That duplication is the working tree and the price of ordinary ZIP browsing plus pack-free section reads (C4).

### 7.2 Read paths and what each needs

| Operation | Manifest fields used | Entries read | Pack touched |
| --- | --- | --- | --- |
| Type the file | `mdpkg` | first 79 bytes | no |
| Browse documents in a ZIP tool | none | central directory, chosen documents | no |
| Resolve a current section or document reference | `namespace`, `addressing.*`, `current` (to trust the view) | manifest, ledger, one document | no |
| Touched-since query | `history.detail` | `history.json`, one range summary, bindings | no |
| Resolve `at=`, `commit`, `diff`, `hunk` | `current`, `history.*` | `history.json`, `.idx`, needed pack ranges (plus archived patch for hunks) | yes |
| Validate current view against tree | `current` | everything above plus tree objects | yes |
| Work with the history natively | none | extract all; `git read-tree HEAD` | yes |

The two reader tiers of §3.7 change only how the manifest is found. In the recoverable tier the entry order is unknown, so the "everything before the pack" guarantee is lost and a range reader may fetch more, but every operation above still works from the central directory.

---

## 8. Worked example

Everything in this section is produced by [`docs/spec/worked-example.py`](spec/worked-example.py); its full output is [`docs/spec/worked-example.json`](spec/worked-example.json). Two runs produced byte-identical packages. Git 2.50.1, Python 3.10.2, one packing thread, level 6, window 10, depth 50, fixed author, committer and dates.

### 8.1 Fixture

Namespace `c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8`. Two documents.

`guide.md` at the base:

```markdown
# Guide

Read this before the notes.

## Setup

Install the tool, then run `init`.

## Usage

Run `build` to produce a package.
```

`notes.md`, unchanged throughout:

```markdown
# Notes

## Todo

- write the guide
```

| Commit | Tree | Change |
| --- | --- | --- |
| `c0` = `28d8c71e94abd862c91537e85978a35ecc92c739` | `500c623d…` | base |
| `c1` = `08ae3497de2558fe65f196844a2ec60fe55e5f73` | `63cee821…` | adds the line ``Run `check` to validate it.`` under `## Usage` |
| `c2` = `d038a20593503cc7250243ce9d4b36f148db479b` | `a15125f8…` | renames `## Setup` to `## Installation`; the producer confirms the rename and adds `.mdpkg/address/overrides.json` in the same commit |
| `s1` = `b414f39b3a54a4232fbaa6a0de0dd4966bdf981c` | `a15125f8…` | squash of `c1` and `c2` onto `c0`; same tree as `c2` |

Package 1 (full history) retains `c0 → c1 → c2`. Package 2 (squashed) retains `c0 → s1`. Both have the same current view, because both have the same tip tree.

The ledger, 195 bytes, tracked at `c2` and therefore at `s1`:

```json
{"anchor":"cm0312-trail-source-v1","entries":{"b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984":{"to":["section","guide.md",[["# Guide",0],["## Installation",0]]]}},"version":1}
```

The key is the default root of `["section","guide.md",[["# Guide",0],["## Setup",0]]]`, the locator `## Setup` had at `c0` and `c1`.

### 8.2 Package 2, byte by byte

6,322 bytes; SHA-256 `b6fb3f23464452d3d4ab44660790e4f22c6cfa3fff1c184dd69152c3f4325ca9`.

| # | Local header | Data | End | Method | Compressed | Raw | CRC32 | Name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 50 | 426 | 0 | 376 | 376 | `bd7adfde` | `.mdpkg/manifest.json` |
| 1 | 426 | 485 | 645 | 8 | 160 | 195 | `a14c171c` | `.mdpkg/address/overrides.json` |
| 2 | 645 | 683 | 802 | 8 | 119 | 163 | `cf83f8e7` | `guide.md` |
| 3 | 802 | 840 | 876 | 0 | 36 | 36 | `ba3d4b41` | `notes.md` |
| 4 | 876 | 925 | 1,293 | 8 | 368 | 844 | `1be94c50` | `.mdpkg/history.json` |
| 5 | 1,293 | 1,351 | 1,520 | 8 | 169 | 265 | `cafccc48` | `.mdpkg/history/bindings.json` |
| 6 | 1,520 | 1,641 | 2,588 | 8 | 947 | 2,202 | `67747d75` | `.mdpkg/history/ranges/ff2689cd…b6f0.json` |
| 7 | 2,588 | 2,627 | 2,648 | 0 | 21 | 21 | `576463b5` | `.git/HEAD` |
| 8 | 2,648 | 2,689 | 2,739 | 0 | 50 | 50 | `184bf63d` | `.git/config` |
| 9 | 2,739 | 2,789 | 2,830 | 0 | 41 | 41 | `4f5dffdc` | `.git/refs/heads/main` |
| 10 | 2,830 | 2,927 | 4,279 | 0 | 1,352 | 1,352 | `afc5f15c` | `.git/objects/pack/pack-90bb5901…c475.idx` |
| 11 | 4,279 | 4,377 | 5,370 | 0 | 993 | 993 | `8dc1b4b6` | `.git/objects/pack/pack-90bb5901…c475.pack` |
| | 5,370 | | 6,300 | | 930 | | | central directory, 12 records |
| | 6,300 | | 6,322 | | 22 | | | EOCD, comment length 0 |

`notes.md` is stored because DEFLATE would not shrink 36 bytes. Entries 1–3 are the working tree of `s1` in bytewise path order; entries 4–6 are container-level; entries 7–11 are the curated repository with the pack last. Everything a section read needs ends at byte 876.

**The 79-byte typing read** (offsets 0–78), annotated:

```text
000000  50 4b 03 04  14 00  00 00  00 00  00 00  21 00  de df 7a bd
        sig          need   flags  method time   date   crc32 = bd7adfde
000010  78 01 00 00  78 01 00 00  14 00  00 00  2e 6d 64 70 6b 67 2f
        csize 376    usize 376    nlen20 elen0  ".mdpkg/
000020  6d 61 6e 69 66 65 73 74 2e 6a 73 6f 6e              manifest.json"
000032  7b 22 6d 64 70 6b 67 22 3a 22 6d 61 72 6b 64 6f 77 6e 2d 70 61 63 6b 61 67 65 2f 31 22
        {"mdpkg":"markdown-package/1"
```

Flags `00 00`: bit 3 clear, ASCII name. Method `00 00`: stored. Date `21 00`: 1980-01-01. Extra length `00 00`, which is why the magic begins exactly at byte 50.

**The manifest** (entry 0, 376 bytes, key `mdpkg` first, the rest sorted):

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":".mdpkg/address/overrides.json"},"current":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","history":{"coverage":"complete","detail":".mdpkg/history.json","transform":["squashed"]},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

**`.mdpkg/history.json`** (entry 4):

```json
{"addressingCoverage":[{"coverage":"complete","from":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","to":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c"}],
 "bindings":".mdpkg/history/bindings.json",
 "patches":[],
 "ranges":[".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"],
 "retainedCommits":2,"root":"original","shallowBoundaries":[],
 "sourceBase":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","sourceTip":"sha1-d038a20593503cc7250243ce9d4b36f148db479b",
 "transformations":[{"emitted":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","kind":"squashed","sourceBase":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","sourceTip":"sha1-d038a20593503cc7250243ce9d4b36f148db479b","summary":".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"}],
 "walk":"first-parent"}
```

(Shown wrapped; the entry is one canonical-JSON line.)

**The range summary** (entry 6, 2,202 bytes, named by its own SHA-256 `ff2689cd…b6f0`), abbreviated to the parts the addressing example uses; roots are shortened here only:

```json
{"base":"sha1-28d8c71e…","tip":"sha1-d038a205…","walk":"first-parent","coverage":"complete",
 "sourceCommits":["sha1-08ae3497…","sha1-d038a205…"],"collapsedInputs":["sha1-08ae3497…","sha1-d038a205…"],
 "changedAt":{"52f7f274…":[1],           ← ## Usage: edited at transition 1 only
              "b6564987…":[2],           ← ## Setup: heading renamed at transition 2
              "9148e4f9…":[1,2],         ← # Guide: parent of both, touched by both
              "a859a7e3…":[1,2]},        ← guide.md as a document
 "identityEvents":[],"nested":[], …}
```

**`.mdpkg/history/bindings.json`** (entry 5):

```json
{"bindings":[{"emitted":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","hash":"ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0","summary":".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"}],"version":1}
```

**The curated repository**: `.git/HEAD` is `ref: refs/heads/main\n`; `.git/config` is the 50-byte non-bare config of §5.1; `.git/refs/heads/main` is `b414f39b…981c\n`, equal to `current`. The pack holds every object reachable from `s1` and nothing else: 2 commits, 4 trees (the root trees of `c0` and `s1`, plus the `.mdpkg` and `.mdpkg/address` subtrees) and 4 blobs (`guide.md` at `c0` and at `s1`, `notes.md`, the ledger). The `c1` version of `guide.md` is not in this package; it is in Package 1, whose pack has 3 commits, 5 trees and 5 blobs. `git ls-tree -r b414f39b` reports:

```text
100644 blob 752dff649fddd64bfb1804adc5c5da5960d55d78	.mdpkg/address/overrides.json
100644 blob 7e5cdaf1d0796bd7280ba1fbee7f506ecf90dc64	guide.md
100644 blob 143227537cf0e613855eb072fc61269cf85387f5	notes.md
```

and the SHA-1 of `"blob <n>\0" + entry bytes` for entries 1, 2 and 3 equals those three IDs: the current view is the working tree.

**First central-directory record** (offset 5,370):

```text
50 4b 01 02  14 03  14 00  00 00  00 00  00 00  21 00  de df 7a bd  78 01 00 00  78 01 00 00
sig          made   need   flags  method time   date   crc          csize        usize
14 00  00 00  00 00  00 00  00 00  a4 81 00 00  00 00 00 00  2e 6d 64 70 6b 67 2f 6d 61 6e 69 66 65 73 74 2e 6a 73 6f 6e
nlen   elen   clen   disk   iattr  eattr 0100644 local off 0  .mdpkg/manifest.json
```

**EOCD** (offset 6,300, the last 22 bytes):

```text
50 4b 05 06  00 00  00 00  0c 00  0c 00  a2 03 00 00  fa 14 00 00  00 00
sig          disk   cddisk n=12   total  cd size 930  cd off 5370  comment 0
```

Package 1 (full history) differs only in the manifest (`transform: []`, `current` = `c2`, 366 bytes), a smaller `history.json`, no bindings or summary entries, and a pack holding three commits: 4,986 bytes, 10 entries, SHA-256 `7d55bbf9…6c45`.

### 8.3 Addressing: three reviews at `c1`, resolved against Package 2

A reviewer working from Package 1's history at `c1` (before the rename) records three reviews. Each carries the entity's root, the locator at review time, the scoped digest at `c1`, and `observedAt = c1`.

| Review | Root | Locator at `c1` | Expected digest |
| --- | --- | --- | --- |
| Setup | `b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984` | `["section","guide.md",[["# Guide",0],["## Setup",0]]]` | `2078ef26101467257c9b4d35e4c617b96c9f4e719b460088f4f78e4d927d0264` |
| Usage | `52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70` | `["section","guide.md",[["# Guide",0],["## Usage",0]]]` | `684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa` |
| Todo | `c1fb83ff728d81247fe7c6b41f62897fa54fd9df3823247ee75fd65f5fc4692d` | `["section","notes.md",[["# Notes",0],["## Todo",0]]]` | `0e3cb80374f66eae7b4cae61f3753e3838b819ef5e42421f741fa4a8d7c0ee2e` |

The Setup reference as a URI:

```text
mdpkg://c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8/v2/section/b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984?anchor=cm0312-trail-source-v1&profile=cm0312-source-lf-v1&expect=2078ef26101467257c9b4d35e4c617b96c9f4e719b460088f4f78e4d927d0264&loc=WyJzZWN0aW9uIiwiZ3VpZGUubWQiLFtbIiMgR3VpZGUiLDBdLFsiIyMgU2V0dXAiLDBdXV0K
```

Later the reviewer receives Package 2, in which `c1` no longer exists. Resolution proceeds by §6.5 from the manifest, the ledger (entry 1) and one document each:

| Review | Ledger lookup | Document read | Digest now | Result |
| --- | --- | --- | --- | --- |
| Setup | `b6564987…` → `to` `[…,["## Installation",0]]` | `guide.md` | `29f1bb85c6f01fffb19ded47d9e0213372fdac79cb9785e6197ddbba46f629a9` | **flagged-changed / source-changed**, now at `## Installation` |
| Usage | no entry; root equals default of `loc` | `guide.md` | `684ba2cd…` (equal) | **survives / same-source** |
| Todo | no entry; root equals default of `loc` | `notes.md` | `0e3cb803…` (equal) | **survives / same-source** |

Setup is the mechanism working: the heading rename changed the section's source, so the review is correctly flagged as changed, *and* the reviewer is pointed at the section's new heading rather than told it vanished. Usage survives even though it was edited at `c1`, because the review was taken after that edit and nothing touched it afterwards. Todo survives untouched.

The same three references against the same package **without** the ledger (as if the producer had not confirmed the rename):

| Review | Result without the ledger |
| --- | --- |
| Setup | **unconfirmed / possibly-renamed-moved-or-deleted**: the default locator `## Setup` is not in `guide.md`; the review is kept and the section is treated as unreviewed |
| Usage | survives |
| Todo | survives |

The resolver never says "deleted", never guesses that `## Installation` is the old `## Setup`, and never moves the reviewed badge; that is the failure mode the confirmed ledger exists to prevent, and it is why the zero-metadata design is rejected (§9).

**Touched-since**, from the range summary in entry 6 and `observedAt = c1` (position 1 in `sourceCommits`): Setup has ordinal 2 in `(1, 2]` → **yes**; Usage has only ordinal 1 → **no**; Todo has no ordinals → **no**. Had the squashed package shipped no summary, all three would be **unknown**, not "no".

### 8.4 Extraction check

Extracting Package 2 with Python's `zipfile` and running `git read-tree HEAD`: status goes from 10 lines to 4 untracked paths, all under `.mdpkg/` (`manifest.json`, `history.json`, `history/bindings.json`, `history/ranges/ff2689cd…json`); `git fsck --full --strict` is clean; `HEAD` resolves to `b414f39b…981c`, equal to `current`. Package 1 behaves the same with 2 untracked paths. 7-Zip 21.07 lists both packages as ordinary 12- and 10-entry archives.

### 8.5 Reproduction

```powershell
python docs/spec/worked-example.py            # writes docs/spec/worked-example-out/ and worked-example.json
```

The script's ATX-only outline scanner is valid for this fixture (no fences, Setext headings, lists or HTML) and is not the CommonMark resolver §6.1 requires.

---

## 9. Rejected alternatives, collected

Every alternative any of the four investigations measured or argued against, in one place. "Why" is the measured or demonstrated reason.

**Container and compression**

| Alternative | Why rejected |
| --- | --- |
| Solid compression: one `payload.tar.gz` / `tar.zst` member inside ZIP | Only 6.94% / 1.55% above whole-gzip, but a reader sees one member and must decode the whole stream (9.4 MB, 50–70 ms) to reach one section; ordinary ZIP tools cannot list the documents |
| 64 KiB tar.gz blocks plus a stored block map | Saves 28.48% npm / 7.06% Rust over per-file ZIP and keeps bounded reads, but gives up ordinary file listing and independent entry decode; the container decision makes the current view the working tree, which needs per-file entries. Remains the measured fallback if package size ever outranks browsing |
| Per-file DEFLATE plus a duplicate solid tar.gz | Both access modes at the sum of their costs: 176.75% / 118.92% above whole gzip |
| Brotli, zstd or xz as mandatory codecs | No native `DecompressionStream` for them across browsers (Brotli only in Firefox 147+ / Safari 18.4+); WASM decoders cost 82–100 KB gzipped; Brotli-11 entries plus decoder are larger than gzip entries on a cold npm reader |
| Trained zstd dictionaries | A 16 KiB dictionary closes 45% of the solid gap; 64 KiB closes 6% npm / 60% Rust and makes the small holdout larger; introduces a cache dependency the portable package must not require |
| gzip members nested in ZIP entries | ZIP already frames and CRCs each entry; raw DEFLATE (method 8) is the same algorithm with 18 fewer bytes per entry |
| Whole-stream early exit or streaming to reach a section | Processes all preceding history and does not verify the trailer checksum; not isolated access |
| Raw version byte before `PK` (original CARD-0001 requirement) | Viable only with corrected offsets; stale offsets break Explorer, 7-Zip and fflate; lost by every rewrite from extracted files; changes leading magic |
| EOCD archive comment as a version carrier, variable `MDPKG/1` | Lost by 3 of 5 rewrites; defeats a fixed 22-byte tail probe, whose fallback reads 57,797 / 14,715 pack bytes |
| EOCD comment, fixed 8-byte binary with escalating version field | Same 2-of-5 rewrite survival; saves 37 bytes and 0 requests per cold read; cannot remove the recoverable reader tier; the escalating field is worse than a plain `uint32` in a pre-allocated slot (12 bytes versus 9 for the same range) |
| NTFS alternate data streams or POSIX xattrs for the version | Outside the portable byte stream; lost by `ReadAllBytes`, ZIP round trips and HTTP |
| Custom ZIP extra fields or entry comments as authority | Dropped or selectively copied by rewrites; no registered ID; never the sole carrier |
| Manifest codec declaration, document index, per-document digests, entry counts, self-hash | Each duplicates ZIP or Git state and can disagree with it; measured +42, +3,527 / +22,228 and +9,086 / +65,776 bytes |
| `content/` prefix for documents | +1,328 / +10,400 bytes and the extraction stops being a working tree at natural paths; a reserved region is still needed |
| `.git` first, manifest last, streamed manifest | Forfeits the no-`.git` span (158,993 / 3,312,561 bytes) or the 79-byte typing path |
| Shipping `.git/index` | 9,043 / 63,610 bytes to save one `git read-tree`; binds host stat data |
| A directory as the exchange form | No central directory, order, atomic swap or single identity; it is the extraction, not a competitor |
| Atomic in-place update | Not attempted; rewrite the file |
| Whole-response HTTP `Content-Encoding` for range access | Changes the byte offsets ranges apply to; serve the file unchanged |
| DEFLATE for `.pack` and `.idx` entries | 2.44% npm saving only by inflating the whole member before any access; Rust gets larger |

**History**

| Alternative | Why rejected |
| --- | --- |
| Git bundle (`history.bundle`) as the primary representation | 7.57% / 0.74% smaller than the packed repository but ships no index (an `indexPack` pass of 141–667 ms in the browser), needs an import before it is queryable, and a bundle made from a shallow source passes `bundle verify` yet fails to fetch |
| Flat base plus ordered diffs with a commit-record file | 13.50% / 3.95% larger at 32 commits; arbitrary revisions need chain replay; no standard object identity or tooling |
| A bespoke "mini-git" object DAG | No measured size failure to justify it; surrenders interoperability; still needs every coverage and section rule in §5–§6 |
| Reverse-diff flat layout, bundle plus shipped index | Different representations, superseded by adopting a real repository; the latter costs about the same as the packed repository |
| Pack window 250 | 2.44% smaller on npm, 0 on Rust; does not approach solid |
| Preserving the upstream DAG's second parents | Not measured; retaining them can pull unrelated content into the package. Listed as open in §11.2, not rejected |
| Git notes or commit trailers as the sole carrier of summaries and provenance | Notes live on separate refs that rewrites and clones silently omit; trailers are editable prose unsuited to ordered per-entity data |
| Inferring squash from parent count or message; inferring completeness from the absence of `.git/shallow` | Both demonstrated false with real Git: identical object IDs for squash and ordinary commits; synthetic roots report not-shallow |
| Prerequisite (incremental) bundles as truncated packages | Prerequisites are not shallow boundaries; the bundle is not standalone |

**Addressing**

| Alternative | Why rejected |
| --- | --- |
| Whole-file hash or commit ID as section identity | Changes on unrelated edits |
| Line, byte offset or heading occurrence as identity | Moves on insertion; the repeated-heading counterexample selects the wrong section |
| Heading slug or ancestor trail *without* exceptions | A rename is a lookup failure instead of "changed"; duplicates need an unstable tie-break |
| Section content hash as identity | Edits make the identity disappear; identical copies collide |
| Full producer-UUID identity maps (`.mdpkg/address/config.json`, `ids/<shard>.json`) | +31.60% / +17.21% on snapshots, +41% / +20% over 33-snapshot histories, for advantages (fixed-size references, direct lookup) the sparse ledger prices at +2–7% |
| Stored per-entity digests | +53.38% / +30.67%; a stored digest is at best a cache hint and must be recomputed to be trusted |
| A current-map mirror under `.mdpkg/current/address/` | Duplicates metadata; unnecessary once the plain entries are the working tree |
| The ledger inside the manifest, or as an untracked sidecar | Not O(1) (4,640 / 73,838 bytes at 5%); an untracked sidecar has no history and does not survive squash as data |
| **Zero stored identity metadata with read-time Git-history walking** (`381b874`) | Measured and closed: 4 wrong identity matches per 192 queries at both thresholds (displaced duplicates, same-slot replacement, an `R099` boilerplate replacement); a full walk of 512 transitions reads 2.76 MB and takes about 10.1 s; a bounded walk returns `history-budget-exceeded`; every collapsed range is `unmatched`, and a rename/revert, a delete/recreate and a never-deleted history squash to the identical commit; and every current-reference resolution would need the pack intact. It cannot deliver "renamed resolves as the same entity, changed". The requester reaffirmed confirmed exceptions after seeing both measurements |
| Automatic `git diff -M` (any threshold) or projected-section similarity as identity authority | Detects file pairs, not sections; best hybrid 10 correct / 1 wrong / 4 missed of 14; a similarity score cannot tell replacement from continuity or produce split/merge lifecycle records |
| Endpoint-only comparison for the touched query | Cannot see edit-then-revert or delete-then-recreate |
| A touched-ID union without ordinals | Cannot answer interior checkpoints |
| Rendered-output review inside the source profile | Needs a separate context digest and invalidation policy; would conflict with insensitivity to edits elsewhere |
| Fixed 256-way sharding | Moot without full maps; was 58.65% overhead on the small corpus |
| `observedAt` as part of the review key | It is evidence for the temporal query, not identity; kept outside the key |
| Abbreviated Git hashes; the `v1` UUID reference grammar | Ambiguous; superseded by computed roots |

---

## 10. Decisions taken in this specification under stated defaults

Where the investigations established what must be declared but not its exact shape, this document chose a shape. Each is reversible before implementation; each is marked D-*n* so a reviewer can find it.

- **D-1** `addressing.coverage` takes the values `complete | partial` (was `confirmed | best-effort | none` in container.md, C6).
- **D-2** `addressing.anchor` and `addressing.digest` are required manifest fields (C7).
- **D-3** `history.transform` is an ordered list; empty means the retained graph is the original; values are `projected` and `squashed`. Synthetic roots are expressed by `history.coverage: truncated` plus `root: synthetic` in `history.json`.
- **D-4** The `history.json` field set of §5.3, including `retainedCommits` as a count (as the container fixture measured) rather than a list.
- **D-5** Range summaries are keyed by origin root, carry `anchor`, and are named by the SHA-256 of their bytes; `bindings.json` has the three-field shape of §5.4.
- **D-6** All five reference kinds share the `v2` path segment; commit, diff and hunk forms are carried over unchanged (C10).
- **D-7** Exactly one branch ref; `HEAD` symbolic to `refs/heads/main`; its target equals `current` (C11).
- **D-8** The pack reverse index MAY be present and MUST NOT be required (C12).
- **D-9** Working-tree entries are written in bytewise path order. Recommended, not required.
- **D-10** Data descriptors are permitted on every entry except the manifest (container.md: "everything after it may stream").
- **D-11** The reserved-prefix check is applied after NFC and case folding, consistent with the uniqueness rule.
- **D-12** `.mdpkg/address/overrides.json` MUST be absent when it would have zero entries.
- **D-13** `.mdpkg` is used as the working file extension throughout; registration is open (§11.1).
- **D-14** Version 1 packages use SHA-1 object IDs. The `sha256-` prefix is reserved in the grammar because the investigations qualified every ID, but no SHA-256 repository was packaged or read; conformance for SHA-256 packages is open (§11.2).
- **D-15** The manifest's `mdpkg` key is written first and every other key sorted, exactly as container.md measured.
- **D-16** Entry names MUST be unique case-insensitively: Unicode NFC followed by simple case folding (§3.6). This is adopted from the documented collision risk and the measured NTFS `README.md` / `readme.md` collision (container.md), not from a measured NFC/NFD collision on a normalization-insensitive filesystem; that verification remains open (§11.1).
- **D-17** Line endings are normalized to LF on write. A conforming producer normalizes CRLF and lone CR to LF before storing content, so both ZIP entry payloads and Git blobs hold only LF-terminated text; the source digest profile `cm0312-source-lf-v1` normalizes CRLF and lone CR to LF again when decoding for hashing (§6.1 rule 1), which is a no-op on conforming stored content and a defensive fallback against nonconforming input. This is the format's only EOL rule, and it now governs stored bytes, not just the digest input. Scope: this rule covers the content the current view is defined to hold — Markdown documents and the JSON control files under `.mdpkg/` (§2, §4, §6.3), all of which are UTF-8 text. Version 1 defines no mechanism for tracking an opaque or binary entry in the current view, so no binary-detection heuristic (Git's own NUL-in-a-prefix check, or otherwise) is needed or specified; a future version that admits tracked binary content would have to add one before D-17 could apply to it unmodified.
- **D-18** Extraction never converts line endings; a conforming extractor emits the stored LF bytes unchanged on every platform (§3.8). D-17 normalizes on write and nothing normalizes on read, so this mirrors `core.autocrlf=input`, not `core.autocrlf=true`: there is no platform-native checkout, because the format ships no `.gitattributes` or filter configuration to drive one, and a byte-for-byte match between the extracted file and the tracked blob is what lets §6.1 hash the extracted file directly instead of reconstructing what checkout did to it.

---

## 11. Open questions

### 11.1 Explicitly carried forward, undecided

These were deferred by container.md and are **not** decided here.

1. **ZIP64 policy.** Behaviour past 4 GiB or 65,535 entries. Options are: permit ZIP64 with mandatory locator handling (readers must follow the 20-byte locator before the EOCD to the ZIP64 EOCD, and the small tail read no longer suffices), or exclude it from the profile with a hard producer limit. Today's only tested behaviour is rejection by the evidence reader. Nothing in the corpora approaches the limits.
2. **Media type and file extension registration.** What a `.mdpkg` file is called and served as. A media type of the form `application/vnd.…+zip` is unregistered. Because the file must begin with `PK` for ordinary tools to work, extension- and sniffer-based dispatch will sometimes see a generic ZIP; that is accepted, but the names are not chosen.
3. **Cross-platform normalization testing.** No macOS, APFS, HFS+ or other normalization-insensitive filesystem was reachable. The NFC-plus-case-fold uniqueness rule itself is decided (D-16); what remains open is verifying it against a real NFC/NFD collision, rather than the measured NTFS case collision it was adopted from. Windows 11, newer 7-Zip, macOS Archive Utility and Info-ZIP `zip` as a rewrite tool are untested.

### 11.2 Raised by the investigations and never closed

1. **SHA-256 Git object format.** Every probe used SHA-1; `sha256-` qualified IDs are grammatical but unexercised (D-14).
2. **Browser history reader.** The measured standard reader (isomorphic-git) costs 53,773 gzipped JS bytes, reads the entire pack, and uses a bundled JavaScript inflater even where native `DecompressionStream` exists. A narrower native-stream reader of the standard format was proposed and not built; a range-capable pack reader is future work. Whether a browser reader for `at=` / `commit` / `diff` references is required at all is an owner decision.
3. **Mobile and WebView qualification.** All decode, memory and timing measurements are from one Windows desktop. Safari, iOS, Android, low-memory devices and minimum WebView versions for `deflate-raw` are source-backed, not measured.
4. **Preserving the upstream DAG.** Version 1 retains a first-parent projection with new commit IDs. Keeping original commit IDs and merge second parents needs a scope decision (it can pull unrelated content) and its own benchmark.
5. **Range-summary size at scale.** Measured on a three-transition fixture only. Long histories, deeply nested documents (parent-inclusive scopes create ancestor events) and 64-hex root keys need an event-size benchmark before unlimited temporal retention is promised. A bounded union is smaller but cannot answer interior checkpoints.
6. **Ledger density.** The single-blob ledger decodes to 27,769 / 321,136 bytes at 20% exceptional in the histories. Sharding, prefix sharing or range bindings for whole-file moves are unmeasured; at what density they become necessary is unknown.
7. **Archived patch retention.** Optional evidence storage for hunk references is defined (§5.5) but not priced.
8. **Producer correspondence workflow.** How a generic Git import presents rename candidates for confirmation, and how `partial` coverage is bounded, is tooling design, not format. The format only requires that unconfirmed guesses never reach the ledger as `to` entries.
9. **Merge-parent temporal queries.** `walk` is `first-parent` only. Touched queries across other merge paths need explicit edge coverage and a defined query.
10. **Rendered-output and dependency review.** A versioned context digest for links, includes and reference definitions is out of scope for `cm0312-source-lf-v1` and would need its own invalidation policy.
11. **Tombstone retention bounds.** If a producer bounds how long `dead` and `unknown` records are kept, entity coverage must be declared as bounded; the declaration shape is not defined.
12. **Fork and cross-namespace provenance.** A copy into an unrelated lineage gets a new namespace; whether and how a fork can declare shared lineage identities is undefined.
13. **Reader versus validator obligations.** Whether an ordinary reader must verify that current-view entries hash to the tip tree's blobs, or may trust the manifest and leave that to validators, is a conformance-level question this document does not settle. §7.1 describes both paths.
14. **HTTP range deployment.** The protocol conditions (strong validator, no whole-response content encoding, CORS exposure of `Content-Range` and `ETag`) were measured over loopback in Node, not in a cross-origin browser.
15. **Whether ordinary ZIP readers must be able to browse current Markdown** was answered *yes* by adopting the working tree (C4); the 64 KiB block hybrid remains the measured alternative if that answer is ever reversed.
