using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Container;
namespace Mdpkg.Reader.Internal.Format;
internal static class FormatValidation
{
    private static void Reject(bool invalid, string message, string code = "MDPK2007")
    { if (invalid) throw new EngineException(Outcome.Nonconforming, code, message); }
    internal static void ValidateManifest(Manifest m, string? expectedNamespace)
    {
        Reject(m.Mdpkg != Profile.Magic || !Guid.TryParseExact(m.Namespace, "D", out _) || m.Namespace != m.Namespace.ToLowerInvariant(), "Unsupported manifest version or namespace.");
        Reject(expectedNamespace is not null && expectedNamespace != m.Namespace, "Supplied namespace differs from package.");
        Reject(!Profile.State(m.Current), "Malformed current state.");
        Reject(m.Addressing.Anchor != Profile.Anchor || m.Addressing.Digest != Profile.Digest || m.Addressing.Coverage is not ("complete" or "partial"), "Unknown addressing profile or coverage.");
        Reject(m.Addressing.Overrides is not null && m.Addressing.Overrides != Profile.Ledger, "Unsupported ledger path.", "MDPK2002");
        Reject((m.Current.Kind == "snapshot") != (m.History is SnapshotHistory), "Current state and history mode disagree.");
        if (m.History is GitHistory git)
            Reject(git.Coverage is not ("complete" or "truncated" or "unknown") || git.Detail != Profile.History || git.Transform.Any(t => t is not ("projected" or "squashed")), "Invalid history declaration.");
        else Reject(m.Addressing.Coverage != "complete", "Snapshots require complete correspondence.");
        if (m.Review is { } r)
        {
            var of = r["of"]?.AsObject() ?? throw new JsonException("Missing review.of.");
            var ns = of["namespace"]?.GetValue<string>();
            var shape = r["shape"]?.GetValue<string>();
            Keys(r, ["detail", "of", "shape"]);
            Keys(of, ["current", "namespace"], ["packageDigest", "packageBytes", "dispatch"]);
            var current = of["current"]?.Deserialize<CurrentState>(CanonicalJson.Options);
            Reject(!Guid.TryParseExact(ns, "D", out _) || ns != ns.ToLowerInvariant() || !Profile.State(current) ||
                shape is not ("delta" or "bundled") || r["detail"]?.GetValue<string>() != ".mdpkg/review/comments.json", "Malformed review declaration.");
            Reject((shape == "bundled") != (ns == m.Namespace), "Review namespace disagrees with its shape.");
            Reject(shape == "bundled" && m.History is SnapshotHistory, "Bundled reviews require Git history.");
            foreach (var optional in new[] { "packageDigest", "packageBytes", "dispatch" })
                Reject(of.ContainsKey(optional) && of[optional] is null, "Null review evidence field.");
            if (of["packageDigest"] is { } digest) Reject(!digest.GetValue<string>().StartsWith("sha256-", StringComparison.Ordinal) || !Profile.Root(digest.GetValue<string>()[7..]), "Malformed package digest.");
            if (of["packageBytes"] is { } bytes) Reject(bytes.GetValue<long>() < 0, "Negative package length.");
            if (of["dispatch"] is { } dispatch) _ = dispatch.GetValue<string>();
        }
    }
    private static void Keys(JsonObject obj, string[] required, string[]? optional = null)
    {
        Reject(required.Any(k => !obj.ContainsKey(k)) || obj.Any(p => !required.Contains(p.Key) && !(optional ?? []).Contains(p.Key)), "Unexpected or missing schema field.");
    }
    internal static Manifest ReadManifest(JsonNode node)
    {
        var obj = node.AsObject();
        Keys(obj, ["mdpkg", "namespace", "current", "addressing", "history"], ["review"]);
        Keys(obj["current"]?.AsObject() ?? throw new JsonException("Missing current state."), ["id", "kind"]);
        Keys(obj["addressing"]?.AsObject() ?? throw new JsonException("Missing addressing."), ["anchor", "coverage", "digest", "overrides"]);
        var history = obj["history"]?.AsObject() ?? throw new JsonException("Missing history mode.");
        switch (history["mode"]?.GetValue<string>())
        {
            case "none": Keys(history, ["mode"]); break;
            case "git": Keys(history, ["mode", "coverage", "detail", "transform"]); break;
            default: throw new JsonException("Unknown or missing history mode.");
        }
        Reject(obj.ContainsKey("review") && obj["review"] is null, "Review must be omitted rather than null.");
        return obj.Deserialize<Manifest>(CanonicalJson.Options) ?? throw new JsonException("Expected manifest.");
    }

