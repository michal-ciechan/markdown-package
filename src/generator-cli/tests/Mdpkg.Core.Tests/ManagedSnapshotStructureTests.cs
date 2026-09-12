using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Validation;
using Mdpkg.Reader.Internal.Container;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.EngineTests;

public class ManagedSnapshotStructureTests
{
    // Independent adversarial fixtures repair every hash, index entry and ZIP CRC.
    // A valid control proves the fixture reaches the restricted semantic decoder.
    [Theory]
    [InlineData("valid")][InlineData("mode")][InlineData("order")][InlineData("duplicate-name")]
    [InlineData("missing-link")][InlineData("wrong-link-kind")][InlineData("parent")]
    [InlineData("extra-commit")][InlineData("unreachable")][InlineData("duplicate-object")]
    [InlineData("empty-directory")][InlineData("bad-name")][InlineData("identity")]
    [InlineData("trailing-zlib")][InlineData("short-zlib")][InlineData("decoded-limit")]
    [InlineData("declared-size-limit")]
    [InlineData("delta-valid")][InlineData("delta-missing-base")][InlineData("delta-base-boundary")]
    [InlineData("delta-base-size")][InlineData("delta-result-size")][InlineData("delta-zero-opcode")]
    [InlineData("delta-copy-bound")][InlineData("delta-insert-bound")][InlineData("delta-copy-truncated")]
    [InlineData("delta-trailing")][InlineData("delta-result-limit")][InlineData("delta-size-overflow")]
    [InlineData("delta-reference-kind")][InlineData("delta-distance-overflow")]
    [InlineData("delta-tree-base")][InlineData("delta-chain")][InlineData("delta-wrong-result")]
    [InlineData("delta-short-zlib")][InlineData("delta-trailing-zlib")][InlineData("delta-short-size")]
    public async Task RehashedMalformedObjectsAreRejected(string fault)
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var raw = new List<(int Kind, byte[] Data)>();
        string Add(int kind, byte[] data) { raw.Add((kind, data)); return Id(kind, data); }
        var blob = Add(fault == "delta-tree-base" ? 2 : 3, "text\n"u8.ToArray());
        var deltaCase = fault.StartsWith("delta-", StringComparison.Ordinal);
        var secondBlob = deltaCase ? Add(3, "text!\n"u8.ToArray()) : blob;
        var thirdBlob = fault == "delta-chain" ? Add(3, "text?\n"u8.ToArray()) : null;
        byte[] Row(string mode, string name, string id) => [.. Encoding.UTF8.GetBytes(mode + " " + name + "\0"), .. Convert.FromHexString(id)];
        var rows = new List<byte[]> { Row(fault == "mode" ? "100755" : "100644", fault == "bad-name" ? ".." : "x", fault == "missing-link" ? new string('a', 40) : blob), Row("100644", "y", secondBlob) };
        if (thirdBlob is not null) rows.Add(Row("100644", "z", thirdBlob));
        if (fault == "order") rows.Reverse();
        if (fault == "duplicate-name") rows[1] = rows[0];
        if (fault is "empty-directory" or "wrong-link-kind")
        {
            var empty = Add(2, []);
            rows[0] = Row(fault == "empty-directory" ? "40000" : "100644", "x", empty);
        }
        var tree = Add(2, rows.SelectMany(b => b).ToArray());
        var commit = Add(1, Encoding.UTF8.GetBytes($"tree {tree}\n" + (fault == "parent" ? $"parent {new string('a', 40)}\n" : "") +
            (fault == "identity" ? "author invalid\n" : "author mdpkg <mdpkg@example.invalid> 946684800 +0000\n") +
            "committer mdpkg <mdpkg@example.invalid> 946684800 +0000\n\nInitial package\n"));
        if (fault == "extra-commit") Add(1, Encoding.UTF8.GetBytes($"tree {tree}\nauthor A <a@b> 1 +0000\ncommitter A <a@b> 1 +0000\n\nextra\n"));
        if (fault == "unreachable") Add(3, "unreachable\n"u8.ToArray());
        if (fault == "duplicate-object") Add(3, "text\n"u8.ToArray());
        var manifest = new Manifest(Profile.Magic, EngineFixture.Namespace, new("commit", "sha1-" + commit),
            new(Profile.Anchor, Profile.Digest, "complete", null), new Mdpkg.Reader.GitHistory("complete", [], Profile.History));
        var history = new HistoryDetail("first-parent", "original", manifest.Current.Id, manifest.Current.Id, 1, [], [], [], [], [new(manifest.Current.Id, manifest.Current.Id, "complete")]);
        var entries = new List<EntryData>
        {
            new(Profile.Manifest, CanonicalJson.Bytes(manifest, manifest: true)), new("x", "text\n"u8.ToArray()), new("y", deltaCase ? "text!\n"u8.ToArray() : "text\n"u8.ToArray()),
            new(Profile.History, CanonicalJson.Bytes(history)), new(".git/HEAD", "ref: refs/heads/main\n"u8.ToArray()),
            new(".git/config", Encoding.UTF8.GetBytes(Profile.Config)), new(".git/refs/heads/main", Encoding.UTF8.GetBytes(commit + "\n"))
        };
        if (thirdBlob is not null) entries.Insert(3, new("z", "text?\n"u8.ToArray()));
        entries.AddRange(Pack(raw, fault)); EngineFixture.Rewrite(f.Output, entries);
        var resources = fault is "decoded-limit" or "declared-size-limit" or "delta-result-limit" ? new Mdpkg.Core.ResourceOptions
            { ReadLimits = new() { MaxDecodedBytes = fault == "decoded-limit" ? 10 : 4096 } } : null;
        var result = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true, Resources: resources), ct, managedSnapshot: true);
        if (fault is "valid" or "delta-valid") EngineFixture.Success(result);
        else if (fault is "decoded-limit" or "declared-size-limit" or "delta-result-limit") Assert.True(result.ResourceExceeded);
        else { Assert.Equal(Outcome.Nonconforming, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code is "MDPK4002" or "MDPK2001" or "MDPK1003"); }
    }

    private static string Id(int kind, byte[] data)
    {
        var type = kind == 1 ? "commit" : kind == 2 ? "tree" : "blob";
        return Convert.ToHexStringLower(SHA1.HashData([.. Encoding.ASCII.GetBytes(type + " " + data.Length.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\0"), .. data]));
    }
    private static List<EntryData> Pack(List<(int Kind, byte[] Data)> objects, string fault)
    {
        static void Number(Stream stream, uint n) { Span<byte> bytes = stackalloc byte[4]; BinaryPrimitives.WriteUInt32BigEndian(bytes, n); stream.Write(bytes); }
        static byte[] Seal(MemoryStream stream) { var hash = SHA1.HashData(stream.ToArray()); stream.Write(hash); return hash; }
        using var pack = new MemoryStream(); pack.Write("PACK"u8); Number(pack, 2); Number(pack, (uint)objects.Count);
        var rows = new List<(string Id, uint Offset, uint Crc)>();
        foreach (var (kind, data) in objects)
        {
            var offset = (uint)pack.Position;
            var chain = fault == "delta-chain" && rows.Count == 2;
            var isDelta = fault.StartsWith("delta-", StringComparison.Ordinal) && (rows.Count == 1 || chain);
            byte[] payload = isDelta ? [5, 6, 0x90, 4, 2, (byte)'!', 10] : data;
            if (chain) payload = [6, 6, 0x90, 4, 2, (byte)'?', 10];
            if (isDelta) payload = fault switch
            {
                "delta-base-size" => [4, 6, 0x90, 4, 2, (byte)'!', 10],
                "delta-result-size" => [5, 5, 0x90, 4, 2, (byte)'!', 10],
                "delta-zero-opcode" => [5, 6, 0],
                "delta-copy-bound" => [5, 6, 0x91, 4, 4],
                "delta-insert-bound" => [5, 6, 7, 1],
                "delta-copy-truncated" => [5, 6, 0x91, 4],
                "delta-trailing" => [5, 6, 0x90, 4, 2, (byte)'!', 10, 1, 1],
                "delta-result-limit" => [5, 0x80, 0x80, 0x80, 8],
                "delta-size-overflow" => [5, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f],
                "delta-wrong-result" => [5, 6, 0x90, 4, 2, (byte)'?', 10],
                "delta-short-size" => [5],
                _ => payload
            };
            var declaredLength = fault == "declared-size-limit" ? 16777216 : payload.Length;
            var remaining = declaredLength >> 4;
            var packKind = isDelta ? (fault == "delta-reference-kind" ? 7 : 6) : kind;
            pack.WriteByte((byte)((packKind << 4) + (declaredLength & 15) + (remaining == 0 ? 0 : 128)));
            while (remaining != 0) { var b = remaining & 127; remaining >>= 7; pack.WriteByte((byte)(b + (remaining == 0 ? 0 : 128))); }
            if (isDelta)
            {
                if (fault == "delta-distance-overflow") pack.Write([255, 255, 255, 255, 255, 127]);
                else pack.WriteByte(fault == "delta-missing-base" ? (byte)0 : checked((byte)(offset - (chain ? rows[1].Offset : 12) + (fault == "delta-base-boundary" ? -1 : 0))));
            }
            using var compressed = new MemoryStream();
            if (payload.Length == 0) compressed.Write([120, 156, 3, 0, 0, 0, 0, 1]);
            else using (var z = new ZLibStream(compressed, CompressionLevel.SmallestSize, true)) z.Write(payload);
            var encoded = compressed.ToArray();
            pack.Write(fault == "short-zlib" || (isDelta && fault == "delta-short-zlib") ? encoded[..^1] : encoded);
            if (fault == "trailing-zlib" || (isDelta && fault == "delta-trailing-zlib")) pack.WriteByte(0);
            rows.Add((Id(kind, data), offset, ZipReader.Crc(pack.ToArray()[(int)offset..])));
        }
        var hash = Seal(pack); var sorted = rows.OrderBy(r => r.Id, StringComparer.Ordinal).ToArray();
        using var idx = new MemoryStream(); Number(idx, 0xff744f63); Number(idx, 2);
        for (var b = 0; b < 256; b++) Number(idx, (uint)sorted.Count(r => Convert.FromHexString(r.Id)[0] <= b));
        foreach (var row in sorted) idx.Write(Convert.FromHexString(row.Id));
        foreach (var row in sorted) Number(idx, row.Crc);
        foreach (var row in sorted) Number(idx, row.Offset);
        idx.Write(hash); Seal(idx);
        var stem = ".git/objects/pack/pack-" + Convert.ToHexStringLower(hash);
        return [new(stem + ".idx", idx.ToArray()), new(stem + ".pack", pack.ToArray())];
    }
}
