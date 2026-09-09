using System.CommandLine;

namespace Mdpkg.Cli.Commands;

/// <summary>
/// <c>mdpkg address &lt;in.mdpkg&gt; --out &lt;file.mdpkg&gt; &lt;op&gt; ...</c>: generation path 3, sparse addressing exception
/// marking in the tracked ledger <c>.mdpkg/address/overrides.json</c> (§10). <c>list</c> writes no package.
/// </summary>
internal static class AddressCommand
{
    public static Command Create(GlobalOptions globals)
    {
        // --out precedes the operation in the spec's syntax, so it lives on `address` and recurses into every op.
        var outOption = OutOption.Create(required: false);
        outOption.Recursive = true;
        var fromCandidates = new Option<FileInfo>("--from-candidates")
        {
            Description = "Load rename suggestions for review; none is written without an explicit --confirm <root> (§6.3, §9).",
            HelpName = "file",
            Recursive = true,
        };
        var confirm = CommonOptions.WithRootValidation(new Option<string[]>("--confirm")
        {
            Description = "Confirm one candidate from --from-candidates by its origin root. Repeatable (§6.3).",
            HelpName = "root",
            Recursive = true,
        });

        var command = new Command("address", "Record producer-confirmed addressing exceptions in the tracked ledger and commit the change (§10).");
        command.Arguments.Add(CommonOptions.InputPackage());
        command.Options.Add(outOption);
        command.Options.Add(fromCandidates);
        command.Options.Add(confirm);

        command.Subcommands.Add(WritingOp(Move(), globals, outOption));
        command.Subcommands.Add(WritingOp(Retire(), globals, outOption));
        command.Subcommands.Add(WritingOp(Unknown(), globals, outOption));
        command.Subcommands.Add(WritingOp(Mint(), globals, outOption));
        command.Subcommands.Add(List(globals));
        return command;
    }

    private static Command Move()
    {
        var command = new Command("move", "Record {\"to\": [scopeKind, path, trail]}: the reference resolves at the recorded locator; chains are flattened on update (§6.3, §6.5 step 2).");
        command.Options.Add(CommonOptions.Root());
        command.Options.Add(new Option<string>("--to")
        {
            Description = "Current locator: scopeKind:path:trail, for example \"section:guide.md:# Guide/0,## Installation/0\" (§6.3).",
            HelpName = "locator",
            Required = true,
        });
        return command;
    }

    private static Command Retire()
    {
        var reason = new Option<string>("--reason")
        {
            Description = "Why the entity is dead (§6.3, §6.6).",
            HelpName = "split|merge|deleted",
            Required = true,
        };
        reason.AcceptOnlyFromAmong("split", "merge", "deleted");

        var command = new Command("retire", "Record {\"dead\": ..., \"next\": [...]}: flagged-changed with reason and successors, never a silent transfer (§6.3, §6.6).");
        command.Options.Add(CommonOptions.Root());
        command.Options.Add(reason);
        command.Options.Add(new Option<string[]>("--next")
        {
            Description = "Successor locator. Repeatable (§6.3).",
            HelpName = "locator",
        });
        return command;
    }

    private static Command Unknown()
    {
        var command = new Command("unknown", "Record {\"unknown\": ...}: unconfirmed; the review is preserved externally and the badge is not moved (§6.3, §6.6).");
        command.Options.Add(CommonOptions.Root());
        command.Options.Add(new Option<string>("--reason")
        {
            Description = "Free text explaining why correspondence is unconfirmed (§6.3).",
            HelpName = "text",
            Required = true,
        });
        return command;
    }

    private static Command Mint()
    {
        var command = new Command("mint", "Reserved-slot birth: mint a fresh random root plus {\"to\": <locator>} so the newcomer does not inherit a retired holder's root. Emits MDPK3002 (§6.3).");
        command.Options.Add(new Option<string>("--locator")
        {
            Description = "Locator of the newborn entity (§6.3).",
            HelpName = "locator",
            Required = true,
        });
        return command;
    }

    private static Command List(GlobalOptions globals)
    {
        var command = new Command("list", "Print the ledger. Writes no package, so --out is not required (§6.3).");
        command.SetAction(parseResult => Stub.Run(parseResult, globals, "address list"));
        return command;
    }

    private static Command WritingOp(Command op, GlobalOptions globals, Option<FileInfo> outOption)
    {
        op.Validators.Add(result =>
        {
            if (result.GetResult(outOption) is null)
            {
                result.AddError($"--out <file.mdpkg> is required for address {op.Name} (§2, §10).");
            }
        });
        op.SetAction(parseResult => Stub.Run(parseResult, globals, $"address {op.Name}"));
        return op;
    }
}
