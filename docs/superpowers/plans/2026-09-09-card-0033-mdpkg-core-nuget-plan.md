# Build plan: Mdpkg.Core creation library and NuGet distribution

CARD-0033. Refreshed 2026-09-09 against HEAD `823a699`, the full CARD-0033 card,
CARD-0036's release decisions and [CARD-0034 §4](2026-09-09-card-0034-review-extraction-plan.md#4-library-boundary-recommendation).
This is planning only. The engine and Reader/Reviews have landed; Core extraction, its
public creation API and distribution remain future work.

## Implementation scope update (2026-09-10)

The current CARD-0033 description supersedes the original three-card prerequisite below:
**S0-S4 are authorized before CARD-0036**, with local-feed packaging only. CARD-0035 and
CARD-0037 are Done. S5 is CARD-0039 and still depends on CARD-0036's release foundation.
Do not introduce license/versioning/publishing infrastructure for local extraction.
Implementation starts from `b907bc9`; baseline: 958 Windows tests, zero failures.
The remaining text records the refreshed design; see the
[S0-S4 implementation report](../../investigations/2026-09-10-card-0033-core-extraction.md)
for final ownership, API decisions and acceptance evidence.

## 1. Baseline and sequencing

The solution at `src/generator-cli/Mdpkg.slnx` has six projects: CLI, Reader, Reviews and
their tests. CLI currently references Reader; Reviews references Reader. There is no Core.
All target net10.0 with nullable analysis, warnings as errors and deterministic builds.
The SDK baseline is 10.0.100 with feature roll-forward. Reader owns Markdig 1.3.2 and
SharpZipLib 1.4.2; System.CommandLine 2.0.12 belongs to CLI.

Pack and validate are real operations: snapshot creation, Git import, scope/depth,
correspondence/coverage, controlled ZIP emission, full/deep validation and staged atomic
file publication already work. Update and address remain exit-70 stubs. Reader already
has a public bounded archive/current-view API; Reviews owns review extraction/resolution.
Do not repeat parser selection, ZIP feasibility probes or producer implementation.

**Resume implementation only after CARD-0035, CARD-0036 and CARD-0037 are all Done**, per
CARD-0033. This authorized plan refresh can proceed now. CARD-0036 remains Backlog at
this investigation and owns the initial tool-release foundation. Its recorded owner
decisions are MIT, NuGet.org only, shared SemVer, mdpkg-v* tags and a gated
publish-nuget.yml workflow using Trusted Publishing. Reuse that work after it lands.

At this HEAD CLI still declares 0.1.0-scaffold and Reader/Reviews 0.1.0-preview.1; there
is no root LICENSE, CHANGELOG or publishing workflow. These are release gaps, not missing
engine behavior. No local release tags were present. Remote tags, public-feed versions,
package ownership and account state were not verified. Reconcile release details with
the completed CARD-0036 before coding; do not independently create its workflow or reopen MIT.

## 2. Accepted dependency graph and ownership

```text
Mdpkg.Cli -> Mdpkg.Core -> Mdpkg.Reader
Mdpkg.Reviews ----------> Mdpkg.Reader
```

Add src/Mdpkg.Core and tests/Mdpkg.Core.Tests under src/generator-cli, producing an
eight-project solution. Keep one solution and the existing enclosing directory. Use
Mdpkg.Core for package ID/namespace; retain mdpkg for the tool. Start with base net10.0
on Windows/Linux. Other TFMs require a consumer requirement and compatibility tests.
Core is an ordinary library without executable/tool settings. Native Git remains a
runtime prerequisite for creation and deep verification, not for Reader/Reviews.

Paths below are relative to src/generator-cli/src/.

