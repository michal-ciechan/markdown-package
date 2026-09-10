using Mdpkg.Reader;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class BrowserFixtureTests
{
    [Fact]
    public async Task CommittedBrowserExportExtractsAndResolvesWithAuthoredFeedbackPreserved()
    {
        // Read the actual browser download, not a .NET-generated or rewritten fixture.
        using var input = File.OpenRead(Fixtures.Repo("src/web-viewer/tests/fixtures/browser-v2.mdpkg"));
        var extractor = new ReviewExtractor();
        var review = await extractor.ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(review.Outcome == ReviewOutcome.Success, string.Join(";", review.Diagnostics));
        Assert.Equal(ContainerStatus.Conforming, review.ContainerStatus);
        Assert.Equal(SchemaStatus.Valid, review.SchemaStatus);
        Assert.Equal(VerificationLevel.Structural, review.VerificationLevel);
        Assert.Equal(2, review.DocumentVersion);
        Assert.Equal(ReviewShape.Delta, review.Shape);
        var thread = Assert.Single(review.Threads);
        Assert.Equal(ThreadState.Resolved, thread.State);
        Assert.Equal("target words", thread.Anchor.Selector.Quote);
        Assert.Equal(28, thread.Anchor.Selector.Start);
        Assert.Equal(40, thread.Anchor.Selector.End);

        using var original = Fixtures.Stream("original.mdpkg");
        var snapshot = await PackageSnapshot.ReadAsync(original, cancellationToken: TestContext.Current.CancellationToken);
        var resolved = await extractor.ResolveAsync(review, new(ReviewedSnapshot: snapshot), TestContext.Current.CancellationToken);
        Assert.Equal(CorrelationStatus.Exact, resolved.Correlation);

        // Assert authored content in both projections, including reply order and state.
        foreach (var items in new[] { review.Items, resolved.Items })
        {
            Assert.Collection(items,
                request =>
                {
                    Assert.Equal(CommentKind.ChangeRequest, request.Kind);
                    Assert.Equal("Explain these words.", request.Body);
                    Assert.Equal(0, request.CommentIndex);
                    Assert.Null(request.InReplyTo);
                },
                reply =>
                {
                    Assert.Equal(CommentKind.Comment, reply.Kind);
                    Assert.Equal("This reply keeps source order.", reply.Body);
                    Assert.Equal(1, reply.CommentIndex);
                    Assert.Equal(items[0].CommentId, reply.InReplyTo);
                });
            Assert.All(items, item =>
            {
                Assert.Equal(thread.Id, item.ThreadId);
                Assert.Equal(KindSource.AuthoredV2, item.KindSource);
                Assert.Equal(ThreadState.Resolved, item.ThreadState);
                Assert.Equal("Browser Reviewer", item.Author);
                Assert.Equal("guide.md", item.DeclaredDocumentPath);
                Assert.Equal(new HeadingPart("# Guide", 0), Assert.Single(item.DeclaredHeadingTrail));
            });
        }
        Assert.All(resolved.Items, item =>
        {
            Assert.Equal(IdentityStatus.Survives, item.IdentityStatus);
            Assert.Equal(TargetStatus.TargetIntact, item.TargetStatus);
            var location = Assert.IsType<ResolvedLocation>(item.ResolvedLocation);
            Assert.Equal(snapshot.Identity, location.Identity);
            Assert.Equal("guide.md", location.Locator.DocumentPath);
            Assert.Equal(new HeadingPart("# Guide", 0), Assert.Single(location.Locator.HeadingTrail));
            Assert.Equal(new SourceRange(28, 40), location.Range);
        });
    }
}
