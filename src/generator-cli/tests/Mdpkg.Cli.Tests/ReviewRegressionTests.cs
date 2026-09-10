using Mdpkg.Core;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Commands;

namespace Mdpkg.Cli.Tests;

public class ReviewRegressionTests
{
    [Fact]
    public async Task ValidateRejectsHardLinkedReportAndPreservesPackageBytes()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().CreateFromDirectoryAsync(f.Request, f.Output, TestContext.Current.CancellationToken));
        var original = File.ReadAllBytes(f.Output);
        var report = Path.Combine(f.Root, "report.json"); HardLink(report, f.Output);
        var result = CliRunner.Run("validate", f.Output, "--deep", "--report", report, "--format", "json");
        Assert.Equal(1, result.Exit); Assert.Contains("--report", result.Stderr, StringComparison.Ordinal);
        Assert.Contains("alias", result.Stderr, StringComparison.Ordinal);
        Assert.Equal(original, File.ReadAllBytes(f.Output)); Assert.Equal(original, File.ReadAllBytes(report));
        EngineFixture.Success(await new PackageValidator().ValidateFileAsync(f.Output, new() { Deep = true }, TestContext.Current.CancellationToken));
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
