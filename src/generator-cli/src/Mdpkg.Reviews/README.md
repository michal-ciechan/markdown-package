# Mdpkg.Reviews

Extract review comments and authored change requests from returned `.mdpkg` files in
.NET 10. The only direct package dependency is **Mdpkg.Reader**; there is no Core, CLI,
native Git, network, model SDK, writer or automatic edit application.

## External consumer

From the repository root, build a local feed and restore the standalone example:

```powershell
dotnet pack src/generator-cli/src/Mdpkg.Reader -c Release -o src/generator-cli/artifacts/package
dotnet pack src/generator-cli/src/Mdpkg.Core -c Release -o src/generator-cli/artifacts/package
dotnet pack src/generator-cli/src/Mdpkg.Reviews -c Release -o src/generator-cli/artifacts/package
dotnet restore examples/review-consumer --configfile examples/review-consumer/NuGet.Config
dotnet run --no-restore --project examples/review-consumer -- docs/spec/review-fixtures/delta-v2.mdpkg docs/spec/review-fixtures/original.mdpkg
python src/generator-cli/tests/verify-consumers.py
```

The example explicitly references coordinated Reviews and Core packages. Core supplies
the optional native Git backend selected by `--git`; Reviews itself depends only on Reader.
Use `--full` to verify the review artifact, and `--target file --newer --git` to resolve
onto a verified Git target, reconstructing S0 through origin if needed. Source failures
still print the authored feedback. No authoring UI or bundled writer is provided.

Snapshot-only application code needs just Reviews (the optional second argument is
the exact original snapshot file; `--full` needs no external source or Git):

```csharp
using Mdpkg.Reader;
using Mdpkg.Reviews;

var extractor = new ReviewExtractor();
using var returned = File.OpenRead(args[0]);
var full = args.Contains("--full", StringComparer.Ordinal);
var review = await extractor.ExtractAsync(returned, new() { RequireFullVerification = full,
    VerificationProvider = full ? new ReviewVerificationProvider() : null });
Console.WriteLine($"{review.Outcome}: {review.ContainerStatus}/{review.SchemaStatus}/{review.VerificationLevel}");
if (review.Outcome != ReviewOutcome.Success)
{
    foreach (var diagnostic in review.Diagnostics) Console.Error.WriteLine(diagnostic);
}
IReadOnlyList<ReviewItem> items = review.Items;
if (args.Length > 1 && !args[1].StartsWith("--", StringComparison.Ordinal))
{
    using var original = File.OpenRead(args[1]);
    var snapshot = await PackageSnapshot.ReadAsync(original, verifySnapshot: true);
    var resolved = await extractor.ResolveAsync(review, new(ReviewedSnapshot: snapshot));
    items = resolved.Items;
    Console.WriteLine("Correlation: " + resolved.Correlation);
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
provider accepts every applicable obligation derived by Reviews from parsed mode and origin.
`RequiredChecks`, `CompletedChecks` and `NotApplicableChecks` expose that distinction.
Snapshot identity replaces Git integrity in snapshot mode; Git origin adds a bootstrap
verification obligation. A provider cannot narrow the required mask or earn Full by
echoing check flags: Reader must actually verify the snapshot, or an S3 history proof
must match the archive bytes, length and typed identity. Nonapplicable Git checks cannot
be reported as passed. Parsing and verification use one private, bounded byte capture.

`ReviewVerificationProvider` verifies snapshots through Reader and accepts an explicit
`IHistoryVerificationBackend` for Git packages, such as Core's `GitHistoryBackend`.
Missing Git, failed required checks and forged bundles prevent Full. Delta verification
checks the review artifact itself; external source/selector validity is a separate question.
The backend must impose CPU/temp-disk/subprocess budgets in addition to archive limits.

`ResolveAsync` consumes backend-selected `PackageSnapshot` data, never paths/URLs from
dispatch fields. Exact correlation requires namespace, state kind and state ID. Optional
package digest/length differences report re-emission, not identity failure. A newer
target requires `UseNewerTarget: true`, the same namespace and the exact reviewed snapshot
as context, or S0 reconstructed from verified origin. C0 is a different target key from S0
and still needs explicit selection. Supply `ReviewedHistory`/`TargetHistory` as S3 proof
objects; there is no caller-set Full flag. Git proofs must match the actual archive bytes.
Snapshot source reads use `PackageSnapshot.ReadAsync(..., verifySnapshot: true)`; selective
unverified source reads cannot produce verified selector/location claims. A missing origin,
wrong original, incomplete correspondence or non-selected target preserves all feedback
with explicit failure statuses. Original reconstruction supplies state, not original ZIP
bytes: correlation is `Reconstructed` and optional transport evidence remains unavailable.
Selector algorithms, authored kinds and reply ordering remain unchanged.

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
