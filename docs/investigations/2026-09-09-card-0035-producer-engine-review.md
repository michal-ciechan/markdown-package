# CARD-0035 review of ff8bab5

Review verdict: changes required before closing CARD-0035. Three defects reproduced;
no implementation files changed.

## Findings, most severe first

1. **P1 — A report alias can destroy an input package while validation returns success.**
   `Commands/ValidateCommand.cs:24` compares path strings, but
   `Commands/EngineAction.cs:33` truncates the report target with `File.WriteAllText`.
   Create a hard link `report-alias.json` to a valid `normal.mdpkg`, then run
   `validate normal.mdpkg --report report-alias.json --format json`. Exit is 0;
   `normal.mdpkg` now contains the JSON report rather than ZIP bytes. Reproduced on
   Windows/NTFS using Python `os.link`. Pack's report guards also compare strings
   (`Commands/PackCommand.cs:72` onward), so the same design does not protect source
   or correspondence files from aliases. Make report publication and containment
   safe for filesystem aliases, including linked parent directories, and add an
   input-preservation regression. All reproduction files were owned review fixtures.

2. **P2 — Deep validation accepts complete correspondence contradicted by retained evidence.**
   `Engine/Validation/PackageValidator.cs:227` checks coverage range positions, but
   its historical-ledger checks at lines 247–251 never compare the evidence for each
   transition with the range's claimed coverage. Reproduction: import three commits
   with headings `Old`, `New`, `New`, supplying a confirmed retirement at the tip.
   Pack correctly emits a partial first transition and an intermediate tracked
   `unknown: unconfirmed-removal` record. Change only the manifest coverage and
   history sidecar to claim one complete range from root through tip. The unchanged
   Git pack still contains that intermediate unknown record. `validate --deep`
   returns 0, tier `conforming`, and all 23 reported checks pass. Check complete
   ranges against historical inventories/ledgers and preserve partial coverage when
   retained evidence contradicts the claim. This concerns shipped evidence, not
   proving whether upstream history was omitted.

3. **P2 — Valid legacy-encoded Git commit messages break import self-validation.**
   `Engine/Validation/PackageValidator.cs:238` strictly UTF-8-decodes the entire raw
   commit solely to count parent headers. A commit with `encoding ISO-8859-1` and
   message bytes `Caf\xe9`, containing a valid LF/UTF-8 Markdown blob, passes native
   `git fsck --full --strict` (exit 0). `pack --from-git` fails with exit 3/MDPK2007
   during mandatory deep self-validation. This contradicts the documented imported
   metadata preservation and the D-17 exclusion of binary Git storage. Parse ASCII
   structural headers without UTF-8-decoding author/message bytes. Add a legacy
   encoding regression and retain raw commit bytes when no rewrite is needed.

## Confirmed working and limits of verification

- Release build: 0 warnings, 0 errors. `dotnet test -c Release`: 803 passed,
  0 failed, 0 skipped, including the independent CommonMark/worked-example fixtures.
- Writer review: ZIP32 entry-count and extent checks reject all-ones sentinels;
  it emits no ZIP64 records. Total archive size is checked again before EOCD.
  Existing boundary and CRC/DEFLATE corruption tests passed. No multi-gigabyte
  allocation or archive was needed or attempted for this review.
- Package output uses a unique sibling file, flush, deep self-validation, cancellation
  check, then overwrite rename. Failure cleanup is in `finally`. The legacy-commit
  reproduction additionally verified that failed self-validation preserves an existing
  destination byte-for-byte. Existing active-cancellation/cleanup tests passed.
- Git uses `ProcessStartInfo.ArgumentList`, `UseShellExecute=false`, isolated output
  repositories and plumbing commands. The adapter clears inherited Git environment
  variables and disables global/system config, hooks, credentials, remote protocols,
  lazy fetch and replace refs. No source mutation or remote invocation was found.
- Engine results are records with an outcome; terminal output, report serialization
  and CLI exit mapping stay in the command/report layer. Reading a Git child's exit
  status inside the adapter is subprocess error handling, not CLI exit policy.
- Both READMEs and the tool reference correctly describe real pack/validate and
  retained update/address placeholders; the old hardcoded test-count claim is gone.
- Executed on Windows, .NET SDK 10.0.300, Git 2.50.1.windows.1. Linux is configured
  in CI but was not executed by this review; do not treat it as verified here.

## Reproduction artifacts

From `C:\src\markdown-package`, after the Release build:

```powershell
python -u .antiphon/review-9f517b51/probe.py
```

The rerunnable probe and fixture repositories/packages are under
`C:\src\markdown-package\.antiphon\review-9f517b51\`.
`results.txt` records the review run; per-case `*.stdout.json` and `*.stderr.txt`
record CLI results. `false-complete.mdpkg` is the accepted contradictory package.
The script also probes an incorrect non-manifest local-header size; that is not
listed as a defect because §3.4 makes the central directory authoritative and permits
incorrect local fields.

Next: fix the three defects, add targeted regressions, rerun the suite on Windows
and Linux, and request another review. No commit or push was made by this review.
