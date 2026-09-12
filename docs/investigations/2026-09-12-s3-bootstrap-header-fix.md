# S3 bootstrap current-header binding

Review task 98ca1da3 found that Deep validation accepted changes to C0's current
semantic declarations while still verifying the frozen S0 header independently.
The supplied probes reproduced both bypasses: retargeting a delta review and
changing addressing coverage returned Success instead of Nonconforming.

`OriginVerifier` now compares the canonical bytes of the current semantic header
with `origin.header` when current equals `origin.commit`. A mismatch produces
MDPK4002, declared assurance and no verified history context. The existing
`SnapshotHash.Header` projection excludes `review.of.packageDigest`, `packageBytes`
and `dispatch`, so evidence-only edits remain permitted. The comparison does not
apply to a genuine successor; C1 may change its declarations while the origin
header stays frozen. No other production behavior was changed.

The previously uncommitted `S3ReviewProbeTests.cs` is retained in this change.
Its original six cases reproduced two failures before the fix. Assertions now
also check that rejected headers cannot return verified assurance or context.
Four positive cases cover the three evidence exclusions and a real C0-to-C1
review retargeting with an unchanged tree. All ten focused cases pass.

Installed-package checks passed with zero failures: 26 history-free assertions,
12 managed-Git candidate assertions, four package inspections, three isolated
external consumers, both Core README examples and the installed tool's
pack/materialize/append/Deep sequence. Both snapshot proofs reported zero native
Git invocations for eligible snapshots. The full Windows Release suite passed
all 1,387 tests with zero failures or skips (4m 01s). `git diff --check` passed.

Rerun from `src/generator-cli`:

```powershell
dotnet test -c Release --solution Mdpkg.slnx
dotnet pack -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

Review focus: confirm that only C0 requires equality, that rejected headers never
produce proof, and that semantic changes on C1 and evidence-only changes on C0
remain valid. Structural Git validation retains its existing assurance limits;
this fix applies to full native history/origin verification through Deep validation.
