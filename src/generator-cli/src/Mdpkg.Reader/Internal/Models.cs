using System.Text.Json.Nodes;
namespace Mdpkg.Reader.Internal;

internal enum Outcome { Success, InvalidSource, Nonconforming, Incomplete, Environment, Usage }
internal sealed record Finding(string Code, string Severity, string? Entry, string Message, string Spec);
internal sealed record Manifest(string Mdpkg, string Namespace, string Current,
    AddressingDeclaration Addressing, HistoryDeclaration History, JsonObject? Review = null);
internal sealed record AddressingDeclaration(string Anchor, string Digest, string Coverage, string? Overrides);
internal sealed record HistoryDeclaration(string Coverage, string[] Transform, string Detail);
internal sealed record CoverageRange(string From, string To, string Coverage);
internal sealed record Transformation(string Kind, string SourceBase, string SourceTip, string Emitted, string? Summary = null);
internal sealed record PatchBinding(string Entry, string Sha256, string From, string To, string Document, string Profile);
internal sealed record HistoryDetail(string Walk, string Root, string SourceBase, string SourceTip,
    int RetainedCommits, string[] ShallowBoundaries, Transformation[] Transformations, string[] Ranges,
    PatchBinding[] Patches, CoverageRange[] AddressingCoverage,
    string? SourceRepository = null, string? Scope = null, string? Bindings = null);
internal sealed record Ledger(int Version, string Anchor, Dictionary<string, LedgerRecord> Entries);
internal sealed record LedgerRecord(JsonArray? To = null, string? Dead = null, string[]? Next = null, string? Unknown = null);
internal sealed record EntryData(string Name, byte[] Bytes, string Mode = "100644");

internal sealed class EngineException(Outcome outcome, string code, string message, string? entry = null) : Exception(message)
{
    public Outcome Outcome { get; } = outcome;
    public string Code { get; } = code;
    public string? Entry { get; } = entry;
}

internal static class Findings
{
    public static Finding Create(string code, string message, string? entry = null, string? severity = null)
    {
        var row = Diagnostics.DiagnosticCatalog.Codes[code];
        return new(code, severity ?? row.Sev, entry, message, row.Spec);
    }
}
