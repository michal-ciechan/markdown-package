namespace Mdpkg.Core.Internal.Validation;

internal static class CommitProtocol
{
    internal static void RejectUnverifiedBootstrap(ReadOnlySpan<byte> commit)
    {
        // Metadata may use a legacy encoding. Only the exact ASCII first message
        // line is reserved; do not scan headers, later lines or substring matches.
        var split = commit.IndexOf("\n\n"u8);
        if (split < 0) return;
        var message = commit[(split + 2)..];
        var end = message.IndexOf((byte)'\n');
        var firstLine = end < 0 ? message : message[..end];
        if (firstLine.SequenceEqual("mdpkg-bootstrap-v1"u8))
            throw new EngineException(Outcome.Nonconforming, "MDPK4002",
                "Reserved bootstrap commit requires materialized history and a verified origin; origin verification is unavailable (S3).");
    }
}
