using Mdpkg.Reader;

namespace Mdpkg.Core;

/// <summary>Service limits apply to every entry point. These are not whole-process memory/disk quotas.</summary>
public sealed record ResourceOptions
{
    public ReadLimits ReadLimits { get; init; } = new();
    public long MaxSourceBytes { get; init; } = 128L * 1024 * 1024;
    public long MaxSpoolBytes { get; init; } = 128L * 1024 * 1024;
    /// <summary>Historical producer limits, explicitly selected by the CLI.</summary>
    public static ResourceOptions ProducerCompatibility { get; } = new()
    {
        ReadLimits = new() { MaxInputBytes = uint.MaxValue - 1L, MaxDirectoryBytes = uint.MaxValue - 1L,
            MaxEntries = ushort.MaxValue - 1, MaxManifestBytes = int.MaxValue, MaxDocumentBytes = int.MaxValue,
            MaxDecodedBytes = long.MaxValue, MaxJsonDepth = 64 },
        MaxSourceBytes = long.MaxValue, MaxSpoolBytes = uint.MaxValue - 1L
    };
    internal void Validate()
    {
        ArgumentNullException.ThrowIfNull(ReadLimits); ReadLimits.Validate();
        if (MaxSourceBytes < 1 || MaxSpoolBytes < 1) throw new ArgumentOutOfRangeException(nameof(ResourceOptions));
    }
    internal long MemberLimit(string name) => name.StartsWith(".git/", StringComparison.Ordinal)
        ? Math.Min(int.MaxValue, ReadLimits.MaxDecodedBytes)
        : name.StartsWith(".mdpkg/", StringComparison.Ordinal) ? ReadLimits.MaxManifestBytes : ReadLimits.MaxDocumentBytes;
    internal static async Task CopyAsync(Stream input, Stream output, long limit, CancellationToken ct)
    {
        var buffer = new byte[65536]; long total = 0;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var read = await input.ReadAsync(buffer, ct);
            if (read == 0) break;
            if (read > limit - total) throw new ResourceLimitException("Copy exceeds its byte limit.");
            await output.WriteAsync(buffer.AsMemory(0, read), ct); total += read;
        }
        ct.ThrowIfCancellationRequested();
    }
}
