# CARD-0003: history model investigation

Status: investigation complete; recommendation for decision and consolidation, not an implemented format. Evidence checked on 2026-09-07. Reuses the corpus and ZIP harness from [CARD-0002](compression.md), including the ZIP follow-up at `7c32a97`.

**Verdict: real Git is a credible option, with a genuine tradeoff rather than an outright win.** At 32 commits, a ZIP containing a self-contained bundle is **148,080 / 3,288,503 bytes** for npm / Rust, versus **171,192 / 3,423,817** for flat base plus ordered diffs: **13.50% / 3.95% smaller**. The indexed `.git` option is **159,296 / 3,312,849 bytes**. Neither approaches the earlier best solid compression: bundles are **99.09% / 51.66% larger**. Git gives standard object identity, history traversal, tooling and delta compression, but the measured browser path adds **53,773–53,945 gzipped JS bytes**, reads the entire pack, and uses a JavaScript inflater. A bundle also needs a pack-index construction pass.

**Recommend indexed, packed Git (A) if the owner accepts the browser reader cost and prioritizes standard Git history.** Its extra **11,216 / 24,346 bytes** over a bundle buys a shipped index and native shallow-boundary support. Use B for a download-first, self-contained exchange profile, with declared synthetic roots when trimming ancestry. If CARD-0002's native-decoder and isolated-read priorities remain mandatory, retain flat base plus diffs as the baseline. Do not implement mini-git now: there is no measured size failure requiring a new object format, and it would still need the coverage and section semantics described below.

Two premises in the brief are false. **One parent does not identify a squash**, and **bundle prerequisites are not shallow boundaries**. Local counterexamples below demonstrate both. Every model needs explicit provenance and coverage metadata; adopting Git does not remove that requirement.

## Corpus and representation

The harness imports the existing `compression/benchmark.py` and `compression/zip_benchmark.py`. It verifies all **799 entry records**, the exact base blobs and SHA-256s, and all **64 first-parent transitions** against the previous manifests. No padded or synthetic Markdown was added to the size experiment. The separate semantic counterexample uses a deliberately tiny document and is excluded from size tables.

| Corpus | Pinned source head | Base documents / bytes | Original per-file diffs / bytes |
| --- | --- | ---: | ---: |
| npm/cli | `3b30e0b1f1ee9c7119d352dc4f9a27d53f24b988` | 83 / 286,500 | 48 / 58,657 |
| rust-lang/rfcs | `f38f19132505ef47c5053cd71ac444932dfd0256` | 633 / 8,653,769 | 35 / 777,813 |

Use the same base and oldest **5, 20, 32** of the same 32 selected Markdown-affecting first-parent commits. Thirty-two is deliberate: extending to 50 would change the fixed corpus. Base-only has a snapshot root and zero updates. “N squashed” retains that same base and one update to the exact N-commit endpoint, not just the final snapshot. Consequently squashing preserves the net base-to-tip comparison but removes intermediate changes and their individual authors/messages.

These are **real Git repositories of the selected Markdown history**, with new package-specific commit and tree IDs. Source blobs remain byte-identical in these measurements. Under spec.md D-17 that holds only for a source whose blobs are already LF-only: a projection from a CRLF source rewrites those blobs and therefore their blob IDs, along with the commit and tree IDs a projection already rewrites. Every blob in this corpus is LF-only, so the figures below are unaffected. A producer-selected snapshot is made a synthetic root; each selected source transition becomes a single-parent commit. Author, committer, timestamps and message are retained, with a `Source-Commit` trailer. Source signatures cannot authenticate rewritten commits and are not copied. The original npm selection has zero merges; the Rust selection has **31 merges**. Their first-parent effects are retained, but second-parent graphs are not. These results therefore price the compression card's linear review history, **not preservation of an entire upstream DAG or its commit IDs**. Keeping original commits would require their referenced trees, parents or valid shallow boundaries, and could bring unrelated source content into the package. It needs a separate scope decision and benchmark.

All variants include an identical stored `.mdpkg/manifest.json` for each scenario: source repository and path scope, source base/tip, `ancestry: truncated`, `root: synthetic-snapshot`, `projection: markdown-only-first-parent`, source/retained update counts, `squashed`, and `sectionSummary: absent`. This is experiment metadata, not an assigned specification. It declares the provenance loss honestly even in the base-only row. It does not include a comprehensive stable section map or touched-section summary.

