using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Core.Internal.Addressing;
using Mdpkg.Reader;

namespace Mdpkg.Core;

public sealed record EntityRoot
{
    public string Value { get; }
    public EntityRoot(string value)
    {
        if (!Profile.Root(value)) throw new ArgumentException("Root must be 64 lowercase hexadecimal characters.", nameof(value));
        Value = value;
    }
    public override string ToString() => Value;
}
public abstract record CorrespondenceRecord(EntityRoot Root);
public sealed record ConfirmedMove(EntityRoot Root, DocumentLocator Target) : CorrespondenceRecord(Root);
public sealed record ConfirmedRetirement : CorrespondenceRecord
{
    public string Reason { get; }
    public IReadOnlyList<EntityRoot> Successors { get; }
    public ConfirmedRetirement(EntityRoot root, string reason, IEnumerable<EntityRoot>? successors = null) : base(root)
    {
        ArgumentNullException.ThrowIfNull(root); ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        Reason = reason; Successors = PackageResult.Freeze(successors ?? []);
        if (Successors.Any(r => r is null)) throw new ArgumentException("Null successor.", nameof(successors));
    }
}
public sealed record UnconfirmedRecord(EntityRoot Root, string Reason) : CorrespondenceRecord(Root);

/// <summary>Confirmed bindings and unconfirmed evidence. Coverage is derived by the engine.</summary>
public sealed class Correspondence
{
    public IReadOnlyList<CorrespondenceRecord> Records { get; }
    public Correspondence(IEnumerable<CorrespondenceRecord> records)
    {
        ArgumentNullException.ThrowIfNull(records);
        static CorrespondenceRecord Copy(CorrespondenceRecord r)
        {
            ArgumentNullException.ThrowIfNull(r); ArgumentNullException.ThrowIfNull(r.Root);
            if (r is ConfirmedMove move)
            {
                ArgumentNullException.ThrowIfNull(move.Target); ArgumentNullException.ThrowIfNull(move.Target.HeadingTrail);
                if (move.Target.HeadingTrail.Any(h => h is null)) throw new ArgumentException("Null heading part.");
                return move with { Target = move.Target with { HeadingTrail = PackageResult.Freeze(move.Target.HeadingTrail) } };
            }
            return r switch
            {
                ConfirmedRetirement retirement => new ConfirmedRetirement(retirement.Root, retirement.Reason, retirement.Successors),
                UnconfirmedRecord unknown => unknown,
                _ => throw new ArgumentException("Unknown correspondence record.", nameof(records))
            };
        }
        Records = PackageResult.Freeze(records.Select(Copy));
        try { LedgerEngine.ApplyCorrespondence(LedgerEngine.Empty(), CorrespondenceCodec.Encode(this)); }
        catch (EngineException ex) { throw new ArgumentException(ex.Message, nameof(records), ex); }
    }
}

/// <summary>Existing CLI JSON grammar translated to the same typed records. File I/O remains caller-owned.</summary>
public static class CorrespondenceCodec
{
    public static Correspondence Decode(ReadOnlyMemory<byte> json)
    {
        try
        {
            var ledger = LedgerEngine.Empty(); LedgerEngine.ApplyCorrespondence(ledger, json.ToArray());
            return new(ledger.Entries.Select(kv => kv.Value switch
            {
                { To: { } to } => (CorrespondenceRecord)new ConfirmedMove(new(kv.Key), DocumentLocator.FromJson(to)),
                { Dead: { } dead } => new ConfirmedRetirement(new(kv.Key), dead, kv.Value.Next?.Select(n => new EntityRoot(n))),
                _ => new UnconfirmedRecord(new(kv.Key), kv.Value.Unknown!)
            }));
        }
        catch (Exception ex) when (ex is EngineException or ArgumentException or FormatException or JsonException)
        { throw new PackageFormatException("MDPK3003", "Invalid correspondence: " + ex.Message); }
    }
    public static byte[] Encode(Correspondence correspondence)
    {
        ArgumentNullException.ThrowIfNull(correspondence);
        var array = new JsonArray();
        foreach (var record in correspondence.Records)
        {
            var obj = new JsonObject { ["root"] = record.Root.Value };
            switch (record)
            {
                case ConfirmedMove move: obj["to"] = move.Target.ToJson(); break;
                case ConfirmedRetirement retirement:
                    obj["dead"] = retirement.Reason;
                    if (retirement.Successors.Count > 0) obj["next"] = new JsonArray(retirement.Successors.Select(r => (JsonNode)JsonValue.Create(r.Value)!).ToArray());
                    break;
                case UnconfirmedRecord unknown: obj["unknown"] = unknown.Reason; break;
            }
            array.Add(obj);
        }
        return CanonicalJson.Bytes(array);
    }
}
