# CARD-0002: compression investigation and proposed spec section

Status: investigation complete; recommendation for decision and consolidation, not an implemented format. Evidence checked on 2026-09-06.

**ZIP follow-up recommendation:** if opening the package in ordinary ZIP tools is a requirement, use **ZIP method 8 (independent raw DEFLATE), producer level 6, with method 0 (stored) when smaller**. Put the authoritative version in a well-known stored manifest, preferably first, and optionally mirror it in a short EOCD comment. Direct document browsing and selective section access cost real bytes compared with solid compression. One solid tar.gz inside ZIP retains solid compression, but exposes only the nested archive and fails the required section access boundary. These are measured findings below, not an implemented format or an approved change to CARD-0001.

The original **independent gzip / stored** recommendation remains the non-ZIP alternative. Its native browser argument still applies to DEFLATE, while ZIP supplies its own framing and CRC. The earlier codec, device and timing evidence is retained after the follow-up.

## ZIP follow-up: size, metadata, compatibility and access

### Complete ZIP sizes on the same corpora

The follow-up reuses `benchmark.py`'s pinned git objects, 131 npm / 668 Rust entries, lexicographic `key` ordering and encoder versions. Every one of the **799 manifest entries matches** the prior run, and whole/per-entry gzip sizes match exactly. ZIP member names are the existing keys (`path.md@base` or `path.md@diffNN`); these identify experiment snapshots/diffs, not the final naming scheme. No directory entries, timestamps beyond the fixed ZIP epoch, extra fields, comments or descriptors are added to the plain rows. Every ZIP row includes both local and central headers, paths, CRCs and EOCD. The raw codec baselines still exclude paths/indexes and remain lower-bound comparators, as in the earlier report.

“Over best solid” is `(bytes / best prior solid bytes - 1) × 100`, using **74,379 bytes, Brotli 11 for npm**, and **2,168,300 bytes, xz 6 for Rust**. It does not silently change the denominator to gzip. The requested tar.zst uses the prior **zstd level 9**, checksum and content-size enabled; it is not a search for the smallest possible tar.zst. Both solid tar members use ZIP **stored**, avoiding a second compression layer.

<!-- ZIP_SIZE_START -->

| Variant | npm bytes | Over best solid | Rust bytes | Over best solid |
| --- | --- | --- | --- | --- |
| Best prior solid (Brotli 11 npm / xz 6 Rust) | 74,379 | +0.00% | 2,168,300 | +0.00% |
| Whole gzip 6, payload only | 95,662 | +28.61% | 2,914,070 | +34.39% |
| Independent gzip 6, payload only | 142,863 | +92.07% | 3,332,597 | +53.70% |
| ZIP, per-entry DEFLATE 6 | 162,453 | +118.41% | 3,420,017 | +57.73% |
| ZIP, stored entries | 367,105 | +393.56% | 9,531,026 | +339.56% |
| ZIP, one stored tar.gz (gzip 6) | 102,301 | +37.54% | 2,959,376 | +36.48% |
| ZIP, one stored tar.zst (zstd 9) | 89,129 | +19.83% | 2,530,387 | +16.70% |
| Hybrid: ZIP of 64 KiB tar.gz blocks + stored map | 116,194 | +56.22% | 3,178,708 | +46.60% |
| Hybrid: DEFLATE files + duplicate solid tar.gz | 264,746 | +255.94% | 6,379,385 | +194.21% |
| ZIP DEFLATE + stored version manifest + EOCD hint | 162,618 | +118.63% | 3,420,182 | +57.74% |

<!-- ZIP_SIZE_END -->

The tar construction is deterministic Python PAX tar: original payload bytes; uid/gid/mtime zero; empty user/group names; mode 0644; 512-byte member padding and 10,240-byte archive records. Decoded tar sizes are **450,560 / 9,953,280 bytes**. Tar paths, headers and padding therefore add work that the older concatenated-payload baseline did not have. The ZIP wrapper around tar.gz costs **126 bytes**; around tar.zst, **128 bytes**. Plain per-file ZIP metadata costs **21,948 / 99,444 bytes**; the compressed file data alone is the previous raw-DEFLATE row, **140,505 / 3,320,573 bytes**. Compared with independent gzip payloads, the complete browsable ZIP adds **19,590 / 87,420 bytes (13.71% / 2.62%)**.

The versioned ZIP row adds exactly **165 bytes** on either corpus: a 42-byte `.mdpkg/manifest.json`, 116 bytes of local/central headers and path duplication, and the 7-byte comment `MDPKG/1`. This measures only version discovery. History and stable section identity metadata remain outside these plain rows; they must be counted when CARD-0005 has a representation.

### The verdict and measured hybrids

**Solid compression and a ZIP-openable outer file are achievable together. Solid-size storage and direct browsing of the individual Markdown documents by ordinary ZIP readers are a tradeoff for these standard encodings.** A reader sees one `payload.tar.gz`/`payload.tar.zst` member in the solid variants, not the documents inside it. Browsing that inner archive requires another decoder and a scan; Windows 10's ZIP handler can extract the outer member but is not being claimed to browse its tar contents. Renaming `.gz` to `.zip` or placing a gzip stream before a directory does not make its output ordinary independently extractable ZIP members.

At the same DEFLATE level, the directly browsable ZIP is **69.82% / 17.36% larger than whole gzip payloads**, and **58.80% / 15.57% larger than ZIP with one tar.gz**. The solid tar.gz ZIP is only **6.94% / 1.55% above whole gzip**, including the actual tar envelope. Thus much of npm's cost is losing cross-document compression; ZIP's own headers are a smaller, separately measured cost.

Two hybrids were constructed and verified:

- **ZIP of independent 64 KiB-target tar.gz blocks with a stored lookup map:** **116,194 / 3,178,708 bytes**, saving **28.48% / 7.06%** against plain per-file ZIP. It contains **6 / 171** blocks, grouping the same complete entries as the earlier 64 KiB experiment. The map costs **8,316 / 37,146 bytes** and includes each key, block number, tar data offset and raw length. ZIP readers expose blocks; a package-aware reader can fetch one block. This satisfies “do not decode the whole package” on these corpora, but gives up direct file listing in ordinary ZIP tools. The target's tar blocks decode to **40,960 / 61,440 bytes**. The 64 KiB figure remains an input grouping target: oversized documents and tar overhead can exceed it.
- **ZIP with both per-file DEFLATE entries and a duplicate stored solid tar.gz:** **264,746 / 6,379,385 bytes**. It gives ordinary file browsing plus a solid representation for consumers that choose it, but the file is **176.75% / 118.92% above whole gzip**. Its selective path is the ordinary document entry. This demonstrates that duplication delivers both access modes, at the sum of their storage costs. It is not recommended.

Independent sections, bounded blocks or explicit DEFLATE restart/checkpoint indexes could introduce other tradeoffs. A central-directory entry pointing into the middle of an ordinary solid DEFLATE stream cannot supply its missing decoder history. No unmeasured checkpoint scheme is claimed to recover solid size or work with ordinary ZIP tools.

### What can be read without decompression

The following layout was exercised by `zip_benchmark.py` and the codec-free `zip_tail_reader.mjs`. Lengths are bytes, not Unicode characters. Field-width maxima are different from good interoperability limits.

| Place | Capacity / encoding | Physical location | Readable from a tail request? |
| --- | --- | --- | --- |
| Archive comment | 0–65,535 bytes; 16-bit length | Immediately after the fixed 22-byte EOCD, normally ending at EOF | Yes, entire comment and EOCD fit in the final 65,557 bytes |
| Local extra area | 0–65,535 bytes total; each field has 16-bit ID, 16-bit payload length, payload | After a member's 30-byte local header and filename, before its data | Only if that particular header lies in the fetched tail; otherwise seek to it |
| Central extra area | A separate 0–65,535-byte area per member, same tagged framing | After the central header's 46-byte fixed part and filename | With the central directory; does not require the local copy |
| One custom extra payload | At most 65,531 bytes when it alone fills the extra area; other fields reduce this | Local and/or central extra area | Put a copy in the central area for tail-directory lookup; local and central copies are not inherently identical |
| Per-entry comment | 0–65,535 bytes per member; 16-bit length | After filename and extras in the central record; no local-header copy | With the central directory |
| Central directory | Sequence of variable records, with names, methods, CRC32, compressed/decoded sizes and local offsets; 32-bit size/offset and 16-bit counts in classic EOCD | Usually immediately before EOCD, or before ZIP64 end records | Tail gives its location; fetch missing directory bytes if it extends earlier |
| ZIP file attributes | 2 internal bytes and 4 host-dependent external bytes per entry | Fixed central header | Yes with directory; these encode attributes such as permissions, not a portable arbitrary property store |

