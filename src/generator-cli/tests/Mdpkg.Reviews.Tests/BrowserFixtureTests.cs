using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class BrowserFixtureTests
{
    [Fact]
    public async Task SupersededBrowserWireSchemaIsRejectedWithoutCompatibilityParsing()
    {
        // S5 replaces the browser writer. This historical export uses string-valued current.
        using var input = File.OpenRead(Fixtures.Repo("src/web-viewer/tests/fixtures/browser-v2.mdpkg"));
        var result = await new ReviewExtractor().ExtractAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(ReviewOutcome.Malformed, result.Outcome);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK2007");
    }
}
