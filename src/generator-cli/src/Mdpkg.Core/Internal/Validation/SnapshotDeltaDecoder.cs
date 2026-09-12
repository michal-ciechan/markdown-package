using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Core.Internal.Validation;

/// <summary>Independent decoder for standard Git copy/insert delta instructions.
/// It knows nothing about the producer's matcher, sampling or encoding helpers.</summary>
internal static class SnapshotDeltaDecoder
{
    private static void Require(bool valid, string message)
    { if (!valid) throw new EngineException(Outcome.Nonconforming, "MDPK4002", message); }

    internal static byte[] Apply(byte[] instructions, byte[] source, long remainingBytes, CancellationToken ct)
    {
        var cursor = 0;
        long Size()
        {
            long result = 0; var shift = 0; byte b;
            do
            {
                Require(cursor < instructions.Length && shift <= 28, "Truncated or overflowing delta size.");
                b = instructions[cursor++]; result |= (long)(b & 127) << shift; shift += 7;
            } while ((b & 128) != 0);
            return result;
        }
        Require(Size() == source.LongLength, "Delta base size mismatch.");
        var size = Size();
        if (size > Array.MaxLength || size > remainingBytes) throw new ResourceLimitException("Reconstructed Git delta exceeds its decoded byte limit.");
        var output = new byte[(int)size]; var written = 0;
        while (cursor < instructions.Length)
        {
            ct.ThrowIfCancellationRequested();
            var opcode = instructions[cursor++];
            Require(opcode != 0, "Reserved zero delta instruction.");
            if ((opcode & 128) == 0)
            {
                Require(opcode <= instructions.Length - cursor && opcode <= output.Length - written, "Delta insertion exceeds its input or result.");
                instructions.AsSpan(cursor, opcode).CopyTo(output.AsSpan(written)); cursor += opcode; written += opcode;
                continue;
            }
            long offset = 0; var count = 0;
            for (var bit = 0; bit < 7; bit++)
            {
                if ((opcode & (1 << bit)) == 0) continue;
                Require(cursor < instructions.Length, "Truncated delta copy operand.");
                if (bit < 4) offset |= (long)instructions[cursor++] << (8 * bit);
                else count |= instructions[cursor++] << (8 * (bit - 4));
            }
            if (count == 0) count = 65536;
            Require(offset <= source.LongLength && count <= source.LongLength - offset && count <= output.Length - written,
                "Delta copy exceeds its base or result.");
            for (var copied = 0; copied < count;)
            {
                ct.ThrowIfCancellationRequested(); var chunk = Math.Min(65536, count - copied);
                source.AsSpan((int)offset + copied, chunk).CopyTo(output.AsSpan(written + copied)); copied += chunk;
            }
            written += count;
        }
        Require(written == output.Length, "Delta result length mismatch.");
        return output;
    }
}
