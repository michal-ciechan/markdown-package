# markdown-package format specification, version 1

Status: consolidated specification, draft 2, breaking pre-release revision, 2026-09-12. The revised rules below are adopted; application implementation is still in progress under [CARD-0052 S2–S6](superpowers/plans/2026-09-12-card-0052-deferred-history-breaking-spec-plan.md). Existing released CLI/Core/Reader/Reviews/browser code does not yet implement this draft. S1 changes the specification and documentation fixtures only; these artifacts are not a claim of product readiness.

Historical sources: their always-Git findings and measurements retain their original interpretation. The revised normative mode rules supersede unconditional repository/history claims. Sources, all in `docs/investigations/`, each with its reproducible evidence directory beside it:

| Investigation | Commits | What it settled |
| --- | --- | --- |
| [compression.md](investigations/compression.md) (CARD-0002) | `7c32a97` | ZIP as the container, per-entry raw DEFLATE (method 8) at producer level 6 or stored (method 0) when smaller; nothing solid; no mandatory codec beyond DEFLATE |
| [history.md](investigations/history.md) (CARD-0003) | `06aea0f` | A real, curated, packed `.git` directory inside the ZIP is the history representation; the pack is stored, not deflated; every package in that earlier encoding carried an explicit history coverage descriptor (now Git mode only) |
| [addressing.md](investigations/addressing.md) (CARD-0004) | `4b12c42`, `d0590d0`, `381b874` | Section identity is a computed default anchor plus a sparse, Git-tracked table of producer-confirmed exceptions; digests are computed at read time; the zero-metadata read-time Git-walking alternative measured in `381b874` is closed and rejected (§9) |
| [container.md](investigations/container.md) (CARD-0001) | `8d05889`, `d49793e` | One manifest-first ZIP; `.mdpkg/` and `.git/` reserved; two-tier reader (79-byte offset-0 typing, central-directory fallback); the EOCD comment is rejected as a version carrier in both its variable-length and fixed-length forms |

Non-normative: [`docs/spec/generator-cli.md`](spec/generator-cli.md) is a tool reference for the current CLI and proposed revised behavior; it describes one producer, not the format, and this document governs wherever the two differ.

The words MUST, MUST NOT, SHOULD and MAY are used in their usual normative sense. "Producer" means whatever writes a package; "reader" means whatever opens one; "validator" means a reader that additionally proves internal consistency. Snapshot mode means `current.kind: snapshot` with `history.mode: none`; Git mode means `current.kind: commit` with `history.mode: git`.

---

## 1. Ground truth and resolved conflicts

### 1.1 What the consolidation brief assumed versus what the sources say

| The brief said | What the investigations actually established | Effect on this spec |
| --- | --- | --- |
| The addressing card uses a "read-time git-walking approach" | The **final** addressing design (`d0590d0`, reaffirmed by the requester after `381b874`) does not walk Git history at read time. It reads one ledger and one document from the selected tree. The Git-walking design is the **rejected** zero-metadata alternative. | §6 specifies the non-walking resolver. Walking appears only in §9 as a rejected alternative. |
| Per-entry ZIP DEFLATE, the pack's internal compression and read-time digests might do redundant work | They act on disjoint bytes: ZIP DEFLATE covers the current-view entries, pack zlib and deltas cover history objects, and digests are computed once over one decoded document per resolution. The pack and index are stored, so no byte is compressed twice. | §7.1 states the layering and what each read path decodes. |
| Walking Git history might require the `.git` tree to be intact even in the fast path | Current-reference resolution touches zero `.git` bytes (measured: 6 requests / 10,369 bytes for npm, 54,440 for Rust, with 0 pack bytes). In Git mode, historical references and Git/origin validation need the pack; snapshot verification has no pack. The typing tier (offset 0 versus directory walk) is orthogonal to whether the pack is touched. | §7.2 read-path table. |
| The manifest must declare how to use `.git` and the overrides together | The container's 287-byte manifest lacked the anchor and digest profile identifiers the addressing design needs to compute default roots. | §4 adds `addressing.anchor` and `addressing.digest`; conflict C7 below. |

### 1.2 Conflicts between the four investigations and how each was resolved

Each of these is a real disagreement between two source documents. None was papered over; the later, measured finding wins unless stated otherwise.

- **C1. EOCD comment.** compression.md recommended "optionally mirror `MDPKG/<version>` in EOCD". container.md measured that a comment defeats a reader's fixed 22-byte tail probe (57,797 npm / 14,715 Rust bytes of pack read for a query that needed none), survives only 2 of 5 archive rewrites, and saves at best 37 bytes per cold read. **Resolved: no comment.** If one is present it is a hint; disagreement with the manifest is a rejection; absence is never a rejection (§3.5).
- **C2. Raw version byte before `PK`.** The original CARD-0001 brief required a first-byte version. compression.md showed it is viable only with corrected offsets and survives no rewrite; container.md replaced it with manifest-first typing. **Resolved: the file begins with `PK\x03\x04`; typing is the 79-byte check in §3.1.**
- **C3. Bare versus non-bare `.git/config`.** history.md's option A shipped a portable bare config. container.md ships `core.bare = false` so that the extracted directory is an ordinary working tree. **Resolved: non-bare in Git mode** (§5.1). This is part of the 1,004 / 1,020-byte difference between the two cards' package totals.
- **C4. The duplicated current-file view.** history.md measured "A + current files" as a straightforward duplication and explicitly did not recommend it as an optimised final layout. container.md adopted it and proved it is the working tree of the manifest's commit. **Resolved: adopted.** The current view is mode-independent; in Git mode it duplicates the tip tree and the pack is the history read path. Snapshot mode has no pack. The cost is the "current files alone" row: 128,359 npm / 3,350,579 Rust bytes on the corpora. This also answers *yes* to whether ordinary ZIP readers must be able to browse the current Markdown; the 64 KiB block hybrid in §9 remains the measured alternative if that answer is ever reversed.
- **C5. Addressing's own headline.** The text of addressing.md at `381b874` calls the zero-metadata mechanism "the primary candidate" and says the refinement "explicitly excludes even the sparse table". The requester, having seen both results, reaffirmed the sparse confirmed-exception design. **Resolved: sparse confirmed exceptions are final** (§6). The zero-metadata mechanism is listed as rejected in §9 with its measured failures. addressing.md's header is therefore out of date relative to this decision; this specification is authoritative.
- **C6. `addressing.coverage` values.** container.md proposed `confirmed / best-effort / none` while the zero-metadata contract was still open. With that contract closed there is one resolution contract, and the field only needs to say whether confirmed correspondence covers the whole retained history. **Resolved: initial snapshots have `complete` addressing; Git mode uses `complete | partial`** (§4), with per-range transition detail in `.mdpkg/history.json`.
- **C7. Profile identifiers in the manifest.** addressing.md states the manifest "pays 34 fixed bytes to select the anchor profile"; container.md's 287-byte manifest has no such field. A reader cannot compute a default root without the anchor profile and the namespace, and cannot reject a foreign-profile reference without the digest profile. **Resolved: `addressing.anchor` and `addressing.digest` are required manifest fields** (§4).
- **C8. Where range summaries and squash bindings are bound.** addressing.md says to "bind those member paths and hashes in the first manifest". container.md requires the manifest to be O(1) in package size. **Resolved: in Git mode the manifest points at `.mdpkg/history.json` through `history.detail`, and that file lists every summary, patch and binding entry with its hash** (§5.3). The manifest stays fixed-size.
- **C9. "DEFLATE every entry" versus "store the pack".** compression.md's rule is method 8 or stored-when-smaller; history.md measured that deflating the pack saves 1.75% on npm (2,789 bytes of 159,296) only by forcing whole-member inflation and makes Rust larger. **Resolved: the manifest is always stored; Git-mode `.pack`, `.idx` and `.rev` are always stored; every other entry follows the smaller-of rule** (§3.3).
- **C10. Reference grammar version.** addressing.md defines a `v1` UUID grammar and then a `v2` computed-root grammar for document and section references, leaving commit, diff and hunk references "exact as before". **Resolved (stated default D-6): one `v2` path segment for all five reference kinds; the commit, diff and hunk forms are carried over unchanged** (§6.4).
- **C11. Allowed refs.** history.md asked for allowed refs and object format to be defined; container.md shipped only `refs/heads/main` and asserted `HEAD` equals `current` without stating it as a rule. **Resolved (D-7): in Git mode exactly one branch ref, `HEAD` symbolic to it, and its raw target MUST equal the SHA-1 portion of `current.id`** (§5.2).
- **C12. The pack reverse index.** container.md shipped the `.rev` file `git index-pack` produced and noted it is derivable. **Resolved (D-8): MAY be present, MUST NOT be required.** The worked example omits it.

---

## 2. Terminology

`markdown-package/1` is the only package wire token in this draft. Both
current-state kinds use it. Its earlier pre-release string-valued `current`
shape is superseded; no alternative manifest interpretation is defined.
The 79-byte check establishes container typing, not manifest-schema validity.
Conforming and recoverable openers MUST validate the same revised schema.

- **Publication**: Handing an immutable package state to another consumer, including another application or a review recipient. Private editing and saving a draft do not constitute new published checkpoints. Re-emitting identical state is not a successor.

- **History-free snapshot**: The first published state of a newly established lineage, with `current.kind: snapshot` and `history.mode: none`. It has no repository, commit metadata or retained transition history.

- **Package identity**: The triple `(namespace, current.kind, current.id)`, compared by exact string values. The namespace alone and the ID alone are insufficient.

- **Current state**: Exactly `{id, kind}`. `kind: snapshot` names a snapshot state digest; `kind: commit` names a retained Git commit. A state digest is not a Git object ID.

- **Package**: one ZIP file conforming to §3. The working file extension is `.mdpkg` (registration is open, §11.1).
- **Current view**: The regular-file ZIP entries containing the immutable captured content, including a declared address ledger and review document. In Git mode they MUST equal the complete working tree of `current.id`; in snapshot mode they MUST hash to `current.id` under §4.1.
- **Container-level entries**: The manifest and, only in Git mode, the history descriptor and declared summary/binding/patch sidecars. They are not part of the current view. An origin record resides in the history descriptor, not in a tracked file.
- **Extractor**: any tool that writes a package's ZIP entries out as files. Unlike a producer, reader or validator it is not package-aware and the format cannot constrain it; where this document places a requirement on an extractor (§3.8, D-18a) it is stating a property of a conforming extraction, and a tool that does otherwise has not produced one. Info-ZIP `unzip -a` was named here as such a tool and is not one: it converts only entries whose ZIP internal file attributes declare them text, and a conforming package declares every entry binary (D-19) and stores only LF (D-17), so all four combinations of those two conditions extract byte-exact — conversion happens in exactly one cell, CRLF content in a text-flagged archive, and a conforming package reaches neither half of it. The measured counterexample is `unzip -aa`, which forces text mode on every entry regardless of what the archive declares: it left all four documents and all three `.git/` text files byte-identical and stripped one CR byte each from the pack and its index, leaving `git fsck` at exit 70.
- **Curated repository**: The existing allowed `.git/` entries. They are REQUIRED in Git mode and FORBIDDEN in snapshot mode.
- **Namespace**: the lowercase UUID identifying a package lineage. All addressing roots are derived within it.
- **Entity**: a document, a document's permanent preamble, or a heading section. Each has a **locator** (§6.2) and, at any snapshot, a **scoped digest** (§6.1).
- **Root**: the 64-hex SHA-256 that is an entity's stable identity: its default root unless the ledger says otherwise.
- **Qualified object ID**: a Git ID, `sha1-<40 lowercase hex>` in this revision. The URI grammar reserves `sha256-<64 lowercase hex>` for future Git object formats, which remain unsupported. Snapshot IDs are separately qualified SHA-256 state digests, never graph endpoints. Abbreviated hashes are invalid.
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

A reader MUST NOT infer format version 1 from the presence of `PK` alone. A string-valued `current`, missing discriminator, null identity or mixed mode is a schema error after typing, not a recoverable older format. Both tiers validate the same revised schema.

### 3.2 Entry order

