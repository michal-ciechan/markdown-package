using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Reader;

namespace Mdpkg.EngineTests;

public class S3ReviewProbeTests
{
    [Fact]
    public async Task BootstrapReviewCannotBeRetargetedWithoutSuccessor()
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/delta-review-materialized.mdpkg"));
        var manifest = JsonNode.Parse(entries[0].Bytes)!;
        // Exact semantic edit from the S1 unchanged-tree-semantic-edit operation:
        // the oracle requires a new C1 while keeping origin.header frozen.
        manifest["review"]!["of"]!["current"] = new JsonObject
        { ["kind"] = "commit", ["id"] = "sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9" };
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Mdpkg.Core.PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, TestContext.Current.CancellationToken);
        if (result.Status == OperationStatus.Success)
        {
            Assert.Equal(IdentityAssurance.GitVerified, result.Assurance);
            Assert.NotNull(result.HistoryContext);
        }
        Assert.Equal(OperationStatus.Nonconforming, result.Status);
        Assert.Equal(IdentityAssurance.Declared, result.Assurance);
        Assert.Null(result.HistoryContext);
    }

    [Fact]
    public async Task ChangedBootstrapSemanticHeaderMustRequireSuccessor()
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/guide-materialized.mdpkg"));
        var manifest = JsonNode.Parse(entries[0].Bytes)!;
        manifest["addressing"]!["coverage"] = "partial";
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        var at = entries.FindIndex(e => e.Name == Profile.History);
        var history = JsonNode.Parse(entries[at].Bytes)!;
        history["addressingCoverage"]![0]!["coverage"] = "partial";
        entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(history) };
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Mdpkg.Core.PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, TestContext.Current.CancellationToken);
        Assert.Equal(OperationStatus.Nonconforming, result.Status);
        Assert.Equal(IdentityAssurance.Declared, result.Assurance);
        Assert.Null(result.HistoryContext);
    }

    [Theory]
    [InlineData("packageDigest")][InlineData("packageBytes")][InlineData("dispatch")]
    public async Task BootstrapTransportEvidenceDoesNotChangeSemanticHeader(string field)
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/delta-review-materialized.mdpkg"));
        var manifest = JsonNode.Parse(entries[0].Bytes)!;
        manifest["review"]!["of"]![field] = field switch
        {
            "packageDigest" => JsonValue.Create("sha256-" + new string('a', 64)),
            "packageBytes" => JsonValue.Create(123L),
            _ => JsonValue.Create("second send")
        };
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Mdpkg.Core.PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, TestContext.Current.CancellationToken);
        Assert.Equal(OperationStatus.Success, result.Status);
        Assert.Equal(IdentityAssurance.GitVerified, result.Assurance);
        Assert.NotNull(result.HistoryContext);
    }

    [Fact]
    public async Task GenuineSuccessorAllowsRetargetingWithUnchangedTreeAndFrozenOrigin()
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/delta-review-materialized.mdpkg"));
        var manifest = JsonNode.Parse(entries[0].Bytes)!;
        var at = entries.FindIndex(e => e.Name == Profile.History); var history = JsonNode.Parse(entries[at].Bytes)!;
        var frozen = history["origin"]!["header"]!.DeepClone();
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(ct);
        var tree = await repo.TreeAsync(entries.Where(e => e.Name.StartsWith(".mdpkg/review/", StringComparison.Ordinal)).ToList(), ct);
        var vectors = JsonNode.Parse(File.ReadAllText(EngineFixture.RepoFile("docs/investigations/deferred-history/breaking-revision-vectors.json")))!;
        var vector = vectors["vectors"]!.AsArray().Single(v => v!["name"]!.GetValue<string>() == "delta-review")!;
        var parent = await repo.ObjectAsync("commit", Profile.Utf8.GetBytes(vector["bootstrapCommitBytes"]!.GetValue<string>()), ct);
        Assert.Equal(history["origin"]!["commit"]!.GetValue<string>(), "sha1-" + parent);
        var child = "sha1-" + await repo.CommitAsync(tree, parent, "Retarget review", ct);
        manifest["current"]!["id"] = child;
        manifest["review"]!["of"]!["current"] = new JsonObject
        { ["kind"] = "commit", ["id"] = "sha1-f02a158c093f5d6867a3527418b1705bb6a5a6f9" };
        history["sourceTip"] = child; history["retainedCommits"] = 2; history["addressingCoverage"]![0]!["to"] = child;
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(history) };
        entries.RemoveAll(e => e.Name.StartsWith(".git/", StringComparison.Ordinal));
        entries.AddRange(await repo.CurateAsync(child[5..], false, ct)); EngineFixture.Rewrite(f.Output, entries);
        var result = await new Mdpkg.Core.PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, ct);
        Assert.Equal(OperationStatus.Success, result.Status);
        Assert.Equal(IdentityAssurance.GitVerified, result.Assurance);
        Assert.True(JsonNode.DeepEquals(frozen, JsonNode.Parse(result.HistoryContext!.OriginalHeader!.Value.GetRawText())));
    }

    [Theory]
    [InlineData("author")][InlineData("committer")][InlineData("message")][InlineData("extra-header")]
    public async Task RepairedBootstrapMetadataMustBeRejected(string mutation)
    {
        using var f = new EngineFixture();
        var ct = TestContext.Current.CancellationToken;
        var vectors = JsonNode.Parse(File.ReadAllText(EngineFixture.RepoFile("docs/investigations/deferred-history/breaking-revision-vectors.json")))!;
        var vector = vectors["vectors"]!.AsArray().Single(v => v!["name"]!.GetValue<string>() == "guide")!;
        var repo = new Repository(new GitProcess("git"), f.Source);
        await repo.InitializeAsync(ct);
        await repo.TreeAsync([new("guide.md", "# Guide\n"u8.ToArray())], ct);
        var payload = vector["bootstrapCommitBytes"]!.GetValue<string>();
        payload = mutation switch
        {
            "author" => payload.Replace("author mdpkg bootstrap", "author Other"),
            "committer" => payload.Replace("committer mdpkg bootstrap", "committer Other"),
            "message" => payload.Replace("mdpkg-bootstrap-v1\n", "mdpkg-bootstrap-v1\nextra body\n"),
            _ => payload.Replace("\n\n", "\nencoding UTF-8\n\n")
        };
        var commit = "sha1-" + await repo.ObjectAsync("commit", Profile.Utf8.GetBytes(payload), ct);
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/guide-materialized.mdpkg"));
        var manifest = JsonNode.Parse(entries[0].Bytes)!;
        manifest["current"]!["id"] = commit;
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) };
        var at = entries.FindIndex(e => e.Name == Profile.History);
        var history = JsonNode.Parse(entries[at].Bytes)!;
        history["sourceBase"] = commit; history["sourceTip"] = commit; history["origin"]!["commit"] = commit;
        history["addressingCoverage"]![0]!["from"] = commit; history["addressingCoverage"]![0]!["to"] = commit;
        entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(history) };
        entries.RemoveAll(e => e.Name.StartsWith(".git/", StringComparison.Ordinal));
        entries.AddRange(await repo.CurateAsync(commit[5..], false, ct));
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Mdpkg.Core.PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, ct);
        Assert.Equal(OperationStatus.Nonconforming, result.Status);
        Assert.Null(result.HistoryContext);
    }
}
