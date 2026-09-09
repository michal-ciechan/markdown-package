using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;
namespace Mdpkg.Reader.Internal.Addressing;
internal static class LedgerReader
{
    public static Ledger Read(byte[] bytes, Outcome outcome)
    {
        try
        {
            var ledger = CanonicalJson.Read<Ledger>(bytes);
            if (ledger.Version != 1 || ledger.Anchor != Profile.Anchor || ledger.Entries is null)
                throw new JsonException("Unknown ledger version or anchor.");
            foreach (var (root, record) in ledger.Entries) ValidateRecord(root, record);
            return ledger;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or ArgumentException)
        { throw new EngineException(outcome, "MDPK2002", "Invalid ledger: " + ex.Message, Profile.Ledger); }
    }
    internal static void ValidateRecord(string root, LedgerRecord record)
    {
        if (!Profile.Root(root) || record is null) throw new JsonException("Malformed origin root or record.");
        if ((record.To is null ? 0 : 1) + (record.Dead is null ? 0 : 1) + (record.Unknown is null ? 0 : 1) != 1)
            throw new JsonException("A ledger record requires exactly one of to/dead/unknown.");
        if (record.Dead is not null && record.Dead is not ("deleted" or "split" or "merge")) throw new JsonException("Unknown retirement reason.");
        if (record.Next is not null && (record.Dead is null || record.Next.Any(r => !Profile.Root(r)))) throw new JsonException("Invalid successors.");
        if (record.Unknown is "") throw new JsonException("Empty unknown reason.");
        if (record.To is { } loc)
        {
            if (loc.Count != 3 || loc[0]?.GetValue<string>() is not ("document" or "preamble" or "section") || loc[1] is null || loc[2] is not JsonArray trail)
                throw new JsonException("Malformed locator.");
            var path = loc[1]!.GetValue<string>();
            SourceRules.ValidatePath(path);
            if (SourceRules.Reserved(path)) throw new JsonException("Locator names a reserved path.");
            if ((loc[0]!.GetValue<string>() == "section") != (trail.Count > 0)) throw new JsonException("Invalid heading trail for scope kind.");
            foreach (var part in trail)
                if (part is not JsonArray p || p.Count != 2 || p[0]?.GetValue<string>() is not { Length: > 0 } || p[1]?.GetValue<int>() is not >= 0)
                    throw new JsonException("Malformed heading trail.");
        }
    }
    public static void ValidateTargets(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns, Outcome outcome)
    {
        var destinations = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (root, record) in ledger.Entries)
        {
            if (record.To is not { } to) continue;
            var target = Inventory.Root(ns, to);
            if (!inventory.ContainsKey(target) || !destinations.Add(target))
                throw new EngineException(outcome, "MDPK2002", "Ledger target is absent or has multiple owners.", root);
        }
    }
    public static HashSet<string> LiveRoots(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns)
    {
        var targets = ledger.Entries.Values.Where(r => r.To is not null).Select(r => Inventory.Root(ns, r.To!)).ToHashSet(StringComparer.Ordinal);
        var roots = inventory.Keys.Where(r => !targets.Contains(r) && !ledger.Entries.ContainsKey(r)).ToHashSet(StringComparer.Ordinal);
        foreach (var (root, record) in ledger.Entries) if (record.To is not null) roots.Add(root);
        return roots;
    }
}
