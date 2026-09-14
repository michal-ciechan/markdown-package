# mdpkg local global-tool delivery — 9474e409

The `mdpkg` **0.1.0-preview.3** package built and installed successfully from a
local-only feed. The installed global shim packed real Markdown into a conforming
CARD-0052 typed snapshot, deep-validated it, produced/deep-validated Git output,
and materialized the snapshot. Nothing was published to NuGet.org or landed.

Original Code task and landing owner: `9474e409`. Restart: **none**.
Branch: `feat/task-9474e409-mdpkg-tool`.
Exact worktree: `C:\src\markdown-package`.
Build, package and ordinary checks verified commit
`0a8302099afb3e001128133a2ea24deddf665ff6`; the subsequent commit records evidence
only. Base was `3a6637f`.
Plan: [bounded delivery and verification design](../superpowers/plans/2026-09-14-mdpkg-tool-local-delivery.md).

## Changes

The existing CLI project and imported `Mdpkg.Pack.props` already provide
PackAsTool, command/package ID `mdpkg`, version, authors, description, MIT license,
repository URL and tags. The local tool verifier now checks all requested
metadata and six bundled DLLs, the tool entry point, CRCs, stored first manifest,
typed current/history, addressing profiles and absence of snapshot Git/history
entries. Optional `--evidence-dir` retains input, archives, manifest, command
results, validation JSON and SHA-256 provenance.

Root README, packaged CLI README, CLI reference and release guide now explain
public preview installation, local delivery, source-directory usage, CI's local
gate and human-operated publication. The coordinated version remains a preview;
unversioned `dotnet tool install --global mdpkg` selects a stable release when
one exists.

## Ordinary results

All commands completed in the foreground. No timeouts, assertions or retry
policies in existing tests were changed. No deliberate mutants were executed.

| ID | Actual outcome | Evidence under `.antiphon/task-9474e409/` |
| --- | --- | --- |
| V-1 | Release build succeeded; 4 projects; 0 warnings, 0 errors; 11.53 seconds. | `build.log`, `verified-commit.txt` |
| V-2 | One nupkg created; metadata, notices, entry point and bundled dependencies passed. 757,724 bytes. | `pack.log`, `mdpkg.nuspec`, `DotnetToolSettings.xml`, `feed/SHA256SUMS` |
| V-3 | Local-only global install and 8 subsequent commands passed (9 commands total); real UTF-8 Markdown, typed snapshot, explicit Git and materialization passed. Temporary global installation removed. | `tool-proof.log`, `tool-proof/proof.json`, `tool-proof/manifest.json`, three archives |
| V-4 | Four install/release documents and their local links checked; preview version/manual push agree; diff check clean. | `docs-check.log`, `diff-check.log` |
| R-1 | Unit classes: 57 passed, 0 failed/skipped. | Shared `ordinary.trx`, `tests.log`, `trx-summary.json` |
| R-2 | Affected integration classes: 24 passed, 0 failed/skipped. | Same command/TRX as R-1 |
| R-3 | Existing invocation without evidence option passed another local global-install/use cycle; 0 failures. | `tool-default.log` |

Fresh TRX starts `2026-09-14T21:42:41.3483298+00:00`, after this task's recorded
test start. All **32 expected methods**, expanded to **81 cases**, appear with
nonzero counts and passing outcomes; no unintended class is present.

| Filter (`-class` for each fully qualified name) | Expanded passed cases |
| --- | ---: |
| `Mdpkg.Cli.Tests.HelpTests` | 8 |
| `Mdpkg.Cli.Tests.OptionValidationTests` | 46 |
| `Mdpkg.Cli.Tests.SpecConsistencyTests` | 3 |
| `Mdpkg.Cli.Tests.HistoryModeTests` | 9 |
| `Mdpkg.Cli.Tests.ProducerTests` | 3 |
| `Mdpkg.Cli.Tests.ApiParityTests` | 4 |
| `Mdpkg.Cli.Tests.UpdateTests` | 8 |

The test runner reported 12.718 seconds. No namespace/full-assembly run was used.
The direct xUnit runner supports `-class` and `-result-trx`; this repository does
not have Antiphon's TUnit `--treenode-filter` or `docs/testing-and-build.md`.

