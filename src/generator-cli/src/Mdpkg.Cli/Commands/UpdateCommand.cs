using System.CommandLine;

namespace Mdpkg.Cli.Commands;

/// <summary><c>mdpkg update &lt;in.mdpkg&gt; --out &lt;file.mdpkg&gt; [options]</c>: generation path 2, an incremental update (§9).</summary>
internal static class UpdateCommand
{
    public static Command Create(GlobalOptions globals)
    {
        var tree = new Option<DirectoryInfo>("--tree")
        {
            Description = "New working-tree state; becomes one commit on refs/heads/main (§5.1, §5.2). Required unless --squash is given alone.",
            HelpName = "dir",
        };
        var message = CommonOptions.Message("Commit message; required with --tree (§5.1).");
        var squash = new Option<string>("--squash")
        {
            Description = "Collapse a first-parent range into one emitted commit. Appends squashed to history.transform (§4, D-3).",
            HelpName = "base..tip",
        };
        squash.Validators.Add(result =>
        {
            var value = result.GetValueOrDefault<string>();
            if (value is not null && !value.Contains("..", StringComparison.Ordinal))
            {
                result.AddError($"--squash takes a <base>..<tip> range: '{value}'.");
            }
        });
        var noSummary = new Option<bool>("--no-summary")
        {
            Description = "Squash without a range summary. Every touched-since query over the collapsed range then answers unknown, never untouched (§5.4, §6.7).",
        };
        var truncate = new Option<string>("--truncate")
        {
            Description = "Drop history before base. Sets history.coverage: truncated and root: synthetic; writes .git/shallow only for a genuine shallow clone (§5.3, D-3).",
            HelpName = "base",
        };
        var retainPatches = new Option<bool>("--retain-patches")
        {
            Description = "Archive the exact patch bytes behind every hunk reference the producer has published (§5.5).",
        };

        var command = new Command("update", "Emit a new package from an existing one plus a new tree state or a history transform (§9). Always writes a new file.");
        command.Arguments.Add(CommonOptions.InputPackage());
        command.Options.Add(OutOption.Create(required: true));
        command.Options.Add(tree);
        command.Options.Add(message);
        command.Options.Add(squash);
        command.Options.Add(noSummary);
        command.Options.Add(truncate);
        command.Options.Add(retainPatches);
        command.Options.Add(CommonOptions.RequireComplete());
        command.Options.Add(CommonOptions.Correspondence());
        command.Options.Add(CommonOptions.AcceptRecoverable());

        command.Validators.Add(result =>
        {
            var hasTree = result.GetResult(tree) is not null;
            var hasMessage = result.GetResult(message) is not null;
            var hasSquash = result.GetResult(squash) is not null;
            if (!hasTree && !hasSquash)
            {
                result.AddError("--tree <dir> is required unless --squash is given alone (§9).");
            }

            if (hasTree && !hasMessage)
            {
                result.AddError("--message <text> is required with --tree (§9).");
            }

            if (!hasSquash && result.GetResult(noSummary) is not null)
            {
                result.AddError("--no-summary needs --squash (§9).");
            }
        });

        command.SetAction(parseResult => Stub.Run(parseResult, globals, command.Name));
        return command;
    }
}
