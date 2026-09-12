using System.CommandLine;
using Mdpkg.Core;

namespace Mdpkg.Cli.Commands;

/// <summary><c>mdpkg validate &lt;in.mdpkg&gt; [options]</c>: generation path 4, validation only; writes nothing (§11).</summary>
internal static class ValidateCommand
{
    public static Command Create(GlobalOptions globals)
    {
        var deep = new Option<bool>("--deep")
        {
            Description = "Git mode: verify the retained repository, current tree and bootstrap origin with native Git (§7.1, §11.2). Snapshot mode already hashes every current file without Git; --deep adds no repository work.",
        };

        var command = new Command("validate", "Run every §11 check against a package. Writes no package (§11).");
        var input = CommonOptions.InputPackage();
        command.Arguments.Add(input);
        command.Options.Add(deep);
        var recoverable = CommonOptions.AcceptRecoverable();
        command.Options.Add(recoverable);
        command.Validators.Add(result =>
        {
            if (ReportDestination.Error(result.GetValue(globals.Report)?.FullName, [result.GetValue(input)?.FullName]) is { } error)
                result.AddError(error);
        });
        command.SetAction((parse, ct) => EngineAction.RunAsync(parse, globals, command.Name, async () =>
            await new PackageValidator().ValidateFileAsync(parse.GetValue(input)!.FullName, new()
            {
                Deep = parse.GetValue(deep), AcceptRecoverable = parse.GetValue(recoverable),
                ExpectedNamespace = parse.GetValue(globals.Namespace) is { } ns ? Guid.Parse(ns) : null,
                ObjectFormat = parse.GetValue(globals.ObjectFormat)!, Resources = ResourceOptions.ProducerCompatibility
            }, ct), [parse.GetValue(input)!.FullName]));
        return command;
    }
}
