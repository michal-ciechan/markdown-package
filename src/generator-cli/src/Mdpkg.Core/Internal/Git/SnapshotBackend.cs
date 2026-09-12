namespace Mdpkg.Core.Internal.Git;

internal static class SnapshotBackend
{
    // Candidate-only builds let installed-tool acceptance exercise the same default
    // call sites without adding a CLI/API backend option. Release remains gated.
#if MDPKG_MANAGED_SNAPSHOT_CANDIDATE
    internal const bool DefaultManaged = true;
#else
    internal const bool DefaultManaged = false;
#endif
}
