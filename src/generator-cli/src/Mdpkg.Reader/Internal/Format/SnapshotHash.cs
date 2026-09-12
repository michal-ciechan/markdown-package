using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Mdpkg.Reader.Internal.Format;

/// <summary>The shared mdpkg-snapshot-v1 byte algorithm. Inventory/schema validation precedes hashing.</summary>
internal static class SnapshotHash
{
    internal static JsonObject Header(Manifest manifest)
    {
        var addressing = CanonicalJson.Node(manifest.Addressing);
        addressing["overrides"] = manifest.Addressing.Overrides;
        JsonObject? review = null;
        if (manifest.Review is { } r)
            review = new() { ["detail"] = r["detail"]!.DeepClone(), ["shape"] = r["shape"]!.DeepClone(),
                ["of"] = new JsonObject { ["current"] = r["of"]!["current"]!.DeepClone(), ["namespace"] = r["of"]!["namespace"]!.DeepClone() } };
        return new() { ["addressing"] = addressing, ["namespace"] = manifest.Namespace, ["review"] = review };
    }

    // Read one captured/archived payload at a time; never allocate the complete preimage.
    internal static string Compute(Manifest manifest, IEnumerable<string> paths, Func<string, byte[]> read, CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData("{\"entries\":["u8);
        var first = true;
        foreach (var path in paths.Order(Utf8Comparer.Instance))
        {
            ct.ThrowIfCancellationRequested();
            var bytes = read(path);
            // Stored bytes must already be canonical source text. Do not normalize here.
            Profile.Utf8.GetCharCount(bytes);
            if (bytes.Contains((byte)'\r')) throw new EngineException(Outcome.Nonconforming, "MDPK1004", "Current file contains CR.", path);
            using var fileHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            for (var offset = 0; offset < bytes.Length; offset += Math.Min(65536, bytes.Length - offset))
            {
                ct.ThrowIfCancellationRequested();
                fileHash.AppendData(bytes.AsSpan(offset, Math.Min(65536, bytes.Length - offset)));
            }
            var record = new JsonObject { ["bytes"] = bytes.LongLength,
                ["digest"] = "sha256-" + Convert.ToHexStringLower(fileHash.GetHashAndReset()), ["mode"] = "100644", ["path"] = path };
            if (!first) hash.AppendData(","u8);
            first = false;
            var encoded = CanonicalJson.Bytes(record);
            hash.AppendData(encoded.AsSpan(0, encoded.Length - 1));
        }
        hash.AppendData("],\"header\":"u8);
        var header = CanonicalJson.Bytes(Header(manifest));
        hash.AppendData(header.AsSpan(0, header.Length - 1));
        hash.AppendData(",\"profile\":\"mdpkg-snapshot-v1\"}\n"u8);
        ct.ThrowIfCancellationRequested();
        return "sha256-" + Convert.ToHexStringLower(hash.GetHashAndReset());
    }
}