```text
.mdpkg/manifest.json                         first, stored
<all current-view files>                     recommended bytewise path order
[Git mode only: history descriptor and declared history sidecars]
[Git mode only: curated .git entries, index before pack, pack last]
central directory
EOCD
```

The normative order rules are:

1. The manifest MUST be the first entry at offset 0.
2. In Git mode the pack MUST be the last entry; every entry needed for current
   document/section resolution MUST precede it.
3. Snapshot mode has no pack or history entries; it has no corresponding last
   data-entry rule. Readers use the central directory in either mode and MUST
   NOT assume current files are in sorted order.

### 3.3 Compression per entry

| Entry | Method |
| --- | --- |
| `.mdpkg/manifest.json` | `0` (stored) always in the conforming tier (§3.7): readable with no decoder |
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
- Every central-directory record MUST set the internal file attributes field to `0`, i.e. bit 0 — the text flag — clear, on every entry (D-19). This is what makes a conforming package immune to Info-ZIP `unzip -a` and to any other extractor that converts line endings only for entries the archive itself declares to be text: with the bit clear there is nothing for such a mode to convert, whatever the host's native terminator. D-17 already removes the CR bytes that conversion would act on, so the two rules protect extraction independently, and this is the one that still holds when a package's content is nonconforming. Readers derive nothing from the field; it exists to constrain extractors, and §4 makes a validator check it.
- The EOCD record MUST have a zero-length comment. A reader whose fixed 22-byte tail read does not find a valid EOCD MAY fall back to a 65,557-byte suffix; if it then finds a comment it MUST treat any version token in it as a hint only: disagreement with the manifest is a rejection, absence is not.
- ZIP64 sentinels: no policy is decided (§11.1). The only tested reader behaviour is rejection.

### 3.6 Paths

A current file's canonical path is its exact validated UTF-8 ZIP entry name.
Git mode records those same path bytes in the tip tree. Snapshot hashing and
later materialization MUST NOT apply Unicode normalization or case conversion
to path bytes. NFC-plus-simple-case-fold remains the collision check, not a
path-rewriting rule.

Producer requirements:

- Forward slash only; no leading slash; no `.` or `..` component; no drive letter; no backslash. Every tested extractor turns `a\b.md` into a directory `a/`.
- UTF-8 names with general-purpose bit 11 set whenever a name is not pure ASCII.
- Entry names MUST be unique under Unicode NFC followed by simple case folding (D-16). This is stricter than Git and deliberately so: `README.md` plus `readme.md` is a valid Git tree, and every tested extractor and Git's own NTFS checkout silently keeps one of the two.
- `.mdpkg/` and `.git/` are reserved after NFC and simple case folding. No current path may use either prefix except the declared fixed address/review paths below. Producers MUST reject colliding source paths; source relocation must be explicitly declared where supported.

The declared `.mdpkg/address/overrides.json` and
`.mdpkg/review/comments.json` are current-view files. Their bytes contribute
to snapshot identity in snapshot mode and are tracked at every applicable
commit in Git mode. This gives their edits state identity in both modes and
prevents undeclared sidecar edits from escaping identity. No other current
file under `.mdpkg/` or `.git/` is admitted by this revision.

The review detail path is fixed to the already supported
`.mdpkg/review/comments.json`; an alternative path requires a later spec change.
Producers omit explicit directory records. A recoverable archive's valid empty
directory records contribute no current-file record or identity; existing path
validation still applies. `.git/` directory records are also forbidden in
snapshot mode. Nonempty directory records and file/directory path conflicts
are invalid. Directory records cannot conceal a regular file from hashing.

Entry content is normalized to LF line endings on write (D-17), for every entry except those under `.git/`; beyond that EOL rule, the container does not otherwise normalize content, and the source profile in §6.1 decides what a review covers.

### 3.7 Two-tier reader

Ordinary tools reorder entries and recompress them: of five real rewrites (Python rebuild, 7-Zip add, PowerShell `Compress-Archive`, fflate round trip, and the as-produced case), manifest-first order survived two and the manifest's *bytes* survived all five. The reader is therefore specified in two tiers:

1. **Conforming**: §3.1 passes at offset 0. The manifest is read from the stored first entry; everything else proceeds from the central directory.
2. **Recoverable**: §3.1 fails, but the central directory contains an entry named exactly `.mdpkg/manifest.json` whose decoded bytes begin with `{"mdpkg":"markdown-package/1"` and parse as a valid manifest. The reader MAY proceed, but the package is nonconforming: it SHOULD be re-emitted in conforming form by a package-aware producer rather than passed on. A recovered package's entry order gives no bounded-read guarantees.

A repacked archive that preserves payload bytes is not a format-preserving package rewrite. If files change, the ledger, digests and history sidecars can only be regenerated by a package-aware producer.

### 3.8 Extraction and optional Git working tree

Extraction in either mode writes the exact stored current-file bytes.
Snapshot mode produces ordinary files with no repository; Git commands are
unavailable until an explicit materialization operation has emitted a Git-mode
package. In Git mode, the package ships no working index (`.git/index`), and `git read-tree HEAD`
after extraction recreates it without changing current files. The existing
`fsck`, `HEAD`, container-sidecar and host checkout guarantees apply only in
Git mode, with `HEAD` resolving to `current.id`.

In Git mode extraction has two layers, and what the format guarantees is different at each. The package ships no `.gitattributes` and no smudge/clean filter configuration, and it declares no `core.autocrlf`; that is a deliberate position about both layers rather than an omission.

**The unpack is byte-exact, on every platform (D-18a).** A plain ZIP unpack rewrites no byte of any entry, and a conforming package gives an extractor nothing to act on even in a mode that would convert: D-17 leaves no CR byte to remove, and D-19 leaves no entry flagged as text to convert one in. So a conforming extractor MUST NOT convert line endings, and every extracted file is exactly the LF-normalized bytes D-17 put in the ZIP entry and, in Git mode, the Git blob. In Git mode, `git read-tree HEAD`, the second half of the procedure above, is byte-exact too under every host configuration, because it writes only the index and never touches the working tree already on disk. Measured over nine real extractor invocations on a Windows host: not one added a CR byte in any region, and seven reproduced all eleven entries byte for byte. The two failures were not EOL failures of the current view — `unzip -aa`, which ignores the D-19 flag and forces text mode on every entry, left all four documents intact and truncated the pack and its index by the single CR byte each happened to contain (`git fsck` exit 70), and Windows Explorer refused the `.mdpkg` extension outright and wrote nothing. Not measured: a native DOS-port Info-ZIP, the only build that would attempt LF→CRLF at this layer.

**In Git mode the Git checkout after it follows the host, and the format pins nothing (D-18b).** §5.1 fixes the bytes of `.git/config` and those bytes declare no `core.autocrlf`, so the host's system or global setting governs the extracted repository from the moment `read-tree` finishes. Under `core.autocrlf=false` or `input` — the `input`-like behaviour D-17 mirrors, a write-time normalization with no matching read-time reversal — `git checkout -- .` and `git clone` preserve every byte. Under `core.autocrlf=true`, the Git for Windows installer default, they do not: measured at 0 of 4 documents byte-identical, 25 CR bytes added by each of checkout and clone. **The format does not pin `core.autocrlf` in the shipped `.git/config`, and that is intentional.** A repository-level pin was measured and works, but a pin is a filter configuration, and this section's whole position — that the package ships none, so a platform-native checkout would need a mechanism this container does not define — is what keeps the format out of the host's line-ending policy in both directions (§9). The byte-for-byte property is therefore a guarantee of the unpack, not of a working tree a consumer has since checked out with its own Git.

Readers MUST NOT create a repository merely to browse or extract snapshot files.

In Git mode nothing in addressing rests on that distinction: a converted file is exactly the stored bytes with LF replaced by CRLF, §6.1 rule 1 re-normalizes, and every digest resolves unchanged. What a converting checkout costs is the shortcut the current view exists to give a reader for free — that the extracted file *is* the tracked blob, byte for byte, so hashing it under §6.1 needs no reconstruction of what checkout did to it. A consumer who wants that shortcut sets `core.autocrlf` to `false` or `input` in the extracted repository, as it would for any other repository of LF-normalized text; a consumer who wants CRLF locally applies its own tool's conversion (a Windows editor's line-ending setting, `core.autocrlf=true`, and so on). Either way the conversion is outside the format, exactly as it is outside Git's own object model.

---

## 4. The manifest

`.mdpkg/manifest.json` is canonical JSON with one deliberate exception: the `mdpkg` key is written first so it lands at byte 50 of the file. All other keys are in sorted order. It MUST be O(1) in package size: a field earns its place only if a reader needs it before it can do anything else, it must be readable without a decoder, and it does not grow with the package.

This complete canonical
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
admitted. The canonical serialization, manifest-first exception
and O(1) admission rule above apply. The nested rules are:

| Field | Exact rule |
| --- | --- |
| `current` | Required object with exactly `id` and `kind`. Neither is nullable. |
| `current.kind` | Exactly `snapshot` or `commit`. |
| Snapshot `current.id` | `sha256-` plus exactly 64 lowercase hex characters, verified by §4.1. |
| Commit `current.id` | `sha1-` plus exactly 40 lowercase hex characters, naming an actual retained commit. SHA-256 Git repositories remain outside this revision. |
| `history`, snapshot | Exactly `{"mode":"none"}`. No `coverage`, `detail`, `transform` or origin fields, even as null/empty values. |
| `history`, commit | Exactly `coverage`, `detail`, `mode`, `transform`; `mode` is `git`; the other values use the Git history definitions below and `.mdpkg/history.json` detail path. |
| `addressing` | Exactly the existing four required fields. `overrides` is explicitly null or the fixed ledger path. Snapshot coverage is always `complete`; Git coverage remains `complete` or `partial`. |
| `review` | Exactly `detail`, `of`, `shape`, when present. `detail` is the fixed review-document path. `shape` is `delta` or `bundled`. |
| `review.of` | Required `namespace` and typed `current` with the same state-ID rules; optional `packageDigest`, `packageBytes`, `dispatch` retain their existing evidence-only meanings. No other keys. |

`namespace` is a lowercase UUID. `addressing.anchor` is `cm0312-trail-source-v1`;
`addressing.digest` is `cm0312-source-lf-v1`. Addressing coverage means complete
initial correspondence for a snapshot and complete or partial confirmed transitions
for Git history. A null `overrides` positively declares no exceptions.
In Git mode `history.coverage` is `complete`, `truncated` or `unknown`;
a synthetic root requires `truncated`. `history.transform` is an ordered array
of `projected` and `squashed`; an empty array declares no graph transformation.
`history.detail` is exactly `.mdpkg/history.json`.

`review.of.packageDigest` is an optional qualified SHA-256 archive digest;
`packageBytes` is an optional nonnegative integer archive length. Both are
recommended corroborating transport evidence, never identity. `dispatch` is an
optional opaque string, never interpreted or followed as a path or URL.
The correlation key is `(review.of.namespace, review.of.current.kind,
review.of.current.id)`. Its current object follows the same exact typed schema.
A matching identity with different digest/length is re-emission evidence, not
identity mismatch. `review.of.current` is not changed by materialization.

Fields deliberately absent: codec declarations (the directory gives methods),
a second document index (the directory is the index), per-document digest tables
(snapshot records are computed), offsets/counts (EOCD), and a raw package
self-hash. §4.1 is a non-self-referential state hash, not a ZIP self-hash.

A validator MUST reject a mode/current mismatch, missing or extra control
entries, a forbidden history field, an invalid discriminator, or a manifest
whose declared ledger/review presence disagrees with the current view. The
existing path, LF, CRC, canonical JSON and review-shape checks remain mandatory.
Snapshot mode MUST reject partial coverage and any ledger `unknown` record.
All checks are against this single schema; no parser may coerce the old string
into a typed commit or infer a missing mode from ZIP contents.

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

