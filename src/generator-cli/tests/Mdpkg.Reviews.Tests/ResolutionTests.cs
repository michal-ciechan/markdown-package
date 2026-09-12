using System.Text.Json.Nodes;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class ResolutionTests
{
    private static async Task<PackageSnapshot> Snapshot(string name = "original.mdpkg")
    { using var input = Fixtures.Stream(name); return await PackageSnapshot.ReadAsync(input, cancellationToken: TestContext.Current.CancellationToken); }
    private static async Task<ReviewExtractionResult> Review(byte[]? bytes = null)
    {
        using var input = bytes is null ? Fixtures.Stream() : new MemoryStream(bytes);
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(result.Outcome == ReviewOutcome.Success, string.Join(";", result.Diagnostics)); return result;
    }
    private static async Task<PackageSnapshot> Changed(Action<Dictionary<string, byte[]>> mutate)
    {
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("changed.mdpkg"), mutate));
        return await PackageSnapshot.ReadAsync(input, cancellationToken: TestContext.Current.CancellationToken);
    }
    [Theory]
    [InlineData("original.mdpkg", IdentityStatus.Survives, TargetStatus.TargetIntact, "guide.md")]
    [InlineData("changed.mdpkg", IdentityStatus.FlaggedChanged, TargetStatus.TargetRelocated, "guide.md")]
    [InlineData("moved.mdpkg", IdentityStatus.Survives, TargetStatus.TargetIntact, "moved.md")]
    public async Task ExactCheckpointResolvesButNewerTargetsNeedRelationshipEvidence(string file, IdentityStatus identity, TargetStatus target, string path)
    {
        var review = await Review(); var original = await Snapshot(); var selected = await Snapshot(file);
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, selected, UseNewerTarget: file != "original.mdpkg"), TestContext.Current.CancellationToken);
        Assert.All(result.Items, i =>
        {
            if (file != "original.mdpkg")
            {
                Assert.Equal(IdentityStatus.Unconfirmed, i.IdentityStatus); Assert.Equal(TargetStatus.Unconfirmed, i.TargetStatus);
                Assert.Equal("origin-unverified", i.Reason); Assert.Null(i.ResolvedLocation);
                // Current ledger/digest behavior still works when no cross-checkpoint claim is made.
                var anchor = review.Threads.First(t => t.Id == i.ThreadId).Anchor;
                var current = selected.Resolve(selected.Identity, anchor.Root, anchor.Expect, anchor.Locator, TestContext.Current.CancellationToken);
                Assert.Equal(identity, current.Status); Assert.Equal(path, current.Scope!.Locator.DocumentPath);
                return;
            }
            Assert.Equal(identity, i.IdentityStatus); Assert.Equal(target, i.TargetStatus); Assert.Equal(path, i.ResolvedLocation!.Locator.DocumentPath);
            Assert.Equal("guide.md", i.DeclaredDocumentPath); Assert.Equal(PackageProfiles.OffsetUnits, i.ResolvedLocation.Range!.Units);
        });
        Assert.Equal(result.Items[0].ResolvedLocation, result.Items[1].ResolvedLocation);
        Assert.Equal(ThreadState.Open, result.Items[0].ThreadState);
    }
    [Theory]
    [InlineData("none", CorrelationStatus.OriginalUnavailable, TargetStatus.TargetUnavailable)]
    [InlineData("newer-not-selected", CorrelationStatus.WrongSnapshot, TargetStatus.Invalidated)]
    [InlineData("missing-original", CorrelationStatus.OriginalUnavailable, TargetStatus.HistoryRequired)]
    [InlineData("wrong-original", CorrelationStatus.WrongSnapshot, TargetStatus.Invalidated)]
    public async Task UnavailableOrWrongSnapshotsNeverFabricateLocations(string scenario, CorrelationStatus correlation, TargetStatus status)
    {
        var review = await Review(); var changed = await Snapshot("changed.mdpkg");
        var context = scenario switch { "none" => new ReviewedPackageContext(), "newer-not-selected" => new(null, changed),
            "missing-original" => new(null, changed, true), _ => new(changed) };
        var result = await new ReviewExtractor().ResolveAsync(review, context, TestContext.Current.CancellationToken);
        Assert.Equal(correlation, result.Correlation); Assert.Equal(2, result.Items.Count);
        Assert.All(result.Items, i => { Assert.Null(i.ResolvedLocation); Assert.Equal(status, i.TargetStatus); Assert.NotEmpty(i.Body); });
    }
    [Fact]
    public async Task ReemissionIsEvidenceAndDispatchNeverOverridesTheIdentityPair()
    {
        var original = await Snapshot();
        var review = await Review(Fixtures.Manifest(n => { n["review"]!["of"]!["packageDigest"] = "sha256-" + new string('0', 64); n["review"]!["of"]!["packageBytes"] = 1; }));
        var result = await new ReviewExtractor().ResolveAsync(review, new(original), TestContext.Current.CancellationToken);
        Assert.Equal(CorrelationStatus.Reemitted, result.Correlation); Assert.Equal(TargetStatus.TargetIntact, result.Items[0].TargetStatus);
        review = await Review(Fixtures.Manifest(n => { n["review"]!["of"]!["namespace"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }));
        result = await new ReviewExtractor().ResolveAsync(review, new(original), TestContext.Current.CancellationToken);
        Assert.Equal(CorrelationStatus.WrongLineage, result.Correlation); Assert.Null(result.Items[0].ResolvedLocation);
    }
    [Theory]
    [InlineData("quote")][InlineData("offset")][InlineData("surrogate")][InlineData("expect")][InlineData("context")]
    public async Task EqualDigestDoesNotMakeAnUnverifiedSelectorValid(string mutation)
    {
        var original = await Snapshot();
        var bytes = Fixtures.Review(n =>
        {
            var t = n["threads"]![0]!; var s = t["select"]!;
            if (mutation == "quote") s["quote"] = "false phrase";
            if (mutation == "offset") { s["start"] = 999; s["end"] = 1011; }
            if (mutation == "surrogate") { s["start"] = 16; s["end"] = 28; }
            if (mutation == "expect") t["expect"] = new string('0', 64);
            if (mutation == "context") s["prefix"] = "wrong";
        });
        var review = await Review(bytes);
        var result = await new ReviewExtractor().ResolveAsync(review, new(original), TestContext.Current.CancellationToken);
        Assert.Equal(TargetStatus.Invalidated, result.Items[0].TargetStatus); Assert.Null(result.Items[0].ResolvedLocation);
        Assert.Equal(2, result.Items.Count);
    }
    [Fact]
    public async Task NonBmpQuoteAndCombiningTextUseUtf16WithoutSplittingSurrogates()
    {
        var original = await Snapshot(); var source = Fixtures.Json("vectors.json")["source"]!.GetValue<string>();
        var quote = "😀 before e\u0301"; var start = source.IndexOf(quote, StringComparison.Ordinal);
        var review = await Review(Fixtures.Review(n => n["threads"]![0]!["select"] = new JsonObject
        { ["start"] = start, ["end"] = start + quote.Length, ["quote"] = quote, ["occurrence"] = 0, ["prefix"] = source[..start], ["suffix"] = " target words." }));
        var result = await new ReviewExtractor().ResolveAsync(review, new(original), TestContext.Current.CancellationToken);
        Assert.Equal(TargetStatus.TargetIntact, result.Items[0].TargetStatus);
        Assert.Equal(quote.Length, result.Items[0].ResolvedLocation!.Range!.End - result.Items[0].ResolvedLocation!.Range!.Start);
    }
    [Theory]
    [InlineData("winner")][InlineData("tie")][InlineData("missing")]
    public async Task UnverifiedCheckpointStopsBeforeAnyQuoteRelocation(string kind)
    {
        var original = await Snapshot(); var review = await Review(); var s = review.Threads[0].Anchor.Selector;
        var target = await Changed(e => e["guide.md"] = Profile.Utf8.GetBytes(kind switch
        {
            "winner" => "# Guide\n\nno context target words elsewhere\nIntro 😀 before e\u0301 target words.\n\n## Usage\n\nUse the tool.\n",
            "tie" => "# Guide\n\na target words x\na target words x\n",
            _ => "# Guide\n\nNo matching text.\n"
        }));
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, target, true), TestContext.Current.CancellationToken);
        Assert.Equal(TargetStatus.Unconfirmed, result.Items[0].TargetStatus); Assert.Equal(IdentityStatus.Unconfirmed, result.Items[0].IdentityStatus);
        Assert.Equal("origin-unverified", result.Items[0].Reason); Assert.Null(result.Items[0].ResolvedLocation);
    }
    [Theory]
    [InlineData("deleted")][InlineData("split")][InlineData("merge")]
    public async Task RetirementsAndReservedBirthNeverSearchSuccessorsOrOtherDocuments(string dead)
    {
        var original = await Snapshot(); var review = await Review(); var root = review.Threads[0].Anchor.Root;
        var successor = new string('a', 64);
        var target = await Changed(e =>
        {
            var manifest = JsonNode.Parse(e[Profile.Manifest])!; manifest["addressing"]!["overrides"] = Profile.Ledger; e[Profile.Manifest] = CanonicalJson.Bytes(manifest, true);
            e[Profile.Ledger] = CanonicalJson.Bytes(new JsonObject { ["version"] = 1, ["anchor"] = Profile.Anchor, ["entries"] = new JsonObject
            { [root] = new JsonObject { ["dead"] = dead, ["next"] = new JsonArray(successor) }, [successor] = new JsonObject { ["to"] = new JsonArray("section", "guide.md", new JsonArray(new JsonArray("# Guide", 0))) } } });
            e["other.md"] = Fixtures.Bytes("comments-v2.json"); // Contains the quote too; never searched.
        });
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, target, true), TestContext.Current.CancellationToken);
        var item = result.Items[0]; Assert.Equal(IdentityStatus.Unconfirmed, item.IdentityStatus); Assert.Equal(TargetStatus.Unconfirmed, item.TargetStatus);
        Assert.Null(item.ResolvedLocation); Assert.Empty(item.Successors!); Assert.Equal("origin-unverified", item.Reason);
        var anchor = review.Threads[0].Anchor;
        var current = target.Resolve(target.Identity, root, anchor.Expect, anchor.Locator, TestContext.Current.CancellationToken);
        Assert.Equal(IdentityStatus.FlaggedChanged, current.Status); Assert.Null(current.Scope);
        Assert.Equal(successor, Assert.Single(current.Successors!)); Assert.Equal(dead, current.Reason);
    }
    [Fact]
    public async Task PartialCoverageRequiresHistoryEvenWhenQuoteAndDigestMatch()
    {
        var original = await Snapshot(); var review = await Review();
        var target = await Changed(e =>
        {
            var manifest = JsonNode.Parse(e[Profile.Manifest])!; manifest["addressing"]!["coverage"] = "partial"; e[Profile.Manifest] = CanonicalJson.Bytes(manifest, true);
            var history = JsonNode.Parse(e[Profile.History])!; history["addressingCoverage"]![0]!["coverage"] = "partial"; e[Profile.History] = CanonicalJson.Bytes(history);
            e["guide.md"] = Profile.Utf8.GetBytes(Fixtures.Json("vectors.json")["source"]!.GetValue<string>());
        });
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, target, true), TestContext.Current.CancellationToken);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Items[0].IdentityStatus); Assert.Equal(TargetStatus.Unconfirmed, result.Items[0].TargetStatus);
        Assert.Equal("origin-unverified", result.Items[0].Reason);
        Assert.Null(result.Items[0].ResolvedLocation);
    }
    [Fact]
    public async Task MissingOverrideCannotBeRepairedBySearchingForTheQuote()
    {
        var original = await Snapshot(); var review = await Review(Fixtures.Review(n => n["threads"]![0]!["root"] = new string('f', 64)));
        var result = await new ReviewExtractor().ResolveAsync(review, new(original), TestContext.Current.CancellationToken);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Items[0].IdentityStatus); Assert.Null(result.Items[0].ResolvedLocation);
        Assert.Equal("missing-override", result.Items[0].Reason);
    }
    [Fact]
    public async Task UnknownOriginalIdentityCannotBePromotedByQuoteMatchingInANewerTarget()
    {
        var review = await Review(Fixtures.Bytes("delta-snapshot-target-commit.mdpkg")); var root = review.Threads[0].Anchor.Root;
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("original-git.mdpkg"), e =>
        {
            var manifest = JsonNode.Parse(e[Profile.Manifest])!; manifest["addressing"]!["coverage"] = "partial";
            manifest["addressing"]!["overrides"] = Profile.Ledger; e[Profile.Manifest] = CanonicalJson.Bytes(manifest, true);
            var history = JsonNode.Parse(e[Profile.History])!; history["addressingCoverage"]![0]!["coverage"] = "partial"; e[Profile.History] = CanonicalJson.Bytes(history);
            e[Profile.Ledger] = CanonicalJson.Bytes(new JsonObject { ["version"] = 1, ["anchor"] = Profile.Anchor,
                ["entries"] = new JsonObject { [root] = new JsonObject { ["unknown"] = "unconfirmed-removal" } } });
        }));
        var original = await PackageSnapshot.ReadAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, await Snapshot("changed.mdpkg"), true), TestContext.Current.CancellationToken);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Items[0].IdentityStatus); Assert.Null(result.Items[0].ResolvedLocation);
        Assert.Equal("unconfirmed-removal", result.Items[0].Reason);
    }
    [Fact]
    public async Task BundledCurrentViewIsNotAnAutomaticallyTrustedOriginal()
    {
        var review = await Review(); var bundle = await Snapshot("bundled-v2.mdpkg"); var original = await Snapshot();
        var result = await new ReviewExtractor().ResolveAsync(review, new(original, bundle, true), TestContext.Current.CancellationToken);
        Assert.Equal(TargetStatus.VerificationUnavailable, result.Items[0].TargetStatus); Assert.Null(result.Items[0].ResolvedLocation);
    }
    [Fact]
    public async Task CancellationPropagatesThroughExtractionAndResolution()
    {
        using var token = new CancellationTokenSource(); token.Cancel();
        using var input = Fixtures.Stream();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new ReviewExtractor().ExtractAsync(input, cancellationToken: token.Token));
        var review = await Review();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new ReviewExtractor().ResolveAsync(review, new(), token.Token));
    }
}
