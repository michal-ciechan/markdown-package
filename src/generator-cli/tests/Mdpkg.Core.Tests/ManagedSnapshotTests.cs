using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.Validation;
using Mdpkg.Reader.Internal.Format;
using Builder = Mdpkg.Core.Internal.PackageBuilder;
using Settings = Mdpkg.Core.Internal.EngineSettings;
using Validator = Mdpkg.Core.Internal.Validation.PackageValidator;

namespace Mdpkg.EngineTests;

public class ManagedSnapshotTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static Settings Managed => new("missing-git-" + Guid.NewGuid()) { ManagedSnapshots = true };

    [Theory]
    [InlineData(false, 0, false)][InlineData(true, 1, true)][InlineData(true, 6, false)][InlineData(false, 9, true)]
    public async Task ManagedObjectsMatchNativeAndExtractWithNativeGit(bool empty, int level, bool reverse)
    {
        using var f = new EngineFixture();
        if (!empty)
        {
            foreach (var name in new[] { "foo.c", "foo/a.txt", "foo0", "é/α.md", "e\u0301.txt", "duplicate" }) f.Write(name, "\ufeff# Héllo\r\n\rText\n");
            f.Write("empty", ""); f.Write(".git/config", "ignored");
        }
        var metadata = SnapshotMetadata.CliDefault with
        {
            Author = new("Ünicode", "author@invalid", DateTimeOffset.FromUnixTimeSeconds(1000).ToOffset(TimeSpan.FromMinutes(-330))),
            Committer = new("Another", "committer@invalid", DateTimeOffset.FromUnixTimeSeconds(2000).ToOffset(TimeSpan.FromMinutes(345))),
            Message = "custom\n\nmessage\n\n"
        };
        var request = f.Request with { CompressionLevel = level, ReverseIndex = reverse, DataDescriptors = true, Metadata = metadata, Message = metadata.Message };
        var native = await new Builder().PackAsync(request, Ct); EngineFixture.Success(native);
        var expected = EngineFixture.Read(f.Output).Where(e => !e.Name.StartsWith(".git/", StringComparison.Ordinal)).ToArray();
        var impossibleTemp = Path.Combine(f.Root, "not-a-directory"); File.WriteAllText(impossibleTemp, "file");
        var settings = Managed with { TemporaryDirectory = impossibleTemp };
        GitProcess.BeforeStart.Value = _ => throw new InvalidOperationException("Managed snapshot invoked Git.");
        EngineResult actual;
        try { actual = await new Builder(settings).PackAsync(request, Ct); }
        finally { GitProcess.BeforeStart.Value = null; }
        EngineFixture.Success(actual); Assert.Equal(native.Manifest!.Current, actual.Manifest!.Current);
        Assert.All(actual.Checks, c => Assert.Equal("pass", c.Status));
        var first = File.ReadAllBytes(f.Output);
        EngineFixture.Success(await new Builder(settings).PackAsync(request, Ct)); Assert.Equal(first, File.ReadAllBytes(f.Output));
        foreach (var entry in expected) Assert.Equal(entry.Bytes, EngineFixture.Read(f.Output).Single(e => e.Name == entry.Name).Bytes);
        var extracted = Path.Combine(f.Root, "extracted"); ZipFile.ExtractToDirectory(f.Output, extracted);
        var git = new GitProcess("git");
        await git.TextAsync(extracted, Ct, "fsck", "--full", "--strict");
        await git.TextAsync(extracted, Ct, "read-tree", "HEAD");
        var pack = Directory.GetFiles(Path.Combine(extracted, ".git", "objects", "pack"), "*.pack").Single();
        var oracleIndex = Path.Combine(f.Root, "oracle.idx");
        await git.TextAsync(extracted, Ct, "index-pack", "--strict", "--rev-index", "-o", oracleIndex, pack);
        Assert.Equal(File.ReadAllBytes(Path.ChangeExtension(pack, ".idx")), File.ReadAllBytes(oracleIndex));
        if (reverse) Assert.Equal(File.ReadAllBytes(Path.ChangeExtension(pack, ".rev")), File.ReadAllBytes(Path.ChangeExtension(oracleIndex, ".rev")));
        EngineFixture.Success(await new Validator().ValidateAsync(new(f.Output, Deep: true), Ct));
    }

    [Fact]
    public async Task ManagedPublicDirectoryAndStreamHaveParityWithoutGit()
    {
        using var f = new EngineFixture(); f.Write("x.txt", "\ufeffHi\r\nthere\r"); f.Write(".git", "gitdir: missing");
        var settings = new Mdpkg.Core.EngineSettings("missing-git") { ManagedSnapshots = true };
        var builder = new Mdpkg.Core.PackageBuilder(settings);
        GitProcess.BeforeStart.Value = _ => throw new InvalidOperationException("Git invocation");
        try
        {
            var directory = await builder.CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)), f.Output, Ct);
            Assert.Equal(OperationStatus.Success, directory.Status);
            using var output = new MemoryStream();
            var memory = await builder.CreateAsync(new(Guid.Parse(EngineFixture.Namespace), SnapshotMetadata.CliDefault,
                [new("x.txt", File.ReadAllBytes(Path.Combine(f.Source, "x.txt")))]), output, Ct);
            Assert.Equal(OperationStatus.Success, memory.Status); Assert.True(output.CanWrite);
            Assert.Equal(File.ReadAllBytes(f.Output), output.ToArray());
            Assert.Equal("gitdir: missing", File.ReadAllText(Path.Combine(f.Source, ".git")));
        }
        finally { GitProcess.BeforeStart.Value = null; }
    }

    [Theory]
    [InlineData("scope")][InlineData("depth")][InlineData("import")][InlineData("deep")]
    public async Task NativeOnlyOperationsStillRequireGit(string operation)
    {
        using var f = new EngineFixture(); f.Write("a", "text");
        EngineResult result;
        if (operation == "deep")
        {
            EngineFixture.Success(await new Builder(Managed).PackAsync(f.Request, Ct));
            result = await new Validator(Managed).ValidateAsync(new(f.Output, Deep: true), Ct);
        }
        else result = await new Builder(Managed).PackAsync(f.Request with
            { Scope = operation == "scope" ? "a" : null, Depth = operation == "depth" ? 1 : null, FromGit = operation == "import" }, Ct);
        Assert.Equal(Outcome.Environment, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == "MDPK5001");
    }

    [Theory]
    [InlineData("utf8")][InlineData("warning")][InlineData("resource")][InlineData("collision")][InlineData("cancel")]
    public async Task ManagedFailuresPreserveDestination(string kind)
    {
        using var f = new EngineFixture(); f.Write("x", kind == "warning" ? "text\r" : "text"); File.WriteAllText(f.Output, "prior");
        if (kind == "utf8") f.Write("x", [255]);
        var request = f.Request with { FailOnWarning = kind == "warning", Resources = kind == "resource" ? new() { MaxSpoolBytes = 10 } : null,
            InputEntries = kind == "collision" ? [new("X", "a"u8.ToArray()), new("x", "b"u8.ToArray())] : null };
        if (kind == "cancel")
        {
            using var cancel = new CancellationTokenSource(); cancel.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new Builder(Managed).PackAsync(request, cancel.Token));
        }
        else Assert.NotEqual(Outcome.Success, (await new Builder(Managed).PackAsync(request, Ct)).Outcome);
        Assert.Equal("prior", File.ReadAllText(f.Output)); Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }

    [Theory]
    [InlineData("pack-checksum")][InlineData("pack-version")][InlineData("count")][InlineData("kind")]
    [InlineData("length")][InlineData("payload")][InlineData("trailing")][InlineData("truncated")]
    [InlineData("index-checksum")][InlineData("index-version")][InlineData("fanout")][InlineData("id")]
    [InlineData("crc")][InlineData("offset")][InlineData("large-offset")][InlineData("index-trailing")]
    [InlineData("reverse-checksum")][InlineData("reverse-order")][InlineData("reverse-hash")]
    [InlineData("view")][InlineData("coverage")][InlineData("history")][InlineData("utf8")][InlineData("cr")]
    public async Task ManagedVerifierRejectsRewrappedCorruption(string fault)
    {
        using var f = new EngineFixture(); f.Write("x", "payload\n");
        EngineFixture.Success(await new Builder(Managed).PackAsync(f.Request with { ReverseIndex = true }, Ct));
        var entries = EngineFixture.Read(f.Output);
        var packAt = entries.FindIndex(e => e.Name.EndsWith(".pack", StringComparison.Ordinal));
        var indexAt = entries.FindIndex(e => e.Name.EndsWith(".idx", StringComparison.Ordinal));
        var revAt = entries.FindIndex(e => e.Name.EndsWith(".rev", StringComparison.Ordinal));
        var pack = entries[packAt].Bytes; var index = entries[indexAt].Bytes; var rev = entries[revAt].Bytes;
        var count = (int)BinaryPrimitives.ReadUInt32BigEndian(pack.AsSpan(8, 4));
        switch (fault)
        {
            case "pack-checksum": pack[^1] ^= 1; break;
            case "pack-version": pack[7] = 3; break;
            case "count": pack[11]++; break;
            case "kind": pack[12] = (byte)((pack[12] & 143) | 64); break;
            case "length": pack[12] ^= 1; break;
            case "payload": pack[16] ^= 127; break;
            case "trailing": pack = [.. pack[..^20], 0, .. pack[^20..]]; break;
            case "truncated": pack = [.. pack[..^21], .. pack[^20..]]; break;
            case "index-checksum": index[^1] ^= 1; break;
            case "index-version": index[7] = 1; break;
            case "fanout": index[11]++; break;
            case "id": index[1032] ^= 1; break;
            case "crc": index[1032 + count * 20] ^= 1; break;
            case "offset": index[1032 + count * 24 + 3]++; break;
            case "large-offset": index[1032 + count * 24] |= 128; break;
            case "index-trailing": index = [.. index[..^20], 0, .. index[^20..]]; break;
            case "reverse-checksum": rev[^1] ^= 1; break;
            case "reverse-order": rev[15] = 1; break;
            case "reverse-hash": rev[11] = 2; break;
            case "view": entries[entries.FindIndex(e => e.Name == "x")] = new("x", "changed\n"u8.ToArray()); break;
            case "utf8": entries[entries.FindIndex(e => e.Name == "x")] = new("x", [255]); break;
            case "cr": entries[entries.FindIndex(e => e.Name == "x")] = new("x", "CR\r"u8.ToArray()); break;
            case "coverage":
            case "history":
                var at = entries.FindIndex(e => e.Name == Profile.History); var json = JsonNode.Parse(entries[at].Bytes)!;
                if (fault == "history") json["sourceBase"] = "sha1-" + new string('a', 40);
                else json["addressingCoverage"]![0]!["from"] = "sha1-" + new string('a', 40);
                entries[at] = new(Profile.History, CanonicalJson.Bytes(json)); break;
        }
        if (fault != "pack-checksum") Repair(pack);
        var checksum = pack[^20..]; checksum.CopyTo(index, index.Length - 40); checksum.CopyTo(rev, rev.Length - 40);
        if (fault != "index-checksum") Repair(index);
        if (fault != "reverse-checksum") Repair(rev);
        var stem = ".git/objects/pack/pack-" + Convert.ToHexStringLower(checksum);
        entries[packAt] = new(stem + ".pack", pack); entries[indexAt] = new(stem + ".idx", index); entries[revAt] = new(stem + ".rev", rev);
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Validator(Managed).ValidateAsync(new(f.Output, Deep: true), Ct, managedSnapshot: true);
        Assert.Equal(Outcome.Nonconforming, result.Outcome);
        Assert.Contains(result.Diagnostics, d => d.Code is "MDPK4002" or "MDPK2001" or "MDPK2003" or "MDPK2007" or "MDPK4003" or "MDPK1004");
    }

    private static void Repair(byte[] bytes) => SHA1.HashData(bytes.AsSpan(0, bytes.Length - 20)).CopyTo(bytes, bytes.Length - 20);

    [Theory]
    [InlineData("", true)]
    [InlineData("# comment\n", true)]
    [InlineData("[submodule \"lib\"]\npath = libs/lib\nurl = https://example.invalid/lib.git\n", true)]
    [InlineData("[submodule.lib]\npath = libs/lib\nurl = ../lib.git\n", true)]
    [InlineData("[submodule \"lib\"]\npath = \"libs/\"lib\nurl = https://example.invalid/\\\nlib.git\n", true)]
    [InlineData("not config\n", true)]
    [InlineData("[submodule \"..\"]\npath=x\n", false)]
    [InlineData("[submodule \"lib\"]\npath=-evil\n", false)]
    [InlineData("[submodule \"lib\"]\nupdate=!command\n", false)]
    [InlineData("[submodule \"lib\"]\nurl=-evil\n", false)]
    [InlineData("[submodule \"lib\"]\nurl=../%0aevil\n", false)]
    [InlineData("[submodule \"lib\"]\nurl=http://example.invalid/%0aevil\n", false)]
    public async Task SpecialGitmodulesRulesMatchNative(string content, bool valid)
    {
        using var f = new EngineFixture(); f.Write("nested/.gitmodules", content);
        var native = await new Builder().PackAsync(f.Request, Ct);
        var managed = await new Builder(Managed).PackAsync(f.Request, Ct);
        Assert.Equal(valid, native.Outcome == Outcome.Success); Assert.Equal(valid, managed.Outcome == Outcome.Success);
        if (valid) Assert.Equal(native.Manifest!.Current, managed.Manifest!.Current);
    }

    [Theory]
    [InlineData(".git")][InlineData("git~1")][InlineData(".g\u200cit")][InlineData(".GIT")]
    public async Task NestedGitAliasesCannotProduceAValidatedSnapshot(string name)
    {
        using var f = new EngineFixture(); f.Write("nested/" + name + "/x", "text");
        Assert.NotEqual(Outcome.Success, (await new Builder().PackAsync(f.Request, Ct)).Outcome);
        Assert.Equal(Outcome.Nonconforming, (await new Builder(Managed).PackAsync(f.Request, Ct)).Outcome);
    }

    [Theory]
    [InlineData(2047, true)][InlineData(2048, false)]
    public async Task GitAttributesLineBoundsMatchNative(int size, bool valid)
    {
        using var f = new EngineFixture(); f.Write(".gitattributes", new string('a', size) + "\n");
        var native = await new Builder().PackAsync(f.Request, Ct);
        var managed = await new Builder(Managed).PackAsync(f.Request, Ct);
        Assert.Equal(valid, native.Outcome == Outcome.Success); Assert.Equal(valid, managed.Outcome == Outcome.Success);
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task CapturesUnbornAndDirtyRepositoryCurrentFilesWithoutSourceWrites(bool committed)
    {
        using var f = new EngineFixture(); var git = new GitProcess("git");
        await git.TextAsync(f.Source, Ct, "init", "--initial-branch=main", "--template=");
        f.Write("tracked.txt", "committed\n"); f.Write(".gitignore", "ignored.txt\n");
        if (committed)
        {
            await git.TextAsync(f.Source, Ct, "add", ".");
            await git.TextAsync(f.Source, Ct, "-c", "user.name=Test", "-c", "user.email=test@invalid", "commit", "-m", "source");
        }
        f.Write("tracked.txt", "staged\n"); await git.TextAsync(f.Source, Ct, "add", "tracked.txt");
        f.Write("tracked.txt", "current\r\n"); f.Write("untracked.txt", "untracked"); f.Write("ignored.txt", "ignored");
        var before = Directory.GetFiles(f.Source, "*", SearchOption.AllDirectories).ToDictionary(p => p, File.ReadAllBytes);
        EngineFixture.Success(await new Builder(Managed).PackAsync(f.Request, Ct));
        var entries = EngineFixture.Read(f.Output);
        Assert.Equal("current\n", Profile.Utf8.GetString(entries.Single(e => e.Name == "tracked.txt").Bytes));
        Assert.Contains(entries, e => e.Name == "untracked.txt"); Assert.Contains(entries, e => e.Name == "ignored.txt");
        Assert.Equal(before.Keys.Order(), Directory.GetFiles(f.Source, "*", SearchOption.AllDirectories).Order());
        foreach (var file in before) Assert.Equal(file.Value, File.ReadAllBytes(file.Key));
    }

    [Fact]
    public async Task ManagedCorrespondenceCoverageAndReservedBirthRemainValidated()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var records = Profile.Utf8.GetBytes("[{\"root\":\"" + EngineFixture.RootId + "\",\"unknown\":\"unconfirmed-removal\"}]");
        var request = f.Request with { CorrespondenceBytes = records };
        var native = await new Builder().PackAsync(request, Ct); EngineFixture.Success(native);
        var managed = await new Builder(Managed).PackAsync(request, Ct); EngineFixture.Success(managed);
        Assert.Equal(native.Manifest!.Current, managed.Manifest!.Current); Assert.Equal("partial", managed.Manifest.Addressing.Coverage);
        Assert.Equal(Outcome.Incomplete, (await new Builder(Managed).PackAsync(request with { RequireComplete = true }, Ct)).Outcome);
        var locator = new JsonArray("section", "x.md", new JsonArray(new JsonArray("# X", 0)));
        var root = Mdpkg.Reader.Internal.Addressing.Inventory.Root(EngineFixture.Namespace, locator);
        records = CanonicalJson.Bytes(new JsonArray(new JsonObject { ["root"] = root, ["dead"] = "deleted" }));
        managed = await new Builder(Managed).PackAsync(f.Request with { CorrespondenceBytes = records }, Ct); EngineFixture.Success(managed);
        Assert.Equal(1, managed.MintedRoots); Assert.Equal(2, managed.OverrideCount);
        EngineFixture.Success(await new Validator().ValidateAsync(new(f.Output, Deep: true), Ct));
    }
}
