using System.Globalization;
using System.Text.RegularExpressions;
using Mdpkg.Cli.Reporting;

namespace Mdpkg.Cli.Tests;

/// <summary>
/// The tool reference, docs/spec/generator-cli.md, is the contract. These tests read it so that a verb, exit code
/// or diagnostic added or re-classified there fails here until the scaffold mirrors it.
/// </summary>
public partial class SpecConsistencyTests
{
    private static readonly string[] SpecLines = File.ReadAllLines(FindRepoFile(Path.Combine("docs", "spec", "generator-cli.md")));

    [Fact]
    public void VerbTreeMatchesSection1()
    {
        var specVerbs = Section(1)
            .Select(line => InvocationLine().Match(line))
            .Where(m => m.Success)
            .Select(m => m.Groups["verb"].Value)
            .Distinct()
            .ToArray();
        Assert.Equal(["pack", "update", "address", "validate"], specVerbs);

        var verbs = MdpkgCli.Build().Subcommands.Select(c => c.Name).ToArray();
        Assert.Equal(specVerbs, verbs);
    }

    [Fact]
    public void AddressOperationsMatchSection10()
    {
        var specOps = Section(10)
            .Select(line => OperationRow().Match(line))
            .Where(m => m.Success)
            .Select(m => m.Groups["op"].Value)
            .ToArray();
        Assert.Equal(["move", "retire", "unknown", "mint", "list"], specOps);

        var address = MdpkgCli.Build().Subcommands.Single(c => c.Name == "address");
        Assert.Equal(specOps, address.Subcommands.Select(c => c.Name).ToArray());
    }

    [Fact]
    public void ExitCodesMatchSection3()
    {
        var specCodes = Section(3)
            .Select(line => ExitCodeRow().Match(line))
            .Where(m => m.Success)
            .Select(m => int.Parse(m.Groups["code"].Value, CultureInfo.InvariantCulture))
            .ToArray();
        Assert.Equal([0, 1, 2, 3, 4, 5], specCodes);

        var enumCodes = Enum.GetValues<ExitCode>().Select(c => (int)c).ToArray();
        Assert.Equal(specCodes, enumCodes.Where(c => c <= specCodes.Max()).ToArray());
        Assert.DoesNotContain((int)ExitCode.NotImplemented, specCodes);
    }

    [Fact]
    public void DiagnosticCatalogMatchesSection4()
    {
        var specRows = Section(4)
            .Select(line => DiagnosticRow().Match(line))
            .Where(m => m.Success)
            .ToDictionary(m => m.Groups["code"].Value, m => m.Groups["sev"].Value, StringComparer.Ordinal);
        Assert.NotEmpty(specRows);

        Assert.Equal(specRows.Keys.Order(StringComparer.Ordinal), DiagnosticCatalog.Codes.Keys.Order(StringComparer.Ordinal));
        foreach (var (code, sev) in specRows)
        {
            Assert.Equal(sev, DiagnosticCatalog.Codes[code].Sev);
        }
    }

    /// <summary>The lines of the top-level section numbered <paramref name="number"/>, up to the next top-level heading.</summary>
    private static IEnumerable<string> Section(int number)
    {
        var heading = $"## {number}. ";
        var start = Array.FindIndex(SpecLines, line => line.StartsWith(heading, StringComparison.Ordinal));
        Assert.True(start >= 0, $"section {number} exists");
        return SpecLines.Skip(start + 1).TakeWhile(line => !line.StartsWith("## ", StringComparison.Ordinal));
    }

    private static string FindRepoFile(string relative)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, relative);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"{relative} not found above {AppContext.BaseDirectory}");
    }

    // `mdpkg pack     <source-dir>  --out <file.mdpkg>   [options]   # fresh package`
    [GeneratedRegex(@"^mdpkg\s+(?<verb>[a-z]+)\s+<")]
    private static partial Regex InvocationLine();

    // `| `move --root --to` | ...` in the §10 operations table
    [GeneratedRegex(@"^\| `(?<op>[a-z]+)( [^`]*)?` \| ")]
    private static partial Regex OperationRow();

    // `| 0 | Success. ... | §4 |`
    [GeneratedRegex(@"^\| (?<code>\d+) \| ")]
    private static partial Regex ExitCodeRow();

    // `| `MDPK1004` | warn on write, error on `validate` | ...`: the first word is the writing verbs' default severity
    [GeneratedRegex(@"^\| `(?<code>MDPK\d{4})` \| (?<sev>info|warn|error)\b")]
    private static partial Regex DiagnosticRow();
}
