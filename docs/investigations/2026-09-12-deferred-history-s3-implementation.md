# Deferred history S3 implementation and review handoff

S3 implements deterministic materialization, independently verified origin reconstruction,
and the bounded append operation from the approved breaking-revision plan. The CLI and
public Core API now perform real updates. S4 Reviews integration remains separate.

## Behavior and implementation

- `update S0.mdpkg --materialize --out C0.mdpkg` captures and validates S0, constructs
  the fixed bootstrap payload, and publishes one parentless commit with frozen origin.
  The same action on a valid Git input re-emits its identity without adding a commit.
- `update base.mdpkg --tree tree --message text --out next.mdpkg` materializes an S0
  base if needed, then appends an ordinary child with successor metadata. A Git base
  must have a complete retained graph, original/materialized root, unprojected
  endpoints, and no shallow boundaries, transformations, ranges, patches or bindings.
  Partial addressing remains supported and existing intervals are preserved.
- Append carries the base ledger, rejects conflicting source ledger bytes, applies
  explicit correspondence, retains exceptional roots/retirements, mints reserved
  births, and marks unconfirmed changes partial. Ordinary updates cannot author review
  content; delta-review materialization is supported.
- Inputs are captured privately. File outputs undergo independent Deep validation in
  a sibling staging file before atomic replacement. Failure preserves an existing
  destination. Stream APIs validate privately before final copy, retain caller ownership,
  and may leave a prefix if that final copy fails. Cancellation propagates.

The main implementation is in `Mdpkg.Core/PackageUpdater.cs`, its internal orchestration,
`Internal/Git/BootstrapSerializer.cs`, and `Internal/Validation/OriginVerifier.cs`.
The verifier does not call the bootstrap serializer: it checks native object integrity,
the oldest parentless root, canonical regular-file tree, exact commit payload, and a
reconstructed snapshot under the frozen semantic header using normal snapshot validation.
All original files are taken from the root tree, independently of the current ZIP view.

## Reader contract for S4

`IHistoryVerificationBackend.VerifyAsync` returns an owned `VerifiedHistoryContext`.
Core supplies the explicit native `GitHistoryBackend`; Reader has no Core/Git dependency.
Successful native Deep validation also exposes the context on its public result.
Context construction is internal, and reuse through `Matches` checks the actual archive
SHA-256 and length as well as its typed identity. A different encoding with the same
declared identity cannot reuse the proof.

The context exposes `OriginalSnapshot`, frozen `OriginalHeader`, `BootstrapCommit`,
all `OriginalPaths`, copying `ReadOriginalEntry`, and `GetRelationship`. Relationship
translation accepts only the verified S0 or an actual retained commit, and checks every
intervening correspondence interval. Any partial declaration, including an overlapping
partial interval, prevents complete checkpoint proof. Passing the context to Reader's
`Resolve` enables the verified relationship; ordinary reads remain conservative.

`OriginalSnapshot.HasOriginalArchiveBytes` is false. The reconstructed state supplies
exact original files and semantic identity, but its synthetic ZIP digest is not evidence
of the old transport. S4 must not use that digest as proof of the original archive bytes
or claim reconstructed optional transport evidence.

## Validation

The final Release suite has 1,377 tests. Linux (.NET SDK 10.0.401, disposable Docker
copy with a read-only host mount) passed all 1,377, with zero failures or skips.
Windows (.NET SDK 10.0.300) passed all 1,377 tests with zero failures or skips in the
final run. Following the Windows-only reverse-index staging fix, Linux also passed
all 39 materialization tests again. The final packages were rebuilt and the external
consumer/installed-tool checks passed again. `git diff --check` is clean.

Installed local package checks passed: four package metadata/dependency inspections,
three isolated external consumers, both Core README examples, the new S3 API/backend
consumer and the installed tool's pack/materialize/append/Deep sequence. The history-free
proof passed 26 assertions, and the gated managed Git snapshot proof passed 12 assertions;
both reported zero Git invocations for eligible snapshots and zero failures.

The new materialization tests cover all four independent S1 bootstrap vectors (guide,
Unicode, ledger and delta review), exact canonical manifests/history/payloads and C0 IDs,
the exact S1 C1 ID, original files after append, repaired-object mutations, invalid
origin mappings, missing blobs, bundled snapshot/commit parent proof, exceptional-root
moves, partial interval preservation/overlap, unsupported append bases, reverse indexes,
resource/cancellation failures, destination preservation and final stream-copy failures.
CLI tests compare API output bytes and check option conflicts and absent input behavior.

The guide oracle produces C0 `sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9`
and the specified changed child `sha1-e8756a61892f4b6ce266f0622899ad562c65bed9`.
The S1 JSON oracle and fixtures were consumed unchanged; no fixture regeneration was
needed. Earlier development runs exposed stale implemented-update stub expectations,
one test-analyzer error and a resource-status enum typo; those were corrected. The first
expanded Windows run passed 1,376 tests and failed its reverse-index test because native
Git could not replace the staged index. Staging without that existing index fixes the
Windows creation conflict while preserving the validated output index and package identity.

From `src/generator-cli`, rerun:

```powershell
dotnet test -c Release --solution Mdpkg.slnx
dotnet pack -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

`verify-consumers.py` now also compiles a fresh PackageReference consumer exercising
materialization, append and Reader/backend origin reconstruction, and runs installed-tool
materialize/append/Deep validation. The existing snapshot path is checked with Git absent
or poisoned; the managed candidate proof remains restricted to its eligible one-commit
Git snapshot mode.

## Scope and review focus

Materialization, append and full Git/origin proof use native Git with existing isolation,
resource bounds and cancellation. Snapshot creation/validation never falls back to Git.
The managed single-commit verifier has not been generalized to arbitrary histories.
Normal Git validation retains its structural/declared assurance; `--deep` is required
for native history/origin proof. A successful structural read does not create a context.

General squash/truncate, browser history verification and S4 review authoring/correlation
are explicitly outside this implementation. Public packages were built and exercised
locally; this task does not publish a NuGet release. Review the independent bootstrap
proof, archive binding, partial-interval conservatism, ledger transition handling and
atomic publication before starting S4 against these contracts.
