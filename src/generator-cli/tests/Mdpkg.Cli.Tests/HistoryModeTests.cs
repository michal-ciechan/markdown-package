using System.Text.Json.Nodes;

namespace Mdpkg.Cli.Tests;

public class HistoryModeTests
{
    [Theory]
    [InlineData("--scope", "*.md")][InlineData("--depth", "1")][InlineData("--from-git")]
    [InlineData("--reverse-index")][InlineData("--message", "Initial package")][InlineData("--object-format", "sha1")]
    public void ExplicitSnapshotModeRejectsGitOptions(params string[] extra)
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "prior");
        var result = CliRunner.Run(["pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace, "--history", "none", .. extra]);
        Assert.Equal(1, result.Exit); Assert.Equal("prior", File.ReadAllText(f.Output));
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public void DefaultAndExplicitSnapshotResultsReportVerifiedTypedIdentity(bool explicitMode)
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n");
        var result = CliRunner.Run(["pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace, "--format", "json", .. explicitMode ? new[] { "--history", "none" } : []]);
        Assert.True(result.Exit == 0, result.Stderr);
        var json = JsonNode.Parse(result.Stdout)!;
        Assert.Equal("snapshot", json["current"]!["kind"]!.GetValue<string>());
        Assert.Equal("sha256-69b43819687cc0ec576965b514d5d336544966aadddec1310b4b7f242fb3adb4", json["current"]!["id"]!.GetValue<string>());
        Assert.Equal("none", json["mode"]!.GetValue<string>());
        Assert.Equal("snapshot-verified", json["assurance"]!.GetValue<string>());
        Assert.Equal("{\"mode\":\"none\"}", json["history"]!.ToJsonString());
        Assert.False(json["materialized"]!.GetValue<bool>());
        Assert.Contains(json["checks"]!.AsArray(), c => c!["code"]!.GetValue<string>() == "MDPK4002" && c["status"]!.GetValue<string>() == "not-applicable");
        var validated = CliRunner.Run("validate", f.Output, "--deep", "--format", "json");
        Assert.Equal(0, validated.Exit);
        Assert.True(JsonNode.DeepEquals(json["current"], JsonNode.Parse(validated.Stdout)!["current"]));
    }

    [Fact]
    public void ImportDefaultsToGitAndUnknownHistoryModeIsRejected()
    {
        var args = new[] { "pack", "./docs", "--out", "x.mdpkg", "--namespace", CliRunner.Namespace };
        Assert.Empty(MdpkgCli.Build().Parse([.. args, "--from-git"]).Errors);
        Assert.NotEmpty(MdpkgCli.Build().Parse([.. args, "--history", "unknown"]).Errors);
    }
}
