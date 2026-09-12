# CARD-0050: Git-independent snapshot packing

Date: 2026-09-12. Investigation and proposed implementation plan only. Examined
repository revision `411d1de057bbee2d413e0f06813a66bf4721a5fb` and the full
description of CARD-0050 on the markdown-package board. No producer implementation
or format specification is changed by this document.

## Finding

**An in-process, native-Git-free implementation of the existing single-snapshot
pack path is feasible and compatible with version 1. An arbitrary byte-for-byte
ZIP of the source, with no generated Git entries, is not.**

Default `pack` already needs neither a source repository nor staging or prior
commits. It reads the current files, ignores the source's exact root `.git`
entry, and creates one parentless commit in an isolated temporary repository.
It still launches native Git to construct objects, produce the pack/index and
deep-validate its output. The API for in-memory snapshots has the same dependency.

Recommend an internal optimization of ordinary `pack`, with no new
`--snapshot-only` or `--no-history` flag. Initially guarantee zero Git subprocesses
for snapshots without `--scope` or `--depth`, including their post-write
verification. Keep native Git for explicit history import, Git pathspec selection
and general-purpose deep validation. Preserve source normalization, addressing,
generated repository entries and atomic publication.

This removes substantial runtime machinery, but adds a pack/index writer and
an independent verifier. It is not a simpler implementation than invoking Git.
Current measurements establish an optimization opportunity, not a measured
speedup for code that does not yet exist. Performance and package-size gates
below must pass before describing the replacement as faster.

## 1. What already happens

The card's `Mdpkg.Core/Engine/Git/` path predates the current extraction. Its
implementation now lives under `Mdpkg.Core/Internal/Git/`.

| Question | Current behavior and evidence |
| --- | --- |
| Must the source be a Git repository? | No. `PackCommand.Create` chooses `CreationMode.Snapshot` unless `--from-git` is present. `SourceTree.ReadAsync` enumerates disk files. |
| Must users stage or commit? | No. Snapshot packing reads neither the source index nor its `HEAD`. Dirty, staged-but-further-edited, untracked and gitignored files use their current disk contents. There is no `.gitignore` filtering or Markdown-only input filter. |
| Is source Git state changed? | No intentional checkout, index update, commit, fetch or config write. Object writes occur in the private temporary repository. The probes below compare all source and `.git` file contents before/after. |
| Is source Git metadata copied? | The exact root `.git` entry is skipped before opening it, whether directory or Git worktree pointer file. Generated `.git` entries still exist in the result. This is not a recursive rule to ignore every directory named `.git` anywhere in the tree. |
| Does it ZIP every file as-is? | No. Files must be strict UTF-8; CRLF and lone CR become LF with `MDPK1004`. Paths, collisions, reserved names, links and resource limits are checked. Files use mode `100644`; empty directories are not recorded. The ledger may be canonicalized, omitted when empty, or changed by correspondence and reserved-slot births. The source files themselves remain unchanged. |
| Are prior output/control files ignored? | No general artifact filter exists. Output must be outside source. A pre-existing `.mdpkg/manifest.json` or unsupported reserved source path is rejected, not imported or silently skipped. The recognized address ledger is carried through; `pack` rejects review authoring paths. Other ordinary UTF-8 files, including an ignored build artifact, can be included. |
| Does `--from-git` mean current working tree? | No. It imports committed `HEAD` first-parent history from a repository root or bare repository; dirty and untracked contents are excluded. Scope/depth can project/truncate it. |
| Is native Git optional today? | No for successful `pack`, including plain-directory and in-memory snapshots. Missing Git gives environment failure / CLI exit 5, `MDPK5001`, and no published package. Full validation without `--deep` does not use Git, but skips deep integrity checks. |

Implementation references:

- [CLI selection and options](../../src/generator-cli/src/Mdpkg.Cli/Commands/PackCommand.cs),
  [public directory and stream creation](../../src/generator-cli/src/Mdpkg.Core/PackageBuilder.cs),
  [metadata and request contracts](../../src/generator-cli/src/Mdpkg.Core/Contracts.cs).
- [Disk enumeration and normalization](../../src/generator-cli/src/Mdpkg.Core/Internal/Sources/SourceTree.cs),
  [path rules](../../src/generator-cli/src/Mdpkg.Reader/Internal/Sources/SourceRules.cs),
  [snapshot orchestration](../../src/generator-cli/src/Mdpkg.Core/Internal/PackageBuilder.cs).
