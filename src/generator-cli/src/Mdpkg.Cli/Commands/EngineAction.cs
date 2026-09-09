using System.CommandLine;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Reporting;

namespace Mdpkg.Cli.Commands;

internal static class EngineAction
{
    public static int Report(ParseResult parse, GlobalOptions globals, string verb, EngineResult engine, string?[] protectedFiles, string? source = null)
    {
        var exit = engine.Outcome switch
        {
            Outcome.Success => ExitCode.Success, Outcome.InvalidSource => ExitCode.SourceRejected,
            Outcome.Nonconforming => ExitCode.Nonconforming, Outcome.Incomplete => ExitCode.ObligationUnmet,
            Outcome.Environment => ExitCode.Environment, _ => ExitCode.Usage,
        };
        var p = engine.Package; var m = engine.Manifest; var h = engine.History;
        var result = new ResultObject(verb, exit,
            p is null ? null : new(p.Path, p.Bytes, p.Sha256, p.Entries, p.Tier),
            m is null ? null : (JsonObject)CanonicalJson.Parse(CanonicalJson.Bytes(m, true)), m?.Current,
            m is null ? null : new(m.Addressing.Coverage, engine.OverrideCount, engine.MintedRoots,
                h?.AddressingCoverage.Where(r => r.Coverage == "partial").Select(r => r.From + ".." + r.To).ToArray() ?? []),
            h is null || m is null ? null : new(m.History.Coverage, m.History.Transform, h.RetainedCommits, h.Ranges.Length, h.Patches.Length),
            engine.Checks.Select(c => new CheckResult(c.Code, c.Status)).ToArray(),
            engine.Diagnostics.Select(d => new Diagnostic(d.Code, d.Severity, d.Entry, d.Message, d.Spec)).ToArray());
        var stderr = parse.InvocationConfiguration.Error;
        foreach (var d in result.Diagnostics) stderr.WriteLine($"{d.Code} {d.Sev}: {d.Message}" + (d.Entry is null ? "" : $" [{d.Entry}]"));
        if (engine.Error is not null) stderr.WriteLine($"mdpkg {verb}: {engine.Error}");
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
        else if (!parse.GetValue(globals.Quiet) && result.ExitCode == ExitCode.Success) stderr.WriteLine($"mdpkg {verb}: {p?.Entries} entries; {m?.Current}; validated.");
        return (int)result.ExitCode;
    }
}
