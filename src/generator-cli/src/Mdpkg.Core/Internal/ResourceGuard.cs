using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Container;

namespace Mdpkg.Core.Internal;

internal static class ResourceGuard
{
    internal static void Source(string name, long size, ref long total, ResourceOptions resources)
    {
        if (size > resources.MemberLimit(name) || size > resources.MaxSourceBytes - total)
            throw new ResourceLimitException("Source exceeds its byte limit: " + name);
        total += size;
    }
    internal static void Entries(IReadOnlyList<EntryData> entries, ResourceOptions resources)
    {
        if (entries.Count > resources.ReadLimits.MaxEntries) throw new ResourceLimitException("Archive entry count exceeds its limit.");
        long total = 0;
        foreach (var entry in entries)
        {
            if (entry.Bytes.LongLength > resources.MemberLimit(entry.Name) || entry.Bytes.LongLength > resources.ReadLimits.MaxDecodedBytes - total)
                throw new ResourceLimitException("Archive decoded bytes exceed their limit: " + entry.Name);
            total += entry.Bytes.LongLength;
        }
    }
    internal static ZipContents Read(Stream file, ResourceOptions resources, CancellationToken ct)
    {
        var index = ZipReader.Index(file, resources.ReadLimits, ct);
        long total = 0;
        foreach (var entry in index.Members)
        {
            if (entry.Size > resources.MemberLimit(entry.Name) || entry.Size > resources.ReadLimits.MaxDecodedBytes - total)
                throw new ResourceLimitException("Archive decoded bytes exceed their limit: " + entry.Name);
            total += entry.Size;
        }
        // Traverse lazily through Reader's indexed, bounded CRC/decompression path. No eager whole-archive payload array.
        var members = index.Members.Select(e => new ZipMember(e.Name, e.Method, e.Flags, e.Crc, e.CompressedSize,
            e.Size, e.Offset, e.InternalAttributes, [], e.DataOffset)
        {
            ReadPayload = () => ZipReader.ReadMember(file, e, resources.MemberLimit(e.Name), ct)
        }).ToArray();
        // Full validation includes every member's CRC, including unused Git index payloads.
        foreach (var member in members) { ct.ThrowIfCancellationRequested(); _ = member.Bytes; }
        return new(members, index.Findings, index.Typed, index.Comment);
    }
}
