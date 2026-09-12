# CARD-0050: managed cross-file delta compression

Date: 2026-09-12. Follow-up to the
[full-object candidate](2026-09-12-card-0050-managed-snapshot-results.md).

**Cross-file blob deltas close the measured size gap on both requested corpora.
Native Git remains the production default.** The user chose compression work
before reconsidering activation; this change neither accepts the earlier size
inflation nor activates the managed candidate by default.

## Package and pack sizes

Same generated source bytes, metadata, ZIP compression and verification contracts
as the previous benchmark. Each final platform/backend/corpus run records a first
run followed by ten measured runs. Sizes are exact bytes, not timing estimates.
Windows and Linux produced identical package and pack sizes in every repetition.
The large corpus contains 1,648,948 source bytes; the similar corpus contains
1,780,250 source bytes.

| Corpus | Previous managed package | Native package | Managed with deltas | Managed versus native |
| --- | ---: | ---: | ---: | ---: |
| Large: 2 files, 16,384 numbered lines each | 488,859 | 398,961 | 397,646 | −1,315 (−0.33%) |
| Similar: 20 files, 2,048 common lines and a variant line | 600,973 | 319,042 | 318,670 | −372 (−0.12%) |

| Corpus | Previous managed pack | Native pack | Managed with deltas | Managed versus native |
| --- | ---: | ---: | ---: | ---: |
| Large | 243,056 | 153,158 | 151,843 | −0.86% |
| Similar | 298,334 | 16,403 | 16,031 | −2.27% |

The package reduction from the previous managed writer is 91,213 bytes (18.7%)
for large files and 282,303 bytes (47.0%) for similar files. This establishes
competitive compression for these two corpora, not a universal bound against
Git's delta search. An exploratory Windows run also measured tiny packages at
3,176 versus 3,172 native and many-small packages at 7,565 versus 7,426 native.
These remaining small differences are not silently accepted as a rollout policy.

## Implementation and independent verification

- Pack order stays ascending SHA-1. Trees, commits and object identities are
  unchanged. The writer considers blobs of at least 64 bytes against the last
  ten full blobs, skipping bases outside a 2:1 size ratio. A candidate delta is
  used only if its compressed bytes **plus object header and base reference**
  are strictly smaller than the best representation already found.
- `SnapshotDelta.cs` indexes at most 65,536 sampled 16-byte blocks per base and
  probes at most eight matches at each target position. Matching extends forward
  and back into pending literal bytes, supporting shifted text and repeated edits
  throughout a file. Inserts are at most 127 bytes; copies use Git's standard
  offset/length operands, including its compact 64 KiB encoding. Search indexes
  are lazy and bounded to ten retained bases. Cancellation is checked while
  indexing, matching and emitting literal data.
- Deltas use `OFS_DELTA` and reference an earlier **full blob**. There are no
  chains, external bases or forward references. The writer compares actual
  zlib-compressed representations with a fixed Optimal policy, not estimated
  savings. It has no Git invocation or repository staging fallback.
- `SnapshotDeltaDecoder.cs` independently interprets source/result lengths and
  copy/insert instructions. The pack verifier checks the backward distance lands
  on an existing full-blob boundary and rejects other object kinds, chains and
  reference deltas. It verifies complete zlib input, reconstructed object IDs,
  packed CRCs, index mappings, reverse index, reachability and current-view bytes.
- Both instruction inflation and reconstructed allocation are bounded before
  allocation by resource limits and the maximum blob size in the separately read
  ZIP view. Delta instruction work and reconstructed bytes count toward the
  aggregate decoded-object budget. This prevents a small archive from claiming
  an enormous reconstruction even under producer compatibility limits.
- Encoding and decoding follow the standard
  [Git delta and pack layouts](https://git-scm.com/docs/gitformat-pack).
  The decoder shares no matcher, instruction encoder or writer object table.
  The existing generated repository, ZIP structure, source normalization,
  addressing, atomic publication and native-only paths remain unchanged.

## Validation and timing evidence

[Committed raw samples](compression/managed-delta-2026-09-12.json) contain the
final Windows/Linux measurements and the earlier four-shape Windows probe.
Windows used SDK 10.0.300/runtime 10.0.8 and Git 2.50.1.windows.1; Linux Docker
used SDK 10.0.401/runtime 10.0.12 and Git 2.43.0. Final target-case measurements
were run sequentially by platform, before the full regression/proof jobs.

| Platform | Corpus | Native median / p95 ms | Managed median / p95 ms | Git calls native / managed |
| --- | --- | ---: | ---: | ---: |
| Windows | Large | 1827.68 / 2560.74 | 268.74 / 417.71 | 15 / 0 |
| Windows | Similar | 5574.19 / 6836.57 | 266.54 / 347.61 | 69 / 0 |
| Linux | Large | 1135.72 / 1592.71 | 436.18 / 599.34 | 15 / 0 |
| Linux | Similar | 937.24 / 1193.30 | 251.87 / 279.06 | 69 / 0 |

Nearest-rank p95 is the maximum of the ten measured repetitions. These are
creation timings including the appropriate independent managed or native
repository verification, not compression-only timings.

Release full solution on **each of Windows and Linux: 1,207 passed, 0 failed,
0 skipped**. Installed candidate proofs on each platform: **12 assertions passed,
0 failures**, including absent/poison Git and related files that exercise deltas.
The native oracle checks actual emitted delta packs using `verify-pack`,
`index-pack --strict`, `fsck --full --strict`, `read-tree` and standalone deep
validation. Native-generated index and reverse-index bytes match the candidate's
bytes, and commit IDs match native creation.

Independent rehashed/reindexed/re-ZIPed fixtures cover missing/interior/overflowing
base offsets, non-blob bases, chains, reference deltas, source/result length
errors, size overflow, zero opcodes, invalid copy/insert bounds, truncated copy
operands, incorrect reconstructed IDs, trailing instructions, truncated/trailing
zlib input and resource limits. Valid controls and random shifted-range roundtrips
cover copy offsets above 64 KiB, multi-byte lengths, literal runs and cancellation.

The installed candidate proof now includes three related, distinct files so its
empty-PATH and poison-Git runs exercise cross-file deltas as well as ordinary
snapshots. Native scope/depth/import/deep behavior and the production default
remain covered by the existing tests.

Timing and sampled RSS/temporary bytes retain the original harness limitations:
first run is not a controlled cold-cache trial, the process is reused, RSS omits
native child processes, and temporary bytes are peak live sampled files rather
than cumulative I/O. Those metrics do not complete the isolated performance gate.
Default activation remains a separate decision after review and that gate.

## Rerun

From `src/generator-cli`, normal Release regression suite:

```powershell
dotnet test -c Release --no-progress --output Normal
```

Requested benchmark cases, with one first run and ten measured repetitions each:

```powershell
$env:MDPKG_SNAPSHOT_BENCHMARK = "$PWD/../../.antiphon/delta-benchmark.json"
$env:MDPKG_SNAPSHOT_BENCHMARK_SHAPES = 'large,similar'
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-class '*ManagedSnapshotBenchmarks' --no-progress --output Normal
Remove-Item Env:MDPKG_SNAPSHOT_BENCHMARK, Env:MDPKG_SNAPSHOT_BENCHMARK_SHAPES
```

Omit `MDPKG_SNAPSHOT_BENCHMARK_SHAPES` to include the original tiny/many-small cases.
Linux uses the same test command and `export` for the two environment variables.
Keep full-suite artifacts inside the checkout for existing fixture discovery.
The candidate build/install proof command is unchanged from the original report.
