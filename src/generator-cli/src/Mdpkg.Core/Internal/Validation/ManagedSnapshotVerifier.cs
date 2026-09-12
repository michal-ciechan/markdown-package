using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using ICSharpCode.SharpZipLib;
using ICSharpCode.SharpZipLib.Checksum;
using ICSharpCode.SharpZipLib.Zip.Compression;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Core.Internal.Validation;

/// <summary>Restricted full-object snapshot decoder; never uses the writer's tables or serializer.
/// Container, ledger and inventory checks remain in PackageValidator. Binary failures are MDPK4002.</summary>
internal static class ManagedSnapshotVerifier
{
    private sealed record ObjectData(string Id, int Kind, byte[] Bytes, int Offset, uint Crc);
    private static EngineException Bad(string message, string code = "MDPK4002") => new(Outcome.Nonconforming, code, message);
    private static void Require(bool condition, string message, string code = "MDPK4002")
    { if (!condition) throw Bad(message, code); }
    private static uint U32(byte[] bytes, int offset) => BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(offset, 4));
    private static void Checksum(byte[] bytes)
    {
        Require(bytes.Length >= 20 && SHA1.HashData(bytes.AsSpan(0, bytes.Length - 20)).AsSpan().SequenceEqual(bytes.AsSpan(bytes.Length - 20)), "Git checksum mismatch.");
    }

    internal static void Verify(Manifest manifest, HistoryDetail history, ZipMember[] gitEntries,
        List<EntryData> view, ResourceOptions resources, CancellationToken ct)
    {
        Require(manifest.Review is null && manifest.History.Coverage == "complete" && manifest.History.Transform.Length == 0 &&
            history.Root == "original" && history.RetainedCommits == 1 && history.SourceBase == manifest.Current && history.SourceTip == manifest.Current &&
            history.Transformations.Length == 0 && history.ShallowBoundaries.Length == 0 && history.Ranges.Length == 0 && history.Patches.Length == 0 &&
            history.Bindings is null && history.Scope is null && history.SourceRepository is null && !gitEntries.Any(e => e.Name == ".git/shallow"),
            "Unsupported managed snapshot history shape.", "MDPK2003");
        Require(history.AddressingCoverage.Length == 1 && history.AddressingCoverage[0].From == manifest.Current &&
            history.AddressingCoverage[0].To == manifest.Current && history.AddressingCoverage[0].Coverage == manifest.Addressing.Coverage,
            "Snapshot coverage disagrees with its sole commit.", "MDPK2007");
        var packEntry = gitEntries.Single(e => e.Name.EndsWith(".pack", StringComparison.Ordinal));
        var stem = packEntry.Name[..^5];
        var pack = packEntry.Bytes;
        var index = gitEntries.Single(e => e.Name == stem + ".idx").Bytes;
        var reverse = gitEntries.SingleOrDefault(e => e.Name == stem + ".rev")?.Bytes;
        // A snapshot has one commit, at most one blob per file and at most one
        // tree per directory occurrence. Reject excessive object tables before
        // allocating them, even if their declared decoded payloads are tiny.
        var maximumObjects = 2L + view.Count + view.Sum(e => (long)e.Name.Count(c => c == '/'));
        var objects = Decode(pack, index, reverse, resources, maximumObjects, ct);
        Require(objects.TryGetValue(manifest.Current[5..], out var commit) && commit.Kind == 1 && objects.Values.Count(o => o.Kind == 1) == 1,
            "Snapshot must contain exactly one current commit.");
        var text = Profile.Utf8.GetString(commit!.Bytes);
        var split = text.IndexOf("\n\n", StringComparison.Ordinal);
        Require(split >= 0 && !text.Contains('\0') && text.EndsWith('\n'), "Malformed snapshot commit.");
        var headers = text[..split].Split('\n');
        Require(headers.Length == 3 && headers[0].StartsWith("tree ", StringComparison.Ordinal) && Profile.Oid("sha1-" + headers[0][5..]),
            "Snapshot commit must have one tree and no parents or extra headers.");
        // Same identity domain as the public metadata contract; validate syntax independently.
        const string identity = @"[^<>\r\n\x00]+ <[^<>\r\n\x00]+> (?:0|[1-9][0-9]*) [+-][0-9]{4}";
        Require(Regex.IsMatch(headers[1], "\\Aauthor " + identity + "\\z", RegexOptions.CultureInvariant) &&
            Regex.IsMatch(headers[2], "\\Acommitter " + identity + "\\z", RegexOptions.CultureInvariant), "Malformed commit identities.");
        foreach (var header in headers.Skip(1))
        {
            var time = header[(header.LastIndexOf('>') + 2)..].Split(' ');
            Require(long.TryParse(time[0], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _) &&
                int.Parse(time[1].AsSpan(1, 2), CultureInfo.InvariantCulture) <= 14 &&
                int.Parse(time[1].AsSpan(3, 2), CultureInfo.InvariantCulture) < 60 &&
                (time[1].AsSpan(1, 2).SequenceEqual("14") ? time[1].EndsWith("00", StringComparison.Ordinal) : true), "Invalid commit timestamp or offset.");
        }
        var reached = new HashSet<string>(StringComparer.Ordinal) { commit.Id };
        var tip = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var pending = new Stack<(string Id, string Path)>(); pending.Push((headers[0][5..], ""));
        // Each nonempty tree occurrence must lead to at least one view file. This
        // budget also prevents hostile DAG expansion before its paths can be compared.
        long pathBudget = 1L + view.Sum(e => (long)e.Name.Count(c => c == '/'));
        while (pending.TryPop(out var next))
        {
            ct.ThrowIfCancellationRequested();
            Require(pathBudget-- > 0, "Tree expansion exceeds the current view.");
            Require(objects.TryGetValue(next.Id, out var tree) && tree.Kind == 2, "Missing tree or wrong link type.");
            reached.Add(next.Id);
            Require(next.Path.Length == 0 || tree!.Bytes.Length > 0, "Snapshot contains an empty directory.");
            var bytes = tree!.Bytes; var position = 0; byte[]? previous = null;
            var names = new HashSet<string>(StringComparer.Ordinal);
            while (position < bytes.Length)
            {
                ct.ThrowIfCancellationRequested();
                var nul = Array.IndexOf(bytes, (byte)0, position);
                Require(nul > position && nul <= bytes.Length - 21, "Truncated tree entry.");
                var entry = Profile.Utf8.GetString(bytes, position, nul - position);
                var space = entry.IndexOf(' ');
                Require(space > 0, "Missing tree mode.");
                var mode = entry[..space]; var name = entry[(space + 1)..];
                Require(mode is "40000" or "100644", "Noncanonical snapshot tree mode.");
                Require(name.Length > 0 && !name.Contains('/') && name is not "." and not ".." && names.Add(name), "Invalid or duplicate tree basename.");
                SnapshotGitRules.Name(name);
                var order = Profile.Utf8.GetBytes(name + (mode == "40000" ? "/" : ""));
                Require(previous is null || previous.AsSpan().SequenceCompareTo(order) < 0, "Tree entries are out of Git basename order."); previous = order;
                var path = next.Path + name;
                SourceRules.ValidatePath(path, Outcome.Nonconforming);
                var id = Convert.ToHexStringLower(bytes.AsSpan(nul + 1, 20)); position = nul + 21;
                if (mode == "40000")
                {
                    Require(!SnapshotGitRules.Special(name, ".gitmodules", "gi7eba") && !SnapshotGitRules.Special(name, ".gitattributes", "gi7d29"), "Git special entry must be a blob.");
                    pending.Push((id, path + "/"));
                }
                else
                {
                    Require(objects.TryGetValue(id, out var blob) && blob.Kind == 3, "Missing blob or wrong link type.");
                    reached.Add(id);
                    Require(tip.Count < view.Count && tip.TryAdd(path, blob!.Bytes), "Extra or duplicate tracked path.", "MDPK2001");
                    if (blob!.Bytes.LongLength > resources.MemberLimit(path)) throw new ResourceLimitException("Retained blob exceeds its byte limit.");
                    SnapshotGitRules.Blob(name, blob.Bytes, ct);
                }
            }
        }
        Require(reached.Count == objects.Count, "Pack contains unreachable objects.");
        Require(tip.Count == view.Count && view.All(e => tip.TryGetValue(e.Name, out var bytes) && bytes.AsSpan().SequenceEqual(e.Bytes)),
            "Current view differs from the snapshot tree.", "MDPK2001");
        // Exact byte/path equality makes the shared strict UTF-8/LF, ledger targets,
        // reserved births and coverage checks apply to every retained blob as well.
    }

    private static Dictionary<string, ObjectData> Decode(byte[] pack, byte[] index, byte[]? reverse, ResourceOptions resources, long maximumObjects, CancellationToken ct)
    {
        Require(pack.Length >= 32 && pack.AsSpan(0, 4).SequenceEqual("PACK"u8) && U32(pack, 4) == 2, "Unsupported pack header.");
        Checksum(pack); Checksum(index);
        var count = U32(pack, 8);
        Require(count >= 2 && count <= (pack.Length - 32) / 9 && count <= maximumObjects, "Invalid object count.");
        // Current entry payloads cannot reach 2 GiB; large-offset tables are unreachable.
        Require(index.LongLength == 1072L + 28L * count && index.AsSpan(0, 4).SequenceEqual(new byte[] { 255, 116, 79, 99 }) &&
            U32(index, 4) == 2 && index.AsSpan(index.Length - 40, 20).SequenceEqual(pack.AsSpan(pack.Length - 20)), "Invalid index layout or pack binding.");
        var objects = new Dictionary<string, ObjectData>(StringComparer.Ordinal);
        var byOffset = new List<ObjectData>(); var position = 12; long decodedBytes = 0;
        var buffer = new byte[65536];
        for (var i = 0; i < count; i++)
        {
            ct.ThrowIfCancellationRequested();
            Require(position < pack.Length - 20, "Truncated pack object.");
            var offset = position; var b = pack[position++]; var kind = (b >> 4) & 7; long length = b & 15; var shift = 4;
            Require(kind is 1 or 2 or 3, "Unsupported object kind or delta.");
            while ((b & 128) != 0)
            {
                Require(position < pack.Length - 20 && shift <= 25, "Invalid object size header.");
                b = pack[position++]; length |= (long)(b & 127) << shift; shift += 7;
                Require((b & 128) != 0 || b != 0, "Noncanonical object size header.");
            }
            if (length > Array.MaxLength || length > resources.ReadLimits.MaxDecodedBytes - decodedBytes)
                throw new ResourceLimitException("Decoded Git objects exceed their byte limit.");
            decodedBytes += length;
            var inflater = new Inflater(noHeader: false);
            inflater.SetInput(pack, position, pack.Length - 20 - position);
            using var payload = new MemoryStream();
            try
            {
                while (!inflater.IsFinished)
                {
                    ct.ThrowIfCancellationRequested();
                    var read = inflater.Inflate(buffer);
                    Require(read > 0 || inflater.IsFinished, "Incomplete zlib stream.");
                    Require(read <= length - payload.Length, "Object exceeds its declared length.");
                    payload.Write(buffer, 0, read);
                }
            }
            catch (SharpZipBaseException ex) { throw Bad("Invalid zlib stream: " + ex.Message); }
            Require(payload.Length == length, "Object decoded length mismatch.");
            position = pack.Length - 20 - inflater.RemainingInput;
            var bytes = payload.ToArray();
            var type = kind == 1 ? "commit" : kind == 2 ? "tree" : "blob";
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
            hash.AppendData(System.Text.Encoding.ASCII.GetBytes(type + " " + length.ToString(CultureInfo.InvariantCulture) + "\0")); hash.AppendData(bytes);
            var id = Convert.ToHexStringLower(hash.GetHashAndReset());
            var crc = new Crc32(); crc.Update(new ArraySegment<byte>(pack, offset, position - offset));
            var obj = new ObjectData(id, kind, bytes, offset, (uint)crc.Value);
            Require(objects.TryAdd(id, obj), "Duplicate object identity."); byOffset.Add(obj);
        }
        Require(position == pack.Length - 20, "Trailing pack data or incorrect object count.");
        var sorted = objects.Values.OrderBy(o => o.Id, StringComparer.Ordinal).ToArray(); var cumulative = 0;
        for (var bucket = 0; bucket < 256; bucket++)
        {
            while (cumulative < sorted.Length && Convert.FromHexString(sorted[cumulative].Id)[0] <= bucket) cumulative++;
            Require(U32(index, 8 + bucket * 4) == cumulative, "Incorrect index fanout.");
        }
        for (var i = 0; i < sorted.Length; i++)
        {
            ct.ThrowIfCancellationRequested();
            Require(Convert.ToHexStringLower(index.AsSpan(1032 + i * 20, 20)) == sorted[i].Id &&
                U32(index, 1032 + sorted.Length * 20 + i * 4) == sorted[i].Crc &&
                U32(index, 1032 + sorted.Length * 24 + i * 4) == sorted[i].Offset, "Index object ID, CRC or offset mismatch.");
        }
        if (reverse is not null)
        {
            Checksum(reverse);
            Require(reverse.LongLength == 52L + 4L * count && reverse.AsSpan(0, 4).SequenceEqual("RIDX"u8) &&
                U32(reverse, 4) == 1 && U32(reverse, 8) == 1 && reverse.AsSpan(reverse.Length - 40, 20).SequenceEqual(pack.AsSpan(pack.Length - 20)), "Invalid reverse index.");
            var positions = sorted.Select((o, i) => (o.Id, i)).ToDictionary(o => o.Id, o => o.i, StringComparer.Ordinal);
            for (var i = 0; i < byOffset.Count; i++) Require(U32(reverse, 12 + i * 4) == positions[byOffset[i].Id], "Reverse index permutation mismatch.");
        }
        return objects;
    }
}
