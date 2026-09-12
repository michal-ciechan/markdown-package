# CARD-0052 S2 review fixes

The three reproductions from review 928e83da are corrected. The changes are limited
to Git semantic verification, the Reader checkpoint gate, and their regression
tests/documentation. Snapshot hashing, schema parsing, ZIP publication and the
history-free capture path are unchanged.

## Changes

1. `CommitProtocol` examines the exact first message line as ASCII bytes, without
   decoding legacy commit metadata. Both native Deep verification and the managed
   Git snapshot verifier reject `mdpkg-bootstrap-v1` until a verified origin can be
   established. Native verification checks every retained commit, including a
   marker hidden in a non-root child. Deleting `origin` and relabeling the root
   `original` or `synthetic` cannot produce `GitVerified`. A later message line or
   a first-line suffix is not the reserved marker. Creation using the reserved
   message fails independent post-write verification and preserves the destination.
2. `PackageSnapshot.Resolve` applies the checkpoint gate before ledger/digest
   matching whenever the reviewed identity differs from current. Snapshot targets
   return `Unconfirmed/history-unavailable`; Git targets with a snapshot checkpoint
   return `origin-unverified` or `origin-unavailable`; differing commit checkpoints
   return `history-required`. Equality still permits ordinary current resolution.
   Remembering that an origin is declared does not verify it or decode the pack.
3. Native Deep validation permits multiple commits in delta review histories. It
   verifies that retained trees contain only the review document, and retains all
   existing Git graph, coverage, byte equality and bundled-parent checks. A
   historical non-review file cannot be hidden merely by removing it from current.

The Git verification scope follows S2's existing API distinction: native Deep and
managed Git verification inspect commit objects. Core `ValidationLevel.Full`
without `--deep` remains structural for Git history and reports declared identity;
it does not certify retained messages or origin proof. Extending that non-Deep path
to decode arbitrary Git commits without Git is not included here. Origin proof and
checkpoint relationship providers remain S3/S4 work.

Nine older Reviews expectations relied on cross-checkpoint resolution without a
verified relationship. They now assert an unconfirmed result and no guessed
location; direct current-identity assertions preserve ledger/digest/retirement
coverage. The quote relocation implementation is unchanged and is not invoked past
an unverified checkpoint. Current at-less loose-reference coverage still passes.

## Reproductions and validation

The review's existing artifacts were run directly:

| Artifact | Corrected outcome |
| --- | --- |
| `.antiphon/task-928e83da-stripped-origin.mdpkg`, CLI `validate --deep` | Exit 3, MDPK4002 reserved-bootstrap diagnostic, assurance `declared` |
| `.antiphon/task-928e83da-two-commit-delta.mdpkg`, CLI `validate --deep` | Exit 0, assurance `git-verified` |
| `.antiphon/task-928e83da-probe` | Snapshot: `Unconfirmed/history-unavailable`; materialized Git: `Unconfirmed/origin-unverified` |

Portable regressions recreate the archives from checked-in S1 fixtures and native
Git; they do not depend on ignored `.antiphon` artifacts. There are 22 additional
cases covering all three failures, both Git verifiers, near-marker controls,
publication failure, differing state kinds, missing/declared origin and current
identity equality.

Final Release validation uses .NET SDK 10.0.300 on Windows and 10.0.401 on Linux:

- Windows x64: 1,332 tests passed, 0 failed, 0 skipped.
- Linux x64 SDK container: 1,332 tests passed, 0 failed, 0 skipped.
- Installed history-free proof on Windows and Linux: 26 assertions each, 0 failures.
- Installed managed Git candidate proof on Windows and Linux: 12 assertions each, 0 failures.
- Both installed proofs retain zero Git invocations for eligible snapshots.

From `src/generator-cli`, rerun:

```powershell
dotnet test -c Release --no-progress --output Normal
dotnet pack -c Release --no-build -o artifacts/package
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

Linux checks use `mcr.microsoft.com/dotnet/sdk:10.0`, a read-only host mount and an
isolated copy of the source and fixture directories. Local feeds are private build
artifacts; no NuGet publication is performed.

Next: review these fixes against 928e83da, including the explicit validation-level
boundary and conservative cross-checkpoint behavior, then resume S3/S4.
