using System.Text.Json.Nodes;

namespace Mdpkg.Cli.Reporting;

/// <summary>
/// The §6 result object, printed on stdout under <c>--format json</c> and written to <c>--report</c>.
/// Property order is the §6 table order; the JSON context keeps it.
/// </summary>
internal sealed record ResultObject(
    string Verb,
    ExitCode ExitCode,
    PackageResult? Package,
    JsonObject? Manifest,
    string? Current,
    AddressingResult? Addressing,
    HistoryResult? History,
    IReadOnlyList<CheckResult> Checks,
    IReadOnlyList<Diagnostic> Diagnostics)
{
    /// <summary>A result with nothing computed: what a stub, or a run that failed before opening anything, reports.</summary>
    public static ResultObject Empty(string verb, ExitCode exitCode) =>
        new(verb, exitCode, Package: null, Manifest: null, Current: null, Addressing: null, History: null, Checks: [], Diagnostics: []);
}

/// <summary>§6 <c>package</c>: <c>tier</c> is <c>conforming</c> or <c>recoverable</c> (§3.7).</summary>
internal sealed record PackageResult(string Path, long Bytes, string Sha256, int Entries, string Tier);

/// <summary>§6 <c>addressing</c> (§4, §6.3).</summary>
internal sealed record AddressingResult(string Coverage, int OverrideCount, int MintedRoots, IReadOnlyList<string> UncoveredRanges);

/// <summary>§6 <c>history</c> (§4, §5.3).</summary>
internal sealed record HistoryResult(string Coverage, IReadOnlyList<string> Transform, int RetainedCommits, int Ranges, int Patches);

/// <summary>§6 <c>checks[]</c>: one per §11 check; <c>status</c> is <c>pass</c>, <c>fail</c> or <c>skipped</c>.</summary>
internal sealed record CheckResult(string Code, string Status);

/// <summary>§6 <c>diagnostics[]</c> (§4): <c>spec</c> is the citing section or decision.</summary>
internal sealed record Diagnostic(string Code, string Sev, string? Entry, string Message, string Spec);
