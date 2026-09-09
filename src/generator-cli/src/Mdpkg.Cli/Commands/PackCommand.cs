using System.CommandLine;
using Mdpkg.Cli.Engine;

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
        var output = OutOption.Create(required: true);
        command.Options.Add(output);
        command.Options.Add(fromGit);
        command.Options.Add(scope);
        command.Options.Add(depth);
        var message = CommonOptions.Message("Commit message for the synthesised root (§5.1).", "Initial package");
        var requireComplete = CommonOptions.RequireComplete();
        var correspondence = CommonOptions.Correspondence();
        command.Options.Add(message);
        command.Options.Add(requireComplete);
        command.Options.Add(correspondence);

        // §2: --namespace is required for pack only; the other verbs read it from the input manifest.
        command.Validators.Add(result =>
        {
            if (result.GetResult(globals.Namespace) is null)
            {
                result.AddError("--namespace <uuid> is required for pack (§2).");
            }
            if (ReportDestination.Error(result.GetValue(globals.Report)?.FullName,
                [result.GetValue(output)?.FullName, result.GetValue(correspondence)?.FullName], result.GetValue(sourceDir)?.FullName) is { } error)
                result.AddError(error);
        });

        command.SetAction(async (parse, ct) => EngineAction.Report(parse, globals, command.Name,
            await new PackageBuilder().PackAsync(new(
                parse.GetValue(sourceDir)!.FullName, parse.GetValue(output)!.FullName, parse.GetValue(globals.Namespace)!,
                parse.GetValue(fromGit), parse.GetValue(scope), parse.GetValue(depth), parse.GetValue(message)!,
                parse.GetValue(correspondence)?.FullName, parse.GetValue(requireComplete), parse.GetValue(globals.FailOnWarning),
                parse.GetValue(globals.CompressionLevel), parse.GetValue(globals.DataDescriptors), parse.GetValue(globals.ReverseIndex),
                parse.GetValue(globals.ObjectFormat)!, parse.GetValue(globals.Anchor)!, parse.GetValue(globals.Digest)!), ct),
            [parse.GetValue(output)!.FullName, parse.GetValue(correspondence)?.FullName], parse.GetValue(sourceDir)!.FullName));
        return command;
    }
}