A validator MUST also check the producer requirements that are otherwise stated with no addressee: entry-name uniqueness under NFC plus simple case folding (§3.6, D-16), the reserved-prefix rule (§3.6), LF-only content in every entry outside `.git/` (§3.6, D-17), and internal file attributes of `0` on every central-directory record (§3.5, D-19). All four are cheap from what a validator already holds — the name rules and the text flag from the central directory alone, the EOL rule from the payload bytes it decodes to verify CRCs — and each describes real damage a reader cannot detect for itself. A package carrying `README.md` and `readme.md` loses one of them silently in every tested extractor and in Git's own NTFS checkout (§3.6). A package storing CRLF resolves identically to a conforming one because §6.1 rule 1 re-normalizes, so nothing else in the format would ever flag it. A package that flags its entries text extracts byte-exact only for as long as its content stays conforming: the text flag and stored CRLF are separately harmless and together are the one measured combination in which an ordinary extractor rewrites a document (Info-ZIP `unzip -a`, 21 CR bytes stripped from 3 of 4 documents), so a validator that checks only the EOL half leaves a package one nonconforming re-emission away from lossy extraction. A reader is not required to make these checks; §3.7's two tiers are about typing and recovery, not content conformance, and a package that fails any of them may still type as conforming at offset 0.

### 4.1 Exact snapshot identity

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

---

## 5. History

| Circumstance | Required behavior |
| --- | --- |
| First publication of a newly established ordinary lineage | MAY use snapshot mode; a producer MAY choose Git mode immediately. |
| Recompression/reordering or resending exactly the same snapshot state | MAY stay snapshot mode and MUST retain its identity. Evidence-only manifest changes do not make a new state. |
| Private edits before first publication | MAY remain uncommitted; every emitted candidate gets the hash of its own bytes. No historical checkpoint or published-continuity claim is made. |
| First changed published successor in the same namespace | MUST be Git mode. If its predecessor was a snapshot, materialize that exact predecessor as C0 and append the successor C1. A changed semantic header also counts as a changed state. |
| Further updates of a committed lineage | MUST remain Git mode. An edited current tree cannot silently become another initial snapshot in the same namespace. |
| Published historical `at=`, commit, diff or hunk reference | Its Git endpoints MUST exist first. Snapshot digest syntax cannot substitute for an endpoint. Existing patch-retention rules then apply. |
| Bundled review | MUST be Git mode and satisfy the parent/binding rules in §4 and §6.8. |
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

### 5.1 The curated repository

In Git mode only, the `.git/` entries are a real Git repository and nothing more than one:

| Entry | Content |
| --- | --- |
| `.git/HEAD` | `ref: refs/heads/main\n` |
| `.git/config` | `[core]\n\trepositoryformatversion = 0\n\tbare = false\n` |
| `.git/refs/heads/main` | the raw SHA-1 commit ID in `current.id`, followed by LF |
| `.git/shallow` | present only when the retained graph is a genuine shallow clone; lists boundary commit IDs, one per line |
| `.git/objects/pack/pack-<name>.pack` | exactly one pack containing every retained object, offset deltas permitted, stored in the ZIP |
| `.git/objects/pack/pack-<name>.idx` | its index, stored |
| `.git/objects/pack/pack-<name>.rev` | optional reverse index |

Those `config` bytes declare no `core.autocrlf`, deliberately: the format pins no line-ending policy on the extracted repository and leaves it to the host (D-18b, §3.8). No loose objects, no working index, no hooks, reflogs, remote URLs, `description`, `info/` or `packed-refs`. The pack is a storage choice: repacking changes offsets and delta bases but not object IDs, so no format identity depends on pack layout. A document's blob may be a delta against any other object, so independent document decoding from the pack cannot be promised at the entry level; that is what the current view is for.

Measured sizes (32 retained updates): 159,296 npm / 3,312,849 Rust bytes for the packed repository ZIP, against 148,080 / 3,288,503 for a bundle and 171,192 / 3,423,817 for flat base-plus-diffs. Git finds 48 / 23 blob deltas among 333 / 767 objects; it does not provide solid cross-document compression and this format does not pretend it does.

### 5.2 Refs and object format

In Git mode exactly one branch, `refs/heads/main`, MUST exist; `HEAD` MUST be
symbolic to it, and its raw target MUST equal the SHA-1 portion of
`current.id`. That object MUST be a real commit and its tree MUST equal the
current view. Exactly one pack and its index are required; an optional reverse
index and genuine shallow boundaries follow the existing rules. Snapshot mode
MUST contain none of these entries. Git objects use SHA-1; snapshot state
hashes use SHA-256. The latter does not enable SHA-256 Git repositories.

Tags, notes refs, remote-tracking refs and replace refs MUST NOT be shipped. Git notes and replace refs are local overlays, not portable evidence.

### 5.3 `.mdpkg/history.json`

This Git-mode-only descriptor is the unbounded part of the history declaration. It is container-level (untracked) because it names emitted commit IDs, which cannot appear inside the trees those commits commit. Canonical JSON:

| Field | Type | Meaning |
| --- | --- | --- |
| `walk` | `first-parent` | The only walk version 1 defines. Second-parent paths of merges are not retained (§11.2). |
| `root` | `original`, `synthetic` or `materialized` | True initial Git root, truncated replacement root, or verified deterministic bootstrap of the initial snapshot. |
| `origin` | object, iff root is `materialized` | The exact four-field origin proof below; forbidden for other roots. |
| `sourceRepository`, `scope` | strings, optional | For packages projected from another repository: what was imported and which path projection. |
| `sourceBase`, `sourceTip` | qualified object IDs | The source-lineage range the retained graph represents. |
| `retainedCommits` | integer | Count of commits on the retained first-parent path. Membership of a specific commit is answered by the pack index. |
| `shallowBoundaries` | array of qualified IDs | MUST equal the contents of `.git/shallow`, or be empty when that file is absent. |
| `transformations` | array | Each `{kind, sourceBase, sourceTip, emitted, summary?}`; `kind` is `projected` or `squashed`; `emitted` is the commit that replaced the range; `summary` names the range summary entry when one exists. |
| `ranges` | array of entry names | Every `.mdpkg/history/ranges/<sha256>.json` shipped. The file name is the SHA-256 of the file's bytes. |
| `patches` | array | Each `{entry, sha256, from, to, document, profile}` for an archived patch under `.mdpkg/history/patches/`. |
| `bindings` | entry name, optional | `.mdpkg/history/bindings.json`, required when any transformation carries a summary. |
| `addressingCoverage` | array of `{from, to, coverage}` | Ranges of the retained path over which confirmed correspondence is `complete` or `partial`. When the manifest says `complete` this is one range spanning the whole path. |

`history.json` carries no `version` field of its own, unlike the ledger, `bindings.json` and range summaries: it is reachable only through the manifest's `history.detail`, so the manifest's `mdpkg` token versions it. Adding one would be redundant and would change the worked example's bytes (§8).

Coverage semantics, from the measured counterexamples: a squash commit is structurally identical to an ordinary one-parent commit (the same tree, parent, author, committer and message produce the identical object ID), so squash is declared, never inferred. The absence of `.git/shallow` proves nothing about completeness: a synthetic root repacks as a normal repository with `--is-shallow-repository=false`. A missing parent outside a declared shallow boundary is corruption, not an inferred truncation. "Complete" always names a scope and walk; it is a producer claim checked for internal consistency, not proof that no upstream history was omitted.

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

### 5.4 Range summaries and bindings

Summaries and squash bindings exist only in Git mode; endpoints remain qualified Git commit strings. A snapshot checkpoint is translated through a verified origin before graph queries. Squash bindings do not serve as origin records.

Squashing discards the intermediate revisions that answer "was this section touched after my review?". A producer that squashes MUST compute a range summary **before** discarding them and ship it as `.mdpkg/history/ranges/<sha256>.json` (canonical JSON, named by its own hash):

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `namespace`, `anchor`, `profile`, `walk` | MUST match the manifest and be `first-parent` |
| `coverage` | `complete` or `partial` |
| `base`, `tip` | Source-range endpoints, qualified IDs |
| `sourceCommits` | Ordered source commit IDs, one per transition; `sourceCommits[n-1]` is the commit produced by transition *n*. Ordinals are 1-based; ordinal 0 denotes the `base` state, whose commit is in the `base` field and is not an element of this array |
| `collapsedInputs` | The commits this squash replaced |
| `beforeStateDigest`, `afterStateDigest` | SHA-256 of the canonical JSON map from every root to its scoped digest at each endpoint; binds the summary to exact states |
| `contentTouched` | Sorted roots whose digest or live existence changed anywhere in the range |
| `changedAt` | root → ordinals at which it changed; an edit and its revert both appear |
| `endpoints` | root → `{before, after}` digests at `base` and `tip`, for the roots in `contentTouched` only; `null` for absent |
| `identityEvents` | `{at, root, event, …}` for creation, retirement (`split`, `merge`, `deleted`), restoration, with successor roots |
| `nested` | `{summary, emitted}` hashes of earlier summaries this one expands, for repeated squash |

Keys are origin roots (§6.2), so a summary remains valid across renames recorded in the ledger. The measured three-transition example is 1,955 bytes plus 169 bytes of bindings; long histories need a separate event-size benchmark before cheap unlimited retention is promised (§11.2).

`.mdpkg/history/bindings.json` is `{"version":1,"bindings":[{"emitted":<qualified ID>,"summary":<entry name>,"hash":<sha256>}]}`. It exists because a commit's own ID cannot be written into its tree; the binding is created after the squash commit exists.

The exact touched query over checkpoint positions `(from, to]` is: does the root have an ordinal *n* with `from < n ≤ to`? Missing checkpoint membership, `partial` coverage, an unsupported walk or an absent summary returns **unknown**, never "untouched".

### 5.5 Archived patches

Archived patches exist only in Git mode; their endpoints are Git commits that must exist before reference publication.

A published hunk reference (§6.4) binds the SHA-256 of a complete patch. Because regeneration across Git versions and configurations is not byte-stable, a producer that promises hunk retention stores the exact patch bytes at `.mdpkg/history/patches/<sha256>.patch` and lists it in `history.json`. If regeneration disagrees with the bound hash, the archived artifact is used; if both are absent, the reference is `invalidated / history-unavailable` (§6.6). A patch is never relocated by line number, title or approximate text.

---

### 5.6 Deterministic materialization and origin verification

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
and parent inputs. The fixed bootstrap encoding above is this specification's
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
because its declared namespace/current fields match.

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

When a producer confirms that an entity's current locator differs from the one its root was minted for, it records the exception in the identity-bearing current-view file `.mdpkg/address/overrides.json`:

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

The file MUST be absent when it would have no entries, and the manifest's `overrides` MUST be `null` in that case (D-12). Its exact bytes are hashed into snapshot identity. In Git mode it is tracked at every applicable commit and survives squash as an ordinary tree copy. Confirmation belongs to the producer, not the availability of Git objects or a similarity heuristic.

Measured cost: 0 bytes at zero exceptions; +2.32% npm / +0.99% Rust at 5% of headings exceptional; +7.12% / +3.77% at 20%. A full identity map costs +31.60% / +17.21% on the same snapshots and +41.16% / +20.19% across the 33-snapshot histories, where the sparse ledger with no injected exceptions costs +1.96% / +0.33%. At very high lifetime exception density a denser encoding may be needed (§11.2).

**Producer obligation.** Confirmation is a producer act. An identity-aware editor confirms a rename or move as it performs it. A generic Git import must review correspondence; writing a similarity heuristic's guess into the ledger does not confirm it. Native `git diff -M` detects file pairs, not heading sections, and the best measured section-projection hybrid got 10 right, 1 wrong and 4 missed of 14 required mappings, including a false `R099` continuation on unrelated boilerplate. Candidates reduce producer work; they are never authority. Complete initial snapshot coverage and Git transition coverage follow §5.
Unconfirmed transitions use Git mode, `addressing.coverage: partial` and
covered ranges in the history descriptor. A consumer MUST NOT treat missing
history as evidence of complete correspondence for a claimed prior lineage.

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
- `loc` is REQUIRED on `document` and `section` references: §6.5 step 2 needs it to compute a default root, and SHA-256 cannot be inverted to recover a locator without it. It is a navigation and default-root input, not identity; `root` is identity; `expect` is the reviewed state. Both `root` and `expect` are 64 lowercase hex characters.
Without `at`, a document/section reference selects the current view regardless
of current-state kind. With `at`, it selects exactly the named Git commit.
`at`, commit, diff and hunk endpoints MUST NOT contain snapshot state IDs.
In snapshot mode these history-dependent references return
`invalidated / history-unavailable`; readers must not substitute current.
An implementation lacking a history reader for a Git-mode package reports a
capability failure (`history-reader-required`), not a malformed identity.