- **A — ZIP of packed `.git`:** minimal actual Git repository: `HEAD`, a portable bare `config`, `refs/heads/main`, one `.pack` and its `.idx`. No working index, hooks, reflogs, remote URLs, unreachable objects or incidental files. These entries can be extracted and passed to `git --git-dir=...`. This is a curated repository, not a blind copy of an author's `.git` directory.
- **B — ZIP of `history.bundle`:** `git bundle create --version=2 ... refs/heads/main` from the same self-contained projected graph. Every measured bundle was verified, fetched into a new empty repository, checked with `fsck --full --strict`, and compared with the expected final document tree. The bundle has no `.idx`; consumers generate it or receive a sidecar in a different profile.
- **C — flat base plus ordered diffs:** the exact `path.md@base` and `path.md@diffNN` payloads from CARD-0002, sorted by key, plus a compressed ordered commit-record JSON. Records include author, committer, message and source commit, so flat diffs are not given free history metadata. Original merge-parent lists are omitted, matching the projected Git representation. Squashed diffs are real `git diff --no-renames --unified=3 sourceBase sourceTip -- path` outputs. Every original and squashed patch was replayed and checked against source blobs.

ZIP construction is the existing deterministic writer: fixed epoch, Unix file attributes, no directory members or extra fields, all local/central headers, names, CRCs and EOCD included. Use DEFLATE 6 or stored when smaller. **Packs and bundles are stored** to preserve their internal byte offsets and avoid mandatory second-layer decoding. An all-DEFLATE sensitivity is reported below. Git uses SHA-1 object format, Git **2.50.1.windows.1**, compression level 6, one packing thread, window 10, depth 50, and offset deltas. Python **3.10.2**, zlib **1.2.11**, same as CARD-0002. Every scenario is packed independently from loose source objects; no prior package's delta choices are reused. A window-250 sensitivity checks whether the default window hid a large gain.

## Complete ZIP sizes