These are ordinary, single-disk, unencrypted ZIPs. The [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), §§4.3–4.6, also permits aggregate central-directory compression/encryption; such archives cannot promise clear directory access. It recommends keeping each complete directory record, including name, extras and comment, within 65,535 bytes. Consequently, the maxima above should not all be filled simultaneously in an interoperable profile. Existing extras, including ZIP64, consume the same budget. The probe ID **0xD06D** is experimental, not an allocated production ID; select/register a nonconflicting ID and include an identifying payload magic before adopting one. Do not repurpose a known ID or append an ad hoc trailer after EOCD.

The boundary fixture deliberately fills all three 16-bit metadata areas to demonstrate their independent widths: **262,261 total bytes**, **131,127 central-directory bytes**, a **65,535-byte archive comment**, a **65,535-byte entry comment**, and **65,531-byte custom payloads** in both local and central extras. Python zipfile reads it; the JS reader gets EOCD/comment in **65,557 bytes**, then the directory in another **131,127 bytes**, without any codec call. Reading the local extra requires another **30 + 65,535 bytes**; neither its filename bytes nor its one-byte stored payload is fetched. This intentionally exceeds the recommended combined record length and is a capacity probe, not a profile to ship or a claim of all-tool compatibility. A second fixture places an EOCD-looking signature inside a comment; the JS reader finds the real terminal record by validating comment length.

ZIP64 does not enlarge the 16-bit comment/extra length fields. When classic size/count/offset sentinel values occur, a reader must inspect the **20-byte ZIP64 locator immediately before EOCD**, follow its 64-bit offset to the ZIP64 EOCD, and obtain the widened directory location/size/count. The variable ZIP64 record might itself require a further range. The small supplied reader explicitly rejects ZIP64, split archives, noncanonical offsets and encryption; production support must be implemented or excluded by the profile. It is an evidence probe, not a general ZIP validator. [ZIP64 structure reference](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), §§4.3.14–4.3.16.

### Tail-only JS and real HTTP ranges

`zip_tail_reader.mjs` uses `fetch`, `Uint8Array` and `DataView`; **no decompressor is imported**. It fetches a suffix, scans backward for a valid terminal EOCD, reads the directory's recorded extent, then resolves a selected local header and member data. It checks lengths/bounds and one stable strong ETag, and reuses bytes already fetched. It reads local name/extra lengths separately: the central extra length is not a substitute for the local one. Reading metadata does not validate payload CRCs or authenticate arbitrary metadata.

The Node **24.6.0** driver served the actual files over loopback HTTP and checked **198 `206` responses**, covering **56 document/section range scenarios and 3 metadata fixtures**. Every fetched payload slice matched the corresponding fixture; per-file documents/sections additionally matched SHA-256 in JS, while Python independently checked tar/gzip/zstd extraction. For the plain ZIPs, a conservative **65,557-byte** suffix contains the complete directories (**12,011 / 55,055 bytes**). On these no-comment files, a **22-byte** initial request followed by the directory needs just **12,033 / 55,077 metadata bytes**. The maximum-comment fixture proves the directory does not always fit in the fixed suffix.

**Yes, HTTP ranges can retrieve the directory without downloading the package.** The server must honor ranges and serve the original byte representation; a `200` response to `Range` is a full-download fallback, not selective I/O. Validate `206`, `Content-Range` and total length. Keep one representation across requests with a strong validator/immutable URL; whole-response `Content-Encoding: gzip` changes the offsets. These are protocol conditions, not an assurance about an untested deployment. [HTTP Semantics, range requests and If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests).

Cross-origin browser use additionally requires CORS permission and exposing `Content-Range`, `ETag` and any inspected non-safelisted response headers. A suffix range and this reader's `If-Range` require appropriate preflight permission (`Range`, `If-Range`); the safelisted single-range rule is narrower than “all Range requests”. Node does not enforce browser CORS, so this loopback run is **not** a cross-origin-browser test. Local files can use `Blob.slice`/seek with the same byte arithmetic. [Fetch Standard source, CORS-safelisted request headers and CORS protocol](https://raw.githubusercontent.com/whatwg/fetch/main/fetch.bs).

### One document and one section: CARD-0004

The targets are the same late-in-package base documents used by the original harness:

| Corpus | Document | Raw document | Measured section, including heading | Offset in document | Section bytes |
| --- | --- | --- | --- | --- | --- |
| npm | `docs/lib/content/using-npm/workspaces.md@base` | 6,115 | `### Description`, through before the next heading | 75 | 851 |
| Rust | `text/3872-crates-io-security.md@base` | 8,057 | `## Summary`, through before the next heading | 233 | 175 |

The following is the **payload I/O after physical lookup**, and decoded output processed when completing the selected compression unit and validating available checksums. The raw Brotli baseline has no intrinsic checksum; its output was checked against the corpus. Decode output applies equally to document and section. Zero means stored bytes, with no decompressor. Offsets/digests are test fixtures, not stable section IDs. The section-only stored row assumes an already resolved current section extent and a trusted section digest; without that map, read the whole stored document (**6,115 / 8,057 bytes**) and locate its section. A partial stored read cannot validate the ZIP entry's whole-document CRC.

<!-- ZIP_ACCESS_START -->

| Variant | npm fetch doc / section | npm decode output | Rust fetch doc / section | Rust decode output |
| --- | --- | --- | --- | --- |
| Best prior solid (Brotli 11 npm / xz 6 Rust) | 74,379 / 74,379 | 345,157 | 2,168,300 / 2,168,300 | 9,431,582 |
| Whole gzip 6, payload only | 95,662 / 95,662 | 345,157 | 2,914,070 / 2,914,070 | 9,431,582 |
| Independent gzip 6, payload only | 2,240 / 2,240 | 6,115 | 3,227 / 3,227 | 8,057 |
| ZIP, per-entry DEFLATE 6 | 2,222 / 2,222 | 6,115 | 3,209 / 3,209 | 8,057 |
| ZIP, stored entries | 6,115 / 851 | 0 | 8,057 / 175 | 0 |
| ZIP, one stored tar.gz (gzip 6) | 102,175 / 102,175 | 450,560 | 2,959,250 / 2,959,250 | 9,953,280 |
| ZIP, one stored tar.zst (zstd 9) | 89,001 / 89,001 | 450,560 | 2,530,259 / 2,530,259 | 9,953,280 |
| Hybrid: ZIP of 64 KiB tar.gz blocks + stored map | 7,828 / 7,828 | 40,960 | 15,231 / 15,231 | 61,440 |
| Hybrid: DEFLATE files + duplicate solid tar.gz | 2,222 / 2,222 | 6,115 | 3,209 / 3,209 | 8,057 |
| ZIP DEFLATE + stored version manifest + EOCD hint | 2,222 / 2,222 | 6,115 | 3,209 / 3,209 | 8,057 |

<!-- ZIP_ACCESS_END -->

Whole-stream rows complete the entire stream, including **9,431,582 raw payload bytes** or **9,953,280 tar bytes** for Rust; gzip, zstd and xz additionally validate their trailer checksums. Streaming can discard earlier output but cannot jump directly to the section. Early exit after reaching a target also processes all preceding stream history and does not verify a final checksum; neither satisfies the intended isolated access. The per-entry rows decode only the containing document. The block hybrid decodes only one bounded group, plus reads its stored map. Thus **plain ZIP DEFLATE/stored and the block hybrid meet the no-whole-package-decode condition; a lone solid member does not**. A duplicate hybrid meets it through its per-file copy.

