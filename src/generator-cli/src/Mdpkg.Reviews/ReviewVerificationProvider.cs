using Mdpkg.Reader;

namespace Mdpkg.Reviews;

/// <summary>Verifies snapshots without Git and delegates Git packages to an explicitly supplied history backend.</summary>
/// <param name="historyBackend">Bounded history verifier, or null when Git verification is unavailable.</param>
public sealed class ReviewVerificationProvider(IHistoryVerificationBackend? historyBackend = null) : IReviewVerificationProvider
{
    /// <inheritdoc />
    public async Task<VerificationReport> VerifyAsync(PackageArchive package, VerificationChecks requiredChecks, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(package);
        cancellationToken.ThrowIfCancellationRequested();
        var required = VerificationObligations.Required(package);
        if (required != requiredChecks) return new(false, VerificationChecks.None, [new("VerificationFailed", "Verification requirements disagree with the package.")]);
        if (package.HistoryMode is SnapshotHistory)
        {
            package.VerifySnapshot(cancellationToken);
            return new(true, required, []);
        }
        if (historyBackend is null)
            return new(false, VerificationChecks.None, [new("HistoryVerificationUnavailable", "Git integrity and any origin require an explicit history backend.")]);
        var proof = await historyBackend.VerifyAsync(package, cancellationToken);
        return new(true, required, [], proof);
    }
}

internal static class VerificationObligations
{
    internal const VerificationChecks All = VerificationChecks.AllPayloads | VerificationChecks.CurrentView | VerificationChecks.ReviewLineage |
        VerificationChecks.GitIntegrity | VerificationChecks.SnapshotIdentity | VerificationChecks.BootstrapOrigin;
    internal static VerificationChecks Required(PackageArchive archive) => VerificationChecks.AllPayloads | VerificationChecks.CurrentView | VerificationChecks.ReviewLineage |
        (archive.HistoryMode is SnapshotHistory ? VerificationChecks.SnapshotIdentity : VerificationChecks.GitIntegrity |
            (archive.History?.Origin is null ? VerificationChecks.None : VerificationChecks.BootstrapOrigin));
    internal static async Task<bool> HasProofAsync(PackageArchive archive, VerificationReport report, CancellationToken ct)
    {
        if (archive.HistoryMode is SnapshotHistory) return archive.Assurance == IdentityAssurance.SnapshotVerified;
        var proof = report.HistoryContext;
        return proof is not null && proof.Target == archive.Identity && proof.PackageBytes == archive.PackageBytes &&
            proof.PackageDigest == await archive.ComputeDigestAsync(ct) &&
            (archive.History?.Origin is null || proof.OriginalSnapshot is not null);
    }
}