| Existing implementation | Destination and action |
| --- | --- |
| Mdpkg.Cli/Engine/PackageBuilder.cs | Move existing snapshot/import/scope/depth, history/addressing production, deep self-validation and staged replacement to Core. |
| Mdpkg.Cli/Engine/Git/ | Move isolated plumbing, packing and byte-preserving history rewriting to Core; keep process abstractions internal. |
| Mdpkg.Cli/Engine/Sources/SourceTree.cs | Move filesystem enumeration, normalization, link/containment policy to Core; retain Reader calls for shared path rules. |
| Mdpkg.Cli/Engine/Addressing/LedgerEngine.cs | Move evolution, correspondence application and birth minting to Core; Reader retains syntax, target checks and live-root interpretation. |
| Mdpkg.Cli/Engine/Container/ZipContainer.cs | Move ZIP emission to a Core writer. Existing read/CRC/limit wrappers continue delegating to Reader or become direct Reader calls. |
| Mdpkg.Cli/Engine/Validation/PackageValidator.cs | Move full/deep orchestration to Core, preserving all checks and using Reader parsing/member access. |
| Mdpkg.Cli/Engine/IO/TemporaryDirectory.cs | Move creator-owned temporary workspace lifecycle to Core; Reader retains its read/spool lifecycle. |
| Mdpkg.Cli/Engine/Models.cs and ReaderImports.cs | Separate internal engine models from public Core contracts; remove CLI's Reader-internal imports after mapping. |
| Mdpkg.Cli/Commands/ and Reporting/ | Keep syntax, reports, alias protection, terminal rendering, JSON envelopes and exit mapping in CLI. |
| Mdpkg.Reader/ | Retain ZIP32 indexing/selective reads, bounded spooling, canonical JSON/diagnostics, Unicode paths, CommonMark inventories, ledger reading and public archive/snapshot/identity/locator APIs. |
| Mdpkg.Reviews/ | Retain schemas, authored v2/legacy v1 interpretation, correlation, selectors, results and injected verification interfaces. |

Core must not reference Reviews, CLI or System.CommandLine. Reader/Reviews must not gain
native Git, writer or process dependencies. Do not introduce another abstractions package.
Core evidence can support a future Reviews verification adapter, but an implementation
of a Reviews interface must live in a consumer or separate integration assembly to preserve
this graph. That integration is outside this extraction.

### Reader internals and package compatibility

The landed engine uses Mdpkg.Reader.Internal types, including mutable manifest/ledger
models, canonical JSON and diagnostics. Reader currently grants friendship to mdpkg and
test/review assemblies. Merely changing project references will not compile.

Initially add InternalsVisibleTo for Mdpkg.Core and, where needed, Mdpkg.Core.Tests.
Move existing call sites without duplicating Reader code or making its entire internal
surface public. Remove mdpkg and Mdpkg.Cli.Tests friendship when their consumers/tests
have migrated. Keep existing Reviews access. CLI then references Core and consumes public
result data, without Reader-internal calls.

This is an internal ABI dependency: initially give Core an **exact NuGet dependency on
its coordinated Reader version**, and verify the packed constraint. The first Core release
requires a newly released Reader containing Core friendship. Preserve Reader/Reviews
public compatibility. Relax the exact constraint only after a separately reviewed stable
shared contract replaces internal calls. Public Core types must not expose internal
Reader models, mutable JsonObject/JsonArray, parser ASTs or process objects. Reuse public
Reader identity/locator types where their semantics match.

## 3. Public API: existing behavior versus new work

Proposed names below are not compiled code. Use sealed builder/validator services,
constructor settings for Git executable/temporary directory, immutable request/results
and cancellation on every async operation. No DI framework or global configuration.

```csharp
// PackageBuilder
Task<CreateResult> CreateFromDirectoryAsync(
    DirectoryPackageRequest request, string destinationPath,
    CancellationToken cancellationToken = default);
Task<CreateResult> CreateAsync(
    SnapshotPackageRequest request, Stream destination,
    CancellationToken cancellationToken = default);

// PackageValidator
Task<ValidationResult> ValidateFileAsync(
    string path, ValidationOptions options,
    CancellationToken cancellationToken = default);
Task<ValidationResult> ValidateAsync(
    Stream package, ValidationOptions options,
    CancellationToken cancellationToken = default);
```

Directory-to-file creation and file validation wrap landed behavior. In-memory snapshot
input, stream output/validation, typed correspondence and immutable public metadata are
new features with separate acceptance gates; moving files does not implement them.