These are physical access results, not a claim to have implemented CARD-0004's semantic resolver. Stable section identity must use its agreed anchor/producer ID and scoped digest, with headings included for rename detection; byte offsets are only replaceable locators. A per-document section map can live in a clear central extra or independent manifest shard, or be recomputed after decoding that document. None requires decoding unrelated documents. Central-directory names alone do not provide stable section references, and these plain sizes do not include a future comprehensive section-ID/digest map. The block map is measured and included, but maps entries rather than stable sections. History-chain reconstruction also remains separate.

Cold HTTP body-byte totals below include directory discovery, local-header probes, optional block-map retrieval and the selected payload. Each cell is **document bytes (requests) / section bytes (requests)**. Headers, RTT, CORS preflight and decoder delivery are excluded. The reader caches all previously fetched ranges. Starting with 22 bytes falls back to the full suffix when a comment prevents discovery; this happens on the versioned row. A small fixed profile comment would allow a more precise initial suffix.

<!-- ZIP_RANGE_START -->

| Variant | npm 22-byte start | npm 65,557-byte start | Rust 22-byte start | Rust 65,557-byte start |
| --- | --- | --- | --- | --- |
| ZIP, per-entry DEFLATE 6 | 14,285 (4) / 14,285 (4) | 65,557 (1) / 65,557 (1) | 58,316 (4) / 58,316 (4) | 68,796 (3) / 68,796 (3) |
| ZIP, stored entries | 18,178 (4) / 12,914 (4) | 65,557 (1) / 65,557 (1) | 63,164 (4) / 55,282 (4) | 73,644 (3) / 65,762 (3) |
| ZIP, one stored tar.gz (gzip 6) | 102,287 (4) / 102,287 (4) | 102,287 (3) / 102,287 (3) | 2,959,362 (4) / 2,959,362 (4) | 2,959,362 (3) / 2,959,362 (3) |
| ZIP, one stored tar.zst (zstd 9) | 89,114 (4) / 89,114 (4) | 89,114 (3) / 89,114 (3) | 2,530,372 (4) / 2,530,372 (4) | 2,530,372 (3) / 2,530,372 (3) |
| Hybrid: ZIP of 64 KiB tar.gz blocks + stored map | 16,674 (6) / 16,674 (6) | 73,903 (3) / 73,903 (3) | 63,467 (6) / 63,467 (6) | 117,994 (5) / 117,994 (5) |
| Hybrid: DEFLATE files + duplicate solid tar.gz | 14,352 (4) / 14,352 (4) | 67,809 (3) / 67,809 (3) | 58,383 (4) / 58,383 (4) | 68,796 (3) / 68,796 (3) |
| ZIP DEFLATE + stored version manifest + EOCD hint | 65,557 (2) / 65,557 (2) | 65,557 (1) / 65,557 (1) | 68,796 (4) / 68,796 (4) | 68,796 (3) / 68,796 (3) |

<!-- ZIP_RANGE_END -->

The conservative npm suffix already contains its late target, so the document and section cost the same **65,557 bytes**. That is overfetch, not free random access. For Rust, a 22-byte discovery plus directory and target DEFLATE member costs **58,316 bytes** for either the document or its section; with a cached directory/extent it falls to **3,209 bytes**. No new latency or memory benchmark was run: the original raw-DEFLATE entry timing remains applicable to its identical compressed payload, while the table measures the previously excluded container/network bytes.

### Raw prefix compatibility: actual tools

Five fixtures contain a stored manifest with custom fields/comments and a deflated **145,000-byte** document. “Adjusted” writes the prefix before constructing ZIP so **both central-directory location and every local-header offset include it**. “Unadjusted” simply prepends bytes to an already complete ZIP. The prefixes are `01` and illustrative `ff ff 00`; the latter exercises three bytes, not an approved continuation encoding. Acceptance requires both extracted payload SHA-256 hashes to match, not just a successful open call. All files have a `.zip` extension.

| Reader / installed version | Normal PK ZIP | 1-byte adjusted | 3-byte adjusted | 1-byte unadjusted | 3-byte unadjusted |
| --- | --- | --- | --- | --- | --- |
| Windows 10 Pro 19045, Explorer/zipfldr **10.0.19041.4522** | Accept | Accept | Accept | Fails to list entries | Fails to list entries |
| 7-Zip **21.07 x64** | Accept, exit 0 | Accept, exit 0 | Accept, exit 0 | Reject, exit 2 | Reject, exit 2 |
| Info-ZIP UnZip **6.00, 20 Apr 2009** | Accept, exit 0 | Accept, exit 0 | Accept, exit 0 | Recovers, warning/exit 1 | Recovers, warning/exit 1 |
| Python **3.10.2**, standard `zipfile` | Accept | Accept | Accept | Accept | Accept |
| **fflate 0.8.2** `unzipSync`, Node **24.6.0** | Accept | Accept | Accept | Returns wrong names/empty payloads | Returns wrong names/empty payloads |
| macOS Archive Utility | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |

The Windows test uses the **actual built-in compressed-folder Shell namespace**, enumerates its items, and extracts through `Shell.Application.NameSpace(...).CopyHere`; it is not .NET `Expand-Archive`. It does not claim a visual double-click test or custom-extension association. macOS is not reachable; Windows 11, newer 7-Zip and other JS libraries were not exercised. The installed versions, fixture hashes, output and warnings are in [zip-shell-results.json](compression/zip-shell-results.json), [zip-compat-results.json](compression/zip-compat-results.json) and [zip-js-results.json](compression/zip-js-results.json).

