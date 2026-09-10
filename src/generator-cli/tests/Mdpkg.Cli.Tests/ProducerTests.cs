using System.Text.Json;
namespace Mdpkg.Cli.Tests;
public class ProducerTests
{
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
    public void CliReturnsOneReportAndImplementsNamespaceAndFormatRejections()
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
