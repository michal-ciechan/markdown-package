using System.Text.RegularExpressions;
using Mdpkg.Reader.Internal.Diagnostics;
namespace Mdpkg.Reader.Tests;
public class DiagnosticCatalogTests
{
    [Fact]
    public void DiagnosticCatalogMatchesSection4()
    {
        var specRows = File.ReadAllLines(AddressingFixture.RepoFile("docs/spec/generator-cli.md"))
            .Select(line => new Regex(@"^\| `(?<code>MDPK\d{4})` \| (?<sev>info|warn|error)\b").Match(line))
            .Where(m => m.Success)
            .ToDictionary(m => m.Groups["code"].Value, m => m.Groups["sev"].Value, StringComparer.Ordinal);
        Assert.NotEmpty(specRows);

        Assert.Equal(specRows.Keys.Order(StringComparer.Ordinal), DiagnosticCatalog.Codes.Keys.Order(StringComparer.Ordinal));
        foreach (var (code, sev) in specRows)
        {
            Assert.Equal(sev, DiagnosticCatalog.Codes[code].Sev);
        }
    }

}
