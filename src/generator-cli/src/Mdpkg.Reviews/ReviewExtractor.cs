using System.Text;
using System.Text.Json;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal;

namespace Mdpkg.Reviews;

public sealed partial class ReviewExtractor
{
    public async Task<ReviewExtractionResult> ExtractAsync(Stream returnedPackage, ReviewReadOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(returnedPackage); options ??= new(); options.Limits.Validate();
        if (options.MaxCommentsBytes < 1 || options.MaxThreads < 0 || options.MaxComments < 0 || options.MaxBodyBytes < 1)
            throw new ArgumentOutOfRangeException(nameof(options));
        var result = new ReviewExtractionResult(ReviewOutcome.Malformed, ContainerStatus.NotChecked, SchemaStatus.NotChecked,
            VerificationLevel.None, null, null, null, null, [], [], [], []);
        try
        {
            using var archive = await PackageArchive.OpenAsync(returnedPackage, options.Limits, options.AcceptRecoverable, cancellationToken);
            result = result with { ContainerStatus = archive.ContainerStatus, VerificationLevel = VerificationLevel.Structural,
                ReviewIdentity = archive.Identity, Checks = Array.AsReadOnly(new[] { "zip-directory-and-extents", "manifest", "history-declaration", "branch-reference" }) };
            if (archive.Review is null) return result with { Outcome = ReviewOutcome.NotReview };
            var (shape, of) = ReviewParser.Declaration(archive.Review.Value, archive.Identity);
            result = result with { Shape = shape, ReviewedIdentity = of };
            var bytes = archive.ReadEntry(".mdpkg/review/comments.json", options.MaxCommentsBytes, cancellationToken);
            var node = archive.ReadCanonicalJson(bytes, false, cancellationToken);
            var (version, threads, extensions) = ReviewParser.Document(node, of.Identity, options, cancellationToken);
            var items = threads.SelectMany((t, ti) => t.Comments.Select((c, ci) => new ReviewItem(archive.Identity, t.Id, c.Id, ti, ci,
                c.InReplyTo, c.Kind, c.KindSource, c.Body, c.Author, c.At, t.State, t.Anchor))).ToArray();
            result = result with { Outcome = ReviewOutcome.Success, SchemaStatus = SchemaStatus.Valid, DocumentVersion = version, Threads = threads,
                Items = Array.AsReadOnly(items), Checks = Array.AsReadOnly(result.Checks.Concat(["comments-schema", "comment-ids-and-replies", "selector-shape"]).ToArray()),
                AnchorProfile = PackageProfiles.Anchor, DigestProfile = PackageProfiles.Digest, SelectorProfile = PackageProfiles.Selector, Extensions = extensions };
            if (options.ComputePackageDigest) result = result with { PackageDigest = await archive.ComputeDigestAsync(cancellationToken) };
            if (options.VerificationProvider is { } provider)
            {
                var report = await provider.VerifyAsync(archive, shape, of, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                var full = report.Accepted && (report.CompletedChecks & VerificationChecks.Full) == VerificationChecks.Full;
                result = result with { Outcome = full ? ReviewOutcome.Success : ReviewOutcome.VerificationFailed,
                    VerificationLevel = full ? VerificationLevel.Full : VerificationLevel.Structural,
                    Checks = Array.AsReadOnly(result.Checks.Concat(Enum.GetValues<VerificationChecks>().Where(c => c is not (VerificationChecks.None or VerificationChecks.Full) && report.CompletedChecks.HasFlag(c)).Select(c => "provider:" + c)).ToArray()),
                    Diagnostics = Array.AsReadOnly(report.Diagnostics.Concat(full ? [] : new[] { new ReviewDiagnostic("VerificationFailed", "Provider did not establish every required full verification check.") }).ToArray()) };
            }
            else if (options.RequireFullVerification)
                result = result with { Outcome = ReviewOutcome.VerificationUnavailable, Diagnostics = [new("VerificationUnavailable", "Full verification requires an explicitly supplied provider.")] };
            return result;
        }
        catch (UnsupportedReviewException ex) { return Failure(ReviewOutcome.UnsupportedVersionOrProfile, "UnsupportedVersionOrProfile", ex.Message, SchemaStatus.Unsupported); }
        catch (ResourceLimitException ex) { return Failure(ReviewOutcome.ResourceLimitExceeded, "ResourceLimitExceeded", ex.Message); }
        catch (PackageFormatException ex)
        {
            if (ex.Code == "UnsupportedVersionOrProfile") return Failure(ReviewOutcome.UnsupportedVersionOrProfile, ex.Code, ex.Message, SchemaStatus.Unsupported);
            return Failure(ReviewOutcome.Malformed, ex.Code, ex.Message) with { ContainerStatus = result.ContainerStatus == ContainerStatus.NotChecked ? ContainerStatus.Malformed : result.ContainerStatus };
        }
        catch (Exception ex) when (ex is JsonException or FormatException or DecoderFallbackException or EncoderFallbackException or InvalidOperationException or ArgumentException or EngineException or OverflowException)
        { return Failure(ReviewOutcome.Malformed, "MalformedReview", ex.Message, SchemaStatus.Malformed); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { return Failure(ReviewOutcome.EnvironmentFailure, "EnvironmentFailure", ex.Message); }

        ReviewExtractionResult Failure(ReviewOutcome outcome, string code, string message, SchemaStatus? schema = null) =>
            result with { Outcome = outcome, SchemaStatus = schema ?? result.SchemaStatus, Diagnostics = [new(code, message)] };
    }
}
