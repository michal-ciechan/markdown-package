# mdpkg generator CLI

This source targets **draft 2**, the breaking `markdown-package/1` revision in
**0.1.0-preview.3**. Typed state and history modes replace the earlier string-valued
manifest; there is no compatibility parser. Use a fresh local package feed until
the coordinated public release gate succeeds. The older preview.2 publication
does not establish acceptance of this revision.

`pack` creates history-free `.mdpkg` snapshots by default. `validate` hashes every
current file and verifies the snapshot identity without Git. In explicit Git mode,
`validate --deep` additionally proves the repository, current tree and any origin. `update --materialize` emits deterministic bootstrap history;
`update --tree ... --message ...` appends to a supported lineage, materializing a
snapshot base first. General transforms and `address` remain exit-70 placeholders.
An internal managed snapshot candidate is implemented but **not enabled in release
builds**. Cross-file blob deltas close the original size gap on the measured large
and similar-file corpora. The [delta report](../../docs/investigations/2026-09-12-card-0050-managed-delta-results.md)
records the new measurements and the remaining acceptance work. Ordinary
`pack` defaults to history-free output and requires no Git. Explicit Git output,
materialization and append retain the existing native/candidate backend policy.
The [format specification](https://github.com/michal-ciechan/markdown-package/blob/master/docs/spec.md) governs the bytes; the
[tool reference](https://github.com/michal-ciechan/markdown-package/blob/master/docs/spec/generator-cli.md) documents commands and diagnostics.

## Install from NuGet.org

The following installation command applies after the preview.3 public-feed gate
succeeds. For local acceptance, add `--add-source artifacts/package` and use an
isolated `--tool-path` instead of `-g`. Snapshot operations require .NET 10; Git is
required for explicit Git operations:

```powershell
dotnet tool install -g mdpkg --version 0.1.0-preview.3 --source https://api.nuget.org/v3/index.json
mdpkg --version
mdpkg pack ./my-docs --out ./my-docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
mdpkg validate ./my-docs.mdpkg --deep --format json
```

Create `my-docs` with your Markdown files first; output must be outside that directory.
Choose a new lowercase UUID for your own lineage. Add the global tool directory to
PATH if needed: `$HOME/.dotnet/tools` on Linux/macOS or `%USERPROFILE%\.dotnet\tools`
on Windows. To update previews, use `dotnet tool update -g mdpkg --prerelease`;
to uninstall, `dotnet tool uninstall -g mdpkg`. `dotnet tool install -g mdpkg`
selects the latest stable release when one exists.

The package is MIT licensed and includes the Unicode data notice. Maintainers:
see the [release guide](https://github.com/michal-ciechan/markdown-package/blob/master/docs/releases/mdpkg.md)
for the shared version, Trusted Publishing policy and public-feed acceptance gate.

## Build and run

Requires .NET 10 (SDK selected by `global.json`); the complete test suite also needs
Git on PATH. From this directory:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
dotnet run --project src/Mdpkg.Cli -- pack ../../examples/guide-and-notes --out guide.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
dotnet run --project src/Mdpkg.Cli -- validate guide.mdpkg --deep --format json
```

Build output goes under the ignored `artifacts/` directory. The executable is
`artifacts/bin/Mdpkg.Cli/release/mdpkg.exe` on Windows, or `mdpkg` on Linux.
These source commands also work before the first public release.

## Implemented behavior

- Snapshot creation or committed first-parent Git import (`--from-git`). `--scope`
  uses Git pathspecs; `--depth` retains the requested tail with a synthetic root.
- Strict UTF-8 with BOM preservation, CRLF/lone-CR normalization, reserved-path
  checks, Unicode 17 NFC plus simple-fold uniqueness, and link/submodule rejection.
- CommonMark 0.31.2 inventories: document, permanent preamble, top-level ATX/Setext
  sections, exact source trails, duplicate occurrences, default roots and scoped digests.
- Canonical manifest/history/ledger JSON. `--correspondence` takes a JSON array of
  producer-confirmed records; unconfirmed removals retain unknown roots and partial
  coverage. Reserved-slot births mint fresh roots. Empty ledgers are omitted.
- Isolated native Git plumbing, one packed repository and index, optional reverse
  index, controlled ZIP32 headers, real compression levels 0–9 and optional descriptors.
- Shared structural/content validation, CRC and full DEFLATE checks, history/evidence
  agreement, and optional deep Git/tree validation, including complete correspondence
  claims checked against retained inventories and ledgers. `pack` runs deep validation before
  replacing the destination with its staged sibling file.
- Existing exit/JSON/report contracts. Warning promotion and `--require-complete`
  fail before output publication. Failures and cancellation clean staging and preserve
  an existing destination. `--accept-recoverable` reports tier 2 but still exits 3.

Explicit Git-mode initial commit metadata is fixed for repeatability; imported author/committer/message bytes
are retained, including legacy non-UTF-8 encodings, with signatures removed when their
signed commits change. UTF-8 requirements apply to document blobs and package JSON,
not verbatim Git commit metadata. Outputs are
repeatable for a fixed tool/runtime/Git version except when random birth roots are minted.
Git source IDs are provenance and can change under LF normalization or projection.

The source is read only. Output must be outside its directory. Reports must also be
outside source and cannot alias source files, correspondence input, or package input/output.
Windows and Linux checks resolve linked directories and compare file identities to detect
hard links. Unsafe report destinations fail before execution (exit 1); safety is rechecked
before report publication, which replaces the destination without truncating linked bytes.
Snapshot mode ignores
its exact root `.git` entry; Git mode reads committed HEAD, ignoring working-tree edits.
Paths containing colons/control characters and symlinks/reparse points are rejected.
Review-package authoring is outside `pack`; it needs a review manifest. SHA-256 object
format, ZIP64, general squash/truncate and address editing are not implemented. Payloads are buffered
in memory, with an individual-entry limit of `Int32.MaxValue`; native Git and temporary
disk space are required for Git operations. Snapshot creation/validation needs no Git.
See tool-reference §12 for complete policy details.

## Internal layout

The eight-project solution contains CLI, Core, Reader, Reviews and a test project for
each. `Mdpkg.Cli -> Mdpkg.Core -> Mdpkg.Reader`; `Mdpkg.Reviews -> Mdpkg.Reader`.
Core owns source staging, native Git, ZIP emission, ledger evolution and full/deep
validation. CLI owns arguments, correspondence-file I/O, report alias checks,
terminal output, JSON mapping and exit codes. It uses only the public Core API.
Reader owns bounded ZIP access, canonical parsing, Unicode paths, inventories and
ledger interpretation; Reviews owns review schemas, correlation and resolution.
Reader/Reviews retain independent use without native Git.

```text
src/Mdpkg.Cli/       Commands/ and Reporting/
src/Mdpkg.Core/      public creation/validation API; Internal/{Sources,Git,Addressing,Container,Validation,IO}
src/Mdpkg.Reader/    bounded reading, format and addressing
src/Mdpkg.Reviews/   review extraction and resolution
tests/              Mdpkg.Cli.Tests, Mdpkg.Core.Tests, Mdpkg.Reader.Tests, Mdpkg.Reviews.Tests
```

See the [Core README](src/Mdpkg.Core/README.md) for compiled directory/memory examples,
typed failures, stream ownership, resource limits and deterministic metadata. Core
pins Reader's coordinated package version exactly because it uses Reader internals.
CLI explicitly selects the producer compatibility resource profile; public Core APIs
default to Reader service limits. Full validation uses indexed member reads while
retaining current-view payloads for inventory checks; it is not constant-memory streaming.

Dependencies are centrally pinned: System.CommandLine 2.0.12 (MIT), Markdig 1.3.2
(BSD-2-Clause), and SharpZipLib 1.4.2 (MIT). The writer uses .NET's numeric zlib
compression options; SharpZipLib's inflater exposes completion and remaining input
so truncated/trailing DEFLATE payloads cannot silently pass. The Unicode table is
ported from the viewer with its license in `src/Mdpkg.Reader/Internal/Sources/UNICODE-LICENSE.txt`.

## Tests and CI

CLI tests cover verbs, options, reports/exits, hard-link safety and API parity. Core
tests cover recorded Git IDs and ZIP layout, history/deep checks, source/stream
creation, limits, immutable data, warning policy, copy failures and cleanup. Reader
owns pure path/parser/ledger assertions and the independent CommonMark fixture;
Reviews owns schemas, correlation and selectors. The runner prints current counts.

The Windows/Linux workflow restores, builds, tests and packs all four products. The
isolated consumer verifier checks exact dependencies, notices, XML docs/symbols,
Reader/Reviews without Git, both Core README examples and an installed-tool smoke.
Run the local package gate from this directory:

```powershell
dotnet pack src/Mdpkg.Reader --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Core --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Reviews --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Cli --no-build -c Release -o artifacts/package
python tests/verify-consumers.py
node ../../docs/spec/review-fixtures/verify-unicode.mjs
```

All four packages take their coordinated version and MIT metadata from `Mdpkg.Pack.props`.
`publish-nuget.yml` publishes Reader, Core, then `mdpkg`; Reviews stays local.
The tool bundles Core/Reader and runtime dependencies, so it does not need
those libraries published separately. No invariant-globalization setting is enabled.

For the release-specific local gates (isolated consumers and a temporary global install):

```powershell
dotnet pack src/Mdpkg.Reader -c Release -o artifacts/release
dotnet pack src/Mdpkg.Core -c Release -o artifacts/release
dotnet pack src/Mdpkg.Cli -c Release -o artifacts/release
python tests/prove-libraries.py --local-feed artifacts/release
python tests/prove-tool.py --local-feed artifacts/release
```

The public proof uses `python tests/prove-tool.py --attempts 20 --retry-delay 180`:
nuget.org alone, fresh caches, exact version, installed global shim, real pack and
deep validate. The library matrix entry runs `python tests/prove-libraries.py
--attempts 20 --retry-delay 180` to restore the exact Core/Reader versions, create,
fully validate a default snapshot and read it without Git. Both passing entries establish release
completion; see the [release guide](../../docs/releases/mdpkg.md).

## Integrated draft-2 acceptance

The acceptance driver creates fresh CLI inputs, authors and downloads actual browser
reviews, validates them through CLI/Core/Reviews, then materializes and appends a
successor and checks origin-aware resolution. It also rejects repaired-CRC feedback
tampering. This uses both history modes under the same schema.

From the repository root, after building dependencies and installing Playwright:

```powershell
python src/generator-cli/tests/prove-deferred-history.py --work .antiphon/integrated-acceptance
```

`--prepare-only` and `--verify-only` split the native and browser phases when using
the Linux Playwright image. Set `MDPKG_ACCEPTANCE_DIR` to the shared output directory
for `npx playwright test tests/integration.spec.js --project=chromium` in the viewer.
