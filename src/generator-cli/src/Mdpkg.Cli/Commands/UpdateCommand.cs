using System.CommandLine;
using Mdpkg.Core;

namespace Mdpkg.Cli.Commands;

/// <summary><c>mdpkg update &lt;in.mdpkg&gt; --out &lt;file.mdpkg&gt; [options]</c>: generation path 2, an incremental update (§9).</summary>
internal static class UpdateCommand
{
    public static Command Create(GlobalOptions globals)
    {
        var tree = new Option<DirectoryInfo>("--tree")
        {
            Description = "New working-tree state; append one commit, materializing a snapshot base first (§5.6).",
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

        var materialize = new Option<bool>("--materialize") { Description = "Verify and materialize the exact initial snapshot; re-emit an existing Git package without appending (§5.6)." };
        var input = CommonOptions.InputPackage(); var output = OutOption.Create(required: true);
        var complete = CommonOptions.RequireComplete(); var correspondence = CommonOptions.Correspondence(); var recoverable = CommonOptions.AcceptRecoverable();
        var command = new Command("update", "Materialize an initial snapshot or append a new tree to a supported lineage (§5.6). History transforms remain unsupported.");
        command.Arguments.Add(input);
        command.Options.Add(output);
        command.Options.Add(materialize);
        command.Options.Add(tree);
        command.Options.Add(message);
        command.Options.Add(squash);
        command.Options.Add(noSummary);
        command.Options.Add(truncate);
        command.Options.Add(retainPatches);
        command.Options.Add(complete);
        command.Options.Add(correspondence);
        command.Options.Add(recoverable);

        command.Validators.Add(result =>
        {
            var hasTree = result.GetResult(tree) is not null;
            var hasMessage = result.GetResult(message) is not null;
            var hasSquash = result.GetResult(squash) is not null;
            var hasMaterialize = result.GetValue(materialize);
            if (!hasTree && !hasSquash && !hasMaterialize)
            {
                result.AddError("--tree <dir> is required unless --squash is given alone or --materialize is selected (§9).");
            }

            if (hasTree && !hasMessage)
            {
                result.AddError("--message <text> is required with --tree (§9).");
            }

            if (!hasSquash && result.GetResult(noSummary) is not null)
            {
                result.AddError("--no-summary needs --squash (§9).");
            }
            if (hasMaterialize && (hasTree || hasMessage || hasSquash || result.GetResult(truncate) is not null ||
                result.GetValue(noSummary) || result.GetValue(retainPatches) || result.GetResult(correspondence) is not null))
                result.AddError("--materialize cannot be combined with a tree, commit message, correspondence or history transform.");
            if (result.GetValue(recoverable)) result.AddError("Updating recoverable input is unsupported; repair and validate it first.");
            if (ReportDestination.Error(result.GetValue(globals.Report)?.FullName,
                [result.GetValue(input)?.FullName, result.GetValue(output)?.FullName, result.GetValue(correspondence)?.FullName], result.GetValue(tree)?.FullName) is { } error)
                result.AddError(error);
        });

        command.SetAction((parse, ct) =>
        {
            if (parse.GetResult(squash) is not null || parse.GetResult(truncate) is not null || parse.GetValue(retainPatches))
                return Task.FromResult(Stub.Run(parse, globals, command.Name));
            return EngineAction.RunAsync(parse, globals, command.Name, async () =>
            {
                var options = new CreationOptions { RequireComplete = parse.GetValue(complete),
                    Warnings = parse.GetValue(globals.FailOnWarning) ? WarningPolicy.Fail : WarningPolicy.Report,
                    CompressionLevel = parse.GetValue(globals.CompressionLevel), DataDescriptors = parse.GetValue(globals.DataDescriptors),
                    ReverseIndex = parse.GetValue(globals.ReverseIndex), ObjectFormat = parse.GetValue(globals.ObjectFormat)!,
                    Anchor = parse.GetValue(globals.Anchor)!, Digest = parse.GetValue(globals.Digest)!, Resources = ResourceOptions.ProducerCompatibility };
                var updater = new PackageUpdater();
                if (parse.GetValue(materialize)) return await updater.MaterializeAsync(new(parse.GetValue(input)!.FullName)
                    { Options = options, ExpectedNamespace = parse.GetValue(globals.Namespace) is { } ns ? Guid.Parse(ns) : null }, parse.GetValue(output)!.FullName, ct);
                var records = parse.GetValue(correspondence) is { } file ? CorrespondenceCodec.Decode(await File.ReadAllBytesAsync(file.FullName, ct)) : null;
                return await updater.UpdateAsync(new(parse.GetValue(input)!.FullName, parse.GetValue(tree)!.FullName,
                    SnapshotMetadata.CliDefault with { Message = parse.GetValue(message)! })
                    { Options = options, Correspondence = records, ExpectedNamespace = parse.GetValue(globals.Namespace) is { } expected ? Guid.Parse(expected) : null }, parse.GetValue(output)!.FullName, ct);
            }, [parse.GetValue(input)?.FullName, parse.GetValue(output)?.FullName, parse.GetValue(correspondence)?.FullName], parse.GetValue(tree)?.FullName);
        });
        return command;
    }
}
