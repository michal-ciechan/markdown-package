using System.CommandLine;
using System.CommandLine.Parsing;
using System.Text.RegularExpressions;

namespace Mdpkg.Cli.Commands;

/// <summary>Options and arguments that more than one verb declares (§5.1, §7, §9, §10, §11).</summary>
internal static partial class CommonOptions
{
    public static Argument<FileInfo> InputPackage() => new("in.mdpkg")
    {
        Description = "Input package. Must type at offset 0 unless --accept-recoverable is given (§3.1, §3.7).",
    };

    public static Option<FileInfo> Correspondence() => new("--correspondence")
    {
        Description = "Confirmed rename and lifecycle records (§7.1). Producer-confirmed only; a similarity score is never authority (§6.3).",
        HelpName = "file.json",
    };

    public static Option<bool> RequireComplete() => new("--require-complete")
    {
        Description = "Exit 4 rather than write addressing.coverage: partial (§4, §6.3).",
    };

    public static Option<bool> AcceptRecoverable() => new("--accept-recoverable")
    {
        Description = "Accept a tier 2 package and report tier: recoverable; it still fails conformance and SHOULD be re-emitted (§3.7).",
    };

    public static Option<string> Message(string description, string? defaultValue = null)
    {
        var option = new Option<string>("--message")
        {
            Description = description,
            HelpName = "text",
        };
        if (defaultValue is not null)
        {
            option.DefaultValueFactory = _ => defaultValue;
        }

        return option;
    }

    /// <summary>An origin root: 64 lowercase hex digits. Abbreviated hashes are never valid (§6.2, §10 key space).</summary>
    public static Option<string> Root() => WithRootValidation(new Option<string>("--root")
    {
        Description = "Origin root of the entity, 64 lowercase hex digits; abbreviated hashes are never valid (§6.2, §10).",
        HelpName = "root",
        Required = true,
    });

    public static Option<T> WithRootValidation<T>(Option<T> option)
    {
        option.Validators.Add(result =>
        {
            foreach (var token in result.Tokens)
            {
                if (!OriginRoot().IsMatch(token.Value))
                {
                    result.AddError($"{option.Name} must be an origin root of 64 lowercase hex digits: '{token.Value}'.");
                }
            }
        });
        return option;
    }

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex OriginRoot();
}