The external evidence audit initially hit Python 3.10's inability to parse .NET's
seven-digit timestamps and an incorrect raw-byte comparison between retained
Windows CRLF input and the required LF archive content. The audit now parses
microseconds and checks the format's specified LF normalization. Its final pass
also verifies package/archives hashes, packaged README equality, source commit,
installed version and removal of the temporary install home. These were audit
harness errors; the product and ordinary test runs had no failures.

## Reproduction and delivery

From `C:\src\markdown-package`, using a fresh task evidence directory:

```powershell
dotnet build src/generator-cli/tests/Mdpkg.Cli.Tests/Mdpkg.Cli.Tests.csproj -c Release --property:OutputPath=bin-9474e409/ --artifacts-path C:/src/markdown-package/.antiphon/task-9474e409/build
dotnet pack src/generator-cli/src/Mdpkg.Cli/Mdpkg.Cli.csproj --no-build -c Release --property:OutputPath=bin-9474e409/ --artifacts-path C:/src/markdown-package/.antiphon/task-9474e409/build -o C:/src/markdown-package/.antiphon/task-9474e409/feed
dotnet src/generator-cli/tests/Mdpkg.Cli.Tests/bin-9474e409/Mdpkg.Cli.Tests.dll -class Mdpkg.Cli.Tests.HelpTests -class Mdpkg.Cli.Tests.OptionValidationTests -class Mdpkg.Cli.Tests.SpecConsistencyTests -class Mdpkg.Cli.Tests.HistoryModeTests -class Mdpkg.Cli.Tests.ProducerTests -class Mdpkg.Cli.Tests.ApiParityTests -class Mdpkg.Cli.Tests.UpdateTests -preEnumerateTheories -noColor -result-trx C:/src/markdown-package/.antiphon/task-9474e409/ordinary.trx
python src/generator-cli/tests/prove-tool.py --local-feed .antiphon/task-9474e409/feed --evidence-dir .antiphon/task-9474e409/tool-proof
python src/generator-cli/tests/prove-tool.py --local-feed .antiphon/task-9474e409/feed
```

The alternate build directories are removed after the run; the package and proof
remain at these absolute paths:

- Package: `C:\src\markdown-package\.antiphon\task-9474e409\feed\mdpkg.0.1.0-preview.3.nupkg`
- Evidence: `C:\src\markdown-package\.antiphon\task-9474e409\`
- Real generated snapshot: `C:\src\markdown-package\.antiphon\task-9474e409\tool-proof\proof.mdpkg`
- Evidence audit script: `C:\src\markdown-package\.antiphon\task-9474e409\audit-evidence.py`

Cleanup used `dotnet clean` with the same isolated output properties, followed
by removal of one untracked runner DLL and the four empty `bin-9474e409`
directories. The ignored intermediate/publish tree remains inside the evidence
root; no daemon output was touched. See `clean.log` and `removed-build-paths.txt`.

Package SHA-256:
`da0e2e964d183203069508a3fa473af4c486e8edb6973513314591a69de2e8e7`.

After ordinary Review and release approval, the owner may run this exact
PowerShell command with their own `NUGET_API_KEY` environment variable:

```powershell
dotnet nuget push "C:\src\markdown-package\.antiphon\task-9474e409\feed\mdpkg.0.1.0-preview.3.nupkg" --source https://api.nuget.org/v3/index.json --api-key $env:NUGET_API_KEY
```

This command was **not executed**. Public availability/indexing of this version
was not checked. The existing publishing workflow triggers on master; the task
branch was pushed without landing or dispatching that workflow.

## Remaining verification obligation

**Zero PC-n rows or variants** are specified; none were run. Post-land
SourceLanding Mutation still owns missing-control discovery, including the
Python package verifier and optional evidence retention. The caller must record
that companion obligation and explicitly commission it after landing original
Code task `9474e409`.

Coverage gaps: this task ran on Windows only; the existing CI matrix covers Linux
but was not run here. No public-feed acceptance was attempted. Optional evidence
failure paths (for example a pre-existing evidence directory) lack dedicated
automated controls. No changes to production logic needed broader native,
browser, persistence or library-publication coverage.

Next: ordinary read-only **Review**. Restart: **none**. Original landing owner:
**9474e409**. No land or deployment authorization is part of this handoff.
