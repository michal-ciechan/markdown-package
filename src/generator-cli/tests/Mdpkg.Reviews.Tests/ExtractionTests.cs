using System.Text;
using System.Text.Json.Nodes;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class ExtractionTests
{
    [Theory]
    [InlineData("delta-v1.mdpkg", 1, ReviewShape.Delta)][InlineData("delta-v2.mdpkg", 2, ReviewShape.Delta)][InlineData("bundled-v2.mdpkg", 2, ReviewShape.Bundled)]
    public async Task ExtractsIndependentPackagesWithoutOriginalPreservingIntentAndOrder(string file, int version, ReviewShape shape)
    {
        using var input = Fixtures.Stream(file);
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(result.Outcome == ReviewOutcome.Success, string.Join(";", result.Diagnostics));
        Assert.Equal(ContainerStatus.Conforming, result.ContainerStatus); Assert.Equal(SchemaStatus.Valid, result.SchemaStatus);
        Assert.Equal(VerificationLevel.Structural, result.VerificationLevel); Assert.Equal(version, result.DocumentVersion); Assert.Equal(shape, result.Shape);
        Assert.Equal(2, result.Items.Count); Assert.Equal("Explain these words.", result.Items[0].Body);
        Assert.Equal(Fixtures.Id(2), result.Items[1].InReplyTo); Assert.Equal(1, result.Items[1].CommentIndex);
        Assert.Equal("2026-09-09T10:00:00Z", result.Items[1].At); // Earlier clock, later array element.
        Assert.Equal(version == 1 ? CommentKind.Unspecified : CommentKind.ChangeRequest, result.Items[0].Kind);
        Assert.Equal(version == 1 ? KindSource.LegacyV1 : KindSource.AuthoredV2, result.Items[0].KindSource);
        Assert.All(result.Items, i => { Assert.Null(i.ResolvedLocation); Assert.Equal("guide.md", i.DeclaredDocumentPath); Assert.Equal(TargetStatus.TargetUnavailable, i.TargetStatus); });
        Assert.True(input.CanRead);
    }
    [Fact]
    public async Task OrdinaryPackageAndValidEmptyReviewHaveDistinctOutcomes()
    {
        using var ordinary = Fixtures.Stream("original.mdpkg");
        Assert.Equal(ReviewOutcome.NotReview, (await new ReviewExtractor().ExtractAsync(ordinary, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        using var empty = new MemoryStream(Fixtures.Review(n => n["threads"] = new JsonArray()));
        var result = await new ReviewExtractor().ExtractAsync(empty, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.Success, result.Outcome); Assert.Empty(result.Items);
    }
    [Fact]
    public async Task ThreadsWithSameAnchorRepliesStatesAndExtensionsArePreserved()
    {
        using var input = new MemoryStream(Fixtures.Review(n =>
        {
            var threads = n["threads"]!.AsArray();
            for (var i = 0; i < 3; i++)
            {
                var thread = (i == 0 ? threads[0] : threads[0]!.DeepClone())!;
                thread["id"] = Fixtures.Id(10 + i * 10); thread["state"] = new[] { "open", "resolved", "obsolete" }[i];
                thread["comments"]![0]!["id"] = Fixtures.Id(11 + i * 10); thread["comments"]![1]!["id"] = Fixtures.Id(12 + i * 10);
                thread["comments"]![1]!["inReplyTo"] = Fixtures.Id(11 + i * 10); thread["note"] = "extension";
                thread["comments"]![0]!["client"] = new JsonObject { ["color"] = "blue" };
                if (i > 0) threads.Add(thread);
            }
            n["producerInfo"] = new JsonObject { ["version"] = 9 };
        }));
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.Success, result.Outcome); Assert.Equal(6, result.Items.Count);
        Assert.Equal(new[] { ThreadState.Open, ThreadState.Resolved, ThreadState.Obsolete }, result.Threads.Select(t => t.State));
        Assert.Equal("extension", result.Threads[1].Extensions["note"].GetString()); Assert.True(result.Extensions!.ContainsKey("producerInfo"));
        Assert.Equal("blue", result.Threads[0].Comments[0].Extensions["client"].GetProperty("color").GetString());
    }
    [Theory]
    [InlineData("version", ReviewOutcome.UnsupportedVersionOrProfile)][InlineData("kind", ReviewOutcome.UnsupportedVersionOrProfile)]
    [InlineData("profile", ReviewOutcome.UnsupportedVersionOrProfile)][InlineData("state", ReviewOutcome.UnsupportedVersionOrProfile)]
    [InlineData("duplicate-id", ReviewOutcome.Malformed)][InlineData("uppercase-id", ReviewOutcome.Malformed)]
    [InlineData("self-reply", ReviewOutcome.Malformed)][InlineData("cycle", ReviewOutcome.Malformed)][InlineData("dangling", ReviewOutcome.Malformed)]
    [InlineData("cross-thread", ReviewOutcome.Malformed)][InlineData("timestamp", ReviewOutcome.Malformed)][InlineData("invalid-date", ReviewOutcome.Malformed)]
    [InlineData("missing-select", ReviewOutcome.Malformed)][InlineData("empty-thread", ReviewOutcome.Malformed)][InlineData("empty-body", ReviewOutcome.Malformed)]
    [InlineData("negative-start", ReviewOutcome.Malformed)][InlineData("reversed", ReviewOutcome.Malformed)][InlineData("fractional", ReviewOutcome.Malformed)]
    [InlineData("long-context", ReviewOutcome.Malformed)][InlineData("bad-locator", ReviewOutcome.Malformed)][InlineData("padded-locator", ReviewOutcome.Malformed)]
    [InlineData("missing-kind", ReviewOutcome.Malformed)][InlineData("null-body", ReviewOutcome.Malformed)]
    [InlineData("null-reply", ReviewOutcome.Malformed)]
    public async Task SchemaRejectionsAreExplicit(string mutation, ReviewOutcome expected)
    {
        using var input = new MemoryStream(Fixtures.Review(n =>
        {
            var thread = n["threads"]![0]!; var comment = thread["comments"]![0]!; var selector = thread["select"]!;
            switch (mutation)
            {
                case "version": n["version"] = 3; break;
                case "kind": comment["kind"] = "apply"; break;
                case "missing-kind": comment.AsObject().Remove("kind"); break;
                case "profile": n["selector"] = "unknown"; break;
                case "state": thread["state"] = "applied"; break;
                case "duplicate-id": thread["comments"]![1]!["id"] = Fixtures.Id(2); break;
                case "uppercase-id": comment["id"] = "AAAAAAAA-0000-4000-8000-000000000001"; break;
                case "self-reply": comment["inReplyTo"] = Fixtures.Id(2); break;
                case "cycle": comment["inReplyTo"] = Fixtures.Id(3); break;
                case "dangling": comment["inReplyTo"] = Fixtures.Id(99); break;
                case "cross-thread":
                    var other = thread.DeepClone(); other["id"] = Fixtures.Id(20); other["comments"] = new JsonArray(new JsonObject
                    { ["id"] = Fixtures.Id(21), ["at"] = "2026-09-09T00:00:00Z", ["author"] = "X", ["body"] = "Reply", ["kind"] = "comment", ["inReplyTo"] = Fixtures.Id(2) });
                    n["threads"]!.AsArray().Add(other); break;
                case "timestamp": comment["at"] = "2026-09-09T12:00:00"; break;
                case "invalid-date": comment["at"] = "2026-02-31T12:00:00Z"; break;
                case "missing-select": thread.AsObject().Remove("select"); break;
                case "empty-thread": thread["comments"] = new JsonArray(); break;
                case "empty-body": comment["body"] = ""; break;
                case "null-body": comment["body"] = null; break;
                case "null-reply": comment["inReplyTo"] = null; break;
                case "negative-start": selector["start"] = -1; break;
                case "reversed": selector["end"] = 0; break;
                case "fractional": selector["start"] = 1.5; break;
                case "long-context": selector["prefix"] = new string('x', 41); break;
                case "bad-locator": thread["loc"] = "%%%"; break;
                case "padded-locator": thread["loc"] = thread["loc"]!.GetValue<string>() + "="; break;
            }
        }));
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(expected, result.Outcome); Assert.NotEmpty(result.Diagnostics); Assert.Empty(result.Items);
    }
    [Fact]
    public async Task V1EmptyBodiesRemainUnspecifiedAndKindsCannotBeSmuggledIntoV1()
    {
        using var empty = new MemoryStream(Fixtures.Review(n => n["threads"]![0]!["comments"]![0]!["body"] = "", "delta-v1.mdpkg"));
        Assert.Equal(ReviewOutcome.Success, (await new ReviewExtractor().ExtractAsync(empty, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        using var kind = new MemoryStream(Fixtures.Review(n => n["threads"]![0]!["comments"]![0]!["kind"] = "change-request", "delta-v1.mdpkg"));
        Assert.Equal(ReviewOutcome.UnsupportedVersionOrProfile, (await new ReviewExtractor().ExtractAsync(kind, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
    }
    [Theory]
    [InlineData("duplicate-key")][InlineData("invalid-unicode")][InlineData("noncanonical")][InlineData("missing-detail")]
    public async Task InvalidRawJsonIsNotRepaired(string mutation)
    {
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("delta-v2.mdpkg"), entries =>
        {
            var path = ".mdpkg/review/comments.json";
            var text = Encoding.UTF8.GetString(entries[path]);
            if (mutation == "duplicate-key") text = text.Replace("\"version\":2", "\"version\":2,\"version\":2", StringComparison.Ordinal);
            if (mutation == "invalid-unicode") text = text.Replace("target words", "\\ud800", StringComparison.Ordinal);
            if (mutation == "noncanonical") text = " " + text;
            if (mutation == "missing-detail") entries.Remove(path); else entries[path] = Encoding.UTF8.GetBytes(text);
        }));
        Assert.Equal(ReviewOutcome.Malformed, (await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
    }
    [Theory]
    [InlineData("comments")][InlineData("body")][InlineData("threads")][InlineData("rows")][InlineData("input")]
    public async Task ResourceLimitsReturnNoTruncatedFeedback(string which)
    {
        var options = which switch { "comments" => new ReviewReadOptions { MaxCommentsBytes = 10 }, "body" => new() { MaxBodyBytes = 2 },
            "threads" => new() { MaxThreads = 0 }, "rows" => new() { MaxComments = 1 }, _ => new() { Limits = new() { MaxInputBytes = 10 } } };
        using var input = Fixtures.Stream();
        var result = await new ReviewExtractor().ExtractAsync(input, options, TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.ResourceLimitExceeded, result.Outcome); Assert.Empty(result.Items);
    }
    [Theory]
    [InlineData("wrong-delta-namespace")][InlineData("wrong-bundled-namespace")][InlineData("negative-bytes")][InlineData("bad-digest")]
    public async Task CorrelationDeclarationMustBeWellFormed(string mutation)
    {
        using var input = new MemoryStream(Fixtures.Manifest(n =>
        {
            if (mutation == "wrong-delta-namespace") n["review"]!["of"]!["namespace"] = n["namespace"]!.DeepClone();
            if (mutation == "wrong-bundled-namespace") n["review"]!["shape"] = "bundled";
            if (mutation == "negative-bytes") n["review"]!["of"]!["packageBytes"] = -1;
            if (mutation == "bad-digest") n["review"]!["of"]!["packageDigest"] = "sha256-bad";
        }));
        Assert.Equal(ReviewOutcome.Malformed, (await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
    }
    [Fact]
    public async Task UnsupportedDetailPathIsACapabilityFailure()
    {
        using var input = new MemoryStream(Fixtures.Manifest(n => n["review"]!["detail"] = ".mdpkg/review/other.json"));
        Assert.Equal(ReviewOutcome.UnsupportedVersionOrProfile, (await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
    }
    [Fact]
    public async Task JsonDepthIsAResourceLimitIncludingUnknownExtensionData()
    {
        using var input = new MemoryStream(Fixtures.Review(n =>
        {
            var nested = new JsonObject(); var cursor = nested;
            for (var i = 0; i < 36; i++) { var next = new JsonObject(); cursor["child"] = next; cursor = next; }
            n["extension"] = nested;
        }));
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.ResourceLimitExceeded, result.Outcome); Assert.Empty(result.Items);
    }
    [Theory]
    [InlineData("delta-v2.mdpkg")][InlineData("bundled-v2.mdpkg")]
    public async Task FullRequiredWithoutProviderPreservesFeedbackButCannotClaimVerification(string file)
    {
        using var input = Fixtures.Stream(file);
        var result = await new ReviewExtractor().ExtractAsync(input, new() { RequireFullVerification = true }, TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.VerificationUnavailable, result.Outcome); Assert.Equal(2, result.Items.Count);
        Assert.Equal(VerificationLevel.Structural, result.VerificationLevel);
    }
    [Theory]
    [InlineData(false, VerificationChecks.None)][InlineData(true, VerificationChecks.GitIntegrity)][InlineData(true, VerificationChecks.Full)]
    public async Task ProviderMustExplicitlyEstablishEveryFullCheck(bool accepted, VerificationChecks checks)
    {
        using var input = Fixtures.Stream("bundled-v2.mdpkg"); var provider = new Provider(accepted, checks);
        var result = await new ReviewExtractor().ExtractAsync(input, new() { RequireFullVerification = true, VerificationProvider = provider }, TestContext.Current.CancellationToken);
        Assert.True(provider.Called); Assert.Equal(accepted && checks == VerificationChecks.Full ? ReviewOutcome.Success : ReviewOutcome.VerificationFailed, result.Outcome);
        Assert.Equal(accepted && checks == VerificationChecks.Full ? VerificationLevel.Full : VerificationLevel.Structural, result.VerificationLevel);
    }
    [Theory]
    [InlineData("invalid-bundled-parent.mdpkg")][InlineData("invalid-bundled-document.mdpkg")][InlineData("invalid-bundled-ledger.mdpkg")][InlineData("invalid-delta-history.mdpkg")]
    public async Task ForgedGitClaimsNeverReceiveImplicitFullAssurance(string file)
    {
        var bytes = Fixtures.Bytes(file);
        using var structural = new MemoryStream(bytes);
        var read = await new ReviewExtractor().ExtractAsync(structural, cancellationToken: TestContext.Current.CancellationToken);
        if (file == "invalid-delta-history.mdpkg")
        {
            Assert.Equal(ReviewOutcome.Malformed, read.Outcome);
            Assert.NotEqual(VerificationLevel.Full, read.VerificationLevel);
            return;
        }
        Assert.Equal(ReviewOutcome.Success, read.Outcome); Assert.Equal(VerificationLevel.Structural, read.VerificationLevel);
        using var full = new MemoryStream(bytes);
        var checkedResult = await new ReviewExtractor().ExtractAsync(full, new() { RequireFullVerification = true, VerificationProvider = new Provider(false, VerificationChecks.None) }, TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.VerificationFailed, checkedResult.Outcome); Assert.Equal(2, checkedResult.Items.Count);
    }
    private sealed class Provider(bool accepted, VerificationChecks checks) : IReviewVerificationProvider
    {
        public bool Called { get; private set; }
        public Task<VerificationReport> VerifyAsync(PackageArchive package, ReviewShape shape, ReviewedIdentity reviewedIdentity, CancellationToken cancellationToken)
        { cancellationToken.ThrowIfCancellationRequested(); Called = true; return Task.FromResult(new VerificationReport(accepted, checks, [])); }
    }
    [Fact]
    public void ReviewsHasOnlyReaderAsItsPackageDependency()
    {
        var references = typeof(ReviewExtractor).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
        Assert.Contains("Mdpkg.Reader", references); Assert.DoesNotContain("Mdpkg.Core", references);
        Assert.DoesNotContain("mdpkg", references); Assert.DoesNotContain("System.CommandLine", references); Assert.DoesNotContain("System.Diagnostics.Process", references);
    }
}
