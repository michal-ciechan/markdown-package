using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine.Format;
using Mdpkg.Cli.Engine.Sources;

namespace Mdpkg.Cli.Engine.Addressing;

internal static class LedgerEngine
{
    public static Ledger Empty() => new(1, Profile.Anchor, new(StringComparer.Ordinal));
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
    private static void ValidateRecord(string root, LedgerRecord record)
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
            SourceTree.ValidatePath(path);
            if (SourceTree.Reserved(path)) throw new JsonException("Locator names a reserved path.");
            if ((loc[0]!.GetValue<string>() == "section") != (trail.Count > 0)) throw new JsonException("Invalid heading trail for scope kind.");
            foreach (var part in trail)
                if (part is not JsonArray p || p.Count != 2 || p[0]?.GetValue<string>() is not { Length: > 0 } || p[1]?.GetValue<int>() is not >= 0)
                    throw new JsonException("Malformed heading trail.");
        }
    }
    public static void ApplyCorrespondence(Ledger ledger, byte[] bytes)
    {
        try
        {
            if (CanonicalJson.Parse(bytes) is not JsonArray records) throw new JsonException("Correspondence must be an array of records.");
            var roots = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in records)
            {
                if (item is not JsonObject obj) throw new JsonException("Expected correspondence object.");
                var root = obj["root"]?.GetValue<string>() ?? throw new JsonException("Missing root.");
                if (!roots.Add(root)) throw new JsonException("Duplicate correspondence root.");
                if (obj.ContainsKey("confirmed") && obj["confirmed"]?.GetValue<bool>() != true)
                    throw new EngineException(Outcome.InvalidSource, "MDPK3003", "Unconfirmed candidate cannot become a ledger binding.", root);
                obj.Remove("root"); obj.Remove("confirmed");
                var record = obj.Deserialize<LedgerRecord>(CanonicalJson.Options) ?? throw new JsonException("Missing record.");
                ValidateRecord(root, record);
                ledger.Entries[root] = record;
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or ArgumentException)
        { throw new EngineException(Outcome.InvalidSource, "MDPK3003", "Invalid correspondence: " + ex.Message); }
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
    public static int MintReservedSlots(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns, List<Finding> findings)
    {
        var bound = ledger.Entries.Values.Where(e => e.To is not null).Select(e => Inventory.Root(ns, e.To!)).ToHashSet(StringComparer.Ordinal);
        var count = 0;
        foreach (var (slot, entity) in inventory)
        {
            if (!ledger.Entries.TryGetValue(slot, out var existing) || bound.Contains(slot) ||
                (existing.To is not null && Inventory.Root(ns, existing.To) == slot)) continue;
            string fresh;
            do { fresh = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)); } while (ledger.Entries.ContainsKey(fresh) || inventory.ContainsKey(fresh));
            ledger.Entries.Add(fresh, new(To: (JsonArray)entity.Locator.DeepClone()));
            findings.Add(Findings.Create("MDPK3002", "Minted a root for a reserved-slot birth: " + fresh, entity.Locator[1]!.GetValue<string>()));
            count++;
        }
        return count;
    }
    public static HashSet<string> LiveRoots(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns)
    {
        var targets = ledger.Entries.Values.Where(r => r.To is not null).Select(r => Inventory.Root(ns, r.To!)).ToHashSet(StringComparer.Ordinal);
        var roots = inventory.Keys.Where(r => !targets.Contains(r) && !ledger.Entries.ContainsKey(r)).ToHashSet(StringComparer.Ordinal);
        foreach (var (root, record) in ledger.Entries) if (record.To is not null) roots.Add(root);
        return roots;
    }
    public static bool CompleteTransition(HashSet<string> previous, HashSet<string> current, Ledger ledger) =>
        previous.All(root => current.Contains(root) || (ledger.Entries.TryGetValue(root, out var record) && record.Unknown is null)) &&
        ledger.Entries.Values.All(r => r.Unknown is null);
    public static void Store(List<EntryData> entries, Ledger ledger)
    {
        entries.RemoveAll(e => e.Name == Profile.Ledger);
        if (ledger.Entries.Count > 0) entries.Add(new(Profile.Ledger, CanonicalJson.Bytes(ledger)));
    }
}
