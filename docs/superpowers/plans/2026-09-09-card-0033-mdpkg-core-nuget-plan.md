# Build plan: Mdpkg.Core creation library and NuGet distribution

CARD-0033. Refreshed 2026-09-09 after CARD-0035 (`e68d546`) and the CARD-0037
Reader/Reviews extraction. Core creation-library extraction and public-feed publishing
remain future work; the producer engine is already implemented and must be moved, not rewritten.

## 1. Current implementation inventory

Paths are relative to `src/generator-cli/`. The accepted dependency boundary is
`Mdpkg.Cli -> Mdpkg.Core -> Mdpkg.Reader` and `Mdpkg.Reviews -> Mdpkg.Reader`.
Until Core lands, CLI owns creation and references Reader directly. Core must not depend
on Reviews, and Reviews must not depend on Core, CLI or native Git.

| Current code | Ownership for CARD-0033 |
| --- | --- |
| `src/Mdpkg.Cli/Engine/PackageBuilder.cs` | Existing snapshot/Git-import/projection/depth/correspondence implementation, deep self-validation and staged replacement: extract to Core. |
| `src/Mdpkg.Cli/Engine/Git/` | Existing isolated native Git plumbing and byte-preserving commit rewrite: extract to Core. |
| `src/Mdpkg.Cli/Engine/Container/ZipContainer.cs` | ZIP emission remains here; bounded reading already delegates to Reader. Extract writer to Core. |
| `src/Mdpkg.Cli/Engine/Sources/SourceTree.cs` | Source enumeration, normalization and filesystem link policy remain creation concerns. Shared name/case-fold checks are Reader-owned. |
| `src/Mdpkg.Cli/Engine/Addressing/LedgerEngine.cs` | Evolution, correspondence application and minted births remain creation concerns; syntax/target checks and live-root interpretation delegate to Reader. |
| `src/Mdpkg.Cli/Engine/Validation/PackageValidator.cs` | Full/deep orchestration and native Git verification stay creator-side; canonical format checks, ZIP reads and CommonMark inventory already reside in Reader. |
| `src/Mdpkg.Reader/` | Read-only ZIP32 indexing/selective decoding, bounded stream spooling, format diagnostics/canonical JSON/Unicode paths, typed identity/locator/current-view resolution. Markdig and SharpZipLib live here. Do not duplicate them in Core. |
| `src/Mdpkg.Reviews/` | Schema, authored v2 kinds, legacy v1 intent, correlation, selectors and extraction results. Never pull this dependency into Core. |
| `Commands/`, `Reporting/`, `Engine/Models.cs` | Commands/reports stay CLI; split creation request/result models when Core receives its public API. Report alias protection remains CLI policy. Shared diagnostic catalog is below CLI in Reader. |
| `tests/Mdpkg.Cli.Tests/` | Real pack/validate, byte-preservation, Git, CommonMark/Unicode, report and fault regressions. Keep command-specific tests and migrate appropriate creator tests only after API extraction. |
| `Mdpkg.Reader.Tests`, `Mdpkg.Reviews.Tests` | Independent review fixtures, bounded reading, schema/correlation/selector and assembly-boundary checks. Keep these independent of CLI/Core. |
| Build and distribution | net10.0, nullable/warnings-as-errors, Markdig 1.3.2, SharpZipLib 1.4.2 and System.CommandLine 2.0.12. Reader/Reviews pack as local `0.1.0-preview.1` artifacts; no public feed, credentials or license grant was introduced. |

The rest of this plan remains the creation/release design. Its original S2–S4 *engine
implementation* gates are now fulfilled by CARD-0035 and should be verified after extraction,
not reimplemented. Public creation API, Core package, installed-tool packaging, release
version alignment and publication remain CARD-0033 work.

## 2. Decisions and scope

