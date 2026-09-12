using System.Text;
using Mdpkg.Reader.Internal.Format;
namespace Mdpkg.Reader.Internal.Sources;
internal static class SourceRules
{
    public static void ValidateNames(IEnumerable<string> names, bool container = false, Outcome outcome = Outcome.InvalidSource)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var files = new HashSet<string>(StringComparer.Ordinal);
        var dirs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            var directory = container && name.EndsWith('/');
            ValidatePath(directory ? name[..^1] : name, outcome);
            var key = CaseFold.Key(directory ? name[..^1] : name);
            if (!seen.Add(key + (directory ? "/" : ""))) throw new EngineException(outcome, "MDPK1001", "Entry names collide under NFC and simple case folding.", name);
            if (!container && Reserved(name)) throw new EngineException(outcome, "MDPK1002", "Source path uses a reserved prefix.", name);
            if (directory ? files.Contains(key) : dirs.Contains(key)) throw new EngineException(outcome, "MDPK1001", "A file collides with a directory.", name);
            if (directory) dirs.Add(key); else files.Add(key);
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
}
