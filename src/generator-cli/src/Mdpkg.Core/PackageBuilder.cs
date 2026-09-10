using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.IO;

namespace Mdpkg.Core;

/// <summary>Creates and deep-self-validates packages using isolated native Git.</summary>
public sealed class PackageBuilder
{
    private readonly Internal.EngineSettings settings;
    public PackageBuilder(EngineSettings? settings = null) => this.settings = ApiSupport.Settings(settings);

    /// <summary>Publishes through a flushed sibling staging file. Failure before replacement preserves the destination.</summary>
    public async Task<CreateResult> CreateFromDirectoryAsync(DirectoryPackageRequest request, string destinationPath,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request); ArgumentException.ThrowIfNullOrWhiteSpace(request.SourceDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationPath); ApiSupport.Creation(request.Options, request.Metadata);
        if (!Enum.IsDefined(request.Mode) || request.Depth is < 1) throw new ArgumentException("Invalid mode or depth.", nameof(request));
        return new(await new Internal.PackageBuilder(settings).PackAsync(ToInternal(request, destinationPath), cancellationToken));
    }

    /// <summary>Stages privately and validates before copying. Leaves output open; a failed/interrupted copy may leave a prefix.</summary>
    public async Task<CreateResult> CreateAsync(SnapshotPackageRequest request, Stream destination,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request); ArgumentNullException.ThrowIfNull(destination);
        ApiSupport.Creation(request.Options, request.Metadata);
        if (!destination.CanWrite || (destination.CanSeek && (destination.Length != 0 || destination.Position != 0)))
            throw new ArgumentException("Output must be writable and initially empty at position zero.", nameof(destination));
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            using var temp = new TemporaryDirectory(settings.TemporaryDirectory);
            var path = Path.Combine(temp.Path, "snapshot.mdpkg");
            var directoryRequest = new DirectoryPackageRequest(Path.Combine(temp.Path, "input"), request.Namespace)
            { Metadata = request.Metadata, Options = request.Options, Correspondence = request.Correspondence };
            var result = await new Internal.PackageBuilder(settings).PackAsync(ToInternal(directoryRequest, path) with { InputEntries = request.Entries }, cancellationToken);
            if (result.Outcome != Outcome.Success) return new(result);
            await using var input = File.OpenRead(path);
            await ResourceOptions.CopyAsync(input, destination, request.Options.Resources.MaxSpoolBytes, cancellationToken);
            await destination.FlushAsync(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            return new(result with { Package = result.Package! with { Path = null } });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new(ApiSupport.Failure(ex)); }
    }
    private static PackRequest ToInternal(DirectoryPackageRequest r, string destination) => new(
        r.SourceDirectory, destination, r.Namespace.ToString("D"), r.Mode == CreationMode.GitImport, r.Scope, r.Depth,
        r.Metadata.Message, RequireComplete: r.Options.RequireComplete, FailOnWarning: r.Options.Warnings == WarningPolicy.Fail,
        CompressionLevel: r.Options.CompressionLevel, DataDescriptors: r.Options.DataDescriptors, ReverseIndex: r.Options.ReverseIndex,
        ObjectFormat: r.Options.ObjectFormat, Anchor: r.Options.Anchor, Digest: r.Options.Digest,
        CorrespondenceBytes: r.Correspondence is null ? null : CorrespondenceCodec.Encode(r.Correspondence),
        Metadata: r.Metadata, Resources: r.Options.Resources);
}
