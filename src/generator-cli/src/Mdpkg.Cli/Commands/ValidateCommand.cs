using System.CommandLine;

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
        command.Arguments.Add(CommonOptions.InputPackage());
        command.Options.Add(deep);
        command.Options.Add(CommonOptions.AcceptRecoverable());
        command.SetAction(parseResult => Stub.Run(parseResult, globals, command.Name));
        return command;
    }
}
