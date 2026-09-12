using Mdpkg.Tests;

namespace Mdpkg.Reader.Tests;

public class CheckpointTests
{
    [Theory]
    [InlineData("guide-snapshot.mdpkg", "snapshot", "history-unavailable")]
    [InlineData("guide-snapshot.mdpkg", "commit", "history-unavailable")]
    [InlineData("guide-materialized.mdpkg", "snapshot", "origin-unverified")]
    [InlineData("guide-materialized.mdpkg", "commit", "history-required")]
    [InlineData("original-git.mdpkg", "snapshot", "origin-unverified")]
    [InlineData("original-git.mdpkg", "commit", "history-required")]
    public async Task MatchingCurrentContentDoesNotProveAnUnrelatedCheckpoint(string fixture, string kind, string reason)
    {
        var ct = TestContext.Current.CancellationToken;
        using var input = Fixtures.Stream(fixture);
        var snapshot = await PackageSnapshot.ReadAsync(input, cancellationToken: ct);
        var scope = snapshot.GetScopes("guide.md", ct).First(s => s.Locator.Kind == "section");
        var other = new PackageIdentity(snapshot.Identity.Namespace,
            new(kind, kind == "snapshot" ? "sha256-" + new string('a', 64) : "sha1-" + new string('a', 40)));
        var result = snapshot.Resolve(other, scope.Root, scope.Digest, scope.Locator, ct);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Status); Assert.Equal(reason, result.Reason); Assert.Null(result.Scope);
        Assert.Equal(IdentityStatus.Survives, snapshot.Resolve(snapshot.Identity, scope.Root, scope.Digest, scope.Locator, ct).Status);
    }

    [Fact]
    public async Task DeclaredMatchingOriginIsStillNotVerifiedCheckpointEvidence()
    {
        var ct = TestContext.Current.CancellationToken;
        using var initial = Fixtures.Stream("guide-snapshot.mdpkg");
        var original = await PackageSnapshot.ReadAsync(initial, cancellationToken: ct);
        using var materialized = Fixtures.Stream("guide-materialized.mdpkg");
        var current = await PackageSnapshot.ReadAsync(materialized, cancellationToken: ct);
        var scope = original.GetScopes("guide.md", ct).First(s => s.Locator.Kind == "section");
        var result = current.Resolve(original.Identity, scope.Root, scope.Digest, scope.Locator, ct);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Status); Assert.Equal("origin-unverified", result.Reason);
    }

    [Fact]
    public async Task AbsentOriginCannotEstablishSnapshotRelationship()
    {
        var ct = TestContext.Current.CancellationToken;
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("guide-materialized.mdpkg"), entries =>
        {
            var history = System.Text.Json.Nodes.JsonNode.Parse(entries[".mdpkg/history.json"])!;
            history.AsObject().Remove("origin"); history["root"] = "original";
            entries[".mdpkg/history.json"] = Mdpkg.Reader.Internal.Format.CanonicalJson.Bytes(history);
        }));
        var snapshot = await PackageSnapshot.ReadAsync(input, cancellationToken: ct);
        var scope = snapshot.GetScopes("guide.md", ct).First(s => s.Locator.Kind == "section");
        var other = new PackageIdentity(snapshot.Identity.Namespace, new("snapshot", "sha256-" + new string('a', 64)));
        var result = snapshot.Resolve(other, scope.Root, scope.Digest, scope.Locator, ct);
        Assert.Equal(IdentityStatus.Unconfirmed, result.Status); Assert.Equal("origin-unavailable", result.Reason);
    }
}
