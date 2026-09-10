using Mdpkg.Core.Internal.IO;

namespace Mdpkg.Core;

/// <summary>Full payload/format validation, optionally including native Git and retained lineage checks.</summary>
public sealed class PackageValidator
{
    private readonly Internal.EngineSettings settings;
    public PackageValidator(EngineSettings? settings = null) => this.settings = ApiSupport.Settings(settings);
    public async Task<ValidationResult> ValidateFileAsync(string path, ValidationOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path); ApiSupport.Validation(options);
        return new(await new Internal.Validation.PackageValidator(settings).ValidateAsync(
            new(path, options.Deep, options.AcceptRecoverable, options.ExpectedNamespace?.ToString("D"), options.ObjectFormat, options.Resources), cancellationToken),
            options.Deep ? ValidationLevel.Deep : ValidationLevel.Full);
    }
    /// <summary>Leaves input open. Copies from its current position to bounded private storage, cleaned on every outcome.</summary>
    public async Task<ValidationResult> ValidateAsync(Stream package, ValidationOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(package); ApiSupport.Validation(options);
        if (!package.CanRead) throw new ArgumentException("Input must be readable.", nameof(package));
        cancellationToken.ThrowIfCancellationRequested();
        var level = options.Deep ? ValidationLevel.Deep : ValidationLevel.Full;
        try
        {
            using var temp = new TemporaryDirectory(settings.TemporaryDirectory ?? options.Resources.ReadLimits.TemporaryDirectory);
            var path = Path.Combine(temp.Path, "input.mdpkg");
            await using (var output = File.Create(path))
                await ResourceOptions.CopyAsync(package, output, Math.Min(options.Resources.MaxSpoolBytes, options.Resources.ReadLimits.MaxInputBytes), cancellationToken);
            var result = await new Internal.Validation.PackageValidator(settings).ValidateAsync(
                new(path, options.Deep, options.AcceptRecoverable, options.ExpectedNamespace?.ToString("D"), options.ObjectFormat, options.Resources), cancellationToken);
            return new(result with { Package = result.Package is null ? null : result.Package with { Path = null } }, level);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new(ApiSupport.Failure(ex), level); }
    }
}
