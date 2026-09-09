using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Reviews;

internal sealed class UnsupportedReviewException(string message) : Exception(message);
internal static partial class ReviewParser
{
    internal static string Text(JsonNode? node, string field) => node?[field]?.GetValue<string>() ?? throw new JsonException("Missing string: " + field);
    private static int Integer(JsonNode node, string field) => node[field]?.GetValue<int>() ?? throw new JsonException("Missing integer: " + field);
    private static void Require(bool valid, string message) { if (!valid) throw new JsonException(message); }
    internal static bool Uuid(string s) => Guid.TryParseExact(s, "D", out _) && s == s.ToLowerInvariant();
    private static IReadOnlyDictionary<string, JsonElement> Extensions(JsonObject node, JsonSerializerOptions jsonOptions, params string[] known) =>
        new ReadOnlyDictionary<string, JsonElement>(node.Where(p => !known.Contains(p.Key, StringComparer.Ordinal))
            .ToDictionary(p => p.Key, p => JsonSerializer.SerializeToElement(p.Value, jsonOptions).Clone(), StringComparer.Ordinal));

    internal static (ReviewShape Shape, ReviewedIdentity Of) Declaration(JsonElement declaration, PackageIdentity identity)
    {
        var node = JsonNode.Parse(declaration.GetRawText())!.AsObject();
        var detail = Text(node, "detail");
        if (detail != ".mdpkg/review/comments.json") throw new UnsupportedReviewException("Unsupported review detail path: " + detail);
        var shape = Text(node, "shape") switch { "delta" => ReviewShape.Delta, "bundled" => ReviewShape.Bundled, _ => throw new UnsupportedReviewException("Unknown review shape.") };
        var of = node["of"]?.AsObject() ?? throw new JsonException("Missing review.of.");
        var ns = Text(of, "namespace"); var current = Text(of, "current");
        Require(Uuid(ns) && Profile.Oid(current), "Malformed reviewed identity.");
        Require((shape == ReviewShape.Bundled) == (ns == identity.Namespace), "Review shape and namespace disagree.");
        var digest = of["packageDigest"]?.GetValue<string>();
        foreach (var optional in new[] { "packageDigest", "packageBytes", "dispatch" })
            Require(!of.ContainsKey(optional) || of[optional] is not null, "Optional correlation fields must be omitted rather than null.");
        Require(digest is null || digest.StartsWith("sha256-", StringComparison.Ordinal) && Profile.Root(digest[7..]), "Malformed corroborating digest.");
        var bytes = of["packageBytes"]?.GetValue<long>(); Require(bytes is null or >= 0, "Negative package length.");
        var dispatch = of["dispatch"]?.GetValue<string>();
        return (shape, new(new(ns, current), digest, bytes, dispatch));
    }

