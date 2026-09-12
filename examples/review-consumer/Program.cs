using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.Reviews;

if (args.Length == 0) { Console.Error.WriteLine("Usage: ReviewConsumer <returned.mdpkg> [original.mdpkg] [--target target.mdpkg] [--newer] [--full] [--git]"); return 1; }
var full = args.Contains("--full", StringComparer.Ordinal);
IHistoryVerificationBackend? backend = args.Contains("--git", StringComparer.Ordinal) ? new GitHistoryBackend() : null;
var extractor = new ReviewExtractor();
using var returned = File.OpenRead(args[0]);
var review = await extractor.ExtractAsync(returned, new() { RequireFullVerification = full,
    VerificationProvider = full ? new ReviewVerificationProvider(backend) : null });
Console.WriteLine($"{review.Outcome}: {review.ContainerStatus}/{review.SchemaStatus}/{review.VerificationLevel}");
if (review.ReviewIdentity is { } artifact)
    Console.WriteLine($"Artifact: {artifact.Namespace} / {artifact.Current.Kind} / {artifact.Current.Id}");
if (review.ReviewedIdentity is { } reviewed)
    Console.WriteLine($"Reviewed: {reviewed.Identity.Namespace} / {reviewed.Identity.Current.Kind} / {reviewed.Identity.Current.Id}");
Console.WriteLine($"Required: {review.RequiredChecks}; completed: {review.CompletedChecks}; not applicable: {review.NotApplicableChecks}");
foreach (var diagnostic in review.Diagnostics) Console.Error.WriteLine(diagnostic);
var exitCode = review.Outcome == ReviewOutcome.Success ? 0 : 2;
IReadOnlyList<ReviewItem> items = review.Items;
var originalPath = args.Length > 1 && !args[1].StartsWith("--", StringComparison.Ordinal) ? args[1] : null;
var targetAt = Array.IndexOf(args, "--target");
if (targetAt == args.Length - 1) { Console.Error.WriteLine("--target needs an explicit path."); exitCode = 1; }
else if (originalPath is not null || targetAt >= 0)
{
    try
    {
        var original = originalPath is null ? default : await ReadContext(originalPath);
        var target = targetAt < 0 ? default : await ReadContext(args[targetAt + 1]);
        var resolved = await extractor.ResolveAsync(review, new(original.Snapshot, target.Snapshot,
            args.Contains("--newer", StringComparer.Ordinal), original.Proof, target.Proof));
        items = resolved.Items;
        Console.WriteLine("Correlation: " + resolved.Correlation);
        foreach (var diagnostic in resolved.Diagnostics) Console.Error.WriteLine(diagnostic);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PackageFormatException)
    { Console.Error.WriteLine("Source verification unavailable: " + ex.Message); exitCode = 2; }
}
// Verification and source failures never hide the authored feedback.
foreach (var item in items)
    Console.WriteLine($"{item.Kind} [{item.ThreadState}] {item.DeclaredDocumentPath} {item.TargetStatus}: {item.Body}");
return exitCode;

async Task<(PackageSnapshot? Snapshot, VerifiedHistoryContext? Proof)> ReadContext(string path)
{
    using var input = File.OpenRead(path);
    bool snapshot;
    VerifiedHistoryContext? proof = null;
    using (var archive = await PackageArchive.OpenAsync(input))
    {
        snapshot = archive.HistoryMode is SnapshotHistory;
        if (!snapshot && backend is not null) proof = await backend.VerifyAsync(archive);
    }
    input.Position = 0;
    return (await PackageSnapshot.ReadAsync(input, verifySnapshot: snapshot), proof);
}