External `observedAt`, when supplied, is a typed current-state object.
`review.of.current` supplies it for all threads. It is checkpoint evidence,
never part of the URI key. Snapshot observedAt can be translated to C0 only
through a verified origin matching the exact namespace and snapshot ID.
- `profile` names two different things by reference kind. On `document` and `section` references it is the source digest profile and MUST equal the manifest's `addressing.digest`. On `diff` and `hunk` references it is the diff profile; the manifest declares no diff profile, so it is checked against the version-1 constant below and never against the manifest.
- `git-myers-u3-v1` fixes Myers, three context lines, full blob IDs, no rename detection, no indent heuristic, no external diff, no colour.
- Readers MUST reject unknown versions or profiles, duplicate or unknown parameters, malformed IDs and foreign namespaces. Navigation without `expect` is a UI feature and establishes no reviewed state.

An exact `at` read uses the named retained commit and its ledger/document; it never follows an origin or squash binding to a different commit. Materialization does not add snapshot-pinned URI syntax.

### 6.5 Resolution of a current document or section reference

Given the manifest and central directory:

1. Reject if `namespace`, `anchor` or the digest `profile` differ from the manifest (§6.4). Apply the ordered checkpoint gate below before the ledger/digest steps. `review.of.current` supplies typed `observedAt` for every thread; it remains external to a loose reference.
2. If `addressing.overrides` is non-null, read that one entry and look up `root`:
   - `dead` → `flagged-changed` with reason and successors.
   - `unknown` → `unconfirmed` with reason.
   - `to` → the target locator is the recorded one.
   - absent → if `root` equals the default root of `loc`, the target locator is `loc`; otherwise `unconfirmed / missing-override` (the reference claims an exception the package does not confirm).
3. Read the one document entry the target locator names, apply §6.1, and locate the entity by trail. If it is not there: `unconfirmed / possibly-renamed-moved-or-deleted`. Absence is never reported as deletion.
4. Compute the scoped digest and compare with `expect`: equal → `survives / same-source`; different → `flagged-changed / source-changed`. Return the current locator and digest either way.

**Ordered checkpoint gate (before step 2):**

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

This reads the manifest, the ledger (when present) and one document. After any required checkpoint proof has been supplied, current ledger/digest resolution reads no pack and walks no history. Origin verification is separately requested; scoped digests are not stored. Measured on the corpora: 6 requests / 10,369 (npm) and 54,440 (Rust) bytes without a ledger, 8 / 12,312 and 85,447 with one, 0 pack bytes and 0 bytes of any other document in every case; a warm reader fetches 0 further bytes. Parsing one document took 0.87 / 0.56 ms; the full in-memory resolution, parse plus hash plus compare, took 1.19 / 0.86 ms.

In snapshot mode a history-dependent reference returns `invalidated / history-unavailable`. In Git mode without a history backend it returns `history-reader-required`. With `at=A` and a capable backend: locate `A` in the pack index (absent → `invalidated / history-unavailable`, and `history.json` says whether it was collapsed or truncated); read `A`'s tree, its `.mdpkg/address/overrides.json` blob if any, and the document blob; then apply steps 2–4 against that snapshot.

### 6.6 Result statuses and stability

| Status | Meaning |
| --- | --- |
| `survives` | Same entity, same scoped source. |
| `flagged-changed` | Same entity, different source, or retired with a declared reason. The external review stays on record. |
| `unconfirmed` | The package cannot confirm correspondence. The review is preserved externally and the current section is treated as unreviewed relative to it. Candidate locations MAY be offered; the review badge MUST NOT be moved. |
| `invalidated` | No valid answer from shipped evidence: wrong namespace or profile, malformed reference, unavailable snapshot, malformed package. |

| Reference | Repack / re-ZIP | Materialize initial snapshot | Squash | Truncate to later base | File move | Content edit |
| --- | --- | --- | --- | --- | --- | --- |
| Document, section (current) | survives | same roots/locators/expect and source at C0; snapshot correlation requires verified origin | survives if digest equal, else flagged-changed; ledger copied with the tree | survives if entity and ledger retained; unconfirmed outside `addressingCoverage` | survives via ledger `to` | flagged-changed, including heading rename and descendant edit |
| Section with `at` | survives | endpoints must exist before minting | invalidated if the snapshot was collapsed | invalidated if discarded | survives at old snapshot | survives at old snapshot |
| Commit | survives | endpoints must exist before minting | invalidated if the object was replaced | invalidated if discarded | survives | survives |
| Diff | survives (same profile) | endpoints must exist before minting | survives only if both endpoints retained | same | survives at old endpoints | survives at old endpoints |
| Hunk | survives if patch hash verifiable | endpoints must exist before minting | survives as archived evidence if the patch is retained | same | survives in old patch | survives in old patch |

A review-package thread (§6.8) needs no row of its own: it *is* a current document or section reference carrying a selector, so it has exactly the stability of the first row above, and the sub-section outcome the selector adds refines that status for display without ever replacing it.

### 6.7 Two questions the format keeps apart

- **Net change**: "does this section differ now from the state I reviewed?" Answered by §6.5 from the current snapshot alone, after any squash.
- **Touched since**: "was this section edited at any time after my review?" Answered only from a range summary (§5.4) whose ordinals cover the interval; otherwise `unknown`. A rename then revert leaves the digest equal and the section touched; endpoint comparison cannot see it. The format never upgrades a missing trail to "unchanged since review".
In snapshot mode the touched-since query returns `unknown`: there is no retained
transition evidence. Materialization alone does not create it retrospectively.
In Git mode a verified snapshot origin supplies checkpoint C0, after which
the existing summary/ordinal/coverage rules apply. If membership, summaries
or coverage are missing, the answer remains unknown. Endpoint comparison and
current source equality are not proofs of no intervening changes.

### 6.8 Sub-section anchors: the selector profile `cm0312-quote-context-v1`

A review comment points at a run of characters *inside* a section, and the identity of that attachment is three separate things a reader MUST NOT collapse: the **root** (§6.2) says which entity was reviewed, the scoped digest `expect` (§6.1) says what that entity looked like at review time, and a **selector** says where inside it the reviewer was pointing. The three fail independently — a heading rename breaks identity, a body edit breaks state, a reflow breaks position — and a reader that conflates them reports the wrong thing in all three cases. §6.1 through §6.7 are unchanged by this subsection, which adds exactly one term.

**One selector kind, and why.** Version 1 defines one selector profile and one selector kind: a character range over the canonical scope source that §6.1 rule 5 produces, carried with the text at that range and its surrounding context. There is no `lineNumber`, no `wordIndex` and no `kind: line | word | char` discriminator; "comment on this word", "on this line" and "on this sentence" are producer-side gestures converted to a character range at review time (D-20). This is the move §6.2 already made when it chose a heading trail over a line number, for the same measured reason. Over 96,051 anchors scored on real revision pairs from two corpora, a stored character offset alone is silently wrong on 5.28%–31.32% of anchors after real edits, rising with distance, and a line ordinal on 32.83%–49.30%; a quote with context is wrong on 0.00%–0.06%, and line-granularity and sub-line-span anchors are indistinguishable under it (0.003% and 0.012% wrong at one revision of separation) where a line ordinal is structurally incapable of addressing a span at all ([review-comments.md](investigations/review-comments.md) §2.3, §9.4).

The profile is named and versioned like the other two and is pinned to them: it is defined only over the canonical scope source of `cm0312-source-lf-v1`, so it inherits that profile's LF normalization, its trailing-whitespace rule and its exact-internal-bytes rule, and it is undefined over anything else.

```json
{"start":412,"end":452,
 "quote":"the producer MUST reject it or relocate ",
 "occurrence":0,
 "prefix":"reserved region is still needed. A producer ",
 "suffix":"the colliding paths and declare that it did."}
```

| Field | Rule |
| --- | --- |
| `start`, `end` | UTF-16 code-unit offsets, not byte or Unicode-scalar offsets, into the canonical scope source of the entity `root` names. The half-open range satisfies `0 <= start < end <= length`; neither endpoint may split a surrogate pair. Valid only while the scoped digest equals `expect`. |
| `quote` | The exact substring at `[start, end)` at review time. A producer MUST verify this against the source before emitting. Its length is producer policy; the measurements used 40 characters (§11.2). |
| `occurrence` | Zero-based index of `quote` among its occurrences in the scope at review time. It records which duplicate was selected at review time; it MUST NOT break a context tie during relocation. |
| `prefix`, `suffix` | Up to 40 UTF-16 code units of exact source either side, truncated at the scope boundary without splitting a surrogate pair. Used only to disambiguate multiple matches. |

Three properties are decisions, not accidents:

- **The quote is stored as plain text.** That is what lets a `delta` review package be read without the reviewed original, and it is why no second digest profile is defined: the quote *is* the sub-section state evidence, and comparing it is the digest comparison (D-22). It also means a review package discloses the fragments it quotes, so where the reviewed content is confidential the review package inherits that confidentiality. Storing `SHA-256(quote)` instead is 8 bytes smaller and cannot search, so it can check a candidate offset but can recover nothing after a reflow — the exact case the selector exists for (§9).
- **The offsets are retained even though re-anchoring never trusts them.** They cost two integers, they make the common case O(1), and they record where the reviewer was looking when several identical quotes exist.
- **An anchor never crosses an entity boundary.** A selection spanning two sections is two anchors, or one anchor on the common ancestor section, which §6.1 rule 3 already makes a real scope. Version 1 defines no cross-entity range (§11.2).

**Resolution is four steps, and the third is usually skipped.** Given a thread and a package:

1. Resolve `root` by §6.5 exactly as written. Any status other than `survives` or `flagged-changed` ends the procedure: the thread is `unconfirmed` or `invalidated`, its position is never guessed, and a resolver MUST NOT search the document for a detached quote.
2. On `survives`, the section's canonical source is byte-identical to the reviewed state, so `start` and `end` are still exact. Before using them, a reader MUST check bounds, surrogate boundaries and exact quote/context equality against that source; false stored evidence is an invalid selector, not a verified position. Then use them and stop. Measured: in 38,238 resolutions where the scoped digest was equal the stored offsets were exact 38,238 times and had moved 0 times, and this is the common case — 84.87%–99.92% of threads across four distances on both corpora.
3. On `flagged-changed`, the offsets are worthless and the selector re-anchors by searching the section's canonical source for `quote`: exactly one occurrence gives `target-relocated` at that offset; several are scored by the length of the agreeing run of `prefix` backwards and `suffix` forwards, taking the strict winner and refusing on a tie; none, or a tie, gives `target-detached`. Measured cost of refusing rather than guessing: 0.15%–0.43% of anchors report `target-detached` that a guess would have placed correctly.
4. Report the pair. §6.6's status is unchanged and still governs the badge; the sub-section outcome — `target-intact`, `target-relocated` or `target-detached` — refines it for display only. A `target-detached` thread stays attached to its section and is shown as text the reviewer pointed at that is no longer there. It is never moved and never dropped.

The section digest is a *sound* staleness gate for a sub-section anchor and needs no help: §6.1 rule 3 scopes a section over its whole source including descendants, so any edit to any character an anchor can point at changes the digest by construction, and over 923 measured cases where the anchored run did not survive intact, the containing section's digest was unchanged 0 times. It is also *noisy*, which is what the quote is for: 11.27%–48.12% of anchors whose target survived byte for byte sit in a section whose digest changed elsewhere, and the quote converts that one flag into the three-way answer above. §6.7's distinction applies unchanged one level down, with one consequence: the touched query is answerable at section granularity and returns `unknown` at sub-section granularity, because range summaries (§5.4) carry per-entity digests and not per-anchor ones. An edit and revert inside a commented sentence resolves `survives / target-intact`, which is correct for the net-change question and silent on the touched one.

