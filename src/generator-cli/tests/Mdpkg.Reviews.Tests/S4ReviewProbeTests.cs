using System.Text;
using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class S4ReviewProbeTests
{
    [Fact]
    public async Task GitProofCannotMatchScopesReadBeforeArchiveBytesChange()
    {
        var ct = TestContext.Current.CancellationToken;
        var good = Fixtures.Bytes("original-git.mdpkg");
        var proof = await Proof("original-git.mdpkg", ct);
        var bad = Fixtures.Rewrite(good, entries =>
            entries["guide.md"] = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(entries["guide.md"]).Replace("target words", "INJECTED target words", StringComparison.Ordinal)));
        using var changing = new ChangeAtHashStream(bad, good);
        var target = await PackageSnapshot.ReadAsync(changing, cancellationToken: ct);
        Assert.True(changing.Changed);
        // Capturing before parsing can observe either version, but a proof for the
        // authentic bytes must never certify scopes from the injected version.
        if (proof.Matches(target))
        {
            using var authenticInput = new MemoryStream(good);
            var authentic = await PackageSnapshot.ReadAsync(authenticInput, cancellationToken: ct);
            Assert.Equal(authentic.GetScopes("guide.md", ct).Select(s => s.CanonicalSource),
                target.GetScopes("guide.md", ct).Select(s => s.CanonicalSource));
        }
        else Assert.Contains("INJECTED", target.GetScopes("guide.md", ct)[0].CanonicalSource, StringComparison.Ordinal);
    }

    private sealed class ChangeAtHashStream : MemoryStream
    {
        private readonly byte[] good;
        public bool Changed { get; private set; }
        public ChangeAtHashStream(byte[] bad, byte[] good)
        { this.good = good; Write(bad); Position = 0; }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            // Before the fix, synchronous ZIP reads preceded the first async read
            // (hashing). With capture first, this replacement precedes all parsing.
            if (!Changed) { SetLength(0); Write(good); Position = 0; Changed = true; }
            return base.ReadAsync(buffer, cancellationToken);
        }
    }

    [Theory]
    [InlineData("delta-v2.mdpkg", false)]
    [InlineData("delta-snapshot-target-commit.mdpkg", true)]
    [InlineData("delta-git-target-snapshot.mdpkg", false)]
    [InlineData("delta-git-target-commit.mdpkg", true)]
    public async Task AllFourDeltaCombinationsResolveVerifiedOriginal(string file, bool gitSource)
    {
        var ct = TestContext.Current.CancellationToken;
        var extractor = new ReviewExtractor();
        using var reviewInput = Fixtures.Stream(file);
        var review = await extractor.ExtractAsync(reviewInput, new() { VerificationProvider = new ReviewVerificationProvider(new GitHistoryBackend()) }, ct);
        Assert.Equal(VerificationLevel.Full, review.VerificationLevel);
        var source = gitSource ? "original-git.mdpkg" : "original.mdpkg";
        using var originalInput = Fixtures.Stream(source);
        var original = await PackageSnapshot.ReadAsync(originalInput, cancellationToken: ct, verifySnapshot: !gitSource);
        var proof = gitSource ? await Proof(source, ct) : null;
        var resolved = await extractor.ResolveAsync(review, new(original, ReviewedHistory: proof), ct);
        Assert.Equal(CorrelationStatus.Exact, resolved.Correlation);
        Assert.Equal(2, resolved.Items.Count);
        Assert.All(resolved.Items, item => Assert.Equal(TargetStatus.TargetIntact, item.TargetStatus));
    }

    [Fact]
    public async Task FullCannotReuseProofForOtherEncodingOfSameReview()
    {
        var ct = TestContext.Current.CancellationToken;
        var proof = await Proof("delta-git-target-snapshot.mdpkg", ct);
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("delta-git-target-snapshot.mdpkg"), _ => { }));
        var result = await new ReviewExtractor().ExtractAsync(input, new() { VerificationProvider = new BorrowedProof(proof) }, ct);
        Assert.Equal(ReviewOutcome.VerificationFailed, result.Outcome);
        Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
        Assert.Equal(2, result.Items.Count);
    }

    [Fact]
    public async Task FullRejectsBundleWithWrongNamespace()
    {
        var ct = TestContext.Current.CancellationToken;
        var bytes = Fixtures.Rewrite(Fixtures.Bytes("bundled-v2.mdpkg"), entries =>
        {
            var manifest = System.Text.Json.Nodes.JsonNode.Parse(entries[".mdpkg/manifest.json"])!;
            manifest["namespace"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
            entries[".mdpkg/manifest.json"] = Mdpkg.Reader.Internal.Format.CanonicalJson.Bytes(manifest, true);
        });
        using var input = new MemoryStream(bytes);
        var result = await new ReviewExtractor().ExtractAsync(input, new() { VerificationProvider = new ReviewVerificationProvider(new GitHistoryBackend()) }, ct);
        Assert.NotEqual(ReviewOutcome.Success, result.Outcome);
        Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
    }

    private static async Task<VerifiedHistoryContext> Proof(string file, CancellationToken ct)
    {
        using var input = Fixtures.Stream(file);
        using var archive = await PackageArchive.OpenAsync(input, cancellationToken: ct);
        return await new GitHistoryBackend().VerifyAsync(archive, ct);
    }

    private sealed class BorrowedProof(VerifiedHistoryContext proof) : IReviewVerificationProvider
    {
        public Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken) =>
            Task.FromResult(new VerificationReport(true, requiredChecks, [], proof));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SameDeclaredIdentityCannotVerifyDifferentTargetBytes(bool git)
    {
        var ct = TestContext.Current.CancellationToken;
        var extractor = new ReviewExtractor();
        using var reviewInput = Fixtures.Stream(git ? "delta-snapshot-target-commit.mdpkg" : "delta-v2.mdpkg");
        var review = await extractor.ExtractAsync(reviewInput, new() { VerificationProvider = new ReviewVerificationProvider() }, ct);
        Assert.Equal(VerificationLevel.Full, review.VerificationLevel);
        var sourceFile = git ? "original-git.mdpkg" : "original.mdpkg";
        using var originalInput = Fixtures.Stream(sourceFile);
        var original = await PackageSnapshot.ReadAsync(originalInput, cancellationToken: ct, verifySnapshot: !git);
        VerifiedHistoryContext? proof = null;
        if (git)
        {
            using var proofInput = Fixtures.Stream(sourceFile);
            using var archive = await PackageArchive.OpenAsync(proofInput, cancellationToken: ct);
            proof = await new GitHistoryBackend().VerifyAsync(archive, ct);
        }
        var anchor = review.Threads[0].Anchor;
        var bytes = Fixtures.Rewrite(Fixtures.Bytes(sourceFile), entries =>
        {
            var text = Encoding.UTF8.GetString(entries[anchor.Locator.DocumentPath]);
            entries[anchor.Locator.DocumentPath] = Encoding.UTF8.GetBytes(text.Replace(anchor.Selector.Quote, "INJECTED " + anchor.Selector.Quote, StringComparison.Ordinal));
        });
        using var alteredInput = new MemoryStream(bytes);
        var altered = await PackageSnapshot.ReadAsync(alteredInput, cancellationToken: ct);
        Assert.Equal(original.Identity, altered.Identity);
        Assert.NotEqual(original.PackageDigest, altered.PackageDigest);
        Assert.Equal(IdentityAssurance.Declared, altered.Assurance);
        if (proof is not null) Assert.False(proof.Matches(altered));
        using var invalidInput = new MemoryStream(bytes);
        var invalid = await new PackageValidator().ValidateAsync(invalidInput, new() { Deep = true }, ct);
        Assert.False(invalid.IsConforming);
        var resolved = await extractor.ResolveAsync(review, new(original, Target: altered, ReviewedHistory: proof), ct);
        Assert.Equal(CorrelationStatus.NotChecked, resolved.Correlation);
        Assert.Equal(review.Items.Count, resolved.Items.Count);
        Assert.All(resolved.Items, item =>
        {
            Assert.Equal(TargetStatus.VerificationUnavailable, item.TargetStatus);
            Assert.Equal("target-source-unverified", item.Reason);
            Assert.Null(item.ResolvedLocation);
        });
    }
}
