# Mdpkg.Reviews

Extract review comments and authored change requests from returned `.mdpkg` files in
.NET 10. The only direct package dependency is **Mdpkg.Reader**; there is no Core, CLI,
native Git, network, model SDK, writer or automatic edit application.

## External consumer

From the repository root, build a local feed and restore the standalone example:

```powershell
dotnet pack src/generator-cli/src/Mdpkg.Reader -c Release -o src/generator-cli/artifacts/package
dotnet pack src/generator-cli/src/Mdpkg.Reviews -c Release -o src/generator-cli/artifacts/package
dotnet restore examples/review-consumer --configfile examples/review-consumer/NuGet.Config
dotnet run --no-restore --project examples/review-consumer -- docs/spec/review-fixtures/delta-v2.mdpkg docs/spec/review-fixtures/original.mdpkg
python src/generator-cli/tests/verify-consumers.py
```

The example has only `<PackageReference Include="Mdpkg.Reviews" Version="0.1.0-preview.2" />`.
Equivalent application code (optional second argument is the backend's exact reviewed file):

```csharp
using Mdpkg.Reader;
using Mdpkg.Reviews;

var extractor = new ReviewExtractor();
using var returned = File.OpenRead(args[0]);
var review = await extractor.ExtractAsync(returned);
Console.WriteLine($"{review.Outcome}: {review.ContainerStatus}/{review.SchemaStatus}/{review.VerificationLevel}");
if (review.Outcome != ReviewOutcome.Success)
{
    foreach (var diagnostic in review.Diagnostics) Console.Error.WriteLine(diagnostic);
    return;
}
IReadOnlyList<ReviewItem> items = review.Items;
if (args.Length > 1)
{
    using var original = File.OpenRead(args[1]);
    var snapshot = await PackageSnapshot.ReadAsync(original);
    var resolved = await extractor.ResolveAsync(review, new(ReviewedSnapshot: snapshot));
    items = resolved.Items;
}
foreach (var item in items)
    Console.WriteLine($"{item.Kind} [{item.ThreadState}] {item.DeclaredDocumentPath} {item.TargetStatus}: {item.Body}");
```

## Contract and assurance

`ExtractAsync` needs no original and never invokes CommonMark just to read feedback.
It returns all comments/replies in source order, including resolved/obsolete threads.
V1 intent is `Unspecified / LegacyV1`; v2 requires per-comment `comment` or
`change-request` and reports `AuthoredV2`. Bodies are authored prose, not executable
patches; author/timestamp/dispatch are untrusted claims, never authenticated identity.
Unknown non-semantic extension properties are preserved within the JSON budget.

Outcomes distinguish `NotReview`, `Malformed`, `UnsupportedVersionOrProfile`,
`ResourceLimitExceeded`, `VerificationUnavailable`, `VerificationFailed` and IO-related
`EnvironmentFailure`. A valid empty review succeeds with zero items. Cancellation throws.
Only `.mdpkg/review/comments.json` is currently supported as the declared detail path.

`ContainerStatus`, `SchemaStatus`, `VerificationLevel` and `Checks` say what ran.
Default **Structural** verifies ZIP metadata, canonical manifest/history/reference and
comments payloads/schema, not every payload, Git object, retained correspondence range,
or delta/bundled lineage claim. Untouched pack corruption can remain undetected at this
level. `RequireFullVerification = true` fails explicitly when no
`IReviewVerificationProvider` is supplied. Full is reported only when the injected
provider accepts all payload, Git integrity, current-view and review-lineage obligations.
The provider receives bounded package access and cancellation; it must additionally impose
its own CPU/temp-disk/subprocess budgets. No provider implementation ships in this card.

`ResolveAsync` consumes backend-selected `PackageSnapshot` data, never paths/URLs from
dispatch fields. Exact correlation requires both namespace and current commit. Optional
package digest/length differences report re-emission, not identity failure. A newer
target requires `UseNewerTarget: true`, the same namespace and the exact reviewed snapshot
as context. Without it, feedback is preserved with `HistoryRequired`; partial coverage
to a different commit also needs history. Historical range proof/materialization is not
implemented. Bundled current views require caller-established full context verification;
extraction never silently adopts a returned bundle as the trusted original.

Declared paths/trails are always available. Verified locations are separate and nullable.
The resolver follows ledger identity before looking at text, verifies original selectors,
and searches only a live changed scope. A strict quote/context winner relocates; missing
or tied quotes detach, without occurrence fallback. Dead split/merge/deletion records
retain successor navigation without searching it. Offsets and context lengths are UTF-16
code units over canonical scope source; ranges are half-open and cannot split surrogates.
Resolved `ScopeDocumentStart` refers to LF-normalized document source; `Range` is relative
to the canonical scope, never an invented original-file line number.

## Resources and compatibility

`ReviewReadOptions` defaults: Reader's 128 MiB input/spool and decoded aggregate, 16 MiB
directory, 10,000 entries, 1 MiB manifest/history/ledger, JSON depth 32, plus 8 MiB decoded
comments, 5,000 threads, 20,000 comments, 64 KiB UTF-8 per body. Resolution uses Reader's
16 MiB/document cap. Unknown extension data counts toward JSON/payload limits. Reader
scopes are cached per document; each thread is resolved once and projected onto replies.
Results own their data after streams/archives are disposed; caller streams remain open.
Package SHA-256 provenance is opt-in via `ComputePackageDigest`, since it reads the whole
file. An extraction never silently truncates feedback to satisfy a cap.

Independent fixtures measure 3,229–5,663 bytes/package and two comments/review; they justify
small-fixture interoperability, not throughput claims at the configured limits. Limits
are explicit configurable backend ceilings with rejection tests. Validate deployment
budgets against real workloads. The accepted wire contract and fixtures are in
`docs/spec.md` §6.8 and `docs/spec/review-fixtures/`. Web authoring/export and public-feed
publishing are separate work; these are local preview packages.

Creation and full/deep producer validation are available separately in [Mdpkg.Core](../Mdpkg.Core/README.md).
This package remains independently usable without Core or native Git. Core requires its
coordinated Reader build exactly; these local previews are not a public release train.