    internal static (int Version, IReadOnlyList<ReviewThread> Threads, IReadOnlyDictionary<string, JsonElement> Extensions) Document(
        JsonNode? value, PackageIdentity reviewed, ReviewReadOptions options, CancellationToken ct)
    {
        if (value is not JsonObject doc) throw new JsonException("Comments document root must be a JSON object.");
        var jsonOptions = new JsonSerializerOptions { MaxDepth = options.Limits.MaxJsonDepth };
        var version = Integer(doc, "version");
        if (version is not (1 or 2)) throw new UnsupportedReviewException("Unsupported comments-document version: " + version);
        if (Text(doc, "anchor") != PackageProfiles.Anchor || Text(doc, "profile") != PackageProfiles.Digest || Text(doc, "selector") != PackageProfiles.Selector)
            throw new UnsupportedReviewException("Unsupported review anchor, digest or selector profile.");
        var threads = doc["threads"]?.AsArray() ?? throw new JsonException("Missing threads array.");
        if (threads.Count > options.MaxThreads) throw new ResourceLimitException("Review thread limit exceeded.");
        var ids = new HashSet<string>(StringComparer.Ordinal); var parsed = new List<ReviewThread>(); var commentCount = 0;
        void Id(string id) { Require(Uuid(id), "IDs must be lowercase UUIDs."); Require(ids.Add(id), "Duplicate thread/comment ID: " + id); }
        foreach (var item in threads)
        {
            ct.ThrowIfCancellationRequested();
            var thread = item?.AsObject() ?? throw new JsonException("Expected thread object.");
            var id = Text(thread, "id"); Id(id);
            var root = Text(thread, "root"); var expect = Text(thread, "expect");
            Require(Profile.Root(root) && Profile.Root(expect), "Malformed anchor root/digest.");
            var rawLoc = Text(thread, "loc"); var loc = DocumentLocator.Decode(rawLoc);
            var state = Text(thread, "state") switch { "open" => ThreadState.Open, "resolved" => ThreadState.Resolved, "obsolete" => ThreadState.Obsolete,
                _ => throw new UnsupportedReviewException("Unknown thread state.") };
            var select = thread["select"]?.AsObject() ?? throw new JsonException("A thread requires an explicit selector.");
            var selector = new QuoteSelector(Integer(select, "start"), Integer(select, "end"), Text(select, "quote"), Integer(select, "occurrence"), Text(select, "prefix"), Text(select, "suffix"),
                Extensions(select, jsonOptions, "start", "end", "quote", "occurrence", "prefix", "suffix"));
            Require(selector.Start >= 0 && selector.End > selector.Start && selector.Occurrence >= 0 && selector.Quote.Length > 0 &&
                selector.Quote.Length == (long)selector.End - selector.Start && selector.Prefix.Length <= 40 && selector.Suffix.Length <= 40,
                "Invalid UTF-16 selector shape or lengths.");
            foreach (var text in new[] { selector.Quote, selector.Prefix, selector.Suffix }) Profile.Utf8.GetByteCount(text);
            var comments = thread["comments"]?.AsArray() ?? throw new JsonException("Missing comments array.");
            Require(version == 1 || comments.Count > 0, "Version 2 threads require comments.");
            commentCount += comments.Count;
            if (commentCount > options.MaxComments) throw new ResourceLimitException("Review comment limit exceeded.");
            var rows = new List<ReviewComment>();
            foreach (var commentNode in comments)
            {
                ct.ThrowIfCancellationRequested();
                var comment = commentNode?.AsObject() ?? throw new JsonException("Expected comment object.");
                var commentId = Text(comment, "id"); Id(commentId);
                var at = Text(comment, "at"); Require(Timestamp(at), "Timestamp must be RFC 3339 with an explicit offset.");
                var author = Text(comment, "author"); var body = Text(comment, "body");
                Require(version == 1 || body.Length > 0, "Version 2 comment bodies must be nonempty.");
                if (Profile.Utf8.GetByteCount(body) > options.MaxBodyBytes) throw new ResourceLimitException("Comment body byte limit exceeded.");
                CommentKind kind;
                if (version == 1)
                {
                    if (comment.ContainsKey("kind")) throw new UnsupportedReviewException("Version 1 cannot declare authored kind; use version 2.");
                    kind = CommentKind.Unspecified;
                }
                else kind = Text(comment, "kind") switch { "comment" => CommentKind.Comment, "change-request" => CommentKind.ChangeRequest,
                    _ => throw new UnsupportedReviewException("Unknown comment kind.") };
                var reply = comment["inReplyTo"]?.GetValue<string>();
                Require(!comment.ContainsKey("inReplyTo") || reply is not null, "inReplyTo must be omitted rather than null.");
                rows.Add(new(commentId, at, author, body, reply, kind, version == 1 ? KindSource.LegacyV1 : KindSource.AuthoredV2,
                    Extensions(comment, jsonOptions, "id", "at", "author", "body", "inReplyTo", "kind")));
            }
            var siblings = rows.ToDictionary(c => c.Id, StringComparer.Ordinal);
            foreach (var row in rows)
                Require(row.InReplyTo is null || row.InReplyTo != row.Id && siblings.ContainsKey(row.InReplyTo), "Reply must name a different comment in the same thread.");
            // Linear graph walk with memoized completed paths, so adversarial long chains are bounded.
            var complete = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in rows)
            {
                ct.ThrowIfCancellationRequested();
                var path = new HashSet<string>(StringComparer.Ordinal); string? current = row.Id;
                while (current is not null && !complete.Contains(current))
                {
                    ct.ThrowIfCancellationRequested(); Require(path.Add(current), "Cyclic reply graph.");
                    current = siblings[current].InReplyTo;
                }
                complete.UnionWith(path);
            }
            parsed.Add(new(id, state, new(reviewed, root, expect, loc, rawLoc, selector), Array.AsReadOnly(rows.ToArray()),
                Extensions(thread, jsonOptions, "id", "root", "loc", "expect", "state", "select", "comments")));
        }
        return (version, Array.AsReadOnly(parsed.ToArray()), Extensions(doc, jsonOptions, "version", "anchor", "profile", "selector", "threads"));
    }

    private static bool Timestamp(string text)
    {
        if (text.Length > 128 || !TimestampPattern().IsMatch(text)) return false;
        var date = text[..10];
        return DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    }
    [GeneratedRegex(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking)]
    private static partial Regex TimestampPattern();
}