| Contract | Proposed contents and rule |
| --- | --- |
| DirectoryPackageRequest | Source directory, namespace Guid, snapshot/Git-import mode, scope, optional positive depth, metadata and creation options. Preserve currently accepted snapshot scope/depth behavior; do not add import-only restrictions incidentally. |
| SnapshotPackageRequest | Namespace, explicit author/committer/times/message and bounded collection of PackageInputEntry(Path, ReadOnlyMemory<byte> Content). Avoid collision with Reader's existing PackageEntry metadata type. Defensively copy collection structure; caller keeps content buffers unchanged until completion. |
| CreationOptions | Compression 0–9, default 6; descriptors/reverse index false; current v1 profiles and SHA-1; require-complete false; typed warning policy. Unsupported values fail explicitly. Path safety has no escape hatch. |
| Correspondence | Typed confirmed moves/retirements and unconfirmed records using structured roots/locators. Derive coverage, never accept a caller assertion. Core owns consistency/application; CLI owns reading the correspondence file. A Core codec can translate existing JSON to the same records, avoiding duplicated grammar in CLI. |
| Results | Typed status, diagnostics, performed checks, byte count/SHA-256/entry count and independently owned immutable manifest/current/history/addressing metadata when available. No verb, report destination or process exit. |
| Diagnostics/checks | Preserve MDPK code, severity, entry, message and spec reference. Public enums replace internal stringly typed severity/check outcomes; CLI maps existing JSON spelling/order. |
| ValidationOptions | Deep/recoverable policy, optional expected namespace/object format and explicit resource policy. Report tier, conformance and checks actually run separately. Recoverable acceptance does not make input conforming. |

Core statuses map through CLI to success 0, source rejection 2, nonconforming 3,
obligation unmet 4 and environment failure 5. Syntax/usage stays exit 1 and remaining
stubs exit 70. Map engine usage preconditions at the adapter boundary. Expected IO/Git
failures return actionable environment results; invalid API arguments throw argument
exceptions, cancellation throws OperationCanceledException, and unexpected bugs propagate.
Enforce warning promotion and require-complete before publication, as the engine already
does. Replace CLI's internal canonical-JSON access with a mapper from public metadata;
report serialization and destination handling remain CLI-owned.

## 4. Compatibility and validation invariants

First move the engine mechanically, preserving these landed behaviors:

- CLI snapshot identity mdpkg <mdpkg@example.invalid>, timestamp 946684800 +0000
  (2000-01-01), and default message Initial package. Direct snapshot calls supply explicit
  metadata; do not switch CLI to Unix epoch or ambient Git identity.
- Strict paths/link rejection/source containment, LF normalization and normalized Git
  modes, with Reader's Unicode and inventory rules.
- Isolated Git, argument-list invocation, no hooks/fetch/credential-helper work, child
  cancellation and cleanup. Preserve legacy metadata bytes and structural parent parsing;
  rewritten trees/parents strip invalidated signatures.
- Existing projection/depth/history, retained completeness evidence, fresh reserved births
  and confirmed-only correspondence overrides.
- Controlled ZIP layout and real numeric compression levels; ZIP64 rejection and existing
  profile/object-format diagnostics, including source rejection MDPK4001.
- Creation always deep-self-validates before publication. Preserve sibling staging, flush,
  validation, final cancellation check and replacement; failures before replacement
  preserve the existing destination.
- CLI report alias checks/rechecks and staged reports, including 823a699 regressions.

**Reader structural opening is not full validation.** Do not replace PackageValidator
with PackageArchive.OpenAsync. Core retains all relevant payload traversal, curated Git
allowlists/checksums, manifest/history/ledger agreement, reserved birth checks, retained
completeness and bundled lineage evidence. Deep mode retains native git fsck, tip/tree
consistency and structural parent handling. Reader supplies individual reads and shared
format checks. Never mark skipped checks passed or weaken existing CLI deep semantics.
Reviews schema checks and its Full-verification contract remain separate; Core does not
become a review-schema validator.

### Resource and stream contract

Mechanical extraction preserves the existing producer compatibility profile: ZIP32,
fewer than 65,535 entries and current managed payload limits. The existing validator uses
Reader's eager compatibility read path; do not describe that as bounded-memory streaming.
Reader's public defaults, including 128 MiB input/aggregate and 16 MiB document limits,
must not silently become new CLI rejection thresholds.

Before exposing stream APIs, introduce explicit Core resource options reusing Reader
ReadLimits for archive/decoded-member checks and bounding source staging/temp spooling.
Public APIs default to Reader service limits; CLI explicitly selects the documented
producer compatibility profile. Apply the selected profile consistently to file and stream
entry points, including cumulative decoded bytes, entry counts and cancellation during
copying. Use Reader indexing/member reads to avoid unconditional eager materialization
in bounded public validation. Git/object generation also consumes memory/disk; archive
limits are not a whole-process resource guarantee.

