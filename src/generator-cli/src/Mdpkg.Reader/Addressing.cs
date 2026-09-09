using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Reader;

public sealed record HeadingPart(string Source, int Occurrence);
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
    public string Encode()
    {
        var json = ToJson(); FromJson(json);
        return Convert.ToBase64String(CanonicalJson.Bytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    public string DefaultRoot(string packageNamespace) => Inventory.Root(packageNamespace, ToJson());
}

public sealed record SourceScope(DocumentLocator Locator, string Root, string Digest, string CanonicalSource, int DocumentStart);
public enum IdentityStatus { NotResolved, Survives, FlaggedChanged, Unconfirmed, Invalidated }
public sealed record IdentityResolution(IdentityStatus Status, string Reason, SourceScope? Scope = null, IReadOnlyList<string>? Successors = null);

/// <summary>Caller-selected current view. Owns bounded payload data and requires no live stream or Git process.</summary>
public sealed class PackageSnapshot
{
    private readonly Dictionary<string, byte[]> documents;
    private readonly Ledger ledger;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, IReadOnlyList<SourceScope>> scopes = new(StringComparer.Ordinal);
    public PackageIdentity Identity { get; }
    public AddressingProfile Addressing { get; }
    public string PackageDigest { get; }
    public long PackageBytes { get; }
    public bool IsReviewPackage { get; }
    public IReadOnlyList<string> DocumentPaths { get; }

    private PackageSnapshot(PackageArchive archive, Dictionary<string, byte[]> documents, Ledger ledger, string digest)
    {
        Identity = archive.Identity; Addressing = archive.Addressing; PackageDigest = digest; PackageBytes = archive.PackageBytes;
        IsReviewPackage = archive.Review is not null;
        this.documents = documents; this.ledger = ledger;
        DocumentPaths = Array.AsReadOnly(documents.Keys.ToArray());
    }
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
    public IReadOnlyList<SourceScope> GetScopes(string documentPath, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!documents.TryGetValue(documentPath, out var bytes)) return [];
        return scopes.GetOrAdd(documentPath, _ => Array.AsReadOnly(Inventory.Document(bytes, documentPath, Identity.Namespace, cancellationToken).Select(e =>
            new SourceScope(DocumentLocator.FromJson(e.Locator), e.Root, e.Digest, e.Source, e.SourceStart)).ToArray()));
    }
    public IdentityResolution Resolve(PackageIdentity reviewed, string root, string expect, DocumentLocator declared, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (reviewed.Namespace != Identity.Namespace) return new(IdentityStatus.Invalidated, "wrong-lineage");
        if (!Profile.Root(root) || !Profile.Root(expect) || !Profile.Oid(reviewed.Current)) return new(IdentityStatus.Invalidated, "malformed-anchor");
        if (Addressing.Coverage == "partial" && reviewed.Current != Identity.Current) return new(IdentityStatus.Unconfirmed, "history-required");
        ledger.Entries.TryGetValue(root, out var record);
        if (record?.Dead is { } dead) return new(IdentityStatus.FlaggedChanged, dead, Successors: Array.AsReadOnly(record.Next?.ToArray() ?? []));
        if (record?.Unknown is { } unknown) return new(IdentityStatus.Unconfirmed, unknown);
        if (record is null && root != declared.DefaultRoot(reviewed.Namespace)) return new(IdentityStatus.Unconfirmed, "missing-override");
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