Two cases are decided rather than left to a reader. A retired entity with `dead: split` (§6.3) resolves `flagged-changed` with successors and the selector is **not** run against the successor set: a quote search across successors is precisely the silent review transfer §6.3 forbids, so a reader offers the successors as navigation and leaves the thread where it is. A reserved-slot birth is already handled by §6.3 — the old root is held by the ledger and the newcomer has a fresh random root — so the selector never gets a chance to undo it.

**Where the anchors live.** Review data is a second package with its own typed identity and the identity-bearing file `.mdpkg/review/comments.json`. Changing review content changes its current-state identity; it has retained history only in Git mode. It can itself be reviewed. Earlier always-Git measurements found 2,613–2,615 bytes of overhead, not a mandatory cost of the revised snapshot encoding.

```json
{"version":1,
 "anchor":"cm0312-trail-source-v1",
 "profile":"cm0312-source-lf-v1",
 "selector":"cm0312-quote-context-v1",
 "threads":[
   {"id":"7f1c…","root":"<64 hex>","loc":"<base64url(canonicalJson(locator))>",
    "expect":"<64 hex>","state":"open",
    "select":{"start":412,"end":452,"quote":"…","occurrence":0,"prefix":"…","suffix":"…"},
    "comments":[
      {"id":"a1…","at":"2026-09-08T10:04:00Z","author":"reviewer@example.invalid",
       "body":"This paragraph asserts a default the surrounding text never states."},
      {"id":"b2…","at":"2026-09-08T11:20:00Z","author":"other@example.invalid",
       "inReplyTo":"a1…","body":"Agreed; §4 names it."}]}]}
```

Canonical JSON (§2), so it is byte-stable and diffable. The rules on it:

- **A thread's `root`, `loc` and `expect` are read in `review.of.namespace`, not in the review package's own namespace.** In `delta` shape the two namespaces differ and this is the one place in the format where both appear in one file; in `bundled` shape they are equal by §4's validator rule and the distinction is invisible. The three profile names at the top of the file MUST equal the reviewed package's `addressing.anchor` and `addressing.digest`, and the selector profile of this subsection.
- **The thread is the unit of attachment; comments are the unit of authorship.** One anchor per thread, fixed at creation. A reply never re-anchors — §6.6's "the review badge MUST NOT be moved", applied one layer down.
- **`id` is a random UUID minted at thread creation, not a content hash.** A content hash would change whenever a reply was added, which destroys the one thing an id is for: a later package naming the thread it answers.
- **The `comments` array order is authoritative and `at` is display metadata.** Two machines with skewed clocks order timestamps inconsistently, and discarded private drafts supply no retained event history. Array order remains authoritative in both modes. Nothing in resolution depends on a reviewer's clock.
- **Replies are flat, with an optional `inReplyTo` naming a sibling.** Nesting is a rendering concern; the file stores the edge, not the tree.
- **`state` is `open`, `resolved` or `obsolete` and only the file's own producer sets it.** A reviewed party never edits the reviewer's file: it replies with its own review package, which makes the chain append-only and auditable.
- **Several threads MAY share a `root`, and several MAY share a `root` and an identical `select`.** Two reviewers pointing at the same clause is normal; they are distinct threads with distinct ids.

**Comments-document versions and interoperable schema.** [The JSON Schema](spec/review-comments.schema.json) describes versions 1 and 2; [complete canonical fixtures](spec/review-fixtures/README.md) supply valid and invalid examples. Version 2 retains the manifest, root/digest/selector profiles and thread states above, and requires `kind: "comment" | "change-request"` on **every comment**, including replies. A change request is authored prose, not a patch, acceptance decision or claim that an edit was applied. Version 1 has no authored kind; readers MUST report its intent as `Unspecified` with source `LegacyV1`, not infer intent from its body. A `kind` property in a version-1 comment is rejected as an unsupported discriminator. Unsupported versions, profiles, kinds and states MUST yield a capability diagnostic, never success with empty feedback or downgraded intent. The ZIP magic remains `markdown-package/1`.

The following narrow rules apply to both versions unless explicitly qualified:

- All thread and comment IDs are lowercase UUID strings, unique across the entire comments document (including across threads and between thread and comment IDs). Array order is authoritative. `inReplyTo`, when present, is a non-null UUID naming a different comment in the same thread; forward replies are permitted, self-replies, dangling/cross-thread edges and cycles are forbidden. Timestamp order does not constrain replies.
- `at` uses RFC 3339 calendar-date/time syntax with uppercase `T` and `Z`, an explicit `Z` or numeric offset, and optional fractional seconds; its original text/offset is preserved. Dates must exist, time fields and offsets must be in range. Leap-second spelling `60` is retained as display metadata, not used to order comments. The reader supports up to 128 characters for this field.
- Every thread requires `root`, `loc`, `expect`, `state`, an explicit `select` and a `comments` array. Every comment requires `id`, `at`, `author` and `body` strings. Empty top-level `threads` is a valid empty review; an ordinary package without `review` is not an empty review. Version 2 requires nonempty comment arrays and nonempty bodies. Version 1 permits empty bodies/arrays without inventing missing content.
- Locators are unpadded canonical base64url of canonical JSON (§6.2), including its final LF. A selector has integer offsets/occurrence, nonempty quote, and quote UTF-16 length `end-start`; prefix/suffix obey the 40-unit bound above. All strings must be valid Unicode. Source-dependent bounds and equality remain unverified until the reviewed source is available.
- Duplicate JSON properties are rejected at every nesting level. Canonical serialization is required. Unknown non-semantic properties on the document, threads, comments and selectors may be retained as bounded extension data; they preserve thread/comment identity, intent and resolution semantics. Their exact stored bytes nevertheless contribute to overall package-state identity, including the snapshot hash in §4.1. Unknown semantic discriminators are not extensions.
- Resource ceilings are reader/service policy, not format maxima. Exceeding one must reject the operation explicitly rather than truncate feedback. JSON Schema validates shape; canonical bytes, ID uniqueness, reply graphs, decoded locators, valid calendar dates and UTF-16/source bounds also require the prose checks above.

Offsets in the current fixtures are independently checked by Python's explicit UTF-16 count, JavaScript string indexing and .NET. Earlier abbreviated investigation snippets are not conforming producer fixtures. No shipped web authoring/export implementation depends on a different offset convention.

**Shapes.** The exact delta/bundled obligations are in §4. Delta may use either state kind, has a fresh namespace and carries only the review document with null overrides. Bundled must be Git mode and have exactly the reviewed commit, or verified snapshot bootstrap C0, as its sole parent; only review paths may change. Earlier always-Git measurements were 5,098 / 37,463 bytes for delta and 254,262 / 286,628 for bundled (1 / 50 threads). These are historical measurements, not revised-format size claims.

Exact review context requires either the supplied original state with a matching
typed identity or a reconstruction from a verified origin and C0. Resolving onto
a different current target still requires explicit newer-target selection. A
materialized C0 is a different target key even if its files equal S0; a verified
bridge establishes correspondence, not permission to silently switch targets.
Preserve every feedback item when context, origin proof or selectors cannot be
verified. Never look up an original via untrusted dispatch metadata.

**Nothing is added to the reviewed package.** A conforming package is already reviewable: the four steps above read the manifest, the ledger when present, and one document, which is what §6.5 already reads. No review-specific entry, field or index appears in the reviewed package, and §4's admission rule is untouched. One existing property does matter and is already required — exact UTF-8/LF source equality is bound by the current-state identity (§2, §4.1, §3.8), so an offset minted on the reviewer's machine lands on the same character on the producer's. D-17 and D-18a are what make that true across platforms; without them every offset would be displaced by one character per preceding line on a CRLF host.


---

## 7. How the layers fit together

### 7.1 Compression, identity and verification

ZIP DEFLATE covers individual current files and, in Git mode only, container-level
history sidecars. History descriptors/summaries are not current-view files.
Git pack zlib/deltas cover retained objects only in Git mode; pack/index/reverse
index remain stored in ZIP. Only Git mode duplicates current files as tip blobs.
Scoped source digests are computed on demand; the full snapshot hash is likewise
computed, not a stored second document index. Current reads decode only requested
files; full verification checks every applicable obligation below.

An ordinary selective reader MAY expose a declared identity after structural
validation and verify payloads as they are read. It MUST distinguish declared
identity from fully verified identity; a successful current scope/selector
result does not assert full-package integrity. A full validator MUST check all
applicable obligations below. Re-ZIP changes do not turn declared identity
into verified identity. No reader may report nonexistent Git integrity as a
passed check.

| Obligation | Snapshot | Git |
| --- | --- | --- |
| Container, mode, manifest, every payload, paths, UTF-8/LF, ledger/review rules | Required | Required |
| Snapshot hash over all current files and semantic header | Required | Not applicable to current; required for origin when present |
| Git object/reachability/ref/index integrity and exact current tree equality | Not applicable | Required |
| Bootstrap origin checks | Not applicable | Required iff origin is present |
| Delta namespace or bundled parent/review-only diff rules | Required when review declared; bundled forbidden | Required when review declared |

For Reviews, derive required verification checks from the already parsed
mode/review shape/origin, rather than accepting a provider-supplied list of
requirements or an unconditional full-check mask.
Snapshot-identity and origin-verification obligations are required when applicable. `Full` assurance is
accepted only when every applicable check passes; failed, skipped or unavailable
required checks cannot produce it. Nonapplicable Git checks remain explicitly
nonapplicable. Verifying a delta package does not prove the external reviewed
source or its selectors; source-dependent assurance remains separate.

### 7.2 Read paths and what each needs

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

Both typing tiers use the central directory; neither infers mode from entry order.

---

## 8. Worked example

The committed-history example in §§8.1–8.5 is produced by [`docs/spec/worked-example.py`](spec/worked-example.py); its full output is [`docs/spec/worked-example.json`](spec/worked-example.json). Two runs produced byte-identical packages. Git 2.50.1, Python 3.10.2, one packing thread, level 6, window 10, depth 50, fixed author, committer and dates.

[`examples/`](../examples/) has this fixture's plain markdown alongside other
addressing edge cases (duplicate headings, Setext headings, headingless
preambles) as unpackaged input, separate from the packaged `.mdpkg` output built here.

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

6,358 bytes; SHA-256 `a624fe760a3e129860e774eff78e4c8d383660f773933cd981c77e89901df3e5`.

| # | Local header | Data | End | Method | Compressed | Raw | CRC32 | Name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 50 | 462 | 0 | 412 | 412 | `8f51546c` | `.mdpkg/manifest.json` |
| 1 | 462 | 521 | 681 | 8 | 160 | 195 | `a14c171c` | `.mdpkg/address/overrides.json` |
| 2 | 681 | 719 | 838 | 8 | 119 | 163 | `cf83f8e7` | `guide.md` |
| 3 | 838 | 876 | 912 | 0 | 36 | 36 | `ba3d4b41` | `notes.md` |
| 4 | 912 | 961 | 1,329 | 8 | 368 | 844 | `1be94c50` | `.mdpkg/history.json` |
| 5 | 1,329 | 1,387 | 1,556 | 8 | 169 | 265 | `cafccc48` | `.mdpkg/history/bindings.json` |
| 6 | 1,556 | 1,677 | 2,624 | 8 | 947 | 2,202 | `67747d75` | `.mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json` |
| 7 | 2,624 | 2,663 | 2,684 | 0 | 21 | 21 | `576463b5` | `.git/HEAD` |
| 8 | 2,684 | 2,725 | 2,775 | 0 | 50 | 50 | `184bf63d` | `.git/config` |
| 9 | 2,775 | 2,825 | 2,866 | 0 | 41 | 41 | `4f5dffdc` | `.git/refs/heads/main` |
| 10 | 2,866 | 2,963 | 4,315 | 0 | 1,352 | 1,352 | `afc5f15c` | `.git/objects/pack/pack-90bb59018b3df8e15cd07c8899e108e3ded2c475.idx` |
| 11 | 4,315 | 4,413 | 5,406 | 0 | 993 | 993 | `8dc1b4b6` | `.git/objects/pack/pack-90bb59018b3df8e15cd07c8899e108e3ded2c475.pack` |