**D-1 — Keep one solution, add one library.** Add `src/Mdpkg.Core/Mdpkg.Core.csproj` and
`tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj` to `Mdpkg.slnx`. Reference Core from CLI;
Core references Reader, never Reviews, CLI or System.CommandLine. Keep the outer `generator-cli` directory
for a small migration; describe it as the .NET producer solution in documentation.

**D-2 — First usable release covers fresh-package creation.** Implement snapshot creation,
all existing `pack` options (including Git import, scope, depth and confirmed correspondence),
and the shared validator needed to certify output. Wire `pack` and `validate` as thin adapters.
`update` and `address` remain explicit exit-70 stubs until later producer slices implement
their Core operations. They have no existing business logic to extract. Do not call this
first release a complete CLI implementation. When implemented, their history transformations
and ledger edits also belong in Core. Reviewer comments/change-request extraction, review
resolution, review-package authoring, viewer changes and a public general-purpose reader are
outside this card's create-side scope. A low-level reader used by validation is necessary.

**D-3 — Target `net10.0` initially.** This matches the whole solution and avoids an unrequested
compatibility matrix. It permits .NET 10 applications/services, but excludes .NET 8/9 and
.NET Framework consumers. Do not add `netstandard2.0` or older targets without an actual
consumer requirement and dependency/runtime tests. .NET 10 is LTS, supported through
2028-11-14 ([Microsoft support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)).
Use the base TFM, not a Windows TFM; test Windows and Linux. Native Git means this first
release is not a browser/WASM or process-restricted runtime library.

**D-4 — Package id and namespace `Mdpkg.Core`; retain tool id `mdpkg`.** Core is an ordinary
packable class library, without `OutputType=Exe`, `PackAsTool`, `ToolCommandName` or CLI
runtime settings. Package-name availability and ownership have not been verified; check them
before release. A registry rename need not force a namespace rename. Do not create accounts
or reserve names as part of this investigation.

**D-5 — Native Git is an explicit runtime prerequisite.** Follow tool-reference §7's
`pack-objects`/`index-pack` approach behind an internal Git adapter, including snapshot
creation. Do not add LibGit2Sharp or promise a managed-only library by accident. Document
`git` on PATH or an explicitly supplied executable, subprocess use and temporary disk space.
Use an isolated temporary repository; never mutate the source repository, run hooks, consult
credential helpers or fetch remotes. Pass arguments through `ProcessStartInfo.ArgumentList`,
not a shell. Capture failures, cancel/terminate children, clean temporary files, and set
the §12 Git configuration explicitly. Pin the tested Git version for byte-comparison jobs;
otherwise document conformance, not identical pack bytes across Git versions.

**D-6 — Domain failures are typed results; terminal policy stays in CLI.** Core returns
diagnostics and a status; it does not print, terminate the process or encode exit numbers.
The CLI maps status to §3, serializes §6, handles `--quiet`, `--format`, `--report` and
`--fail-on-warning`. Warning promotion must be considered before committing output: the
CLI passes a typed warning policy to Core, rather than returning exit 3 after publishing
a supposedly successful output file. Invalid source/package and unmet coverage requirements
are normal failed results. Null or structurally invalid API arguments throw argument
exceptions; cancellation throws `OperationCanceledException`; unexpected bugs propagate.
Expected IO/Git failures return an environment-failure result with an actionable message.

## 3. File ownership and dependency boundaries

The refreshed inventory in §1 is authoritative. CLI keeps command parsing, terminal output,
exit mapping and report serialization. Core receives existing creation/source/Git/write/deep
orchestration with a public BCL-based request/result API. Reader remains the sole owner of
bounded ZIP reading, format parsing, canonical JSON, Unicode folding, inventory and ledger
interpretation; its Unicode attribution travels with the package. Reviews owns annotation
schema/selector processing and its injected verification contract. A future creator-side
adapter may implement that contract without making Core depend on Reviews by default.

Do not export native Git process abstractions, parser ASTs or mutable internal JSON nodes.
Keep public data independent from CLI JSON envelopes and avoid a second CommonMark or ZIP
implementation. The current internal friend-assembly bridges let CLI reuse Reader while Core
is pending; public API stabilization belongs to the respective package release work.

