# Card 0052 S2: typed schema and history-free snapshots

S2 implements the revised `markdown-package/1` schema across Reader, Core, CLI and
the Reviews declaration reader. Directory and memory creation default to history
mode `none`, emit a snapshot identity, and independently verify the completed ZIP
before publishing it. Explicit Git mode retains the existing Git implementation.

## Public contracts and behavior

- `PackageIdentity.Current` is `CurrentState(Kind, Id)`. Reader exposes
  `SnapshotHistory` and `GitHistory` through `PackageHistory`.
- Core requests have `History = HistoryMode.None` by default. Commit metadata is
  optional and permitted only in Git mode. `SnapshotPackageRequest` takes namespace
  and entries; the old metadata-bearing constructor is removed. Directory source
  selection (`CreationMode`) is separate from the output history mode.
- CLI `pack` defaults to `--history none`; `--from-git` defaults to Git unless an
  explicit incompatible `--history none` is supplied. Git-only options are rejected
  before publication. JSON returns typed current state, mode, assurance and whether
  the operation materialized history. Git-only snapshot checks are `not-applicable`.
- Selective `PackageArchive.OpenAsync` exposes declared identity. The explicit
  `VerifySnapshot` operation reads every current file within existing resource and
  cancellation limits, verifies the state digest, and reports `SnapshotVerified`.
  Core Full and Deep snapshot validation both perform this complete state check
  without a native Git process. Neither selective reads nor package-byte hashing
  imply complete state verification.
- The shared `Reader/Internal/Format/SnapshotHash.cs` implements spec section 4.1:
  exact stored bytes, UTF-8 path ordering, per-file byte length and SHA-256, canonical
  semantic header, explicit null fields and final LF. It incrementally hashes
  individual records without allocating the complete preimage. Ledger, review and
  non-Markdown file bytes participate; transport evidence, ZIP order/compression and
  empty directory records do not.
- One strict schema parser checks typed current/history combinations and declared
  reserved entries. Snapshots require complete addressing, authoritative ledgers and
  no Git/history entries. There is no old-wire parser or compatibility overload.
- File creation retains sibling staging, flush-to-disk, independent post-write
  validation and final replacement. Rejected input, budgets, warnings or cancellation
  preserve an existing file destination. As documented, failure during final copying
  to a caller-owned stream can leave a prefix and never returns success.

## Conformance and regression coverage

`DeferredSnapshotTests` consumes S1's checked-in
`docs/investigations/deferred-history/breaking-revision-vectors.json` directly:

- All four exact state vectors and both schema modes, plus directory/memory producer
  parity against the guide, Unicode and ledger vectors.
- All 15 identity mutations, including Markdown, ledger, review, non-Markdown,
  hidden paths, additions/deletions/renames, BOM, semantic header, transport evidence,
  empty directories, order and recompression.
- Snapshot/current/history mismatches, legacy string current, reserved extras,
  missing declared controls, invalid directory records and non-authoritative ledger
  content even when an attacker recalculates the state hash.
- Selective reads followed by explicit verification, resource budgets, cancellation,
  absent/poison Git, Git-only option rejection, and preservation of prior output.

Existing native/managed Git producer and malformed-history tests now request Git
explicitly. The original Git fixtures remain in use for those tests. The obsolete
browser wire fixture is an explicit rejection case; S5 owns replacing its writer.
The existing stream-copy failure/cancellation tests exercise both history modes.

Validation on .NET SDK 10.0.300:

| Check | Result |
| --- | --- |
| Full Release suite, Windows x64 | 1,310 passed; 0 failed; 0 skipped |
| Full Release suite, Linux x64 in SDK container | 1,310 passed; 0 failed; 0 skipped |
| Installed release history-free proof | 26 assertions; 0 failures; 0 Git invocations for snapshots |
| Installed private managed Git candidate proof | 12 assertions; 0 failures; 0 Git invocations for eligible Git snapshots |
| Isolated coordinated Reader/Core consumers | 2 consumers; 0 failures; snapshot creation/validation/reading without Git |
| Package/consumer inspection | 4 packages, 3 external consumers, 2 Core examples and installed-tool smoke; 0 failures |
| Global-tool installation proof | Version/help, pack, payload and Deep validation; 0 failures |

Local feeds are private build artifacts. No NuGet release was published. The normal
Windows/Linux CI build now runs the release history-free absent/poison-Git proof;
the existing separate managed candidate proof is preserved.

## Reproduction

From `src/generator-cli`:

```powershell
dotnet test -c Release --no-progress --output Normal
dotnet pack -c Release --no-build -o artifacts/package
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
python tests/prove-tool.py --local-feed artifacts/package
python tests/prove-libraries.py --local-feed artifacts/package
python tests/verify-consumers.py --local-feed artifacts/package
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

Linux was tested from a read-only host mount, copying `docs`, `src/generator-cli`
(excluding `artifacts`) and `src/web-viewer/tests/fixtures` into an isolated work
directory in `mcr.microsoft.com/dotnet/sdk:10.0`, then running the same Release suite.

## Review boundary and next slice

Review the shared hash/preimage, schema/inventory checks, declared versus verified
assurance, publication boundary and explicit Git regression coverage. The relevant
entry points are Reader's `PackageArchive` and `FormatValidation`, Core's public
contracts and internal builder/validator, and CLI's `PackCommand`/`EngineAction`.

S3 still owns bootstrap creation, original-state proof and real update orchestration.
S2 accepts structurally valid materialized declarations for selective/Full reading;
Deep origin verification explicitly fails as unavailable instead of certifying an
unverified origin. No original-state alias is provided. S4 owns full Reviews
verification providers; S5 owns browser schema/export changes; S6 owns integrated
release acceptance. These later capabilities are not included in S2.
