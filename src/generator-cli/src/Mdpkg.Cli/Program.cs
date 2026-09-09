using System.Text;

namespace Mdpkg.Cli;

public static class Program
{
    public static int Main(string[] args)
    {
        // Help text cites spec sections with `§`, and --format json carries UTF-8 entry names (§3.6); the Windows
        // console defaults to an OEM code page, which turns both into mojibake for a capturing caller.
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        return MdpkgCli.Invoke(args, Console.Out, Console.Error);
    }
}
