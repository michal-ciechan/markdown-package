using System.Security.Cryptography;
using Mdpkg.Reader.Internal.Addressing;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Engine.Sources;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Cli.Engine.Addressing;

internal static class LedgerEngine
{
    public static Ledger Empty() => new(1, Profile.Anchor, new(StringComparer.Ordinal));
    public static Ledger Read(byte[] bytes, Outcome outcome) => LedgerReader.Read(bytes, outcome);
    private static void ValidateRecord(string root, LedgerRecord record) => LedgerReader.ValidateRecord(root, record);
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
    public static void ValidateTargets(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns, Outcome outcome) => LedgerReader.ValidateTargets(ledger, inventory, ns, outcome);
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
    public static HashSet<string> LiveRoots(Ledger ledger, IReadOnlyDictionary<string, Entity> inventory, string ns) => LedgerReader.LiveRoots(ledger, inventory, ns);
    public static bool CompleteTransition(HashSet<string> previous, HashSet<string> current, Ledger ledger) =>
        previous.All(root => current.Contains(root) || (ledger.Entries.TryGetValue(root, out var record) && record.Unknown is null)) &&
        ledger.Entries.Values.All(r => r.Unknown is null);
    public static void Store(List<EntryData> entries, Ledger ledger)
    {
        entries.RemoveAll(e => e.Name == Profile.Ledger);
        if (ledger.Entries.Count > 0) entries.Add(new(Profile.Ledger, CanonicalJson.Bytes(ledger)));
    }
}
