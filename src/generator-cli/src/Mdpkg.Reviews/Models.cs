using System.Text.Json;
using Mdpkg.Reader;

namespace Mdpkg.Reviews;

public enum ReviewOutcome { Success, NotReview, UnsupportedVersionOrProfile, Malformed, ResourceLimitExceeded, VerificationUnavailable, VerificationFailed, EnvironmentFailure }
public enum SchemaStatus { NotChecked, Valid, Unsupported, Malformed }
public enum VerificationLevel { None, Structural, Full }
public enum ReviewShape { Delta, Bundled }
public enum CommentKind { Unspecified, Comment, ChangeRequest }
public enum KindSource { LegacyV1, AuthoredV2 }
public enum ThreadState { Open, Resolved, Obsolete }
public enum TargetStatus { TargetUnavailable, HistoryRequired, VerificationUnavailable, TargetIntact, TargetRelocated, TargetDetached, Unconfirmed, Invalidated }
public enum CorrelationStatus { NotChecked, Exact, Reemitted, NewerTarget, WrongLineage, WrongSnapshot, OriginalUnavailable }

public sealed record ReviewDiagnostic(string Code, string Message, string? ThreadId = null, string? CommentId = null);
public sealed record ReviewedIdentity(PackageIdentity Identity, string? PackageDigest, long? PackageBytes, string? Dispatch);
public sealed record QuoteSelector(int Start, int End, string Quote, int Occurrence, string Prefix, string Suffix,
    IReadOnlyDictionary<string, JsonElement>? Extensions = null);
public sealed record ReviewedAnchor(PackageIdentity Identity, string Root, string Expect, DocumentLocator Locator, string RawLocator, QuoteSelector Selector);
public sealed record ReviewComment(string Id, string At, string Author, string Body, string? InReplyTo, CommentKind Kind, KindSource KindSource,
    IReadOnlyDictionary<string, JsonElement> Extensions);
public sealed record ReviewThread(string Id, ThreadState State, ReviewedAnchor Anchor, IReadOnlyList<ReviewComment> Comments,
    IReadOnlyDictionary<string, JsonElement> Extensions);
public sealed record SourceRange(int Start, int End, string Units = PackageProfiles.OffsetUnits);
public sealed record ResolvedLocation(PackageIdentity Identity, DocumentLocator Locator, int ScopeDocumentStart, SourceRange? Range);
public sealed record ReviewItem(PackageIdentity ReviewIdentity, string ThreadId, string CommentId, int ThreadIndex, int CommentIndex,
    string? InReplyTo, CommentKind Kind, KindSource KindSource, string Body, string Author, string At, ThreadState ThreadState,
    ReviewedAnchor ReviewedAnchor, ResolvedLocation? ResolvedLocation = null, IdentityStatus IdentityStatus = IdentityStatus.NotResolved,
    TargetStatus TargetStatus = TargetStatus.TargetUnavailable, string Reason = "target-unavailable", string? CurrentDigest = null,
    IReadOnlyList<string>? Successors = null)
{
    public string DeclaredDocumentPath => ReviewedAnchor.Locator.DocumentPath;
    public IReadOnlyList<HeadingPart> DeclaredHeadingTrail => ReviewedAnchor.Locator.HeadingTrail;
}
public sealed record ReviewExtractionResult(ReviewOutcome Outcome, ContainerStatus ContainerStatus, SchemaStatus SchemaStatus,
    VerificationLevel VerificationLevel, PackageIdentity? ReviewIdentity, ReviewShape? Shape, ReviewedIdentity? ReviewedIdentity,
    int? DocumentVersion, IReadOnlyList<ReviewThread> Threads, IReadOnlyList<ReviewItem> Items, IReadOnlyList<ReviewDiagnostic> Diagnostics,
    IReadOnlyList<string> Checks, string? PackageDigest = null, string? AnchorProfile = null, string? DigestProfile = null, string? SelectorProfile = null,
    IReadOnlyDictionary<string, JsonElement>? Extensions = null);

public sealed record ReviewReadOptions
{
    public ReadLimits Limits { get; init; } = new();
    public int MaxCommentsBytes { get; init; } = 8 * 1024 * 1024;
    public int MaxThreads { get; init; } = 5_000;
    public int MaxComments { get; init; } = 20_000;
    public int MaxBodyBytes { get; init; } = 64 * 1024;
    public bool AcceptRecoverable { get; init; }
    public bool ComputePackageDigest { get; init; }
    public bool RequireFullVerification { get; init; }
    public IReviewVerificationProvider? VerificationProvider { get; init; }
}

[Flags]
public enum VerificationChecks { None = 0, AllPayloads = 1, GitIntegrity = 2, CurrentView = 4, ReviewLineage = 8, Full = AllPayloads | GitIntegrity | CurrentView | ReviewLineage }
public sealed record VerificationReport(bool Accepted, VerificationChecks CompletedChecks, IReadOnlyList<ReviewDiagnostic> Diagnostics);
public interface IReviewVerificationProvider
{
    /// <summary>Verify all payloads, Git integrity/current view, and declared delta/bundled lineage within caller limits; no provider is invoked implicitly.</summary>
    Task<VerificationReport> VerifyAsync(PackageArchive package, ReviewShape shape, ReviewedIdentity reviewedIdentity, CancellationToken cancellationToken);
}

/// <summary>Backend-selected data, never a URL/path obtained from untrusted dispatch metadata.</summary>
public sealed record ReviewedPackageContext(PackageSnapshot? ReviewedSnapshot = null, PackageSnapshot? Target = null,
    bool UseNewerTarget = false, VerificationLevel ContextVerification = VerificationLevel.Structural);
public sealed record ReviewResolutionResult(CorrelationStatus Correlation, IReadOnlyList<ReviewItem> Items, IReadOnlyList<ReviewDiagnostic> Diagnostics);
