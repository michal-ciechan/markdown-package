# mdpkg local tool delivery — task 9474e409

Original Code task / landing owner: `9474e409`.
Base: `3a6637f` on `master`. Worktree: `C:/src/markdown-package`.
Branch: `feat/task-9474e409-mdpkg-tool`. Restart: none.

The brief requests a locally verified global tool and documentation, with manual
NuGet publication left to the owner. The landed CARD-0036 foundation already sets
`PackAsTool`, `PackageId=mdpkg`, `ToolCommandName=mdpkg`, and imports version,
authors, MIT license, repository and tags from `Mdpkg.Pack.props`. Retain its
coordinated `0.1.0-preview.3` version and CARD-0052 draft-2 behavior. No production
logic or package version change is needed.

Complete the remaining delivery work by checking all requested package metadata
in the installed-tool gate, retaining optional reproducible proof artifacts,
checking the archive's typed manifest and stored first member, and documenting
public installation plus local verification and a manual push. Global installation
uses a temporary CLI home and fresh caches with the local feed as its only source.
The real Markdown input is a file inside the CLI's required source directory.

## Ordinary verification design

This repository has xUnit/Microsoft.Testing.Platform, not Antiphon/TUnit, and no
`docs/testing-and-build.md`. Use its supported exact class filters and fresh TRX.
Build the affected CLI test project and its production dependencies once in
Release with `--property:OutputPath=bin-9474e409/` and an isolated artifacts path.
Pack using that output and `--no-build`. Remove producer-owned `bin-9474e409`
directories after verification; retain the feed and evidence under
`.antiphon/task-9474e409/`.

| ID | Obligation / coverage-to-class list | Expected cost |
| --- | --- | --- |
| V-1 | Restore/build CLI tests and CLI/Core/Reader dependencies, zero warnings/errors. | 1–3 minutes |
| V-2 | Pack `mdpkg`; inspect ID/version/authors/description/license/repository/tags, notices, tool settings and bundled dependencies in `prove-tool.py`. | Under 1 minute |
| V-3 | Local-only global install, registration, version/help, real Markdown pack, CRC/content/typed manifest, full snapshot validation, explicit Git pack/deep validation and materialization; retain proof JSON and archives. | 1–2 minutes |
| V-4 | Root README, packaged CLI README, CLI reference and release guide agree on preview installation and manual publication; `git diff --check`. | Under 1 minute |
| R-1 | Unit coverage: `Mdpkg.Cli.Tests.HelpTests`, `OptionValidationTests`, `SpecConsistencyTests`. Expand every theory row and inspect TRX for all intended classes/methods and nonzero counts. | Under 1 minute |
| R-2 | Affected integration coverage: `Mdpkg.Cli.Tests.HistoryModeTests`, `ProducerTests`, `ApiParityTests`, `UpdateTests`. Protect pack/validate reports, typed identity, native Git, materialization and API parity. Inspect fresh TRX for all intended classes/methods and nonzero counts. | 1–2 minutes |
| R-3 | Existing default verifier invocation without `--evidence-dir` still completes local global install/use and cleans its temporary home. | 1–2 minutes |

R-1 and R-2 may share one command selecting exactly the seven named classes;
report actual expanded per-class counts. No namespace or full-assembly run is
authorized by this plan; there are no unbounded classes. No tests of unrelated
browser, persistence, library publication or snapshot-candidate behavior are needed.

## Mutation and handoff

Zero deliberate PC rows/variants are specified: no production behavior changes.
No mutants are executed in Code. Missing-control discovery, including scrutiny of
the Python package gate and evidence retention, belongs to post-land SourceLanding
Mutation even with zero PCs. Current ordinary coverage is Windows only; Linux
global installation remains covered by the existing CI matrix, not this local run.
Public-feed acceptance and publication remain outside this task.

Commit/push each meaningful slice and the final ordinary-tested state. Next is
ordinary read-only Review, then the caller lands original Code task `9474e409`
and separately commissions SourceLanding Mutation. Do not land, deploy, invoke
the publishing workflow or run `dotnet nuget push` during this task.