Leave caller input streams open; positions may advance. Cap and clean private spooling
of non-seekable inputs. Returned data cannot depend on disposed archive handles.
Output streams must be writable and initially empty where length/position can be checked.
Stage and deep-validate privately before copying, leave output open, and report success
only after the final copy. Copy failure/cancellation may leave a prefix which the caller
must discard. Arbitrary streams have no rollback/atomicity promise.

## 5. Implementation slices and test split

These are follow-on implementation tasks; this refresh changes no library or workflow.

| Slice | Work | Acceptance gate |
| --- | --- | --- |
| S0: reconcile | Confirm prerequisite cards Done; record new HEAD, release policy and existing test baseline. | No duplicate license/version/publishing foundation. |
| S1: extract | Add Core/Core.Tests; move existing engine; establish Reader friendship/exact dependency; public directory/file contracts and CLI mapping. | Existing behavior passes; CLI no Reader internals; correct dependency graph. |
| S2: API additions | Typed correspondence/immutable results, in-memory snapshots, stream output/validation and explicit resource profiles. | Limits, ownership, failures, cancellation and file/API parity verified without weaker validation. |
| S3: tests/docs | Move assertions by owner, retain independent fixtures and adapter parity; compile examples. | Eight-project suite passes Windows/Linux; prior regression assertions retained. |
| S4: local packages | Pack Reader/Core/Reviews/tool, inspect metadata/notices/dependencies, extend isolated consumers and installed-tool smoke. | Package-only consumers execute; installed tool resolves all runtime assemblies. |
| S5: release integration | Extend CARD-0036's workflow/version/scopes for Reader/Core and exact-commit artifacts. | Owner prerequisites complete; compatible Reader available and fresh public-feed consumers succeed. |

| Existing tests | Ownership after extraction |
| --- | --- |
| HelpTests, OptionValidationTests, CliRunner, command/exit/stub and stdout/stderr/report assertions | Keep CLI, including report alias fixes and a small API-versus-CLI parity matrix. |
| ProducerTests, ContainerValidationTests, ReviewRegressionTests, EngineFixture | Split mixed files: writer/Git/history/deep validation/atomic cleanup and legacy metadata/coverage move to Core; command/report portions stay CLI. |
| AddressingTests and independent CommonMark fixtures | Pure parser/path/ledger-reading assertions move to Reader.Tests; evolution/correspondence to Core.Tests. Preserve the independent 652 CommonMark cases without duplicating them. |
| Reader.Tests / Reviews.Tests | Retain bounded archive/resolver, schema/correlation/selector/parser and dependency-boundary regressions; Reviews runs without Git. |
| Diagnostic/spec consistency | Shared catalog checks in Reader, creation behavior in Core, command/exit/report consistency in CLI. |

New API tests cover stream/buffer ownership, non-seekable input, limits, interrupted copies,
cancellation/temp cleanup, immutable results, explicit metadata and unsupported options.
Retain corruption, deep-check, warning/coverage, missing/failing Git, destination preservation
and Unicode regressions. Fix Git/metadata/tool versions for byte comparisons; otherwise
compare conformance semantics. The committed
[CARD-0037 parser-fix report](../../investigations/2026-09-09-card-0037-parser-fixes.md)
records 958 passing tests on Windows/Linux; this planning task did not rerun that suite.

Future gates, from src/generator-cli: dotnet restore; dotnet build --no-restore -c Release;
dotnet test --no-build -c Release, using the existing Microsoft.Testing.Platform setup.
Pack each Reader/Core/Reviews/CLI project with dotnet pack --no-build -c Release and a
common local feed directory. Run existing consumer/Unicode checks plus Core and installed
tool smoke tests. These are implementation gates, not results of this documentation change.

## 6. Versioning, packaging and release integration

Reuse CARD-0036's shared version source, MIT license, CHANGELOG, tool metadata and tag
validation. Remove conflicting project version overrides deliberately. Choose the next
unused preview at implementation time; do not reset a released tool or assume
0.1.0-preview.1 is free. Core and its exact Reader dependency ship in a coordinated train.
Reviews can retain an unchanged compatible release unless shared release policy requires
a bump; verify its Reader range against the train. NuGet/API versions remain separate
from markdown-package/1 and profile tokens. Document pre-1.0 breaking changes; reserve
1.0 for reviewed API and capability coverage.

