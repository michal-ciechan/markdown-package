using System.CommandLine;
using System.CommandLine.Invocation;
using Mdpkg.Cli.Commands;

namespace Mdpkg.Cli;

/// <summary>Builds the <c>mdpkg</c> verb tree (docs/spec/generator-cli.md §1) and runs it.</summary>
public static class MdpkgCli
{
    /// <summary>Parses and invokes <paramref name="args"/>, writing to the given streams. Returns the process exit code (§3).</summary>
    public static int Invoke(string[] args, TextWriter stdout, TextWriter stderr)
    {
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(stderr);
        var parseResult = Build().Parse(args);
        if (parseResult.Action is ParseErrorAction parseError)
        {
            // A usage error (§3 exit 1) reports on stderr only. stdout is reserved for the result object under
            // --format json (§5.3), so the default help dump and typo suggestions there would corrupt a machine
            // caller's channel.
            parseError.ShowHelp = false;
            parseError.ShowTypoCorrections = false;
        }

        var exit = parseResult.InvokeAsync(new InvocationConfiguration
        {
            Output = stdout,
            Error = stderr,
        }).GetAwaiter().GetResult();
        if (parseResult.Errors.Count > 0)
        {
            stderr.WriteLine("Run 'mdpkg --help' or 'mdpkg <verb> --help' for usage.");
        }

        return exit;
    }

    /// <summary>The root command with every verb, sub-verb and global option attached.</summary>
    public static RootCommand Build()
    {
        var globals = new GlobalOptions();
        var root = new RootCommand("Emits and checks conforming .mdpkg packages. Tool reference: docs/spec/generator-cli.md; format: docs/spec.md.");
        foreach (var option in globals.All)
        {
            root.Options.Add(option);
        }

        root.Subcommands.Add(PackCommand.Create(globals));
        root.Subcommands.Add(UpdateCommand.Create(globals));
        root.Subcommands.Add(AddressCommand.Create(globals));
        root.Subcommands.Add(ValidateCommand.Create(globals));
        return root;
    }
}
