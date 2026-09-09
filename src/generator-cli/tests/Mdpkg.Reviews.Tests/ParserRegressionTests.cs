using System.Text;
using System.Text.Json.Nodes;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class ParserRegressionTests
{
    [Theory]
    [InlineData("null")][InlineData("[]")][InlineData("\"text\"")]
    [InlineData("42")][InlineData("true")][InlineData("false")]
    public async Task NonObjectCommentsRootReturnsTypedMalformedResult(string json)
    {
        using var input = new MemoryStream(Fixtures.Rewrite(Fixtures.Bytes("delta-v2.mdpkg"), entries =>
            entries[".mdpkg/review/comments.json"] = Encoding.UTF8.GetBytes(json + "\n")));

        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(ReviewOutcome.Malformed, result.Outcome);
        Assert.Equal(SchemaStatus.Malformed, result.SchemaStatus);
        Assert.Empty(result.Items);
        Assert.Empty(result.Threads);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal("MalformedReview", diagnostic.Code);
        Assert.Equal("Comments document root must be a JSON object.", diagnostic.Message);
    }

    public static IEnumerable<object[]> ExtensionDepthCases()
    {
        foreach (var location in new[] { "document", "thread", "comment", "selector" })
        {
            // The review reproduction exceeds the serializer default of 64, but not the configured cap.
            yield return [location, 70, 128];
            foreach (var limit in new[] { 32, 128, 256 })
                foreach (var depth in new[] { limit - 1, limit, limit + 1 })
                    yield return [location, depth, limit];
        }
    }

    [Theory]
    [MemberData(nameof(ExtensionDepthCases))]
    public async Task ExtensionCopiesHonorConfiguredDocumentDepth(string location, int depth, int limit)
    {
        var parentDepth = location switch { "document" => 1, "thread" => 3, "comment" => 5, _ => 4 };
        var extensionDepth = depth - parentDepth;
        using var input = new MemoryStream(Fixtures.Review(document =>
        {
            var thread = document["threads"]![0]!;
            var parent = location switch { "document" => document, "thread" => thread,
                "comment" => thread["comments"]![0]!, _ => thread["select"]! };
            JsonNode nested = JsonValue.Create("retained")!;
            for (var i = 0; i < extensionDepth; i++) nested = new JsonObject { ["child"] = nested };
            parent["extension"] = nested;
        }));

        var result = await new ReviewExtractor().ExtractAsync(input,
            new() { Limits = new() { MaxJsonDepth = limit } }, TestContext.Current.CancellationToken);

        if (depth > limit)
        {
            Assert.Equal(ReviewOutcome.ResourceLimitExceeded, result.Outcome);
            Assert.Equal("ResourceLimitExceeded", Assert.Single(result.Diagnostics).Code);
            Assert.Empty(result.Items);
            Assert.Empty(result.Threads);
            return;
        }
        Assert.Equal(ReviewOutcome.Success, result.Outcome);
        Assert.Equal(SchemaStatus.Valid, result.SchemaStatus);
        Assert.Empty(result.Diagnostics);
        Assert.Equal(new[] { "Explain these words.", "This reply keeps source order." }, result.Items.Select(i => i.Body));
        var extensions = location switch { "document" => result.Extensions!, "thread" => result.Threads[0].Extensions,
            "comment" => result.Threads[0].Comments[0].Extensions, _ => result.Threads[0].Anchor.Selector.Extensions! };
        var preserved = extensions["extension"];
        for (var i = 0; i < extensionDepth; i++) preserved = preserved.GetProperty("child");
        Assert.Equal("retained", preserved.GetString());
    }
}