Central directory: offset 5,406, 930 bytes, 12 records. EOCD: offset 6,336, 22 bytes, zero comment.

Entries 1–3 are the current tree of `s1`; history entries are container-level; Git entries end with the pack. Current-file payloads end at byte 912.

**The 79-byte typing read:**

```text
000000  50 4b 03 04 14 00 00 00 00 00 00 00 21 00 6c 54  PK..........!.lT
000010  51 8f 9c 01 00 00 9c 01 00 00 14 00 00 00 2e 6d  Q..............m
000020  64 70 6b 67 2f 6d 61 6e 69 66 65 73 74 2e 6a 73  dpkg/manifest.js
000030  6f 6e 7b 22 6d 64 70 6b 67 22 3a 22 6d 61 72 6b  on{"mdpkg":"mark
000040  64 6f 77 6e 2d 70 61 63 6b 61 67 65 2f 31 22     down-package/1"
```

**The manifest** (412 bytes):

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":".mdpkg/address/overrides.json"},"current":{"id":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","kind":"commit"},"history":{"coverage":"complete","detail":".mdpkg/history.json","mode":"git","transform":["squashed"]},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

**History descriptor:**

```json
{"addressingCoverage":[{"coverage":"complete","from":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","to":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c"}],"bindings":".mdpkg/history/bindings.json","patches":[],"ranges":[".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"],"retainedCommits":2,"root":"original","shallowBoundaries":[],"sourceBase":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","sourceTip":"sha1-d038a20593503cc7250243ce9d4b36f148db479b","transformations":[{"emitted":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","kind":"squashed","sourceBase":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","sourceTip":"sha1-d038a20593503cc7250243ce9d4b36f148db479b","summary":".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"}],"walk":"first-parent"}
```

**Range summary:**

```json
{"afterStateDigest":"d654b9a9cdf4fa4c11d03f669594099dbcae455356e95b9791ab49dd8a571ea3","anchor":"cm0312-trail-source-v1","base":"sha1-28d8c71e94abd862c91537e85978a35ecc92c739","beforeStateDigest":"a1d25502a8490ce28dfa39903593435fbb28a5837ff09e5249416886be36cd6c","changedAt":{"52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70":[1],"9148e4f95e631e65fac95fc410ac036cbed7efa1328a1caabe5bc29a2bac488f":[1,2],"a859a7e3a78cebcc72622e85cd4dc6e101ec516a6eca6b497b2765a459e9dc57":[1,2],"b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984":[2]},"collapsedInputs":["sha1-08ae3497de2558fe65f196844a2ec60fe55e5f73","sha1-d038a20593503cc7250243ce9d4b36f148db479b"],"contentTouched":["52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70","9148e4f95e631e65fac95fc410ac036cbed7efa1328a1caabe5bc29a2bac488f","a859a7e3a78cebcc72622e85cd4dc6e101ec516a6eca6b497b2765a459e9dc57","b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984"],"coverage":"complete","endpoints":{"52f7f2741ea95e947ab04da60e3cb037562daf0374b657ba70a0d30f5a0b7f70":{"after":"684ba2cde243d6593c183ee88ec27f5891eec436ba269e5bccfd0a514fc0f9fa","before":"db52812eb4fc2b0574663ecab0660e030bfef1bca21e320bb646c646999874d5"},"9148e4f95e631e65fac95fc410ac036cbed7efa1328a1caabe5bc29a2bac488f":{"after":"6747c5b9f53aedd9d4c77e90846d12982793eee81e044e8b091c60955248bda0","before":"e4822c64f6130f432510d2d42da3ed15291fe24089cad708b0ab817ce86d0359"},"a859a7e3a78cebcc72622e85cd4dc6e101ec516a6eca6b497b2765a459e9dc57":{"after":"995f4e3eaefd2ea1e94950cecd2f719bd7617db926816dc9b49c9856c06185b3","before":"42f8eccfe768a94d6c26e363f1d8ab0a8ff20a1466e3e9b869abaa4d9f25a40c"},"b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984":{"after":"29f1bb85c6f01fffb19ded47d9e0213372fdac79cb9785e6197ddbba46f629a9","before":"2078ef26101467257c9b4d35e4c617b96c9f4e719b460088f4f78e4d927d0264"}},"identityEvents":[],"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8","nested":[],"profile":"cm0312-source-lf-v1","sourceCommits":["sha1-08ae3497de2558fe65f196844a2ec60fe55e5f73","sha1-d038a20593503cc7250243ce9d4b36f148db479b"],"tip":"sha1-d038a20593503cc7250243ce9d4b36f148db479b","version":1,"walk":"first-parent"}
```

**Squash bindings:**

```json
{"bindings":[{"emitted":"sha1-b414f39b3a54a4232fbaa6a0de0dd4966bdf981c","hash":"ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0","summary":".mdpkg/history/ranges/ff2689cd726e96680fd7c32435119059ae199fbd70310111b970bac4bdabf6b0.json"}],"version":1}
```

**Tip tree:**

```text
100644 blob 752dff649fddd64bfb1804adc5c5da5960d55d78	.mdpkg/address/overrides.json
100644 blob 7e5cdaf1d0796bd7280ba1fbee7f506ecf90dc64	guide.md
100644 blob 143227537cf0e613855eb072fc61269cf85387f5	notes.md
```

HEAD is symbolic to main; the raw main ref equals the SHA-1 portion of `current.id`. Every current payload has the exact blob ID shown above.

**EOCD bytes:**

```text
0018c0  50 4b 05 06 00 00 00 00 0c 00 0c 00 a2 03 00 00  PK..............
0018d0  1e 15 00 00 00 00                                ......
```

Package 1 retains the full graph: 5,022 bytes, 10 entries; SHA-256 `d3d7252af114c15e8640c413f71a512501381059ee1b62a9698c756816135a80`. Its manifest is 402 bytes:

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":".mdpkg/address/overrides.json"},"current":{"id":"sha1-d038a20593503cc7250243ce9d4b36f148db479b","kind":"commit"},"history":{"coverage":"complete","detail":".mdpkg/history.json","mode":"git","transform":[]},"namespace":"c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"}
```

### 8.3 Addressing: three reviews at `c1`, resolved against Package 2

A reviewer working from Package 1's history at `c1` (before the rename) records three reviews. Each carries the entity's root, the locator at review time, the scoped digest at `c1`, and `observedAt = {"id":"sha1-08ae3497de2558fe65f196844a2ec60fe55e5f73","kind":"commit"}` (`c1`).

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

**Touched-since**, from the range summary in entry 6 and `observedAt = {"id":"sha1-08ae3497de2558fe65f196844a2ec60fe55e5f73","kind":"commit"}` (`c1`) (position 1 in `sourceCommits`): Setup has ordinal 2 in `(1, 2]` → **yes**; Usage has only ordinal 1 → **no**; Todo has no ordinals → **no**. Had the squashed package shipped no summary, all three would be **unknown**, not "no".

### 8.4 Extraction check

Both generated Git-mode packages pass `git fsck --full --strict`. After
`git read-tree HEAD`, Package 2 has four untracked container-sidecar paths and
Package 1 has two. Every extracted current file matches its retained tip blob;
HEAD equals the SHA-1 portion of the typed `current.id`.

### 8.5 Reproduction

```powershell
python docs/spec/worked-example.py            # writes docs/spec/worked-example-out/ and worked-example.json
```

The script's ATX-only outline scanner is valid for this fixture (no fences, Setext headings, lists or HTML) and is not the CommonMark resolver §6.1 requires.

---

### 8.6 Initial snapshot, materialization and changed child

The separate minimal guide example contains exactly the eight bytes `# Guide`
and LF. Its full preimage and both canonical manifests appear in §4–§4.1.
`deferred-history.py` emits its packages and shared vectors; the independent
JavaScript oracle recomputes file/state/tree/commit hashes without a product writer.

S0: `sha256-69b43819687cc0ec576965b514d5d336544966aadddec1310b4b7f242fb3adb4`. C0: `sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9`.

The changed child adds `Published change.` to guide.md: `sha1-e8756a61892f4b6ce266f0622899ad562c65bed9`. Its sole parent is C0; origin remains frozen at S0. Reconstructing the origin uses C0's eight-byte file, not the child's current file.

The active [review fixtures](spec/review-fixtures/README.md) include an initial
snapshot with a ledger and reserved birth, Unicode/nested paths, both delta
state kinds targeting both reviewed kinds, and bundled reviews targeting S0 or
C0. Invalid mode, binding, parent and changed-document/ledger cases are supplied.
Comment-document versions 1/2 and URI/addressing profiles are unchanged.

```powershell
python docs/spec/deferred-history.py
python docs/spec/review-fixtures/generate.py
node docs/spec/verify-deferred-history.mjs
node docs/spec/review-fixtures/verify-unicode.mjs
python docs/spec/verify-fixtures.py
python docs/spec/render-worked-example.py
```

These are draft-2 documentation fixtures, not validation results from the old
application schema. Historical investigation archives and size reports retain
their original interpretation; the new fixture byte counts are not performance
claims.

---

## 9. Rejected alternatives, collected

Every alternative the investigations behind this document, or the decisions in §10, measured or argued against, in one place. "Why" is the measured or demonstrated reason; where an alternative was rejected on argument rather than measurement, the row says so.

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
| Manifest codec declaration, document index, per-document digests, entry counts, raw ZIP self-hash | A raw ZIP cannot contain its own digest; the accepted §4.1 canonical state digest excludes the manifest and transport encoding. The other fields duplicate ZIP or Git state and can disagree with it; measured +42, +3,527 / +22,228 and +9,086 / +65,776 bytes |
| `content/` prefix for documents | +1,328 / +10,400 bytes and the extraction stops being a working tree at natural paths; a reserved region is still needed |
| `.git` first, manifest last, streamed manifest | Forfeits the no-`.git` span (158,993 / 3,312,561 bytes) or the 79-byte typing path |
| Shipping `.git/index` | 9,043 / 63,610 bytes to save one `git read-tree`; binds host stat data |
| A directory as the exchange form | No central directory, order, atomic swap or single identity; it is the extraction, not a competitor |
| Atomic in-place update | Not attempted; rewrite the file |
| Whole-response HTTP `Content-Encoding` for range access | Changes the byte offsets ranges apply to; serve the file unchanged |
| DEFLATE for `.pack` and `.idx` entries | 1.75% npm saving (2,789 bytes of 159,296) only by inflating the whole member before any access; Rust gets larger |

**History**

| Alternative | Why rejected |
| --- | --- |
| Git bundle (`history.bundle`) as the primary representation | 7.04% / 0.73% smaller than the packed repository (equivalently, the packed repository costs 7.57% / 0.74% more than a bundle) but ships no index (an `indexPack` pass of 141–667 ms in the browser), needs an import before it is queryable, and a bundle made from a shallow source passes `bundle verify` yet fails to fetch |
| Flat base plus ordered diffs with a commit-record file | 7.47% / 3.35% larger than the packed repository at 32 commits (171,192 vs 159,296; 3,423,817 vs 3,312,849); arbitrary revisions need chain replay; no standard object identity or tooling |
| A bespoke "mini-git" object DAG | No measured size failure to justify it; surrenders interoperability; still needs every coverage and section rule in §5–§6 |
| Reverse-diff flat layout, bundle plus shipped index | Different representations, superseded by adopting a real repository; the latter costs about the same as the packed repository |
| Pack window 250 | 2.44% smaller on npm, 0 on Rust; does not approach solid |
| Preserving the upstream DAG's second parents | Not measured; retaining them can pull unrelated content into the package. Listed as open in §11.2, not rejected |
| Git notes or commit trailers as the sole carrier of summaries and provenance | Notes live on separate refs that rewrites and clones silently omit; trailers are editable prose unsuited to ordered per-entity data |
| Inferring squash from parent count or message; inferring completeness from the absence of `.git/shallow` | Both demonstrated false with real Git: identical object IDs for squash and ordinary commits; synthetic roots report not-shallow |
| Prerequisite (incremental) bundles as truncated packages | Prerequisites are not shallow boundaries; the bundle is not standalone |

