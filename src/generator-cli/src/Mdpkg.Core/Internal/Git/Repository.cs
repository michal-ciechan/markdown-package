using Mdpkg.Reader.Internal.Format;
using Mdpkg.Core.Internal.Sources;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Core.Internal.Git;

internal sealed class Repository(GitProcess git, string path, ResourceOptions? resources = null)
{
    public string Path { get; } = path;
    public Task<string> InitializeAsync(CancellationToken ct) => git.TextAsync(Path, ct, "init", "--bare", "--object-format=sha1", "--initial-branch=main", "--template=");
    public async Task<string> ObjectAsync(string kind, byte[] bytes, CancellationToken ct) =>
        Profile.Utf8.GetString(await git.RunAsync(Path, ["hash-object", "-w", "-t", kind, "--stdin"], bytes, ct)).Trim();
    public async Task<string> TreeAsync(IReadOnlyList<EntryData> entries, CancellationToken ct)
    {
        var blobs = new Dictionary<string, (string Id, string Mode)>(StringComparer.Ordinal);
        foreach (var e in entries) blobs[e.Name] = (await ObjectAsync("blob", e.Bytes, ct), e.Mode);
        async Task<string> Build(Dictionary<string, (string Id, string Mode)> files)
        {
            var lines = new List<string>();
            foreach (var group in files.GroupBy(e => e.Key.Split('/')[0]).OrderBy(g => g.Key, Utf8Comparer.Instance))
            {
                var first = group.First();
                if (!first.Key.Contains('/')) lines.Add($"{first.Value.Mode} blob {first.Value.Id}\t{first.Key}\0");
                else
                {
                    var nested = group.ToDictionary(e => e.Key[(group.Key.Length + 1)..], e => e.Value, StringComparer.Ordinal);
                    lines.Add($"040000 tree {await Build(nested)}\t{group.Key}\0");
                }
            }
            return Profile.Utf8.GetString(await git.RunAsync(Path, ["mktree", "-z"], Profile.Utf8.GetBytes(string.Concat(lines)), ct)).Trim();
        }
        return await Build(blobs);
    }
    public Task<string> CommitAsync(string tree, string? parent, string message, CancellationToken ct, SnapshotMetadata? metadata = null)
    {
        metadata ??= SnapshotMetadata.CliDefault with { Message = message };
        static string Identity(CommitIdentity identity)
        {
            var offset = identity.Time.Offset;
            return $"{identity.Name} <{identity.Email}> {identity.Time.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)} {(offset < TimeSpan.Zero ? "-" : "+")}{Math.Abs(offset.Hours):00}{Math.Abs(offset.Minutes):00}";
        }
        return ObjectAsync("commit", Profile.Utf8.GetBytes($"tree {tree}\n" + (parent is null ? "" : $"parent {parent}\n") +
            $"author {Identity(metadata.Author)}\ncommitter {Identity(metadata.Committer)}\n\n{message.TrimEnd('\n')}\n"), ct);
    }
    public Task<byte[]> ReadObjectAsync(string kind, string id, CancellationToken ct) => git.RunAsync(Path, ["cat-file", kind, id], null, ct);
    public async Task<List<EntryData>> ReadTreeAsync(string commit, string? scope, List<Finding> findings, bool normalize, CancellationToken ct)
    {
        var args = new List<string> { "ls-tree", "-r", "-z", "--full-tree", commit };
        // ls-tree returns the full tree. diff-tree against the empty tree below supplies
        // Git's full pathspec selection without opening or changing any index.
        var raw = Profile.Utf8.GetString(await git.RunAsync(Path, args, null, ct));
        var rows = raw.Split('\0', StringSplitOptions.RemoveEmptyEntries).Select(line =>
        {
            var tab = line.IndexOf('\t'); var meta = line[..tab].Split(' ');
            return (Name: line[(tab + 1)..], Mode: meta[0], Kind: meta[1], Id: meta[2]);
        }).ToArray();
        HashSet<string>? selected = null;
        if (scope is not null)
        {
            // Git's tree pathspec engine is used by diff-tree, with rename detection disabled.
            var selectedBytes = await git.RunAsync(Path, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", EmptyTree, commit + "^{tree}", "--", scope], null, ct);
            selected = Profile.Utf8.GetString(selectedBytes).Split('\0', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        }
        var included = rows.Where(r => selected is null || selected.Contains(r.Name)).ToArray();
        if (included.Length > (resources ?? ResourceOptions.ProducerCompatibility).ReadLimits.MaxEntries) throw new Mdpkg.Reader.ResourceLimitException("Source entry count exceeds its limit.");
        SourceTree.ValidateNames(included.Select(r => r.Name), outcome: normalize ? Outcome.InvalidSource : Outcome.Nonconforming);
        var result = new List<EntryData>();
        long total = 0;
        foreach (var r in included)
        {
            if (r.Kind != "blob" || r.Mode is not ("100644" or "100755"))
                throw new EngineException(normalize ? Outcome.InvalidSource : Outcome.Nonconforming, "MDPK1003", "Git links and submodules are not current-view text files.", r.Name);
            var policy = resources ?? ResourceOptions.ProducerCompatibility;
            var size = long.Parse(await git.TextAsync(Path, ct, "cat-file", "-s", r.Id), System.Globalization.CultureInfo.InvariantCulture);
            ResourceGuard.Source(r.Name, size, ref total, policy);
            var bytes = await ReadObjectAsync("blob", r.Id, ct);
            // The CLI emits fixed 100644 ZIP attributes (§8). Its Git trees must agree,
            // otherwise extraction + read-tree would show a mode change on Unix.
            result.Add(new(r.Name, normalize ? SourceTree.Normalize(bytes, r.Name, findings) : bytes, normalize ? "100644" : r.Mode));
        }
        return result;
    }
    public const string EmptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    public async Task<List<EntryData>> CurateAsync(string head, bool reverse, CancellationToken ct)
    {
        var packed = await git.RunAsync(Path, ["pack-objects", "--stdout", "--revs", "--delta-base-offset"], Profile.Utf8.GetBytes(head + "\n"), ct);
        var hash = Convert.ToHexStringLower(packed.AsSpan(packed.Length - 20));
        var name = "pack-" + hash;
        var packPath = System.IO.Path.Combine(Path, "objects", "pack", name + ".pack");
        await File.WriteAllBytesAsync(packPath, packed, ct);
        var args = new List<string> { "index-pack", "--strict" };
        if (reverse) args.Add("--rev-index");
        args.Add(packPath);
        await git.RunAsync(Path, args, null, ct);
        var entries = new List<EntryData>
        {
            new(".git/HEAD", Profile.Utf8.GetBytes("ref: refs/heads/main\n")),
            new(".git/config", Profile.Utf8.GetBytes(Profile.Config)),
            new(".git/refs/heads/main", Profile.Utf8.GetBytes(head + "\n")),
        };
        if (reverse) entries.Add(new(".git/objects/pack/" + name + ".rev", await File.ReadAllBytesAsync(System.IO.Path.ChangeExtension(packPath, ".rev"), ct)));
        entries.Add(new(".git/objects/pack/" + name + ".idx", await File.ReadAllBytesAsync(System.IO.Path.ChangeExtension(packPath, ".idx"), ct)));
        entries.Add(new(".git/objects/pack/" + name + ".pack", packed));
        return entries;
    }
}
