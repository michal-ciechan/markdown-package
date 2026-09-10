using System.Text.Json.Nodes;
using Mdpkg.Tests;

namespace Mdpkg.Cli.Tests;

public class MalformedHistoryTests
{
    public static IEnumerable<object[]> Cases => MalformedHistoryFixture.Cases;

    [Theory]
    [MemberData(nameof(Cases))]
    public void NullHistoryRecordsKeepExitThreeAndDiagnosticReport(string field, string position, bool deep)
    {
        using var fixture = new EngineFixture();
        MalformedHistoryFixture.Write(fixture.Output, field, position);
        var bytes = File.ReadAllBytes(fixture.Output);
        var report = Path.Combine(fixture.Root, "report.json"); File.WriteAllText(report, "prior report");
        var result = CliRunner.Run(["validate", fixture.Output, "--format", "json", "--report", report, .. deep ? new[] { "--deep" } : []]);
        Assert.Equal(3, result.Exit);
        Assert.Equal(File.ReadAllText(report), result.Stdout.TrimEnd('\r', '\n'));
        Assert.Equal(bytes, File.ReadAllBytes(fixture.Output));
        var json = JsonNode.Parse(result.Stdout)!.AsObject();
        Assert.Equal(["verb", "exitCode", "package", "manifest", "current", "addressing", "history", "checks", "diagnostics"], json.Select(p => p.Key));
        Assert.Equal("validate", json["verb"]!.GetValue<string>()); Assert.Equal(3, json["exitCode"]!.GetValue<int>());
        Assert.Null(json["package"]); Assert.NotNull(json["manifest"]);
        Assert.Equal(json["manifest"]!["current"]!.GetValue<string>(), json["current"]!.GetValue<string>());
        Assert.Empty(json["addressing"]!["uncoveredRanges"]!.AsArray());
        var history = json["history"]!;
        Assert.Equal("complete", history["coverage"]!.GetValue<string>()); Assert.Empty(history["transform"]!.AsArray());
        Assert.Equal(1, history["retainedCommits"]!.GetValue<int>());
        var declared = position == "only" ? 1 : 2;
        Assert.Equal(field is "ranges" or "all" ? declared : 0, history["ranges"]!.GetValue<int>());
        Assert.Equal(field is "patches" or "all" ? declared : 0, history["patches"]!.GetValue<int>());
        var expected = MalformedHistoryFixture.Diagnostic(field);
        var diagnostic = Assert.Single(json["diagnostics"]!.AsArray())!;
        Assert.Equal(expected.Code, diagnostic["code"]!.GetValue<string>());
        Assert.Equal("error", diagnostic["sev"]!.GetValue<string>()); Assert.Null(diagnostic["entry"]);
        Assert.Equal(expected.Message, diagnostic["message"]!.GetValue<string>()); Assert.Equal(expected.Spec, diagnostic["spec"]!.GetValue<string>());
        Assert.Equal($"{expected.Code} error: {expected.Message}{Environment.NewLine}", result.Stderr);
        var checks = json["checks"]!.AsArray(); Assert.Equal(23, checks.Count);
        Assert.Contains(checks, c => c!["code"]!.GetValue<string>() == expected.Code && c["status"]!.GetValue<string>() == "fail");
        Assert.Equal("skipped", checks[16]!["status"]!.GetValue<string>()); Assert.Equal("skipped", checks[17]!["status"]!.GetValue<string>());
    }
}