## 4. Proposed public API and behavior

The following names are the proposed contract, not existing or compiled code. Use a sealed
`PackageBuilder` with constructor-supplied `PackageBuilderSettings` (`GitExecutable`, optional
temporary directory), immutable request/result records and cancellation on every async operation.
No DI framework, global mutable configuration or console writers are required.

```csharp
Task<CreateResult> CreateFromDirectoryAsync(
    DirectoryPackageRequest request, string destinationPath,
    CancellationToken cancellationToken = default);

Task<CreateResult> CreateAsync(
    SnapshotPackageRequest request, Stream destination,
    CancellationToken cancellationToken = default);

// On a separate sealed PackageValidator; useful to callers and the CLI.
Task<ValidationResult> ValidateAsync(
    Stream package, ValidationOptions options,
    CancellationToken cancellationToken = default);
```

| Contract | Contents / rule |
| --- | --- |
| `DirectoryPackageRequest` | Source directory; namespace `Guid`; `CreationOptions`; discriminated snapshot or Git-import history options. A directory remains a supported programmatic input, with no CLI invocation. |
| `SnapshotPackageRequest` | Namespace; explicit commit metadata; immutable collection of `PackageEntry(Path, ReadOnlyMemory<byte> Content)`; creation options. This lets a service create documents without first writing its own source tree. Stage privately as needed; input bytes must remain unchanged until completion. This first overload is for bounded snapshots, not an unbounded streaming-source promise. |
| Snapshot metadata | Author, committer, timestamps and message (default message `Initial package`). Require explicit identities/times for direct API calls; no dependence on a developer's Git user configuration. Define deterministic CLI defaults in the tool reference before implementing its mapping. Proposed defaults: fixed producer name/email and UTC Unix epoch, with imported commits retaining source metadata. |
| `CreationOptions` | Compression level 0–9 (6 default), data descriptors (false), reverse index (false), require-complete (false), warning policy (allow/fail), supported profile identifiers and object format. Profiles default to the current v1 values, object format SHA-1. Unsupported values fail explicitly; never silently fall back. Strict paths are mandatory, with no API escape hatch. |
| Git import options | Source scope/pathspec, optional positive depth, and typed explicitly confirmed correspondence records. Derive coverage and transformations; callers cannot assert a raw `coverage: complete` flag. Snapshot mode rejects import-only options. |
| Correspondence | Typed move, retirement and unconfirmed records with origin roots and structured locators/trails; no JSON file path, similarity score or auto-confirm switch in Core. The CLI parses `--correspondence` into these records. Apply input-ledger consistency and reservation rules centrally. |
| `CreateResult` | Status (`Success`, `SourceRejected`, `Nonconforming`, `ObligationUnmet`, `EnvironmentFailure`), diagnostics, checks and nullable immutable package metadata. On success include byte count, SHA-256, entry count, typed manifest/current/history/addressing results. No process exit or verb; the CLI adds the destination path. |
| Diagnostics/checks | Stable MDPK code, typed severity, optional entry, message, spec citation; typed check status. Preserve the existing CLI JSON spelling/order through a mapper. Add new diagnostic codes only with tool-reference updates, not ad hoc reuse of unrelated codes. |
| `ValidationOptions` | Deep checking and recoverable-input handling; report tier separately from conformance. Accepting recoverable input never turns it into conforming success. Caller retains ownership of the input stream; validation may spool a non-seekable stream privately. |

Illustrative consumer flow after installation: create `PackageEntry("guide.md", UTF8 bytes)`,
put it in a `SnapshotPackageRequest` with namespace and commit metadata, create a destination
`MemoryStream`, call `new PackageBuilder(settings).CreateAsync(request, stream, token)`,
then consume bytes only when the result succeeds. The shipped README must replace this
outline with a compiled example using the final constructors and `dotnet add package
Mdpkg.Core --version 0.1.0-preview.1`.

