using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.Reviews;

var directory = Path.GetFullPath(args[0]);
var assertions = 0;
void Require(bool condition, string message) { assertions++; if (!condition) throw new Exception(message); }
string FileAt(string name) => Path.Combine(directory, name + ".mdpkg");
async Task<(PackageSnapshot Snapshot, VerifiedHistoryContext? Proof)> Context(string name)
{
    using var input = File.OpenRead(FileAt(name));
    using var archive = await PackageArchive.OpenAsync(input);
    var git = archive.HistoryMode is GitHistory;
    var proof = git ? await new GitHistoryBackend().VerifyAsync(archive) : null;
    input.Position = 0;
    return (await PackageSnapshot.ReadAsync(input, verifySnapshot: !git), proof);
}
var extractor = new ReviewExtractor();
foreach (var mode in new[] { "snapshot", "git" })
{
    var observed = JsonNode.Parse(File.ReadAllText(Path.Combine(directory, mode + "-browser.json")))!;
    using var input = File.OpenRead(FileAt(mode + "-review"));
    var validation = await new PackageValidator(new("absent-git-acceptance")).ValidateAsync(input, new() { Deep = true });
    Require(validation.IsConforming && validation.Assurance == IdentityAssurance.SnapshotVerified, "Core full review validation");
    Require(validation.Identity!.Current.Id == observed["manifest"]!["current"]!["id"]!.GetValue<string>(), "Browser/Core state hash");
    input.Position = 0;
    var review = await extractor.ExtractAsync(input, new() { RequireFullVerification = true, VerificationProvider = new ReviewVerificationProvider() });
    Require(review.VerificationLevel == VerificationLevel.Full && review.CompletedChecks == review.RequiredChecks, "Reviews full obligations");
    Require(review.ReviewIdentity == validation.Identity, "Core/Reviews identity");
    var source = await Context(mode);
    Require(review.ReviewedIdentity!.Identity == source.Snapshot.Identity, "Typed CLI source identity");
    var exact = await extractor.ResolveAsync(review, new(source.Snapshot, ReviewedHistory: source.Proof));
    Require(exact.Correlation == CorrelationStatus.Exact && exact.Items.Count == 1, "Exact reviewed context");
    Require(exact.Items[0].TargetStatus == TargetStatus.TargetIntact && exact.Items[0].ResolvedLocation is not null, "Exact selector");
    Require(exact.Items[0].Body == "Explain these words." && exact.Items[0].CommentId.ToString() == observed["comments"]!["threads"]![0]!["comments"]![0]!["id"]!.GetValue<string>(), "Authored feedback and UUID survive");
    if (mode == "snapshot")
    {
        var materialized = await Context("materialized");
        var proof = materialized.Proof!;
        Require(proof.OriginalSnapshot!.Identity == source.Snapshot.Identity, "Origin reconstructs exact S0");
        Require(proof.GetRelationship(source.Snapshot.Identity.Current).Status == CheckpointStatus.Verified, "S0/C0 relationship");
        var reconstructed = await extractor.ResolveAsync(review, new(TargetHistory: proof));
        Require(reconstructed.Correlation == CorrelationStatus.Reconstructed && reconstructed.Items[0].ResolvedLocation!.Range == exact.Items[0].ResolvedLocation!.Range, "Origin and supplied S0 selectors agree");
        var c0 = await extractor.ResolveAsync(review, new(Target: materialized.Snapshot, UseNewerTarget: true, TargetHistory: proof));
        Require(c0.Correlation == CorrelationStatus.NewerTarget && c0.Items[0].TargetStatus == TargetStatus.TargetIntact, "Review resolves onto materialized C0");
        var child = await Context("child");
        Require(child.Proof!.OriginalSnapshot!.Identity == source.Snapshot.Identity, "C1 retains S0 origin");
        var refused = await extractor.ResolveAsync(review, new(Target: child.Snapshot, TargetHistory: child.Proof));
        Require(refused.Correlation == CorrelationStatus.WrongSnapshot && refused.Items[0].ResolvedLocation is null && refused.Items[0].Body == exact.Items[0].Body, "No implicit newer-target selection");
        var selected = await extractor.ResolveAsync(review, new(Target: child.Snapshot, UseNewerTarget: true, TargetHistory: child.Proof));
        Require(selected.Correlation == CorrelationStatus.NewerTarget && selected.Items[0].ResolvedLocation is not null && selected.Items[0].Body == exact.Items[0].Body, "Explicit C1 resolution preserves feedback");
        Require(selected.Items[0].TargetStatus is TargetStatus.TargetIntact or TargetStatus.TargetRelocated, "C1 quote survives");
    }
}
Console.WriteLine($"Integrated CLI/browser/Core/Reader/Reviews: {assertions} assertions passed; 0 failures.");
