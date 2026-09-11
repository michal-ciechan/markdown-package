using System.Text.Json;
using Mdpkg.Reader;

namespace Mdpkg.Reviews;

/// <summary>Overall extraction outcome; inspect the independent assurance fields for checks performed.</summary>
public enum ReviewOutcome
{
    /// <summary>Feedback was extracted successfully, possibly with zero items.</summary>
    Success,
    /// <summary>The package has no review declaration.</summary>
    NotReview,
    /// <summary>The version, profile or semantic value is unsupported.</summary>
    UnsupportedVersionOrProfile,
    /// <summary>Package or review data is malformed.</summary>
    Malformed,
    /// <summary>A configured resource limit was exceeded; feedback is never truncated to fit.</summary>
    ResourceLimitExceeded,
    /// <summary>Full verification was required but no provider was supplied.</summary>
    VerificationUnavailable,
    /// <summary>The provider did not accept every required full verification check.</summary>
    VerificationFailed,
    /// <summary>An input/output or access failure prevented extraction.</summary>
    EnvironmentFailure,
}
/// <summary>Assessment of the review schema.</summary>
public enum SchemaStatus
{
    /// <summary>The schema has not been checked.</summary>
    NotChecked,
    /// <summary>The supported review schema was validated.</summary>
    Valid,
    /// <summary>A version, profile or semantic value is unsupported.</summary>
    Unsupported,
    /// <summary>Review data failed schema validation.</summary>
    Malformed,
}
/// <summary>Assurance established independently of successful feedback extraction.</summary>
public enum VerificationLevel
{
    /// <summary>No verification has been established.</summary>
    None,
    /// <summary>Selected container, declaration and payload checks ran; full Git and lineage verification is not implied.</summary>
    Structural,
    /// <summary>An explicit provider accepted all required full verification checks.</summary>
    Full,
}
/// <summary>Declared relationship between the returned and reviewed packages.</summary>
public enum ReviewShape
{
    /// <summary>A separate-namespace review of another package.</summary>
    Delta,
    /// <summary>A review bundled in the reviewed package namespace.</summary>
    Bundled,
}
/// <summary>Authored intent of a feedback comment; bodies are prose, not executable patches.</summary>
public enum CommentKind
{
    /// <summary>Version 1 supplies no authored intent.</summary>
    Unspecified,
    /// <summary>An authored comment.</summary>
    Comment,
    /// <summary>An authored request for a change.</summary>
    ChangeRequest,
}
/// <summary>Provenance of a comment kind.</summary>
public enum KindSource
{
    /// <summary>Unspecified intent from a version 1 document.</summary>
    LegacyV1,
    /// <summary>Explicit intent from a version 2 document.</summary>
    AuthoredV2,
}
/// <summary>Authored thread state; extraction preserves threads in every state.</summary>
public enum ThreadState
{
    /// <summary>The thread is open.</summary>
    Open,
    /// <summary>The thread is marked resolved.</summary>
    Resolved,
    /// <summary>The thread is marked obsolete.</summary>
    Obsolete,
}
/// <summary>Attachment of feedback to a caller-selected source view.</summary>
public enum TargetStatus
{
    /// <summary>No target snapshot was supplied.</summary>
    TargetUnavailable,
    /// <summary>Required reviewed-source or historical evidence is unavailable.</summary>
    HistoryRequired,
    /// <summary>The supplied review-package context lacks full verification.</summary>
    VerificationUnavailable,
    /// <summary>The selector remains valid in unchanged scope source.</summary>
    TargetIntact,
    /// <summary>A strict quote/context winner relocated the selector in changed source.</summary>
    TargetRelocated,
    /// <summary>The identity is dead or the quote cannot be attached without ambiguity.</summary>
    TargetDetached,
    /// <summary>Available evidence does not establish an attachment.</summary>
    Unconfirmed,
    /// <summary>The anchor, selector or context is invalid.</summary>
    Invalidated,
}
/// <summary>Correlation of the declared reviewed identity with caller-selected context.</summary>
public enum CorrelationStatus
{
    /// <summary>Correlation could not be established.</summary>
    NotChecked,
    /// <summary>Namespace and current commit match, with no optional digest or length mismatch.</summary>
    Exact,
    /// <summary>Identity matches but optional package digest or length differs.</summary>
    Reemitted,
    /// <summary>The caller explicitly selected a newer target in the same namespace.</summary>
    NewerTarget,
    /// <summary>A supplied snapshot belongs to another namespace.</summary>
    WrongLineage,
    /// <summary>A supplied snapshot does not match the required commit or target selection.</summary>
    WrongSnapshot,
    /// <summary>The exact reviewed snapshot is unavailable.</summary>
    OriginalUnavailable,
}