- [Git operations](../../src/generator-cli/src/Mdpkg.Core/Internal/Git/Repository.cs),
  [process launch and environment isolation](../../src/generator-cli/src/Mdpkg.Core/Internal/Git/GitProcess.cs),
  [post-write validation](../../src/generator-cli/src/Mdpkg.Core/Internal/Validation/PackageValidator.cs).

The ordinary successful path runs `init --bare`, `hash-object` for each blob,
`mktree` for each tree, `hash-object -t commit`, `pack-objects` and `index-pack`.
`Repository.CommitAsync` already constructs the commit payload in .NET; Git
still hashes/stores it. Post-write verification extracts the curated repository
to another temporary directory and runs `fsck`, `rev-list`, `cat-file` and
`ls-tree`. Optional snapshot `--scope` adds native tree/pathspec operations.
`GitProcess` uses `ProcessStartInfo` argument lists, not a command shell.

For an ordinary snapshot with F tracked files and T tree objects (including the
root), this source gives **3F + T + 8 direct Git process launches**: F + T + 4
for creation and 2F + 4 for verification. This is a static count, not an OS
process trace; Git's own child processes would be additional. A ledger counts
as another file and adds its directories. Source Git history does not enter it.

## 2. Why native Git is replaceable, but Git data is required

[The authoritative specification](../spec.md) constrains the resulting artifact:

| Requirement | Consequence for a fresh snapshot |
| --- | --- |
| §§2, 4, 5.2: `current` names a qualified Git commit and equals `refs/heads/main` | A real SHA-1 commit and its reachable tree/blobs remain necessary. A random token or document digest cannot substitute. |
| §5.1: curated repository, one pack plus index, fixed `HEAD`/config/ref | Neither omitting `.git` nor writing only loose objects conforms. Native repository directories need not exist on disk while producing these ZIP entries. |
| §§3.2–3.5: manifest first, pack last, Git binary entries stored, controlled ZIP fields | A generic directory ZIP command is insufficient. Reuse the package ZIP writer. |
| §3.6 and D-17: stored UTF-8 text uses LF | Literal preservation of arbitrary CRLF/binary input is incompatible with this version. |
| §§3.8, 5.1: extracted repository works with Git; pack layout is not identity | An independent encoder must produce interoperable data, not reproduce one `git pack-objects` byte stream. |
| §6: default roots/digests use namespace, locators and content; exceptions are a tracked ledger | Addressing computation does not require a Git process. The existing `Inventory` and `LedgerEngine` are managed code. |

D-17 says the pack/index/reverse index must be stored “byte for byte as Git
wrote them.” Read with §5.1's explicit permission to repack without changing
identity, this protects binary payloads from text/EOL conversion; it is not a
mandate to spawn a particular executable. No rule requires a producer to run
`git fsck` itself: §3.8 requires an extracted repository for which it passes.
The CLI reference's literal Git commands describe the present implementation,
and its opening expressly makes it subordinate to the format specification.

There is concrete project precedent, beyond this interpretation:
[the browser writer](../../src/web-viewer/src/review/git.js) uses isomorphic-git
and an in-memory filesystem to write a parentless commit, pack and index without
the native Git executable. Its real downloaded
[browser-v2.mdpkg fixture](../../src/web-viewer/tests/fixtures/browser-v2.mdpkg)
passes native Git and the CLI's deep validator. This investigation reran both:
25 independent ZIP/Git checks and 23 CLI checks passed, zero failures or
diagnostics. This proves compatible non-native construction; it does not prove
a .NET implementation or its performance. The browser's own
[self-validation](../../src/web-viewer/src/review/emit.js) is explicitly
structural and cannot be copied as a replacement for the CLI's deep check.

For a newly created lineage, retain existing declarations: one parentless
commit, `history.coverage: complete`, `root: original`, `transform: []`, and
`sourceBase = sourceTip = current`; no shallow boundaries, summaries or patches.
“Original” describes the root of this new lineage, not preservation of an
unrelated source repository's upstream history. `addressing.coverage` still
depends on the supplied ledger and correspondence; unknown records can make
even a one-commit snapshot partial. Do not mark it complete merely because
there is only one commit, or claim continuity with discarded prior packages.

## 3. Proposed CLI/API boundary

The existing invocation remains:

```text
mdpkg pack ./docs --out ./docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
```

