using System.Text;
using Mdpkg.Cli.Engine.Format;

namespace Mdpkg.Cli.Engine.Sources;

internal static class SourceTree
{
    public static void ValidateNames(IEnumerable<string> names, bool container = false, Outcome outcome = Outcome.InvalidSource)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var files = new HashSet<string>(StringComparer.Ordinal);
        var dirs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            ValidatePath(name, outcome);
            var key = CaseFold.Key(name);
            if (!seen.Add(key)) throw new EngineException(outcome, "MDPK1001", "Entry names collide under NFC and simple case folding.", name);
            if (!container && Reserved(name)) throw new EngineException(outcome, "MDPK1002", "Source path uses a reserved prefix.", name);
            if (dirs.Contains(key)) throw new EngineException(outcome, "MDPK1001", "A file collides with a directory.", name);
            files.Add(key);
            var parts = key.Split('/');
            for (var i = 1; i < parts.Length; i++)
            {
                var parent = string.Join('/', parts.Take(i));
                if (files.Contains(parent)) throw new EngineException(outcome, "MDPK1001", "A directory collides with a file.", name);
                dirs.Add(parent);
            }
        }
    }
    public static void ValidatePath(string name, Outcome outcome = Outcome.InvalidSource)
    {
        if (string.IsNullOrEmpty(name) || name.Contains('\\') || name.Contains('\0') ||
            name.Split('/').Any(p => p is "" or "." or ".." || (p.Length >= 2 && char.IsAsciiLetter(p[0]) && p[1] == ':')) ||
            (outcome == Outcome.InvalidSource && (name.Any(c => c < ' ' || c == '\u007f') || name.Contains(':'))))
            throw new EngineException(outcome, "MDPK1003", "Unsafe entry path.", name);
        try { Profile.Utf8.GetByteCount(name); }
        catch (EncoderFallbackException) { throw new EngineException(outcome, "MDPK1003", "Entry name is not valid Unicode.", name); }
    }
    public static bool Reserved(string name)
    {
        var key = CaseFold.Key(name);
        return key is ".git" or ".mdpkg" || key.StartsWith(".git/", StringComparison.Ordinal) ||
            (key.StartsWith(".mdpkg/", StringComparison.Ordinal) &&
             !name.StartsWith(".mdpkg/address/", StringComparison.Ordinal) && !name.StartsWith(".mdpkg/review/", StringComparison.Ordinal));
    }
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
