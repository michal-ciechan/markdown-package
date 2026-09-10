using System.CommandLine;
using Mdpkg.Core;

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

        command.SetAction((parse, ct) => EngineAction.RunAsync(parse, globals, command.Name, async () =>
        {
            var records = parse.GetValue(correspondence) is { } file
                ? CorrespondenceCodec.Decode(await File.ReadAllBytesAsync(file.FullName, ct)) : null;
            var request = new DirectoryPackageRequest(parse.GetValue(sourceDir)!.FullName, Guid.Parse(parse.GetValue(globals.Namespace)!))
            {
                Mode = parse.GetValue(fromGit) ? CreationMode.GitImport : CreationMode.Snapshot,
                Scope = parse.GetValue(scope), Depth = parse.GetValue(depth), Correspondence = records,
                Metadata = SnapshotMetadata.CliDefault with { Message = parse.GetValue(message)! },
                Options = new()
                {
                    RequireComplete = parse.GetValue(requireComplete), Warnings = parse.GetValue(globals.FailOnWarning) ? WarningPolicy.Fail : WarningPolicy.Report,
                    CompressionLevel = parse.GetValue(globals.CompressionLevel), DataDescriptors = parse.GetValue(globals.DataDescriptors),
                    ReverseIndex = parse.GetValue(globals.ReverseIndex), ObjectFormat = parse.GetValue(globals.ObjectFormat)!,
                    Anchor = parse.GetValue(globals.Anchor)!, Digest = parse.GetValue(globals.Digest)!, Resources = ResourceOptions.ProducerCompatibility
                }
            };
            return await new PackageBuilder().CreateFromDirectoryAsync(request, parse.GetValue(output)!.FullName, ct);
        }, [parse.GetValue(output)!.FullName, parse.GetValue(correspondence)?.FullName], parse.GetValue(sourceDir)!.FullName));
        return command;
    }
}
