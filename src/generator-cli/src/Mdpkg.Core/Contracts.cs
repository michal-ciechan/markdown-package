using System.Text.Json;
using Mdpkg.Reader;

namespace Mdpkg.Core;

public enum OperationStatus { Success, SourceRejected, Nonconforming, ObligationUnmet, EnvironmentFailure, ResourceLimitExceeded }
public enum DiagnosticSeverity { Info, Warning, Error }
public enum CheckStatus { Passed, Failed, Skipped, NotApplicable }
public enum ValidationLevel { Full, Deep }
public enum WarningPolicy { Report, Fail }
public enum CreationMode { Snapshot, GitImport }
public enum HistoryMode { None, Git }
public sealed record Diagnostic(string Code, DiagnosticSeverity Severity, string? Entry, string Message, string Spec);
public sealed record ValidationCheck(string Code, CheckStatus Status);
public sealed record PackageMetadata(string? Path, long Bytes, string Sha256, int Entries, ContainerStatus Tier);
public sealed record ManifestMetadata(string Mdpkg, string Namespace, CurrentState Current, AddressingProfile Addressing,
    PackageHistory History, JsonElement? Review);
public sealed record CoverageRangeMetadata(string From, string To, string Coverage);
public sealed record TransformationMetadata(string Kind, string SourceBase, string SourceTip, string Emitted, string? Summary);
public sealed record PatchBindingMetadata(string Entry, string Sha256, string From, string To, string Document, string Profile);
public sealed record HistoryMetadata(string Walk, string Root, string SourceBase, string SourceTip, int RetainedCommits,
    IReadOnlyList<string> ShallowBoundaries, IReadOnlyList<TransformationMetadata> Transformations, IReadOnlyList<string> Ranges,
    IReadOnlyList<PatchBindingMetadata> Patches, IReadOnlyList<CoverageRangeMetadata> AddressingCoverage,
    string? SourceRepository, string? Scope, string? Bindings, JsonElement? Origin = null)
{
    /// <summary>Declared count, including null entries omitted from rejected partial metadata.</summary>
    public int DeclaredRangeCount { get; init; } = Ranges.Count;
    /// <summary>Declared count, including null entries omitted from rejected partial metadata.</summary>
    public int DeclaredPatchCount { get; init; } = Patches.Count;
}

/// <summary>Independently owned results; no archive handles or mutable engine models escape.</summary>
public abstract class PackageResult
{
    public OperationStatus Status { get; }
    public PackageMetadata? Package { get; }
    public ManifestMetadata? Manifest { get; }
    public HistoryMetadata? History { get; }
    public PackageIdentity? Identity => Manifest is { } m ? new(m.Namespace, m.Current) : null;
    public IdentityAssurance Assurance { get; }
    public HistoryMode? Mode => Manifest is null ? null : Manifest.History is SnapshotHistory ? HistoryMode.None : HistoryMode.Git;
    public bool Materialized { get; }
    public int OverrideCount { get; }
    public int MintedRoots { get; }
    public IReadOnlyList<ValidationCheck> Checks { get; }
    public IReadOnlyList<Diagnostic> Diagnostics { get; }
    public string? Error { get; }
    internal PackageResult(Internal.EngineResult result)
    {
        Status = result.ResourceExceeded ? OperationStatus.ResourceLimitExceeded : result.Outcome switch
        {
            Outcome.Success => OperationStatus.Success, Outcome.InvalidSource => OperationStatus.SourceRejected,
            Outcome.Nonconforming => OperationStatus.Nonconforming, Outcome.Incomplete => OperationStatus.ObligationUnmet,
            Outcome.Environment => OperationStatus.EnvironmentFailure,
            _ => throw new ArgumentException(result.Diagnostics.FirstOrDefault()?.Message ?? "Invalid creation options.")
        };
        if (result.Package is { } p) Package = new(p.Path, p.Bytes, p.Sha256, p.Entries,
            p.Tier == "conforming" ? ContainerStatus.Conforming : ContainerStatus.Recoverable);
        if (result.Manifest is { } m) Manifest = new(m.Mdpkg, m.Namespace, m.Current,
            new(m.Addressing.Anchor, m.Addressing.Digest, m.Addressing.Coverage, m.Addressing.Overrides),
            m.History is GitHistory git ? new GitHistory(git.Coverage, Freeze(git.Transform), git.Detail) : new SnapshotHistory(),
            m.Review is null ? null : JsonSerializer.SerializeToElement(m.Review, new JsonSerializerOptions { MaxDepth = 256 }));
        // Validation can reject a parsed history containing null collection entries. Preserve
        // its failure and all safely representable metadata without dereferencing rejected records.
        if (result.History is { } h) History = new(h.Walk, h.Root, h.SourceBase, h.SourceTip, h.RetainedCommits,
            Freeze(h.ShallowBoundaries.Where(s => s is not null)),
            Freeze(h.Transformations.Where(t => t is not null).Select(t => new TransformationMetadata(t.Kind, t.SourceBase, t.SourceTip, t.Emitted, t.Summary))),
            Freeze(h.Ranges.Where(r => r is not null)),
            Freeze(h.Patches.Where(p => p is not null).Select(p => new PatchBindingMetadata(p.Entry, p.Sha256, p.From, p.To, p.Document, p.Profile))),
            Freeze(h.AddressingCoverage.Where(r => r is not null).Select(r => new CoverageRangeMetadata(r.From, r.To, r.Coverage))), h.SourceRepository, h.Scope, h.Bindings,
            h.Origin is null ? null : JsonSerializer.SerializeToElement(h.Origin, new JsonSerializerOptions { MaxDepth = 256 }))
        { DeclaredRangeCount = h.Ranges.Length, DeclaredPatchCount = h.Patches.Length };
        Assurance = result.Assurance; Materialized = result.Materialized;
        OverrideCount = result.OverrideCount; MintedRoots = result.MintedRoots; Error = result.Error;
        Checks = Freeze(result.Checks.Select(c => new ValidationCheck(c.Code, c.Status switch
        { "pass" => CheckStatus.Passed, "fail" => CheckStatus.Failed, "not-applicable" => CheckStatus.NotApplicable, _ => CheckStatus.Skipped })));
        Diagnostics = Freeze(result.Diagnostics.Select(d => new Diagnostic(d.Code, d.Severity switch
        { "warn" => DiagnosticSeverity.Warning, "error" => DiagnosticSeverity.Error, _ => DiagnosticSeverity.Info }, d.Entry, d.Message, d.Spec)));
    }
    internal static IReadOnlyList<T> Freeze<T>(IEnumerable<T> items) => Array.AsReadOnly(items.ToArray());
}
public sealed class CreateResult : PackageResult
{
    internal CreateResult(Internal.EngineResult result) : base(result) { }
}
public sealed class ValidationResult : PackageResult
{
    public ValidationLevel RequestedLevel { get; }
    public bool IsConforming => Status == OperationStatus.Success && Package?.Tier == ContainerStatus.Conforming;
    internal ValidationResult(Internal.EngineResult result, ValidationLevel level) : base(result) => RequestedLevel = level;
}