    internal static HashSet<string> ValidateInventory(Manifest m, HistoryDetail? h, IEnumerable<(string Name, long Size)> inventory)
    {
        var rows = inventory.ToArray();
        var names = rows.Select(e => e.Name).ToHashSet(StringComparer.Ordinal);
        var controls = new HashSet<string>(StringComparer.Ordinal) { Profile.Manifest };
        if (m.History is GitHistory)
        {
            Reject(h is null, "Missing history descriptor.");
            controls.Add(Profile.History);
            foreach (var r in h!.Ranges) controls.Add(r);
            foreach (var p in h.Patches) controls.Add(p.Entry);
            if (h.Bindings is not null) controls.Add(h.Bindings);
            var packs = names.Where(n => n.StartsWith(".git/objects/pack/pack-", StringComparison.Ordinal) && n.EndsWith(".pack", StringComparison.Ordinal)).ToArray();
            Reject(packs.Length != 1, "Exactly one Git pack is required.", "MDPK4002");
            var stem = packs[0][..^5];
            Reject(!Profile.Oid("sha1-" + stem[".git/objects/pack/pack-".Length..]), "Invalid Git pack name.", "MDPK4002");
            var allowed = new HashSet<string>(StringComparer.Ordinal) { ".git/HEAD", ".git/config", ".git/refs/heads/main", ".git/shallow", stem + ".pack", stem + ".idx", stem + ".rev" };
            Reject(new[] { ".git/HEAD", ".git/config", ".git/refs/heads/main", stem + ".idx" }.Any(n => !names.Contains(n)), "Missing curated Git entry.", "MDPK4002");
            Reject(names.Any(n => n.StartsWith(".git/", StringComparison.Ordinal) && !n.EndsWith('/') && !allowed.Contains(n)), "Entry is not in the curated Git allowlist.", "MDPK4002");
        }
        foreach (var name in controls)
            Reject(!names.Contains(name), "Missing history control entry.", name.StartsWith(".mdpkg/history/patches/", StringComparison.Ordinal) ? "MDPK2006" : "MDPK2005");
        Reject((m.Addressing.Overrides is not null) != names.Contains(Profile.Ledger), "Manifest and ledger presence disagree.", "MDPK2002");
        Reject((m.Review is not null) != names.Contains(".mdpkg/review/comments.json"), "Manifest and review presence disagree.");
        foreach (var row in rows)
        {
            var name = row.Name;
            if (name.EndsWith('/'))
            {
                Reject(row.Size != 0, "Directory record contains data.", "MDPK1003");
                Reject(m.History is SnapshotHistory && (name == ".git/" || name.StartsWith(".git/", StringComparison.Ordinal)), "Snapshot contains a Git directory.");
                Reject(m.History is SnapshotHistory && name.StartsWith(".mdpkg/history", StringComparison.Ordinal), "Snapshot contains a history directory.");
                Reject(Sources.SourceRules.Reserved(name[..^1]) && !name.StartsWith(".git/", StringComparison.Ordinal) && !name.StartsWith(".mdpkg/", StringComparison.Ordinal), "Reserved directory alias.", "MDPK1002");
                continue;
            }
            if (name.StartsWith(".git/", StringComparison.Ordinal))
            {
                Reject(m.History is SnapshotHistory, "Snapshot contains Git entries.");
                continue;
            }
            Reject((Sources.SourceRules.Reserved(name) || name.StartsWith(".mdpkg/", StringComparison.Ordinal)) &&
                !controls.Contains(name) && name != m.Addressing.Overrides && name != m.Review?["detail"]?.GetValue<string>(), "Undeclared reserved entry.", "MDPK1002");
            Reject(m.Review?["shape"]?.GetValue<string>() == "delta" && !controls.Contains(name) && name != ".mdpkg/review/comments.json", "Delta review contains unrelated current files.");
        }
        return controls;
    }
    internal static HistoryDetail ReadHistory(JsonNode node)
    {
        var obj = node.AsObject();
        Reject(obj.ContainsKey("origin") && obj["origin"] is null, "Origin must be omitted rather than null.");
        return obj.Deserialize<HistoryDetail>(CanonicalJson.Options) ?? throw new JsonException("Expected history descriptor.");
    }
    internal static void ValidateHistory(Manifest m, HistoryDetail h)
    {
        var declaration = m.History as GitHistory ?? throw new JsonException("History requires Git mode.");
        Reject(h.Walk != "first-parent" || h.Root is not ("original" or "synthetic" or "materialized") || h.RetainedCommits < 1 || !Profile.Oid(h.SourceBase) || !Profile.Oid(h.SourceTip), "Malformed history descriptor.");
        Reject((h.Root == "materialized") != (h.Origin is not null), "Materialized root and origin disagree.");
        if (h.Origin is { } origin)
        {
            Keys(origin, ["profile", "snapshot", "commit", "header"]);
            var header = origin["header"]?.AsObject() ?? throw new JsonException("Missing origin header.");
            Keys(header, ["addressing", "namespace", "review"]);
            Reject(origin["profile"]?.GetValue<string>() != "mdpkg-bootstrap-v1" || !Profile.Oid(origin["commit"]?.GetValue<string>()) ||
                header["namespace"]?.GetValue<string>() != m.Namespace, "Malformed origin declaration.");
            var snapshot = new Manifest(Profile.Magic, m.Namespace, new("snapshot", origin["snapshot"]?.GetValue<string>() ?? throw new JsonException("Missing origin snapshot.")),
                header["addressing"]?.Deserialize<AddressingDeclaration>(CanonicalJson.Options) ?? throw new JsonException("Missing origin addressing."), new SnapshotHistory(), header["review"]?.AsObject());
            ValidateManifest(snapshot, m.Namespace);
        }
        Reject(h.Root == "synthetic" && declaration.Coverage != "truncated", "Synthetic roots require truncated coverage.");
        Reject(h.Transformations.Any(t => t is null || t.Kind is not ("projected" or "squashed") || !Profile.Oid(t.SourceBase) || !Profile.Oid(t.SourceTip) || !Profile.Oid(t.Emitted)) ||
            !declaration.Transform.SequenceEqual(h.Transformations.Select(t => t.Kind)), "Manifest/history transformations disagree.", "MDPK2003");
        Reject(h.ShallowBoundaries.Any(s => !Profile.Oid(s)) || h.ShallowBoundaries.Distinct().Count() != h.ShallowBoundaries.Length, "Invalid shallow boundaries.", "MDPK2004");
        Reject(h.AddressingCoverage.Length == 0 || h.AddressingCoverage.Any(r => r is null || !Profile.Oid(r.From) || !Profile.Oid(r.To) || r.Coverage is not ("complete" or "partial")), "Invalid addressing coverage ranges.");
        Reject(h.Ranges.Any(r => r is null) || h.Patches.Any(p => p is null), "Null history evidence item.");
        Reject(m.Addressing.Coverage == "complete" && (h.AddressingCoverage.Length != 1 || h.AddressingCoverage[0].Coverage != "complete" || h.AddressingCoverage[0].To != m.Current.Id), "Complete correspondence needs one range through current.");
        Reject(m.Addressing.Coverage == "partial" && h.AddressingCoverage.All(r => r.Coverage == "complete"), "Partial correspondence has no uncovered range.");
    }
    internal static void ValidateEvidence(Manifest m, HistoryDetail h, Dictionary<string, ZipMember> entries) => ValidateEvidence(m, h, entries, 64);
    internal static void ValidateEvidence(Manifest m, HistoryDetail h, Dictionary<string, ZipMember> entries, int maxDepth)
    {
        JsonNode NeedJson(string name, string code)
        {
            Reject(!entries.ContainsKey(name), "Missing evidence: " + name, code);
            var bytes = entries[name].Bytes; var node = CanonicalJson.Parse(bytes, maxDepth);
            Reject(!bytes.AsSpan().SequenceEqual(Profile.Utf8.GetBytes(CanonicalJson.Text(node))), "Evidence is not canonical JSON: " + name, code);
            return node;
        }
        Reject(h.Ranges.Distinct().Count() != h.Ranges.Length || h.Patches.Select(p => p.Entry).Distinct().Count() != h.Patches.Length, "Duplicate history evidence.");
        foreach (var name in h.Ranges)
        {
            Reject(!name.StartsWith(".mdpkg/history/ranges/", StringComparison.Ordinal) || !name.EndsWith(".json", StringComparison.Ordinal) || !entries.ContainsKey(name), "Invalid/absent summary.", "MDPK2005");
            var sum = NeedJson(name, "MDPK2005");
            Reject(name != ".mdpkg/history/ranges/" + Profile.Hash(entries[name].Bytes) + ".json", "Summary hash differs from its name.", "MDPK2005");
            Reject(sum["version"]?.GetValue<int>() != 1 || sum["namespace"]?.GetValue<string>() != m.Namespace || sum["anchor"]?.GetValue<string>() != Profile.Anchor ||
                sum["profile"]?.GetValue<string>() != Profile.Digest || sum["walk"]?.GetValue<string>() != "first-parent", "Summary profiles disagree.", "MDPK2005");
        }
        JsonArray? bindings = null;
        if (h.Bindings is not null)
        {
            Reject(h.Bindings != ".mdpkg/history/bindings.json", "Invalid bindings path.", "MDPK2005");
            var doc = NeedJson(h.Bindings, "MDPK2005");
            Reject(doc["version"]?.GetValue<int>() != 1, "Unknown bindings version.", "MDPK2005");
            bindings = doc["bindings"]?.AsArray() ?? throw new JsonException("Missing bindings array.");
            foreach (var b in bindings)
            {
                var name = b?["summary"]?.GetValue<string>();
                Reject(name is null || !h.Ranges.Contains(name) || !Profile.Oid(b?["emitted"]?.GetValue<string>()), "Binding names an absent summary or malformed commit.", "MDPK2005");
                Reject(b!["hash"]?.GetValue<string>() != Profile.Hash(entries[name!].Bytes), "Binding hash disagrees.", "MDPK2005");
            }
        }
        foreach (var t in h.Transformations.Where(t => t.Summary is not null))
            Reject(!h.Ranges.Contains(t.Summary!) || bindings is null || !bindings.Any(b => b?["summary"]?.GetValue<string>() == t.Summary && b?["emitted"]?.GetValue<string>() == t.Emitted), "Transformation has no matching summary binding.", "MDPK2005");
        foreach (var patch in h.Patches)
            Reject(!Profile.Root(patch.Sha256) || patch.Entry != ".mdpkg/history/patches/" + patch.Sha256 + ".patch" || !entries.TryGetValue(patch.Entry, out var entry) || Profile.Hash(entry.Bytes) != patch.Sha256 ||
                !Profile.Oid(patch.From) || !Profile.Oid(patch.To) || !Profile.Root(patch.Document) || patch.Profile != "git-myers-u3-v1", "Archived patch binding/hash mismatch.", "MDPK2006");
        if (m.Review is not null) NeedJson(m.Review["detail"]!.GetValue<string>(), "MDPK2007");
    }
}
