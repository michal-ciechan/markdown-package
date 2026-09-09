# CARD-0035 review defect fixes

Review task `9f517b51` identified three defects in the pack/validate engine. Fix task
`29ea8839` addresses all three without changing ZIP publication, Git isolation,
cancellation, project boundaries, or the update/address placeholders.

## Changes

- `Commands/ReportDestination.cs` resolves linked paths and compares Windows volume
  plus 128-bit file IDs or Linux device plus inode IDs. The pack and validate command
  guards refuse report aliases before execution; pack also checks source files and
  correspondence input. Report publication rechecks safety and replaces a uniquely
  staged sibling instead of truncating an existing inode.
- `Engine/Validation/PackageValidator.cs` checks declared complete transitions
  against retained inventories and ledgers. Intermediate unknown records and missing
  correspondence for removed entities fail with `MDPK2007`; later confirmation
  does not retroactively substantiate an earlier transition.
- Commit parent headers are counted directly from bytes, stopping at the blank line.
  ISO-8859-1 author/message metadata survives import, including when normalization
  rewrites the tree and commit. Unchanged imports retain identical commit bytes/IDs.
- `ReviewRegressionTests.cs` adds 12 cases covering hard-linked input, source,
  correspondence and output reports; linked source/parent directories; replacement
  publication; forged aggregate and per-range completeness; missing removal evidence;
  and legacy metadata with and without commit rewriting.
- Both READMEs and `docs/spec/generator-cli.md` describe the corrected behavior.

## Verification

The review probe was rerun from the repository root:

```powershell
python -u .antiphon/review-9f517b51/probe.py
```

- Native fsck accepts the ISO-8859-1 fixture; import now exits 0. The probe's old
  “failed self-validation preserves destination” flag prints false because import
  now succeeds and correctly replaces its deliberately seeded `prior` destination.
- Hard-linked report validation exits 1 with an alias diagnostic; the source package
  remains byte-for-byte intact (`report destroyed package False`).
- The genuine partial package still imports successfully; the forged complete
  package exits 3 with `MDPK2007` identifying contradictory retained history evidence.
- The unrelated local-header probe remains accepted, as allowed by the central
  directory authority rule described in the original review.

Windows uses .NET SDK 10.0.300 and Git 2.50.1.windows.1. From `src/generator-cli`:

```powershell
dotnet build -c Release
dotnet test -c Release
```

The Release build completed with 0 warnings and 0 errors. The full Windows suite
passed: **815 passed, 0 failed, 0 skipped**. All 12 targeted regression cases also
passed in a separate run with 0 failures and 0 skips.

Linux was executed in a Docker Linux container with .NET SDK 10.0.401 and Git 2.43.0,
using `mcr.microsoft.com/dotnet/sdk:10.0` at image digest
`sha256:4ea6fe75dd36706bb6d8c3c293d4c4315840f5d76ea28ac97def77e3ec487fa5`.
The full Linux suite passed: **815 passed, 0 failed, 0 skipped**. Sources were mounted
read-only and copied into the container filesystem, excluding Windows build artifacts,
so Linux hard-link and symlink tests ran against native Linux storage.

Rerun from the Windows repository root:

```powershell
docker run --rm --mount 'type=bind,source=C:\src\markdown-package,target=/input,readonly' mcr.microsoft.com/dotnet/sdk:10.0 bash -lc 'set -euo pipefail; mkdir -p /work; tar -C /input --exclude=artifacts -cf - docs src/generator-cli | tar -C /work -xf -; cd /work/src/generator-cli; dotnet test -c Release'
```

Next: review these fixes and regressions before closing CARD-0035.
