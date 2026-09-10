using System.CommandLine;
using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.Cli.Reporting;

namespace Mdpkg.Cli.Commands;

internal static class EngineAction
{
    public static async Task<int> RunAsync(ParseResult parse, GlobalOptions globals, string verb,
        Func<Task<Core.PackageResult>> action, string?[] protectedFiles, string? source = null)
    {
        ResultObject result;
        try { result = Map(verb, await action()); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            var code = ex is PackageFormatException format ? format.Code : ex is ArgumentException ? "MDPK2007" : "MDPK5001";
            var exit = ex is PackageFormatException ? ExitCode.SourceRejected : ex is ArgumentException ? ExitCode.Usage : ExitCode.Environment;
            result = ResultObject.Empty(verb, exit) with { Diagnostics = [new(code, "error", null, ex.Message,
                code == "MDPK3003" ? "§6.3" : code == "MDPK2007" ? "§4, §5.3" : "CLI §3, exit 5")] };
        }
        return Report(parse, globals, result, protectedFiles, source);
    }
    internal static ResultObject Map(string verb, Core.PackageResult engine)
    {
        var exit = engine.Status switch
        {
            OperationStatus.Success => ExitCode.Success, OperationStatus.SourceRejected => ExitCode.SourceRejected,
            OperationStatus.Nonconforming => ExitCode.Nonconforming, OperationStatus.ObligationUnmet => ExitCode.ObligationUnmet,
            _ => ExitCode.Environment
        };
        var p = engine.Package; var m = engine.Manifest; var h = engine.History;
        return new(verb, exit, p is null ? null : new(p.Path!, p.Bytes, p.Sha256, p.Entries, p.Tier == ContainerStatus.Conforming ? "conforming" : "recoverable"),
            m is null ? null : Manifest(m), m?.Current,
            m is null ? null : new(m.Addressing.Coverage, engine.OverrideCount, engine.MintedRoots,
                h?.AddressingCoverage.Where(r => r.Coverage == "partial").Select(r => r.From + ".." + r.To).ToArray() ?? []),
            h is null || m is null ? null : new(m.History.Coverage, m.History.Transform, h.RetainedCommits, h.Ranges.Count, h.Patches.Count),
            engine.Checks.Select(c => new CheckResult(c.Code, c.Status switch { CheckStatus.Passed => "pass", CheckStatus.Failed => "fail", _ => "skipped" })).ToArray(),
            engine.Diagnostics.Select(d => new Reporting.Diagnostic(d.Code, d.Severity switch
            { DiagnosticSeverity.Warning => "warn", DiagnosticSeverity.Error => "error", _ => "info" }, d.Entry, d.Message, d.Spec)).ToArray());
    }
    private static JsonObject Manifest(ManifestMetadata m)
    {
        // Preserve canonical property order and omission rules without Reader internals.
        var addressing = new JsonObject { ["anchor"] = m.Addressing.Anchor, ["coverage"] = m.Addressing.Coverage, ["digest"] = m.Addressing.Digest };
        addressing["overrides"] = m.Addressing.Overrides;
        var result = new JsonObject { ["mdpkg"] = m.Mdpkg, ["addressing"] = addressing, ["current"] = m.Current,
            ["history"] = new JsonObject { ["coverage"] = m.History.Coverage, ["detail"] = m.History.Detail,
                ["transform"] = new JsonArray(m.History.Transform.Select(t => (JsonNode)JsonValue.Create(t)!).ToArray()) }, ["namespace"] = m.Namespace };
        if (m.Review is { } review) result["review"] = JsonNode.Parse(review.GetRawText());
        return result;
    }
    private static int Report(ParseResult parse, GlobalOptions globals, ResultObject result, string?[] protectedFiles, string? source)
    {
        var verb = result.Verb; var stderr = parse.InvocationConfiguration.Error;
        foreach (var d in result.Diagnostics) stderr.WriteLine($"{d.Code} {d.Sev}: {d.Message}" + (d.Entry is null ? "" : $" [{d.Entry}]"));
        if (parse.GetValue(globals.Report) is { } report)
        {
            try
            {
                if (ReportDestination.Error(report.FullName, protectedFiles, source) is { } error) throw new IOException(error);
                ReportDestination.Write(report.FullName, ResultWriter.ToJson(result));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { stderr.WriteLine($"mdpkg {verb}: cannot write --report {report}: {ex.Message}"); result = result with { ExitCode = ExitCode.Environment }; }
        }
        if (parse.GetValue(globals.Format) == GlobalOptions.JsonFormat) parse.InvocationConfiguration.Output.WriteLine(ResultWriter.ToJson(result));
        else if (!parse.GetValue(globals.Quiet) && result.ExitCode == ExitCode.Success) stderr.WriteLine($"mdpkg {verb}: {result.Package?.Entries} entries; {result.Current}; validated.");
        return (int)result.ExitCode;
    }
}