Each cell is **absolute bytes (percentage over that model's own base-only ZIP)**. These are complete history archives, with no duplicate current-file view. The second table counts that view explicitly. Different model baselines must not be mistaken for a shared denominator.

<!-- SIZE_START -->

| Corpus | Updates | A: packed .git ZIP | B: bundle ZIP | C: flat-diff ZIP |
| --- | --- | --- | --- | --- |
| npm | base | 125,123 (+0.00%) | 121,238 (+0.00%) | 132,183 (+0.00%) |
| npm | 5 | 130,216 (+4.07%) | 125,302 (+3.35%) | 137,102 (+3.72%) |
| npm | 5-squash | 126,693 (+1.25%) | 122,516 (+1.05%) | 135,313 (+2.37%) |
| npm | 20 | 147,343 (+17.76%) | 138,761 (+14.45%) | 161,791 (+22.40%) |
| npm | 20-squash | 131,895 (+5.41%) | 127,059 (+4.80%) | 154,329 (+16.75%) |
| npm | 32 | 159,296 (+27.31%) | 148,080 (+22.14%) | 171,192 (+29.51%) |
| npm | 32-squash | 132,968 (+6.27%) | 128,007 (+5.58%) | 158,301 (+19.76%) |
| rust | base | 3,132,967 (+0.00%) | 3,112,476 (+0.00%) | 3,191,295 (+0.00%) |
| rust | 5 | 3,157,014 (+0.77%) | 3,135,998 (+0.76%) | 3,220,189 (+0.91%) |
| rust | 5-squash | 3,155,035 (+0.70%) | 3,134,354 (+0.70%) | 3,216,274 (+0.78%) |
| rust | 20 | 3,277,700 (+4.62%) | 3,254,818 (+4.57%) | 3,388,884 (+6.19%) |
| rust | 20-squash | 3,267,669 (+4.30%) | 3,246,753 (+4.31%) | 3,333,791 (+4.47%) |
| rust | 32 | 3,312,849 (+5.74%) | 3,288,503 (+5.66%) | 3,423,817 (+7.29%) |
| rust | 32-squash | 3,297,330 (+5.25%) | 3,276,166 (+5.26%) | 3,366,670 (+5.50%) |

<!-- SIZE_END -->

Npm benefits more because it has repeated edits to the same documents. Rust adds substantial document content that still exists after squash, so retaining all 32 updates adds relatively little over its squash. A squash also retains only the final source author and a generated summary message in this experiment; retaining all contributor records would cost extra.

### Does packing approach solid compression?

The prior solid streams encode exactly the original base plus 32 per-file diff payloads. They exclude container/history metadata, so they are a lower-bound comparator, not a competing complete history package. No new denominator or codec is silently substituted.

<!-- SOLID_START -->

| Corpus | Variant, 32 updates | Bytes | Over prior best solid |
| --- | --- | --- | --- |
| npm | Prior best solid brotli-11 | 74,379 | +0.00% |
| npm | git-dir | 159,296 | +114.17% |
| npm | git-bundle | 148,080 | +99.09% |
| npm | flat-diffs | 171,192 | +130.16% |
| rust | Prior best solid xz-6 | 2,168,300 | +0.00% |
| rust | git-dir | 3,312,849 | +52.79% |
| rust | git-bundle | 3,288,503 | +51.66% |
| rust | flat-diffs | 3,423,817 | +57.90% |

<!-- SOLID_END -->

At base-only, default Git finds just **4 / 5 delta objects** among the npm / Rust document blobs. With 32 updates it finds **48 / 23 blob deltas**, plus tree deltas, out of **333 / 767 total objects**. Maximum depth is **7 / 14**. Git stores each non-delta object's zlib stream independently; it does not supply general solid cross-document compression. Its excellent reuse of unchanged blobs and changed versions is not the same operation as a compressor sharing context across every Markdown file. [Git pack structure](https://git-scm.com/docs/gitformat-pack).

Increasing the packing window from 10 to 250 changes A at 32 commits from **159,296 to 155,405 bytes** for npm (**2.44%** smaller), and leaves Rust at **3,312,849**. It does not close the solid gap. Deflating every outer ZIP entry changes A/B to **156,507 / 145,292** for npm and **3,313,229 / 3,288,879** for Rust. These sensitivity totals also compress the normally stored manifest. The small npm saving requires inflating the whole pack member before ordinary access; Rust gets slightly larger. Store packs for the access profile.

### Ordinary ZIP browsing is a separate cost

A pack inside ZIP is visible as a `.pack` file; a bundle is visible as a `.bundle` file. Neither lists individual Markdown documents in an ordinary ZIP reader. C exposes base documents and textual patches, but current documents still require replay. All three therefore receive the **same additional current-file view** for this comparison. This straightforward duplication is measured, not recommended as an optimized final layout.

<!-- BROWSE_START -->

| Corpus, 32 updates | Current files alone | A + current files | B + current files | C + current files |
| --- | --- | --- | --- | --- |
| npm | 128,359 | 287,633 | 276,417 | 299,529 |
| rust | 3,350,579 | 6,663,406 | 6,639,060 | 6,774,374 |

<!-- BROWSE_END -->

The added view also gives a plain ZIP reader the same current document access boundary as CARD-0002. A Git history package that promises both ordinary current-document browsing and no duplicate content has not been demonstrated here. A reverse-diff flat layout could make current files the base and avoid this particular duplication, but would be a different representation requiring its own replay measurements. A bundle plus a shipped index is likewise a different variant: approximately the indexed-repository cost, not B's smallest total.

## Read cost

Git itself is sufficient on native hosts. After ZIP extraction, A is immediately readable through `git --git-dir=... log -p -- path`; B must first be imported through `git clone`, `fetch`, or `bundle unbundle` plus ref setup. A bundle is a transport envelope over a pack, not a directly queryable worktree. In the browser, a Git executable is unnecessary, but an object/index/delta parser, history walker and filesystem adapter are required. The measured implementation is [isomorphic-git](https://isomorphic-git.org/docs/en/readBlob), with [its pack index API](https://isomorphic-git.org/docs/en/indexPack) for B and [a small in-memory filesystem adapter](https://isomorphic-git.org/docs/en/fs).

Native import of the already extracted 32-update bundle, including process launch and writing a new bare repository, was measured three times per corpus with warm OS file caches. Every import then passed strict `fsck` and the 33-commit count check; those checks are outside timing. ZIP extraction and document-history queries are separate.

<!-- IMPORT_START -->

| Corpus | Native bare bundle import median ms | Range ms | Verified imports |
| --- | --- | --- | --- |
| npm | 477.9 | 434.4–511.8 | 3 |
| rust | 573.7 | 519.3–595.6 | 3 |

<!-- IMPORT_END -->

### Added browser bytes and startup

These are actual minified, tree-shaken browser imports from **isomorphic-git 1.41.9**, esbuild **0.25.9**, Buffer polyfill **6.0.3**. No HTTP Git client, persistent filesystem or user interface is imported. Gzip-transfer estimates use level 9. The Buffer shim is included in the Git bundle bytes. WASM bytes are **zero**. The separately measured experiment adapter costs **1,329 raw / 739 gzipped bytes**; a production ZIP mount, persistent cache, Markdown parser and diff renderer are outside these library measurements.

<!-- ASSETS_START -->

| Browser artifact | Raw JS bytes | Gzip bytes |
| --- | --- | --- |
| git-read | 166,033 | 53,773 |
| git-bundle | 166,700 | 53,945 |
| experiment-memory-fs | 1,329 | 739 |

<!-- ASSETS_END -->

**This reopens CARD-0002's native-decode constraint.** The tested library's [pinned inflater source](https://github.com/isomorphic-git/isomorphic-git/blob/v1.41.9/src/utils/inflate.js) initializes native-stream support to `false`, so its Git object path uses bundled Pako even where native `DecompressionStream('deflate')` exists. Native zlib inflation alone would still not parse Git trees, commits, indexes or apply Git copy/insert deltas. A smaller native-stream Git subset reader is possible without changing the standard Git format, but it was not implemented or timed here. Calling this library path “native decode only” would be incorrect.

The browser benchmark reuses CARD-0002's real headless browser runner, fresh isolated profiles and renderer-identification/memory protocol. Firefox **154.0** completes all eight scenarios; Chrome **152.0.7977.76** supplies two completed npm directory scenarios, with the rest unmeasured because repeated process startup/teardown stalled. Three profiles per completed scenario, seven warm reads per profile; tables report medians of profile statistics. Input files or the bundle are loaded before timing. Module timing includes local HTTP module loading, parsing and evaluation; it excludes browser launch, WAN latency and ZIP extraction. For B, preparation includes stripping its header and `indexPack`, which scans/reconstructs the pack to build its object-ID index. For A, the index is already shipped.

Each document-history read traverses all **33 retained commits**, resolves the path and returns its document blob at every revision. Cache state is shared within the profile. Repeated identical revisions are checked, not dropped. The comparison validates each object ID and SHA-256 plus each selected section digest. This returns the history's contents; it does **not** include rendering textual diffs. Section parsing then scans these already extracted documents, using the inspected ATX heading fixture, not a general Markdown identity resolver.

<!-- BROWSER_START -->

| Browser | Corpus | Input | Target | Profiles | Module ms (range) | Index ms | First history ms | Warm ms | Section scan ms | Renderer peak MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chrome | npm | directory | original | 3 | 45.5 (32.1–162.5) | 0.0 | 76.1 | 35.8 | 0.4 | 71.1 |
| chrome | npm | directory | most revised | 3 | 190.6 (163.5–970.7) | 0.0 | 116.2 | 60.9 | 1.8 | 74.0 |
| firefox | npm | bundle | original | 3 | 103.0 (91.0–121.0) | 141.0 | 86.0 | 54.0 | 1.0 | 81.0 |
| firefox | npm | bundle | most revised | 3 | 79.0 (73.0–102.0) | 146.0 | 120.0 | 97.0 | 3.0 | 87.5 |
| firefox | npm | directory | original | 3 | 203.0 (119.0–679.0) | 0.0 | 105.0 | 57.0 | 1.0 | 68.6 |
| firefox | npm | directory | most revised | 3 | 63.0 (61.0–132.0) | 0.0 | 136.0 | 87.0 | 3.0 | 76.0 |
| firefox | rust | bundle | original | 3 | 73.0 (50.0–89.0) | 667.0 | 259.0 | 234.0 | 1.0 | 127.1 |
| firefox | rust | bundle | most revised | 3 | 131.0 (83.0–169.0) | 645.0 | 294.0 | 248.0 | 2.0 | 128.0 |
| firefox | rust | directory | original | 3 | 62.0 (48.0–133.0) | 0.0 | 345.0 | 268.0 | 1.0 | 96.9 |
| firefox | rust | directory | most revised | 3 | 76.0 (36.0–177.0) | 0.0 | 350.0 | 262.0 | 2.0 | 105.8 |

<!-- BROWSER_END -->

Firefox has approximately 1 ms clock resolution; a zero section-scan sample is below that resolution, not zero work. The table's renderer peak is total process working-set high water, including runtime and preloaded inputs, not incremental decoder memory. Slow successful samples remain in the evidence. Startup includes shared-desktop and loopback-serving variation and should not be interpreted as an isolated JavaScript compiler benchmark.

The two compression targets alone would understate revision work: npm's `workspaces.md` changes once, while Rust's `3872-crates-io-security.md` never changes in this retained range. The added “most revised” targets are npm's `configuring-npm/package-json.md` (**11 transitions, 12 distinct blobs**) and Rust's `0320-nonzeroing-dynamic-drop.md` (**2 transitions, 3 distinct blobs**). Target selection is deterministic by changed-file frequency and path tie-break; no hand-picked synthetic heavy edit series was used.

### I/O and reconstruction boundaries

The tested isomorphic-git filesystem API calls `readFile` for the **whole `.pack` and `.idx`**. For A, those are **157,750 / 3,310,333 raw file bytes** after ZIP extraction, regardless of which measured document or section is selected. The fixture supplies the tip object ID; real ref discovery also reads `HEAD` and its ref (64 raw bytes here), plus ZIP/manifest lookup. Only the needed objects are inflated on the indexed read path; reading the entire compressed pack is not equivalent to inflating all of it. B receives **147,426 / 3,287,857 bundle bytes**, then builds the index. This is in-memory local-fixture I/O, not an HTTP range benchmark. Section extraction has the same Git-object dependencies as its containing document.

An independent [pack dependency probe](history/pack_access.py) decodes the documented headers and deltas using exact extents from `git verify-pack`. Every reconstructed object's Git hash is verified, followed by every requested document SHA-256. It demonstrates the following **possible indexed access boundaries**, including required delta bases; these are measured byte extents, not timings for a production JS range reader. Add the shipped index, ZIP lookup metadata and request overhead to obtain a cold network total.

<!-- ACCESS_START -->

| Corpus / target | Selected pack bytes | Objects | Inflated stream bytes | Reconstructed object bytes |
| --- | --- | --- | --- | --- |
| npm / compression-target | 24,635 | 177 | 40,809 | 51,097 |
| npm / most-revised | 35,428 | 194 | 70,429 | 453,359 |
| rust / compression-target | 37,042 | 100 | 56,848 | 1,145,750 |
| rust / most-revised | 42,244 | 102 | 75,920 | 1,218,899 |

<!-- ACCESS_END -->

The whole-history path includes commits and path trees, which explains why a small document still touches many objects. Rust's large flat `text` tree and delta chains reconstruct roughly a megabyte of tree/object data even though only tens of kilobytes of pack slices are required. No measured target needs another document's blob as a delta base, but Git permits that dependency. Repacking may choose different bases, depths and offsets. Format-level independent document or section decoding cannot be promised from a `.pack` entry boundary alone. [Git pack and index formats](https://git-scm.com/docs/gitformat-pack).

The flat layout can choose only the containing base entry and that path's ordered patches after consulting commit/ZIP metadata. The timings below start from those decoded bytes and verify exact endpoint reconstruction. Native Git times include process launch and patch generation, while flat Python times do not include ZIP decoding or patch rendering. They are practical operations with different outputs, **not an apples-to-apples library speed ranking**. Git section history uses `log -L start,end:path` on current line bounds; that tracks lines heuristically, not stable sections.

<!-- NATIVE_START -->

| Corpus / target | Git log -p ms | Git log -L ms | Flat payload bytes | Flat decoded bytes | Flat endpoint replay ms |
| --- | --- | --- | --- | --- | --- |
| npm / compression-target | 279.83 | 141.40 | 2,428 | 6,588 | 0.0959 |
| npm / most-revised | 85.23 | 90.11 | 17,941 | 49,334 | 3.3509 |
| rust / compression-target | 140.25 | 151.64 | 3,209 | 8,057 | 0.0007 |
| rust / most-revised | 394.89 | 396.17 | 9,070 | 28,539 | 0.2935 |

<!-- NATIVE_END -->

Flat patch streams still need the base and preceding patches. Independent DEFLATE entries do not make an arbitrary revision independently reconstructable. Checkpoints or reverse diffs trade more storage for shorter chains. Git pack deltas are storage dependencies, possibly pointing at a newer revision; they are independent of commit parent order. Keeping a standard pack with a bounded maximum depth can limit one dependency chain, but does not create section identity or eliminate tree traversal.

On a cold npm reader, B's **23,112-byte** saving over C is smaller than its **53,945-byte** gzipped Git library: B plus that library is **202,025 bytes**, before adapter/UI, versus C's **171,192** package bytes. This is a sensitivity, not a complete reader comparison: C also needs a parser and patch applier, whose browser delivery was not benchmarked. On Rust the corresponding total is **3,342,448**, below C by **81,369 bytes**, again excluding those common/additional application costs. Caching a Git reader across packages changes this calculation. Desktop timings do not qualify Safari, iOS, Android, low-memory devices or arbitrary histories.

## Truncation, grafts and squash

[semantics.py](history/semantics.py) executes Git itself; [raw results](history/semantics-results.json) preserve command outcomes. Coverage and transformation are separate axes: a package may be both truncated and squashed. “Complete” must always name a source history and scope; the absence of a shallow file cannot prove the producer never rewrote or omitted anything.

| State | Native evidence | What it does and does not establish |
| --- | --- | --- |
| Genuine shallow repository | Nonempty `$GIT_DIR/shallow`; `git rev-parse --is-shallow-repository` returns `true` | Lists boundary commit IDs. Their raw commit objects still contain parent IDs, but Git traversal treats them as roots. A preserves this file. It is a logical graft, not a newly written root object. |
| Rewritten synthetic root | Root commit has no parent; shallow status is `false` | Valid, self-contained Git and bundle, but indistinguishable from an original root without declared provenance. Rewriting a parent also changes descendant commit IDs. |
| Incremental bundle | Header prerequisite lines begin with `-<oid>` | Receiver must already have the prerequisite history/objects. These lines do not authorize dangling parents as a shallow boundary. Such a bundle is not standalone. |
| Squash update | Usually one parent | Same native structure as an ordinary one-parent commit. Parent count does not identify a squash, its original range or its contributors. |
| Ordinary merge commit | Usually two or more parents | Records multiple parent relationships. It does not prove completeness or absence of earlier squash/rewrite operations. |

The shallow fixture clones a four-commit repository with depth two. Its boundary ID is in `shallow`; `cat-file commit` preserves the missing parent's ID; `rev-list --parents` omits that parent; strict `fsck` succeeds. This is exactly the distinction documented by [Git's shallow mechanism](https://git-scm.com/docs/shallow). Legacy `info/grafts` and `refs/replace` are local history overlays, not portable proof of a rewrite; require deliberate transport/interpretation if allowed. A synthetic root should be explicitly declared instead of relying on invisible local configuration. [Replacement and graft documentation](https://git-scm.com/docs/git-replace).

**Bundle trap, observed on Git 2.50.1:** creating a v2 bundle from that shallow repository exits zero, and `bundle verify` in an empty repository also exits zero. Fetching it then fails with missing-parent/connectivity errors. Verification is insufficient to certify a bundle produced from a shallow source. A regular incremental bundle instead names its prerequisites and correctly fails verification in an empty repository, while verifying in the source repository. The bundle format [explicitly distinguishes prerequisites from shallow boundaries](https://git-scm.com/docs/gitformat-bundle). Its documented v3 capabilities add object-format and filtering, not a shallow-boundary record. The v3 shallow case was not separately executed; no v3 support is claimed.

The executable squash fixture performs **`git merge --squash` followed by `git commit`**. No `MERGE_HEAD` is written; the resulting commit has one parent. An ordinary `git commit-tree` with the same tree, parent, author, committer and message produces **the identical object ID**. Thus no native parent-count or object-content test can reliably tell these cases apart. A conventional generated message is editable, not a format guarantee. [Git's squash behavior](https://git-scm.com/docs/git-merge).

For consolidation, add a small mandatory history descriptor above whichever storage model is chosen. At minimum: history scope/identity, base and tip identities, coverage (`complete`, `truncated`, or `unknown`), boundary IDs and reason when known, transformation (`original`, `projected`, `squashed`, possibly a sequence), and the source-to-emitted range mapping. A squash needs its original range boundaries/count when known, retained attribution policy and section-summary coverage. Do not label a reconstructed synthetic root “complete upstream history”; label its selected graph self-contained and its upstream coverage truncated. The measured descriptor counts the minimal declarations but not a full original-to-emitted map, retained signatures, contributor lists or section summaries. A production manifest would need to price those additions.

## Section-level attribution: CARD-0004

All three storage models need the same semantic layer. Git natively supplies file snapshots, file paths, line-range diffs and blame. Flat diffs supply the changed line ranges and a replay chain. A mini-git object DAG would likewise supply bytes and ancestry. None automatically identifies the same semantic section after a heading rename, move or split.

Use CARD-0004's stable producer/anchor identity and scoped digest, including the heading, separately from replaceable file/byte/line locators. Parse only the needed document versions with the agreed Markdown grammar; resolve identity across versions; compare scoped bytes/digests; then attribute an edit to all affected old/new section identities. Hunk positions can limit candidates, but context lines alone are not changes and boundary edits can affect more than one section. Fences, Setext headings, duplicate headings, nested sections and renames need the actual resolver. The ATX fixture in this benchmark is only a physical read probe and must not be promoted to that parser.

Two questions must be distinguished in the format:

1. **Net change:** “Does this section differ between the ends of the collapsed range?” With stable identity and both endpoint snapshots/digests, every model can answer after squashing. For Git, read endpoint blobs; for flat diffs, reconstruct the endpoint or use a checkpoint. A heading rename counts if the scoped digest includes it. Identity maps are needed for moves/splits/merges, even when the bytes are equal elsewhere.
2. **Ever touched:** “Was this section edited at any time inside the range?” Endpoint comparison cannot answer after intermediate history is discarded. The semantic fixture edits section A, reverts A, then renames/edits B. The original range touched **A and B**; its net diff changes **only B**. Squashing or truncating before the retained endpoint removes evidence of A's edit.

For “ever touched” to survive collapse, the producer must compute and retain a section-ID union/event summary **before** throwing away intermediate revisions, with the represented range, coverage and explicit treatment of identity transitions. Squashing summaries combines their sets only when their scopes/identity maps and coverage are compatible. The fixture's `['a','b']` JSON is ten bytes, but that excludes IDs' definitions, range binding, hashes and contributors; it is not an estimate of production overhead. If authorship matters, preserve per-section contributors or original change records too. The squash author/committer does not recover them.

Truncation can answer net change only across endpoints it actually retains or provides trustworthy scoped state for. History earlier than the boundary is **unknown**, not “unchanged”, unless an explicit trustworthy summary covers it. An omitted section summary cannot be interpreted as an empty set. Git notes or commit trailers could transport custom records, but still require a package schema and rules ensuring the notes/refs survive export. An independent ZIP manifest shard is easier to discover without loading the pack; it must bind to revision and section identities, not physical pack offsets.

The representation affects recomputation cost, not this information limit. Git can traverse the retained DAG and diff snapshots; flat histories replay patches or use producer-provided maps; mini-git would need equivalent logic. **Neither mini-git nor a change of compression codec can reconstruct discarded intermediate edits.**

## Recommendation and handoff

1. **Owner decision:** accept real Git's JS/object-reader and direct-ZIP-browsing costs, or keep native decode plus flat diffs as the baseline. The data supports Git as standard history storage, not as a path to solid compression or zero-cost browser access.
2. If selecting Git, prefer **A: one indexed pack plus minimal repository metadata**, with `.pack` stored in ZIP. It costs only 7.57% more than B for npm and 0.74% for Rust at 32 commits and avoids B's index-build pass. Preserve `shallow` when shipping a genuinely shallow repository. Define allowed refs and Git object format explicitly.
3. Use **B** when single-file import and smaller full downloads dominate; require a self-contained bundle and actually test import into an empty repository. Trimming with synthetic roots requires explicit provenance. Do not use prerequisite bundles as standalone truncated packages.
4. **CARD-0001/0002:** settle whether ordinary ZIP readers must browse current Markdown. The duplication table demonstrates the cost of the straightforward Git solution. If selective history I/O is required, a range-capable standard Git reader and pack dependency policy are future implementation work; do not infer them from an outer ZIP member boundary.
5. **CARD-0004/0005:** specify scope, coverage, transformations and range-bound section identity/summary records independently of the history codec. Default “changed across range” to a documented net comparison, with a distinct `touched` query that can return unknown when no covered summary exists. Price the resulting metadata before declaring final package overhead.
6. **Mini-git:** no bespoke implementation is justified by these results. If the owner rejects both flat replay and a standard Git reader, first measure a narrow native-stream **standard Git** reader. A custom DAG/delta format would surrender interoperability without removing the hard section/provenance requirements. There are no fabricated mini-git ratio or startup numbers in this report.

## Reproduction and validation

Run from `C:\src\markdown-package`, after the pinned corpus/venv setup in [compression.md](compression.md#reproduction-and-evidence). Use the existing source checkouts; this harness does not modify them. Fixtures, browser profiles and installed packages remain ignored under `.antiphon/history-work/`; scripts and evidence are under `docs/investigations/history/`.

```powershell
New-Item -ItemType Directory -Force .antiphon/history-work/js | Out-Null
Copy-Item docs/investigations/history/package*.json .antiphon/history-work/js/
npm ci --prefix .antiphon/history-work/js --ignore-scripts --no-audit --no-fund
node docs/investigations/history/build_web.mjs
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/benchmark.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/pack_access.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/semantics.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/browser_benchmark.py --browser firefox --repeats 3
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/browser_benchmark.py --browser chrome --corpus npm --mode directory --repeats 3
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/native_import.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/verify_evidence.py
.antiphon/compression-work/venv/Scripts/python docs/investigations/history/render_tables.py
```

Run timed suites sequentially. Generated repositories are experiment fixtures; rerunning object generation with the same pinned versions produces the same package bytes. Timings vary with host activity. The semantic experiment uses a new directory each time and preserves its diagnostics. This shared Windows desktop is the same i7-6700K / 32 GiB machine used in CARD-0002; it is not a mobile or general workload claim.

<!-- VALIDATION_START -->

Validation: **5,415 ZIP entry round trips**, **42 archive hash/metadata audits**, **83 original + 97 squashed patch reconstructions**, **64 full flat-snapshot comparisons**, **16 packed repository checks**, **14 empty-repository bundle imports with strict checks** plus **6 timed native imports**, **573 independently reconstructed Git object hashes**, **132 pack-reader document hashes**, **990 browser document + 990 browser section hash checks** across **30 completed profiles**, and **5 semantic counterexamples/cases**. **0 unexpected validation failures**. Two deliberate Git negative operations demonstrate incomplete bundle imports/prerequisites. Complete three-profile browser suites: **firefox**. There were **6 recorded browser startup/teardown failures**, plus one initial unrecorded Chrome launch timeout. Two preliminary browser runs failed because the experiment build omitted the Buffer shim; the corrected, hash-pinned assets are used for all saved timing samples. Incomplete launches are excluded from timing, and successful slow samples are retained. See the launch-failure JSON for diagnostics; partial Chrome coverage is not a complete compatibility suite.

<!-- VALIDATION_END -->

Raw evidence: [sizes, fixture hashes and native timings](history/size-results.json), [native bundle imports](history/native-import-results.json), [browser asset bytes and dependencies](history/browser-assets.json), [Firefox measurements](history/firefox-results.json), [partial Chrome measurements](history/chrome-results.json), [pack dependencies](history/pack-access-results.json), [Git semantic counterexamples](history/semantics-results.json), and [verification](history/verification.json). No application build exists; this commit adds an investigation and reproducible experiments, not a format implementation.
