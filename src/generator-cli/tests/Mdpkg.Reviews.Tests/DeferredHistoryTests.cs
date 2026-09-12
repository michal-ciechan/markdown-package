using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class DeferredHistoryTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static readonly ReviewExtractor Extractor = new();
    private static async Task<ReviewExtractionResult> Extract(string file = "delta-v2.mdpkg", IReviewVerificationProvider? provider = null)
    {
        using var input = Fixtures.Stream(file);
        return await Extractor.ExtractAsync(input, new() { VerificationProvider = provider, RequireFullVerification = provider is not null }, Ct);
    }
    private static async Task<PackageSnapshot> Read(string file, bool verified = false)
    { using var input = Fixtures.Stream(file); return await PackageSnapshot.ReadAsync(input, cancellationToken: Ct, verifySnapshot: verified); }
    private static async Task<VerifiedHistoryContext> Proof(string file)
    {
        using var input = Fixtures.Stream(file); using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
        return await new GitHistoryBackend().VerifyAsync(archive, Ct);
    }
    private static void Preserved(ReviewResolutionResult result)
    {
        Assert.Equal(2, result.Items.Count);
        Assert.All(result.Items, i => { Assert.NotEmpty(i.Body); Assert.Null(i.ResolvedLocation); });
    }

    [Theory]
    [InlineData("delta-v2.mdpkg", "snapshot", "snapshot", false)]
    [InlineData("delta-snapshot-target-commit.mdpkg", "snapshot", "commit", false)]
    [InlineData("delta-git-target-snapshot.mdpkg", "commit", "snapshot", false)]
    [InlineData("delta-git-target-commit.mdpkg", "commit", "commit", false)]
    [InlineData("bundled-v2.mdpkg", "commit", "snapshot", true)]
    [InlineData("bundled-target-commit.mdpkg", "commit", "commit", true)]
    public async Task FullArtifactVerificationDoesNotNeedExternalSource(string file, string current, string reviewed, bool origin)
    {
        var result = await Extract(file, new ReviewVerificationProvider(new GitHistoryBackend(new(GitExecutable: current == "snapshot" ? "nonexistent-git-s4" : "git"))));
        Assert.True(result.Outcome == ReviewOutcome.Success, string.Join("; ", result.Diagnostics));
        Assert.Equal(VerificationLevel.Full, result.VerificationLevel);
        Assert.Equal(current, result.ReviewIdentity!.Current.Kind); Assert.Equal(reviewed, result.ReviewedIdentity!.Identity.Current.Kind);
        Assert.Equal(result.RequiredChecks, result.CompletedChecks);
        Assert.Equal(current == "snapshot", result.RequiredChecks.HasFlag(VerificationChecks.SnapshotIdentity));
        Assert.Equal(current == "commit", result.RequiredChecks.HasFlag(VerificationChecks.GitIntegrity));
        Assert.Equal(origin, result.RequiredChecks.HasFlag(VerificationChecks.BootstrapOrigin));
        Assert.All(result.Items, i => Assert.Null(i.ResolvedLocation));
        if (current == "snapshot") Assert.DoesNotContain("provider:GitIntegrity", result.Checks);
    }

    [Theory]
    [InlineData("invalid-bundled-parent.mdpkg")][InlineData("invalid-bundled-document.mdpkg")]
    [InlineData("invalid-bundled-ledger.mdpkg")][InlineData("invalid-bundled-origin.mdpkg")]
    public async Task FullProviderRejectsForgedBundlesAndPreservesFeedback(string file)
    {
        var result = await Extract(file, new ReviewVerificationProvider(new GitHistoryBackend()));
        Assert.NotEqual(ReviewOutcome.Success, result.Outcome); Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
        Assert.Equal(2, result.Items.Count); Assert.All(result.Items, i => { Assert.NotEmpty(i.Body); Assert.Null(i.ResolvedLocation); });
    }

    [Theory]
    [InlineData("delta-v2.mdpkg", VerificationChecks.AllPayloads)]
    [InlineData("delta-v2.mdpkg", VerificationChecks.CurrentView)]
    [InlineData("delta-v2.mdpkg", VerificationChecks.ReviewLineage)]
    [InlineData("delta-v2.mdpkg", VerificationChecks.SnapshotIdentity)]
    [InlineData("bundled-v2.mdpkg", VerificationChecks.GitIntegrity)]
    [InlineData("bundled-v2.mdpkg", VerificationChecks.BootstrapOrigin)]
    public async Task MissingAnyRequiredCheckCannotClaimFullEvenWithRealProof(string file, VerificationChecks omitted)
    {
        var result = await Extract(file, new OmitCheck(omitted));
        Assert.Equal(ReviewOutcome.VerificationFailed, result.Outcome); Assert.Equal(VerificationLevel.Structural, result.VerificationLevel);
        Assert.True(result.RequiredChecks.HasFlag(omitted)); Assert.Equal(2, result.Items.Count);
    }
    private sealed class OmitCheck(VerificationChecks omitted) : IReviewVerificationProvider
    {
        public async Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken)
        {
            var report = await new ReviewVerificationProvider(new GitHistoryBackend()).VerifyAsync(package, requiredChecks, cancellationToken);
            return report with { CompletedChecks = report.CompletedChecks & ~omitted };
        }
    }

    [Theory]
    [InlineData("delta-v2.mdpkg")][InlineData("delta-git-target-snapshot.mdpkg")][InlineData("bundled-v2.mdpkg")]
    public async Task EchoingRequirementsWithoutCheckingBytesCannotClaimFull(string file)
    {
        var result = await Extract(file, new EchoProvider());
        Assert.Equal(ReviewOutcome.VerificationFailed, result.Outcome); Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
        Assert.Equal(2, result.Items.Count);
    }
    private sealed class EchoProvider : IReviewVerificationProvider
    {
        public Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken) =>
            Task.FromResult(new VerificationReport(true, requiredChecks, []));
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task GitArtifactNeedsAnAvailableRepositoryAndBackend(bool missingExecutable)
    {
        var result = await Extract("delta-git-target-snapshot.mdpkg", new ReviewVerificationProvider(
            missingExecutable ? new GitHistoryBackend(new(GitExecutable: "nonexistent-git-s4")) : null));
        Assert.NotEqual(ReviewOutcome.Success, result.Outcome); Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
        Assert.Equal(2, result.Items.Count);
    }

    [Fact]
    public async Task VerifiedOriginAndSuppliedSnapshotGiveSameOriginalSelectorsWithoutInventedTransport()
    {
        var review = await Extract(); var original = await Read("original.mdpkg", true); var proof = await Proof("original-git.mdpkg");
        var exact = await Extractor.ResolveAsync(review, new(original), Ct);
        var reconstructed = await Extractor.ResolveAsync(review, new(TargetHistory: proof), Ct);
        Assert.Equal(CorrelationStatus.Exact, exact.Correlation); Assert.Equal(CorrelationStatus.Reconstructed, reconstructed.Correlation);
        Assert.Equal(exact.Items.Select(i => (i.CommentId, i.TargetStatus, i.CurrentDigest, i.ResolvedLocation!.Identity,
            i.ResolvedLocation.Locator.Encode(), i.ResolvedLocation.ScopeDocumentStart, i.ResolvedLocation.Range)),
            reconstructed.Items.Select(i => (i.CommentId, i.TargetStatus, i.CurrentDigest, i.ResolvedLocation!.Identity,
                i.ResolvedLocation.Locator.Encode(), i.ResolvedLocation.ScopeDocumentStart, i.ResolvedLocation.Range)));
        Assert.Contains(reconstructed.Diagnostics, d => d.Code == "OriginalArchiveUnavailable");
        Assert.DoesNotContain(reconstructed.Diagnostics, d => d.Code == "ReemittedPackage");
    }

    [Theory]
    [InlineData("original-git.mdpkg", TargetStatus.TargetIntact, "guide.md")]
    [InlineData("changed.mdpkg", TargetStatus.TargetRelocated, "guide.md")]
    [InlineData("moved.mdpkg", TargetStatus.TargetIntact, "moved.md")]
    [InlineData("bundled-v2.mdpkg", TargetStatus.TargetIntact, "guide.md")]
    public async Task OriginReconstructionStillRequiresExplicitNewerTargetSelection(string file, TargetStatus status, string path)
    {
        var review = await Extract(); var target = await Read(file); var proof = await Proof(file);
        var refused = await Extractor.ResolveAsync(review, new(Target: target, TargetHistory: proof), Ct);
        Assert.Equal(CorrelationStatus.WrongSnapshot, refused.Correlation); Preserved(refused);
        Assert.All(refused.Items, i => Assert.Equal("newer-target-not-selected", i.Reason));
        var accepted = await Extractor.ResolveAsync(review, new(Target: target, UseNewerTarget: true, TargetHistory: proof), Ct);
        Assert.Equal(CorrelationStatus.NewerTarget, accepted.Correlation);
        Assert.All(accepted.Items, i => { Assert.Equal(status, i.TargetStatus); Assert.Equal(path, i.ResolvedLocation!.Locator.DocumentPath); });
    }

    [Fact]
    public async Task CommitTargetNeedsVerifiedOriginalGitBytes()
    {
        var review = await Extract("delta-snapshot-target-commit.mdpkg"); var original = await Read("original-git.mdpkg");
        var refused = await Extractor.ResolveAsync(review, new(original), Ct); Preserved(refused);
        Assert.All(refused.Items, i => Assert.Equal("reviewed-source-unverified", i.Reason));
        var accepted = await Extractor.ResolveAsync(review, new(original, ReviewedHistory: await Proof("original-git.mdpkg")), Ct);
        Assert.All(accepted.Items, i => Assert.Equal(TargetStatus.TargetIntact, i.TargetStatus));
    }

    [Fact]
    public async Task DeclaredSnapshotSourceCannotGrantVerifiedSelectors()
    {
        var review = await Extract(); var result = await Extractor.ResolveAsync(review, new(await Read("original.mdpkg")), Ct);
        Preserved(result); Assert.All(result.Items, i => Assert.Equal("reviewed-source-unverified", i.Reason));
    }

    [Fact]
    public async Task ArchiveProofCannotBeReusedAfterReemissionOrHeaderTampering()
    {
        var proof = await Proof("original-git.mdpkg"); var review = await Extract();
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("original-git.mdpkg"), _ => { }));
        var target = await PackageSnapshot.ReadAsync(input, cancellationToken: Ct);
        Assert.Equal(proof.Target, target.Identity);
        var result = await Extractor.ResolveAsync(review, new(Target: target, UseNewerTarget: true, TargetHistory: proof), Ct);
        Preserved(result); Assert.All(result.Items, i => Assert.Equal("verification-context-mismatch", i.Reason));
    }

    [Fact]
    public async Task MissingOrWrongOriginCannotReconstructReviewedSource()
    {
        var review = await Extract(); var target = await Read("original-git.mdpkg");
        Preserved(await Extractor.ResolveAsync(review, new(Target: target, UseNewerTarget: true), Ct));
        // A real, fully verified origin from another S0 in the same namespace is not an alias.
        var wrongTarget = await Read("guide-materialized.mdpkg"); var wrongProof = await Proof("guide-materialized.mdpkg");
        var wrong = await Extractor.ResolveAsync(review, new(Target: wrongTarget, UseNewerTarget: true, TargetHistory: wrongProof), Ct);
        Preserved(wrong); Assert.Equal(CorrelationStatus.OriginalUnavailable, wrong.Correlation);
    }

    [Fact]
    public async Task DeletedOriginCannotAcquireProofAndFeedbackSurvives()
    {
        var bytes = Fixtures.Rewrite(Fixtures.Bytes("original-git.mdpkg"), entries =>
        {
            var history = JsonNode.Parse(entries[Profile.History])!;
            history.AsObject().Remove("origin"); history["root"] = "original";
            entries[Profile.History] = CanonicalJson.Bytes(history);
        });
        using var input = new MemoryStream(bytes); using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
        await Assert.ThrowsAsync<PackageFormatException>(() => new GitHistoryBackend().VerifyAsync(archive, Ct));
        input.Position = 0;
        var target = await PackageSnapshot.ReadAsync(input, cancellationToken: Ct);
        var result = await Extractor.ResolveAsync(await Extract(), new(Target: target, UseNewerTarget: true), Ct);
        Preserved(result); Assert.Equal(CorrelationStatus.OriginalUnavailable, result.Correlation);
    }

    [Fact]
    public async Task CorruptPackCannotClaimFullEvenWithRepairedZipChecksums()
    {
        var bytes = Fixtures.Rewrite(Fixtures.Bytes("delta-git-target-snapshot.mdpkg"), entries =>
        { var pack = entries.Single(e => e.Key.EndsWith(".pack", StringComparison.Ordinal)).Value; pack[^1] ^= 1; });
        using var input = new MemoryStream(bytes);
        var result = await Extractor.ExtractAsync(input, new() { VerificationProvider = new ReviewVerificationProvider(new GitHistoryBackend()) }, Ct);
        Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel); Assert.NotEqual(ReviewOutcome.Success, result.Outcome);
        Assert.Equal(2, result.Items.Count);
    }

    [Fact]
    public async Task BackendResourceFailurePreservesFeedbackAndCallerOwnership()
    {
        using var input = Fixtures.Stream("delta-git-target-snapshot.mdpkg");
        var provider = new ReviewVerificationProvider(new GitHistoryBackend(resources: new() { MaxSpoolBytes = 1 }));
        var result = await Extractor.ExtractAsync(input, new() { VerificationProvider = provider }, Ct);
        Assert.Equal(ReviewOutcome.ResourceLimitExceeded, result.Outcome); Assert.Equal(2, result.Items.Count); Assert.True(input.CanRead);
    }

    [Fact]
    public async Task VerificationCaptureKeepsProviderReadsIndependentOfCallerMutation()
    {
        using var input = new MemoryStream(Fixtures.Bytes("delta-v2.mdpkg"));
        var provider = new MutatingProvider(input);
        var result = await Extractor.ExtractAsync(input, new() { VerificationProvider = provider }, Ct);
        Assert.Equal(VerificationLevel.Full, result.VerificationLevel); Assert.Equal(2, result.Items.Count);
        Assert.Equal(0, input.Length); Assert.True(input.CanRead);
    }
    private sealed class MutatingProvider(MemoryStream caller) : IReviewVerificationProvider
    {
        public Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken)
        {
            caller.SetLength(0);
            return new ReviewVerificationProvider().VerifyAsync(package, requiredChecks, cancellationToken);
        }
    }

    [Fact]
    public async Task LateProviderCancellationCannotReturnFull()
    {
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct); using var input = Fixtures.Stream();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Extractor.ExtractAsync(input,
            new() { VerificationProvider = new CancelProvider(cancel) }, cancel.Token));
    }
    private sealed class CancelProvider(CancellationTokenSource cancel) : IReviewVerificationProvider
    {
        public async Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken)
        {
            var result = await new ReviewVerificationProvider().VerifyAsync(package, requiredChecks, cancellationToken);
            cancel.Cancel(); return result;
        }
    }

    [Fact]
    public async Task VerifiedSnapshotReadIncludesUnselectedNonMarkdownFiles()
    {
        var bytes = Fixtures.Rewrite(Fixtures.Bytes("original.mdpkg"), entries => entries["notes.txt"] = "added after hashing\n"u8.ToArray());
        using var input = new MemoryStream(bytes);
        await Assert.ThrowsAsync<PackageFormatException>(() => PackageSnapshot.ReadAsync(input, cancellationToken: Ct, verifySnapshot: true));
        Assert.True(input.CanRead);
    }

    [Fact]
    public async Task FullSnapshotReviewDoesNotVerifyExternalSelectors()
    {
        var bytes = Fixtures.Review(n => n["threads"]![0]!["select"]!["quote"] = "false phrase");
        // This is a valid newly prepared review artifact with an invalid source selector.
        bytes = Fixtures.Rewrite(bytes, entries =>
        {
            var manifest = FormatValidation.ReadManifest(JsonNode.Parse(entries[Profile.Manifest])!);
            manifest = manifest with { Current = new("snapshot", SnapshotHash.Compute(manifest, [".mdpkg/review/comments.json"], p => entries[p], Ct)) };
            entries[Profile.Manifest] = CanonicalJson.Bytes(manifest, true);
        });
        using var input = new MemoryStream(bytes);
        var review = await Extractor.ExtractAsync(input, new() { VerificationProvider = new ReviewVerificationProvider() }, Ct);
        Assert.True(review.VerificationLevel == VerificationLevel.Full, string.Join("; ", review.Diagnostics)); Assert.Equal(2, review.Items.Count);
        var resolved = await Extractor.ResolveAsync(review, new(await Read("original.mdpkg", true)), Ct);
        Assert.All(resolved.Items, i => { Assert.Equal(TargetStatus.Invalidated, i.TargetStatus); Assert.Null(i.ResolvedLocation); });
    }
}
