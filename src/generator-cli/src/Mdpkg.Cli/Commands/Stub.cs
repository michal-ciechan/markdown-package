using System.CommandLine;
using Mdpkg.Cli.Reporting;

namespace Mdpkg.Cli.Commands;

/// <summary>
/// The action every verb runs until it is implemented. It honours the output contract (§5.3, §6) so callers can
/// already drive <c>--format json</c> and <c>--report</c>, and it exits <see cref="ExitCode.NotImplemented"/>.
/// </summary>
internal static class Stub
{
    public static int Run(ParseResult parseResult, GlobalOptions globals, string verb)
    {
        var stdout = parseResult.InvocationConfiguration.Output;
        var stderr = parseResult.InvocationConfiguration.Error;
        var result = ResultObject.Empty(verb, ExitCode.NotImplemented);

        // A diagnostic, not progress: emitted regardless of --quiet (§2).
        stderr.WriteLine($"mdpkg {verb}: not implemented. See src/generator-cli/README.md for supported pack, update and validate actions.");

        // --report goes first: a failed write turns the run into an environment error (§3 exit 5), and the object
        // printed on stdout must carry the exit code the process actually returns (§6 exitCode).
        if (parseResult.GetValue(globals.Report) is { } report)
        {
            try
            {
                File.WriteAllText(report.FullName, ResultWriter.ToJson(result));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                stderr.WriteLine($"mdpkg {verb}: cannot write --report {report}: {ex.Message}");
                result = result with { ExitCode = ExitCode.Environment };
            }
        }

        if (parseResult.GetValue(globals.Format) == GlobalOptions.JsonFormat)
        {
            stdout.WriteLine(ResultWriter.ToJson(result));
        }

        return (int)result.ExitCode;
    }
}