| Invocation/request | Proposed first implementation |
| --- | --- |
| Default `pack`, no `--scope` or `--depth` | Managed construction and managed verification; zero native Git launches, with or without a source `.git` entry. |
| `SnapshotPackageRequest` | Same managed path, retaining caller-owned stream and resource contracts. |
| Snapshot with `--message`, correspondence, warning policy, compression, data descriptors or reverse index | Remains managed; these features do not intrinsically need native Git. Implement `.rev` when requested rather than introducing a hidden fallback. |
| `--from-git` | Existing native import path, including a source with only one commit. Do not inspect source history to decide whether to turn an explicit import into a snapshot. |
| Snapshot `--scope` | Existing native path. It is a full Git pathspec, not a directory prefix or .NET glob. A user can select a source subdirectory instead, but paths/roots change and this is not equivalent to projection. |
| Snapshot `--depth` | Preserve existing native behavior initially. It currently marks the single snapshot truncated/synthetic even without import. Rejecting it or treating it as a no-op would be a separate compatibility change. |
| `validate --deep` on arbitrary packages | Existing native verification. Do not advertise the entire CLI as independent of Git. |

Select the managed branch before constructing `GitProcess`, initializing a
repository, or probing Git availability. Do not fall back to Git after an
eligible managed operation fails. Existing `EngineSettings.GitExecutable`
continues to configure native operations; an invalid executable must not prevent
an eligible managed snapshot. Keep SHA-256 object creation unsupported with
`MDPK4001`; .NET SHA-256 availability does not implement that format extension.

No new public creation mode or required backend option is needed. Keep
`CreationMode.Snapshot` and the existing metadata defaults. An internal seam can
select native and managed implementations for differential tests. An optional
future “require no native Git” policy could reject incompatible options, but is
not necessary to ship the precisely documented default path.

Suggested user-facing wording after implementation:

> Pack the current files without staging or committing them. Ordinary snapshots
> need no installed Git. The package contains a generated single-commit Git
> repository; your source repository is ignored. Text is normalized to LF and
> package path/content rules apply. Git import, Git pathspec/depth options and
> general deep validation still require Git.

If “no Git files” literally means no `.git` entries in the output, the honest
alternative is an ordinary `.zip` of the desired files. It is not a version-1
`.mdpkg`. Keeping native Git invisible today is already the alternative when
the additional implementation/verification cost is not justified.

## 4. Implementation slices for a follow-on build

### A. Share snapshot preparation and retain publication guarantees

Separate source enumeration/normalization, inventory, correspondence, ledger
validation/minting and history metadata from repository I/O. Both backends must
consume the same prepared entries. Preserve every existing diagnostic, warning
promotion, resource limit, cancellation check and directory/memory parity.
Use one captured set of bytes for both ZIP entries and Git blobs; do not re-read
source files between the two. This is a sequential file capture, not an atomic
filesystem snapshot of files being edited concurrently.

Create no temporary Git repository, loose-object directories or extracted
verification repository on the managed path. Retain flushed sibling output
staging, re-open verification and atomic replacement. The stream API may still
use private **package** spooling before copying into a caller-owned stream;
“no temp Git repository” must not become a promise of no temporary storage or
weaker failure semantics. Preserve existing destination on pre-publication
failure; interrupted stream copies retain the documented possible prefix.

### B. Emit standard objects and a compact, deterministic pack/index

Use SHA-1 of `type + space + decimal byte length + NUL + payload` for object
identity. Blob payload is the prepared file bytes. This is the documented
[Git object construction](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects),
which is implementable without invoking Git.

Construct binary trees bottom-up with raw 20-byte object IDs and Git's basename
ordering (directories compare with a trailing slash). Preserve filename bytes;
NFC/case folding is collision detection, not a rename. Use file mode `100644`
and the canonical tree mode representation. Include the root tree for an empty
source, omit empty directories and deduplicate identical objects. Do not rely
on ordinary lexical sorting of full paths; test names such as `foo.c`, `foo/`
and `foo0` against native Git. Reject same-ID/different-payload inconsistencies.

Reuse the exact commit serializer and metadata validation policy:
`mdpkg <mdpkg@example.invalid>`, Unix time `946684800`, offset `+0000`, default
message `Initial package`, no parent header. Preserve caller-supplied identity,
offset and message behavior in the public API. The namespace still affects
addressing, not the Git hashing algorithm.

