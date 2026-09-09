using Mdpkg.Reader;
using Mdpkg.Reviews;

if (args.Length == 0) { Console.Error.WriteLine("Usage: ReviewConsumer <returned.mdpkg> [reviewed-original.mdpkg] [--full]"); return 1; }
var extractor = new ReviewExtractor();
using var returned = File.OpenRead(args[0]);
var review = await extractor.ExtractAsync(returned, new() { RequireFullVerification = args.Contains("--full", StringComparer.Ordinal) });
Console.WriteLine($"{review.Outcome}: {review.ContainerStatus}/{review.SchemaStatus}/{review.VerificationLevel}");
if (review.Outcome != ReviewOutcome.Success)
{
    foreach (var diagnostic in review.Diagnostics) Console.Error.WriteLine(diagnostic);
    return review.Outcome == ReviewOutcome.VerificationUnavailable ? 2 : 1;
}
IReadOnlyList<ReviewItem> items = review.Items;
if (args.Length > 1 && args[1] != "--full")
{
    using var original = File.OpenRead(args[1]);
    var snapshot = await PackageSnapshot.ReadAsync(original);
    var resolved = await extractor.ResolveAsync(review, new(ReviewedSnapshot: snapshot));
    items = resolved.Items;
    Console.WriteLine("Correlation: " + resolved.Correlation);
}
foreach (var item in items)
    Console.WriteLine($"{item.Kind} [{item.ThreadState}] {item.DeclaredDocumentPath} {item.TargetStatus}: {item.Body}");
return 0;
