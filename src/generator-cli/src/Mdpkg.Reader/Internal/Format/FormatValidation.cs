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
        if (m.Current.StartsWith("sha256-", StringComparison.Ordinal)) throw new EngineException(Outcome.Nonconforming, "MDPK4001", "SHA-256 repositories are unsupported.");
        Reject(!Profile.Oid(m.Current), "Malformed current commit.");
        Reject(m.Addressing.Anchor != Profile.Anchor || m.Addressing.Digest != Profile.Digest || m.Addressing.Coverage is not ("complete" or "partial"), "Unknown addressing profile or coverage.");
        Reject(m.Addressing.Overrides is not null && m.Addressing.Overrides != Profile.Ledger, "Unsupported ledger path.", "MDPK2002");
        Reject(m.History.Coverage is not ("complete" or "truncated" or "unknown") || m.History.Detail != Profile.History || m.History.Transform.Any(t => t is not ("projected" or "squashed")), "Invalid history declaration.");
        if (m.Review is { } r)
        {
            var of = r["of"]?.AsObject() ?? throw new JsonException("Missing review.of.");
            var ns = of["namespace"]?.GetValue<string>();
            var shape = r["shape"]?.GetValue<string>();
            Reject(!Guid.TryParseExact(ns, "D", out _) || ns != ns.ToLowerInvariant() || !Profile.Oid(of["current"]?.GetValue<string>()) ||
                shape is not ("delta" or "bundled") || r["detail"]?.GetValue<string>() != ".mdpkg/review/comments.json", "Malformed review declaration.");
            Reject((shape == "bundled") != (ns == m.Namespace), "Review namespace disagrees with its shape.");
        }
    }
    internal static void ValidateHistory(Manifest m, HistoryDetail h)
    {
        Reject(h.Walk != "first-parent" || h.Root is not ("original" or "synthetic") || h.RetainedCommits < 1 || !Profile.Oid(h.SourceBase) || !Profile.Oid(h.SourceTip), "Malformed history descriptor.");
        Reject(h.Root == "synthetic" && m.History.Coverage != "truncated", "Synthetic roots require truncated coverage.");
        Reject(h.Transformations.Any(t => t is null || t.Kind is not ("projected" or "squashed") || !Profile.Oid(t.SourceBase) || !Profile.Oid(t.SourceTip) || !Profile.Oid(t.Emitted)) ||
            !m.History.Transform.SequenceEqual(h.Transformations.Select(t => t.Kind)), "Manifest/history transformations disagree.", "MDPK2003");
        Reject(h.ShallowBoundaries.Any(s => !Profile.Oid(s)) || h.ShallowBoundaries.Distinct().Count() != h.ShallowBoundaries.Length, "Invalid shallow boundaries.", "MDPK2004");
        Reject(h.AddressingCoverage.Length == 0 || h.AddressingCoverage.Any(r => r is null || !Profile.Oid(r.From) || !Profile.Oid(r.To) || r.Coverage is not ("complete" or "partial")), "Invalid addressing coverage ranges.");
        Reject(h.Ranges.Any(r => r is null) || h.Patches.Any(p => p is null), "Null history evidence item.");
        Reject(m.Addressing.Coverage == "complete" && (h.AddressingCoverage.Length != 1 || h.AddressingCoverage[0].Coverage != "complete" || h.AddressingCoverage[0].To != m.Current), "Complete correspondence needs one range through current.");
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
