using System.CommandLine;
using System.CommandLine.Parsing;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mdpkg.Cli;

/// <summary>
/// The §2 global options plus <c>--report</c> (§5.3). Each is recursive, so it is accepted before or after any verb.
/// <c>--out</c> is the exception: the spec lists it as global but it is required only for the writing verbs, so
/// <see cref="Commands.OutOption"/> attaches it per verb and <c>validate --out</c> is a usage error.
/// </summary>
internal sealed partial class GlobalOptions
{
    public const string TextFormat = "text";
    public const string JsonFormat = "json";

    public GlobalOptions()
    {
        Format = new Option<string>("--format")
        {
            Description = "json prints one result object on stdout, nothing else; diagnostics move to stderr (G-1).",
            DefaultValueFactory = _ => TextFormat,
            HelpName = "text|json",
            Recursive = true,
        };
        Format.AcceptOnlyFromAmong(TextFormat, JsonFormat);

        Quiet = new Option<bool>("--quiet")
        {
            Description = "Suppress progress on stderr; diagnostics are still emitted (G-1).",
            Recursive = true,
        };

        Namespace = new Option<string>("--namespace")
        {
            Description = "Lowercase UUID. Required for pack; other verbs take it from the input manifest, and a differing value is an error, never a rewrite (§4 namespace, §6.5 step 1).",
            HelpName = "uuid",
            Recursive = true,
        };
        Namespace.Validators.Add(result =>
        {
            var value = result.GetValueOrDefault<string>();
            if (value is not null && !LowercaseUuid().IsMatch(value))
            {
                result.AddError($"--namespace must be a lowercase UUID in 8-4-4-4-12 form: '{value}'.");
            }
        });

        Anchor = new Option<string>("--anchor")
        {
            Description = "Anchor profile. The only value version 1 defines (§4, §6.2, C7).",
            DefaultValueFactory = _ => "cm0312-trail-source-v1",
            HelpName = "id",
            Recursive = true,
        };
        Anchor.AcceptOnlyFromAmong("cm0312-trail-source-v1");

        Digest = new Option<string>("--digest")
        {
            Description = "Digest profile. The only value version 1 defines (§4, §6.1, C7).",
            DefaultValueFactory = _ => "cm0312-source-lf-v1",
            HelpName = "id",
            Recursive = true,
        };
        Digest.AcceptOnlyFromAmong("cm0312-source-lf-v1");

        ObjectFormat = new Option<string>("--object-format")
        {
            Description = "Git object format. sha256 is grammatical and unimplemented; it is rejected with MDPK4001 (D-14, §5.2, §11.2 item 1).",
            DefaultValueFactory = _ => "sha1",
            HelpName = "id",
            Recursive = true,
        };
        ObjectFormat.AcceptOnlyFromAmong("sha1", "sha256");

        CompressionLevel = new Option<int>("--compression-level")
        {
            Description = "DEFLATE level for working-tree entries. Producer policy only; readers accept any valid DEFLATE stream (§3.3).",
            DefaultValueFactory = _ => 6,
            HelpName = "0-9",
            Recursive = true,
        };
        CompressionLevel.Validators.Add(result =>
        {
            // A token that is not an integer is already a parse error; asking the converter for it would throw.
            if (IntToken(result) is { } value && value is < 0 or > 9)
            {
                result.AddError($"--compression-level must be between 0 and 9: {value}.");
            }
        });

        DataDescriptors = new Option<bool>("--data-descriptors")
        {
            Description = "Set GP bit 3 on every entry except the manifest. Off by default: descriptors cost 1,459 bytes on the measured npm package (§3.4, D-10).",
            Recursive = true,
        };

        ReverseIndex = new Option<bool>("--reverse-index")
        {
            Description = "Emit .rev. MAY be present, MUST NOT be required; the worked example omits it (D-8, C12).",
            Recursive = true,
        };

        StrictPaths = new Option<bool>("--strict-paths")
        {
            Description = "Always on and cannot be disabled; the uniqueness and reservation rules are producer obligations (§3.6, D-11, D-16).",
            DefaultValueFactory = _ => true,
            Recursive = true,
        };
        StrictPaths.Validators.Add(result =>
        {
            if (!result.GetValueOrDefault<bool>())
            {
                result.AddError("--strict-paths cannot be disabled (§3.6, D-11, D-16).");
            }
        });

        FailOnWarning = new Option<bool>("--fail-on-warning")
        {
            Description = "Promote every warn diagnostic to exit 3 (G-1).",
            Recursive = true,
        };

        Report = new Option<FileInfo>("--report")
        {
            Description = "Also write the result object to this file, even on a non-zero exit (§5.3, G-1).",
            HelpName = "file.json",
            Recursive = true,
        };
    }

    public Option<string> Format { get; }

    public Option<bool> Quiet { get; }

    public Option<string> Namespace { get; }

    public Option<string> Anchor { get; }

    public Option<string> Digest { get; }

    public Option<string> ObjectFormat { get; }

    public Option<int> CompressionLevel { get; }

    public Option<bool> DataDescriptors { get; }

    public Option<bool> ReverseIndex { get; }

    public Option<bool> StrictPaths { get; }

    public Option<bool> FailOnWarning { get; }

    public Option<FileInfo> Report { get; }

    /// <summary>In §2 table order, then <c>--report</c>.</summary>
    public IReadOnlyList<Option> All =>
    [
        Format, Quiet, Namespace, Anchor, Digest, ObjectFormat, CompressionLevel,
        DataDescriptors, ReverseIndex, StrictPaths, FailOnWarning, Report,
    ];

    /// <summary>The integer an option's last token holds, or null when there is none or it is not an integer.</summary>
    internal static int? IntToken(OptionResult result) =>
        result.Tokens.Count > 0 && int.TryParse(result.Tokens[^1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
    private static partial Regex LowercaseUuid();
}
