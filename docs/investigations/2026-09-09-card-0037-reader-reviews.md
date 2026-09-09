# CARD-0037: Reader and Reviews implementation acceptance

Implemented R0–R4 against the CARD-0035 engine at `e68d546`. The local preview
packages are `Mdpkg.Reader` and `Mdpkg.Reviews`, version `0.1.0-preview.1`, targeting
.NET 10. No public-feed publication or web authoring capability is claimed.

## Acceptance evidence

| Slice | Delivered | Evidence |
| --- | --- | --- |
| R0: contract | Narrow v1/v2 schema and prose rules; required authored v2 comment kind; explicit UTF-16 selector units; ID/reply/timestamp/extension rules; supported detail path and delta snapshot policy. Refreshed CARD-0033 inventory. | `docs/spec.md` §6.8, `docs/spec/review-comments.schema.json`, independent frozen Python/Git packages and JSON documents under `docs/spec/review-fixtures/`. Python and JavaScript agree with .NET on non-BMP offsets, locator, root and digest. |
| R1: shared Reader | Shared ZIP32 metadata indexing/selective decode, format/path checks, canonical JSON, CommonMark inventory, source scopes and ledger interpretation. CLI retains ZIP writing, source enumeration, ledger evolution and native Git/deep validation. | Existing 815 CLI tests retained; 17 Reader tests cover independent profile vectors, limits, selective CRC checks, invalid extents, stream ownership, spool cleanup and cancellation. Reader/Reviews contain no CLI or native Git process dependency. |
| R2: extraction | Typed v1/v2 feedback, comments/change requests/replies, source order, authored states, provenance, declared anchors and bounded extension data. Explicit outcomes and separate container/schema/verification status. | Reviews tests include valid delta/bundled/empty/ordinary packages, malformed schema/JSON, resource rejection and cancellation. V1 remains `Unspecified / LegacyV1`; unsupported kinds are never silently downgraded. |
| R3: resolution | Exact identity correlation, optional file corroboration, explicit newer target context, canonical source/ledger resolution, strict quote/context relocation and injected full-verification contract. | Reviews suite covers intact/moved/changed/dead/unknown/missing-override/new-birth cases, wrong lineage/snapshot, missing original, surrogate boundaries, false stored quotes, context winners/ties and successor navigation. Original unknown/dead identity cannot be promoted by finding text in the target. |
| R4: consumer/docs | Packed READMEs, standalone Reviews-only PackageReference example, isolated package-consumer verifier and Windows/Linux CI packing/acceptance steps. | Fresh Reviews-only and Reader-only applications restore solely from packages; runtime succeeds without Git on PATH. Full-required with no provider returns `VerificationUnavailable` (example exit 2). |

## Validation results

- Windows: .NET SDK 10.0.300, Git 2.50.1. Release suite: **912 passed, 0 failed,
  0 skipped** (815 CLI, 17 Reader, 80 Reviews).
- Linux: official `mcr.microsoft.com/dotnet/sdk:10.0` container, .NET SDK 10.0.401,
  Git 2.43.0. Release suite: **912 passed, 0 failed, 0 skipped**. Both libraries
  packed and the external Reviews example built and resolved both comments without
  Git on PATH. This is local Linux acceptance, not a claim about a completed hosted CI run.
- Independent native deep validation: **10/10 expected results**, comprising six valid
  packages accepted and four forged bundled/delta lineage packages rejected. Fixture
  generation also runs native strict Git object checks. Structural Reviews extraction
  deliberately accepts those four schema-valid feedback documents without certifying
  their Git lineage; provider-rejection tests exercise the full-required boundary.
- Cross-language Unicode verifier: passed. JSON Schema draft 2020-12 validates itself;
  three valid comment documents accepted, invalid kind/selector documents rejected.
  Reply cycles and other graph/source constraints are checked by runtime tests.
- Local packing: Reader, Reviews and existing `mdpkg` tool succeeded. Fresh, isolated
  package-only consumer acceptance: **2 passed, 0 failed**. Reviews restores Reader,
  Markdig and SharpZipLib; neither application restores Core, CLI or System.CommandLine.
  Reader-only restores no Reviews package.

Run the solution commands from `src/generator-cli` so its `global.json` enables
Microsoft.Testing.Platform. Running `dotnet test` from the repository root bypasses
that SDK configuration and fails before executing tests.

```powershell
Set-Location src/generator-cli
dotnet test -c Release
dotnet pack src/Mdpkg.Reader -c Release --no-build -o artifacts/package
dotnet pack src/Mdpkg.Reviews -c Release --no-build -o artifacts/package
dotnet pack src/Mdpkg.Cli -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
node ../../docs/spec/review-fixtures/verify-unicode.mjs
```

The isolated verifier creates new projects, a temporary package cache and explicit
NuGet configuration, verifies assets contain no project references, then removes Git
from PATH for runtime checks. The example is `examples/review-consumer/Program.cs`;
its project has only the Reviews PackageReference. Package files are produced under
`src/generator-cli/artifacts/package/` and are build artifacts, not committed binaries.
Frozen `.mdpkg` interoperability fixtures are committed intentionally.

## Boundaries and operational limits

Default structural extraction checks ZIP metadata and selected canonical manifest,
history/reference and comments payloads. It does **not** prove untouched payload CRCs,
Git object integrity, current-view/Git consistency or bundled/delta lineage. Full
assurance requires an explicitly injected provider accepting all four obligations;
this card ships the contract and failure behavior, not a provider implementation.
The existing CLI deep validator independently checks package lineage, but it does not
replace Reviews' thread/schema validation. Caller-provided bundled resolution context
requires explicit full-verification assurance.

Reader defaults are 128 MiB input/spool, 16 MiB directory, 10,000 entries, 1 MiB each
manifest/history/ledger, 16 MiB per document, 128 MiB aggregate decoded reads and JSON
depth 32. Reviews adds 8 MiB comments, 5,000 threads, 20,000 comments and 64 KiB UTF-8
per body. Selected compressed payloads are bounded by the decoded cap plus 64 KiB.
Excess input is rejected, never truncated. Caller streams remain open; failed and
cancelled non-seekable opens clean up private spools. Cancellation propagates.
The independent fixtures measure 3,229–5,663 bytes; these prove interoperability, not large
production throughput or deployment-specific CPU budgets.

Historical materialization/range proof remains unavailable: a newer target needs the
exact reviewed snapshot and sufficient current coverage, otherwise feedback is preserved
with an explicit unavailable/unconfirmed/history-required result. Metadata, author text
and dispatch values remain untrusted claims. No network fetch, automatic edit application
or AI SDK is introduced.

Core extraction remains CARD-0033: the present graph is `CLI -> Reader` and
`Reviews -> Reader`. There is no Core package to restore yet, so acceptance proves
Reader-only isolation and preserves CLI creation tests rather than inventing Core.
Web authoring/export, real app-produced returns, publishing, historical resolution and
a production deep-verification adapter remain separate work.

## Review handoff

Review public DTO/status contracts, bounded ZIP access and cancellation, shared CLI
behavior, normative schema additions, identity-first resolution and the full-verification
boundary. Use the frozen independent fixtures and fresh package-consumer checks above.
The unrelated pre-existing `CLAUDE.md` and CARD-0035 review investigation were left out
of this change.
