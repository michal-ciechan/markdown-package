using System.CommandLine;

namespace Mdpkg.Cli.Commands;

/// <summary><c>--out &lt;path&gt;</c> (§2): the output package, written to a temp sibling and renamed (§9).</summary>
internal static class OutOption
{
    public static Option<FileInfo> Create(bool required) => new("--out")
    {
        Description = "Output package. Written to a temp sibling and renamed, so a failed run leaves no partial file (§2, §9).",
        HelpName = "file.mdpkg",
        Required = required,
    };
}
