using System.Buffers.Binary;
using ICSharpCode.SharpZipLib.Checksum;
using ICSharpCode.SharpZipLib.Zip.Compression;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;
namespace Mdpkg.Reader.Internal.Container;
internal sealed record ZipMember(string Name, ushort Method, ushort Flags, uint Crc, uint CompressedSize,
    uint Size, uint Offset, ushort InternalAttributes, byte[] Bytes, long DataOffset);
internal sealed record ZipContents(IReadOnlyList<ZipMember> Members, IReadOnlyList<Finding> Findings, bool Typed, string Comment);

internal sealed record ZipEntry(string Name, ushort Method, ushort Flags, uint Crc, uint CompressedSize,
    uint Size, uint Offset, ushort InternalAttributes, long DataOffset);
internal sealed record ZipIndex(IReadOnlyList<ZipEntry> Members, IReadOnlyList<Finding> Findings, bool Typed, string Comment);
internal static class ZipReader
{
    public static uint Crc(byte[] bytes) { var crc = new Crc32(); crc.Update(bytes); return (uint)crc.Value; }
    public static void CheckLimits(long size, long count)
    {
        // The all-ones values are sentinels, not usable ZIP32 values.
        if (size >= uint.MaxValue || count >= ushort.MaxValue)
            throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 is not supported.");
    }
    private static ushort U16(byte[] b, int offset) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(offset, 2));
    private static uint U32(byte[] b, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(offset, 4));
    private static EngineException Bad(string message, string? name = null) => new(Outcome.Nonconforming, "MDPK1011", message, name);
    private static byte[] At(Stream s, long offset, int size, CancellationToken ct = default)
    {
        if (offset < 0 || size < 0 || offset > s.Length - size) throw Bad("ZIP extent lies outside the file.");
        s.Position = offset; var data = new byte[size]; var read = 0;
        while (read < size)
        {
            ct.ThrowIfCancellationRequested();
            var count = s.Read(data, read, Math.Min(65536, size - read));
            if (count == 0) throw Bad("Unexpected end of ZIP extent.");
            read += count;
        }
        ct.ThrowIfCancellationRequested();
        return data;
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
    public static ZipIndex Index(Stream stream, ReadLimits limits, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        CheckLimits(stream.Length, 0);
        if (stream.Length > limits.MaxInputBytes) throw new ResourceLimitException("Package input exceeds its byte limit.");
        var tailStart = Math.Max(0, stream.Length - 22);
        var tail = At(stream, tailStart, (int)(stream.Length - tailStart));
        if (tail.Length < 22 || U32(tail, 0) != 0x06054b50u || U16(tail, 20) != 0)
        {
            tailStart = Math.Max(0, stream.Length - 65557);
            tail = At(stream, tailStart, (int)(stream.Length - tailStart));
        }
        var end = -1;
        for (var p = tail.Length - 22; p >= 0; p--)
            if (U32(tail, p) == 0x06054b50u && p + 22 + U16(tail, p + 20) == tail.Length) { end = p; break; }
        if (end < 0) throw Bad("EOCD record is absent or truncated.");
        if (U16(tail, end) == 0xffff) throw Bad("Invalid EOCD.");
        var count = U16(tail, end + 10); var cdSize = U32(tail, end + 12); var cd = U32(tail, end + 16);
        var eocdOffset = tailStart + end;
        if (count == 0xffff || cdSize == uint.MaxValue || cd == uint.MaxValue ||
            (eocdOffset >= 20 && U32(At(stream, eocdOffset - 20, 4), 0) == 0x07064b50))
            throw new EngineException(Outcome.Nonconforming, "MDPK1010", "ZIP64 sentinels/locator are unsupported.");
        if (U16(tail, end + 4) != 0 || U16(tail, end + 6) != 0 || U16(tail, end + 8) != count || (long)cd + cdSize != tailStart + end)
            throw Bad("Multi-disk or inconsistent central directory.");
        if (count > limits.MaxEntries || cdSize > limits.MaxDirectoryBytes) throw new ResourceLimitException("ZIP directory exceeds its limit.");
        var comment = Profile.Utf8.GetString(tail.AsSpan(end + 22));
        var findings = new List<Finding>();
        var members = new List<ZipEntry>();
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
            SourceRules.ValidatePath(name, Outcome.Nonconforming);
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
            members.Add(new(name, method, flags, crc, csize, usize, offset, U16(header, 36), dataOffset));
        }
        if (pos != (long)cd + cdSize) throw Bad("Central directory count/size mismatch.");
        var ordered = extents.OrderBy(e => e.Start).ToArray();
        for (var i = 1; i < ordered.Length; i++) if (ordered[i].Start < ordered[i - 1].End) throw Bad("Overlapping ZIP entries.");
        SourceRules.ValidateNames(members.Select(m => m.Name), container: true, Outcome.Nonconforming);
        var magic = "{\"mdpkg\":\"markdown-package/1\""u8;
        var prefix = At(stream, 0, (int)Math.Min(79, stream.Length));
        var typed = prefix.Length == 79 && U32(prefix, 0) == 0x04034b50u && (U16(prefix, 6) & 8) == 0 &&
            U16(prefix, 8) == 0 && U16(prefix, 26) == 20 && U16(prefix, 28) == 0 &&
            prefix.AsSpan(30, 20).SequenceEqual(Profile.Utf8.GetBytes(Profile.Manifest)) && prefix.AsSpan(50, 29).SequenceEqual(magic);
        if (!typed && !findings.Any(f => f.Code == "MDPK1006")) findings.Add(Findings.Create("MDPK1006", "Offset-zero typing failed.", Profile.Manifest, "error"));
        if (comment.Length > 0) findings.Add(Findings.Create("MDPK1009", "EOCD comment is present.", severity: "error"));
        return new(members, findings, typed, comment);
    }

    public static byte[] ReadMember(Stream stream, ZipEntry entry, long maximumBytes, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var (name, method, flags, crc, csize, usize, offset, attributes, dataOffset) = entry;
        if (usize > maximumBytes || usize > int.MaxValue || csize > int.MaxValue || csize - 65536L > maximumBytes)
            throw new ResourceLimitException("Decoded entry exceeds its byte limit: " + name);
        var encoded = At(stream, dataOffset, (int)csize, ct);
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
        return bytes;
    }
    public static ZipContents Read(Stream stream, CancellationToken ct)
    {
        var index = Index(stream, ReadLimits.Producer, ct);
        var members = index.Members.Select(e => new ZipMember(e.Name, e.Method, e.Flags, e.Crc, e.CompressedSize,
            e.Size, e.Offset, e.InternalAttributes, ReadMember(stream, e, int.MaxValue, ct), e.DataOffset)).ToArray();
        return new(members, index.Findings, index.Typed, index.Comment);
    }
}
