using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine;
using Mdpkg.Cli.Engine.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Cli.Engine.Sources;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Cli.Tests;

public class AddressingTests
{
    public static IEnumerable<object[]> CommonMarkCases =>
        JsonNode.Parse(File.ReadAllText(EngineFixture.RepoFile("src/generator-cli/tests/Mdpkg.Cli.Tests/Fixtures/commonmark-0.31.2.json")))!.AsArray()
            .Select(c => new object[] { c!["example"]!.GetValue<int>(), c["markdown"]!.GetValue<string>(), c["entities"]!.ToJsonString() });

    [Theory]
    [MemberData(nameof(CommonMarkCases))]
    public void CommonMarkInventoryMatchesIndependentReferenceParser(int example, string markdown, string expectedJson)
    {
        var expected = JsonNode.Parse(expectedJson)!.AsArray();
        var actual = Inventory.Document(Profile.Utf8.GetBytes(markdown), "spec.md", CliRunner.Namespace, TestContext.Current.CancellationToken);
        Assert.True(expected.Count == actual.Count, $"Example {example}: expected {expected.Count} entities; got {actual.Count}.");
        for (var i = 0; i < actual.Count; i++)
        {
            Assert.Equal(expected[i]!["locator"]!.ToJsonString(), actual[i].Locator.ToJsonString());
            Assert.Equal(expected[i]!["root"]!.GetValue<string>(), actual[i].Root);
            Assert.Equal(expected[i]!["digest"]!.GetValue<string>(), actual[i].Digest);
        }
    }
    [Theory]
    [InlineData("c1")]
    [InlineData("c2")]
    public void EveryRecordedWorkedExampleRootAndDigestMatches(string snapshot)
    {
        var actual = Inventory.Snapshot([new("guide.md", Profile.Utf8.GetBytes(snapshot == "c1" ? EngineFixture.Guide1 : EngineFixture.Guide2)),
            new("notes.md", Profile.Utf8.GetBytes(EngineFixture.Notes))], CliRunner.Namespace, TestContext.Current.CancellationToken);
        var expected = EngineFixture.Recorded["inventories"]![snapshot]!.AsObject();
        Assert.Equal(expected.Count, actual.Count);
        foreach (var (root, row) in expected)
        {
            Assert.True(actual.TryGetValue(root, out var entity), "Missing recorded root " + root);
            Assert.Equal(row!["digest"]!.GetValue<string>(), entity.Digest);
            Assert.True(JsonNode.DeepEquals(row["locator"], entity.Locator));
        }
    }
    [Fact]
    public void CommonMarkUsesDirectHeadingsAndExactMultilineSetextSource()
    {
        const string text = "preamble\n\n# Top ##  \n\n> # Quote\n\n- # List\n\n```\n# Fence\n```\n\n<div>\n# Html\n</div>\n\nMulti\nline *title*\n---\n\n## Same\ntext\n\n## Same\n";
        var entities = Inventory.Document(Profile.Utf8.GetBytes(text), "x.md", CliRunner.Namespace, TestContext.Current.CancellationToken);
        Assert.Equal(6, entities.Count);
        Assert.Equal("preamble\n", Inventory.CanonicalSource("preamble\n\n \t\n"));
        Assert.Equal("# Top ##  ", entities[2].Locator[2]![0]![0]!.GetValue<string>());
        Assert.Equal("Multi\nline *title*\n---", entities[3].Locator[2]![1]![0]!.GetValue<string>());
        Assert.Equal(0, entities[4].Locator[2]![1]![1]!.GetValue<int>());
        Assert.Equal(1, entities[5].Locator[2]![1]![1]!.GetValue<int>());
        Assert.Equal(Inventory.Digest("section", text[text.IndexOf("# Top", StringComparison.Ordinal)..]), entities[2].Digest);
    }
    [Fact]
    public void BomIsRetainedAndUnicodeIsNotNormalizedForAddressing()
    {
        var bom = Inventory.Document(Profile.Utf8.GetBytes("\ufeff# Heading\r\nbody\r"), "x.md", CliRunner.Namespace, TestContext.Current.CancellationToken);
        Assert.Equal(Inventory.Digest("document", "\ufeff# Heading\nbody\n"), bom[0].Digest);
        Assert.NotEqual(Inventory.Digest("document", "é"), Inventory.Digest("document", "e\u0301"));
        Assert.Equal(2, Inventory.Document(Profile.Utf8.GetBytes("no headings"), "x.md", CliRunner.Namespace, TestContext.Current.CancellationToken).Count);
    }
    [Fact]
    public void CanonicalJsonSortsUtf8AndPreservesSupplementaryUnicode()
    {
        var value = new JsonObject { ["😀"] = "é < & 😀", ["\ue000"] = 1, ["a"] = "\t\n\u0001" };
        Assert.Equal("{\"a\":\"\\t\\n\\u0001\",\"\ue000\":1,\"😀\":\"é < & 😀\"}\n", CanonicalJson.Text(value));
        Assert.Throws<JsonException>(() => CanonicalJson.Parse("{\"a\":1,\"a\":2}"u8.ToArray(), ct: TestContext.Current.CancellationToken));
    }
    [Theory]
    [InlineData("README.md", "readme.md")]
    [InlineData("café.md", "cafe\u0301.md")]
    [InlineData("ς.md", "σ.md")]
    [InlineData("ſ.md", "s.md")]
    [InlineData("\U00010400.md", "\U00010428.md")]
    [InlineData("K.md", "k.md")]
    public void Unicode17NfcSimpleFoldCollisionsAreRejected(string first, string second)
    {
        var ex = Assert.Throws<EngineException>(() => SourceTree.ValidateNames([first, second]));
        Assert.Equal("MDPK1001", ex.Code);
    }
    [Fact]
    public void SimpleFoldDoesNotPerformFullCaseFoldExpansion()
    { SourceTree.ValidateNames(["ß.md", "ss.md", "İ.md", "i.md"]); }
    [Theory]
    [InlineData("/a.md")][InlineData("a/../b.md")][InlineData("a/./b.md")]
    [InlineData("a\\b.md")][InlineData("C:/a.md")][InlineData("a//b.md")][InlineData("a\0b.md")]
    public void UnsafeNamesAreRejected(string path) => Assert.Equal("MDPK1003", Assert.Throws<EngineException>(() => SourceTree.ValidateNames([path])).Code);
    [Theory]
    [InlineData(".MDPKG/manifest.json")][InlineData(".Git/config")][InlineData(".mdpkg/history.json")]
    public void ReservedNamesAreRejected(string path) => Assert.Equal("MDPK1002", Assert.Throws<EngineException>(() => SourceTree.ValidateNames([path])).Code);
    [Fact]
    public void FileDirectoryCollisionIsRejectedInEitherOrder()
    {
        Assert.Throws<EngineException>(() => SourceTree.ValidateNames(["a", "A/b.md"]));
        Assert.Throws<EngineException>(() => SourceTree.ValidateNames(["a/b.md", "A"]));
    }
}
