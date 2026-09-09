# mdpkg generator CLI

`pack` creates real `.mdpkg` packages. `validate` checks them, and `validate --deep`
verifies the curated repository with native Git and compares every current-view file
with its tip-tree blob. `update` and `address` remain explicit exit-70 placeholders.
The [format specification](../../docs/spec.md) governs the bytes; the
[tool reference](../../docs/spec/generator-cli.md) documents commands and diagnostics.

## Build and run

Requires .NET 10 (SDK selected by `global.json`) and Git on PATH. From this directory:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
dotnet run --project src/Mdpkg.Cli -- pack ../../examples/guide-and-notes --out guide.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
dotnet run --project src/Mdpkg.Cli -- validate guide.mdpkg --deep --format json
```

Build output goes under the ignored `artifacts/` directory. The executable is
`artifacts/bin/Mdpkg.Cli/release/mdpkg.exe` on Windows, or `mdpkg` on Linux.
Distribution, versioning and publishing are separate work; no public-feed installation
is required for these commands.

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

Snapshot metadata is fixed for repeatability; imported author/committer/message bytes
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
format, ZIP64, update/squash and address editing are not implemented. Payloads are buffered
in memory, with an individual-entry limit of `Int32.MaxValue`; native Git and temporary
disk space are prerequisites. See tool-reference §12 for complete policy details.

## Internal layout

The solution contains the producer CLI plus two read-only libraries. `Mdpkg.Reader` owns
bounded ZIP reading, canonical format/diagnostic definitions, Unicode paths, CommonMark
scopes and ledger interpretation. `Mdpkg.Reviews` depends only on Reader and provides
review extraction, correlation and selector resolution. Both pack as local preview NuGet
artifacts; see their packed READMEs and `examples/review-consumer` for the external API.
Creation/Git/ZIP writing and full validation orchestration remain inside the executable
pending the separate Core extraction. CLI references Reader directly; it does not depend
on Reviews. Engine results remain separate from command exit codes and terminal reporting.

```text
src/Mdpkg.Cli/
  Commands/          System.CommandLine verbs and engine/result adapters
  Reporting/         CLI result JSON and diagnostic vocabulary
  Engine/
    Sources/         strict source staging and Unicode path checks
    Git/             isolated subprocess adapter and repository plumbing
    Addressing/      writer-side sparse-ledger evolution
    Container/       ZIP32 writer (reading delegates to Reader)
    Validation/      shared conformance and deep Git checks
    IO/              owned temporary directories
    PackageBuilder.cs
```

Dependencies are centrally pinned: System.CommandLine 2.0.12 (MIT), Markdig 1.3.2
(BSD-2-Clause), and SharpZipLib 1.4.2 (MIT). The writer uses .NET's numeric zlib
compression options; SharpZipLib's inflater exposes completion and remaining input
so truncated/trailing DEFLATE payloads cannot silently pass. The Unicode table is
ported from the viewer with its license in `Engine/Sources/UNICODE-LICENSE.txt`.

## Tests and CI

Tests run in `tests/Mdpkg.Cli.Tests/`. They cover recorded worked-example Git IDs,
roots/digests and layout, real pack/import/deep-validation paths, CommonMark source
boundaries, sparse ledger rules, Unicode paths, normalization, malformed containers,
CRC/DEFLATE failures, history consistency, failure cleanup, and CLI reports/exits.
`SpecConsistencyTests` checks the reference's verb, exit-code and diagnostic tables.
The test runner prints the current counts; no count is hardcoded here.

The generator workflow restores, builds and tests on Windows and Linux. Its existing
artifact packing remains separate from publication; this implementation adds no
publishing workflow or registry changes.