All creation paths share: validate paths and strict UTF-8; LF-normalize outside `.git/`;
construct normalized Git objects; compute CommonMark 0.31.2 roots and digests; emit confirmed
sparse overrides/history; curate Git entries; write the prescribed ZIP layout; reopen and
validate before declaring success. Ordinary self-validation uses every applicable §11 check;
deep Git/tree consistency is also a release acceptance gate. SHA-256 Git object format
produces MDPK4001 (source rejection for creation); malformed CLI spelling remains usage exit 1.
Document that mapping, which the scaffold explicitly leaves undecided.

For a file destination, write a unique sibling temp file, validate it, then rename/replace;
on failure or cancellation delete the temp and preserve any existing destination. Enumerate
the source before output staging and reject a destination inside that source tree, to avoid
ingesting output or a previous package. Reject symlinks/reparse points initially unless a
later documented source policy can preserve containment and determinism.

For a stream destination, require writable/empty output (position and length zero when
seekable), stage and validate privately, then copy without disposing the caller's stream.
Do not promise rollback on copy failure/cancellation: a non-seekable destination may contain
a prefix and must be discarded. Return success only after the final copy completes. Staging
keeps validation failures from writing any bytes, but does not make arbitrary streams atomic.
Publish resource limits and temporary-disk behavior; reject ZIP64 requirements rather than
emitting an undocumented format extension.

## 5. Package metadata, versioning and publication

**V-1 — Introduce explicit SemVer release versions.** Put the shared .NET release version in
`src/generator-cli/Directory.Build.props`, remove the CLI's overriding `Version`, and begin
the usable producer preview at `0.1.0-preview.1`. Keep tool and Core versions aligned while
they ship together. Separate NuGet/API versions from wire token `markdown-package/1` and
anchor/digest profile versions: a packaging refactor changes none of those format identifiers.
Use `mdpkg-v0.1.0-preview.1` release tags with a strict tag/version match. Before 1.0, breaking
API changes require explicit release notes; after 1.0, use major/minor/patch API compatibility
rules. Add a CHANGELOG; reserve 1.0 for a reviewed public API and stated capability coverage.

**V-2 — Package metadata is part of the release.** Core needs id, version, authors,
description, project/repository URLs, repository type/commit, its own packed README, XML API
documentation and portable symbols (`snupkg`). Enable CI source metadata/Source Link as
supported by the SDK and verify the resulting archive. Set `IsPackable=false` on test
projects. Choose and commit the repository's license with the owner before declaring package
license metadata; do not invent an SPDX grant based on the Unicode notice. Do not let Core
inherit the tool's scaffold description. The tool package must bundle its Core runtime
assembly/dependencies correctly; test an installed tool from an isolated local feed.

**V-3 — Default to NuGet.org.** It fits public .NET consumers without a special authenticated
feed. GitHub Packages is an alternative for private/internal distribution: its NuGet registry
requires authentication even for public packages; workflow publishing can use `GITHUB_TOKEN`
with `packages: write`, while ordinary consumers need suitable credentials, commonly a
classic PAT with `read:packages`. That is unnecessary friction here
([GitHub NuGet registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-nuget-registry)).
Do not dual-publish in the initial pipeline.

**V-4 — Separate artifact CI from publishing.** Extend `generator-cli.yml` to build/test the
whole solution on Windows and Linux and pack both projects once on the designated artifact
job. Add path triggers for `docs/spec.md`, fixture files used by Core tests, package README,
license/version/changelog and the release workflow. Preserve the Pages workflow.

