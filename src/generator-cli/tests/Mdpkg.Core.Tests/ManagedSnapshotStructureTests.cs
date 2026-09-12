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
    public async Task RehashedMalformedObjectsAreRejected(string fault)
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        var raw = new List<(int Kind, byte[] Data)>();
        string Add(int kind, byte[] data) { raw.Add((kind, data)); return Id(kind, data); }
        var blob = Add(3, "text\n"u8.ToArray());
        byte[] Row(string mode, string name, string id) => [.. Encoding.UTF8.GetBytes(mode + " " + name + "\0"), .. Convert.FromHexString(id)];
        var rows = new List<byte[]> { Row(fault == "mode" ? "100755" : "100644", fault == "bad-name" ? ".." : "x", fault == "missing-link" ? new string('a', 40) : blob), Row("100644", "y", blob) };
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
        var manifest = new Manifest(Profile.Magic, EngineFixture.Namespace, "sha1-" + commit,
            new(Profile.Anchor, Profile.Digest, "complete", null), new("complete", [], Profile.History));
        var history = new HistoryDetail("first-parent", "original", manifest.Current, manifest.Current, 1, [], [], [], [], [new(manifest.Current, manifest.Current, "complete")]);
        var entries = new List<EntryData>
        {
            new(Profile.Manifest, CanonicalJson.Bytes(manifest, manifest: true)), new("x", "text\n"u8.ToArray()), new("y", "text\n"u8.ToArray()),
            new(Profile.History, CanonicalJson.Bytes(history)), new(".git/HEAD", "ref: refs/heads/main\n"u8.ToArray()),
            new(".git/config", Encoding.UTF8.GetBytes(Profile.Config)), new(".git/refs/heads/main", Encoding.UTF8.GetBytes(commit + "\n"))
        };
        entries.AddRange(Pack(raw, fault)); EngineFixture.Rewrite(f.Output, entries);
        var resources = fault is "decoded-limit" or "declared-size-limit" ? new Mdpkg.Core.ResourceOptions
            { ReadLimits = new() { MaxDecodedBytes = fault == "decoded-limit" ? 10 : 4096 } } : null;
        var result = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true, Resources: resources), ct, managedSnapshot: true);
        if (fault == "valid") EngineFixture.Success(result);
        else if (fault is "decoded-limit" or "declared-size-limit") Assert.True(result.ResourceExceeded);
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
            var declaredLength = fault == "declared-size-limit" ? 16777216 : data.Length;
            var remaining = declaredLength >> 4;
            pack.WriteByte((byte)((kind << 4) + (declaredLength & 15) + (remaining == 0 ? 0 : 128)));
            while (remaining != 0) { var b = remaining & 127; remaining >>= 7; pack.WriteByte((byte)(b + (remaining == 0 ? 0 : 128))); }
            using var compressed = new MemoryStream();
            if (data.Length == 0) compressed.Write([120, 156, 3, 0, 0, 0, 0, 1]);
            else using (var z = new ZLibStream(compressed, CompressionLevel.SmallestSize, true)) z.Write(data);
            var encoded = compressed.ToArray();
            pack.Write(fault == "short-zlib" ? encoded[..^1] : encoded);
            if (fault == "trailing-zlib") pack.WriteByte(0);
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
