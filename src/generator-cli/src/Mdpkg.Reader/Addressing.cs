using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Reader;

/// <summary>One heading in a section locator trail.</summary>
/// <param name="Source">Exact normalized heading source including Markdown markup.</param>
/// <param name="Occurrence">Zero-based occurrence among siblings with identical source and parent trail.</param>
public sealed record HeadingPart(string Source, int Occurrence);
/// <summary>A document, preamble or section address in the current Markdown view.</summary>
/// <param name="Kind">Scope kind: document, preamble or section.</param>
/// <param name="DocumentPath">Package-relative document entry path.</param>
/// <param name="HeadingTrail">Ancestor headings followed by the section heading; empty for document and preamble scopes.</param>
public sealed record DocumentLocator(string Kind, string DocumentPath, IReadOnlyList<HeadingPart> HeadingTrail)
{
    internal JsonArray ToJson() => new(Kind, DocumentPath, new JsonArray(HeadingTrail.Select(h => (JsonNode)new JsonArray(h.Source, h.Occurrence)).ToArray()));
    internal static DocumentLocator FromJson(JsonArray locator)
    {
        LedgerReader.ValidateRecord(new string('0', 64), new(To: locator));
        var path = locator[1]!.GetValue<string>();
        var folded = CaseFold.Key(path);
        if (folded.StartsWith(".mdpkg/", StringComparison.Ordinal) || folded.StartsWith(".git/", StringComparison.Ordinal))
            throw new FormatException("Review locators cannot name reserved entries.");
        return new(locator[0]!.GetValue<string>(), path, Array.AsReadOnly(locator[2]!.AsArray().Select(p =>
            new HeadingPart(p![0]!.GetValue<string>(), p[1]!.GetValue<int>())).ToArray()));
    }
    /// <summary>Decodes and validates a canonical unpadded base64url locator.</summary>
    /// <param name="encoded">Base64url-encoded canonical locator JSON including its final LF.</param>
    /// <returns>The decoded document, preamble or section locator.</returns>
    /// <exception cref="FormatException">The encoding or locator shape is invalid.</exception>
    /// <exception cref="System.Text.Json.JsonException">The locator JSON is invalid.</exception>
    public static DocumentLocator Decode(string encoded)
    {
        if (string.IsNullOrEmpty(encoded) || encoded.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            throw new FormatException("Locator must be unpadded base64url.");
        var bytes = Convert.FromBase64String(encoded.Replace('-', '+').Replace('_', '/') + new string('=', (4 - encoded.Length % 4) % 4));
        if (CanonicalJson.Parse(bytes) is not JsonArray array || !bytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(array)))
            throw new FormatException("Locator must contain canonical JSON.");
        var locator = FromJson(array);
        if (locator.Encode() != encoded) throw new FormatException("Noncanonical locator encoding.");
        return locator;
    }
    /// <summary>Validates and encodes this locator as canonical unpadded base64url.</summary>
    /// <returns>Base64url of canonical locator JSON including its final LF.</returns>
    public string Encode()
    {
        var json = ToJson(); FromJson(json);
        return Convert.ToBase64String(CanonicalJson.Bytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    /// <summary>Computes the default anchor root from a namespace and this locator.</summary>
    /// <param name="packageNamespace">Package namespace UUID.</param>
    /// <returns>The lowercase default root hash; ledger overrides are not consulted.</returns>
    public string DefaultRoot(string packageNamespace) => Inventory.Root(packageNamespace, ToJson());
}

/// <summary>Canonical source and default identity for one current-view scope.</summary>
/// <param name="Locator">Address of the scope.</param>
/// <param name="Root">Default root hash derived from the namespace and locator.</param>
/// <param name="Digest">Canonical source digest.</param>
/// <param name="CanonicalSource">Canonical LF source used by digests and quote selectors.</param>
/// <param name="DocumentStart">Zero-based UTF-16 start offset in the LF-normalized document.</param>
public sealed record SourceScope(DocumentLocator Locator, string Root, string Digest, string CanonicalSource, int DocumentStart);
/// <summary>Current-view evidence for an anchored source identity.</summary>
public enum IdentityStatus
{
    /// <summary>Identity resolution has not run.</summary>
    NotResolved,
    /// <summary>The identity is live and its source digest matches.</summary>
    Survives,
    /// <summary>The source changed or the ledger records a dead identity.</summary>
    FlaggedChanged,
    /// <summary>Available correspondence cannot establish the identity.</summary>
    Unconfirmed,
    /// <summary>The anchor or its lineage is invalid.</summary>
    Invalidated,
}
/// <summary>Ledger-first identity resolution against the current view.</summary>
/// <param name="Status">Strength of the available identity evidence.</param>
/// <param name="Reason">Machine-readable explanation.</param>
/// <param name="Scope">Live source scope, when available.</param>
/// <param name="Successors">Successor roots for navigation from a dead identity, when present.</param>
public sealed record IdentityResolution(IdentityStatus Status, string Reason, SourceScope? Scope = null, IReadOnlyList<string>? Successors = null);

/// <summary>Caller-selected current view. Owns bounded payload data and requires no live stream or Git process.</summary>
public sealed partial class PackageSnapshot
{
    private readonly Dictionary<string, byte[]> documents;
    private readonly Ledger ledger;
    private readonly bool hasDeclaredOrigin;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, IReadOnlyList<SourceScope>> scopes = new(StringComparer.Ordinal);
    /// <summary>Selected snapshot namespace and current commit.</summary>
    public PackageIdentity Identity { get; }
    /// <summary>Snapshot addressing profiles and correspondence coverage.</summary>
    public AddressingProfile Addressing { get; }
    /// <summary>SHA-256 digest of package bytes with a sha256- prefix.</summary>
    public string PackageDigest { get; }
    /// <summary>Length of the source package in bytes.</summary>
    public long PackageBytes { get; }
    /// <summary>Whether the manifest declares review data; does not imply full verification.</summary>
    public bool IsReviewPackage { get; }
    /// <summary>Package-relative paths of loaded Markdown documents.</summary>
    public IReadOnlyList<string> DocumentPaths { get; }

    private PackageSnapshot(PackageArchive archive, Dictionary<string, byte[]> documents, Ledger ledger, string digest)
    {
        Identity = archive.Identity; Addressing = archive.Addressing; PackageDigest = digest; PackageBytes = archive.PackageBytes;
        IsReviewPackage = archive.Review is not null;
        hasDeclaredOrigin = archive.History?.Origin is not null;
        this.documents = documents; this.ledger = ledger;
        DocumentPaths = Array.AsReadOnly(documents.Keys.ToArray());
    }
    /// <summary>Loads the bounded current Markdown view and ledger and hashes the package bytes.</summary>
    /// <param name="input">Readable stream starting at the package; remains caller-owned.</param>
    /// <param name="limits">Resource budgets, or null to use the standard defaults.</param>
    /// <param name="cancellationToken">Token used to cancel the operation; cancellation is propagated to the caller.</param>
    /// <returns>An owned snapshot usable after the input is disposed.</returns>
    /// <remarks>Uses strict container acceptance. Validates current ledger targets but does not materialize historical Git trees or establish full Git/review-lineage verification.</remarks>
    /// <exception cref="PackageFormatException">Package data, Markdown encoding or ledger targets are invalid.</exception>
    /// <exception cref="ResourceLimitException">A configured budget is exceeded.</exception>
    /// <exception cref="OperationCanceledException">Cancellation was requested.</exception>
    public static async Task<PackageSnapshot> ReadAsync(Stream input, ReadLimits? limits = null, CancellationToken cancellationToken = default)
    {
        using var archive = await PackageArchive.OpenAsync(input, limits, cancellationToken: cancellationToken);
        var docs = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries.Where(e => !e.Name.StartsWith(".git/", StringComparison.Ordinal) && !e.Name.StartsWith(".mdpkg/", StringComparison.Ordinal) &&
            (e.Name.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || e.Name.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase))))
        {
            var bytes = archive.ReadEntry(entry.Name, cancellationToken: cancellationToken);
            try { Profile.Utf8.GetCharCount(bytes); }
            catch (System.Text.DecoderFallbackException) { throw new PackageFormatException("MDPK4003", "Document is not UTF-8.", entry.Name); }
            if (bytes.Contains((byte)'\r')) throw new PackageFormatException("MDPK1004", "Package document contains CR bytes.", entry.Name);
            docs.Add(entry.Name, bytes);
        }
        var ledger = new Ledger(1, Profile.Anchor, new(StringComparer.Ordinal));
        if (archive.Addressing.Overrides is { } path)
        {
            try
            {
                var bytes = archive.ReadEntry(path, archive.Limits.MaxManifestBytes, cancellationToken);
                archive.ReadCanonicalJson(bytes, false, cancellationToken);
                ledger = LedgerReader.Read(bytes, Outcome.Nonconforming);
                if (ledger.Entries.Count == 0) throw new PackageFormatException("MDPK2002", "Empty ledger must be absent.");
                var targets = new HashSet<string>(StringComparer.Ordinal);
                foreach (var record in ledger.Entries.Values)
                    if (record.To is { } to && !targets.Add(CanonicalJson.Text(to))) throw new PackageFormatException("MDPK2002", "Multiple roots own a live locator.");
                if (archive.Addressing.Coverage == "complete" && ledger.Entries.Values.Any(r => r.Unknown is not null))
                    throw new PackageFormatException("MDPK2007", "Complete coverage contradicts an unknown ledger record.");
            }
            catch (EngineException ex) { throw new PackageFormatException(ex.Code, ex.Message, ex.Entry); }
            catch (System.Text.Json.JsonException ex) { throw new PackageFormatException("MDPK2002", ex.Message); }
        }
        var snapshot = new PackageSnapshot(archive, docs, ledger, await archive.ComputeDigestAsync(cancellationToken));
        try
        {
            foreach (var record in ledger.Entries.Values.Where(r => r.To is not null))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var locator = DocumentLocator.FromJson(record.To!);
                if (!snapshot.GetScopes(locator.DocumentPath, cancellationToken).Any(s => s.Locator.Encode() == locator.Encode()))
                    throw new PackageFormatException("MDPK2002", "Ledger target is absent from the current inventory.");
            }
        }
        catch (Exception ex) when (ex is FormatException or System.Text.Json.JsonException or EngineException)
        { throw new PackageFormatException("MDPK2002", ex.Message); }
        return snapshot;
    }
    /// <summary>Inventories and caches canonical document, preamble and section scopes.</summary>
    /// <param name="documentPath">Case-sensitive package-relative Markdown document path.</param>
    /// <param name="cancellationToken">Token used to cancel the operation; cancellation is propagated to the caller.</param>
    /// <returns>Scopes in inventory order, or an empty list when the document is absent.</returns>
    public IReadOnlyList<SourceScope> GetScopes(string documentPath, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!documents.TryGetValue(documentPath, out var bytes)) return [];
        return scopes.GetOrAdd(documentPath, _ => Array.AsReadOnly(Inventory.Document(bytes, documentPath, Identity.Namespace, cancellationToken).Select(e =>
            new SourceScope(DocumentLocator.FromJson(e.Locator), e.Root, e.Digest, e.Source, e.SourceStart)).ToArray()));
    }
    /// <summary>Resolves an anchor through current ledger identity before comparing source digests.</summary>
    /// <param name="reviewed">Original reviewed package identity.</param>
    /// <param name="root">Persistent anchor root hash.</param>
    /// <param name="expect">Expected canonical source digest at review time.</param>
    /// <param name="declared">Original declared scope locator.</param>
    /// <param name="cancellationToken">Token used to cancel the operation; cancellation is propagated to the caller.</param>
    /// <returns>Identity evidence with any live scope and dead-identity successor navigation.</returns>
    /// <remarks>A different checkpoint requires relationship evidence unavailable to this current-view reader. This method does not resolve quote selectors or search successor scopes.</remarks>
    public IdentityResolution Resolve(PackageIdentity reviewed, string root, string expect, DocumentLocator declared, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (reviewed.Namespace != Identity.Namespace) return new(IdentityStatus.Invalidated, "wrong-lineage");
        if (!Profile.Root(root) || !Profile.Root(expect) || !Profile.State(reviewed.Current)) return new(IdentityStatus.Invalidated, "malformed-anchor");
        if (reviewed.Current != Identity.Current)
        {
            if (Identity.Current.Kind == "snapshot") return new(IdentityStatus.Unconfirmed, "history-unavailable");
            if (reviewed.Current.Kind == "snapshot") return new(IdentityStatus.Unconfirmed, hasDeclaredOrigin ? "origin-unverified" : "origin-unavailable");
            return new(IdentityStatus.Unconfirmed, "history-required");
        }
        return ResolveCurrent(root, expect, declared, cancellationToken);
    }

    private IdentityResolution ResolveCurrent(string root, string expect, DocumentLocator declared, CancellationToken cancellationToken)
    {
        ledger.Entries.TryGetValue(root, out var record);
        if (record?.Dead is { } dead) return new(IdentityStatus.FlaggedChanged, dead, Successors: Array.AsReadOnly(record.Next?.ToArray() ?? []));
        if (record?.Unknown is { } unknown) return new(IdentityStatus.Unconfirmed, unknown);
        if (record is null && root != declared.DefaultRoot(Identity.Namespace)) return new(IdentityStatus.Unconfirmed, "missing-override");
        var locator = record?.To is { } to ? DocumentLocator.FromJson(to) : declared;
        if (locator.Kind != declared.Kind) return new(IdentityStatus.Invalidated, "ledger-scope-kind-mismatch");
        var scope = GetScopes(locator.DocumentPath, cancellationToken).FirstOrDefault(s => s.Locator.Encode() == locator.Encode());
        if (scope is null) return new(IdentityStatus.Unconfirmed, "possibly-renamed-moved-or-deleted");
        // A default slot owned by a different root is not evidence for a new birth.
        if (record is null && ledger.Entries.Any(r => r.Value.To is { } target && CanonicalJson.Text(target) == CanonicalJson.Text(locator.ToJson())))
            return new(IdentityStatus.Unconfirmed, "reserved-slot");
        return new(scope.Digest == expect ? IdentityStatus.Survives : IdentityStatus.FlaggedChanged,
            scope.Digest == expect ? "same-source" : "source-changed", scope);
    }
}