**EOL and paths**

| Alternative | Why rejected |
| --- | --- |
| Platform-native checkout: `core.autocrlf=true` plus a shipped `.gitattributes` | Needs a filter mechanism this container does not define, and it breaks the property the current view exists to give a reader for free — that the extracted file *is* the tracked blob, so §6.1 can hash it without reconstructing what checkout did to it (§3.8, D-18a). The container still ships neither; what a *host's own* `core.autocrlf=true` does after `git read-tree` was measured (0 of 4 documents byte-identical through checkout and clone, 25 CR bytes added by each) and is D-18b's accepted behaviour, not a checkout this format defines |
| Pinning `core.autocrlf` in the shipped `.git/config` | Measured and it works: appending `autocrlf = false` to the §5.1 bytes preserves all 4 documents through checkout and clone on a `core.autocrlf=true` host. Rejected by requester decision — §5.1 fixes `.git/config` to exact bytes, and §3.8 rests on the package shipping *no* filter configuration, so a pin is a rule the format would be adding rather than a default it would be restating. The host keeps its own EOL policy (D-18b) |
| Leaving the ZIP internal file attributes unconstrained, resting extraction safety on D-17 alone | The text flag plus stored CRLF is the one measured combination in which an ordinary extractor rewrites a document: `unzip -a` strips 21 CR bytes from 3 of 4. With the flag clear, or the content LF, all four combinations are byte-exact. D-19 states the flag so the protection does not depend on the content rule being kept by whoever re-emits the package |
| EOL normalization at digest time only, leaving stored bytes as authored | The shape D-17 originally had, reversed before it landed: it makes two packages with identical digests differ byte for byte, so the ZIP CRCs, the blob IDs and the extraction all disagree while the addressing layer says nothing changed |
| Case-sensitive entry names, i.e. Git's own rule | `README.md` plus `readme.md` is a valid Git tree that every tested extractor and Git's own NTFS checkout silently reduces to one file; D-16 tightens the rule rather than shipping a format whose extraction loses data on the most common desktop filesystem |

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
| The ledger inside the manifest, or as an untracked sidecar | Not O(1) (4,640 / 73,838 bytes at 5%); a sidecar outside state identity is unverifiable. A hashed snapshot ledger is identity-bearing and a Git ledger survives squash as tracked data |
| **Zero stored identity metadata with read-time Git-history walking** (`381b874`) | Measured and closed: 4 wrong identity matches per 192 queries at both thresholds (displaced duplicates, same-slot replacement, an `R099` boilerplate replacement); a full walk of 512 transitions reads 2.76 MB and takes about 10.1 s; a bounded walk returns `history-budget-exceeded`; every collapsed range is `unmatched`, and a rename/revert, a delete/recreate and a never-deleted history squash to the identical commit; and every current-reference resolution would need the pack intact. It cannot deliver "renamed resolves as the same entity, changed". The requester reaffirmed confirmed exceptions after seeing both measurements |
| Automatic `git diff -M` (any threshold) or projected-section similarity as identity authority | Detects file pairs, not sections; best hybrid 10 correct / 1 wrong / 4 missed of 14; a similarity score cannot tell replacement from continuity or produce split/merge lifecycle records |
| Endpoint-only comparison for the touched query | Cannot see edit-then-revert or delete-then-recreate |
| A touched-ID union without ordinals | Cannot answer interior checkpoints |
| Rendered-output review inside the source profile | Needs a separate context digest and invalidation policy; would conflict with insensitivity to edits elsewhere |
| Fixed 256-way sharding | Moot without full maps; was 58.65% overhead on the small corpus |
| `observedAt` as part of the review key | It is evidence for the temporal query, not identity; kept outside the key |
| Abbreviated Git hashes; the `v1` UUID reference grammar | Ambiguous; superseded by computed roots |

**Review comments and sub-section anchors** ([review-comments.md](investigations/review-comments.md) §10)

| Alternative | Why rejected |
| --- | --- |
| A line number, or a line ordinal within the section, as the sub-section anchor | Silently wrong on 32.83%–49.30% of 96,051 scored anchors after real edits, and structurally incapable of addressing a sub-line span: 1,582 of 1,583 npm span anchors and 16,145 of 16,151 rust span anchors misplaced at one revision of separation |
| A character offset alone as the sub-section anchor | Silently wrong on 5.28%–31.32%, rising with distance; exact only while the scoped digest is equal, which is exactly the case in which the quote is not needed |
| A stored digest of the anchored range, beside `expect` | Answers strictly less than the quote (equal or not equal, with no way to relocate), costs 32 bytes against the quote's 40, and would need its own canonicalization rules, its own version and its own row in every §6 table |
| Storing `SHA-256(quote)` instead of the quote | 8 bytes smaller and cannot search, so it can check a candidate offset and recover nothing after a reflow — the one case the selector exists for |
| Separate `line` / `word` / `char` selector kinds | Measured indistinguishable under quote-plus-context matching (0.003% wrong for line anchors, 0.012% for span anchors at k=1); one character range covers all three |
| Re-anchoring across a `dead: split` successor set | A quote search over successors is the silent review transfer §6.3 forbids |
| Review data tracked inside the reviewed package | Changes the current-state identity every comment points at: the artifact would invalidate its own references on write |
| Review data as untracked container-level entries in the reviewed package | Two byte-different packages would then share one `current`, breaking the correlation key; no history of its own; §6.3's argument against untracked sidecars applies unchanged |
| A bare `review.json` beside the package as the interchange artifact | Forfeits 79-byte typing, central-directory integrity, the LF rule, the text-flag rule and any history, to save the historically measured always-Git overhead of 2,613–2,615 bytes on npm scale. Permitted as a raw transport payload; it is not what returning a review means |
| The package file's content hash as the correlation key | Measured unstable under a conforming re-emission: same `current` and identical entry payloads, 251,778 → 251,753 bytes, different SHA-256. Retained as corroborating evidence, never identity |
| A package-instance GUID in the manifest | Answers no question `(namespace, current.kind, current.id)` does not, including telling apart two packages whose trees are identical but whose retained histories differ; unverifiable by the receiver, so it fails §5.3's rule that a claim is checked for internal consistency or not carried; fails §4's admission rule; and wall-clock time already separates instances for any producer that does not fix dates. Dispatch tracking belongs to the transport (D-26) |
| `current` alone as the correlation key, without the namespace | §6.4 already rejects a foreign namespace before resolving anything; a review key must do the same, or a collision of intent across two unrelated lineages resolves against the wrong documents |
| Per-thread `observedAt` | `review.of.current` is the same value carried once for the whole file; §6.4 already keeps `observedAt` out of the reference key |
| Dropping `loc` from threads in `bundled` shape and deriving roots by scanning the bundled tree | Measured saving is real — 45,144 bytes for 200 threads, 19.2% of the review document — but it makes `delta` and `bundled` structurally different files and contradicts §6.4's "`loc` is REQUIRED". Reconsider only if review volume becomes a measured problem (§11.2) |
| A new `mdpkg://` reference kind for a comment target | The URI grammar addresses entities the package defines and a comment target is not one; the anchor lives in the review document and the grammar stays frozen |
| A review package replaying its threads onto the reviewed state and forward | There is nothing to replay: threads are `at`-less references and §6.5 resolves them against the current state directly. `bundled` shape exists for the case where the reviewed state may be gone |

---

## 10. Decisions taken in this specification under stated defaults

Where the investigations established what must be declared but not its exact shape, this document chose a shape. Each is reversible before implementation; each is marked D-*n* so a reviewer can find it.

