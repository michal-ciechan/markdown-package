using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace Mdpkg.Tests;

/// <summary>CRC-correct mutations of the independent original package, without any producer API.</summary>
internal static class MalformedHistoryFixture
{
    internal static readonly string[] Fields = ["transformations", "patches", "addressingCoverage", "ranges", "shallowBoundaries"];
    internal static IEnumerable<object[]> Cases => Fields.Append("all").SelectMany(name =>
        new[] { "only", "first", "last" }.SelectMany(position =>
            new[] { false, true }.Select(deep => new object[] { name, position, deep })));

    internal static (string Code, string Message, string Spec) Diagnostic(string field) => field switch
    {
        "transformations" or "all" => ("MDPK2003", "Manifest/history transformations disagree.", "§4, §5.3, D-3"),
        "shallowBoundaries" => ("MDPK2004", "Invalid shallow boundaries.", "§5.3"),
        "addressingCoverage" => ("MDPK2007", "Invalid addressing coverage ranges.", "§4, §5.3"),
        _ => ("MDPK2007", "Null history evidence item.", "§4, §5.3")
    };

    internal static void Write(string destination, string field, string position)
    {
        var source = FindOriginal();
        using var input = ZipFile.OpenRead(source);
        using var output = ZipFile.Open(destination, ZipArchiveMode.Create);
        foreach (var entry in input.Entries)
        {
            var copy = output.CreateEntry(entry.FullName, CompressionLevel.NoCompression);
            copy.LastWriteTime = entry.LastWriteTime; copy.ExternalAttributes = entry.ExternalAttributes;
            using var read = entry.Open(); using var write = copy.Open();
            if (entry.FullName != ".mdpkg/history.json") { read.CopyTo(write); continue; }
            using var text = new StreamReader(read);
            var history = JsonNode.Parse(text.ReadToEnd())!.AsObject();
            foreach (var name in field == "all" ? Fields : [field])
            {
                var valid = Record(name, history);
                history[name] = position switch
                {
                    "first" => new JsonArray(null, valid),
                    "last" => new JsonArray(valid, null),
                    _ => new JsonArray((JsonNode?)null)
                };
            }
            write.Write(Encoding.UTF8.GetBytes(history.ToJsonString() + "\n"));
        }
    }

    private static JsonNode Record(string field, JsonObject history) => field switch
    {
        "transformations" => new JsonObject { ["kind"] = "projected", ["sourceBase"] = history["sourceBase"]!.DeepClone(),
            ["sourceTip"] = history["sourceTip"]!.DeepClone(), ["emitted"] = history["sourceTip"]!.DeepClone() },
        "patches" => new JsonObject { ["entry"] = ".mdpkg/history/patches/test.patch", ["sha256"] = new string('a', 64),
            ["from"] = history["sourceBase"]!.DeepClone(), ["to"] = history["sourceTip"]!.DeepClone(),
            ["document"] = new string('b', 64), ["profile"] = "git-myers-u3-v1" },
        "addressingCoverage" => history["addressingCoverage"]![0]!.DeepClone(),
        "ranges" => JsonValue.Create(".mdpkg/history/ranges/test.json")!,
        _ => history["sourceBase"]!.DeepClone()
    };

    private static string FindOriginal()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, "docs/spec/review-fixtures/original-git.mdpkg");
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException("Independent original.mdpkg fixture not found.");
    }
}
