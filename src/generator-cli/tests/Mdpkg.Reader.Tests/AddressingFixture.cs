using System.Text.Json.Nodes;
namespace Mdpkg.Reader.Tests;
internal static class AddressingFixture
{
    public const string Namespace = "c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8";
    public static string RepoFile(string path)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, path))) return Path.Combine(dir.FullName, path);
        throw new FileNotFoundException(path);
    }
    public static JsonNode Recorded => JsonNode.Parse(File.ReadAllText(RepoFile("docs/spec/worked-example.json")))!;
    public const string Guide0 = "# Guide\n\nRead this before the notes.\n\n## Setup\n\nInstall the tool, then run `init`.\n\n## Usage\n\nRun `build` to produce a package.\n";
    public const string Guide1 = Guide0 + "Run `check` to validate it.\n";
    public static string Guide2 => Guide1.Replace("## Setup", "## Installation", StringComparison.Ordinal);
    public const string Notes = "# Notes\n\n## Todo\n\n- write the guide\n";
}
