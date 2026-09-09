using System.Buffers.Binary;
using System.IO.Compression;
using ICSharpCode.SharpZipLib.Checksum;
using ICSharpCode.SharpZipLib.Zip.Compression;
using Mdpkg.Cli.Engine.Format;
using Mdpkg.Cli.Engine.Sources;

namespace Mdpkg.Cli.Engine.Container;

internal sealed record ZipMember(string Name, ushort Method, ushort Flags, uint Crc, uint CompressedSize,
    uint Size, uint Offset, ushort InternalAttributes, byte[] Bytes, long DataOffset);
internal sealed record ZipContents(IReadOnlyList<ZipMember> Members, IReadOnlyList<Finding> Findings, bool Typed, string Comment);

/// <summary>ZIP32 profile. All payload bounds and CRCs come from the central directory.</summary>
internal static class ZipContainer
{
    public static uint Crc(byte[] bytes) { var crc = new Crc32(); crc.Update(bytes); return (uint)crc.Value; }
    public static void CheckLimits(long size, long count)
    {
        // The all-ones values are sentinels, not usable ZIP32 values.
        if (size >= uint.MaxValue || count >= ushort.MaxValue)
            throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 is not supported.");
    }
    public static void Write(Stream stream, IReadOnlyList<EntryData> entries, int level, bool descriptors, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        CheckLimits(0, entries.Count);
        SourceTree.ValidateNames(entries.Select(e => e.Name), container: true);
        var directory = new List<(EntryData Entry, byte[] Name, ushort Method, ushort Flags, uint Crc, uint Size, uint Offset)>();
        using var writer = new BinaryWriter(stream, Profile.Utf8, leaveOpen: true);
        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();
            var name = Profile.Utf8.GetBytes(entry.Name);
            if (name.Length > ushort.MaxValue) throw new EngineException(Outcome.InvalidSource, "MDPK1003", "ZIP entry name is too long.", entry.Name);
            var stored = entry.Name == Profile.Manifest || entry.Name.StartsWith(".git/objects/pack/", StringComparison.Ordinal);
            byte[] encoded = entry.Bytes;
            ushort method = 0;
            if (!stored)
            {
                using var compressed = new MemoryStream();
                using (var deflate = new DeflateStream(compressed, new ZLibCompressionOptions { CompressionLevel = level }, leaveOpen: true)) deflate.Write(entry.Bytes);
                if (compressed.Length < entry.Bytes.Length) { encoded = compressed.ToArray(); method = 8; }
            }
            CheckLimits(stream.Position + 30L + name.Length + encoded.Length + 16, entries.Count);
            var flags = (ushort)((name.Any(b => b > 127) ? 0x800 : 0) | (descriptors && entry.Name != Profile.Manifest ? 8 : 0));
            var crc = Crc(entry.Bytes);
            var offset = (uint)stream.Position;
            writer.Write(0x04034b50u); writer.Write((ushort)20); writer.Write(flags); writer.Write(method);
            writer.Write((ushort)0); writer.Write((ushort)33);
            writer.Write((flags & 8) == 0 ? crc : 0u);
            writer.Write((flags & 8) == 0 ? (uint)encoded.Length : 0u);
            writer.Write((flags & 8) == 0 ? (uint)entry.Bytes.Length : 0u);
            writer.Write((ushort)name.Length); writer.Write((ushort)0); writer.Write(name); writer.Write(encoded);
            if ((flags & 8) != 0) { writer.Write(0x08074b50u); writer.Write(crc); writer.Write((uint)encoded.Length); writer.Write((uint)entry.Bytes.Length); }
            directory.Add((entry, name, method, flags, crc, (uint)encoded.Length, offset));
        }
        var cd = stream.Position;
        foreach (var e in directory)
        {
            ct.ThrowIfCancellationRequested();
            writer.Write(0x02014b50u); writer.Write((ushort)0x314); writer.Write((ushort)20);
            writer.Write(e.Flags); writer.Write(e.Method); writer.Write((ushort)0); writer.Write((ushort)33);
            writer.Write(e.Crc); writer.Write(e.Size); writer.Write((uint)e.Entry.Bytes.Length);
            writer.Write((ushort)e.Name.Length); writer.Write((ushort)0); writer.Write((ushort)0); writer.Write((ushort)0);
            writer.Write((ushort)0); writer.Write(0x81a40000u); writer.Write(e.Offset); writer.Write(e.Name);
        }
        CheckLimits(stream.Position + 22, entries.Count);
        var cdSize = stream.Position - cd;
        writer.Write(0x06054b50u); writer.Write((ushort)0); writer.Write((ushort)0);
        writer.Write((ushort)entries.Count); writer.Write((ushort)entries.Count);
        writer.Write((uint)cdSize); writer.Write((uint)cd); writer.Write((ushort)0);
    }
    private static ushort U16(byte[] b, int offset) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(offset, 2));
    private static uint U32(byte[] b, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(offset, 4));
    private static EngineException Bad(string message, string? name = null) => new(Outcome.Nonconforming, "MDPK1011", message, name);
    private static byte[] At(Stream s, long offset, int size)
    {
        if (offset < 0 || size < 0 || offset > s.Length - size) throw Bad("ZIP extent lies outside the file.");
        s.Position = offset; var data = new byte[size]; s.ReadExactly(data); return data;
    }
    private static void Extras(byte[] data)
    {
        for (var p = 0; p < data.Length;)
        {
            if (p + 4 > data.Length || p + 4 + U16(data, p + 2) > data.Length) throw Bad("Truncated ZIP extra field.");
            if (U16(data, p) == 1) throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 extra field is unsupported.");
            p += 4 + U16(data, p + 2);
        }
    }
    public static ZipContents Read(Stream stream, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        CheckLimits(stream.Length, 0);
        var tailStart = Math.Max(0, stream.Length - 65557);
        var tail = At(stream, tailStart, (int)(stream.Length - tailStart));
        var end = -1;
        for (var p = tail.Length - 22; p >= 0; p--)
            if (U32(tail, p) == 0x06054b50u && p + 22 + U16(tail, p + 20) == tail.Length) { end = p; break; }
        if (end < 0) throw Bad("EOCD record is absent or truncated.");
        if (U16(tail, end) == 0xffff) throw Bad("Invalid EOCD.");
        var count = U16(tail, end + 10); var cdSize = U32(tail, end + 12); var cd = U32(tail, end + 16);
        if (count == 0xffff || cdSize == uint.MaxValue || cd == uint.MaxValue || (end >= 20 && U32(tail, end - 20) == 0x07064b50))
            throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 sentinels/locator are unsupported.");
        if (U16(tail, end + 4) != 0 || U16(tail, end + 6) != 0 || U16(tail, end + 8) != count || (long)cd + cdSize != tailStart + end)
            throw Bad("Multi-disk or inconsistent central directory.");
        var comment = Profile.Utf8.GetString(tail.AsSpan(end + 22));
        var findings = new List<Finding>();
        var members = new List<ZipMember>();
        var extents = new List<(long Start, long End)>();
        long pos = cd;
        for (var i = 0; i < count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var header = At(stream, pos, 46);
            if (U32(header, 0) != 0x02014b50u) throw Bad("Invalid central-directory signature.");
            var flags = U16(header, 8); var method = U16(header, 10); var crc = U32(header, 16);
            var csize = U32(header, 20); var usize = U32(header, 24); var offset = U32(header, 42);
            if (csize == uint.MaxValue || usize == uint.MaxValue || offset == uint.MaxValue || U16(header, 34) == 0xffff)
                throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 entry sentinel.");
            if (U16(header, 34) != 0 || (flags & ~(0x800 | 8 | 6)) != 0) throw Bad("Encrypted, multi-disk or unsupported ZIP flags.");
            if (method is not (0 or 8)) throw new EngineException(Outcome.Nonconforming, "MDPK1008", "Unsupported ZIP method.");
            var nameBytes = At(stream, pos + 46, U16(header, 28));
            var name = Profile.Utf8.GetString(nameBytes);
            if (nameBytes.Any(b => b > 127) && (flags & 0x800) == 0) throw Bad("Non-ASCII name lacks UTF-8 flag.", name);
            SourceTree.ValidatePath(name, Outcome.Nonconforming);
            Extras(At(stream, pos + 46 + nameBytes.Length, U16(header, 30)));
            pos += 46L + nameBytes.Length + U16(header, 30) + U16(header, 32);
            if (pos > (long)cd + cdSize) throw Bad("Central directory overrun.");
            var local = At(stream, offset, 30);
            if (U32(local, 0) != 0x04034b50u) throw Bad("Invalid local-header signature.", name);
            if ((U16(local, 6) & (1 | 64 | 8192)) != 0) throw Bad("Encrypted local entry is not permitted.", name);
            var localName = At(stream, offset + 30L, U16(local, 26));
            if (!localName.AsSpan().SequenceEqual(nameBytes)) throw Bad("Local and central names disagree.", name);
            // Only the manifest's local method/sizes/CRC are authoritative (§3.4).
            Extras(At(stream, offset + 30L + localName.Length, U16(local, 28)));
            var dataOffset = offset + 30L + U16(local, 26) + U16(local, 28);
            if (dataOffset + csize > cd) throw Bad("Entry overlaps the central directory.", name);
            if (usize > int.MaxValue || csize > int.MaxValue) throw new IOException("Entry exceeds this implementation's in-memory size limit: " + name);
            var encoded = At(stream, dataOffset, (int)csize);
            byte[] bytes;
            if (method == 0)
            {
                if (csize != usize) throw Bad("Stored entry sizes disagree.", name);
                bytes = encoded;
            }
            else
            {
                try
                {
                    var inflater = new Inflater(noHeader: true); inflater.SetInput(encoded);
                    using var decoded = new MemoryStream(); var buffer = new byte[65536];
                    while (!inflater.IsFinished)
                    {
                        ct.ThrowIfCancellationRequested();
                        var n = inflater.Inflate(buffer);
                        if (decoded.Length + n > usize) throw Bad("DEFLATE output exceeds the declared size.", name);
                        decoded.Write(buffer, 0, n);
                        if (n == 0 && !inflater.IsFinished) throw Bad("Incomplete DEFLATE stream.", name);
                    }
                    if (inflater.RemainingInput != 0 || decoded.Length != usize) throw Bad("DEFLATE extent/length mismatch.", name);
                    bytes = decoded.ToArray();
                }
                catch (ICSharpCode.SharpZipLib.SharpZipBaseException ex) { throw Bad("Invalid DEFLATE stream: " + ex.Message, name); }
            }
            if (Crc(bytes) != crc) throw Bad("CRC32 mismatch.", name);
            var extentEnd = dataOffset + csize;
            if ((flags & 8) != 0)
            {
                var descriptor = At(stream, extentEnd, 12);
                // An unsigned descriptor can itself have CRC32 0x08074b50.
                var unsignedMatch = U32(descriptor, 0) == crc && U32(descriptor, 4) == csize && U32(descriptor, 8) == usize;
                var signature = !unsignedMatch && U32(descriptor, 0) == 0x08074b50u;
                if (signature) descriptor = At(stream, extentEnd + 4, 12);
                if (U32(descriptor, 0) != crc || U32(descriptor, 4) != csize || U32(descriptor, 8) != usize)
                    throw Bad("Data descriptor disagrees with directory.", name);
                extentEnd += signature ? 16 : 12;
            }
            if (extentEnd > cd) throw Bad("Entry descriptor overlaps the directory.", name);
            extents.Add((offset, extentEnd));
            if (U16(header, 36) != 0) findings.Add(Findings.Create("MDPK1005", "Internal file attributes must be zero.", name, "error"));
            if (name.StartsWith(".git/objects/pack/", StringComparison.Ordinal) && method != 0)
                findings.Add(Findings.Create("MDPK1008", "Git pack/index/reverse-index must be stored.", name, "error"));
            if (name == Profile.Manifest && (offset != 0 || method != 0 || (flags & 8) != 0 ||
                U16(local, 8) != 0 || (U16(local, 6) & 8) != 0 || U16(local, 28) != 0 ||
                U32(local, 14) != crc || U32(local, 18) != csize || U32(local, 22) != usize))
                findings.Add(Findings.Create("MDPK1006", "Manifest local header does not meet the typing contract.", name, "error"));
            members.Add(new(name, method, flags, crc, csize, usize, offset, U16(header, 36), bytes, dataOffset));
        }
        if (pos != (long)cd + cdSize) throw Bad("Central directory count/size mismatch.");
        var ordered = extents.OrderBy(e => e.Start).ToArray();
        for (var i = 1; i < ordered.Length; i++) if (ordered[i].Start < ordered[i - 1].End) throw Bad("Overlapping ZIP entries.");
        SourceTree.ValidateNames(members.Select(m => m.Name), container: true, Outcome.Nonconforming);
        var magic = "{\"mdpkg\":\"markdown-package/1\""u8;
        var prefix = At(stream, 0, (int)Math.Min(79, stream.Length));
        var typed = prefix.Length == 79 && U32(prefix, 0) == 0x04034b50u && (U16(prefix, 6) & 8) == 0 &&
            U16(prefix, 8) == 0 && U16(prefix, 26) == 20 && U16(prefix, 28) == 0 &&
            prefix.AsSpan(30, 20).SequenceEqual(Profile.Utf8.GetBytes(Profile.Manifest)) && prefix.AsSpan(50, 29).SequenceEqual(magic);
        if (!typed && !findings.Any(f => f.Code == "MDPK1006")) findings.Add(Findings.Create("MDPK1006", "Offset-zero typing failed.", Profile.Manifest, "error"));
        if (comment.Length > 0) findings.Add(Findings.Create("MDPK1009", "EOCD comment is present.", severity: "error"));
        return new(members, findings, typed, comment);
    }
}