Core metadata includes ID, meaningful description, authors, repository/project URLs and
commit, its packed README, XML API documentation and portable symbols/source metadata.
Use the owner-decided MIT metadata after CARD-0036 lands its license; retain Reader's
Unicode attribution and dependency notices. Test projects are non-packable. Do not inherit
CLI executable/tool properties or restore removed invariant-globalization settings.
Inspect actual archives for dependency bounds and installed-tool runtime contents.

Extend tests/verify-consumers.py with a fresh-cache local-feed Core-only net10.0 consumer
that creates and validates using Git. It must restore Core/Reader and Reader's parser/
compression dependencies, without Reviews/CLI/System.CommandLine. Keep Reader-only and
Reviews-only consumers running without Git or Core. Use PackageReference, no solution
project references/repository source files. Separately install mdpkg from the isolated
feed and exercise pack/validate. Compile Core README directory/in-memory examples.

Existing generator-cli.yml already builds/tests Windows/Linux, packs CLI/Reader/Reviews,
runs review-consumer verification and the Node Unicode probe, and uploads OS artifacts.
Extend for Core and its consumer while retaining these gates. Add relevant filters for
examples, license/version/release docs and workflow changes. Preserve Pages. Release
verification must use the exact tagged commit; publish one designated artifact set,
not both OS builds.

NuGet.org remains the public feed. GitHub's NuGet registry requires authentication even
for public packages, adding unnecessary consumer setup here; do not dual-publish.
See [GitHub's NuGet registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-nuget-registry).

Extend CARD-0036's publish-nuget.yml: strict mdpkg-v* SemVer/version equality, tagged commit
reachable from master, full build/consumer gates, restricted nuget environment, serialized
publication and inspected artifacts/checksums. No PR publication or contributed-code build
under pull_request_target. Use reviewed action pins; ordinary CI has contents: read.
Publish only enumerated intended release packages/symbols.

Trusted Publishing uses NuGet/login@v1 and id-token: write on the publish job. Extend
the owner-configured policy for michal-ciechan/markdown-package, workflow filename
publish-nuget.yml, environment nuget and intended Reader/Core/tool scopes. Keep NUGET_USER
as the NuGet profile name and upload using the short-lived issued credential. Only if
unavailable, retain CARD-0036's explicitly configured package-scoped expiring NUGET_API_KEY
fallback. Human account/policy setup is a release prerequisite.
See [NuGet Trusted Publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing).

Publish compatible Reader before Core, or first in the same gated release: a local Reader
build cannot satisfy a fresh NuGet.org consumer. Publish the tool and any intentionally
included Reviews release from the verified set. Uploads are not atomic; record successes
and verify version/content provenance before skipping an existing upload on retry.
Do not blanket-skip duplicates. After indexing, fresh-cache restore/create/validate Core,
install the tool and verify every other package included before declaring release complete.

## 7. Documentation and handoff

| File | Implementation update |
| --- | --- |
| Root README.md | Reader/Reviews/Core/tool audiences, dependency graph and actual operation status. |
| src/generator-cli/README.md | Eight-project layout, commands, Git requirement, release versions and remaining stubs; remove stale fixed test counts. |
| New src/generator-cli/src/Mdpkg.Core/README.md | Compiled install/create/validate examples, typed failures, stream ownership/partial copy, resource profiles, Git/temp disk and deterministic metadata. |
| Reader/Reviews READMEs | Preserve independent use and no-Git guarantees; compatible version guidance where needed. |
| docs/spec/generator-cli.md | Thin adapters while preserving accepted flags, exits, JSON/report contract, snapshot defaults and warning-before-publication behavior. |
| docs/spec.md | At most a non-normative link; preserve wire/profile rules and resolve normative conflicts separately. |
| CARD-0036 release guide/CHANGELOG | Extend package list, version coupling, policy scopes, recovery and post-publish checks; reuse MIT and workflow. |

The plan is complete under the accepted graph, net10.0/native-Git baseline and NuGet.org
decisions. Review the migration/API/resource contracts before S1; code remains sequenced
after all three prerequisite cards are Done. Before upload, the owner must confirm package
ownership/available versions and finish environment/policy setup. No account, credentials,
implementation files or workflows changed for this refresh; no builds/tests were run.