- **D-1** Initial snapshot addressing is `complete`; Git transition addressing is `complete | partial` (§4–§5).
- **D-2** `addressing.anchor` and `addressing.digest` are required manifest fields (C7).
- **D-3** Git-only `history.transform` is ordered (`projected`, `squashed`). A synthetic root requires truncated coverage; a materialized root has a verified deterministic origin and is not truncation.
- **D-4** The Git-only history descriptor uses §5.3, with retained commit count and an origin iff root is materialized. Snapshot history is exactly `{"mode":"none"}`.
- **D-5** Range summaries are keyed by origin root, carry `anchor`, and are named by the SHA-256 of their bytes; `bindings.json` has the three-field shape of §5.4.
- **D-6** All five reference kinds share the `v2` path segment; commit, diff and hunk forms are carried over unchanged (C10).
- **D-7** In Git mode exactly one branch exists, HEAD is symbolic to refs/heads/main, and the raw target equals the SHA-1 portion of `current.id`.
- **D-8** In Git mode a reverse index MAY be present and MUST NOT be required; snapshot mode forbids all Git entries.
- **D-9** Current-view entries in both modes SHOULD use unsigned UTF-8 bytewise path order; readers do not depend on it.
- **D-10** Data descriptors are permitted on every entry except the manifest (container.md: "everything after it may stream").
- **D-11** The reserved-prefix check is applied after NFC and case folding, consistent with the uniqueness rule.
- **D-12** `.mdpkg/address/overrides.json` MUST be absent when it would have zero entries.
- **D-13** `.mdpkg` is used as the working file extension throughout; registration is open (§11.1).
- **D-14** SHA-1 is the Git object format. SHA-256 is the snapshot state hash. SHA-256 Git repositories remain outside this revision (§11.2).
- **D-15** The manifest's `mdpkg` key is written first and every other key sorted, exactly as container.md measured.
- **D-16** Entry names MUST be unique case-insensitively: Unicode NFC followed by simple case folding (§3.6). For version 1, the fold table is pinned to Unicode 17.0.0 `CaseFolding.txt` C + S mappings (neither full nor Turkic folding); implementations MUST use these mappings regardless of their host Unicode version. NFC uses the implementation's normalization engine; this fold-table pin does not pin that engine's Unicode version. This is adopted from the documented collision risk and the measured NTFS `README.md` / `readme.md` collision (container.md), not from a measured NFC/NFD collision on a normalization-insensitive filesystem; that verification remains open (§11.1).
- **D-17** Line endings are normalized to LF on write. A conforming producer normalizes CRLF and lone CR to LF before storing content, so ZIP entry payloads in both modes and Git blobs in Git mode hold only LF-terminated text; the source digest profile `cm0312-source-lf-v1` normalizes CRLF and lone CR to LF again when decoding for hashing (§6.1 rule 1), which is a no-op on conforming stored content and a defensive fallback against nonconforming input. This is the format's only EOL rule, and it now governs stored bytes, not just the digest input. In Git mode it is not limited to the tip: every retained blob in the pack is LF too, so a projection whose source repository holds CRLF blobs rewrites those blobs, and therefore their blob IDs, and therefore every tree and commit that contains them. Measured: a three-commit CRLF source projected under this rule rewrote 7 of 10 blob slots, all 3 trees and all 3 commits, with `transform: []`, `coverage: complete` and every commit retained, while the identical projection of an already-LF source was the exact identity. So it is this rule, not projection in general, that severs a package's object IDs from its source — a projection that transforms no history and normalizes nothing changes nothing. `sourceRepository`, `sourceBase` and `sourceTip` (§5.3) remain source-lineage identifiers and do not imply that any object in the pack is byte-identical to its source. Scope: this rule covers every ZIP entry except those under `.git/` — all current files, including non-Markdown text and declared ledger/review files, that make up the current view (§2, §6.3), and the container-level JSON control files (§2, §4, §5.3, §5.4), all of which are UTF-8 text. The curated repository is excluded: §5.1 fixes the exact bytes of `HEAD`, `config` and `refs/heads/main`, which are LF-terminated by that specification and not by this rule, and the pack, its index and its reverse index are binary artifacts a producer MUST store byte for byte as Git wrote them. This revision admits no opaque or binary entry in the current view, so no binary-detection heuristic (Git's own NUL-in-a-prefix check, or otherwise) is needed or specified; a future version that admits tracked binary content would have to add one before D-17 could apply to it unmodified.
- **D-18a** *The unpack.* Direct extraction of the ZIP entries never converts line endings: a conforming extractor emits the stored LF bytes unchanged, on every platform, and in Git mode `git read-tree HEAD` after it writes only the index and is byte-exact under every host configuration (§3.8). Two independent rules make this true rather than one — D-17 leaves no CR byte for a converting mode to remove, and D-19 leaves no entry flagged as text for it to convert one in — so the guarantee survives either rule alone being broken by a re-emitting producer. D-17 normalizes on write and nothing normalizes on read, so this mirrors `core.autocrlf=input`, not `core.autocrlf=true`: there is no platform-native checkout, because the format ships no `.gitattributes` or filter configuration to drive one. Measured over nine extractor invocations: no tool added a CR byte in any region, and seven reproduced all eleven entries byte for byte.
- **D-18b** *The Git-mode checkout after extraction.* Whatever a consumer's Git does next follows the host's own `core.autocrlf`, and the format pins nothing. `.git/config` (§5.1) declares no `core.autocrlf`, so the host's system or global setting governs the extracted repository; under `false` or `input`, `git checkout -- .` and `git clone` preserve every byte, and under Git for Windows' installer default `true` they rewrite every document to CRLF — measured at 0 of 4 documents byte-identical, 25 CR bytes added by each of checkout and clone. A repository-level pin of `autocrlf = false` was measured and preserves every byte; it is rejected by requester decision (§9), because §5.1 fixes the `.git/config` bytes and §3.8 rests on the package shipping no filter configuration, so a pin is a rule the format would be adding rather than a default it would be restating. The byte-for-byte match between file on disk and tracked blob is therefore a guarantee of D-18a's unpack and not of a subsequently checked-out working tree. Nothing in addressing depends on it: a converted file is the stored bytes with LF replaced by CRLF, §6.1 rule 1 re-normalizes, and all 15 digests of the measured fixture resolve unchanged. What is lost is only the shortcut of hashing the file on disk as though it were the blob, which a consumer restores by setting `core.autocrlf` to `false` or `input` in the extracted repository.
- **D-19** Every central-directory record MUST set the ZIP internal file attributes field to `0` — bit 0, the text flag, clear — on every entry, and a validator MUST check it (§3.5, §4). Info-ZIP `unzip -a`, and any extractor with the same rule, converts only entries the archive itself declares to be text; against a conforming package that flag is never set, so there is nothing for such a mode to convert whatever the host's native line terminator. Measured across four combinations of stored content and the flag: the only converting cell is CRLF content in a text-flagged archive (21 CR bytes stripped from 3 of 4 documents), and every cell with either half conforming is byte-exact. D-17 alone would suffice for a package whose content is conforming; D-19 states the flag as well so extraction safety does not rest on the content rule being kept, and so §2's `unzip -a` counterexample can be retired rather than left asserted and unreproduced.

The seven that follow are the review-comment decisions of [review-comments.md](investigations/review-comments.md) §11.1, wired into §3.6, §4, §6.5, §6.6 and §6.8 above.

- **D-20** A sub-section anchor has exactly one selector kind: a character range over the canonical scope source of §6.1 rule 5 (§6.8). No `lineNumber`, no `wordIndex`, no `kind: line | word | char` discriminator; word-, line- and sentence-level gestures are converted to a character range by the producer at review time. Measured over 96,051 anchors on real revision pairs: line and sub-line-span anchors are indistinguishable under quote-plus-context matching (0.003% and 0.012% wrong at one revision of separation), while a line ordinal misplaced 1,582 of 1,583 npm spans and 16,145 of 16,151 rust spans because it structurally cannot address a sub-line range. This is the same choice §6.2 made in preferring a heading trail to a line number.
- **D-21** The selector profile is `cm0312-quote-context-v1`: `start`, `end`, `quote`, `occurrence`, `prefix`, `suffix`, defined only over the source `cm0312-source-lf-v1` canonicalizes and undefined over anything else (§6.8). Relocation is by quote search scored on context, with `occurrence` as a tiebreak of last resort and a refusal — `target-detached` — on a tie rather than a guess. Measured: 0.00%–0.06% wrong against 5.28%–31.32% for a stored offset alone and 32.83%–49.30% for a line ordinal; where the scoped digest is equal the stored offsets were exact in all 38,238 measured resolutions and never had to be searched; the price of refusing a tie is that 0.15%–0.43% of anchors report detached that a guess would have placed correctly.
- **D-22** No sub-section digest profile is defined. The quote is the sub-section state evidence and comparing it is the digest comparison (§6.8). A `cm0312-anchor-source-v1`-style digest over the anchored range answers strictly less (equal or not equal, with no way to relocate), costs 32 bytes against the quote's 40, and would need its own canonicalization, version and row in every §6 table. The section digest remains the staleness gate and is sound by construction: over 923 measured cases where the anchored run did not survive intact, the containing section's digest was unchanged 0 times.
- **D-23** Review data lives in a second package at `.mdpkg/review/comments.json` and bears identity in either mode. Historical always-Git overhead measurements do not prescribe snapshot overhead.
- **D-24** Delta may use either mode in a distinct namespace and contains only its review document. Bundled requires Git mode, reviewed namespace, one parent equal to the reviewed commit or verified snapshot C0, and changes only review paths (§4, §6.8).
- **D-25** Review correlation is the exact triple `(review.of.namespace, review.of.current.kind, review.of.current.id)`. Digest/length/dispatch are evidence only. Snapshot identity distinguishes bytes/declarations; Git commits additionally distinguish ancestry and commit metadata.
- **D-26** No package-instance identifier is added to the manifest. It would answer no question the D-25 key does not, and it would be an unverifiable claim: two byte-identical packages are indistinguishable to their receiver, so a receiver cannot check an instance id against anything in the bytes it holds, which is the test §5.3 already applies to claims and §4's admission rule already applies to manifest fields. Which *send* a review answers, where a producer fixes commit dates and can emit byte-identical packages twice, is transport knowledge: the sender supplies a dispatch token with the file and the review echoes it in the optional `review.of.dispatch` string, which the format stores and never interprets.

---

- **D-27** One `/1` schema uses typed snapshot/commit states and the exact SHA-256 `mdpkg-snapshot-v1` state hash (§4.1); old string-valued manifests are invalid.
- **D-28** Only one initial history-free published state per lineage; changed published successors require Git mode, and independent changed exports use fresh namespaces (§5).
- **D-29** Materialization deterministically creates C0 and a verified singleton origin; typed S0/C0 identities remain distinct and origin lifetime follows §5.6.
- **D-30** Declared/selective assurance differs from full verification; full assurance requires every mode/shape/origin obligation and reports nonapplicable Git checks honestly (§7).

---

## 11. Open questions

### 11.1 Explicitly carried forward, undecided

The first three were deferred by container.md and are not decided here; the fourth is a decision this document did take, and the two questions measuring it raised are now answered in §10 — what stays open under it is the unmeasured surface, not the rules.

1. **ZIP64 policy.** Behaviour past 4 GiB or 65,535 entries. Options are: permit ZIP64 with mandatory locator handling (readers must follow the 20-byte locator before the EOCD to the ZIP64 EOCD, and the small tail read no longer suffices), or exclude it from the profile with a hard producer limit. Today's only tested behaviour is rejection by the evidence reader. Nothing in the corpora approaches the limits.
2. **Media type and file extension registration.** What a `.mdpkg` file is called and served as. A media type of the form `application/vnd.…+zip` is unregistered. Because the file must begin with `PK` for ordinary tools to work, extension- and sniffer-based dispatch will sometimes see a generic ZIP; that is accepted, but the names are not chosen.
3. **Cross-platform normalization testing.** No macOS, APFS, HFS+ or other normalization-insensitive filesystem was reachable. The NFC-plus-case-fold uniqueness rule itself is decided (D-16); what remains open is verifying it against a real NFC/NFD collision, rather than the measured NTFS case collision it was adopted from. Windows 11, newer 7-Zip, macOS Archive Utility and Info-ZIP `zip` as a rewrite tool are untested.
4. **EOL behaviour: measured, decided, and open only where it is unmeasured.** D-17 and D-18 were decided on argument alone; [2026-09-08-card-0010-eol-evidence.md](investigations/2026-09-08-card-0010-eol-evidence.md) measured them against a CRLF source and every ZIP tool on a Windows host. D-17 is confirmed and is heavier than its original wording, which its §10 entry now carries: the CRLF projection rewrote 7 of 10 blob slots, all 3 trees and all 3 commits while the LF-source control was the exact identity, so it is the EOL rule and not projection that severs a package's object IDs from its source. The §4 validator obligation is confirmed: a CRLF-storing package and its conforming twin differ in size, SHA-256, `HEAD` and 3 of 4 document CRCs, resolve to the same 15 digests, and the EOL scan that separates them costs only payload the validator has already decoded. D-18 was split on the strength of the measurement rather than left as one claim: **D-18a**, the unpack, held in all nine invocations — not one added a CR byte, and `unzip -aa`, the only converting mode, damaged the pack and index rather than the documents (`git fsck` exit 70) — while **D-18b** is not a guarantee at all but a statement that the host's `core.autocrlf` governs everything after `git read-tree`, unpinned by requester decision (§9). The internal-attributes question that measurement raised is decided as **D-19**, which also retires §2's `unzip -a` parenthetical. What remains open is the unmeasured surface that card lists and this section does not repeat in full: any non-Windows host, a native DOS-port Info-ZIP (the only build that would attempt LF→CRLF at the unpack layer), a source tree carrying its own `.gitattributes`, documents with a BOM or in UTF-16, and `core.eol` / `core.safecrlf` in combination with the settings above.

### 11.2 Raised by the investigations and never closed

1. **SHA-256 Git object format.** Git probes use SHA-1; SHA-256 Git remains unsupported/open. SHA-256 snapshot state identity is adopted and does not settle Git object-format support (D-14).
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
13. **Reader versus validator obligations — closed.** §7 defines declared/selective versus full identity assurance and the required checks for each mode, review shape and origin.
14. **HTTP range deployment.** The protocol conditions (strong validator, no whole-response content encoding, CORS exposure of `Content-Range` and `ETag`) were measured over loopback in Node, not in a cross-origin browser.
15. **Selector quote length.** The 40 characters of `quote`, `prefix` and `suffix` in §6.8 are a probe constant with no optimum behind them. The trade is ambiguity (shorter quotes match in more places) against fragility (longer quotes are broken by more edits) against size (roughly 3 bytes per thread per character, counting prefix and suffix). A sweep over 16/24/40/64/96 on the same corpora would settle it and was not run.
16. **Anchors spanning entity boundaries.** Undefined in version 1 (§6.8): a selection crossing two sections is two anchors or one anchor on the common ancestor. The probes saw 0–6 anchors per run whose target left its section entirely, which is a related signal and not this question.
17. **Unicode normalization and the selector.** §6.1 deliberately does not normalize Unicode, so a selector minted over NFC source will not match NFD source. Whether that occurs in practice, and whether the selector profile should say anything about it, is unmeasured; it sits next to §11.1 item 3, the untested NFC/NFD filesystem collision.
18. **Review volume.** 200 threads were measured. The ≈540-byte fixed cost per thread before any comment text makes 5,000 threads about 2.7 MB, which is the same shape of problem as item 6's ledger density and probably wants the same answer. Unmeasured, and it is the condition under which dropping `loc` from `bundled` threads (§9) would be reconsidered.
19. **Reply chains three deep.** A review package reviewing a review package reviewing an original falls out of §6.8 with no new rules — every review package is an ordinary package with a namespace and a `current` — and has not been built.
20. **Merging review packages.** Two reviewers, two review packages, one producer. The producer can consume both independently; producing a single merged review artifact, and reconciling conflicting threads, is undefined.
21. **Whether `bundled` may ever carry ledger changes.** D-24 forbids a review commit from touching anything outside `.mdpkg/review/`, which is safe and may be too strict for a reviewer who legitimately confirms a rename it can see.
22. **Cost of the selector on a cold reader.** §6.5's measured resolution reads the manifest, the ledger and one document; the selector adds a substring search over one section and no I/O. Not separately timed.
