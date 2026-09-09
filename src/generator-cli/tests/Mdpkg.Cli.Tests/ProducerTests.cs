using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine;
using Mdpkg.Cli.Engine.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Cli.Engine.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Engine.Git;
using Mdpkg.Cli.Engine.Validation;

namespace Mdpkg.Cli.Tests;

public class ProducerTests
{
    [Fact]
    public async Task OrdinaryZipExtractionAndGitReadTreePreserveEveryPayload()
    {
        using var f = new EngineFixture(); f.Write("guide.md", EngineFixture.Guide2); f.Write("notes.md", EngineFixture.Notes);
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var extracted = Path.Combine(f.Root, "extracted");
        System.IO.Compression.ZipFile.ExtractToDirectory(f.Output, extracted);
        var git = new GitProcess("git");
        await git.TextAsync(extracted, TestContext.Current.CancellationToken, "read-tree", "HEAD");
        await git.TextAsync(extracted, TestContext.Current.CancellationToken, "fsck", "--full", "--strict");
        foreach (var entry in EngineFixture.Read(f.Output)) Assert.Equal(entry.Bytes, File.ReadAllBytes(Path.Combine(extracted, entry.Name)));
        var status = await git.TextAsync(extracted, TestContext.Current.CancellationToken, "status", "--porcelain", "--untracked-files=all");
        Assert.All(status.Split('\n', StringSplitOptions.RemoveEmptyEntries), row => Assert.StartsWith("?? .mdpkg/", row, StringComparison.Ordinal));
    }
    [Fact]
    public async Task CancellationDuringGitWorkCleansStagingAndPreservesExistingOutput()
    {
        using var f = new EngineFixture();
        for (var i = 0; i < 200; i++) f.Write($"{i}.md", "# File " + i + "\n");
        File.WriteAllText(f.Output, "prior");
        var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var packing = new PackageBuilder(new(TemporaryDirectory: temp)).PackAsync(f.Request, cancel.Token);
        while (Directory.GetFileSystemEntries(temp).Length == 0 && !packing.IsCompleted)
            await Task.Delay(10, TestContext.Current.CancellationToken);
        Assert.False(packing.IsCompleted);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => packing);
        Assert.Equal("prior", File.ReadAllText(f.Output));
        Assert.Empty(Directory.GetFileSystemEntries(temp)); Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }
    [Fact]
    public async Task GitSymlinkIsRejectedWithoutReadingItsTarget()
    {
        using var f = new EngineFixture();
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(TestContext.Current.CancellationToken);
        var tree = await repo.TreeAsync([new("link.md", "../../outside"u8.ToArray(), "120000")], TestContext.Current.CancellationToken);
        var head = await repo.CommitAsync(tree, null, "link", TestContext.Current.CancellationToken);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), head + "\n");
        var result = await new PackageBuilder().PackAsync(f.Request with { FromGit = true }, TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.InvalidSource, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == "MDPK1003");
    }
    [Fact]
    public async Task ExecutableSourceModeIsNormalizedToMatchFixedZipAttributes()
    {
        using var f = new EngineFixture(); var git = new GitProcess("git");
        var repo = new Repository(git, f.Source); await repo.InitializeAsync(TestContext.Current.CancellationToken);
        var tree = await repo.TreeAsync([new("x.md", "# X\n"u8.ToArray(), "100755")], TestContext.Current.CancellationToken);
        var head = await repo.CommitAsync(tree, null, "executable", TestContext.Current.CancellationToken);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), head + "\n");
        var result = await new PackageBuilder().PackAsync(f.Request with { FromGit = true }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result); Assert.NotEqual("sha1-" + head, result.Manifest!.Current);
        var extracted = Path.Combine(f.Root, "extracted"); System.IO.Compression.ZipFile.ExtractToDirectory(f.Output, extracted);
        Assert.StartsWith("100644 blob ", await git.TextAsync(extracted, TestContext.Current.CancellationToken, "ls-tree", "HEAD", "x.md"), StringComparison.Ordinal);
    }
    [Fact]
    public void CliRejectsReportsThatWouldOverwriteInputsOrOutput()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n"); File.WriteAllText(f.Output, "prior");
        var pack = CliRunner.Run("pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace, "--report", f.Output);
        var validate = CliRunner.Run("validate", f.Output, "--report", f.Output);
        Assert.Equal(1, pack.Exit); Assert.Equal(1, validate.Exit); Assert.Equal("prior", File.ReadAllText(f.Output));
    }
    [Fact]
    public void RealValidationFailureWritesMatchingJsonReport()
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "not a zip"); var report = Path.Combine(f.Root, "report.json");
        var result = CliRunner.Run("validate", f.Output, "--format", "json", "--quiet", "--report", report);
        Assert.Equal(3, result.Exit); Assert.Contains("MDPK1011", result.Stderr, StringComparison.Ordinal);
        Assert.Equal(File.ReadAllText(report), result.Stdout.TrimEnd('\r', '\n'));
        using var json = JsonDocument.Parse(result.Stdout);
        Assert.Equal(3, json.RootElement.GetProperty("exitCode").GetInt32());
        Assert.Contains(json.RootElement.GetProperty("checks").EnumerateArray(), c => c.GetProperty("code").GetString() == "MDPK1011" && c.GetProperty("status").GetString() == "fail");
    }
    [Fact]
    public async Task RecordedManifestHistoryAndLayoutRoundTripWithoutProducerMetadata()
    {
        using var f = new EngineFixture(); var (repo, commits) = await f.WorkedRepositoryAsync();
        var recorded = EngineFixture.Recorded["packages"]!["full"]!;
        var entries = new List<EntryData> { new(Profile.Manifest, Profile.Utf8.GetBytes(recorded["manifest_bytes"]!.GetValue<string>())) };
        entries.AddRange((await repo.ReadTreeAsync(commits[^1], null, [], normalize: false, TestContext.Current.CancellationToken)).OrderBy(e => e.Name, Utf8Comparer.Instance));
        entries.Add(new(Profile.History, CanonicalJson.Bytes(recorded["history"]!)));
        entries.AddRange(await repo.CurateAsync(commits[^1], false, TestContext.Current.CancellationToken));
        EngineFixture.Rewrite(f.Output, entries);
        using var file = File.OpenRead(f.Output); var zip = ZipContainer.Read(file, TestContext.Current.CancellationToken);
        var expected = recorded["entries"]!.AsArray();
        Assert.Equal(expected.Count, zip.Members.Count);
        long displacement = 0;
        for (var i = 0; i < zip.Members.Count; i++)
        {
            var row = expected[i]!; var entry = zip.Members[i];
            Assert.Equal(row["local"]!.GetValue<long>() + displacement, entry.Offset);
            Assert.Equal(row["data"]!.GetValue<long>() + displacement, entry.DataOffset);
            Assert.Equal(row["method"]!.GetValue<ushort>(), entry.Method);
            Assert.Equal(row["flags"]!.GetValue<ushort>(), entry.Flags);
            // Compressors/runtime versions can emit different valid DEFLATE streams.
            // Compare the recorded layout with only those payload-length shifts applied.
            displacement += entry.CompressedSize - row["csize"]!.GetValue<long>();
            if (!entry.Name.EndsWith(".pack", StringComparison.Ordinal))
            {
                Assert.Equal(row["usize"]!.GetValue<uint>(), entry.Size);
                if (!entry.Name.EndsWith(".idx", StringComparison.Ordinal)) Assert.Equal(row["crc"]!.GetValue<string>(), entry.Crc.ToString("x8"));
            }
        }
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken));
    }
    [Fact]
    public async Task SnapshotIsDeterministicAndDeepValidatesWithNormalizedSourceUnchanged()
    {
        using var f = new EngineFixture();
        f.Write("café.md", "\ufeff# Héllo\r\n\rline\r\n"); f.Write("zero.md", ""); f.Write(".git/config", "ignored");
        var builder = new PackageBuilder(); var first = await builder.PackAsync(f.Request, TestContext.Current.CancellationToken);
        EngineFixture.Success(first);
        Assert.Contains(first.Diagnostics, d => d.Code == "MDPK1004" && d.Severity == "warn");
        Assert.Null(first.Manifest!.Addressing.Overrides);
        Assert.Equal("\ufeff# Héllo\n\nline\n", Profile.Utf8.GetString(EngineFixture.Read(f.Output).Single(e => e.Name == "café.md").Bytes));
        Assert.Contains('\r', File.ReadAllText(Path.Combine(f.Source, "café.md")));
        var bytes = File.ReadAllBytes(f.Output);
        var again = await builder.PackAsync(f.Request, TestContext.Current.CancellationToken); EngineFixture.Success(again);
        Assert.Equal(bytes, File.ReadAllBytes(f.Output));
        var checkedResult = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken);
        EngineFixture.Success(checkedResult);
        Assert.All(checkedResult.Checks, c => Assert.Equal("pass", c.Status));
        Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }
    [Theory]
    [InlineData(0, false, false)][InlineData(1, true, false)][InlineData(6, true, true)][InlineData(9, false, true)]
    public async Task CompressionDescriptorAndReverseIndexOptionsAreImplemented(int level, bool descriptors, bool reverse)
    {
        using var f = new EngineFixture(); f.Write("é.md", "# Title\n" + new string('a', 3000));
        var result = await new PackageBuilder().PackAsync(f.Request with { CompressionLevel = level, DataDescriptors = descriptors, ReverseIndex = reverse }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result);
        using var file = File.OpenRead(f.Output); var zip = ZipContainer.Read(file, TestContext.Current.CancellationToken);
        Assert.Equal(reverse, zip.Members.Any(e => e.Name.EndsWith(".rev", StringComparison.Ordinal)));
        Assert.Equal(0, zip.Members[0].Flags & 8);
        Assert.All(zip.Members.Skip(1), e => Assert.Equal(descriptors ? 8 : 0, e.Flags & 8));
        Assert.Equal(0x800, zip.Members.Single(e => e.Name == "é.md").Flags & 0x800);
        Assert.Equal(level == 0 ? 0 : 8, zip.Members.Single(e => e.Name == "é.md").Method);
    }
    [Fact]
    public async Task WorkedExampleImportPreservesAllRecordedGitIdsAndCurrentPayloads()
    {
        using var f = new EngineFixture(); var (repo, commits) = await f.WorkedRepositoryAsync();
        for (var i = 0; i < 3; i++) Assert.Equal(EngineFixture.Recorded["commits"]!["c" + i]!.GetValue<string>(), commits[i]);
        var result = await new PackageBuilder().PackAsync(f.Request with { Source = repo.Path, FromGit = true }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result);
        Assert.Equal("sha1-" + commits[^1], result.Manifest!.Current);
        Assert.Equal(3, result.History!.RetainedCommits);
        Assert.Equal("complete", result.Manifest.Addressing.Coverage);
        Assert.Equal(1, result.OverrideCount);
        using var stream = File.OpenRead(f.Output); var zip = ZipContainer.Read(stream, TestContext.Current.CancellationToken);
        var recorded = EngineFixture.Recorded["packages"]!["full"]!;
        Assert.Equal(recorded["manifest_bytes"]!.GetValue<string>(), Profile.Utf8.GetString(zip.Members[0].Bytes));
        Assert.Equal(0u, zip.Members[0].Offset); Assert.Equal(50, zip.Members[0].DataOffset);
        Assert.EndsWith(".pack", zip.Members[^1].Name, StringComparison.Ordinal);
        foreach (var member in zip.Members.Where(m => m.Name is "guide.md" or "notes.md" or Profile.Ledger))
        {
            var expected = recorded["entries"]!.AsArray().Single(e => e!["name"]!.GetValue<string>() == member.Name)!;
            Assert.Equal(expected["crc"]!.GetValue<string>(), member.Crc.ToString("x8"));
            Assert.Equal(expected["usize"]!.GetValue<uint>(), member.Size);
        }
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken));
    }
    [Fact]
    public async Task GitDepthAndPathspecProjectionRetainSelectedFirstParentHistory()
    {
        using var f = new EngineFixture(); var (repo, commits) = await f.WorkedRepositoryAsync();
        var result = await new PackageBuilder().PackAsync(f.Request with { Source = repo.Path, FromGit = true, Scope = ":(glob)notes.*", Depth = 2 }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result);
        Assert.Equal("truncated", result.Manifest!.History.Coverage); Assert.Equal("synthetic", result.History!.Root);
        Assert.Equal(2, result.History.RetainedCommits); Assert.Equal("sha1-" + commits[1], result.History.SourceBase);
        Assert.Equal(["projected"], result.Manifest.History.Transform);
        Assert.DoesNotContain(EngineFixture.Read(f.Output), e => e.Name is "guide.md" or ".git/shallow" or Profile.Ledger);
        Assert.NotEqual("sha1-" + commits[^1], result.Manifest.Current);
    }
    [Fact]
    public async Task SnapshotScopeUsesGitPathspecs()
    {
        using var f = new EngineFixture(); f.Write("docs/a.md", "# A\n"); f.Write("other.md", "# Other\n");
        var result = await new PackageBuilder().PackAsync(f.Request with { Scope = ":(glob)docs/*.md" }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result);
        Assert.DoesNotContain(EngineFixture.Read(f.Output), e => e.Name == "other.md");
    }
    [Fact]
    public async Task HistoricalCrLfIsNormalizedEvenWhenTipAlreadyUsesLf()
    {
        using var f = new EngineFixture(); var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(TestContext.Current.CancellationToken);
        var tree1 = await repo.TreeAsync([new("x.md", "# A\r\n"u8.ToArray())], TestContext.Current.CancellationToken);
        var c1 = await repo.CommitAsync(tree1, null, "old", TestContext.Current.CancellationToken);
        var tree2 = await repo.TreeAsync([new("x.md", "# A\n"u8.ToArray())], TestContext.Current.CancellationToken);
        var c2 = await repo.CommitAsync(tree2, c1, "tip", TestContext.Current.CancellationToken);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), c2 + "\n");
        var result = await new PackageBuilder().PackAsync(f.Request with { FromGit = true }, TestContext.Current.CancellationToken); EngineFixture.Success(result);
        Assert.NotEqual("sha1-" + c2, result.Manifest!.Current);
        Assert.Equal("sha1-" + c2, result.History!.SourceTip);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK1004");
    }
    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task UnconfirmedImportRemovalsArePartialOrFailRequirement(bool required)
    {
        using var f = new EngineFixture(); var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(TestContext.Current.CancellationToken);
        var first = await repo.CommitAsync(await repo.TreeAsync([new("x.md", "# Old\n"u8.ToArray())], TestContext.Current.CancellationToken), null, "a", TestContext.Current.CancellationToken);
        var last = await repo.CommitAsync(await repo.TreeAsync([new("x.md", "# New\n"u8.ToArray())], TestContext.Current.CancellationToken), first, "b", TestContext.Current.CancellationToken);
        File.WriteAllText(Path.Combine(f.Source, "refs", "heads", "main"), last + "\n");
        var result = await new PackageBuilder().PackAsync(f.Request with { FromGit = true, RequireComplete = required }, TestContext.Current.CancellationToken);
        Assert.Equal(required ? Outcome.Incomplete : Outcome.Success, result.Outcome);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK3001");
        if (!required) Assert.Equal("partial", result.Manifest!.Addressing.Coverage);
        Assert.Equal(!required, File.Exists(f.Output));
    }
    [Fact]
    public async Task SparseCorrespondenceAndReservedBirthAreTrackedAndValidated()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var locator = new JsonArray("section", "x.md", new JsonArray(new JsonArray("# X", 0)));
        var oldRoot = Inventory.Root(CliRunner.Namespace, locator);
        var correspondence = Path.Combine(f.Root, "records.json");
        File.WriteAllBytes(correspondence, CanonicalJson.Bytes(new JsonArray(new JsonObject { ["root"] = oldRoot, ["dead"] = "deleted" })));
        var result = await new PackageBuilder().PackAsync(f.Request with { Correspondence = correspondence }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result); Assert.Equal(2, result.OverrideCount); Assert.Equal(1, result.MintedRoots);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK3002");
    }
    [Fact]
    public async Task UnknownCorrespondenceSetsPartialAndUnconfirmedCandidateIsRejected()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n"); var records = Path.Combine(f.Root, "records.json");
        File.WriteAllText(records, "[{\"root\":\"" + CliRunner.Root + "\",\"unknown\":\"unconfirmed-removal\"}]");
        var result = await new PackageBuilder().PackAsync(f.Request with { Correspondence = records }, TestContext.Current.CancellationToken);
        EngineFixture.Success(result); Assert.Equal("partial", result.Manifest!.Addressing.Coverage);
        File.WriteAllText(records, "[{\"root\":\"" + CliRunner.Root + "\",\"confirmed\":false,\"to\":[\"document\",\"x.md\",[]]}]");
        result = await new PackageBuilder().PackAsync(f.Request with { Correspondence = records }, TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.InvalidSource, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == "MDPK3003");
    }
    [Fact]
    public async Task InvalidUtf8AndWarningsPreserveExistingDestinationAndLeaveNoTemps()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\r\n"); File.WriteAllText(f.Output, "prior");
        var warning = await new PackageBuilder().PackAsync(f.Request with { FailOnWarning = true }, TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, warning.Outcome); Assert.Equal("prior", File.ReadAllText(f.Output));
        f.Write("x.md", [0xff, 0xfe]); var invalid = await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.InvalidSource, invalid.Outcome); Assert.Contains(invalid.Diagnostics, d => d.Code == "MDPK4003");
        Assert.Equal("prior", File.ReadAllText(f.Output)); Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }
    [Fact]
    public async Task CancellationAndMissingGitCleanTemporaryState()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        var missing = await new PackageBuilder(new("mdpkg-no-such-git-" + Guid.NewGuid(), temp)).PackAsync(f.Request, TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Environment, missing.Outcome); Assert.Empty(Directory.GetFileSystemEntries(temp));
        using var canceled = new CancellationTokenSource(); canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new PackageBuilder(new(TemporaryDirectory: temp)).PackAsync(f.Request, canceled.Token));
        Assert.Empty(Directory.GetFileSystemEntries(temp)); Assert.False(File.Exists(f.Output));
    }
    [Fact]
    public async Task CliReturnsOneReportAndImplementsNamespaceAndFormatRejections()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n"); var report = Path.Combine(f.Root, "report.json");
        var cli = CliRunner.Run("--namespace", CliRunner.Namespace, "pack", f.Source, "--out", f.Output, "--format", "json", "--quiet", "--report", report);
        Assert.Equal(0, cli.Exit); Assert.Empty(cli.Stderr);
        var line = Assert.Single(cli.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries)).TrimEnd('\r'); Assert.Equal(File.ReadAllText(report), line);
        using var json = JsonDocument.Parse(line); Assert.Equal(0, json.RootElement.GetProperty("exitCode").GetInt32());
        var mismatch = CliRunner.Run("validate", f.Output, "--namespace", "00000000-0000-0000-0000-000000000000"); Assert.Equal(3, mismatch.Exit);
        var sha256 = CliRunner.Run("pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace, "--object-format", "sha256"); Assert.Equal(2, sha256.Exit); Assert.Contains("MDPK4001", sha256.Stderr, StringComparison.Ordinal);
    }
}