**CARD-0001's raw first byte is technically viable with corrected offsets in all five tested readers.** “Most ZIP readers scan backward, so prepend anything” is unsafe: only Python and Info-ZIP repaired the stale offsets here. A prefix does not survive every rewrite even when readers initially accept it. The raw byte also changes leading magic and may affect file sniffers; extension/magic-based dispatch beyond these tests needs qualification. Python explicitly supports writing ZIP after an existing file, but that API behavior does not promise other tools' repair policies. [Python zipfile append documentation](https://docs.python.org/3/library/zipfile.html#zipfile.ZipFile).

### Version placement and archive rewrites

**Recommend `.mdpkg/manifest.json` stored, unencrypted and first as the authoritative version; optionally mirror `MDPKG/<version>` in EOCD.** Keep standard leading PK for the proposed ZIP profile. This is an explicit proposed revision of CARD-0001's first-byte requirement, requiring the owner's decision in consolidation. If that requirement is retained, use corrected absolute ZIP offsets and also keep the manifest; the prefix can serve dispatch but should not be the sole recoverable version.

| Candidate | Exactly how to find it | Rewrite consequence |
| --- | --- | --- |
| Raw prefix | Read byte 0, then the defined continuation bytes; ZIP reader separately uses recorded offsets | New ZIP creation from extracted files loses it; preserving/updating an existing stub is tool-dependent |
| EOCD comment | Read final 65,557 bytes, find a terminal EOCD whose declared comment ends at EOF, validate magic and parse version | Easy to replace/drop as an archive comment; use as a hint, compare with authoritative manifest |
| First stored manifest | At byte 0 parse the 30-byte local header and variable name/extra lengths, verify expected name and method 0, then read bounded manifest bytes; a conforming producer should provide sizes without a descriptor | Entry contents tend to survive ordinary repacking, but its order and stored method do not; find it by central-directory name if moved |
| Manifest found through directory | Fetch EOCD/directory, locate the unique well-known name, read its local lengths then payload; if a generic tool compressed it, decoding that small entry is necessary | Provides the durable recovery path; generic repacking can yield a recoverable but nonconforming package |
| Custom extra | Parse local extra near the first member or scan central extras for an agreed ID and payload magic | Unknown extras may be dropped or copied selectively; never make them the only authority |
| Central entry comment | Find the agreed manifest entry in the directory and parse its comment | Editable human metadata with no automatic preservation guarantee |

Actual rewrite outcomes from the **adjusted one-byte** fixture (both ordinary entry contents survived all five operations):

| Operation | Raw prefix | EOCD comment | Manifest entry comment | Custom local + central extras | Manifest content / method |
| --- | --- | --- | --- | --- | --- |
| Python rebuild by filename and bytes | Lost | Lost | Lost | Lost | Preserved / stored |
| Python rebuild copying `ZipInfo` and archive comment explicitly | Lost | Preserved | Preserved | Preserved | Preserved / stored |
| 7-Zip 21.07 `a`, adding a file to existing archive | Preserved | Preserved | Preserved | Preserved | Preserved / stored |
| Windows compressed-folder extract then create ZIP | Lost | Lost | Lost | Lost | Preserved / stored in this fixture |
| fflate 0.8.2 `unzipSync` then `zipSync` | Lost | Lost | Lost | Lost | Preserved / **DEFLATE** |

The recommended profile should reject conflicting version copies and never infer version 1 just because PK exists. EOCD is a discovery hint, not authority or authentication. If the comment disappears but a stored manifest survives, no-decompress version discovery still works through the directory. If generic repacking compresses the manifest too, strict no-decompress discovery no longer holds: a repair/import path may decode just that manifest and re-emit a conforming package. An archive rewrite preserving payload bytes is not necessarily a format-preserving package rewrite. If files change, section maps/digests must be recomputed by a package-aware producer.

### The “file attribute” idea

**NTFS alternate data streams are readable without unzipping, but are outside the portable byte stream.** Native code can read `package.zip:mdpkg.version` or enumerate streams. In the local experiment, a one-byte version stream survived PowerShell `Copy-Item` on NTFS. The same package copied using `ReadAllBytes`/`WriteAllBytes`, packed/extracted through Python ZIP, or downloaded over HTTP lost that stream, while the ordinary file's SHA-256 stayed identical. Thus it can be a local cache/convenience, never the sole portable version. Stream storage and ordinary file attributes are separate concepts. [Microsoft file streams](https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams).

**POSIX-style xattrs have the same transport limitation**, with OS/filesystem-specific APIs and limits; they are not a universally specified POSIX file-body feature. Linux `getxattr`/`listxattr` can inspect them without reading/decompressing package contents. Linux documents a 255-byte attribute-name limit and 64 KiB value/list limits, with tighter filesystem limits possible. Attribute-aware copy/backup may preserve them when the destination supports them; ordinary file bytes, HTTP downloads and generic archive entries do not encode them automatically. No Linux/macOS xattr execution is claimed here. [Linux xattr(7)](https://man7.org/linux/man-pages/man7/xattr.7.html).

For a concrete cross-platform API distinction, Python `copyfile` copies file contents, while `copy2` attempts extended-attribute preservation on Linux but still cannot preserve all metadata or Windows alternate streams. Both source/destination capability and the transfer tool matter. An archive with explicitly serialized xattrs/ADS can transport them, but that is additional in-band data and reader support, not a property of the `.zip` byte stream's filesystem attributes. [Python shutil](https://docs.python.org/3/library/shutil.html).

### Follow-up reproduction, checks and handoff

After the original setup below, run from `C:\src\markdown-package` in this order. No new dependencies are required. Installed tool paths are explicit in `zip_compat.py`; Explorer automation is Windows-only. Info-ZIP `unzip` is installed, its separate `zip` writer is not; no Info-ZIP rewrite result is claimed.

```powershell
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/zip_benchmark.py
& docs/investigations/compression/zip_shell_probe.ps1
node docs/investigations/compression/zip_probe.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/zip_compat.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/verify_zip_evidence.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/render_zip_tables.py
```

Artifacts: [ZIP sizes/access](compression/zip-results.json), [JS ranges/library behavior](compression/zip-js-results.json), [native compatibility/rewrites](compression/zip-compat-results.json), [Windows shell/ADS](compression/zip-shell-results.json), [verification counts](compression/zip-verification.json). Binary fixtures and extraction directories remain ignored under `.antiphon/compression-work/zip/`. Shell/native runs use fresh directories, so saved scratch paths change across reruns. The JS probe handles only trusted experimental fixtures; no production parser, extraction service or browser security test suite was added.

Validation: **799 corpus-entry matches, 4 exact gzip baseline checks, 5,780 payload round trips, 32 document/section comparisons, 6 metadata boundary checks, and 14 archive size/hash/CRC audits**. Compatibility: **25 tool/fixture cases, 19 successful extractions and 6 observed failures**, all six on stale-offset prefixes; **5 metadata rewrite cases**. HTTP: **56 selective-access scenarios, 3 metadata fixtures, 198 successful 206 responses**; **5 ADS presence/transport checks**. **0 unexpected failures in final evidence.** Two preliminary harness invocations failed: an absent optional Info-ZIP writer queried for its version, and Windows default text decoding of the JS results. Both were fixed and reran successfully. No timing suite or application build was needed for this follow-up.

**Decision for CARD-0001/0005:** adopt standard ZIP DEFLATE/stored with the manifest/EOCD version arrangement, revising byte-zero version dispatch; or retain a corrected prefix with explicit rewrite/import rules. If smaller packages outweigh direct document browsing, the measured block hybrid preserves bounded access and is the alternative. A single solid member is unsuitable as the only representation under CARD-0004. CARD-0004 still owns stable section IDs, rename detection and the final section-map encoding; this investigation establishes that independent documents or bounded groups can satisfy its I/O requirement.

## Original proposed compression section (non-ZIP alternative)

These are proposed requirements for CARD-0005 to consolidate. Numeric codec IDs, field encodings, offsets, the container envelope and reference syntax remain with their owning cards.

1. Baseline readers support `stored` and `gzip`. A compressed entry contains exactly one RFC 1952 gzip member with its own DEFLATE state, CRC32 and ISIZE trailer. An entry needs no preceding entry to decompress. Markdown snapshots and diff payloads use the same compression rule; compression imposes no history representation.
2. The producer default is gzip level 6, ordinary 32 KiB DEFLATE history, default strategy. Use no filename, comment or extra header fields; set MTIME to zero. Level is producer policy, not a decoder capability or semantic identity. Readers accept valid streams produced at other normal gzip levels. Deterministic byte-for-byte repacking additionally requires a pinned encoder version/header policy; semantic IDs must not depend on those bytes.
3. Choose `stored` when gzip does not reduce the payload size after any differing container metadata is counted. A stored entry has no gzip wrapper. The two corpora had no expanding gzip entries, so the reported per-entry totals also equal this hybrid policy's payload totals.
4. Start a fresh decoder for each entry and give it exactly the compressed slice specified by the container. **Do not pass concatenated gzip members to one `DecompressionStream`**. All three tested engines rejected that input. Drain the member to completion, validate its checksum and declared output length, and propagate errors before declaring the entry verified. `ISIZE` is modulo 2^32, so the container still needs an authoritative decoded length and reader output limits.
5. Use `DecompressionStream('gzip')` where a valid-fixture capability probe succeeds. A small lazy-loaded JavaScript inflater can cover older engines; its wrapper must also implement the required integrity and length checks. The measured fflate bundle is a size/performance candidate, not an approved complete validation layer. Large decode jobs belong in a worker. No external dictionary is allowed in the baseline profile.
6. Keep the envelope/version and the information needed to locate an entry outside a whole-package compression stream. The container must let a reader obtain codec, compressed extent and decoded length without decoding every document. It can choose the exact index and metadata representation.

Gzip adds 12 bytes per entry over zlib-wrapped DEFLATE and 18 over raw DEFLATE in these measurements. That is 1,572 / 2,358 bytes for npm and 8,016 / 12,024 for Rust. Gzip earns this small cost through broadly available standalone tooling and a self-checking standard member. If CARD-0001 selects ZIP, use ZIP's standard method-8 **raw DEFLATE** framing and container CRC instead of nesting gzip: that is a container-driven revision of this proposal, with the same DEFLATE algorithm and measured raw-DEFLATE row, not a new codec investigation.

## Browser and device support

Minimum default-enabled versions for **in-page byte decoding**, not HTTP negotiation. Android rows describe the corresponding browser engine; embedded WebViews can lag their host browser. A WKWebView follows its installed WebKit/OS capabilities. Detect the actual decoder rather than infer it from an app's brand.

| Engine/device surface | `gzip`, `deflate` (zlib) | `deflate-raw` | `brotli` | `zstd` | `xz` |
| --- | --- | --- | --- | --- | --- |
| Chrome/Chromium desktop, Android, Android WebView | 80+ | 103+ | No default support | No | No |
| Chromium Edge desktop | 80+ | 103+ | No default support | No | No |
| Firefox desktop and Android | 113+ | 113+ | 147+ | Not default; experimental preference from 138 | No |
| Safari macOS, iPhone/iPad Safari | 16.4+ | 16.4+ | 18.4+ | No | No |
| WKWebView / iOS WebKit surfaces | WebKit corresponding to Safari 16.4+ | Same | WebKit corresponding to Safari 18.4+ | No | No |
| Older browsers / old embedded WebViews | JS fallback required | JS fallback required | JS/WASM fallback required | JS/WASM fallback required | JS/WASM fallback required |

The version evidence is [MDN's compatibility dataset](https://github.com/mdn/browser-compat-data/blob/8f78ef6691bea90b55a975344ad7323130f20f36/api/DecompressionStream.json), corroborated by [Firefox 147 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/147), [Safari 18.4 release notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) and [WebKit's implementation documentation](https://docs.webkit.org/Deep%20Dive/Modules/CompressionStreams.html). The source snapshot is preserved in [browser-compat-snapshot.json](compression/browser-compat-snapshot.json). No mobile or Safari execution was available on this Windows machine; those cells are source-backed, not local measurements.

| HTTP response encoding | Chrome desktop / Android | Firefox | Safari |
| --- | --- | --- | --- |
| `gzip`, `deflate` | Longstanding | Longstanding | Longstanding |
| `br` | 50 / 51+ | 44+ | 11+; macOS 10.13+ |
| `zstd` | 123+ | 126+ | 26.3+ on iOS/iPadOS 26.3 and macOS **Tahoe 26.3+**; Safari 26.3 on an older macOS is insufficient |
| `xz` | No standard browser decode path | No | No |

See the [HTTP compatibility data](https://github.com/mdn/browser-compat-data/blob/8f78ef6691bea90b55a975344ad7323130f20f36/http/headers/Content-Encoding.json) and [Safari 26.3's OS-specific release statement](https://webkit.org/blog/17798/webkit-features-for-safari-26-3/). HTTP transport support does not expose a codec for an arbitrary byte slice inside a fetched package or local file. Setting `Content-Encoding` on a constructed `Response` also does not decode it; that was verified in Chrome, Edge and Firefox. HTTP dictionary transport (`dcb`/`dcz`) is likewise a network facility, not an in-page dictionary injection API.

Actual local probes used Chrome **152.0.7977.76**, Edge **152.0.4191.62**, and Firefox **154.0**, with new headless profiles and no codec-enabling flags. Chrome/Edge decoded gzip, zlib and raw DEFLATE; Firefox additionally decoded Brotli. All rejected zstd, xz and the spelling `br` as constructor arguments. All rejected a zlib preset dictionary, bad gzip CRC, a truncated gzip member, and concatenated gzip members. [Raw probe results](compression/browser-support-probes.json) include user agents, success hashes and error strings.

The [Compression Standard](https://compression.spec.whatwg.org/) specifies zlib framing for `deflate`, rejects its FDICT flag, and offers a format argument rather than an external dictionary parameter. Brotli's built-in static dictionary is part of ordinary Brotli and needs no shipment. An application-supplied shared dictionary is different: [Brotli's native C API](https://github.com/google/brotli/blob/master/c/include/brotli/decode.h) can attach one, but `DecompressionStream` cannot. The standard's introductory text and MDN's general baseline badge must not be read as claiming every format works in every browser.

## Producer and native consumer libraries

All candidates have practical native implementations. Browser reach, not lack of a server-side library, distinguishes them. Third-party libraries add packaging/ABI work; availability is not a claim that every binding exposes dictionary training or attachment.

| Environment | gzip / zlib / raw DEFLATE | Brotli | zstd, including dictionaries | xz |
| --- | --- | --- | --- | --- |
| C/C++; Windows, Linux, macOS, cross-compiled mobile | [zlib](https://www.zlib.net/) | [Google Brotli](https://github.com/google/brotli) | [libzstd](https://github.com/facebook/zstd) | [liblzma](https://tukaani.org/xz/) |
| Python | Standard `gzip` / `zlib` | Third-party `brotli` | Standard [`compression.zstd` in 3.14+](https://docs.python.org/3/library/compression.zstd.html), or `zstandard` on older Python | Standard [`lzma`](https://docs.python.org/3/library/archiving.html) |
| Node.js | Built-in `node:zlib` | Built-in Brotli | Built-in zstd from 22.15 / 23.8, still labelled experimental in current docs; verify dictionary API separately | Third-party binding needed |
| .NET / C# | Built-in `GZipStream`, `ZLibStream`, `DeflateStream` | Built-in `BrotliStream` | [`ZstdSharp.Port`](https://github.com/oleg-st/ZstdSharp) | [`SharpCompress`](https://github.com/adamhathcock/sharpcompress) reader |
| Go | Standard [`compress`](https://pkg.go.dev/compress) packages | [`andybalholm/brotli`](https://github.com/andybalholm/brotli) | [`klauspost/compress/zstd`](https://github.com/klauspost/compress) | [`ulikunitz/xz`](https://github.com/ulikunitz/xz) |
| Rust | [`flate2`](https://github.com/rust-lang/flate2-rs) | [`brotli`](https://github.com/dropbox/rust-brotli) | [`zstd`](https://github.com/gyscos/zstd-rs) | [`xz2`](https://github.com/alexcrichton/xz2-rs) |
| Java / Android JVM consumers | Standard `java.util.zip` | [`Brotli4j`](https://github.com/hyperxpro/Brotli4j), native artifacts | [`zstd-jni`](https://github.com/luben/zstd-jni), native artifacts | [XZ for Java](https://tukaani.org/xz/java.html) |

Built-in API evidence: [Node zlib](https://nodejs.org/api/zlib.html), [.NET compression](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression?view=net-10.0). Mobile applications can bundle the corresponding C libraries, but should verify architecture and binding support. That does not change Safari or Android browser JavaScript capabilities.

## Corpus and method

All sizes are **bytes**, MiB means 1,048,576 bytes. Source data is real Markdown from git blobs, without line-ending normalization or generated/padded replicas. The primary workload is npm's small, templated command documentation. Rust RFCs supply a larger, less uniformly similar specification workload. Results are not an estimate of every possible markdown corpus.

| Corpus | Pinned head | Base documents | Real diff entries from 32 first-parent commits | Base bytes | Diff bytes | Total input bytes | Median entry bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [`npm/cli`, v11.6.0, `docs/lib/content/**/*.md`](https://github.com/npm/cli/tree/3b30e0b1f1ee9c7119d352dc4f9a27d53f24b988/docs/lib/content) | `3b30e0b1f1ee9c7119d352dc4f9a27d53f24b988` | 83 | 48 | 286,500 | 58,657 | **345,157** | 1,157 |
| [`rust-lang/rfcs`, `text/*.md`](https://github.com/rust-lang/rfcs/tree/f38f19132505ef47c5053cd71ac444932dfd0256/text) | `f38f19132505ef47c5053cd71ac444932dfd0256` | 633 | 35 | 8,653,769 | 777,813 | **9,431,582** | 9,078 |

Npm base: `fefd509992a05c2dfddbe7bc46931c42f1da69d7`. Rust base: `0b20d5d7c1fa934bae255236f7455ae781a02bf7`. Select the last 32 **first-parent** commits touching Markdown in the subtree, including merges, reverse to oldest first, and take the first selected commit's first parent as the base. Each diff is `git diff --no-renames --unified=3 parent1 commit -- path`, one entry per changed Markdown file. The full commit lists, entry paths, byte sizes and SHA-256 hashes are in [npm-corpus.json](compression/npm-corpus.json) and [rust-corpus.json](compression/rust-corpus.json). CARD-0003 can reuse these exact base/commit selections while choosing its own history representation.

The experiment concatenates payload bytes with an external test-only offset list. It does **not** implement a container or prescribe diff encoding. Whole means one codec stream over all payloads. Per-entry means the sum of independent streams. Blocks greedily group adjacent complete entries toward 65,536 or 262,144 raw bytes, flushing before an entry would exceed the target; an oversized entry gets its own block. The largest entries are 32,708 and 173,597 bytes, so “64 KiB blocks” is a grouping target, not a hard maximum.

Codec headers, trailers and checksums are included. Container headers, paths, indexes, section metadata, network headers and decoder downloads are excluded from payload tables. They are unknown pending other cards; calling these totals complete final file sizes would be misleading. A hypothetical extra 16 bytes per entry would add 2,096 / 10,688 bytes respectively; this is a sensitivity calculation, not a proposed envelope.

Parameters: zlib 1.2.11; Python 3.10.2; Brotli 1.2.0, text mode, `lgwin=22`, quality 5/9/11; python-zstandard 0.25.0 / libzstd 1.5.7, levels 3/9/19, one thread, content size and content checksum on; Python xz preset 6, normal XZ container/default CRC64. Gzip uses `mtime=0`; zlib/raw DEFLATE use ordinary level 6. Dictionary training is zstd's trainer with `k=2000,d=8,steps=4,threads=0`, targeting 16 or 64 KiB. Library versions and full measurements are in [size-results.json](compression/size-results.json).

### Compression results

Each triplet is whole / independent entries / path-ordered 64 KiB blocks. Lower is better.

| Codec / producer level | npm whole | npm entries | npm blocks | Rust whole | Rust entries | Rust blocks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gzip 6 | 95,662 | **142,863** | 101,084 | 2,914,070 | **3,332,597** | 3,072,367 |
| gzip 9 | 95,343 | 142,839 | 100,877 | 2,907,048 | 3,328,716 | 3,067,090 |
| zlib DEFLATE 6 | 95,650 | 141,291 | 101,012 | 2,914,058 | 3,324,581 | 3,070,315 |
| raw DEFLATE 6 | 95,644 | 140,505 | 100,976 | 2,914,052 | 3,320,573 | 3,069,289 |
| Brotli 5 | 85,997 | 131,543 | 96,614 | 2,562,516 | 3,148,241 | 2,947,620 |
| Brotli 9 | 82,104 | 131,297 | 95,312 | 2,383,334 | 3,126,945 | 2,918,454 |
| Brotli 11 | **74,379** | **113,861** | 84,941 | 2,174,769 | **2,718,698** | 2,572,000 |
| zstd 3 | 93,789 | 147,883 | 106,312 | 2,829,248 | 3,468,196 | 3,212,815 |
| zstd 9 | 85,347 | 143,315 | 98,712 | 2,504,244 | 3,287,724 | 3,007,769 |
| zstd 19 | 79,804 | 141,397 | 95,396 | 2,197,874 | 3,209,175 | 2,910,037 |
| xz 6 | 78,372 | 151,436 | 94,512 | **2,168,300** | 3,242,212 | 2,881,708 |

Gzip per-entry totals are 41.39% / 35.33% of raw input and 49.34% / 14.36% larger than whole gzip. Brotli 11 saves 20.30% / 18.42% against per-entry gzip, and gives the best per-entry size among these non-dictionary codecs. Xz's whole-Rust win over Brotli 11 is only 6,469 bytes (0.30%), while its native decode cost is much higher. Gzip 9 saves only 24 bytes on npm entries and 3,881 bytes (0.12%) on Rust entries; Rust entry encoding took 460 ms at level 6 versus 613 ms at level 9. Encode timings are single runs and noisy (npm's small timing reversed); level 6 is a reasonable default, not a decoder requirement.

### Trained dictionaries, including their storage

“Package” training uses the exact package samples; that is valid for an embedded per-package dictionary but optimistically reuses the evaluated data. The separate holdout splits **original paths**, keeping a document and all its diffs together: SHA-256(path)'s first 32 bits modulo five selects test paths when zero. No base/diff pair leaks across that split. No dictionary is assumed preinstalled or free.

| Corpus / evaluation | Dictionary bytes | Independent zstd-9 frame bytes | Total with dictionary | Same evaluated entries, no dictionary |
| --- | ---: | ---: | ---: | ---: |
| npm package, 131 entries | 16,384 | 100,403 | **116,787** | 143,315 |
| npm package, 131 entries | 65,536 | 74,341 | 139,877 | 143,315 |
| npm holdout, 23 entries / 61,284 raw bytes | 16,384 | 19,069 | 35,453 | 25,762 |
| npm holdout, same entries | 65,536 | 17,382 | 82,918 | 25,762 |
| Rust package, 668 entries | 16,384 | 2,919,776 | 2,936,160 | 3,287,724 |
| Rust package, 668 entries | 65,536 | 2,748,217 | **2,813,753** | 3,287,724 |
| Rust holdout, 146 entries / 2,196,609 raw bytes | 16,384 | 628,953 | **645,337** | 707,469 |
| Rust holdout, same entries | 65,536 | 598,700 | 664,236 | 707,469 |

Define gap closure as `(plain-entry bytes - dictionary-inclusive bytes) / (plain-entry bytes - whole bytes)`, at zstd level 9 throughout. A 16 KiB dictionary closes **45.8% npm / 44.9% Rust** of the gap. A 64 KiB dictionary closes **5.9% / 60.5%**. Thus “a dictionary recovers most of whole-package compression” is supported only for the larger dictionary on Rust, not generally. Its transfer cost actually makes the small npm holdout larger despite smaller individual frames. A cached dictionary improves later economics, but creates a cache/dependency assumption the portable package should not require.

The dictionary-capable WASM path was exercised with an actual trained dictionary and independently compressed entry. That proves feasibility with a library, not native Streams support. No Brotli custom-dictionary ratio is claimed: ordinary Brotli was benchmarked, while custom dictionaries were rejected for the baseline because the chosen native API cannot receive them. Brotli's C API and special WASM libraries can support them, but introduce the same deployment/dependency question. [Zstd's small-data rationale](https://github.com/facebook/zstd#the-case-for-small-data-compression) and the [tested WASM dictionary API](https://github.com/bokuweb/zstd-wasm) describe the corresponding mechanisms.

### Ordering and bounded frames

Path order is lexicographic `(path, base/diff ordinal)`, so versions of a path are adjacent. Random uses seed 42. Similarity order is deterministic greedy nearest neighbor by Jaccard similarity of lowercase ASCII word-token sets (length at least three), starting with the first path and breaking ties by path order. It is a simple evaluated heuristic, not a claim of optimal packing.

| Corpus / gzip 6 order | Whole | 64 KiB target blocks | 256 KiB target blocks |
| --- | ---: | ---: | ---: |
| npm random | 101,088 | 107,730 | 102,250 |
| npm path | 95,662 | 101,084 | 96,739 |
| npm similarity | 94,678 | 99,573 | 95,670 |
| Rust random | 2,958,819 | 3,107,400 | 2,994,187 |
| Rust path | 2,914,070 | 3,072,367 | 2,951,419 |
| Rust similarity | 2,875,257 | 3,042,044 | 2,913,504 |

For 64 KiB gzip blocks, path order saves 6.17% / 1.13% over random; similarity adds only 1.49% / 0.99% over path order. Independent-entry byte totals are invariant under order because no cross-entry state exists. Full ordering results for Brotli, zstd and xz are in the JSON.

Bounded gzip blocks are the strongest rejected baseline alternative: they save **29.24% npm / 7.81% Rust** against per-entry gzip, and remain only **5.67% / 5.43%** larger than whole gzip. They preserve logical addressability through a block index, but an entry cannot be decoded independently of its block. Choose per-entry now for isolated fetch/decode, corruption boundaries and simple integration with history and addressing. If the owner prioritizes smaller transfers over exact entry independence, 64 KiB gzip blocks are a measured, browser-compatible alternative worth explicitly approving; there is no need to switch codec to get that benefit.

## Decode and decoder-delivery costs

Measurements ran on Windows 10 Pro 19045, Intel i7-6700K (4 cores / 8 threads), 32 GiB RAM. This is a shared desktop, not a mobile performance claim. Compression and decode benchmark suites ran sequentially; ordinary host activity was not controlled. Each decode scenario uses three fresh processes/profiles, a first decode, then 31 repetitions; tables report the median of the three per-process medians. The JSON also records first-decode and p95 values.

The target is an actual **8,057-byte** document, `text/3872-crates-io-security.md@base`, at raw offset **8,786,499** (93.16% into the 9,431,582-byte Rust workload). Whole-frame decoders finish the frame and retain just that target; the materializing variant temporarily buffers all output, while the streaming variant discards other documents' output as it arrives. Streaming verifies the complete frame, so it is deliberately not an unauthenticated early-exit benchmark. Blocks decode 51,727 raw bytes to retrieve the same target. Gzip compressed bytes needed after locating the extent are **2,914,070 whole / 14,894 block / 3,227 entry**. A dictionary entry needs **2,726 + 16,384** bytes on a cold dictionary cache, or 2,726 on a warm cache.

Decode timing starts with the selected compressed bytes and optional dictionary already loaded. It excludes disk/network fetch, manifest lookup, Markdown parsing, rendering and history reconstruction. A full `fetch().arrayBuffer()` of the package would separately retain the entire compressed package; independent-frame I/O savings require Blob slicing, seeking, or usable HTTP byte ranges. A delta entry may decode independently yet still require a base/chain to reconstruct a revision; CARD-0003 must measure that additional work.

Memory is the Windows **PeakWorkingSetSize** high water (Python process natively, active browser content/renderer process on the web), measured immediately after the first decode. It includes native codec allocations, unlike JS-heap-only metrics. “Increase” is the new high water above the pre-decode high water; it is a lower bound on incremental allocation when the process previously peaked higher, and small differences are noisy. Absolute peaks include the runtime and preloaded input; they are not codec-only heap sizes. Browser subprocess snapshots and WASM linear-memory sizes are retained for audit. No Safari/iOS/Android runtime memory measurement is claimed.

<!-- DECODE_TABLES_START -->

### Native library decode

| Codec | Framing / output handling | First ms | Warm median ms | p95 ms | Process peak MiB | New peak increase MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| gzip-6 | whole, materialize | 75.994 | 71.495 | 119.777 | 39.12 | 18.18 |
| gzip-6 | whole, stream | 63.173 | 68.716 | 96.419 | 21.15 | 0.29 |
| gzip-6 | entry | 0.303 | 0.121 | 0.188 | 18.15 | 0.09 |
| gzip-6 | block64k | 0.579 | 0.357 | 0.513 | 18.33 | 0.20 |
| deflate-6 | whole, materialize | 45.432 | 47.332 | 65.310 | 38.95 | 18.07 |
| deflate-6 | whole, stream | 50.210 | 51.850 | 69.129 | 21.21 | 0.28 |
| deflate-6 | entry | 0.066 | 0.025 | 0.043 | 18.10 | 0.03 |
| deflate-6 | block64k | 0.309 | 0.162 | 0.220 | 18.21 | 0.16 |
| raw-6 | whole, materialize | 48.299 | 49.428 | 71.359 | 39.01 | 18.11 |
| raw-6 | whole, stream | 42.604 | 42.860 | 73.636 | 21.12 | 0.26 |
| raw-6 | entry | 0.099 | 0.027 | 0.051 | 18.05 | 0.04 |
| raw-6 | block64k | 0.296 | 0.159 | 0.221 | 18.25 | 0.18 |
| brotli-5 | whole, materialize | 60.003 | 47.324 | 77.875 | 42.78 | 22.25 |
| brotli-5 | whole, stream | 42.447 | 49.878 | 67.263 | 25.16 | 4.68 |
| brotli-5 | entry | 0.238 | 0.065 | 0.279 | 18.23 | 0.16 |
| brotli-5 | block64k | 0.498 | 0.259 | 0.619 | 18.40 | 0.32 |
| zstd-9 | whole, materialize | 37.979 | 36.598 | 55.469 | 29.58 | 9.11 |
| zstd-9 | whole, stream | 38.665 | 33.392 | 68.077 | 25.17 | 4.68 |
| zstd-9 | entry | 0.092 | 0.016 | 0.035 | 18.22 | 0.10 |
| zstd-9 | block64k | 0.200 | 0.108 | 0.148 | 18.31 | 0.16 |
| xz-6 | whole, materialize | 262.306 | 217.515 | 307.729 | 46.31 | 26.09 |
| xz-6 | whole, stream | 155.883 | 161.745 | 214.419 | 28.46 | 8.37 |
| xz-6 | entry | 0.317 | 0.216 | 0.298 | 18.20 | 0.12 |
| xz-6 | block64k | 1.123 | 1.236 | 2.116 | 18.35 | 0.22 |
| zstd-9 | dict-entry | 0.367 | 0.033 | 0.074 | 18.26 | 0.12 |

### Actual browser decode

| Browser / decoder | Framing / output handling | First ms | Warm median ms | p95 ms | Renderer peak MiB | New peak increase MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Chrome / gzip-6 native | whole, materialize | 69.5 | 64.7 | 72.2 | 92.38 | 31.10 |
| Chrome / gzip-6 native | whole, stream | 51.7 | 45.9 | 55.8 | 71.25 | 12.52 |
| Chrome / gzip-6 native | entry | 1.4 | 0.2 | 0.4 | 56.33 | 0.68 |
| Chrome / gzip-6 fflate | entry | 2.2 | 0.2 | 0.9 | 58.19 | 0.62 |
| Chrome / gzip-6 native | block64k | 1.5 | 0.4 | 0.6 | 56.49 | 0.87 |
| Chrome / deflate-6 native | entry | 1.1 | 0.2 | 0.3 | 58.95 | 0.68 |
| Chrome / raw-6 native | entry | 1.2 | 0.1 | 0.3 | 59.75 | 0.68 |
| Chrome / brotli-5 brotli-wasm | whole, materialize | 102.7 | 76.7 | 92.5 | 102.31 | 41.64 |
| Chrome / brotli-5 brotli-wasm | entry | 3.3 | 0.2 | 0.3 | 64.70 | 3.91 |
| Chrome / brotli-5 brotli-wasm | block64k | 5.0 | 0.6 | 0.8 | 62.23 | 4.13 |
| Chrome / zstd-9 zstd-wasm | whole, materialize | 85.6 | 30.7 | 42.0 | 84.34 | 23.49 |
| Chrome / zstd-9 zstd-wasm | entry | 3.3 | 0.1 | 0.2 | 62.39 | 1.57 |
| Chrome / zstd-9 zstd-wasm | block64k | 3.3 | 0.3 | 0.5 | 68.42 | 7.54 |
| Chrome / zstd-9 zstd-wasm | dict-entry | 3.4 | 0.1 | 0.3 | 62.44 | 1.36 |
| Firefox / gzip-6 native | whole, materialize | 75.0 | 71.0 | 93.0 | 80.35 | 28.73 |
| Firefox / gzip-6 native | whole, stream | 61.0 | 61.0 | 75.0 | 66.72 | 15.27 |
| Firefox / gzip-6 native | entry | 1.0 | <1 | 1.0 | 48.41 | 0.41 |
| Firefox / gzip-6 native | block64k | 1.0 | 1.0 | 1.0 | 48.34 | 0.54 |
| Firefox / brotli-5 native | whole, materialize | 91.0 | 93.0 | 110.0 | 83.85 | 32.62 |
| Firefox / brotli-5 native | whole, stream | 96.0 | 81.0 | 100.0 | 70.43 | 19.07 |
| Firefox / brotli-5 native | entry | 2.0 | <1 | 1.0 | 48.35 | 0.50 |
| Firefox / brotli-5 native | block64k | 2.0 | 1.0 | 1.0 | 48.42 | 0.71 |

Firefox timing precision is approximately 1 ms in this configuration; zero-valued samples are shown as `<1`, not zero work. First decode excludes separate decoder module initialization below. Warm p95 is the median of the three per-profile p95 values, not a pooled tail guarantee. Native library, Streams and WASM bindings have different buffering/copying behavior; these are measured read paths, not an intrinsic ranking of algorithms.

For gzip, native streaming retains a small memory increment but still processes the entire 9.4 MB workload. Chrome streaming also avoids the full-output copy, yet its measured high-water increase remains about 12.5 MiB because Streams/runtime buffers and input ownership still matter. An independently compressed entry limits work and memory much more effectively than merely choosing a streaming API.

The active renderer PID was identified with a 300 ms CPU pulse before the measurement baseline, and checked for a dominant CPU delta. Spare/browser processes are excluded. The pulse is excluded from timing. Raw evidence: [native-results.json](compression/native-results.json), [Chrome](compression/chrome-decode-results.json), [Firefox](compression/firefox-decode-results.json), and [derived summary](compression/decode-summary.json).

<!-- DECODE_TABLES_END -->

### Web fallback bytes and startup

These are actual installed artifacts and a minified, tree-shaken decoder import, not npm unpacked package sizes. Gzip columns sum independently gzipped JS and WASM assets at level 9. No network RTT is included in startup measurements. A reader can cache the decoder across packages; first use pays the download and initialization cost.

| Fallback candidate | JS bytes | WASM bytes | Total raw | Total gzip-transferred |
| --- | ---: | ---: | ---: | ---: |
| `brotli-dec-wasm@2.3.2` decoder only | 9,355 | 208,439 | **217,794** | **100,236** |
| `@bokuweb/zstd-wasm@0.0.27`, dictionary-capable import | 6,725 | 251,806 | **258,531** | **82,410** |
| `fflate@0.8.2`, `gunzipSync` import only | 4,117 | 0 | **4,117** | **2,112** |

Sources/API scope: [Brotli decoder project](https://github.com/ustclug-dev/brotli-dec-wasm), [zstd WASM project](https://github.com/bokuweb/zstd-wasm), [fflate project](https://github.com/101arrowz/fflate). Artifact hashes are in [decoder-assets.json](compression/decoder-assets.json). Zstd's WASM binary still contains encoder code even though unused JS exports were removed; a custom decoder-only build could be smaller. Other compact JS zstd decoders exist, but these numbers specifically cover a verified external-dictionary path. They are not a lower bound for all possible implementations.

<!-- STARTUP_TABLE_START -->

Cold-profile initialization of the entry decoder in Chrome (three samples):

| Decoder / selected entry | Module load + initialization median ms (range) | First decode median ms | Initialization + first decode median ms | WASM linear memory after first decode |
| --- | ---: | ---: | ---: | ---: |
| Brotli decoder | 40.3 (22.4–67.0) | 3.3 | 43.1 | 1.250 MiB |
| zstd, no dictionary | 35.1 (26.2–40.5) | 3.3 | 38.4 | 16.125 MiB |
| zstd, trained 16 KiB dictionary | 14.6 (10.5–66.3) | 3.4 | 17.0 | 16.125 MiB |
| fflate gzip | 38.6 (14.2–48.1) | 2.2 | 40.7 | None |

These include loopback module/asset loading, parsing, compilation and instantiation, with warm OS file caches; they are not isolated WASM compiler timings or WAN download predictions. Input/dictionary bytes were preloaded. Browser launch and the renderer-identification pulse are excluded. Timing differences of a few milliseconds should not drive codec selection on this shared host. WASM linear-memory byte length is an address-space allocation, not the same as resident physical memory; zstd reserves about 16.125 MiB even for one small entry. Brotli materializing the whole fixture grew linear memory to 34.5 MiB, versus 1.25 MiB for its entry.

<!-- STARTUP_TABLE_END -->

The measured fallback costs are well below a megabyte, so rejecting Brotli/zstd on an assumed 1 MB download would be wrong. They are still roughly 40–47 times the compressed JS-only gzip candidate. On npm, gzip's 142,863-byte entry payload is smaller on a cold reader than Brotli-11 entries plus the measured gzipped decoder (214,097), or zstd-9/16-KiB-dictionary entries plus decoder (199,197). With a cached decoder or the larger corpus the ratio advantage can win. The recommendation follows the native-availability priority, not a claim that the other algorithms are unusable.

## Original codec handoff (qualified by the ZIP follow-up above)

1. Adopt the proposed stored/gzip-per-entry baseline as the compression input to consolidation. Keep Brotli, zstd and xz out of mandatory reader capabilities. Reserve extension space without assigning codec numbers here. Do not ship two compressed copies merely to negotiate around missing native browser codecs.
2. **CARD-0001 (container):** decide adopt-vs-invent first. A ZIP selection implies the raw-DEFLATE adaptation noted above. Otherwise expose exact independent member extents and output lengths, preserve the clear version prefix, and make the lookup information obtainable without decoding all payloads. Gzip members must be dispatched separately. Whole-body HTTP content encoding changes the byte representation against which ranges apply; serving the package unchanged is simplest for range-addressed access. Dictionary IDs are unnecessary in the baseline; an extension would need dictionary extent, content identity, bounded size and declared dependency before decoding an entry.
3. **CARD-0003 (history):** reuse the pinned corpus manifests and 32 first-parent selections. Compression-only gzip totals are base 116,977 + diffs 25,886 for npm and base 3,108,012 + diffs 224,585 for Rust. These exclude history metadata and are **not** a verdict on history overhead or model. Compare base/N/squash with the final representation, and time base-plus-delta reconstruction separately. Do not introduce implicit cross-entry compression state to conceal chain cost.
4. **CARD-0004 (addressing):** make semantic references independent of compressed bytes, codec, level, physical order and offsets. Compression provides a physical entry boundary, not stable section identity. Section lookup will normally decompress its containing document. Changing level, switching a future codec or regrouping frames must not invalidate reviewed state.
5. **CARD-0005 (consolidation):** incorporate this section, add actual envelope/index/section metadata to the measured sizes, and check that “streamable”, seekable and independently decodable are used consistently. The explicit alternative requiring an owner decision is 64 KiB gzip grouping if 29% smaller small-doc payloads outweigh independent entry decoding. No format implementation is part of this investigation.
6. Before claiming production device coverage, qualify the selected reader on physical low-memory Android and iOS devices and minimum supported Safari/WebView versions. Rerun the supplied fixtures through both native and fallback paths; test exact member slicing, truncation, checksum errors, decoded-length enforcement and worker cancellation. This remaining platform qualification does not block the codec recommendation; desktop measurements must not be presented as mobile timings.

## Reproduction and evidence

Run from `C:\src\markdown-package`. The checkouts, generated compressed fixtures, isolated browser profiles and installed dependencies stay under `.antiphon/compression-work/` and are locally ignored. Report artifacts and experiment code are under `docs/investigations/compression/`; the harness is not a format implementation.

```powershell
python -m venv .antiphon/compression-work/venv
.antiphon/compression-work/venv/Scripts/python -m pip install -r docs/investigations/compression/requirements.txt
git clone --depth 400 --branch v11.6.0 https://github.com/npm/cli.git .antiphon/compression-work/npm-cli
git clone https://github.com/rust-lang/rfcs.git .antiphon/compression-work/rust-rfcs
git -C .antiphon/compression-work/rust-rfcs checkout f38f19132505ef47c5053cd71ac444932dfd0256
New-Item -ItemType Directory -Force .antiphon/compression-work/js | Out-Null
Copy-Item docs/investigations/compression/package*.json .antiphon/compression-work/js/
npm ci --prefix .antiphon/compression-work/js --ignore-scripts --no-audit --no-fund
node docs/investigations/compression/build_web.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/benchmark.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/benchmark.py --native
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/browser_benchmark.py --probe
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/browser_benchmark.py --browser chrome --repeats 3
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/browser_benchmark.py --browser firefox --repeats 3
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/summarize.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/verify_evidence.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/compression/render_tables.py
```

Skip clone/setup steps for existing task checkouts; benchmark.py explicitly selects the pinned revisions regardless of the checkout's current branch. Browser executable paths are at the top of browser_benchmark.py. Run timing suites sequentially. Different library/browser/CPU versions can change sizes or timings; saved JSON is the evidence for this run.

<!-- VALIDATION_START -->

Validation: **10,747 compression round-trip comparisons**, **150 native target hash comparisons**, **168 browser target hash comparisons**, **54 browser support/framing checks**, and **66 corpus continuity checks**; **0 unexpected failures in the final evidence**. Native decode covers 25 scenarios × 3 processes. Browser decode covers 24 Chrome and 8 Firefox scenarios × 3 profiles; four Chrome native-Brotli scenarios correctly report unsupported. Four preliminary browser-launch attempts timed out (Firefox updater/startup and a Chrome network-service failure); completed retries are used in the results. No application build or format implementation tests exist or were added. [verify_evidence.py](compression/verify_evidence.py) audits saved evidence and source continuity; [verification.json](compression/verification.json) records counts. Run it after the measurement commands, then run [render_tables.py](compression/render_tables.py) to refresh derived report tables.

<!-- VALIDATION_END -->
