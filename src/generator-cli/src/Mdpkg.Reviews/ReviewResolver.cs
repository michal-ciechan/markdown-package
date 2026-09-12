using Mdpkg.Reader;

namespace Mdpkg.Reviews;

public sealed partial class ReviewExtractor
{
    /// <summary>Correlates caller-selected snapshots and resolves feedback with ledger identity and quote/context evidence.</summary>
    /// <param name="review">Previously extracted feedback, preserved even when a location cannot be established.</param>
    /// <param name="context">Backend-selected exact reviewed snapshot and optional explicitly selected newer target.</param>
    /// <param name="cancellationToken">Token used to cancel the operation; cancellation is propagated to the caller.</param>
    /// <returns>All feedback items with separate identity, target and correlation assessments.</returns>
    /// <remarks>Never opens dispatch paths or URLs. Newer targets require verified original context and an explicit selection. Origin and Git context use archive-bound backend proof. Quote relocation searches only a live changed scope and refuses ties. Ranges use UTF-16 code units relative to canonical scope source.</remarks>
    /// <exception cref="ArgumentNullException">Review or context is null.</exception>
    /// <exception cref="OperationCanceledException">Cancellation was requested.</exception>
    public Task<ReviewResolutionResult> ResolveAsync(ReviewExtractionResult review, ReviewedPackageContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(review); ArgumentNullException.ThrowIfNull(context);
        cancellationToken.ThrowIfCancellationRequested();
        var diagnostics = new List<ReviewDiagnostic>();
        if (review.SchemaStatus != SchemaStatus.Valid || review.ReviewedIdentity is null)
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.Invalidated, TargetStatus.Invalidated, "review-schema-unavailable");
        var reviewed = review.ReviewedIdentity;
        var basis = context.ReviewedSnapshot;
        var target = context.Target ?? basis;
        var targetHistory = context.TargetHistory ?? (target is not null && context.ReviewedHistory?.Matches(target) == true ? context.ReviewedHistory : null);
        if ((targetHistory is not null && target is not null && !targetHistory.Matches(target)) ||
            (context.ReviewedHistory is not null && (basis is null || !context.ReviewedHistory.Matches(basis))))
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.Unconfirmed, TargetStatus.VerificationUnavailable, "verification-context-mismatch");
        if (basis is null && targetHistory?.OriginalSnapshot is { } reconstructed && reconstructed.Identity == reviewed.Identity)
            basis = reconstructed;
        target ??= basis;
        if (target is null) return Finish(CorrelationStatus.OriginalUnavailable, IdentityStatus.NotResolved, TargetStatus.TargetUnavailable, "target-unavailable");
        if (target.Identity.Namespace != reviewed.Identity.Namespace || context.ReviewedSnapshot is { } supplied && supplied.Identity.Namespace != reviewed.Identity.Namespace)
            return Finish(CorrelationStatus.WrongLineage, IdentityStatus.Invalidated, TargetStatus.Invalidated, "wrong-lineage");
        if (context.ReviewedSnapshot is { } original && original.Identity != reviewed.Identity)
            return Finish(CorrelationStatus.WrongSnapshot, IdentityStatus.Invalidated, TargetStatus.Invalidated, "wrong-reviewed-snapshot");
        var newer = target.Identity != reviewed.Identity;
        if (newer && !context.UseNewerTarget)
            return Finish(CorrelationStatus.WrongSnapshot, IdentityStatus.Invalidated, TargetStatus.Invalidated, "newer-target-not-selected");
        basis ??= !newer ? target : null;
        if (basis is null) return Finish(CorrelationStatus.OriginalUnavailable, IdentityStatus.Unconfirmed, TargetStatus.HistoryRequired, "reviewed-snapshot-unavailable");
        if (target.IsReviewPackage && targetHistory?.Matches(target) != true && target.Assurance != IdentityAssurance.SnapshotVerified)
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.NotResolved, TargetStatus.VerificationUnavailable, "bundled-context-requires-full-verification");
        if (basis.Assurance != IdentityAssurance.SnapshotVerified && context.ReviewedHistory?.Matches(basis) != true && targetHistory?.Matches(basis) != true)
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.NotResolved, TargetStatus.VerificationUnavailable, "reviewed-source-unverified");
        if (target.Assurance != IdentityAssurance.SnapshotVerified && targetHistory?.Matches(target) != true)
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.NotResolved, TargetStatus.VerificationUnavailable, "target-source-unverified");
        if (basis.Addressing.Anchor != review.AnchorProfile || basis.Addressing.Digest != review.DigestProfile)
            return Finish(CorrelationStatus.NotChecked, IdentityStatus.Invalidated, TargetStatus.Invalidated, "reviewed-profile-mismatch");
        var repacked = basis.HasOriginalArchiveBytes && ((reviewed.PackageDigest is not null && basis.PackageDigest != reviewed.PackageDigest) ||
            (reviewed.PackageBytes is not null && basis.PackageBytes != reviewed.PackageBytes));
        if (!basis.HasOriginalArchiveBytes) diagnostics.Add(new("OriginalArchiveUnavailable", "Verified origin reconstructs the original state, not its ZIP encoding or transport evidence."));
        if (repacked) diagnostics.Add(new("ReemittedPackage", "The reviewed identity matches; optional digest/length differ. Dispatch metadata was not used as authority."));
        var relationshipVerified = targetHistory?.Matches(target) == true && targetHistory.GetRelationship(reviewed.Identity.Current).Status == CheckpointStatus.Verified;
        var correlation = newer ? relationshipVerified ? CorrelationStatus.NewerTarget : CorrelationStatus.NotChecked
            : !basis.HasOriginalArchiveBytes ? CorrelationStatus.Reconstructed : repacked ? CorrelationStatus.Reemitted : CorrelationStatus.Exact;
        var resolved = new Dictionary<string, ThreadResolution>(StringComparer.Ordinal);
        foreach (var thread in review.Threads)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var a = thread.Anchor;
            var originalState = basis.Resolve(reviewed.Identity, a.Root, a.Expect, a.Locator, cancellationToken);
            if (originalState.Scope is null)
            {
                var status = originalState.Status switch { IdentityStatus.Invalidated => TargetStatus.Invalidated,
                    IdentityStatus.FlaggedChanged => TargetStatus.TargetDetached, _ => TargetStatus.Unconfirmed };
                resolved.Add(thread.Id, new(originalState.Status, status, originalState.Reason, null, null, originalState.Successors ?? []));
                continue;
            }
            if (originalState.Scope is { } originalScope &&
                (originalState.Status != IdentityStatus.Survives || !ValidStoredSelector(originalScope.CanonicalSource, a.Selector)))
            {
                resolved.Add(thread.Id, new(IdentityStatus.Invalidated, TargetStatus.Invalidated, "invalid-reviewed-selector-or-digest", null, originalScope.Digest, []));
                continue;
            }
            var identity = target.Resolve(reviewed.Identity, a.Root, a.Expect, a.Locator, cancellationToken, targetHistory?.Matches(target) == true ? targetHistory : null);
            var scope = identity.Scope;
            var targetStatus = identity.Status switch { IdentityStatus.Unconfirmed => identity.Reason == "history-required" ? TargetStatus.HistoryRequired : TargetStatus.Unconfirmed,
                IdentityStatus.Invalidated => TargetStatus.Invalidated, _ => TargetStatus.TargetDetached };
            var reason = identity.Reason; SourceRange? range = null;
            if (scope is not null && identity.Status == IdentityStatus.Survives)
            {
                if (ValidStoredSelector(scope.CanonicalSource, a.Selector)) { range = new(a.Selector.Start, a.Selector.End); targetStatus = TargetStatus.TargetIntact; }
                else { targetStatus = TargetStatus.Invalidated; reason = "invalid-selector"; }
            }
            else if (scope is not null && identity.Status == IdentityStatus.FlaggedChanged)
            {
                range = Relocate(scope.CanonicalSource, a.Selector, cancellationToken);
                targetStatus = range is null ? TargetStatus.TargetDetached : TargetStatus.TargetRelocated;
                reason = range is null ? "quote-absent-or-context-tied" : "quote-relocated";
            }
            resolved.Add(thread.Id, new(identity.Status, targetStatus, reason,
                scope is null ? null : new(target.Identity, scope.Locator, scope.DocumentStart, range), scope?.Digest, identity.Successors ?? []));
        }
        var items = review.Items.Select(i =>
        {
            var r = resolved[i.ThreadId];
            return i with { IdentityStatus = r.Identity, TargetStatus = r.Target, Reason = r.Reason, ResolvedLocation = r.Location, CurrentDigest = r.Digest, Successors = r.Successors };
        }).ToArray();
        return Task.FromResult(new ReviewResolutionResult(correlation, Array.AsReadOnly(items), diagnostics.AsReadOnly()));

        Task<ReviewResolutionResult> Finish(CorrelationStatus correlation, IdentityStatus identity, TargetStatus target, string reason) =>
            Task.FromResult(new ReviewResolutionResult(correlation, Array.AsReadOnly(review.Items.Select(i => i with
            { IdentityStatus = identity, TargetStatus = target, Reason = reason, ResolvedLocation = null, CurrentDigest = null, Successors = [] }).ToArray()),
                [new(reason, "Feedback is preserved; a verified location is unavailable.")]));
    }

    private sealed record ThreadResolution(IdentityStatus Identity, TargetStatus Target, string Reason, ResolvedLocation? Location, string? Digest, IReadOnlyList<string> Successors);
    private static bool Boundary(string text, int offset) => offset >= 0 && offset <= text.Length &&
        (offset == 0 || offset == text.Length || !char.IsHighSurrogate(text[offset - 1]) || !char.IsLowSurrogate(text[offset]));
    private static bool ValidStoredSelector(string source, QuoteSelector selector) =>
        selector.Start >= 0 && selector.End <= source.Length && selector.End > selector.Start &&
        Boundary(source, selector.Start) && Boundary(source, selector.End) &&
        source.AsSpan(selector.Start, selector.End - selector.Start).SequenceEqual(selector.Quote) &&
        selector.Prefix.Length <= selector.Start && source.AsSpan(selector.Start - selector.Prefix.Length, selector.Prefix.Length).SequenceEqual(selector.Prefix) &&
        selector.Suffix.Length <= source.Length - selector.End && source.AsSpan(selector.End, selector.Suffix.Length).SequenceEqual(selector.Suffix);

    private static SourceRange? Relocate(string source, QuoteSelector selector, CancellationToken ct)
    {
        var winner = -1; var best = -1; var tied = false; var search = 0;
        while (search <= source.Length - selector.Quote.Length)
        {
            ct.ThrowIfCancellationRequested();
            var match = source.IndexOf(selector.Quote, search, StringComparison.Ordinal);
            if (match < 0) break;
            search = match + 1;
            if (!Boundary(source, match) || !Boundary(source, match + selector.Quote.Length)) continue;
            var before = 0; var after = 0;
            while (before < selector.Prefix.Length && before < match && selector.Prefix[^(before + 1)] == source[match - before - 1]) before++;
            while (after < selector.Suffix.Length && match + selector.Quote.Length + after < source.Length &&
                selector.Suffix[after] == source[match + selector.Quote.Length + after]) after++;
            var score = before + after;
            if (score > best) { winner = match; best = score; tied = false; }
            else if (score == best) tied = true;
        }
        // Stored occurrence is provenance only: a tie must never choose an attachment.
        return winner < 0 || tied ? null : new(winner, winner + selector.Quote.Length);
    }
}
