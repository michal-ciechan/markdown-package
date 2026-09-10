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
using only package references. Native `git` must be installed for creation and deep
validation. It is not required for full validation, Reader, or Reviews.

Directory creation (arguments: source directory, destination outside that directory):

```csharp
using Mdpkg.Core;

var request = new DirectoryPackageRequest(args[0], Guid.Parse("c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"));
var created = await new PackageBuilder().CreateFromDirectoryAsync(request, args[1]);
if (created.Status != OperationStatus.Success)
    throw new InvalidOperationException(string.Join("; ", created.Diagnostics.Select(d => d.Message)));
var validation = await new PackageValidator().ValidateFileAsync(args[1], new() { Deep = true });
if (!validation.IsConforming) throw new InvalidOperationException("Deep validation failed.");
Console.WriteLine(created.Identity!.Current);
```

Memory creation and stream validation, with explicit deterministic commit metadata:

```csharp
using Mdpkg.Core;
using System.Text;

var identity = new CommitIdentity("Example Author", "author@example.invalid",
    new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero));
var request = new SnapshotPackageRequest(
    Guid.Parse("c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8"),
    new(identity, identity, "Initial package"),
    [new("guide.md", Encoding.UTF8.GetBytes("# Guide\n\nHello.\n"))]);
using var output = new MemoryStream();
var created = await new PackageBuilder().CreateAsync(request, output);
if (created.Status != OperationStatus.Success) throw new InvalidOperationException("Creation failed.");
output.Position = 0;
var validation = await new PackageValidator().ValidateAsync(output, new() { Deep = true });
if (!validation.IsConforming) throw new InvalidOperationException("Deep validation failed.");
Console.WriteLine(validation.Package!.Sha256);
```

Directory snapshots default to `SnapshotMetadata.CliDefault`: author and committer
`mdpkg <mdpkg@example.invalid>`, 2000-01-01 UTC, message `Initial package`. Memory
requests require metadata explicitly. `CreationMode.GitImport`, optional positive
`Depth`, and Git pathspec `Scope` retain existing import behavior; snapshot scope and
depth remain supported. Git import preserves legacy metadata bytes while rewriting
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
current identity and history metadata. Collections are independently owned; review
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
