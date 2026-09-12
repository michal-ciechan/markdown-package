using System.Text.Json;

namespace Mdpkg.Reader;

/// <summary>An explicit, bounded history verifier. Ordinary reads do not invoke it.</summary>
public interface IHistoryVerificationBackend
{
    /// <summary>Verifies a bounded copy without disposing the caller's archive.</summary>
    Task<VerifiedHistoryContext> VerifyAsync(PackageArchive archive, CancellationToken cancellationToken = default);
}
/// <summary>Whether a checkpoint and its transition interval have been established.</summary>
public enum CheckpointStatus
{
    /// <summary>Verified membership and complete correspondence through current.</summary>
    Verified,
    /// <summary>Verified membership, but at least one interval is partial.</summary>
    IncompleteCorrespondence,
    /// <summary>No verified membership.</summary>
    Unavailable
}
/// <summary>A checkpoint's verified graph position and correspondence assessment.</summary>
public sealed record CheckpointRelationship(CheckpointStatus Status, CurrentState? Commit, string Reason);

/// <summary>Verified retained checkpoints, bound to the exact target archive digest and length.</summary>
public sealed class VerifiedHistoryContext
{
    private readonly string[] commits;
    private readonly bool[] completeTransitions;
    private readonly Dictionary<string, byte[]> originalFiles;
    /// <summary>The verified target state.</summary>
    public PackageIdentity Target { get; }
    /// <summary>Qualified SHA-256 of the verified archive bytes.</summary>
    public string PackageDigest { get; }
    /// <summary>Verified archive length.</summary>
    public long PackageBytes { get; }
    /// <summary>Reconstructed original current view; its original ZIP bytes are unavailable.</summary>
    public PackageSnapshot? OriginalSnapshot { get; }
    /// <summary>Verified bootstrap commit, or null for an ordinary Git lineage.</summary>
    public CurrentState? BootstrapCommit { get; }
    /// <summary>Owned semantic header of the verified original state.</summary>
    public JsonElement? OriginalHeader { get; }
    /// <summary>All verified original file paths.</summary>
    public IReadOnlyList<string> OriginalPaths { get; }
    internal string GetOldestCommit() => commits[0];
    internal VerifiedHistoryContext(PackageIdentity target, string digest, long bytes, string[] commits, bool[] completeTransitions,
        PackageSnapshot? original, JsonElement? header, Dictionary<string, byte[]>? files)
    {
        Target = target; PackageDigest = digest; PackageBytes = bytes;
        this.commits = commits.ToArray(); this.completeTransitions = completeTransitions.ToArray();
        OriginalSnapshot = original; OriginalHeader = header?.Clone();
        BootstrapCommit = original is null ? null : new("commit", "sha1-" + commits[0]);
        originalFiles = files?.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal) ?? new(StringComparer.Ordinal);
        OriginalPaths = Array.AsReadOnly(originalFiles.Keys.ToArray());
    }
    /// <summary>Returns an owned copy of a verified original file, including non-Markdown files.</summary>
    public byte[] ReadOriginalEntry(string path) => originalFiles.TryGetValue(path, out var bytes) ? bytes.ToArray() : throw new KeyNotFoundException(path);
    /// <summary>Checks archive bytes as well as declared identity before proof reuse.</summary>
    public bool Matches(PackageSnapshot snapshot) => snapshot.HasOriginalArchiveBytes && Target == snapshot.Identity &&
        PackageBytes == snapshot.PackageBytes && PackageDigest == snapshot.PackageDigest;
    /// <summary>Translates only a verified origin or retained commit, then checks every intervening transition.</summary>
    public CheckpointRelationship GetRelationship(CurrentState checkpoint)
    {
        if (!Internal.Format.Profile.State(checkpoint)) return new(CheckpointStatus.Unavailable, null, "malformed-checkpoint");
        var commit = checkpoint.Kind == "snapshot" ? checkpoint == OriginalSnapshot?.Identity.Current ? BootstrapCommit : null : checkpoint;
        var at = commit is null ? -1 : Array.IndexOf(commits, commit.Id[5..]);
        if (at < 0) return new(CheckpointStatus.Unavailable, null, "history-unavailable");
        if (completeTransitions.Skip(at).Any(c => !c)) return new(CheckpointStatus.IncompleteCorrespondence, commit, "incomplete-correspondence");
        return new(CheckpointStatus.Verified, commit, "verified-checkpoint");
    }
}
