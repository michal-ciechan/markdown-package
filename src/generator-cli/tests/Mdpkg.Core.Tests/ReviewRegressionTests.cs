using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.Validation;

namespace Mdpkg.EngineTests;

public class ReviewRegressionTests
{
    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task DeepValidationRejectsCompleteClaimsContradictedByIntermediateUnknownRecords(bool wholeHistory)
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(ct);
        string? head = null;
        foreach (var text in new[] { "# Old\n", "# New\n", "# New\n" })
            head = await repo.CommitAsync(await repo.TreeAsync([new("x.md", Profile.Utf8.GetBytes(text))], ct), head, "test", ct);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), head + "\n");
        var root = Inventory.Root(EngineFixture.Namespace, new JsonArray("section", "x.md", new JsonArray(new JsonArray("# Old", 0))));
        var records = Path.Combine(f.Root, "records.json");
        File.WriteAllBytes(records, CanonicalJson.Bytes(new JsonArray(new JsonObject { ["root"] = root, ["dead"] = "deleted" })));
        var packed = await new PackageBuilder().PackAsync(f.Request with { FromGit = true, Correspondence = records }, ct);
        EngineFixture.Success(packed); Assert.Equal("partial", packed.Manifest!.Addressing.Coverage);
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct));
        var entries = EngineFixture.Read(f.Output);
        var manifest = packed.Manifest; var history = packed.History!;
        Assert.Equal("partial", history.AddressingCoverage[1].Coverage);
        if (wholeHistory)
        {
            manifest = manifest with { Addressing = manifest.Addressing with { Coverage = "complete" } };
            history = history with { AddressingCoverage = [new(history.AddressingCoverage[0].From, manifest.Current.Id, "complete")] };
        }
        else
        {
            // Keep aggregate coverage partial but lie about the Old -> New transition.
            history.AddressingCoverage[0] = history.AddressingCoverage[0] with { Coverage = "partial" };
            history.AddressingCoverage[1] = history.AddressingCoverage[1] with { Coverage = "complete" };
        }
        entries[entries.FindIndex(e => e.Name == Profile.Manifest)] = new(Profile.Manifest, CanonicalJson.Bytes(manifest, true));
        entries[entries.FindIndex(e => e.Name == Profile.History)] = new(Profile.History, CanonicalJson.Bytes(history));
        EngineFixture.Rewrite(f.Output, entries);
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output), ct));
        var rejected = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct);
        Assert.Equal(Outcome.Nonconforming, rejected.Outcome);
        Assert.Contains(rejected.Diagnostics, d => d.Code == "MDPK2007" && d.Message.Contains("retained history evidence", StringComparison.Ordinal));
    }

    [Fact]
    public async Task DeepValidationRequiresEvidenceForRemovedEntitiesEvenWithoutUnknownRecords()
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(ct);
        var first = await repo.CommitAsync(await repo.TreeAsync([new("x.md", "# Old\n"u8.ToArray())], ct), null, "first", ct);
        var tree = new List<EntryData> { new("x.md", "# New\n"u8.ToArray()) };
        var last = await repo.CommitAsync(await repo.TreeAsync(tree, ct), first, "last", ct);
        var manifest = new Manifest(Profile.Magic, EngineFixture.Namespace, new("commit", "sha1-" + last),
            new(Profile.Anchor, Profile.Digest, "complete", null), new Mdpkg.Reader.GitHistory("complete", [], Profile.History));
        var history = new HistoryDetail("first-parent", "original", "sha1-" + first, "sha1-" + last, 2,
            [], [], [], [], [new("sha1-" + first, "sha1-" + last, "complete")]);
        var entries = new List<EntryData> { new(Profile.Manifest, CanonicalJson.Bytes(manifest, true)) };
        entries.AddRange(tree); entries.Add(new(Profile.History, CanonicalJson.Bytes(history)));
        entries.AddRange(await repo.CurateAsync(last, false, ct)); EngineFixture.Rewrite(f.Output, entries);
        var rejected = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct);
        Assert.Equal(Outcome.Nonconforming, rejected.Outcome);
        Assert.Contains(rejected.Diagnostics, d => d.Code == "MDPK2007" && d.Message.Contains("retained history evidence", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task LegacyGitMetadataSurvivesImportAndDeepValidation(bool normalize)
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var git = new GitProcess("git"); var repo = new Repository(git, f.Source); await repo.InitializeAsync(ct);
        var tree = await repo.TreeAsync([new("x.md", Profile.Utf8.GetBytes(normalize ? "# X\r\n" : "# X\n"))], ct);
        var metadata = Encoding.Latin1.GetBytes("author José <a@example.com> 946684800 +0000\ncommitter José <a@example.com> 946684800 +0000\nencoding ISO-8859-1\n\nCafé\nparent this is message text\n");
        var original = Profile.Utf8.GetBytes("tree " + tree + "\n").Concat(metadata).ToArray();
        var head = await repo.ObjectAsync("commit", original, ct);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), head + "\n");
        await git.TextAsync(f.Source, ct, "fsck", "--full", "--strict");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request with { FromGit = true }, ct));
        var validated = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct); EngineFixture.Success(validated);
        if (normalize) Assert.NotEqual("sha1-" + head, validated.Manifest!.Current.Id);
        else Assert.Equal("sha1-" + head, validated.Manifest!.Current.Id);
        var extracted = Path.Combine(f.Root, "extracted"); System.IO.Compression.ZipFile.ExtractToDirectory(f.Output, extracted);
        var retained = await new Repository(git, extracted).ReadObjectAsync("commit", validated.Manifest.Current.Id[5..], ct);
        Assert.True(retained.AsSpan().EndsWith(metadata));
        if (!normalize) Assert.Equal(original, retained);
    }

}
