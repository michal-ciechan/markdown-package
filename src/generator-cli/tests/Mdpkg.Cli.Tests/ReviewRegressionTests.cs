using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Commands;
using Mdpkg.Cli.Engine;
using Mdpkg.Cli.Engine.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Engine.Git;
using Mdpkg.Cli.Engine.Validation;

namespace Mdpkg.Cli.Tests;

public class ReviewRegressionTests
{
    [Fact]
    public async Task ValidateRejectsHardLinkedReportAndPreservesPackageBytes()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var original = File.ReadAllBytes(f.Output);
        var report = Path.Combine(f.Root, "report.json"); HardLink(report, f.Output);
        var result = CliRunner.Run("validate", f.Output, "--deep", "--report", report, "--format", "json");
        Assert.Equal(1, result.Exit); Assert.Contains("--report", result.Stderr, StringComparison.Ordinal);
        Assert.Contains("alias", result.Stderr, StringComparison.Ordinal);
        Assert.Equal(original, File.ReadAllBytes(f.Output)); Assert.Equal(original, File.ReadAllBytes(report));
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("source")][InlineData("correspondence")][InlineData("output")]
    public void PackRejectsHardLinkedReportsBeforePublishingAnything(string target)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var records = Path.Combine(f.Root, "records.json"); File.WriteAllText(records, "[]");
        File.WriteAllText(f.Output, "prior package");
        var input = target switch { "source" => Path.Combine(f.Source, "x.md"), "correspondence" => records, _ => f.Output };
        var original = File.ReadAllBytes(input);
        var report = Path.Combine(f.Root, "report.json"); HardLink(report, input);
        var result = CliRunner.Run("pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace,
            "--correspondence", records, "--report", report);
        Assert.Equal(1, result.Exit); Assert.Contains("alias", result.Stderr, StringComparison.Ordinal);
        Assert.Equal(original, File.ReadAllBytes(input)); Assert.Equal(original, File.ReadAllBytes(report));
        Assert.Equal("prior package", File.ReadAllText(f.Output));
    }

    [Fact]
    public void PackRejectsNonexistentReportInsideLinkedSourceDirectory()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var alias = Path.Combine(f.Root, "linked-source"); DirectoryLink(alias, f.Source);
        try
        {
            var result = CliRunner.Run("pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace,
                "--report", Path.Combine(alias, "report.json"));
            Assert.Equal(1, result.Exit); Assert.Contains("outside the source", result.Stderr, StringComparison.Ordinal);
            Assert.False(File.Exists(Path.Combine(f.Source, "report.json"))); Assert.False(File.Exists(f.Output));
        }
        finally { Directory.Delete(alias); }
    }

    [Fact]
    public void ValidateRejectsInputThroughLinkedParentDirectory()
    {
        using var f = new EngineFixture(); f.Write("input.mdpkg", "prior bytes");
        var alias = Path.Combine(f.Root, "linked-source"); DirectoryLink(alias, f.Source);
        try
        {
            var result = CliRunner.Run("validate", Path.Combine(f.Source, "input.mdpkg"), "--report", Path.Combine(alias, "input.mdpkg"));
            Assert.Equal(1, result.Exit); Assert.Contains("--report", result.Stderr, StringComparison.Ordinal);
            Assert.Equal("prior bytes", File.ReadAllText(Path.Combine(f.Source, "input.mdpkg")));
        }
        finally { Directory.Delete(alias); }
    }

    [Fact]
    public void ReportPublicationReplacesRatherThanTruncatingAnExistingInode()
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "protected bytes");
        var report = Path.Combine(f.Root, "report.json"); HardLink(report, f.Output);
        // Exercise publication independently: a link could appear after the last guard.
        ReportDestination.Write(report, "{}");
        Assert.Equal("protected bytes", File.ReadAllText(f.Output)); Assert.Equal("{}", File.ReadAllText(report));
        Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }

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
        var root = Inventory.Root(CliRunner.Namespace, new JsonArray("section", "x.md", new JsonArray(new JsonArray("# Old", 0))));
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
            history = history with { AddressingCoverage = [new(history.AddressingCoverage[0].From, manifest.Current, "complete")] };
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
        var manifest = new Manifest(Profile.Magic, CliRunner.Namespace, "sha1-" + last,
            new(Profile.Anchor, Profile.Digest, "complete", null), new("complete", [], Profile.History));
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
        var result = CliRunner.Run("pack", f.Source, "--from-git", "--out", f.Output, "--namespace", CliRunner.Namespace);
        Assert.True(result.Exit == 0, result.Stderr);
        var validated = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct); EngineFixture.Success(validated);
        if (normalize) Assert.NotEqual("sha1-" + head, validated.Manifest!.Current);
        else Assert.Equal("sha1-" + head, validated.Manifest!.Current);
        var extracted = Path.Combine(f.Root, "extracted"); System.IO.Compression.ZipFile.ExtractToDirectory(f.Output, extracted);
        var retained = await new Repository(git, extracted).ReadObjectAsync("commit", validated.Manifest.Current[5..], ct);
        Assert.True(retained.AsSpan().EndsWith(metadata));
        if (!normalize) Assert.Equal(original, retained);
    }

    private static void HardLink(string link, string target)
    {
        var success = OperatingSystem.IsWindows() ? CreateHardLink(link, target, IntPtr.Zero) : Link(target, link) == 0;
        Assert.True(success, "Hard link creation failed: " + Marshal.GetLastPInvokeError());
    }
    [DllImport("kernel32.dll", EntryPoint = "CreateHardLinkW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLink(string link, string target, IntPtr security);
    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int Link([MarshalAs(UnmanagedType.LPUTF8Str)] string target, [MarshalAs(UnmanagedType.LPUTF8Str)] string link);

    private static void DirectoryLink(string link, string target)
    {
        if (!OperatingSystem.IsWindows()) { Directory.CreateSymbolicLink(link, target); return; }
        // Junctions exercise linked parents on Windows without requiring symlink privileges.
        var start = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.Arguments = $"/c mklink /J \"{link}\" \"{target}\"";
        using var process = Process.Start(start)!; process.WaitForExit();
        Assert.True(process.ExitCode == 0, process.StandardError.ReadToEnd());
    }
}
