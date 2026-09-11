using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Tests;

namespace Mdpkg.Reader.Tests;

public class LooseReferenceTests
{
    private static JsonNode Fixture => JsonNode.Parse(File.ReadAllText(Fixtures.Repo("docs/spec/link-fixtures.json")))!;
    public static IEnumerable<object[]> Cases => Fixture["cases"]!.AsArray().Select(c => new object[] {c!["name"]!.GetValue<string>(), c.ToJsonString()});

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task LooseUrisMatchSharedBrowserContract(string name, string json)
    {
        var c = JsonNode.Parse(json)!;
        var bytes = Fixtures.Rewrite(Fixtures.Bytes("original.mdpkg"), entries => {
            foreach (var key in entries.Keys.Where(k => !k.StartsWith(".", StringComparison.Ordinal)).ToArray()) entries.Remove(key);
            foreach (var (path, text) in c["documents"]!.AsObject()) entries[path] = Profile.Utf8.GetBytes(text!.GetValue<string>());
            var manifest = JsonNode.Parse(entries[Profile.Manifest])!;
            manifest["namespace"] = Fixture["namespace"]!.GetValue<string>();
            manifest["current"] = Fixture["current"]!.GetValue<string>();
            manifest["addressing"]!["coverage"] = c["coverage"]!.GetValue<string>();
            var history = JsonNode.Parse(entries[Profile.History])!;
            history["addressingCoverage"]![0]!["coverage"] = c["coverage"]!.GetValue<string>();
            entries[Profile.History] = CanonicalJson.Bytes(history);
            var ledger = c["ledger"]!.AsObject();
            manifest["addressing"]!["overrides"] = ledger.Count == 0 ? null : Profile.Ledger;
            entries.Remove(Profile.Ledger);
            if (ledger.Count > 0) entries[Profile.Ledger] = CanonicalJson.Bytes(new JsonObject {
                ["version"] = 1, ["anchor"] = Profile.Anchor, ["entries"] = ledger.DeepClone() });
            entries[Profile.Manifest] = CanonicalJson.Bytes(manifest, true);
        });
        using var stream = new MemoryStream(bytes);
        var snapshot = await PackageSnapshot.ReadAsync(stream, cancellationToken: TestContext.Current.CancellationToken);
        var result = snapshot.ResolveReference(c["uri"]!.GetValue<string>(), TestContext.Current.CancellationToken);
        Assert.Equal(c["category"]!.GetValue<string>(), result.Category);
        Assert.Equal(c["status"]?.GetValue<string>(), result.Status);
        Assert.Equal(c["reason"]!.GetValue<string>(), result.Reason);
        Assert.Equal(c["live"]?.ToJsonString(), result.Scope?.Locator.ToJson().ToJsonString());
        if (name == "partial-current-at") {
            var scope = snapshot.GetScopes("guide.md", TestContext.Current.CancellationToken).Last();
            Assert.Equal(IdentityStatus.Survives, snapshot.Resolve(snapshot.Identity, scope.Root, scope.Digest, scope.Locator, TestContext.Current.CancellationToken).Status);
        }
    }
}