/// <summary>A review finding with optional thread and comment attribution.</summary>
/// <param name="Code">Machine-readable diagnostic code.</param>
/// <param name="Message">Human-readable detail.</param>
/// <param name="ThreadId">Affected thread ID, if known.</param>
/// <param name="CommentId">Affected comment ID, if known.</param>
public sealed record ReviewDiagnostic(string Code, string Message, string? ThreadId = null, string? CommentId = null);
/// <summary>Declared reviewed package identity and optional corroborating metadata.</summary>
/// <param name="Identity">Namespace and current commit of the reviewed package.</param>
/// <param name="PackageDigest">Optional sha256-prefixed digest of the reviewed package bytes.</param>
/// <param name="PackageBytes">Optional reviewed package length in bytes.</param>
/// <param name="Dispatch">Untrusted dispatch metadata; never authority for opening a path or URL.</param>
public sealed record ReviewedIdentity(PackageIdentity Identity, string? PackageDigest, long? PackageBytes, string? Dispatch);
/// <summary>A quote and context over canonical scope source; offsets use UTF-16 code units.</summary>
/// <param name="Start">Inclusive zero-based start offset.</param>
/// <param name="End">Exclusive end offset.</param>
/// <param name="Quote">Exact selected source text.</param>
/// <param name="Occurrence">Zero-based quote occurrence at review time; never used to break relocation ties.</param>
/// <param name="Prefix">Immediately preceding context, at most 40 UTF-16 code units.</param>
/// <param name="Suffix">Immediately following context, at most 40 UTF-16 code units.</param>
/// <param name="Extensions">Preserved unknown non-semantic selector properties, if supplied.</param>
public sealed record QuoteSelector(int Start, int End, string Quote, int Occurrence, string Prefix, string Suffix,
    IReadOnlyDictionary<string, JsonElement>? Extensions = null);
/// <summary>Authored source identity and selector before current-view resolution.</summary>
/// <param name="Identity">Reviewed package identity.</param>
/// <param name="Root">Persistent anchor root hash.</param>
/// <param name="Expect">Expected canonical scope digest at review time.</param>
/// <param name="Locator">Decoded declared scope locator.</param>
/// <param name="RawLocator">Original canonical base64url locator.</param>
/// <param name="Selector">Authored quote selector.</param>
public sealed record ReviewedAnchor(PackageIdentity Identity, string Root, string Expect, DocumentLocator Locator, string RawLocator, QuoteSelector Selector);
/// <summary>Authored feedback preserved independently of target availability.</summary>
/// <param name="Id">Comment UUID.</param>
/// <param name="At">Authored RFC 3339 timestamp; an unauthenticated claim.</param>
/// <param name="Author">Authored author label; an unauthenticated claim.</param>
/// <param name="Body">Authored prose, not an executable patch.</param>
/// <param name="InReplyTo">Replied-to comment ID in this thread, or null.</param>
/// <param name="Kind">Authored intent, or unspecified for version 1.</param>
/// <param name="KindSource">Version provenance of the kind.</param>
/// <param name="Extensions">Preserved unknown non-semantic comment properties.</param>
public sealed record ReviewComment(string Id, string At, string Author, string Body, string? InReplyTo, CommentKind Kind, KindSource KindSource,
    IReadOnlyDictionary<string, JsonElement> Extensions);
/// <summary>An authored thread, including resolved and obsolete feedback.</summary>
/// <param name="Id">Thread UUID.</param>
/// <param name="State">Authored thread state.</param>
/// <param name="Anchor">Shared reviewed anchor.</param>
/// <param name="Comments">Comments and replies in source order.</param>
/// <param name="Extensions">Preserved unknown non-semantic thread properties.</param>
public sealed record ReviewThread(string Id, ThreadState State, ReviewedAnchor Anchor, IReadOnlyList<ReviewComment> Comments,
    IReadOnlyDictionary<string, JsonElement> Extensions);