/// <summary>Native Git and private workspace settings; no ambient configuration is changed.</summary>
public sealed record EngineSettings(string GitExecutable = "git", string? TemporaryDirectory = null)
{
    internal bool ManagedSnapshots { get; init; } = Internal.Git.SnapshotBackend.DefaultManaged;
}
public sealed record CommitIdentity(string Name, string Email, DateTimeOffset Time);
public sealed record SnapshotMetadata(CommitIdentity Author, CommitIdentity Committer, string Message)
{
    public static SnapshotMetadata CliDefault { get; } = new(
        new("mdpkg", "mdpkg@example.invalid", DateTimeOffset.FromUnixTimeSeconds(946684800)),
        new("mdpkg", "mdpkg@example.invalid", DateTimeOffset.FromUnixTimeSeconds(946684800)), "Initial package");
}
public sealed record CreationOptions
{
    public int CompressionLevel { get; init; } = 6;
    public bool DataDescriptors { get; init; }
    public bool ReverseIndex { get; init; }
    public bool RequireComplete { get; init; }
    public WarningPolicy Warnings { get; init; }
    public string ObjectFormat { get; init; } = "sha1";
    public string Anchor { get; init; } = PackageProfiles.Anchor;
    public string Digest { get; init; } = PackageProfiles.Digest;
    public ResourceOptions Resources { get; init; } = new();
}
public sealed record DirectoryPackageRequest(string SourceDirectory, Guid Namespace)
{
    public CreationMode Mode { get; init; }
    public HistoryMode History { get; init; } = HistoryMode.None;
    public string? Scope { get; init; }
    public int? Depth { get; init; }
    public SnapshotMetadata? Metadata { get; init; }
    public CreationOptions Options { get; init; } = new();
    public Correspondence? Correspondence { get; init; }
}
public sealed record PackageInputEntry(string Path, ReadOnlyMemory<byte> Content);
/// <summary>Copies the entry collection. Keep content buffers unchanged until creation completes.</summary>
public sealed class SnapshotPackageRequest
{
    public Guid Namespace { get; }
    public SnapshotMetadata? Metadata { get; init; }
    public HistoryMode History { get; init; } = HistoryMode.None;
    public IReadOnlyList<PackageInputEntry> Entries { get; }
    public CreationOptions Options { get; init; } = new();
    public Correspondence? Correspondence { get; init; }
    public SnapshotPackageRequest(Guid @namespace, IEnumerable<PackageInputEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        Namespace = @namespace;
        // Bound enumeration as well as the eventual archive; infinite sequences cannot exhaust memory.
        var copy = new List<PackageInputEntry>();
        foreach (var entry in entries)
        {
            ArgumentNullException.ThrowIfNull(entry);
            ArgumentException.ThrowIfNullOrWhiteSpace(entry.Path);
            if (copy.Count >= ushort.MaxValue - 1) throw new ArgumentException("Too many snapshot entries.", nameof(entries));
            copy.Add(entry);
        }
        Entries = copy.AsReadOnly();
    }
}
public sealed record ValidationOptions
{
    public bool Deep { get; init; }
    public bool AcceptRecoverable { get; init; }
    public Guid? ExpectedNamespace { get; init; }
    public string ObjectFormat { get; init; } = "sha1";
    public ResourceOptions Resources { get; init; } = new();
}
