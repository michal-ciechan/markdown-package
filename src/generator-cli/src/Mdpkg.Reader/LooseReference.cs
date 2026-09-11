using System.Globalization;
using System.Text.RegularExpressions;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal;

namespace Mdpkg.Reader;

/// <summary>A loose URI result, keeping navigation, identity and application capability distinct.</summary>
/// <param name="Category">navigation, identity, or capability. Navigation makes no historical identity claim.</param>
/// <param name="Status">The identity disposition, unsupported for capability, or null for navigation.</param>
/// <param name="Reason">Machine-readable explanation.</param>
/// <param name="Scope">Established current scope, if available.</param>
/// <param name="Successors">Explicit retirement successor roots; these are not locators.</param>
public sealed record LooseReferenceResolution(string Category, string? Status, string Reason,
    SourceScope? Scope = null, IReadOnlyList<string>? Successors = null);

public sealed partial class PackageSnapshot
{
    /// <summary>Parses a strict v2 URI and resolves it without inventing an observation checkpoint.</summary>
    /// <param name="reference">An mdpkg URI. Omitted expect means locator-only navigation.</param>
    /// <param name="cancellationToken">Cancellation is propagated to the caller.</param>
    /// <returns>Current navigation, conservative identity evidence, or historical capability failure.</returns>
    /// <remarks>Partial correspondence always yields incomplete-correspondence for loose identity links,
    /// even when at names the current commit. Existing review resolution is unaffected.</remarks>
    public LooseReferenceResolution ResolveReference(string reference, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        LooseUri uri;
        try { uri = LooseUri.Parse(reference); }
        catch (Exception ex) when (ex is FormatException or System.Text.Json.JsonException or ArgumentException or EngineException or InvalidOperationException or OverflowException)
        { return new("identity", "invalidated", "malformed-reference"); }
        if (uri.Namespace != Identity.Namespace) return new("identity", "invalidated", "wrong-lineage");
        if (uri.Locator is null || (uri.At is not null && uri.At != Identity.Current))
            return new("capability", "unsupported", "history-reader-required");
        if (uri.Expect is null)
        {
            var scope = GetScopes(uri.Locator.DocumentPath, cancellationToken).FirstOrDefault(s => s.Locator.Encode() == uri.Locator.Encode());
            return new("navigation", null, scope is null ? "target-not-found" : "current-location", scope);
        }
        if (Addressing.Coverage == "partial") return new("identity", "unconfirmed", "incomplete-correspondence");
        var result = ResolveCurrent(uri.Root, uri.Expect, uri.Locator, cancellationToken);
        var status = result.Status switch {
            IdentityStatus.Survives => "survives", IdentityStatus.FlaggedChanged => "flagged-changed",
            IdentityStatus.Unconfirmed => "unconfirmed", _ => "invalidated" };
        return new("identity", status, result.Reason, result.Scope, result.Successors);
    }
}

internal sealed record LooseUri(string Namespace, string Root, DocumentLocator? Locator, string? Expect, string? At)
{
    private static bool Match(string value, string pattern) => Regex.IsMatch(value, pattern, RegexOptions.CultureInvariant);
    private static bool Oid(string value) => Match(value, @"\A(?:sha1-[a-f0-9]{40}|sha256-[a-f0-9]{64})\z");
    internal static LooseUri Parse(string value)
    {
        static void Require(bool valid) { if (!valid) throw new FormatException("Malformed reference."); }
        Require(value is not null && value.Length <= 128 * 1024);
        Require(!Match(value!, @"[\s\x00-\x1f\x7f]|%(?![a-fA-F0-9]{2})"));
        var m = Regex.Match(value!, @"^mdpkg://([^/?#]+)/v2/(document|section|commit|diff|hunk)/([^/?#]+)(?:\?([^#]+))?$", RegexOptions.CultureInvariant);
        Require(m.Success);
        var ns = m.Groups[1].Value; var kind = m.Groups[2].Value; var id = m.Groups[3].Value;
        Require(Match(ns, @"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"));
        var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in m.Groups[4].Value.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0].Replace('+', ' '));
            var val = Uri.UnescapeDataString((pair.Length == 2 ? pair[1] : "").Replace('+', ' '));
            Require(parameters.TryAdd(key, val));
        }
        string Get(string key) => parameters.GetValueOrDefault(key, "");
        string[] allowed = kind is "document" or "section" ? ["anchor", "profile", "expect", "loc", "at"] :
            kind == "commit" ? [] : kind == "diff" ? ["document", "profile"] : ["document", "profile", "patch", "ordinal"];
        Require(parameters.Keys.All(allowed.Contains));
        if (kind is "document" or "section")
        {
            Require(Profile.Root(id) && (!parameters.ContainsKey("expect") || Profile.Root(Get("expect"))));
            Require(Get("anchor") == Profile.Anchor && Get("profile") == Profile.Digest);
            Require(!parameters.ContainsKey("at") || Oid(Get("at")));
            var locator = DocumentLocator.Decode(Get("loc"));
            Require((kind == "document") == (locator.Kind == "document"));
            Require(locator.HeadingTrail.Count <= 6 && locator.HeadingTrail.All(h => !h.Source.Contains('\r')));
            return new(ns, id, locator, parameters.GetValueOrDefault("expect"), parameters.GetValueOrDefault("at"));
        }
        if (kind == "commit") Require(Oid(id));
        else
        {
            var endpoints = id.Split("..", StringSplitOptions.None);
            Require(endpoints.Length == 2 && endpoints.All(Oid) && Profile.Root(Get("document")) && Get("profile") == "git-myers-u3-v1");
            if (kind == "hunk") Require(Profile.Root(Get("patch")) && Match(Get("ordinal"), @"^(0|[1-9][0-9]*)$") &&
                long.TryParse(Get("ordinal"), NumberStyles.None, CultureInfo.InvariantCulture, out var ordinal) && ordinal <= 9007199254740991);
        }
        return new(ns, id, null, null, null);
    }
}