Add `.github/workflows/publish-nuget.yml` in the implementation stage, triggered only by
`mdpkg-v*` tag pushes. Validate the complete SemVer tag and equality to the checked-in
version; require the tagged commit to be reachable from `master`. Run release restore,
build, tests and package-consumer verification on that exact commit before a publish job
uses the resulting immutable artifacts. Never publish from PR execution or use
`pull_request_target` for building contributed code. Use a `nuget` GitHub environment,
release-tag restrictions and serialized publish concurrency. Pin actions to reviewed commit
SHAs during implementation. Keep ordinary CI at `contents: read`; only the publishing job
needs `id-token: write`. Upload packages/checksums for inspection even before feed setup.

**V-5 — Prefer NuGet Trusted Publishing.** The owner configures a NuGet policy for repository
owner `michal-ciechan`, repository `markdown-package`, workflow filename `publish-nuget.yml`,
environment `nuget`, and the intended package scopes/ownership. Set GitHub environment secret
`NUGET_USER` to the NuGet profile name. `NuGet/login@v1` exchanges GitHub OIDC for a temporary
API key, used immediately by `dotnet nuget push` against
`https://api.nuget.org/v3/index.json`; no long-lived API key is stored. If trusted publishing
cannot be used, the explicitly configured fallback is a package-scoped expiring
`NUGET_API_KEY` in that environment, rotated by its owner. Never commit credentials or echo
them. See [NuGet Trusted Publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing).

