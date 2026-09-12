using System.Text.Json.Nodes;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.Validation;
using Mdpkg.Reader;

namespace Mdpkg.EngineTests;

public class S2ReviewFixTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("original", false)][InlineData("original", true)][InlineData("synthetic", false)]
    public async Task StrippingOriginCannotCertifyReservedBootstrap(string root, bool managed)
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/guide-materialized.mdpkg"));
        var index = entries.FindIndex(e => e.Name == Profile.History);
        var history = JsonNode.Parse(entries[index].Bytes)!;
        history.AsObject().Remove("origin"); history["root"] = root;
        entries[index] = entries[index] with { Bytes = CanonicalJson.Bytes(history) };
        if (root == "synthetic")
        {
            var manifest = JsonNode.Parse(entries[0].Bytes)!; manifest["history"]!["coverage"] = "truncated";
            entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        }
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), Ct, managedSnapshot: managed);
        Assert.Equal(Outcome.Nonconforming, result.Outcome);
        Assert.Equal(IdentityAssurance.Declared, result.Assurance);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK4002" && d.Message.Contains("Reserved bootstrap", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(false, "mdpkg-bootstrap-v1", true)]
    [InlineData(true, "mdpkg-bootstrap-v1", true)]
    [InlineData(false, "mdpkg-bootstrap-v1\n\nbody", true)]
    [InlineData(true, "mdpkg-bootstrap-v1\n\nbody", true)]
    [InlineData(false, "ordinary\nmdpkg-bootstrap-v1", false)]
    [InlineData(true, "ordinary\nmdpkg-bootstrap-v1", false)]
    [InlineData(false, "mdpkg-bootstrap-v1 suffix", false)]
    [InlineData(true, "mdpkg-bootstrap-v1 suffix", false)]
    public async Task OrdinaryCreationCannotUseReservedFirstMessageLine(bool managed, string message, bool rejected)
    {
        using var f = new EngineFixture(); f.Write("x.txt", "text\n"); File.WriteAllText(f.Output, "prior");
        var settings = new EngineSettings(managed ? "absent-git" : "git") { ManagedSnapshots = managed };
        var result = await new PackageBuilder(settings).PackAsync(f.Request with { Message = message }, Ct);
        if (!rejected) { EngineFixture.Success(result); return; }
        Assert.Equal(Outcome.Nonconforming, result.Outcome);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK4002" && d.Message.Contains("Reserved bootstrap", StringComparison.Ordinal));
        Assert.Equal("prior", File.ReadAllText(f.Output));
        Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }

    [Theory]
    [InlineData("clean")][InlineData("historical-file")][InlineData("child-marker")]
    public async Task DeltaMayRetainRealReviewOnlyHistory(string mutation)
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/delta-git-target-commit.mdpkg"));
        var manifest = FormatValidation.ReadManifest(JsonNode.Parse(entries[0].Bytes)!);
        var review = entries.Single(e => e.Name == ".mdpkg/review/comments.json");
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(Ct);
        var firstFiles = new List<EntryData> { review };
        if (mutation == "historical-file") firstFiles.Add(new("unrelated.txt", "unrelated\n"u8.ToArray()));
        var first = await repo.CommitAsync(await repo.TreeAsync(firstFiles, Ct), null, "Initial review", Ct);
        var last = await repo.CommitAsync(await repo.TreeAsync([review], Ct), first,
            mutation == "child-marker" ? "mdpkg-bootstrap-v1" : "Retain review checkpoint", Ct);
        manifest = manifest with { Current = new("commit", "sha1-" + last) };
        var history = new HistoryDetail("first-parent", "original", "sha1-" + first, "sha1-" + last, 2,
            [], [], [], [], [new("sha1-" + first, "sha1-" + last, "complete")]);
        entries = [new(Profile.Manifest, CanonicalJson.Bytes(manifest, true)), review, new(Profile.History, CanonicalJson.Bytes(history))];
        entries.AddRange(await repo.CurateAsync(last, false, Ct)); EngineFixture.Rewrite(f.Output, entries);
        var result = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), Ct);
        if (mutation == "clean")
        {
            EngineFixture.Success(result); Assert.Equal(IdentityAssurance.GitVerified, result.Assurance);
            Assert.Equal(2, result.History!.RetainedCommits);
        }
        else
        {
            Assert.Equal(Outcome.Nonconforming, result.Outcome);
            Assert.Contains(result.Diagnostics, d => d.Message.Contains(mutation == "child-marker" ? "Reserved bootstrap" : "non-review files", StringComparison.Ordinal));
        }
    }
}
