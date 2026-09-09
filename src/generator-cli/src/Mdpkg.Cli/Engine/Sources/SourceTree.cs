using System.Text;
using Mdpkg.Reader.Internal.Sources;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Cli.Engine.Sources;

internal static class SourceTree
{
    public static void ValidateNames(IEnumerable<string> names, bool container = false, Outcome outcome = Outcome.InvalidSource) => SourceRules.ValidateNames(names, container, outcome);
    public static void ValidatePath(string name, Outcome outcome = Outcome.InvalidSource) => SourceRules.ValidatePath(name, outcome);
    public static bool Reserved(string name) => SourceRules.Reserved(name);
    public static byte[] Normalize(byte[] bytes, string path, List<Finding> findings)
    {
        string text;
        try { text = Profile.Utf8.GetString(bytes); }
        catch (DecoderFallbackException) { throw new EngineException(Outcome.InvalidSource, "MDPK4003", "Entry is not strict UTF-8.", path); }
        if (!text.Contains('\r')) return bytes;
        if (!findings.Any(d => d.Code == "MDPK1004" && d.Entry == path))
            findings.Add(Findings.Create("MDPK1004", "Normalized CRLF/lone CR to LF.", path));
        return Profile.Utf8.GetBytes(text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n'));
    }
    public static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new EngineException(Outcome.InvalidSource, "MDPK1003", "Symbolic links and reparse points are not accepted.", path);
    }
    public static async Task<List<EntryData>> ReadAsync(string source, List<Finding> findings, CancellationToken ct)
    {
        if (!Directory.Exists(source)) throw new IOException("Source directory does not exist: " + source);
        for (var ancestor = new DirectoryInfo(Path.GetFullPath(source)); ancestor != null; ancestor = ancestor.Parent) RejectLink(ancestor.FullName);
        var paths = new List<string>();
        void Walk(string directory)
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                ct.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(source, path).Replace(Path.DirectorySeparatorChar, '/');
                if (relative == ".git") continue;
                RejectLink(path);
                if (Directory.Exists(path))
                {
                    ValidatePath(relative);
                    if (Reserved(relative + "/child") && relative is not ".mdpkg")
                        throw new EngineException(Outcome.InvalidSource, "MDPK1002", "Reserved source directory.", relative);
                    if (relative == ".mdpkg" && !Directory.EnumerateFileSystemEntries(path).Any())
                        throw new EngineException(Outcome.InvalidSource, "MDPK1002", "Empty reserved source directory.", relative);
                    Walk(path);
                }
                else paths.Add(relative);
            }
        }
        Walk(source);
        ValidateNames(paths);
        var entries = new List<EntryData>();
        foreach (var path in paths.Order(Utf8Comparer.Instance))
        {
            var full = Path.Combine(source, path);
            RejectLink(full);
            entries.Add(new(path, Normalize(await File.ReadAllBytesAsync(full, ct), path, findings)));
        }
        return entries;
    }
}
