# Mdpkg.Reader

Read-only .NET 10 foundation for `.mdpkg`: bounded ZIP32 indexing and selective payload
decoding; canonical format checks; Unicode path rules; typed package identities and
locators; CommonMark source scopes, digests and current-view ledger resolution.

The package depends on Markdig and SharpZipLib. It has no CLI, package writer, native Git
process, network operation or review-schema dependency. `Mdpkg.Reviews` builds on it.
Creation and full/deep validation are available through `Mdpkg.Core`.

Install after the [public release gate](https://github.com/michal-ciechan/markdown-package/actions/workflows/publish-nuget.yml) succeeds:

```sh
dotnet add package Mdpkg.Reader --version 0.1.0-preview.2 --source https://api.nuget.org/v3/index.json
```

```csharp
using Mdpkg.Reader;
using var input = File.OpenRead(args[0]);
var snapshot = await PackageSnapshot.ReadAsync(input);
foreach (var path in snapshot.DocumentPaths)
    foreach (var scope in snapshot.GetScopes(path))
        Console.WriteLine($"{scope.Locator.Kind} {path}: {scope.Root} {scope.Digest}");
```

For selective access, use `PackageArchive.OpenAsync`, then `ReadEntry`. Opening validates
the authoritative ZIP directory, paths/extents, typing and selected manifest/history/ref
payloads. Other entries are CRC/decompression checked only when read. Container status
does not certify untouched payloads or Git graph/current-view agreement. Recoverable
typing requires explicit opt-in. `PackageSnapshot.ReadAsync` loads the bounded current
Markdown view and ledger, computes file corroboration, and caches scopes on demand.
Snapshot data remains usable after the input is disposed. No historical Git tree is
materialized; partial correspondence to a different reviewed commit returns history-required.

Streams remain caller-owned. Reading starts at the current position and advances it.
Non-seekable input is spooled to a private, size-limited, delete-on-close file; dispose
the archive to release it. Failed opens and cancellation remove spools. Archive instances
are not thread-safe. Cancellation is propagated, never converted to a malformed result.

Default `ReadLimits`: input 128 MiB, central directory 16 MiB, 10,000 entries, manifest/
history/ledger 1 MiB each, document 16 MiB, aggregate decoded entry reads 128 MiB, JSON
depth 32. Selected compressed input is bounded too (decoded cap plus 64 KiB overhead).
Repeated entry reads consume the aggregate budget. These are configurable service limits;
`ResourceLimitException` rejects excess data rather than truncating it. Package errors
use `PackageFormatException` with code/entry. Expected IO failures remain IO exceptions.

Unicode folding data retains its `UNICODE-LICENSE.txt`; the package includes MIT
license metadata, README and repository provenance. See the
[release guide](https://github.com/michal-ciechan/markdown-package/blob/master/docs/releases/mdpkg.md)
for the coordinated version, policy setup and public-feed acceptance gate.

Creation and full/deep producer validation are available separately in [Mdpkg.Core](https://github.com/michal-ciechan/markdown-package/blob/master/src/generator-cli/src/Mdpkg.Core/README.md).
Reader remains independently usable without Core or native Git. Core requires its
coordinated Reader version exactly; update them together.
