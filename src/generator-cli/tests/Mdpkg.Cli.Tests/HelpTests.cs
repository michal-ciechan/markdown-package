namespace Mdpkg.Cli.Tests;

public class HelpTests
{
    [Fact]
    public void RootHelpListsTheFourVerbsInSpecOrder()
    {
        var result = CliRunner.Run("--help");

        Assert.Equal(0, result.Exit);
        var commands = result.Stdout[result.Stdout.IndexOf("Commands:", StringComparison.Ordinal)..];
        var positions = new[] { "pack <source-dir>", "update <in.mdpkg>", "address <in.mdpkg>", "validate <in.mdpkg>" }
            .Select(verb => commands.IndexOf(verb, StringComparison.Ordinal))
            .ToArray();
        Assert.All(positions, p => Assert.True(p >= 0, "every verb is listed"));
        Assert.Equal(positions.OrderBy(p => p), positions);
    }

    [Fact]
    public void RootHelpListsEveryGlobalOption()
    {
        var result = CliRunner.Run("--help");

        foreach (var option in new[]
                 {
                     "--format <text|json>", "--quiet", "--namespace <uuid>", "--anchor <id>", "--digest <id>",
                     "--object-format <id>", "--compression-level <0-9>", "--data-descriptors", "--reverse-index",
                     "--strict-paths", "--fail-on-warning", "--report <file.json>",
                 })
        {
            Assert.Contains(option, result.Stdout, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void AddressHelpListsTheFiveOperations()
    {
        var result = CliRunner.Run("address", "--help");

        Assert.Equal(0, result.Exit);
        var commands = result.Stdout[result.Stdout.IndexOf("Commands:", StringComparison.Ordinal)..];
        foreach (var op in new[] { "move", "retire", "unknown", "mint", "list" })
        {
            Assert.Contains($"\n  {op} ", commands, StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData("pack", "--out <file.mdpkg> (REQUIRED)", "--from-git", "--scope <pathspec>", "--depth <n>", "--message <text>", "--require-complete", "--correspondence <file.json>")]
    [InlineData("update", "--out <file.mdpkg> (REQUIRED)", "--tree <dir>", "--message <text>", "--squash <base..tip>", "--no-summary", "--truncate <base>", "--retain-patches", "--require-complete", "--correspondence <file.json>", "--accept-recoverable")]
    [InlineData("validate", "--deep", "--accept-recoverable")]
    public void VerbHelpListsItsOwnOptionsAndTheGlobals(string verb, params string[] options)
    {
        var result = CliRunner.Run(verb, "--help");

        Assert.Equal(0, result.Exit);
        foreach (var option in options)
        {
            Assert.Contains(option, result.Stdout, StringComparison.Ordinal);
        }

        Assert.Contains("--format <text|json>", result.Stdout, StringComparison.Ordinal);
    }

    [Fact]
    public void ValidateHelpDoesNotOfferOut()
    {
        var result = CliRunner.Run("validate", "--help");

        Assert.DoesNotContain("--out", result.Stdout, StringComparison.Ordinal);
    }

    [Fact]
    public void NoArgumentsIsAUsageError()
    {
        var result = CliRunner.Run();

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains("Required command was not provided", result.Stderr, StringComparison.Ordinal);
    }
}
