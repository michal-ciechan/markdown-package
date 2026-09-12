using Mdpkg.Reader;
using Mdpkg.Core.Internal.IO;

namespace Mdpkg.Core;

/// <summary>Explicit native Git verification bound to an immutable, bounded copy of the supplied archive.</summary>
public sealed class GitHistoryBackend(EngineSettings? settings = null, ResourceOptions? resources = null) : IHistoryVerificationBackend
{
    public async Task<VerifiedHistoryContext> VerifyAsync(PackageArchive archive, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(archive);
        var policy = resources ?? new(); policy.Validate();
        using var temp = new TemporaryDirectory(settings?.TemporaryDirectory ?? policy.ReadLimits.TemporaryDirectory);
        var path = Path.Combine(temp.Path, "verified-input.mdpkg");
        if (archive.PackageBytes > Math.Min(policy.MaxSpoolBytes, policy.ReadLimits.MaxInputBytes)) throw new ResourceLimitException("History input exceeds its spool limit.");
        await using (var output = File.Create(path)) await archive.CopyToAsync(output, cancellationToken, Math.Min(policy.MaxSpoolBytes, policy.ReadLimits.MaxInputBytes));
        var result = await new PackageValidator(settings).ValidateFileAsync(path, new() { Deep = true, Resources = policy }, cancellationToken);
        if (result.Status == OperationStatus.ResourceLimitExceeded) throw new ResourceLimitException(result.Diagnostics.FirstOrDefault()?.Message ?? "History resource limit.");
        if (!result.IsConforming || result.HistoryContext is null)
            throw new PackageFormatException(result.Diagnostics.FirstOrDefault()?.Code ?? "HistoryUnavailable", string.Join("; ", result.Diagnostics.Select(d => d.Message)));
        return result.HistoryContext;
    }
}
