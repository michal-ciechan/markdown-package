using Mdpkg.Tests;
using Mdpkg.Core;
using Mdpkg.Reader;

namespace Mdpkg.Reviews.Tests;

public class BrowserFixtureTests
{
    [Theory]
    [InlineData("browser-v2.mdpkg", "original.mdpkg", false)]
    [InlineData("browser-commit-target.mdpkg", "original-git.mdpkg", true)]
    public async Task ActualBrowserSnapshotExportsVerifyInCoreAndResolveInReviews(string file, string original, bool git)
    {
        var ct = TestContext.Current.CancellationToken;
        using var input = File.OpenRead(Fixtures.Repo("src/web-viewer/tests/fixtures/" + file));
        var validation = await new PackageValidator().ValidateAsync(input, new() { Deep = true }, ct);
        Assert.True(validation.IsConforming);
        input.Position = 0;
        var extractor = new ReviewExtractor();
        var review = await extractor.ExtractAsync(input, new() { VerificationProvider = new ReviewVerificationProvider() }, ct);
        Assert.Equal(VerificationLevel.Full, review.VerificationLevel);
        Assert.Equal("snapshot", review.ReviewIdentity!.Current.Kind);
        using var source = Fixtures.Stream(original);
        var snapshot = await PackageSnapshot.ReadAsync(source, cancellationToken: ct, verifySnapshot: !git);
        VerifiedHistoryContext? proof = null;
        if (git)
        {
            source.Position = 0;
            using var archive = await PackageArchive.OpenAsync(source, cancellationToken: ct);
            proof = await new GitHistoryBackend().VerifyAsync(archive, ct);
        }
        var resolved = await extractor.ResolveAsync(review, new(snapshot, ReviewedHistory: proof), ct);
        Assert.Equal(CorrelationStatus.Exact, resolved.Correlation);
        Assert.NotEmpty(resolved.Items);
        Assert.All(resolved.Items, item => { Assert.Equal(TargetStatus.TargetIntact, item.TargetStatus); Assert.NotNull(item.ResolvedLocation); });
    }
}
