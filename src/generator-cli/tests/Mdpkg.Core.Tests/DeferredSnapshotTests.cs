using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;
using Builder = Mdpkg.Core.PackageBuilder;
using Validator = Mdpkg.Core.PackageValidator;

namespace Mdpkg.EngineTests;

public class DeferredSnapshotTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static JsonNode Data => JsonNode.Parse(File.ReadAllText(EngineFixture.RepoFile("docs/investigations/deferred-history/breaking-revision-vectors.json")))!;
    private static JsonNode Vector(string name) => Data["vectors"]!.AsArray().Single(v => v!["name"]!.GetValue<string>() == name)!;
    private static string Fixture(string name) => EngineFixture.RepoFile("docs/spec/review-fixtures/" + name);
    private static void Success(Core.PackageResult result) => Assert.True(result.Status == OperationStatus.Success, string.Join("; ", result.Diagnostics));

    [Theory]
    [InlineData("guide")][InlineData("unicode")][InlineData("ledger")][InlineData("delta-review")]
    public async Task ExactS1HashAndBothSchemaModesAreReadable(string name)
    {
        var vector = Vector(name);
        var manifest = FormatValidation.ReadManifest(JsonNode.Parse(vector["snapshotManifestCanonical"]!.GetValue<string>())!);
        var sources = vector["sources"]!.AsObject().ToDictionary(p => p.Key, p => Profile.Utf8.GetBytes(p.Value!.GetValue<string>()));
        Assert.Equal(vector["snapshotId"]!.GetValue<string>(), SnapshotHash.Compute(manifest, sources.Keys.Reverse(), path => sources[path], Ct));
        Assert.Equal(vector["snapshotManifestCanonical"]!.GetValue<string>(), Profile.Utf8.GetString(CanonicalJson.Bytes(manifest, true)));
        foreach (var mode in new[] { "snapshot", "materialized" })
        {
            using var input = File.OpenRead(Fixture(name + "-" + mode + ".mdpkg"));
            using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
            Assert.Equal(IdentityAssurance.Declared, archive.Assurance);
            if (mode == "snapshot")
            {
                Assert.Equal(manifest.Current, archive.VerifySnapshot(Ct).Current);
                Assert.Equal(IdentityAssurance.SnapshotVerified, archive.Assurance);
            }
            else Assert.IsType<GitHistory>(archive.HistoryMode);
            var result = await new Validator(new("absent-git")).ValidateFileAsync(Fixture(name + "-" + mode + ".mdpkg"), new(), Ct);
            Success(result);
        }
    }

    [Theory]
    [InlineData("guide")][InlineData("unicode")][InlineData("ledger")]
    public async Task CaptureDirectoryAndMemoryMatchS1WithoutGit(string name)
    {
        using var f = new EngineFixture(); var vector = Vector(name);
        var entries = vector["sources"]!.AsObject().Select(p => new PackageInputEntry(p.Key, Profile.Utf8.GetBytes(p.Value!.GetValue<string>()))).ToArray();
        foreach (var entry in entries) f.Write(entry.Path, entry.Content.ToArray());
        var ns = Guid.Parse(vector["namespace"]!.GetValue<string>());
        var builder = new Builder(new("absent-git"));
        GitProcess.BeforeStart.Value = _ => throw new InvalidOperationException("Snapshot invoked Git.");
        try
        {
            var file = await builder.CreateFromDirectoryAsync(new(f.Source, ns), f.Output, Ct); Success(file);
            using var memory = new MemoryStream();
            var stream = await builder.CreateAsync(new(ns, entries), memory, Ct); Success(stream);
            Assert.Equal(File.ReadAllBytes(f.Output), memory.ToArray());
            Assert.Equal(vector["snapshotId"]!.GetValue<string>(), file.Identity!.Current.Id);
            Assert.Equal(IdentityAssurance.SnapshotVerified, file.Assurance);
            Assert.Null(file.History); Assert.IsType<SnapshotHistory>(file.Manifest!.History);
            Assert.DoesNotContain(EngineFixture.Read(f.Output), e => e.Name.StartsWith(".git/", StringComparison.Ordinal) || e.Name == Profile.History);
            foreach (var deep in new[] { false, true })
            {
                var verified = await new Validator(new("absent-git")).ValidateFileAsync(f.Output, new() { Deep = deep }, Ct);
                Success(verified); Assert.Equal(IdentityAssurance.SnapshotVerified, verified.Assurance);
                Assert.Equal(CheckStatus.NotApplicable, verified.Checks[16].Status);
            }
        }
        finally { GitProcess.BeforeStart.Value = null; }
    }

    public static IEnumerable<object[]> HashCases => Data["hashCases"]!.AsArray().Select(c => new object[] { c!["name"]!.GetValue<string>(), c.ToJsonString() });
    [Theory]
    [MemberData(nameof(HashCases))]
    public async Task S1MutationsBindAllContentAndExcludeOnlyTransport(string name, string json)
    {
        using var f = new EngineFixture(); var test = JsonNode.Parse(json)!;
        var vector = Vector(test["base"]!.GetValue<string>());
        var manifestNode = JsonNode.Parse(vector["snapshotManifestCanonical"]!.GetValue<string>())!;
        var files = vector["sources"]!.AsObject().ToDictionary(p => p.Key, p => Profile.Utf8.GetBytes(p.Value!.GetValue<string>()));
        var target = test["target"]!.GetValue<string>();
        if (target.StartsWith("sources/", StringComparison.Ordinal)) files[target[8..]] = Profile.Utf8.GetBytes(test["value"]!.GetValue<string>());
        else if (target.StartsWith("rename/", StringComparison.Ordinal)) { var bytes = files[target[7..]]; files.Remove(target[7..]); files.Add(test["value"]!.GetValue<string>(), bytes); }
        else if (target.StartsWith("header/", StringComparison.Ordinal))
        {
            var keys = target[7..].Split('/'); var node = manifestNode;
            foreach (var key in keys[..^1]) node = node[key]!;
            node[keys[^1]] = test["value"]!.DeepClone();
        }
        else if (name == "evidence")
        {
            manifestNode["review"]!["of"]!["dispatch"] = "second send";
            manifestNode["review"]!["of"]!["packageBytes"] = 123L;
            manifestNode["review"]!["of"]!["packageDigest"] = "sha256-" + new string('a', 64);
        }
        var items = files.Select(p => new EntryData(p.Key, p.Value)).Reverse().ToList();
        if (name == "empty-directory") items.Add(new("empty/", []));
        items.Insert(0, new(Profile.Manifest, CanonicalJson.Bytes(manifestNode, true)));
        EngineFixture.Rewrite(f.Output, items);
        var result = await new Validator(new("absent-git")).ValidateFileAsync(f.Output, new() { Deep = true }, Ct);
        var expected = test["expected"]!.GetValue<string>();
        if (expected == "same") Success(result);
        else Assert.Equal(OperationStatus.Nonconforming, result.Status);
        if (expected == "reject-before-hashing") return;
        var manifest = FormatValidation.ReadManifest(manifestNode);
        Assert.Equal(test["expectedId"]!.GetValue<string>(), SnapshotHash.Compute(manifest, files.Keys, p => files[p], Ct));
        if (expected == "different") Assert.Contains(result.Diagnostics, d => d.Code == "MDPK2001");
    }

    public static IEnumerable<object[]> SchemaCases => Data["invalidCases"]!.AsArray()
        .Where(c => c!["target"]!.GetValue<string>() is "manifest" or "additionalEntries")
        .Select(c => new object[] { c!["name"]!.GetValue<string>(), c.ToJsonString() });
    [Theory]
    [MemberData(nameof(SchemaCases))]
    public async Task S1MalformedSchemaAndInventoriesAreRejected(string name, string json)
    {
        using var f = new EngineFixture(); var test = JsonNode.Parse(json)!;
        var entries = EngineFixture.Read(Fixture(test["base"]!.GetValue<string>()));
        if (test["target"]!.GetValue<string>() == "manifest") entries[0] = new(Profile.Manifest, CanonicalJson.Bytes(test["value"]!, true));
        else foreach (var (path, value) in test["value"]!.AsObject()) entries.Add(new(path, Profile.Utf8.GetBytes(value!.GetValue<string>())));
        WriteAdversarial(f.Output, entries);
        var result = await new Validator(new("absent-git")).ValidateFileAsync(f.Output, new(), Ct);
        Assert.True(result.Status == OperationStatus.Nonconforming, name + ": " + result.Status);
        using var input = File.OpenRead(f.Output);
        await Assert.ThrowsAsync<PackageFormatException>(() => PackageArchive.OpenAsync(input, cancellationToken: Ct));
    }

    private static void WriteAdversarial(string path, IEnumerable<EntryData> entries)
    {
        using var output = File.Create(path);
        using var zip = new System.IO.Compression.ZipArchive(output, System.IO.Compression.ZipArchiveMode.Create);
        foreach (var item in entries)
        {
            var entry = zip.CreateEntry(item.Name, System.IO.Compression.CompressionLevel.NoCompression);
            entry.ExternalAttributes = unchecked((int)0x81a40000);
            using var write = entry.Open(); write.Write(item.Bytes);
        }
    }

    public static IEnumerable<object[]> ArchiveCases => Data["invalidCases"]!.AsArray()
        .Where(c => c!["target"]!.GetValue<string>() == "archive-edit" &&
            (c["name"]!.GetValue<string>().StartsWith("missing-", StringComparison.Ordinal) || c["name"]!.GetValue<string>() is "snapshot-unknown-ledger" or "materialized-without-origin" or "original-with-origin"))
        .Select(c => new object[] { c!["name"]!.GetValue<string>(), c.ToJsonString() });
    [Theory]
    [MemberData(nameof(ArchiveCases))]
    public async Task S1MissingControlsAndRehashedUnknownLedgerAreRejected(string name, string json)
    {
        using var f = new EngineFixture(); var value = JsonNode.Parse(json)!["value"]!; var edit = value["edit"]!;
        var entries = EngineFixture.Read(Fixture(value["fixture"]!.GetValue<string>()));
        if (edit["removeSuffix"] is { } suffix) entries.RemoveAll(e => e.Name.EndsWith(suffix.GetValue<string>(), StringComparison.Ordinal));
        else if (edit["removeEntry"] is { } remove) entries.RemoveAll(e => e.Name == remove.GetValue<string>());
        else
        {
            var at = entries.FindIndex(e => e.Name == edit["jsonEntry"]!.GetValue<string>());
            var node = JsonNode.Parse(entries[at].Bytes)!;
            if (edit["removeKey"] is { } key) node.AsObject().Remove(key.GetValue<string>());
            else
            {
                var keys = edit["path"]!.AsArray().Select(k => k!.GetValue<string>()).ToArray(); var parent = node;
                foreach (var part in keys[..^1]) parent = parent[part]!;
                parent[keys[^1]] = edit["value"]!.DeepClone();
            }
            entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(node) };
        }
        if (edit["rehashSnapshot"]?.GetValue<bool>() == true)
        {
            var manifest = FormatValidation.ReadManifest(JsonNode.Parse(entries[0].Bytes)!);
            var files = entries.Skip(1).ToDictionary(e => e.Name, e => e.Bytes);
            manifest = manifest with { Current = new("snapshot", SnapshotHash.Compute(manifest, files.Keys, p => files[p], Ct)) };
            entries[0] = new(Profile.Manifest, CanonicalJson.Bytes(manifest, true));
        }
        WriteAdversarial(f.Output, entries);
        var result = await new Validator(new("absent-git")).ValidateFileAsync(f.Output, new(), Ct);
        Assert.True(result.Status == OperationStatus.Nonconforming, name + ": " + result.Status);
        using var input = File.OpenRead(f.Output);
        if (name == "snapshot-unknown-ledger")
        {
            using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
            Assert.Throws<PackageFormatException>(() => archive.VerifySnapshot(Ct));
        }
        else await Assert.ThrowsAsync<PackageFormatException>(() => PackageArchive.OpenAsync(input, cancellationToken: Ct));
    }

    [Theory]
    [InlineData("document")][InlineData("aggregate")][InlineData("cancel")]
    public async Task ExplicitSnapshotVerificationHonorsLimitsAndCancellation(string limit)
    {
        using var input = File.OpenRead(Fixture("unicode-snapshot.mdpkg"));
        var limits = limit == "document" ? new ReadLimits { MaxDocumentBytes = 1 } :
            limit == "aggregate" ? new ReadLimits { MaxDecodedBytes = Profile.Utf8.GetByteCount(Vector("unicode")["snapshotManifestCanonical"]!.GetValue<string>()) + 1 } : new();
        using var archive = await PackageArchive.OpenAsync(input, limits, cancellationToken: Ct);
        if (limit == "cancel")
        {
            using var cancel = new CancellationTokenSource();
            var vector = Vector("unicode"); var manifest = FormatValidation.ReadManifest(JsonNode.Parse(vector["snapshotManifestCanonical"]!.GetValue<string>())!);
            Assert.ThrowsAny<OperationCanceledException>(() => SnapshotHash.Compute(manifest, ["x.txt"], _ => { cancel.Cancel(); return new byte[100000]; }, cancel.Token));
            Assert.ThrowsAny<OperationCanceledException>(() => archive.VerifySnapshot(cancel.Token));
        }
        else Assert.Throws<ResourceLimitException>(() => archive.VerifySnapshot(Ct));
        Assert.Equal(IdentityAssurance.Declared, archive.Assurance);
    }

    [Theory]
    [InlineData(0)][InlineData(9)]
    public async Task RecompressionAndUnsortedCurrentFilesKeepSnapshotIdentity(int level)
    {
        using var f = new EngineFixture(); var entries = EngineFixture.Read(Fixture("unicode-snapshot.mdpkg"));
        var reordered = new[] { entries[0] }.Concat(entries.Skip(1).Reverse()).ToList();
        using (var output = File.Create(f.Output)) Core.Internal.Container.ZipContainer.Write(output, reordered, level, true, Ct);
        var result = await new Validator(new("absent-git")).ValidateFileAsync(f.Output, new(), Ct); Success(result);
        Assert.Equal(Vector("unicode")["snapshotId"]!.GetValue<string>(), result.Identity!.Current.Id);
    }

    [Theory]
    [InlineData("add")][InlineData("delete")][InlineData("rename")][InlineData("bytes")][InlineData("utf8")]
    public async Task UnreadNonMarkdownMutationsCannotEscapeExplicitVerification(string mutation)
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n"); f.Write("hidden/.data.txt", "bound bytes\n");
        Success(await new Builder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)), f.Output, Ct));
        var entries = EngineFixture.Read(f.Output); var at = entries.FindIndex(e => e.Name == "hidden/.data.txt");
        if (mutation == "delete") entries.RemoveAt(at);
        else if (mutation == "add") entries.Add(new("new.txt", []));
        else entries[at] = mutation switch { "rename" => entries[at] with { Name = "renamed.txt" }, "utf8" => entries[at] with { Bytes = [255] }, _ => entries[at] with { Bytes = "different\n"u8.ToArray() } };
        EngineFixture.Rewrite(f.Output, entries);
        using var input = File.OpenRead(f.Output);
        using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
        Assert.Equal(IdentityAssurance.Declared, archive.Assurance);
        Assert.Equal("# Guide\n", Profile.Utf8.GetString(archive.ReadEntry("guide.md", cancellationToken: Ct)));
        Assert.Throws<PackageFormatException>(() => archive.VerifySnapshot(Ct));
        Assert.Equal(IdentityAssurance.Declared, archive.Assurance);
        Assert.Equal(OperationStatus.Nonconforming, (await new Validator().ValidateFileAsync(f.Output, new(), Ct)).Status);
    }

    [Theory]
    [InlineData("scope")][InlineData("depth")][InlineData("import")][InlineData("metadata")][InlineData("reverse")]
    public async Task SnapshotRejectsGitOptionsBeforePublication(string option)
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "prior");
        var request = new DirectoryPackageRequest(f.Source, Guid.Parse(EngineFixture.Namespace))
        {
            Scope = option == "scope" ? "*.md" : null, Depth = option == "depth" ? 1 : null,
            Mode = option == "import" ? CreationMode.GitImport : CreationMode.Snapshot,
            Metadata = option == "metadata" ? SnapshotMetadata.CliDefault : null,
            Options = new() { ReverseIndex = option == "reverse" }
        };
        await Assert.ThrowsAsync<ArgumentException>(() => new Builder().CreateFromDirectoryAsync(request, f.Output, Ct));
        Assert.Equal("prior", File.ReadAllText(f.Output));
    }

    [Theory]
    [InlineData("cancel")][InlineData("limit")][InlineData("warning")][InlineData("unknown")]
    public async Task SnapshotFailuresPreserveDestination(string failure)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\r\n"); File.WriteAllText(f.Output, "prior");
        var request = new DirectoryPackageRequest(f.Source, Guid.Parse(EngineFixture.Namespace))
        {
            Correspondence = failure == "unknown" ? new Correspondence([new UnconfirmedRecord(new(EngineFixture.RootId), "unconfirmed-removal")]) : null,
            Options = new() { Warnings = failure == "warning" ? WarningPolicy.Fail : WarningPolicy.Report,
                Resources = failure == "limit" ? new() { MaxSpoolBytes = 1 } : new() }
        };
        if (failure == "cancel")
        {
            using var cancel = new CancellationTokenSource(); cancel.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new Builder(new("absent-git")).CreateFromDirectoryAsync(request, f.Output, cancel.Token));
        }
        else Assert.NotEqual(OperationStatus.Success, (await new Builder(new("absent-git")).CreateFromDirectoryAsync(request, f.Output, Ct)).Status);
        Assert.Equal("prior", File.ReadAllText(f.Output)); Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }
}
