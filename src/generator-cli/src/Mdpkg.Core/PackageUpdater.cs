namespace Mdpkg.Core;

public sealed record MaterializePackageRequest(string InputPackage)
{
    public Guid? ExpectedNamespace { get; init; }
    public CreationOptions Options { get; init; } = new();
}
public sealed record UpdatePackageRequest(string InputPackage, string SourceDirectory, SnapshotMetadata Metadata)
{
    public Guid? ExpectedNamespace { get; init; }
    public Correspondence? Correspondence { get; init; }
    public CreationOptions Options { get; init; } = new();
}
public sealed class UpdateResult : PackageResult
{
    internal Internal.EngineResult Engine { get; }
    internal UpdateResult(Internal.EngineResult result) : base(result) => Engine = result;
}

/// <summary>Materializes an exact initial state or appends one confirmed successor, with atomic file publication.</summary>
public sealed class PackageUpdater
{
    private readonly Internal.EngineSettings settings;
    public PackageUpdater(EngineSettings? settings = null) => this.settings = ApiSupport.Settings(settings);
    /// <summary>Stages and verifies privately before copying; a failed final copy may leave a prefix in the caller-owned output.</summary>
    public Task<UpdateResult> MaterializeAsync(Stream input, Stream destination, CreationOptions? options = null, CancellationToken cancellationToken = default)
    {
        options ??= new();
        return StreamAsync(input, destination, options, (source, target) => MaterializeAsync(new(source) { Options = options }, target, cancellationToken), cancellationToken);
    }
    /// <summary>Appends a directory state using private input/output spools. Caller streams remain open.</summary>
    public Task<UpdateResult> UpdateAsync(Stream input, Stream destination, string sourceDirectory, SnapshotMetadata metadata,
        Correspondence? correspondence = null, CreationOptions? options = null, CancellationToken cancellationToken = default)
    {
        options ??= new();
        return StreamAsync(input, destination, options, (source, target) => UpdateAsync(new(source, sourceDirectory, metadata)
            { Options = options, Correspondence = correspondence }, target, cancellationToken), cancellationToken);
    }
    private async Task<UpdateResult> StreamAsync(Stream input, Stream destination, CreationOptions options,
        Func<string, string, Task<UpdateResult>> operation, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(input); ArgumentNullException.ThrowIfNull(destination);
        ApiSupport.Creation(options, null, HistoryMode.Git);
        if (!input.CanRead || !destination.CanWrite || (destination.CanSeek && (destination.Length != 0 || destination.Position != 0)))
            throw new ArgumentException("Input must be readable and output writable and initially empty.");
        ct.ThrowIfCancellationRequested();
        try
        {
            using var temp = new Internal.IO.TemporaryDirectory(settings.TemporaryDirectory ?? options.Resources.ReadLimits.TemporaryDirectory);
            var source = Path.Combine(temp.Path, "input.mdpkg"); var target = Path.Combine(temp.Path, "output.mdpkg");
            await using (var output = File.Create(source))
                await ResourceOptions.CopyAsync(input, output, Math.Min(options.Resources.MaxSpoolBytes, options.Resources.ReadLimits.MaxInputBytes), ct);
            var result = await operation(source, target);
            if (result.Status != OperationStatus.Success) return result;
            await using var ready = File.OpenRead(target);
            await ResourceOptions.CopyAsync(ready, destination, options.Resources.ReadLimits.MaxInputBytes, ct);
            await destination.FlushAsync(ct);
            return new(result.Engine with { Package = result.Engine.Package! with { Path = null } });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new(ApiSupport.Failure(ex)); }
    }
    public async Task<UpdateResult> MaterializeAsync(MaterializePackageRequest request, string destinationPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        Validate(request.InputPackage, destinationPath, request.Options);
        return new(await new Internal.PackageUpdater(settings).RunAsync(request.InputPackage, destinationPath, null, null, null, request.Options, request.ExpectedNamespace, cancellationToken));
    }
    public async Task<UpdateResult> UpdateAsync(UpdatePackageRequest request, string destinationPath, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request); ArgumentNullException.ThrowIfNull(request.Metadata);
        Validate(request.InputPackage, destinationPath, request.Options);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.SourceDirectory);
        ApiSupport.Creation(request.Options, request.Metadata, HistoryMode.Git);
        return new(await new Internal.PackageUpdater(settings).RunAsync(request.InputPackage, destinationPath, request.SourceDirectory,
            request.Metadata, request.Correspondence, request.Options, request.ExpectedNamespace, cancellationToken));
    }
    private static void Validate(string input, string output, CreationOptions options)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(input); ArgumentException.ThrowIfNullOrWhiteSpace(output);
        ApiSupport.Creation(options, null, HistoryMode.Git);
        if (options.ObjectFormat != "sha1") throw new ArgumentException("Only SHA-1 Git output is supported.");
        if (string.Equals(Path.GetFullPath(input), Path.GetFullPath(output), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new ArgumentException("Update writes a separate output package; input cannot be overwritten.");
    }
}
