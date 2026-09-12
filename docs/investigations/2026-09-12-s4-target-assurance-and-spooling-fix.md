# S4 target assurance and bounded disk capture fix

Task: `8b936726`; reviewed baseline: `72d5037` on `master`.

Reviews now requires verification bound to the actual selected target, and Reader
derives snapshot scopes and archive evidence from one private disk capture. Full
review extraction uses the same bounded spool instead of buffering the archive in RAM.

## Defects and corrections

1. **A verified original authorized an unverified target.** Matching declared
   identities previously allowed altered target content to reach quote relocation.
   `ReviewResolver` now requires the selected target's `SnapshotVerified` assurance
   or a `VerifiedHistoryContext` matching its actual archive digest, length and typed
   identity. Failure preserves feedback with `NotChecked`, `NotResolved`,
   `VerificationUnavailable` and `target-source-unverified`, without a location.
   The existing original-source and bundled-context checks remain in place.
2. **Scopes and proof evidence could describe different caller bytes.** Default
   `PackageSnapshot.ReadAsync` parsed Markdown before hashing the caller stream.
   Every snapshot read now captures once before parsing; identity, documents,
   ledger, optional snapshot verification and archive digest use that capture.
   A caller mutation during capture cannot cause scopes and the digest to describe
   different captures. A Git proof for other captured bytes still cannot match.
3. **Verification required whole-archive RAM copies.** A shared internal
   `InputSpool.CaptureAsync` factors Reader's existing non-seekable spool pattern.
   Snapshot reads and full Reviews extraction now use this helper. It copies with
   a fixed 64 KiB buffer, enforces `MaxInputBytes` before writing beyond the limit,
   respects `TemporaryDirectory`, uses private create-new/delete-on-close files
   (owner read/write permissions on Unix), and disposes partial captures on failure
   or cancellation. Reads start at the caller's current position and leave it open.

The disk capture ends before `ReadAsync`/`ExtractAsync` returns. Returned scopes and
feedback own their data. This removes the mandatory whole-archive RAM copy; decoded
documents, ZIP metadata and other existing bounded allocations still consume RAM.
All snapshot reads now need temporary disk space, including seekable/default Git
reads. Default snapshots still have `Declared` assurance; capturing alone does not
verify their identity. Selective seekable `PackageArchive.OpenAsync` and structural
Reviews extraction retain their existing behavior.

No S3 origin/bootstrap/header proof logic, mode-specific required-check masks,
selector algorithms, authored kinds or feedback ordering changed. Unverified newer
target tests now expect the earlier target-assurance failure instead of a later
relationship failure; their no-location and current-ledger assertions remain.
Reader and Reviews READMEs document the target and resource contracts.

## Regression evidence

The supplied `S4ReviewProbeTests.cs` reproduced **3 failures / 6 passes** unchanged
on the baseline: both same-declared-identity target cases and the stream substitution
case. All nine pass after the fix. Target cases now additionally assert the explicit
assurance failure status and reason.

The stream probe originally assumed the first asynchronous read was hashing, after
synchronous scope parsing. Capture now correctly makes that read precede parsing.
Its assertion therefore tests the invariant: if the authentic proof matches, all
returned guide scopes must equal the authentic scopes; otherwise the injected scopes
must not match that proof. The original vulnerable implementation still fails this
assertion. This avoids requiring the repaired reader to retain injected content.

Thirteen new `CaptureTests` cover all three callers (declared snapshot, verified
snapshot, full Reviews), observing the disk file during reads, current-position
handling, snapshot assurance and owned results, incremental byte-limit rejection,
I/O failure, cancellation, caller ownership and cleanup. A 200,000-byte capture
checks byte-for-byte preservation, a real `FileStream`, and read buffers no larger
than 64 KiB. Unix tests check owner-only spool permissions. Existing non-seekable
Reader tests exercise the factored helper too.

Validation:

- Focused Reviews suite: **186 passed, 0 failed, 0 skipped**.
- Linux Release, .NET SDK 10.0.401: **1,446 passed, 0 failed, 0 skipped**.
- Windows Release, .NET SDK 10.0.300: **1,446 passed, 0 failed, 0 skipped**.
- Installed history-free proof: **26 assertions passed, 0 failures**, with **0 Git
  invocations** for eligible snapshots.
- Installed managed-Git candidate proof: **12 assertions passed, 0 failures**, with
  **0 Git invocations** for eligible snapshots.
- Freshly packed coordinated preview.3 packages: **4 inspected**, **3 isolated
  external consumers passed**, **2 Core README examples passed**, Reviews' explicit
  native-bridge example passed, and installed-tool pack/materialize/append/deep
  validation passed; **0 failures**. Reviews and Reader consumers ran without Git.

The full-suite count is the prior 1,424 plus the nine supplied review probes and
13 new capture cases. A preliminary post-fix Reviews run had nine failures from old
unverified-target status expectations; those assertions now check the earlier
assurance gate. No assertion permitting a resolved location was relaxed.
Local command logs are under `.antiphon/8b936726-*.log` (ignored scratch evidence).
`git diff --check` passed. The supplied probe, new capture tests and production/docs
changes are included together in the fix commit.

## Rerun

From `C:\src\markdown-package\src\generator-cli`:

```powershell
dotnet test -c Release --solution Mdpkg.slnx
dotnet pack -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

The Linux run uses `mcr.microsoft.com/dotnet/sdk:10.0` with a read-only host mount,
copies `docs`, `LICENSE`, generator sources and viewer test fixtures into `/work`,
then runs the same Release solution command in the disposable copy. Build outputs
and caches remain outside the mounted checkout. No package publication is involved.

Review focus: selected-target proof binding, the scope/digest capture invariant,
bounded spool ownership and cleanup, and unchanged S2/S3/S4 regression behavior.
