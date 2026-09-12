using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using ICSharpCode.SharpZipLib.Checksum;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Core.Internal.Git;

/// <summary>Full-object PACK v2 writer. Object order is ascending SHA-1; zlib uses Optimal.
/// All payloads use the existing byte-array entry contract (below 2 GiB), so index
/// large offsets cannot occur. No filesystem or process operations occur here.</summary>
internal sealed class ManagedSnapshot(ResourceOptions resources)
{
    private sealed record ObjectData(string Id, int Kind, byte[] Bytes);
    private sealed record TreeEntry(string Name, string Id, bool Directory);
    private readonly Dictionary<string, ObjectData> objects = new(StringComparer.Ordinal);
    private long objectBytes;

    private string Add(int kind, byte[] payload)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        var type = kind switch { 1 => "commit", 2 => "tree", 3 => "blob", _ => throw new ArgumentOutOfRangeException(nameof(kind)) };
        hash.AppendData(Profile.Utf8.GetBytes(type + " " + payload.Length.ToString(CultureInfo.InvariantCulture) + "\0"));
        hash.AppendData(payload);
        var id = Convert.ToHexStringLower(hash.GetHashAndReset());
        if (objects.TryGetValue(id, out var existing))
        {
            if (existing.Kind != kind || !existing.Bytes.AsSpan().SequenceEqual(payload))
                throw new EngineException(Outcome.Nonconforming, "MDPK4002", "Conflicting Git object identity.");
        }
        else
        {
            if (payload.LongLength > resources.ReadLimits.MaxDecodedBytes - objectBytes)
                throw new ResourceLimitException("Git objects exceed decoded byte limit.");
            objectBytes += payload.LongLength;
            objects.Add(id, new(id, kind, payload));
        }
        return id;
    }

    internal string Tree(IReadOnlyList<EntryData> entries, CancellationToken ct)
    {
        var trees = new Dictionary<string, List<TreeEntry>>(StringComparer.Ordinal) { [""] = [] };
        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();
            var slash = entry.Name.LastIndexOf('/');
            var directory = slash < 0 ? "" : entry.Name[..slash];
            var ancestor = directory;
            while (!trees.ContainsKey(ancestor))
            {
                trees.Add(ancestor, []);
                var parent = ancestor.LastIndexOf('/');
                ancestor = parent < 0 ? "" : ancestor[..parent];
            }
            trees[directory].Add(new(entry.Name[(slash + 1)..], Add(3, entry.Bytes), false));
        }
        string root = "";
        foreach (var directory in trees.Keys.OrderByDescending(p => p.Count(c => c == '/')).ThenByDescending(p => p.Length))
        {
            ct.ThrowIfCancellationRequested();
            using var data = new BoundedBuffer(resources.MemberLimit(".git/objects/tree"));
            foreach (var entry in trees[directory].OrderBy(e => e.Name + (e.Directory ? "/" : ""), Utf8Comparer.Instance))
            {
                data.Write(Profile.Utf8.GetBytes((entry.Directory ? "40000 " : "100644 ") + entry.Name + "\0"));
                data.Write(Convert.FromHexString(entry.Id));
            }
            root = Add(2, data.ToArray());
            if (directory.Length == 0) continue;
            var slash = directory.LastIndexOf('/');
            trees[slash < 0 ? "" : directory[..slash]].Add(new(directory[(slash + 1)..], root, true));
        }
        return root;
    }

    internal string Commit(string tree, string message, SnapshotMetadata? metadata) =>
        Add(1, CommitSerializer.Serialize(tree, null, message, metadata));

    internal List<EntryData> Curate(string head, bool reverse, CancellationToken ct)
    {
        var sorted = objects.Values.OrderBy(o => o.Id, StringComparer.Ordinal).ToArray();
        var limit = Math.Min(resources.MaxSpoolBytes, resources.MemberLimit(".git/objects/pack"));
        using var pack = new BoundedBuffer(limit);
        pack.Write("PACK"u8); U32(pack, 2); U32(pack, checked((uint)sorted.Length));
        var offsets = new uint[sorted.Length]; var crcs = new uint[sorted.Length];
        for (var i = 0; i < sorted.Length; i++)
        {
            ct.ThrowIfCancellationRequested();
            offsets[i] = checked((uint)pack.Position);
            var obj = sorted[i]; var size = obj.Bytes.Length;
            var first = (obj.Kind << 4) | (size & 15); size >>= 4;
            pack.WriteByte((byte)(first | (size > 0 ? 128 : 0)));
            while (size > 0) { var next = size & 127; size >>= 7; pack.WriteByte((byte)(next | (size > 0 ? 128 : 0))); }
            // .NET emits no zlib bytes when no input is supplied, even for an empty
            // Write. Encode the canonical empty stream (including Adler-32 = 1).
            if (obj.Bytes.Length == 0) pack.Write([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
            else using (var zlib = new ZLibStream(pack, CompressionLevel.Optimal, leaveOpen: true))
            {
                for (var start = 0; start < obj.Bytes.Length; start += Math.Min(65536, obj.Bytes.Length - start))
                {
                    ct.ThrowIfCancellationRequested();
                    zlib.Write(obj.Bytes.AsSpan(start, Math.Min(65536, obj.Bytes.Length - start)));
                }
            }
            var crc = new Crc32();
            crc.Update(new ArraySegment<byte>(pack.GetBuffer(), (int)offsets[i], (int)(pack.Position - offsets[i])));
            crcs[i] = (uint)crc.Value;
        }
        var checksum = Finish(pack);
        using var index = new BoundedBuffer(limit);
        index.Write([255, 116, 79, 99]); U32(index, 2);
        var fanout = new uint[256];
        foreach (var obj in sorted) fanout[Convert.FromHexString(obj.Id)[0]]++;
        uint count = 0;
        foreach (var n in fanout) { count += n; U32(index, count); }
        foreach (var obj in sorted) index.Write(Convert.FromHexString(obj.Id));
        foreach (var crc in crcs) U32(index, crc);
        foreach (var offset in offsets) U32(index, offset);
        index.Write(checksum); Finish(index);
        var stem = ".git/objects/pack/pack-" + Convert.ToHexStringLower(checksum);
        var entries = new List<EntryData>
        {
            new(".git/HEAD", "ref: refs/heads/main\n"u8.ToArray()),
            new(".git/config", Profile.Utf8.GetBytes(Profile.Config)),
            new(".git/refs/heads/main", Profile.Utf8.GetBytes(head + "\n"))
        };
        if (reverse)
        {
            using var rev = new BoundedBuffer(limit);
            rev.Write("RIDX"u8); U32(rev, 1); U32(rev, 1);
            // Pack order equals index order, so this permutation is the identity.
            for (uint i = 0; i < sorted.Length; i++) U32(rev, i);
            rev.Write(checksum); Finish(rev);
            entries.Add(new(stem + ".rev", rev.ToArray()));
        }
        entries.Add(new(stem + ".idx", index.ToArray()));
        entries.Add(new(stem + ".pack", pack.ToArray()));
        return entries;
    }

    private static void U32(Stream stream, uint value)
    { Span<byte> bytes = stackalloc byte[4]; BinaryPrimitives.WriteUInt32BigEndian(bytes, value); stream.Write(bytes); }
    private static byte[] Finish(MemoryStream stream)
    {
        var checksum = SHA1.HashData(stream.GetBuffer().AsSpan(0, checked((int)stream.Length)));
        stream.Write(checksum); return checksum;
    }
    private sealed class BoundedBuffer(long limit) : MemoryStream
    {
        private void Check(int count)
        {
            if (count > Math.Min(limit, Array.MaxLength) - Position)
                throw new ResourceLimitException("Managed Git payload exceeds its byte limit.");
        }
        public override void Write(byte[] buffer, int offset, int count) { Check(count); base.Write(buffer, offset, count); }
        public override void Write(ReadOnlySpan<byte> buffer) { Check(buffer.Length); base.Write(buffer); }
        public override void WriteByte(byte value) { Check(1); base.WriteByte(value); }
    }
}
