namespace Mdpkg.Cli.Tests;

/// <summary>§3 exit 1: unknown option, missing argument, malformed UUID or qualified ID, and the §2/§7/§9/§10 option rules.</summary>
public class OptionValidationTests
{
    private static readonly string[] Pack = ["pack", "./docs", "--out", "x.mdpkg", "--namespace", CliRunner.Namespace];

    [Theory]
    [InlineData("Unrecognized command or argument '--bogus'", "--bogus")]
    [InlineData("Unrecognized command or argument 'frobnicate'", "frobnicate")]
    [InlineData("Unrecognized command or argument '--out'", "validate", "in.mdpkg", "--out", "x.mdpkg")]
    [InlineData("Option '--out' is required", "pack", "./docs", "--namespace", CliRunner.Namespace)]
    [InlineData("Option '--out' is required", "update", "in.mdpkg", "--tree", "./docs", "--message", "m")]
    [InlineData("Required argument missing for command: 'validate'", "validate")]
    public void UsageErrorsExitOne(string expectedError, params string[] args)
    {
        var result = CliRunner.Run(args);

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains(expectedError, result.Stderr, StringComparison.Ordinal);
        Assert.Equal(string.Empty, result.Stdout);
    }

    [Fact]
    public void PackRequiresNamespace()
    {
        var result = CliRunner.Run("pack", "./docs", "--out", "x.mdpkg");

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains("--namespace <uuid> is required for pack", result.Stderr, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("C1B2D3E4-5F60-4A71-8B92-A3B4C5D6E7F8")]
    [InlineData("not-a-uuid")]
    [InlineData("c1b2d3e45f604a718b92a3b4c5d6e7f8")]
    [InlineData("{c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8}")]
    public void NamespaceMustBeALowercaseUuid(string value)
    {
        var result = CliRunner.Run("validate", "in.mdpkg", "--namespace", value);

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains("--namespace must be a lowercase UUID", result.Stderr, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("--format", "xml")]
    [InlineData("--object-format", "md5")]
    [InlineData("--compression-level", "10")]
    [InlineData("--compression-level", "-1")]
    [InlineData("--compression-level", "fast")]
    [InlineData("--strict-paths", "false")]
    [InlineData("--depth", "0")]
    [InlineData("--depth", "many")]
    public void MalformedGlobalOrPackValuesExitOne(string option, string value)
    {
        var result = CliRunner.Run([.. Pack, option, value]);

        Assert.Equal((int)ExitCode.Usage, result.Exit);
    }

    [Theory]
    [InlineData("--strict-paths")]
    [InlineData("--strict-paths", "true")]
    [InlineData("--compression-level", "0")]
    [InlineData("--compression-level", "9")]
    [InlineData("--object-format", "sha256")]
    [InlineData("--data-descriptors")]
    [InlineData("--reverse-index")]
    [InlineData("--fail-on-warning")]
    [InlineData("--anchor", "cm0312-trail-source-v1")]
    [InlineData("--digest", "cm0312-source-lf-v1")]
    public void WellFormedGlobalValuesParse(params string[] extra)
    {
        Assert.Empty(MdpkgCli.Build().Parse([.. Pack, "--history", "git", .. extra]).Errors);
    }

    [Fact]
    public void BooleanFlagsDoNotSwallowTheNextPositionalToken()
    {
        Assert.Empty(MdpkgCli.Build().Parse(["pack", "--data-descriptors", "./docs", "--out", "x.mdpkg", "--namespace", CliRunner.Namespace]).Errors);
    }

    [Theory]
    [InlineData("--tree <dir> is required unless --squash is given alone", "update", "in.mdpkg", "--out", "o.mdpkg")]
    [InlineData("--message <text> is required with --tree", "update", "in.mdpkg", "--out", "o.mdpkg", "--tree", "./docs")]
    [InlineData("--no-summary needs --squash", "update", "in.mdpkg", "--out", "o.mdpkg", "--tree", "./docs", "--message", "m", "--no-summary")]
    [InlineData("--squash takes a <base>..<tip> range", "update", "in.mdpkg", "--out", "o.mdpkg", "--squash", "ab")]
    public void UpdateOptionRulesExitOne(string expectedError, params string[] args)
    {
        var result = CliRunner.Run(args);

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains(expectedError, result.Stderr, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("move", "--root", CliRunner.Root, "--to", "section:guide.md:# Guide/0")]
    [InlineData("retire", "--root", CliRunner.Root, "--reason", "deleted")]
    [InlineData("unknown", "--root", CliRunner.Root, "--reason", "why")]
    [InlineData("mint", "--locator", "section:x.md:# X/0")]
    public void AddressWritingOperationsRequireOut(string op, params string[] opArgs)
    {
        var result = CliRunner.Run(["address", "in.mdpkg", op, .. opArgs]);

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains($"--out <file.mdpkg> is required for address {op}", result.Stderr, StringComparison.Ordinal);
    }

    [Fact]
    public void AddressListDoesNotRequireOut()
    {
        var result = CliRunner.Run("address", "in.mdpkg", "list");

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("B656498700000000000000000000000000000000000000000000000000000000")]
    [InlineData("b65649870000000000000000000000000000000000000000000000000000000")]
    public void RootsMustBeSixtyFourLowercaseHexDigits(string root)
    {
        var move = CliRunner.Run("address", "in.mdpkg", "--out", "o.mdpkg", "move", "--root", root, "--to", "x");
        var confirm = CliRunner.Run("address", "in.mdpkg", "--confirm", root, "list");

        Assert.Equal((int)ExitCode.Usage, move.Exit);
        Assert.Contains("--root must be an origin root of 64 lowercase hex digits", move.Stderr, StringComparison.Ordinal);
        Assert.Equal((int)ExitCode.Usage, confirm.Exit);
        Assert.Contains("--confirm must be an origin root of 64 lowercase hex digits", confirm.Stderr, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("split")]
    [InlineData("merge")]
    [InlineData("deleted")]
    public void RetireAcceptsTheThreeReasons(string reason)
    {
        var result = CliRunner.Run("address", "in.mdpkg", "--out", "o.mdpkg", "retire", "--root", CliRunner.Root, "--reason", reason);

        Assert.Equal((int)ExitCode.NotImplemented, result.Exit);
    }

    [Fact]
    public void RetireRejectsAnyOtherReason()
    {
        var result = CliRunner.Run("address", "in.mdpkg", "--out", "o.mdpkg", "retire", "--root", CliRunner.Root, "--reason", "other");

        Assert.Equal((int)ExitCode.Usage, result.Exit);
        Assert.Contains("Argument 'other' not recognized", result.Stderr, StringComparison.Ordinal);
    }
}
