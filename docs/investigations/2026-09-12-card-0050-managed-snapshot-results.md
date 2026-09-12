# CARD-0050 managed snapshot candidate: implementation and acceptance results

Date: 2026-09-12. Implements the writer/verifier candidate from the
[approved plan](2026-09-12-card-0050-git-independent-snapshot-plan.md).

**Historical full-object baseline:** the user subsequently chose to improve
compression first. See the [delta follow-up](2026-09-12-card-0050-managed-delta-results.md)
for the current implementation and measurements. Native Git remains the default;
the initial request to decide whether to accept size inflation is resolved.

**The managed candidate works, but the default switch is blocked by the measured
compression tradeoff and incomplete performance acceptance. Production builds
continue using native Git.** Similar-file packages increased from 319,042 to
600,973 bytes (+88.4%); the large-file case increased 22.5%. The plan explicitly
requires a decision on material compression loss. Recommended next work: improve
managed compression, then repeat acceptance before changing the default. There is
no public backend option or fallback from an eligible managed failure to Git.

## Implementation

- Shared snapshot preparation remains in `Internal/PackageBuilder.cs`: one capture
  feeds normalization, inventory, correspondence, ledger validation/minting, the
  current ZIP view and either repository backend. Native import/projection/depth
  continue through the same existing preparation and repository code.
- `Internal/Git/ManagedSnapshot.cs` emits deduplicated SHA-1 blobs, canonical
  bottom-up binary trees, the shared serialized parentless commit, PACK v2, index
  v2 and optional reverse index. Pack order is ascending object ID, with fixed
  `ZLibStream` Optimal compression. Empty objects have an explicit canonical
  empty zlib stream because .NET emits no bytes without nonempty input. Object
  IDs and native-generated index/reverse-index bytes match native Git in tests;
  pack/ZIP bytes need not equal native `pack-objects` output.
- Existing byte-array Git entry limits keep pack offsets below 2 GiB. The writer
  checks stream growth against resource and array bounds before each write.
  Large-offset index representations are consequently unreachable and rejected
  by this restricted verifier. No Git repository, loose objects or verification
  extraction directory is created by the managed branch.
- `Internal/Validation/ManagedSnapshotVerifier.cs` rereads the staged ZIP through
  the shared validator. It independently decodes using SharpZipLib's inflater,
  verifies complete zlib streams, lengths, hashes, CRCs, offsets, fanout, pack/index
  bindings and optional reverse permutation, then checks the one-commit graph,
  tree ordering/modes/names, reachability and exact current-view equality.
  Unsupported kinds/deltas, extra commits, duplicate/unreachable objects and
  undeclared history evidence are rejected. Shared UTF-8/LF, ledger targets,
  reserved births and coverage checks therefore also cover every retained blob.
