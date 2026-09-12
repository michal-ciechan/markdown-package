# Mdpkg.Core

Create `.mdpkg` packages and run full or native-Git deep validation from .NET 10 on
Windows and Linux. `Mdpkg.Cli -> Mdpkg.Core -> Mdpkg.Reader`; Reviews depends only on
Reader. Core does not reference Reviews, the CLI, or System.CommandLine.

Install the coordinated preview from NuGet.org after the [public release gate](https://github.com/michal-ciechan/markdown-package/actions/workflows/publish-nuget.yml) succeeds:

```sh
dotnet add package Mdpkg.Core --version 0.1.0-preview.2 --source https://api.nuget.org/v3/index.json
```

Core uses Reader internals and carries an **exact** `Mdpkg.Reader` dependency on
`0.1.0-preview.2`. NuGet restores Reader automatically. Reader is published first
from the same verified release; never substitute different bytes under that version.
See the [release guide](https://github.com/michal-ciechan/markdown-package/blob/master/docs/releases/mdpkg.md)
for policy setup, publication status and local-feed verification.

The following examples are compiled and executed by `tests/verify-consumers.py`
using only package references. Creation defaults to a history-free initial snapshot.
Snapshot creation, full/deep validation and Reader access require no Git installation.
Use `History = HistoryMode.Git` for committed output; source selection is separate.

The internal managed Git snapshot candidate is gated off in release builds. In Git
history mode it supports current-file capture without `Scope`/`Depth`, including
correspondence, metadata, compression, descriptors and reverse indexes, with no Git
process or temporary Git repository. It captures the same current files and uses
the same normalization, ledger preparation and publication flow. Stream creation
still spools a private package before copying to the caller-owned stream. Import,
scope, depth and standalone deep validation keep using native Git. See the
[delta report](https://github.com/michal-ciechan/markdown-package/blob/master/docs/investigations/2026-09-12-card-0050-managed-delta-results.md)
for cross-file compression measurements. The managed writer uses full blobs or
smaller depth-one blob deltas; its independent verifier reconstructs and hashes
each delta. Native Git remains the default pending separate acceptance and review.

Directory creation (arguments: source directory, destination outside that directory):

```csharp
using Mdpkg.Core;

var request = new DirectoryPackageRequest(args[0], Guid.Parse("c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"));
var created = await new PackageBuilder().CreateFromDirectoryAsync(request, args[1]);
if (created.Status != OperationStatus.Success)
    throw new InvalidOperationException(string.Join("; ", created.Diagnostics.Select(d => d.Message)));
var validation = await new PackageValidator().ValidateFileAsync(args[1], new() { Deep = true });
if (!validation.IsConforming) throw new InvalidOperationException("Deep validation failed.");
Console.WriteLine(created.Identity!.Current.Id);
```

Memory creation and stream validation in explicit Git mode, with deterministic commit metadata:

```csharp
using Mdpkg.Core;
using System.Text;

var identity = new CommitIdentity("Example Author", "author@example.invalid",
    new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero));
var request = new SnapshotPackageRequest(
    Guid.Parse("c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"),
    [new("guide.md", Encoding.UTF8.GetBytes("# Guide\n\nHello.\n"))])
    { History = HistoryMode.Git, Metadata = new(identity, identity, "Initial package") };
using var output = new MemoryStream();
var created = await new PackageBuilder().CreateAsync(request, output);
if (created.Status != OperationStatus.Success) throw new InvalidOperationException("Creation failed.");
output.Position = 0;
var validation = await new PackageValidator().ValidateAsync(output, new() { Deep = true });
if (!validation.IsConforming) throw new InvalidOperationException("Deep validation failed.");
Console.WriteLine(validation.Package!.Sha256);
```

Snapshot mode forbids commit metadata, reverse indexes, scope, depth and Git import.
In explicit Git mode, omitted metadata uses `SnapshotMetadata.CliDefault`: author and
committer `mdpkg <mdpkg@example.invalid>`, 2000-01-01 UTC, message `Initial package`.
`CreationMode.GitImport`, optional positive `Depth`, and Git pathspec `Scope` retain
existing behavior when `History = HistoryMode.Git`. Git import preserves legacy metadata bytes while rewriting
trees/parents and removing invalidated signatures. Compression accepts 0–9, default 6;
data descriptors/reverse indexes default off. Only SHA-1 and the v1 profiles are supported.
Reserved-slot births intentionally mint random roots; otherwise fixed inputs, metadata,
Git and compression runtime versions give reproducible output.

`Correspondence` accepts `ConfirmedMove`, `ConfirmedRetirement`, and
`UnconfirmedRecord`, with `EntityRoot` and Reader's `DocumentLocator`.
`CorrespondenceCodec` reads/writes the existing correspondence JSON grammar; callers
own file I/O. Unconfirmed candidates never become bindings. Coverage is derived from
records and retained history. `RequireComplete` and `WarningPolicy.Fail` reject before
publication. Paths, Unicode collisions, links, reserved paths and containment are
always checked; no unsafe option exists.

Results contain typed status, diagnostics with MDPK code/severity/entry/message/spec,
checks actually performed, archive byte count/SHA-256/entry count, immutable manifest,
current identity (`CurrentState.Kind` and `.Id`), history mode, identity assurance and
optional Git history metadata. Snapshot validation reports Git-only checks as
`NotApplicable`; selective Reader opening exposes declared identity, and
`PackageArchive.VerifySnapshot` explicitly hashes every current file. Collections are independently owned; review
declarations are immutable `JsonElement` values, not live archive data. Core does not
validate review comment schemas. `ValidationResult.RequestedLevel`, `Checks`, package
typing tier and `IsConforming` are separate: skipped deep checks are never passed, and
accepting a recoverable container for inspection does not make it conforming.

Expected filesystem/Git failures return `EnvironmentFailure`; resource rejections return
`ResourceLimitExceeded`; invalid source, nonconformance and incomplete correspondence
have distinct statuses. Invalid API arguments throw `ArgumentException`, cancellation
throws `OperationCanceledException`, and unexpected implementation failures propagate.
All asynchronous operations accept a cancellation token. Configure Git executable and
private workspace parent through the service constructor's `EngineSettings`.

Input/output ownership and resources:

- Requests copy collection structure; keep supplied content buffers unchanged until
  creation finishes. Returned data remains usable after streams and services are gone.
- Streams remain open. Validation consumes from the current position, using a capped
  private spool for both seekable and non-seekable inputs. Output must be writable and
  initially empty at position zero where those properties can be checked.
- Creation stages and deep-validates before publication. Files use a flushed sibling
  staging file and final replacement. Stream copy failure/cancellation may leave a prefix
  that the caller must discard; success follows the final copy and flush.
- `ResourceOptions` defaults reuse Reader limits: 128 MiB archive/aggregate decoded
  bytes, 16 MiB ZIP directory/document, 1 MiB manifest/control member, 10,000 entries,
  JSON depth 32; source staging and each private spool default to 128 MiB. Source bytes
  include retained imported snapshots. Limits reject instead of truncating.
- Full validation indexes with Reader and reads members on demand with CRC/decoded
  limits; it does not eagerly load every archive payload. It still retains current-view
  data for inventory checks. Git output and temporary staging are bounded at operation
  boundaries, but native Git object generation, runtime allocations and concurrent
  workspaces consume additional memory/disk. These are not whole-process quotas.
- CLI explicitly selects `ResourceOptions.ProducerCompatibility`: ZIP32, fewer than
  65,535 entries, managed per-member limits, no service-level aggregate/source limit,
  JSON depth 64. These historical compatibility limits do not silently become Reader's
  smaller service defaults. A caller may select or customize either resource profile.

Reader retains the Unicode attribution and parser/compression dependency notices in
its MIT-licensed package. The shared release workflow publishes Reader before Core
and verifies fresh consumers against nuget.org alone.

`PackageUpdater.MaterializeAsync` takes a `MaterializePackageRequest` and a separate
output path. `UpdateAsync` takes `UpdatePackageRequest(inputPackage, sourceDirectory,
metadata)` with optional correspondence. Stream overloads retain caller ownership
and the documented final-copy limitation. Inputs are captured and validated before
work; completed output is independently Deep-validated before file replacement.
Materialization preserves S0's semantic header and exact files. Append carries the
base ledger, rejects a conflicting source ledger, and preserves partial intervals.
Supported Git append bases have a complete retained graph, original/materialized
root, and no transforms, shallow boundaries, range/patch evidence or projected source
endpoints. Re-emission of a valid Git input has no append restriction.

Deep validation returns `HistoryContext`, including a verified original snapshot
when origin exists. `GitHistoryBackend` implements Reader's explicit
`IHistoryVerificationBackend` without making Reader depend on Core. Context reuse
checks the target archive SHA-256 and length as well as typed identity. Pass that
context to Reader's `Resolve` to translate a verified S0 checkpoint and check all
intervening correspondence intervals. `OriginalSnapshot.HasOriginalArchiveBytes`
is false: reconstruction supplies exact state, not the original ZIP encoding or
its optional transport evidence. Reviews consumes these proof objects explicitly through
its mode-aware verification provider and reviewed/target history context.