Write PACK v2 using full objects initially; deltas are optional. Build the v2
index and optional reverse index using the
[official pack/index layouts](https://git-scm.com/docs/gitformat-pack):
object headers, compressed payloads, pack checksum, sorted IDs, fanout,
packed-object CRCs, offsets and index checksum must agree. Bound every size and
offset, including the index's large-offset representation if reachable under
existing limits. Do not confuse packed payloads with loose-object headers.
Use [`.NET ZLibStream`](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.zlibstream?view=net-10.0)
for zlib-wrapped pack compression; the ZIP writer uses raw DEFLATE separately.
Emit fixed refs/config as ZIP entries and reuse `ZipContainer.Write` unchanged
where possible. Specify a stable object order and fixed pack compression policy
for repeatability. Whole archives can differ from native-produced archives;
normalized blobs, trees, commit IDs and addressing results must match under
identical prepared inputs and metadata. Random reserved-slot births remain the
existing exception to repeat-run determinism.

Full objects avoid delta search and decoding complexity, but different files
in a single snapshot can still benefit from cross-file deltas. “No previous
revision” does not imply that native Git has no compression advantage. Measure
the package-size tradeoff before selecting this as the default.

### C. Verify the serialized output independently in-process

This slice is mandatory. Calling today's `ValidateAsync(... Deep: true)` would
spawn Git again; replacing it with `Deep: false` alone silently weakens the
successful pack contract. Extract shared container/metadata checks and add an
internal verifier for the exact managed snapshot shape, reading the staged
archive rather than trusting the writer's object tables.

Verify pack and index structure/checksums, object boundaries and decoded
lengths, complete zlib streams, every object ID and index mapping, optional
reverse-index consistency, duplicate/unreachable objects, and limits. Check
one structurally valid parentless commit, valid canonical trees/modes/names,
complete reachability, and exact equality of all tracked paths and bytes with
the current ZIP view. Validate the retained ledger, targets, reserved births,
UTF-8/LF content and coverage claims against the reconstructed snapshot.
Retain all shared format/ZIP checks and verify no undeclared history evidence
is present. Unsupported object kinds/deltas or multi-commit shapes must be
rejected by this restricted verifier, not treated as verified.

Keep it internal to managed snapshot production; it need not become a general
pack reader for arbitrary imports. Existing full/deep validation APIs and
external verification providers keep their current behavior. Reuse semantic
validators while keeping binary decoding independent of serialization. CI
must independently accept output with native Git; runtime pack must never
invoke that oracle. Update the CLI reference's check wording from a literal
`git fsck` invocation to repository integrity with the actual backend stated;
do not report that a process ran when it did not. Preserve check identifiers
and failure categories unless a separately documented API change is needed.

### D. Integration, documentation and measured acceptance

Update the tool reference, CLI/Core README and help dependency statements;
the format spec needs no change. Add the eligibility matrix and source-file
selection semantics. Update old tests that deliberately expect snapshots to
fail without Git while retaining missing-Git tests for native-only operations.
Only switch the default path once the following acceptance work succeeds.

## 5. Acceptance and performance gates

| Area | Required evidence before enabling by default |
| --- | --- |
| No native execution | Run the installed CLI and both Core snapshot APIs with Git absent, and with a fail-on-invocation executable/process seam. Assert zero calls, including availability probes and self-validation; assert no temporary repository directories. Mere success with empty PATH does not rule out a hard-coded executable. |
| Current-source behavior | Non-repository, unborn repository, dirty index/HEAD, untracked and ignored files, root `.git` directory/gitfile; compare source and repository contents before/after. Cover invalid UTF-8, CRLF/lone CR, BOM, path collisions, reparse points, empty input and non-Markdown text. |
| Object compatibility | Independent fixtures for raw trees, Unicode and directory ordering, duplicate blobs, empty blobs/tree, metadata offsets/messages, ledger and correspondence. Match native blob/tree/commit IDs; native `index-pack --strict`, `fsck --full --strict`, extraction plus `read-tree`, and current-view comparisons must pass. Include optional `.rev`. |
| Verification strength | Corrupt pack payloads, object types/lengths/headers, tree links/order/modes, parent/count, IDs, fanout, CRCs, offsets, checksums, `.rev`, ledger and coverage. Repair outer ZIP CRCs and relevant enclosing checksums so cases reach the intended inner validation. Include truncation, trailing compressed data, invalid UTF-8/CR and decompression/resource bounds. |
| Public behavior | Directory/memory output parity, data descriptors, compression options, warning/complete policies, custom metadata, cancellation, source/output/report containment and destination preservation. Native import/scope/depth remain unchanged. Standalone deep validation still works on new packages. |
| Performance | Compare Release native and managed paths on Windows and Linux with identical inputs, metadata and equivalent verification. Record cold/warm wall time, median and p95, process count, peak memory, temporary bytes, final package bytes and pack bytes. Include tiny inputs, many small files, large files and highly similar files; at least 10 measured repetitions per case after warmup. |

Proposed build gate under this plan's defaults: zero subprocesses is absolute;
managed median wall time must improve on native for both small benchmark
shapes below; investigate any p95 or memory regression before enabling the
default. Report size changes on the representative and similar-file corpora.
Do not invent an acceptable size-inflation percentage without measurements.
If the full-object approach materially loses compression, return the measured
tradeoff for a decision or revise the backend; do not hide it behind a “fast”
flag or silently fall back to Git. No numerical speedup is promised here.

## 6. Evidence collected in this investigation

Windows host, .NET SDK `10.0.300`, Git `2.50.1.windows.1`, Release CLI built from
the revision above. Build: **0 warnings, 0 errors**. Focused existing Core
tests: **5 passed, 0 failed, 0 skipped** (snapshot determinism/normalization,
snapshot scope, two missing-Git cases and extraction/native compatibility).
Ad-hoc existing-CLI assertions: **14 passed, 0 failed**, with no prototype
producer implemented:

- Plain directory succeeds; its one-root history is complete and all 23 pack
  self-validation checks pass. Untracked/gitignored files are included.
- CRLF/lone CR becomes LF with `MDPK1004`; original source hashes are unchanged.
- Adding an invalid `.git/config` and `.git/index` leaves the package
  byte-identical; neither source metadata payload nor source index is shipped.
- Empty child-process PATH produces exit 5 / `MDPK5001` and no output.
  Output within source is rejected with exit 2.
- With three different committed, staged and current disk versions of a file,
  snapshot captures disk plus an untracked file. `--from-git` captures committed
  `HEAD` only. Hashes of every source and `.git` file remain unchanged after both.

Native baseline timings include process startup, preparation, packaging and
deep self-validation. One warmup precedes three recorded runs per input. Each
flat UTF-8 Markdown file contains `# File N` followed by 64 copies of
`Snapshot paragraph.` with LF endings. This is a small exploratory sample on a
shared host, not an isolated or statistically strong performance study.

| Files | Source bytes | Recorded wall times (ms) | Median (ms) | Package bytes | Direct Git launches, derived |
| --- | ---: | --- | ---: | ---: | ---: |
| 1 | 1,289 | 2,090.54; 1,541.84; 1,890.32 | 1,890.32 | 3,183 | 12 |
| 20 | 25,790 | 5,673.20; 5,299.93; 5,678.01 | 5,673.20 | 7,532 | 69 |

Inference: eliminating the per-file subprocess orchestration plausibly helps
small snapshots substantially. These measurements do not isolate process time
from parsing, compression or validation, and no managed-vs-native benchmark was
possible without building the proposed implementation. The managed verifier
will still do real hashing, decompression and structural checks.

The tracked browser fixture was independently rechecked: **25 ZIP/native-Git
checks passed and 23 CLI deep checks passed, zero failures/diagnostics**. Its
SHA-256 is `535affaee163200cda69d14977529f668d18428173b35095b7d471048b5ce94a`.
Git was used as an external verification oracle in these tests; the browser
writer's source and fixture provenance establish non-native construction.

Rerun the existing build/tests from `src/generator-cli`:

```powershell
dotnet build src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release --nologo -v quiet
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-method '*Snapshot*' --filter-method '*MissingGit*' --filter-method '*OrdinaryZip*' --no-progress --output Normal
```

Rerun the non-native-writer compatibility evidence from the repository root:

```powershell
python src/web-viewer/tests/validate-export.py src/web-viewer/tests/fixtures/browser-v2.mdpkg
dotnet src/generator-cli/artifacts/bin/Mdpkg.Cli/release/mdpkg.dll validate src/web-viewer/tests/fixtures/browser-v2.mdpkg --deep --format json
```

The ad-hoc source/output fixtures and raw measurements remain locally at
`C:\src\markdown-package\.antiphon\task-7b8322cb-probes\`, with
`results.json` containing the 14 assertion labels and timing samples. They are
ignored scratch evidence; all conclusions and measurements needed for the
follow-on card are recorded here. No managed writer, implementation change,
or performance improvement is claimed by this planning deliverable.

## 7. Recommended next stage

Proceed to test design for the bounded managed snapshot writer/verifier, then
build slices A–D. The defaults are no new CLI mode, no native Git on eligible
snapshots, required generated Git entries, unchanged content rules and no
weakening of verification. The plan itself is complete without an owner answer.
Return for a decision only if measured compression/performance tradeoffs make
the proposed automatic default unattractive, or if the intended product is
actually an ordinary raw ZIP with no Git data.