- `SnapshotGitRules.cs` adds tracked Git-name aliases, attribute limits and
  submodule-config semantic checks. Git's `gitmodulesParse` is informational even
  under strict fsck, so syntax-only failures retain native acceptance; unsafe
  parsed submodule settings fail. These details were checked against Git's
  [fsck message categories](https://github.com/git/git/blob/v2.50.1/fsck.h),
  [tree/blob validation](https://github.com/git/git/blob/v2.50.1/fsck.c),
  [name rules](https://github.com/git/git/blob/v2.50.1/path.c) and
  [submodule checks](https://github.com/git/git/blob/v2.50.1/submodule-config.c).
- Pack/index layouts follow the [Git pack format](https://git-scm.com/docs/gitformat-pack).
  Binary decoding does not use the writer's object tables, hash helper or commit
  serializer. Native Git is an external test oracle only for managed creation.
- Flushed sibling staging, reopened verification and atomic replacement remain
  shared. The public stream API still privately spools a package and leaves the
  caller's stream open; a failed/interrupted final copy can leave a prefix.

## Eligibility and rollout status

| Operation | Candidate build | Production build |
| --- | --- | --- |
| Directory snapshot, no scope/depth | Managed creation and verification | Native, gate pending |
| `SnapshotPackageRequest` | Managed creation and verification | Native, gate pending |
| Message, metadata, correspondence, warning/completeness policy, compression, descriptors, reverse index | Remain managed for eligible snapshots | Native, gate pending |
| Explicit Git import, even one commit | Native | Native |
| Snapshot scope or depth | Native | Native |
| Standalone general deep validation | Native | Native |

The internal `EngineSettings.ManagedSnapshots` seam supports differential tests.
`-p:MdpkgManagedSnapshotCandidate=true` compiles a candidate whose ordinary public
API/installed CLI call sites select managed creation by default. This is an
acceptance-build switch, not a supported user option. Normal builds and release
workflows do not set it. Existing missing-Git tests remain valid for the normal
native default; new tests cover missing Git for the candidate and native-only
operations. No format specification was changed.

## Verification evidence

- Windows Release full solution: **1,181 passed, 0 failed, 0 skipped**.
- Linux Release full solution: **1,181 passed, 0 failed, 0 skipped**.
- Subsequent Windows inner-object declared-size/resource test run: **17 passed,
  0 failed**, including the new repaired-checksum oversized-header case.
- Final Windows managed writer/verifier regression after the object-count bound:
  **76 passed, 0 failed, 0 skipped**.
- CLI specification/help consistency after documentation edits: **3 passed,
  0 failed**.
- Installed candidate on **each of Windows and Linux: 12 assertions passed,
  0 failures**. Empty PATH and
  a compiled executable that logs every invocation both succeed for ordinary
  snapshots with descriptors/reverse index; zero Git calls. The poison executable
  is first positively tested, and snapshot depth invokes it and fails without
  publication. Both Core snapshot APIs also pass with an invalid Git executable
  and an async-local process hook that throws on any launch.
- New tests compare Unicode/directory ordering, empty tree/blob, repeated blobs,
  custom author/committer offsets/messages and current-view metadata against the
  native backend. Extracted output passes native `fsck --full --strict`,
  `read-tree` and `index-pack --strict`; regenerated index/reverse-index bytes
  match. Standalone native deep validation succeeds.
- Rewrapped corruption covers outer/inner checksums, versions, types/lengths,
  fanout, IDs, CRCs, offsets, index trailing bytes, reverse-index contents,
  current-view UTF-8/CR/content, history and coverage. Independently constructed
  rehashed fixtures cover bad tree modes/order/names/links, duplicate names and
  objects, extra commits/parents, empty directories, unreachable objects,
  malformed identities, truncated/trailing zlib data and resource rejection.
- Source/API tests cover nonrepository input, unborn and dirty/staged repositories,
  ignored/untracked current text, root `.git` directory/gitfile, source byte
  preservation, BOM and EOL normalization, invalid UTF-8, memory path collisions,
  directory/stream parity, warning/resource/pre-cancellation destination
  preservation, partial correspondence and reserved-slot births.

An initial empty-object encoding failure was fixed. The native oracle initially
tried overwriting its existing index; it now writes to a separate path. A native
`.gitmodules` syntax-acceptance mismatch was corrected. An initial Linux attempt
used Git 2.25.1 (too old for the existing native backend); the Docker Linux run
uses Git 2.43.0. A first full Linux run placed artifacts outside the repository,
preventing fixture discovery; its fixture failures are not product failures.

## Measurements

[All raw samples](compression/managed-snapshot-2026-09-12.json) are committed.
Each backend/shape has one recorded first run followed by ten measured warm runs.
Windows: .NET runtime 10.0.8, SDK 10.0.300, Git 2.50.1.windows.1. Linux Docker:
.NET runtime 10.0.12, SDK 10.0.401, Git 2.43.0. See raw JSON for OS/runtime strings.
Both backends run preparation, ZIP writing, flush/reopen, and their full repository
self-verification; native additionally creates/extracts private Git repositories.

| OS | Shape | Native median / p95 ms | Managed median / p95 ms | Direct Git calls native / managed |
| --- | --- | ---: | ---: | ---: |
| Windows | Tiny (1 file) | 1916.26 / 2347.25 | 19.10 / 173.79 | 12 / 0 |
| Windows | Many small (20 files) | 8236.74 / 11684.55 | 40.74 / 56.23 | 69 / 0 |
| Windows | Large (2 files) | 3149.66 / 3913.54 | 532.06 / 565.40 | 15 / 0 |
| Windows | Similar (20 files) | 8750.80 / 12417.22 | 478.15 / 646.24 | 69 / 0 |
| Linux | Tiny | 147.66 / 207.85 | 17.29 / 19.77 | 12 / 0 |
| Linux | Many small | 611.75 / 651.38 | 93.22 / 165.84 | 69 / 0 |
| Linux | Large | 1065.35 / 1443.45 | 444.31 / 590.45 | 15 / 0 |
| Linux | Similar | 1012.34 / 1226.26 | 308.73 / 605.25 | 69 / 0 |

The nearest-rank p95 of ten samples is their maximum. Corpus generation is in
`ManagedSnapshotBenchmarks.cs`: tiny/many use the plan's 64 repeated paragraphs;
large uses 16,384 numbered text lines per file; similar uses 2,048 common numbered
lines with a differing final line. Package sizes are identical on both platforms.

| Shape | Native / managed package bytes | Change | Native / managed pack bytes |
| --- | ---: | ---: | ---: |
| Tiny | 3172 / 3176 | +0.1% | 250 / 254 |
| Many small | 7426 / 7812 | +5.2% | 1358 / 1744 |
| Large | 398961 / 488859 | +22.5% | 153158 / 243056 |
| Similar | 319042 / 600973 | +88.4% | 16403 / 298334 |

Measurements are exploratory acceptance evidence, **not completion of the full
performance gate**. First runs are not controlled cold-cache/process runs. The
host was shared and other validation work overlapped parts of the measurements.
Windows samples preceded the final special-Git-file semantic checks. RSS is
sampled host working set in a reused test process, excluding native child RSS;
temporary bytes are sampled peak live files, not cumulative bytes written. A
5 ms sampler can miss short-lived files. The raw data records these metrics and
first-run times, but they cannot establish process-tree peak memory or clean
cold/warm regression bounds. For example, Windows large-case host RSS increased
from 217,595,904 to 226,463,744 bytes (~4.1%); allocation history and absent child
RSS prevent treating that as an isolated backend regression.

Before rollout: resolve compression policy, rerun final-code benchmarks in
isolated fresh processes with native-child memory and cumulative temporary I/O,
and complete adversarial/resource/cancellation review. Full-object size inflation
is not accepted by default. No numerical production speedup is promised.

## Rerun

From `src/generator-cli`, normal Release regression suite:

```powershell
dotnet test -c Release --no-progress --output Normal
```

Focused candidate tests select the internal backend themselves:

```powershell
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-class '*ManagedSnapshotTests' --filter-class '*ManagedSnapshotStructureTests' --no-progress --output Normal
$env:MDPKG_SNAPSHOT_BENCHMARK = 'C:\temp\snapshot-benchmark.json'
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-class '*ManagedSnapshotBenchmarks' --no-progress --output Normal
Remove-Item Env:MDPKG_SNAPSHOT_BENCHMARK
```

Build/install a private candidate (do not publish this feed):

```powershell
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path ../../.antiphon/managed-candidate -o ../../.antiphon/managed-feed
python tests/prove-managed-snapshot.py --local-feed ../../.antiphon/managed-feed
```

Linux uses the same commands with Linux paths and `export` for the benchmark
environment variable. Put full-suite artifacts **inside the repository** so
existing fixtures can be located by walking ancestors from the test assembly.

## Decision requested

Keep native as the default and implement managed delta compression first
(recommended), or explicitly accept the measured larger packages subject to
the remaining acceptance gates. Neither option authorizes skipping the verifier
or silently falling back to native Git. The current committed result is a
guarded implementation suitable for review and further acceptance work.
