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
materialized. A different reviewed checkpoint returns an unconfirmed result before
ledger or digest matching: `history-unavailable` for snapshot targets,
`origin-unverified`/`origin-unavailable` for a snapshot checkpoint against Git, or
`history-required` for a different commit. A declared origin does not establish proof.

An explicit `IHistoryVerificationBackend` can supply `VerifiedHistoryContext`.
Its constructor is not public: it carries backend-verified origin, retained
membership and correspondence intervals, bound to the target's actual archive
SHA-256 and length. Pass it to `Resolve(..., history: context)` to use those facts;
an unrelated or re-emitted archive cannot reuse that proof. Reconstructed
`OriginalSnapshot` and `ReadOriginalEntry` supply exact original state, including
non-Markdown files. `HasOriginalArchiveBytes` is false for that reconstructed view;
its ZIP encoding and optional original transport evidence have not been recovered.

`PackageIdentity.Current` is a `CurrentState` with `Kind` (`snapshot` or `commit`) and
`Id`. The revised schema requires an explicit history mode. Selective opening reports
`IdentityAssurance.Declared`; it does not trust the declared snapshot digest as proof.
For history-free packages, call `PackageArchive.VerifySnapshot(cancellationToken)` to
read every current file, including non-Markdown files, the ledger and review document,
and verify the exact state hash. Success sets `Assurance` to `SnapshotVerified`.
`PackageSnapshot.ReadAsync(..., verifySnapshot: true)` captures bounded private bytes,
verifies the same complete snapshot, and returns owned scopes with that assurance.
This option requires snapshot mode; Git source assurance uses an explicit history
backend proof bound to the selected archive. The default read remains selective.
This explicit operation consumes the archive's remaining read budgets and needs no Git.

For loose author links, `snapshot.ResolveReference(uri, cancellationToken)` parses
strict v2 `mdpkg://` URIs and returns `LooseReferenceResolution`. Its `Category`
distinguishes `navigation`, `identity` and `capability`; `Status`/`Reason` retain
the browser's evidence outcomes, and `Scope` is present only for a live target.
Omitting `expect` selects the current locator without ledger/identity claims.
With `expect`, partial coverage always returns `unconfirmed /
incomplete-correspondence`, even when `at` equals current. A historical `at`,
commit, diff or hunk URI returns `unsupported / history-reader-required` and
never falls forward. Retirement successor roots are not locators. The existing
review-oriented `Resolve(PackageIdentity, ...)` accepts the typed current identity.

Shared executable cases are in `docs/spec/link-fixtures.json`. This API works
on the already bounded snapshot; it does not change snapshot loading to a
single-document read, implement relative Markdown fragment lookup, or generate
author links. `SourceScope.Root` remains a default root; authoring must select
the live ledger root (the browser's `referenceFor` does this).

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
