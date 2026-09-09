using System.CommandLine;

namespace Mdpkg.Cli.Commands;

/// <summary><c>mdpkg pack &lt;source-dir&gt; --out &lt;file.mdpkg&gt; [options]</c>: generation path 1, a fresh package (§7).</summary>
internal static class PackCommand
{
    public static Command Create(GlobalOptions globals)
    {
        var sourceDir = new Argument<DirectoryInfo>("source-dir")
        {
            Description = "Document tree that becomes the working tree of current. .git/ is ignored; a real .mdpkg/ outside .mdpkg/address/ is rejected with MDPK1002 (§3.6, §6.3).",
        };
        var fromGit = new Option<bool>("--from-git")
        {
            Description = "Import the source directory's own history instead of synthesising a single root commit (§5.3 sourceRepository, scope).",
        };
        var scope = new Option<string>("--scope")
        {
            Description = "Path projection recorded in history.json as scope; sets history.transform to [\"projected\"] (§4, §5.3, D-3).",
            HelpName = "pathspec",
        };
        var depth = new Option<int?>("--depth")
        {
            Description = "Retain the last n first-parent commits. Sets history.coverage: truncated and root: synthetic (§4, §5.3, D-3).",
            HelpName = "n",
        };
        depth.Validators.Add(result =>
        {
            if (GlobalOptions.IntToken(result) is < 1)
            {
                result.AddError("--depth must be at least 1.");
            }
        });

        var command = new Command("pack", "Emit a fresh package from a source directory (§7).");
        command.Arguments.Add(sourceDir);
        command.Options.Add(OutOption.Create(required: true));
        command.Options.Add(fromGit);
        command.Options.Add(scope);
        command.Options.Add(depth);
        command.Options.Add(CommonOptions.Message("Commit message for the synthesised root (§5.1).", "Initial package"));
        command.Options.Add(CommonOptions.RequireComplete());
        command.Options.Add(CommonOptions.Correspondence());

        // §2: --namespace is required for pack only; the other verbs read it from the input manifest.
        command.Validators.Add(result =>
        {
            if (result.GetResult(globals.Namespace) is null)
            {
                result.AddError("--namespace <uuid> is required for pack (§2).");
            }
        });

        command.SetAction(parseResult => Stub.Run(parseResult, globals, command.Name));
        return command;
    }
}