Push only the exact Core/tool release files and intended Core symbols. Multi-package
publication is not atomic: record which uploads succeeded, and on retry verify an existing
version matches the original artifact before skipping it. Do not blanket-skip duplicates
and conceal a different build under the same version. Verify public-feed restoration after
indexing; publish release notes only once both expected packages can be installed. NuGet
packing mechanics and metadata are documented in [Microsoft's dotnet packaging guide](https://learn.microsoft.com/en-us/nuget/create-packages/creating-a-package-dotnet-cli).

## 6. Implementation slices and acceptance gates

Each slice ends by updating documentation to match what actually works. These are follow-on
implementation tasks, not authorization to implement or publish within CARD-0033.

| Slice | Work | Completion evidence |
| --- | --- | --- |
| S1: structure and contract | Add Core and Core.Tests; reference Core; extract catalog; introduce requests/results and CLI mapping boundary. Retain command stubs. Move only the diagnostic-catalog consistency assertion to Core.Tests (or give it explicit Core access); keep command/exit assertions in CLI.Tests. | Existing help, option and report behavior remains intact; Core has no CLI dependency; both packages pack locally. No public preview yet. |
| S2: resolve implementation risks | Prove a .NET parser matches CommonMark 0.31.2 source/trail cases, including Setext, duplicate headings, fences and Unicode. Prove ZIP emission can control manifest header, flags, ordering, external/internal attributes, extras, timestamps and descriptors. Check compression exposes real levels 0–9; do not silently map ten levels to a few BCL enum values. Verify native Git isolation and Unicode NFC/folding on Windows/Linux. | Small executable conformance probes and chosen pinned dependencies with license notices. If stock ZIP/parser APIs fail these gates, replace or adapt them before committing the public implementation to their shape. |
| S3: snapshot creation | Implement shared source, Git, addressing, manifest/history and container engines plus output staging and validator; support directory and in-memory snapshot requests. | Independent worked-example roots/digests, layout and extracted bytes agree; native `git fsck --full --strict` passes and current-view blobs equal tip tree; API and CLI consume identical normalized bytes. |
| S4: complete pack/validate | Implement import/projection/depth/correspondence/coverage and other pack options; wire CLI pack and validate. Keep update/address honestly stubbed. | Full pack-option matrix, truncated/projected history and confirmed/unconfirmed correspondence meet tool-reference contracts. No accepted option is silently ignored. |
| S5: distribution | Add metadata/versioning/docs and CI packing; smoke-test local packages; add separately gated publication workflow. | A fresh external net10.0 console application restores Core by PackageReference from the local feed and creates a package without referencing the executable or repo files; isolated installed `mdpkg` tool finds Core and creates/validates a package. Owner completes release prerequisites before first upload. |

**Test split:** keep `HelpTests`, `OptionValidationTests`, `CliRunner`, command-tree/exit-code
spec tests and all CLI stdout/stderr/report assertions in `Mdpkg.Cli.Tests`. Replace the pack
and validate stub expectations when those verbs become real; preserve stub assertions for
remaining commands. Add Core tests for actual domain behavior instead of repeatedly driving
it through command-line strings. Keep a few API-versus-CLI parity tests to check mapping.

Core test groups must cover: unsafe/reserved/colliding paths; strict UTF-8/LF and BOM handling;
canonical JSON; sparse ledger consistency and no heuristic confirmation; CommonMark roots
and digests against committed independent values; required ZIP bytes and ZIP64 rejection;
CRC/decompression failures; manifest/history/Git agreement; warning and coverage failures;
missing/failing Git; atomic preservation of existing files; cancellation/cleanup; caller-owned
streams and interrupted final copy. Assert stable meaning/diagnostic codes rather than
platform-specific exception wording. Repeatability tests fix source metadata, Git and producer
versions; cross-runtime tests compare semantics unless compressor/runtime versions are pinned.

After implementation, from `src/generator-cli/` run `dotnet restore`,
`dotnet build --no-restore -c Release`, `dotnet test --no-build -c Release`, then separately
`dotnet pack src/Mdpkg.Core/Mdpkg.Core.csproj --no-build -c Release -o artifacts/package`
and the equivalent CLI pack command. Inspect the archives and run the external-consumer and
installed-tool checks against that directory. These are future gates, not test results from
this planning task.

## 7. Required documentation changes

| File | Change during implementation |
| --- | --- |
| `README.md` | Describe Core and tool separately; give supported runtime/install paths and accurate per-operation status. |
| `src/generator-cli/README.md` | Four-project layout, dependency on Git, new build/pack/test commands, versions, separate library/tool distribution, retained stubs and actual wired matrix. Replace the hardcoded 81 count if the suite changes. |
| New `src/generator-cli/src/Mdpkg.Core/README.md` | Packed consumer guide with compiled snapshot/directory examples, result handling, supported TFMs/options, Git/temp-disk requirements, stream ownership/failure behavior, cancellation, deterministic metadata and scope exclusions. |
| `docs/spec/generator-cli.md` | Explain shared engine; retain CLI invocation/exit/JSON contract. Specify API-to-exit mapping, MDPK4001 rejection exit, warning-before-publication policy, deterministic snapshot identity/times and source containment/link policy. Clarify §7 step 8 deletes failed staging output, not an existing destination. Distinguish supported library operations from unimplemented CLI verbs. |
| `docs/spec.md` | No wire-format or profile-version change is required by the split. At most add a non-normative implementation link; preserve Unicode D-16 and all container/addressing rules. Any discovered normative conflict needs its own explicit spec resolution, not a private Core interpretation. |
| New `CHANGELOG.md`, owner-selected license, release guide | Document aligned SemVer/tags, API changes, supported capabilities, package ownership, environment/policy setup, artifact recovery and post-publish verification. |

## 8. Handoff and decisions remaining

This plan is complete under the stated defaults: net10.0, Mdpkg.Core, native Git,
NuGet.org, aligned preview versions, fresh creation plus validation first. No answer is
needed to produce or review it. Approve or amend these boundaries before assigning S1–S5;
in particular, implementing every existing CLI verb would be additional new producer work,
not a prerequisite file extraction hidden inside S1.

Before publishing, the owner must select the repository license, confirm package-id
availability/ownership and NuGet account, and configure the publishing policy/environment
(or scoped API-key fallback). These are release prerequisites, not blockers to planning or
local implementation. No account state or credentials were inspected or changed here.

The critical engineering risks are exact CommonMark source semantics, controlled ZIP
emission/compression levels, Git history transformation/coverage, and normalization under
the CLI runtime settings. S2 and S4 make those risks explicit; creating an empty NuGet
library does not resolve them. No build or tests were run for this documentation-only task.
