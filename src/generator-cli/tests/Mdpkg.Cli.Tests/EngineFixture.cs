using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine;
using Mdpkg.Cli.Engine.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Engine.Git;
using Mdpkg.Cli.Engine.IO;

namespace Mdpkg.Cli.Tests;

internal sealed class EngineFixture : IDisposable
{
    private readonly TemporaryDirectory temp = new();
    public string Root => temp.Path;
    public string Source { get; }
    public string Output => Path.Combine(Root, "test.mdpkg");
    public EngineFixture() { Source = Path.Combine(Root, "source"); Directory.CreateDirectory(Source); }
    public void Write(string path, string text) => Write(path, Profile.Utf8.GetBytes(text));
    public void Write(string path, byte[] bytes)
    { var full = Path.Combine(Source, path); Directory.CreateDirectory(Path.GetDirectoryName(full)!); File.WriteAllBytes(full, bytes); }
    public PackRequest Request => new(Source, Output, CliRunner.Namespace);
    public static string RepoFile(string path)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, path))) return Path.Combine(dir.FullName, path);
        throw new FileNotFoundException(path);
    }
    public static JsonNode Recorded => JsonNode.Parse(File.ReadAllText(RepoFile("docs/spec/worked-example.json")))!;
    public static List<EntryData> Read(string path)
    { using var stream = File.OpenRead(path); return ZipContainer.Read(stream, TestContext.Current.CancellationToken).Members.Select(e => new EntryData(e.Name, e.Bytes)).ToList(); }
    public static void Rewrite(string path, List<EntryData> entries, bool descriptors = false)
    { using var file = File.Create(path); ZipContainer.Write(file, entries, 6, descriptors, TestContext.Current.CancellationToken); }
    public static void Success(EngineResult result) => Assert.True(result.Outcome == Outcome.Success,
        result.Outcome + ": " + result.Error + " " + string.Join("; ", result.Diagnostics.Select(d => d.Code + ": " + d.Message)));
    public const string Guide0 = "# Guide\n\nRead this before the notes.\n\n## Setup\n\nInstall the tool, then run `init`.\n\n## Usage\n\nRun `build` to produce a package.\n";
    public const string Guide1 = Guide0 + "Run `check` to validate it.\n";
    public static string Guide2 => Guide1.Replace("## Setup", "## Installation", StringComparison.Ordinal);
    public const string Notes = "# Notes\n\n## Todo\n\n- write the guide\n";
    public async Task<(Repository Repo, string[] Commits)> WorkedRepositoryAsync()
    {
        var path = Path.Combine(Root, "source.git"); Directory.CreateDirectory(path);
        var repo = new Repository(new GitProcess("git"), path); await repo.InitializeAsync(TestContext.Current.CancellationToken);
        var commits = new List<string>();
        var messages = new[] { "Base: guide and notes", "Document the check command", "Rename Setup to Installation" };
        foreach (var (guide, i) in new[] { Guide0, Guide1, Guide2 }.Select((g, i) => (g, i)))
        {
            var entries = new List<EntryData> { new("guide.md", Profile.Utf8.GetBytes(guide)), new("notes.md", Profile.Utf8.GetBytes(Notes)) };
            if (i == 2) entries.Add(new(Profile.Ledger, Profile.Utf8.GetBytes(Recorded["ledger_bytes"]!.GetValue<string>())));
            var tree = await repo.TreeAsync(entries, TestContext.Current.CancellationToken);
            var author = $"Example Author <author@example.invalid> {1700000000 + i * 100} +0000";
            var bytes = Profile.Utf8.GetBytes($"tree {tree}\n" + (i == 0 ? "" : $"parent {commits[^1]}\n") + $"author {author}\ncommitter {author}\n\n{messages[i]}\n");
            commits.Add(await repo.ObjectAsync("commit", bytes, TestContext.Current.CancellationToken));
        }
        Directory.CreateDirectory(Path.Combine(path, "refs", "heads"));
        File.WriteAllText(Path.Combine(path, "refs", "heads", "main"), commits[^1] + "\n");
        return (repo, commits.ToArray());
    }
    public void Dispose() => temp.Dispose();
}