/// <summary>A half-open range relative to canonical scope source.</summary>
/// <param name="Start">Inclusive zero-based start offset.</param>
/// <param name="End">Exclusive end offset.</param>
/// <param name="Units">Offset unit identifier; defaults to UTF-16 code units.</param>
public sealed record SourceRange(int Start, int End, string Units = PackageProfiles.OffsetUnits);
/// <summary>A live scope location, with a nullable verified quote range.</summary>
/// <param name="Identity">Selected target package identity.</param>
/// <param name="Locator">Resolved scope locator.</param>
/// <param name="ScopeDocumentStart">Zero-based UTF-16 start offset of the scope in the LF-normalized document.</param>
/// <param name="Range">Verified range relative to canonical scope source, or null when detached.</param>
public sealed record ResolvedLocation(PackageIdentity Identity, DocumentLocator Locator, int ScopeDocumentStart, SourceRange? Range);
/// <summary>One flattened comment with authored metadata and independent resolution evidence.</summary>
/// <param name="ReviewIdentity">Returned review package identity.</param>
/// <param name="ThreadId">Containing thread UUID.</param>
/// <param name="CommentId">Comment UUID.</param>
/// <param name="ThreadIndex">Zero-based thread index in source order.</param>
/// <param name="CommentIndex">Zero-based comment index within its thread.</param>
/// <param name="InReplyTo">Replied-to comment ID, or null.</param>
/// <param name="Kind">Authored intent.</param>
/// <param name="KindSource">Version provenance of the kind.</param>
/// <param name="Body">Authored comment prose.</param>
/// <param name="Author">Unauthenticated authored author label.</param>
/// <param name="At">Unauthenticated authored timestamp.</param>
/// <param name="ThreadState">Authored thread state.</param>
/// <param name="ReviewedAnchor">Original declared anchor and selector.</param>
/// <param name="ResolvedLocation">Resolved live scope and optional quote range; null when unavailable.</param>
/// <param name="IdentityStatus">Current-view identity evidence.</param>
/// <param name="TargetStatus">Quote attachment status.</param>
/// <param name="Reason">Machine-readable resolution explanation.</param>
/// <param name="CurrentDigest">Current scope digest, when available.</param>
/// <param name="Successors">Dead-identity successor roots for navigation, when available.</param>
public sealed record ReviewItem(PackageIdentity ReviewIdentity, string ThreadId, string CommentId, int ThreadIndex, int CommentIndex,
    string? InReplyTo, CommentKind Kind, KindSource KindSource, string Body, string Author, string At, ThreadState ThreadState,
    ReviewedAnchor ReviewedAnchor, ResolvedLocation? ResolvedLocation = null, IdentityStatus IdentityStatus = IdentityStatus.NotResolved,
    TargetStatus TargetStatus = TargetStatus.TargetUnavailable, string Reason = "target-unavailable", string? CurrentDigest = null,
    IReadOnlyList<string>? Successors = null)
{
    /// <summary>Original authored document path, available even when no target resolves.</summary>
    public string DeclaredDocumentPath => ReviewedAnchor.Locator.DocumentPath;
    /// <summary>Original authored heading trail, available even when no target resolves.</summary>
    public IReadOnlyList<HeadingPart> DeclaredHeadingTrail => ReviewedAnchor.Locator.HeadingTrail;
}
/// <summary>Owned extraction data and independent container, schema and verification assessments.</summary>
/// <param name="Outcome">Overall extraction outcome.</param>
/// <param name="ContainerStatus">ZIP container assessment.</param>
/// <param name="SchemaStatus">Review schema assessment.</param>
/// <param name="VerificationLevel">Verification assurance established.</param>
/// <param name="ReviewIdentity">Returned package identity, when read.</param>
/// <param name="Shape">Declared review shape, when read.</param>
/// <param name="ReviewedIdentity">Declared reviewed identity and correlation hints, when read.</param>
/// <param name="DocumentVersion">Comments-document version, when validated.</param>
/// <param name="Threads">Parsed threads in source order.</param>
/// <param name="Items">Flattened comments and replies in source order.</param>
/// <param name="Diagnostics">Extraction or provider findings.</param>
/// <param name="Checks">Names of checks actually performed.</param>
/// <param name="PackageDigest">Optional digest of returned package bytes, computed only when requested.</param>
/// <param name="AnchorProfile">Validated anchor profile identifier.</param>
/// <param name="DigestProfile">Validated source digest profile identifier.</param>
/// <param name="SelectorProfile">Validated quote selector profile identifier.</param>
/// <param name="Extensions">Preserved unknown non-semantic document properties.</param>
public sealed record ReviewExtractionResult(ReviewOutcome Outcome, ContainerStatus ContainerStatus, SchemaStatus SchemaStatus,
    VerificationLevel VerificationLevel, PackageIdentity? ReviewIdentity, ReviewShape? Shape, ReviewedIdentity? ReviewedIdentity,
    int? DocumentVersion, IReadOnlyList<ReviewThread> Threads, IReadOnlyList<ReviewItem> Items, IReadOnlyList<ReviewDiagnostic> Diagnostics,
    IReadOnlyList<string> Checks, string? PackageDigest = null, string? AnchorProfile = null, string? DigestProfile = null, string? SelectorProfile = null,
    IReadOnlyDictionary<string, JsonElement>? Extensions = null);

