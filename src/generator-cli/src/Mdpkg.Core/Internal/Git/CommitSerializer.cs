using System.Globalization;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Core.Internal.Git;

internal static class CommitSerializer
{
    internal static byte[] Serialize(string tree, string? parent, string message, SnapshotMetadata? metadata)
    {
        metadata ??= SnapshotMetadata.CliDefault with { Message = message };
        static string Identity(CommitIdentity identity)
        {
            var offset = identity.Time.Offset;
            return FormattableString.Invariant($"{identity.Name} <{identity.Email}> {identity.Time.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)} {(offset < TimeSpan.Zero ? "-" : "+")}{Math.Abs(offset.Hours):00}{Math.Abs(offset.Minutes):00}");
        }
        return Profile.Utf8.GetBytes($"tree {tree}\n" + (parent is null ? "" : $"parent {parent}\n") +
            $"author {Identity(metadata.Author)}\ncommitter {Identity(metadata.Committer)}\n\n{message.TrimEnd('\n')}\n");
    }
}
