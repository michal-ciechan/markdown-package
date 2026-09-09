using System.CommandLine;
using Mdpkg.Cli.Engine.Validation;

namespace Mdpkg.Cli.Commands;

/// <summary><c>mdpkg validate &lt;in.mdpkg&gt; [options]</c>: generation path 4, validation only; writes nothing (§11).</summary>
internal static class ValidateCommand
{
    public static Command Create(GlobalOptions globals)
    {
        var deep = new Option<bool>("--deep")
        {
            Description = "Additionally read the pack: hash every current-view entry as a Git blob and compare with the tip tree; run git fsck --full --strict (§7.1, §11.2 item 13).",
        };

        var command = new Command("validate", "Run every §11 check against a package. Writes no package (§11).");
        var input = CommonOptions.InputPackage();
        command.Arguments.Add(input);
        command.Options.Add(deep);
        var recoverable = CommonOptions.AcceptRecoverable();
        command.Options.Add(recoverable);
        command.Validators.Add(result =>
        {
            if (result.GetValue(globals.Report)?.FullName is { } report && string.Equals(report, result.GetValue(input)?.FullName, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                result.AddError("--report must not overwrite the input package.");
        });
        command.SetAction(async (parse, ct) => EngineAction.Report(parse, globals, command.Name,
            await new PackageValidator().ValidateAsync(new(parse.GetValue(input)!.FullName, parse.GetValue(deep),
                parse.GetValue(recoverable), parse.GetValue(globals.Namespace), parse.GetValue(globals.ObjectFormat)!), ct)));
        return command;
    }
}
