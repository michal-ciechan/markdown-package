using System.Text.Json.Nodes;
using Mdpkg.Core;

namespace Mdpkg.Cli.Tests;

public class UpdateTests
{
    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task MaterializeAndAppendHaveRealCliApiParity(bool append)
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n"); var initial = Path.Combine(f.Root, "initial.mdpkg");
        EngineFixture.Success(await new PackageBuilder().CreateFromDirectoryAsync(f.Request, initial, TestContext.Current.CancellationToken));
        f.Write("guide.md", "# Guide\n\nChange\n");
        var updater = new PackageUpdater();
        var api = append ? await updater.UpdateAsync(new(initial, f.Source, SnapshotMetadata.CliDefault with { Message = "change" }), f.Output, TestContext.Current.CancellationToken)
            : await updater.MaterializeAsync(new(initial), f.Output, TestContext.Current.CancellationToken);
        EngineFixture.Success(api); var expected = File.ReadAllBytes(f.Output);
        var cli = CliRunner.Run(["update", initial, "--out", f.Output, "--format", "json", .. append ? new[] { "--tree", f.Source, "--message", "change" } : ["--materialize"]]);
        Assert.True(cli.Exit == 0, cli.Stderr); Assert.Equal(expected, File.ReadAllBytes(f.Output));
        var json = JsonNode.Parse(cli.Stdout)!;
        Assert.True(json["materialized"]!.GetValue<bool>()); Assert.Equal(api.BootstrapCommit, json["bootstrapCommit"]!.GetValue<string>());
        Assert.Equal("git-verified", json["assurance"]!.GetValue<string>());
        Assert.Equal(api.Identity!.Current.Id, json["current"]!["id"]!.GetValue<string>());
    }
    [Theory]
    [InlineData("--tree", "tree")][InlineData("--message", "custom")][InlineData("--squash", "a..b")]
    [InlineData("--truncate", "a")][InlineData("--correspondence", "records.json")]
    public void MaterializeRejectsIncompatibleActions(string option, string value)
    {
        var result = CliRunner.Run("update", "missing.mdpkg", "--materialize", "--out", "out.mdpkg", option, value);
        Assert.Equal(1, result.Exit); Assert.Contains("--materialize cannot", result.Stderr, StringComparison.Ordinal);
    }
    [Fact]
    public void MissingOriginalCannotPublish()
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "prior");
        var result = CliRunner.Run("update", Path.Combine(f.Root, "missing.mdpkg"), "--materialize", "--out", f.Output);
        Assert.Equal(5, result.Exit); Assert.Equal("prior", File.ReadAllText(f.Output));
    }
}
