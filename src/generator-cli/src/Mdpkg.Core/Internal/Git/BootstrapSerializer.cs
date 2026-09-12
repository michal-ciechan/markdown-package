namespace Mdpkg.Core.Internal.Git;

internal static class BootstrapSerializer
{
    internal static byte[] Serialize(string tree, string ns, string snapshot) => Profile.Utf8.GetBytes(
        $"tree {tree}\nauthor mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n" +
        $"committer mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000\n\nmdpkg-bootstrap-v1\nnamespace {ns}\nsnapshot {snapshot}\n");
}
