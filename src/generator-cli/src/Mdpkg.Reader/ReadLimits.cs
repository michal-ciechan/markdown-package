namespace Mdpkg.Reader;

/// <summary>Service limits, not format maxima. Rejection never truncates a result.</summary>
public sealed record ReadLimits
{
    public long MaxInputBytes { get; init; } = 128L * 1024 * 1024;
    public long MaxDirectoryBytes { get; init; } = 16L * 1024 * 1024;
    public int MaxEntries { get; init; } = 10_000;
    public int MaxManifestBytes { get; init; } = 1024 * 1024;
    public int MaxDocumentBytes { get; init; } = 16 * 1024 * 1024;
    public long MaxDecodedBytes { get; init; } = 128L * 1024 * 1024;
    public int MaxJsonDepth { get; init; } = 32;
    public string? TemporaryDirectory { get; init; }
    internal static ReadLimits Producer => new() { MaxInputBytes = uint.MaxValue - 1L, MaxDirectoryBytes = uint.MaxValue - 1L, MaxEntries = ushort.MaxValue - 1 };
    internal void Validate()
    {
        if (MaxInputBytes < 1 || MaxDirectoryBytes < 1 || MaxEntries < 1 || MaxManifestBytes < 1 ||
            MaxDocumentBytes < 1 || MaxDecodedBytes < 1 || MaxJsonDepth < 1 || MaxJsonDepth > 256)
            throw new ArgumentOutOfRangeException(nameof(ReadLimits), "Limits must be positive; JSON depth must be at most 256.");
    }
}

public sealed class ResourceLimitException(string message) : IOException(message);
public sealed class PackageFormatException(string code, string message, string? entry = null) : IOException(message)
{
    public string Code { get; } = code;
    public string? Entry { get; } = entry;
}

public enum ContainerStatus { NotChecked, Conforming, Recoverable, Malformed }
public sealed record PackageDiagnostic(string Code, string Message, string? Entry = null);
public sealed record PackageIdentity(string Namespace, string Current);
public sealed record PackageEntry(string Name, long CompressedBytes, long DecodedBytes);
public sealed record AddressingProfile(string Anchor, string Digest, string Coverage, string? Overrides);
public static class PackageProfiles
{
    public const string Anchor = "cm0312-trail-source-v1";
    public const string Digest = "cm0312-source-lf-v1";
    public const string Selector = "cm0312-quote-context-v1";
    public const string OffsetUnits = "utf16-code-units";
}
