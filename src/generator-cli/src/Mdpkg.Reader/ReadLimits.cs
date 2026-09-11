namespace Mdpkg.Reader;

/// <summary>Service limits, not format maxima. Rejection never truncates a result.</summary>
public sealed record ReadLimits
{
    /// <summary>Maximum package input or non-seekable spool size in bytes; defaults to 128 MiB.</summary>
    public long MaxInputBytes { get; init; } = 128L * 1024 * 1024;
    /// <summary>Maximum ZIP central directory size in bytes; defaults to 16 MiB.</summary>
    public long MaxDirectoryBytes { get; init; } = 16L * 1024 * 1024;
    /// <summary>Maximum ZIP entry count; defaults to 10,000.</summary>
    public int MaxEntries { get; init; } = 10_000;
    /// <summary>Maximum decoded manifest, history or ledger size in bytes per read; defaults to 1 MiB.</summary>
    public int MaxManifestBytes { get; init; } = 1024 * 1024;
    /// <summary>Default maximum decoded entry or Markdown document size in bytes; defaults to 16 MiB.</summary>
    public int MaxDocumentBytes { get; init; } = 16 * 1024 * 1024;
    /// <summary>Aggregate decoded entry-read budget in bytes, including repeated reads; defaults to 128 MiB.</summary>
    public long MaxDecodedBytes { get; init; } = 128L * 1024 * 1024;
    /// <summary>Maximum JSON nesting depth, from 1 through 256; defaults to 32.</summary>
    public int MaxJsonDepth { get; init; } = 32;
    /// <summary>Directory for private delete-on-close spools; null uses the system temporary directory.</summary>
    public string? TemporaryDirectory { get; init; }
    internal static ReadLimits Producer => new() { MaxInputBytes = uint.MaxValue - 1L, MaxDirectoryBytes = uint.MaxValue - 1L, MaxEntries = ushort.MaxValue - 1 };
    internal void Validate()
    {
        if (MaxInputBytes < 1 || MaxDirectoryBytes < 1 || MaxEntries < 1 || MaxManifestBytes < 1 ||
            MaxDocumentBytes < 1 || MaxDecodedBytes < 1 || MaxJsonDepth < 1 || MaxJsonDepth > 256)
            throw new ArgumentOutOfRangeException(nameof(ReadLimits), "Limits must be positive; JSON depth must be at most 256.");
    }
}

/// <summary>A configured resource budget was exceeded; results are not truncated.</summary>
/// <param name="message">Description of the exceeded limit.</param>
public sealed class ResourceLimitException(string message) : IOException(message);
/// <summary>A package violates the supported format or profile.</summary>
/// <param name="code">Machine-readable diagnostic code.</param>
/// <param name="message">Description of the violation.</param>
/// <param name="entry">Affected archive entry, if known.</param>
public sealed class PackageFormatException(string code, string message, string? entry = null) : IOException(message)
{
    /// <summary>Machine-readable format diagnostic code.</summary>
    public string Code { get; } = code;
    /// <summary>Affected archive entry, or null when the failure is not entry-specific.</summary>
    public string? Entry { get; } = entry;
}

/// <summary>ZIP container assessment; does not certify unread payloads or Git integrity.</summary>
public enum ContainerStatus
{
    /// <summary>Container checks have not run.</summary>
    NotChecked,
    /// <summary>Container metadata conforms to the supported ZIP profile.</summary>
    Conforming,
    /// <summary>Container typing is recoverable and requires explicit acceptance.</summary>
    Recoverable,
    /// <summary>Container checks rejected malformed data.</summary>
    Malformed,
}
/// <summary>A package finding with an optional affected entry.</summary>
/// <param name="Code">Stable diagnostic code.</param>
/// <param name="Message">Human-readable diagnostic detail.</param>
/// <param name="Entry">Affected archive entry, or null when not entry-specific.</param>
public sealed record PackageDiagnostic(string Code, string Message, string? Entry = null);
/// <summary>Package lineage and current commit identity.</summary>
/// <param name="Namespace">Lowercase UUID identifying the package namespace.</param>
/// <param name="Current">Current commit object ID including its object-format prefix.</param>
public sealed record PackageIdentity(string Namespace, string Current);
/// <summary>ZIP directory metadata; payload integrity is checked when the entry is read.</summary>
/// <param name="Name">Case-sensitive archive entry name.</param>
/// <param name="CompressedBytes">Compressed payload size in bytes.</param>
/// <param name="DecodedBytes">Declared uncompressed payload size in bytes.</param>
public sealed record PackageEntry(string Name, long CompressedBytes, long DecodedBytes);
/// <summary>Addressing algorithms and correspondence coverage declared by the manifest.</summary>
/// <param name="Anchor">Anchor profile identifier.</param>
/// <param name="Digest">Source digest profile identifier.</param>
/// <param name="Coverage">Declared complete or partial correspondence coverage.</param>
/// <param name="Overrides">Ledger entry path, or null when overrides are absent.</param>
public sealed record AddressingProfile(string Anchor, string Digest, string Coverage, string? Overrides);
/// <summary>Identifiers for the supported addressing and selector profiles.</summary>
public static class PackageProfiles
{
    /// <summary>Supported CommonMark heading-trail anchor profile.</summary>
    public const string Anchor = "cm0312-trail-source-v1";
    /// <summary>Supported canonical LF source digest profile.</summary>
    public const string Digest = "cm0312-source-lf-v1";
    /// <summary>Supported quote and context selector profile.</summary>
    public const string Selector = "cm0312-quote-context-v1";
    /// <summary>UTF-16 code units used for selector and source offsets.</summary>
    public const string OffsetUnits = "utf16-code-units";
}
