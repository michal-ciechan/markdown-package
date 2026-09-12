using Mdpkg.Reader;

namespace Mdpkg.Core;

internal static class ApiSupport
{
    internal static Internal.EngineSettings Settings(EngineSettings? settings)
    {
        settings ??= new(); ArgumentException.ThrowIfNullOrWhiteSpace(settings.GitExecutable);
        return new(settings.GitExecutable, settings.TemporaryDirectory) { ManagedSnapshots = settings.ManagedSnapshots };
    }
    internal static void Creation(CreationOptions options, SnapshotMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(options); ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(options.Resources); options.Resources.Validate();
        if (options.CompressionLevel is < 0 or > 9 || !Enum.IsDefined(options.Warnings)) throw new ArgumentException("Invalid creation options.", nameof(options));
        if (options.Anchor != Profile.Anchor || options.Digest != Profile.Digest) throw new ArgumentException("Unsupported addressing profile.", nameof(options));
        ArgumentNullException.ThrowIfNull(options.ObjectFormat);
        Identity(metadata.Author); Identity(metadata.Committer); ArgumentNullException.ThrowIfNull(metadata.Message);
        if (metadata.Message.Contains('\0')) throw new ArgumentException("Commit message contains NUL.", nameof(metadata));
    }
    private static void Identity(CommitIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (string.IsNullOrWhiteSpace(identity.Name) || string.IsNullOrWhiteSpace(identity.Email) ||
            identity.Name.IndexOfAny(['\r', '\n', '\0', '<', '>']) >= 0 || identity.Email.IndexOfAny(['\r', '\n', '\0', '<', '>']) >= 0)
            throw new ArgumentException("Commit identity must contain a name and email without header delimiters.");
    }
    internal static void Validation(ValidationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options); ArgumentNullException.ThrowIfNull(options.Resources);
        ArgumentNullException.ThrowIfNull(options.ObjectFormat); options.Resources.Validate();
    }
    internal static Internal.EngineResult Failure(Exception ex) => new(Outcome.Environment, null, null, null, 0, 0, [],
        [Findings.Create("MDPK5001", ex.Message, severity: "error")], ResourceExceeded: ex is ResourceLimitException);
}
