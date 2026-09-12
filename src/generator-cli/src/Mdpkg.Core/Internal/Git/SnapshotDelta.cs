using System.Buffers.Binary;

namespace Mdpkg.Core.Internal.Git;

/// <summary>Bounded, deterministic substring matching for Git blob deltas. A base
/// index samples at most 65,536 blocks; each target position probes at most eight
/// candidates. The caller limits the base window and never chains deltas.</summary>
internal sealed class SnapshotDelta
{
    private const int Block = 16;
    private readonly byte[] source;
    private readonly int stride;
    private readonly int[] heads = new int[65536];
    private readonly int[] next;

    internal SnapshotDelta(byte[] source, CancellationToken ct)
    {
        this.source = source;
        stride = Math.Max(Block, (int)((source.LongLength + 65535) / 65536));
        var count = source.Length < Block ? 0 : (source.Length - Block) / stride + 1;
        next = new int[count]; Array.Fill(heads, -1);
        for (var i = 0; i < count; i++)
        {
            if ((i & 4095) == 0) ct.ThrowIfCancellationRequested();
            var bucket = Bucket(source.AsSpan(i * stride, Block));
            next[i] = heads[bucket]; heads[bucket] = i;
        }
    }

    internal byte[]? Encode(byte[] target, long budget, CancellationToken ct)
    {
        budget = Math.Min(budget, target.Length);
        using var delta = new MemoryStream();
        WriteSize(delta, source.Length); WriteSize(delta, target.Length);
        var position = 0; var literal = 0;
        while (position <= target.Length - Block)
        {
            if ((position & 4095) == 0) ct.ThrowIfCancellationRequested();
            var best = -1; var length = 0; var probes = 0;
            for (var candidate = heads[Bucket(target.AsSpan(position, Block))]; candidate >= 0 && probes++ < 8; candidate = next[candidate])
            {
                var start = candidate * stride;
                if (!source.AsSpan(start, Block).SequenceEqual(target.AsSpan(position, Block))) continue;
                var matched = Block; var maximum = Math.Min(source.Length - start, target.Length - position);
                while (matched < maximum && source[start + matched] == target[position + matched])
                {
                    if ((matched & 65535) == 0) ct.ThrowIfCancellationRequested();
                    matched++;
                }
                if (matched > length) { best = start; length = matched; }
            }
            if (best < 0) { position++; continue; }
            // Recover the bytes before a sampled block, up to the preceding copy.
            while (position > literal && best > 0 && target[position - 1] == source[best - 1])
            {
                if ((position & 65535) == 0) ct.ThrowIfCancellationRequested();
                position--; best--; length++;
            }
            if (!Insert(delta, target, literal, position - literal, budget, ct)) return null;
            if (!Copy(delta, best, length, budget)) return null;
            position += length; literal = position;
        }
        ct.ThrowIfCancellationRequested();
        if (!Insert(delta, target, literal, target.Length - literal, budget, ct)) return null;
        return delta.Length <= budget ? delta.ToArray() : null;
    }

    private static int Bucket(ReadOnlySpan<byte> bytes)
    {
        var value = BinaryPrimitives.ReadUInt64LittleEndian(bytes) ^ System.Numerics.BitOperations.RotateLeft(BinaryPrimitives.ReadUInt64LittleEndian(bytes[8..]), 23);
        value ^= value >> 33; value = unchecked(value * 0xff51afd7ed558ccdUL); value ^= value >> 33;
        return (int)(value & 65535);
    }
    private static void WriteSize(Stream stream, int size)
    {
        do { var b = size & 127; size >>= 7; stream.WriteByte((byte)(b | (size == 0 ? 0 : 128))); } while (size != 0);
    }
    private static bool Insert(MemoryStream stream, byte[] bytes, int offset, int length, long budget, CancellationToken ct)
    {
        while (length > 0)
        {
            ct.ThrowIfCancellationRequested();
            var count = Math.Min(127, length);
            if (stream.Length + count + 1 > budget) return false;
            stream.WriteByte((byte)count); stream.Write(bytes, offset, count); offset += count; length -= count;
        }
        return true;
    }
    private static bool Copy(MemoryStream stream, int offset, int length, long budget)
    {
        Span<byte> instruction = stackalloc byte[8];
        while (length > 0)
        {
            var size = Math.Min(0xffffff, length); var count = 1; var opcode = 128;
            for (var i = 0; i < 4; i++)
            {
                var b = (byte)((uint)offset >> (8 * i));
                if (b != 0) { opcode |= 1 << i; instruction[count++] = b; }
            }
            // Zero size is Git's compact encoding for a 64 KiB copy.
            var encodedSize = size == 65536 ? 0 : size;
            for (var i = 0; i < 3; i++)
            {
                var b = (byte)(encodedSize >> (8 * i));
                if (b != 0) { opcode |= 1 << (4 + i); instruction[count++] = b; }
            }
            instruction[0] = (byte)opcode;
            if (stream.Length + count > budget) return false;
            stream.Write(instruction[..count]); offset += size; length -= size;
        }
        return true;
    }
}
