using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Cli.Commands;
using Mdpkg.Cli.Reporting;

namespace Mdpkg.Cli.Tests;

public class ApiParityTests
{
    [Theory]
    [InlineData(false, false)][InlineData(false, true)][InlineData(true, false)]
    public async Task PublicApiAndCliAgreeOnBytesDiagnosticsAndReport(bool crlf, bool depth)
    {
        using var f = new EngineFixture(); f.Write("x.md", crlf ? "# X\r\n" : "# X\n");
        var request = f.Request with { Depth = depth ? 1 : null, History = depth ? HistoryMode.Git : HistoryMode.None };
        var api = await new PackageBuilder().CreateFromDirectoryAsync(request, f.Output, TestContext.Current.CancellationToken);
        EngineFixture.Success(api); var bytes = File.ReadAllBytes(f.Output);
        var cli = CliRunner.Run(["pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace, "--format", "json", .. depth ? new[] { "--history", "git", "--depth", "1" } : []]);
        Assert.Equal(0, cli.Exit); Assert.Equal(bytes, File.ReadAllBytes(f.Output));
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(ResultWriter.ToJson(EngineAction.Map("pack", api))), JsonNode.Parse(cli.Stdout)));
        var manifest = JsonNode.Parse(cli.Stdout)!["manifest"]!;
        Assert.True(manifest["addressing"]!.AsObject().ContainsKey("overrides")); Assert.Null(manifest["addressing"]!["overrides"]);
        using var stream = new MemoryStream(bytes);
        var validated = await new PackageValidator().ValidateAsync(stream, new() { Deep = true }, TestContext.Current.CancellationToken);
        Assert.Equal(api.Package!.Sha256, validated.Package!.Sha256);
        Assert.Equal(api.Checks, validated.Checks);
    }
    [Fact]
    public void CliUsesProducerLimitsAboveReaderServiceDocumentDefault()
    {
        using var f = new EngineFixture(); f.Write("large.txt", new string('a', 16 * 1024 * 1024 + 1));
        var cli = CliRunner.Run("pack", f.Source, "--out", f.Output, "--namespace", CliRunner.Namespace);
        Assert.True(cli.Exit == 0, cli.Stderr);
    }
}
