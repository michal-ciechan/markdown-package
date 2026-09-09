using System.Text.Json.Nodes;

namespace Mdpkg.Cli.Engine;

internal sealed record Check(string Code, string Status);
internal sealed record PackageInfo(string Path, long Bytes, string Sha256, int Entries, string Tier);
internal sealed record EngineResult(Outcome Outcome, PackageInfo? Package, Manifest? Manifest,
    HistoryDetail? History, int OverrideCount, int MintedRoots, IReadOnlyList<Check> Checks,
    IReadOnlyList<Finding> Diagnostics, string? Error = null);
internal sealed record PackRequest(string Source, string Destination, string Namespace,
    bool FromGit = false, string? Scope = null, int? Depth = null, string Message = "Initial package",
    string? Correspondence = null, bool RequireComplete = false, bool FailOnWarning = false,
    int CompressionLevel = 6, bool DataDescriptors = false, bool ReverseIndex = false,
    string ObjectFormat = "sha1", string Anchor = Profile.Anchor, string Digest = Profile.Digest);
internal sealed record ValidateRequest(string Path, bool Deep = false, bool AcceptRecoverable = false,
    string? Namespace = null, string ObjectFormat = "sha1");
internal sealed record EngineSettings(string GitExecutable = "git", string? TemporaryDirectory = null);
