using System.Text.Json;

namespace Mdpkg.Cli.Tests;

/// <summary>Until a verb is implemented it must parse, honour the output contract, and exit <see cref="ExitCode.NotImplemented"/>.</summary>
public class StubTests
{
    public static TheoryData<string, string[]> WellFormedInvocations => new()
    {
        { "pack", ["pack", "./docs", "--out", "x.mdpkg", "--namespace", CliRunner.Namespace] },
        { "update", ["update", "in.mdpkg", "--out", "out.mdpkg", "--tree", "./docs", "--message", "m"] },
        { "update", ["update", "in.mdpkg", "--out", "out.mdpkg", "--squash", "a..b", "--no-summary"] },
        { "address move", ["address", "in.mdpkg", "--out", "o.mdpkg", "move", "--root", CliRunner.Root, "--to", "section:guide.md:# Guide/0"] },
        { "address retire", ["address", "in.mdpkg", "--out", "o.mdpkg", "retire", "--root", CliRunner.Root, "--reason", "split", "--next", "a", "--next", "b"] },
        { "address unknown", ["address", "in.mdpkg", "--out", "o.mdpkg", "unknown", "--root", CliRunner.Root, "--reason", "why"] },
        { "address mint", ["address", "in.mdpkg", "--out", "o.mdpkg", "mint", "--locator", "section:x.md:# X/0"] },
        { "address list", ["address", "in.mdpkg", "list"] },
        { "validate", ["validate", "in.mdpkg", "--deep"] },
    };

    [Theory]
    [MemberData(nameof(WellFormedInvocations))]
    public void WellFormedInvocationExitsNotImplementedWithADiagnosticOnStderr(string verb, string[] args)
    {
        var result = CliRunner.Run(args);

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
        Assert.Equal($"mdpkg {verb}: not implemented. This build is the scaffold; see src/generator-cli/README.md.", result.Stderr.Trim());
        Assert.Equal(string.Empty, result.Stdout);
    }

    [Theory]
    [MemberData(nameof(WellFormedInvocations))]
    public void JsonFormatPrintsOneResultObjectOnStdout(string verb, string[] args)
    {
        var result = CliRunner.Run([.. args, "--format", "json"]);

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
        var line = Assert.Single(result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries));
        using var json = JsonDocument.Parse(line);
        var root = json.RootElement;
        Assert.Equal(verb, root.GetProperty("verb").GetString());
        Assert.Equal((int)ExitCode.NotImplemented, root.GetProperty("exitCode").GetInt32());
        Assert.Equal(
            ["verb", "exitCode", "package", "manifest", "current", "addressing", "history", "checks", "diagnostics"],
            root.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(JsonValueKind.Array, root.GetProperty("checks").ValueKind);
        Assert.Equal(JsonValueKind.Array, root.GetProperty("diagnostics").ValueKind);
    }

    [Fact]
    public void QuietStillEmitsTheDiagnostic()
    {
        var result = CliRunner.Run("validate", "in.mdpkg", "--quiet");

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
        Assert.Contains("not implemented", result.Stderr, StringComparison.Ordinal);
    }

    [Fact]
    public void GlobalOptionsAreAcceptedBeforeTheVerb()
    {
        var result = CliRunner.Run("--namespace", CliRunner.Namespace, "--format", "json", "pack", "./docs", "--out", "x.mdpkg");

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
        Assert.StartsWith("{\"verb\":\"pack\"", result.Stdout, StringComparison.Ordinal);
    }

    [Fact]
    public void ReportIsWrittenEvenOnANonZeroExit()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mdpkg-{Guid.NewGuid():N}.json");
        try
        {
            var result = CliRunner.Run("validate", "in.mdpkg", "--report", path);

            Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
            Assert.Equal(string.Empty, result.Stdout);
            using var json = JsonDocument.Parse(File.ReadAllText(path));
            Assert.Equal("validate", json.RootElement.GetProperty("verb").GetString());
            Assert.Equal((int)ExitCode.NotImplemented, json.RootElement.GetProperty("exitCode").GetInt32());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void UnwritableReportIsAnEnvironmentError()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mdpkg-missing-{Guid.NewGuid():N}", "report.json");

        var result = CliRunner.Run("validate", "in.mdpkg", "--report", path);

        Assert.Equal((int)ExitCode.Environment, result.Exit);
        Assert.Contains("cannot write --report", result.Stderr, StringComparison.Ordinal);
        Assert.False(File.Exists(path));
    }
}
