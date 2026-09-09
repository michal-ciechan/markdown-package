using Mdpkg.Reader.Internal.Container;
using System.IO.Compression;
using Mdpkg.Cli.Engine.Sources;
namespace Mdpkg.Cli.Engine.Container;
internal static class ZipContainer
{
    public static uint Crc(byte[] bytes) => ZipReader.Crc(bytes);
    public static void CheckLimits(long size, long count) => ZipReader.CheckLimits(size, count);
    public static ZipContents Read(Stream stream, CancellationToken ct) => ZipReader.Read(stream, ct);
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
}
