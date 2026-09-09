namespace Mdpkg.Cli.Reporting;

/// <summary>Default severity of a diagnostic for the writing verbs; <c>validate</c> reports every one as <c>error</c> (§4).</summary>
internal enum Severity
{
    Info,
    Warn,
    Error,
}

/// <summary>One row of the §4 diagnostics table.</summary>
internal sealed record DiagnosticInfo(string Code, Severity DefaultSeverity, string Meaning, string Spec)
{
    /// <summary>The §4 vocabulary: <c>info</c>, <c>warn</c>, <c>error</c>.</summary>
    public string Sev => DefaultSeverity switch
    {
        Severity.Info => "info",
        Severity.Warn => "warn",
        _ => "error",
    };
}

/// <summary>
/// The stable diagnostic codes of docs/spec/generator-cli.md §4. The test suite checks this table against the
/// spec's table, so a code added or re-classified there must be mirrored here.
/// </summary>
internal static class DiagnosticCatalog
{
    private static readonly DiagnosticInfo[] Rows =
    [
        new("MDPK1001", Severity.Error, "Two entry names collide under NFC plus simple case folding", "§3.6, D-16"),
        new("MDPK1002", Severity.Error, "Tracked path under .mdpkg/ or .git/ after NFC and case folding, outside .mdpkg/address/", "§3.6, D-11"),
        new("MDPK1003", Severity.Error, "Leading slash, . or .. component, backslash or drive letter in an entry name", "§3.6"),
        new("MDPK1004", Severity.Warn, "CRLF or lone CR in an entry outside .git/; pack and update normalize and report, validate rejects", "§3.6, D-17"),
        new("MDPK1005", Severity.Error, "Central-directory internal file attributes not 0 on some entry", "§3.5, D-19"),
        new("MDPK1006", Severity.Error, ".mdpkg/manifest.json absent from offset 0, or not stored, or bit 3 set, or a non-empty extra field", "§3.1, §3.2 rule 1, §3.4"),
        new("MDPK1007", Severity.Error, "The pack is not the last entry, or an entry a current resolution needs follows it", "§3.2 rules 2–3"),
        new("MDPK1008", Severity.Error, "A central-directory method other than 0 or 8", "§3.3"),
        new("MDPK1009", Severity.Warn, "EOCD comment present; a version token disagreeing with the manifest escalates to error", "§3.5, C1"),
        new("MDPK1010", Severity.Error, "ZIP64 sentinels present or required (G-2)", "§11.1 item 1"),
        new("MDPK2001", Severity.Error, "current differs from the target of refs/heads/main", "§4, §5.2, D-7"),
        new("MDPK2002", Severity.Error, "addressing.overrides names an absent entry, or is null while the tree carries a ledger, or names a ledger with zero entries", "§4, §6.3, D-12"),
        new("MDPK2003", Severity.Error, "history.transform inconsistent with history.json's transformations", "§4, §5.3, D-3"),
        new("MDPK2004", Severity.Error, "shallowBoundaries differs from .git/shallow, or is non-empty while that file is absent", "§5.3"),
        new("MDPK2005", Severity.Error, "A transformation carries a summary but bindings.json is absent or lacks its emitted commit", "§5.4"),
        new("MDPK2006", Severity.Error, "An archived patch's bytes do not hash to the sha256 that history.json binds", "§5.5"),
        new("MDPK3001", Severity.Warn, "Correspondence over some range was not confirmed; addressing.coverage is written partial", "§4, §6.3"),
        new("MDPK3002", Severity.Info, "A new entity was born into a default root still held by a retired or moved entity; a fresh random root was minted", "§6.3"),
        new("MDPK3003", Severity.Error, "A rename candidate was supplied unconfirmed; heuristic guesses never become to entries", "§6.3"),
        new("MDPK4001", Severity.Error, "SHA-256 object format requested", "D-14"),
        new("MDPK4002", Severity.Error, "The curated repository holds an entry §5.1 does not list", "§5.1"),
        new("MDPK4003", Severity.Error, "A tracked entry is not decodable as UTF-8", "D-17"),
    ];

    public static IReadOnlyDictionary<string, DiagnosticInfo> Codes { get; } =
        Rows.ToDictionary(row => row.Code, StringComparer.Ordinal);
}