/// <summary>Extraction budgets and explicit verification choices; exceeding a cap rejects data without truncation.</summary>
public sealed record ReviewReadOptions
{
    /// <summary>Reader resource budgets; defaults to a new set of standard read limits.</summary>
    public ReadLimits Limits { get; init; } = new();
    /// <summary>Maximum decoded comments-document size in bytes; defaults to 8 MiB.</summary>
    public int MaxCommentsBytes { get; init; } = 8 * 1024 * 1024;
    /// <summary>Maximum thread count; defaults to 5,000. Zero permits only an empty thread list.</summary>
    public int MaxThreads { get; init; } = 5_000;
    /// <summary>Maximum total comment count; defaults to 20,000. Excess data is rejected, never truncated.</summary>
    public int MaxComments { get; init; } = 20_000;
    /// <summary>Maximum UTF-8 byte length per comment body; defaults to 64 KiB.</summary>
    public int MaxBodyBytes { get; init; } = 64 * 1024;
    /// <summary>Whether to accept recoverable ZIP typing; defaults to false.</summary>
    public bool AcceptRecoverable { get; init; }
    /// <summary>Whether to hash all returned package bytes for provenance; defaults to false.</summary>
    public bool ComputePackageDigest { get; init; }
    /// <summary>Whether extraction must report unavailable verification when no provider is supplied; defaults to false.</summary>
    public bool RequireFullVerification { get; init; }
    /// <summary>Explicit full verification provider, invoked whenever supplied; null performs structural verification only.</summary>
    public IReviewVerificationProvider? VerificationProvider { get; init; }
}

/// <summary>Independent obligations reported by a full verification provider.</summary>
[Flags]
public enum VerificationChecks
{
    /// <summary>No obligations completed.</summary>
    None = 0,
    /// <summary>Every package payload was verified.</summary>
    AllPayloads = 1,
    /// <summary>Git integrity was verified.</summary>
    GitIntegrity = 2,
    /// <summary>The declared current view was verified.</summary>
    CurrentView = 4,
    /// <summary>The declared delta or bundled review lineage was verified.</summary>
    ReviewLineage = 8,
    /// <summary>All required full verification obligations.</summary>
    Full = AllPayloads | GitIntegrity | CurrentView | ReviewLineage,
}
/// <summary>A provider decision with explicit evidence of completed obligations.</summary>
/// <param name="Accepted">Whether the provider accepts the package.</param>
/// <param name="CompletedChecks">Obligations actually completed; full assurance requires all full checks.</param>
/// <param name="Diagnostics">Provider findings.</param>
public sealed record VerificationReport(bool Accepted, VerificationChecks CompletedChecks, IReadOnlyList<ReviewDiagnostic> Diagnostics);
/// <summary>Caller-supplied full verification of payloads, Git integrity, current view and review lineage.</summary>
/// <remarks>No provider is invoked implicitly. Implementations must impose their own CPU, temporary-disk and subprocess budgets in addition to bounded archive access.</remarks>
public interface IReviewVerificationProvider
{
    /// <summary>Verifies the package against every required full verification obligation.</summary>
    /// <param name="package">Borrowed bounded archive; do not dispose or retain it after this call.</param>
    /// <param name="shape">Validated declared review shape.</param>
    /// <param name="reviewedIdentity">Declared reviewed identity and untrusted correlation metadata.</param>
    /// <param name="cancellationToken">Token used to cancel the operation; cancellation is propagated to the caller.</param>
    /// <returns>Acceptance and completed obligations; full assurance requires acceptance plus all Full checks.</returns>
    Task<VerificationReport> VerifyAsync(PackageArchive package, ReviewShape shape, ReviewedIdentity reviewedIdentity, CancellationToken cancellationToken);
}

/// <summary>Backend-selected snapshots; dispatch metadata is never used to locate context.</summary>
/// <param name="ReviewedSnapshot">Exact reviewed snapshot used to validate original selectors.</param>
/// <param name="Target">Selected resolution target; defaults to the reviewed snapshot.</param>
/// <param name="UseNewerTarget">Explicitly permits a different current commit in the same namespace.</param>
/// <param name="ContextVerification">Caller-established assurance of context; review-package snapshots require full verification.</param>
public sealed record ReviewedPackageContext(PackageSnapshot? ReviewedSnapshot = null, PackageSnapshot? Target = null,
    bool UseNewerTarget = false, VerificationLevel ContextVerification = VerificationLevel.Structural);
/// <summary>Feedback preserved with correlation and current-view resolution evidence.</summary>
/// <param name="Correlation">Correlation of supplied context with the reviewed package.</param>
/// <param name="Items">All input feedback items with updated resolution fields.</param>
/// <param name="Diagnostics">Context and correlation findings.</param>
public sealed record ReviewResolutionResult(CorrelationStatus Correlation, IReadOnlyList<ReviewItem> Items, IReadOnlyList<ReviewDiagnostic> Diagnostics);
