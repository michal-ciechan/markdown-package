namespace Mdpkg.Cli.Tests;

/// <summary>Runs the verb tree in-process with captured streams, the way <c>Program.Main</c> does with the console.</summary>
internal static class CliRunner
{
    public const string Namespace = "c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8";
    public const string Root = "b656498700000000000000000000000000000000000000000000000000000000";

    public static CliResult Run(params string[] args)
    {
        var stdout = new StringWriter();
        var stderr = new StringWriter();
        var exit = MdpkgCli.Invoke(args, stdout, stderr);
        return new CliResult(exit, stdout.ToString(), stderr.ToString());
    }
}

internal sealed record CliResult(int Exit, string Stdout, string Stderr);
