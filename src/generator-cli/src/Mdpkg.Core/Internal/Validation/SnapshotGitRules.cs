using System.Text;
using System.Text.RegularExpressions;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Core.Internal.Validation;

/// <summary>Git's special tracked names have integrity rules beyond ordinary blobs.
/// This is deliberately restricted to the producer's regular-file snapshot shape.</summary>
internal static class SnapshotGitRules
{
    private static void Require(bool valid, string message)
    { if (!valid) throw new EngineException(Outcome.Nonconforming, "MDPK4002", message); }

    internal static void Name(string name)
    {
        var ntfs = name.Split(':')[0].TrimEnd(' ', '.');
        Require(!ntfs.Equals(".git", StringComparison.OrdinalIgnoreCase) && !ntfs.Equals("git~1", StringComparison.OrdinalIgnoreCase) &&
            !Hfs(name).Equals(".git", StringComparison.OrdinalIgnoreCase), "Tracked name aliases .git.");
    }

    private static string Hfs(string name) => new(name.Where(c => c is not (>= '\u200c' and <= '\u200f') and
        not (>= '\u202a' and <= '\u202e') and not (>= '\u206a' and <= '\u206f') and not '\ufeff').ToArray());

    internal static bool Special(string name, string full, string shortPrefix)
    {
        if (Hfs(name).Equals(full, StringComparison.OrdinalIgnoreCase)) return true;
        var ntfs = name.Split(':')[0].TrimEnd(' ', '.').ToLowerInvariant();
        if (ntfs == full) return true;
        if (ntfs.Length != 8) return false;
        if (ntfs[..6] == full.Substring(1, 6) && ntfs[6] == '~' && ntfs[7] is >= '1' and <= '4') return true;
        var tilde = ntfs.IndexOf('~');
        return tilde is >= 0 and <= 6 && ntfs[..tilde] == shortPrefix[..tilde] && ntfs[tilde + 1] is >= '1' and <= '9' &&
            ntfs[(tilde + 1)..].All(char.IsAsciiDigit);
    }

    internal static void Blob(string name, byte[] bytes, CancellationToken ct)
    {
        if (Special(name, ".gitattributes", "gi7d29"))
        {
            Require(bytes.Length <= 100 * 1024 * 1024, ".gitattributes exceeds Git's integrity limit.");
            var length = 0;
            foreach (var b in bytes)
            {
                if (b == 0) break;
                if (b == '\n') length = 0;
                else Require(++length < 2048, ".gitattributes line exceeds Git's integrity limit.");
            }
        }
        if (Special(name, ".gitmodules", "gi7eba"))
        {
            try { Modules(Profile.Utf8.GetString(bytes), ct); }
            // Git classifies gitmodulesParse as INFO even under --strict. The
            // existing native path accepts it; semantic errors remain fatal.
            catch (ConfigSyntaxException) { }
        }
    }

    private sealed class ConfigSyntaxException(string message) : Exception(message);
    private static void Parse(bool valid, string message) { if (!valid) throw new ConfigSyntaxException(message); }

    // Parse the Git config subset used by .gitmodules without following includes,
    // resolving URLs, or opening the filesystem. Unknown sections/keys are permitted.
    private static void Modules(string text, CancellationToken ct)
    {
        var position = text.StartsWith('\ufeff') ? 1 : 0;
        string? section = null, subsection = null;
        while (position < text.Length)
        {
            ct.ThrowIfCancellationRequested();
            while (position < text.Length && text[position] is ' ' or '\t' or '\n') position++;
            if (position == text.Length) break;
            if (text[position] is '#' or ';') { SkipComment(); continue; }
            if (text[position] == '[')
            {
                var start = ++position;
                while (position < text.Length && (char.IsAsciiLetterOrDigit(text[position]) || text[position] is '-' or '.')) position++;
                Parse(position > start, "Malformed .gitmodules section.");
                var header = text[start..position].ToLowerInvariant();
                section = header; subsection = null;
                while (position < text.Length && text[position] is ' ' or '\t') position++;
                if (position < text.Length && text[position] == '"')
                {
                    position++; var sub = new StringBuilder();
                    while (position < text.Length && text[position] != '"')
                    {
                        var c = text[position++];
                        if (c == '\\') { Parse(position < text.Length, "Incomplete subsection escape."); c = text[position++]; }
                        Parse(c is not '\n' and not '\0', "Malformed .gitmodules subsection."); sub.Append(c);
                    }
                    Parse(position < text.Length && text[position++] == '"', "Unterminated .gitmodules subsection.");
                    subsection = sub.ToString();
                }
                else if (header.IndexOf('.') is var dot && dot >= 0) { section = header[..dot]; subsection = header[(dot + 1)..]; }
                Parse(position < text.Length && text[position++] == ']', "Malformed .gitmodules section terminator.");
                continue;
            }
            Parse(section is not null && char.IsAsciiLetter(text[position]), "Malformed .gitmodules key.");
            var keyStart = position++;
            while (position < text.Length && (char.IsAsciiLetterOrDigit(text[position]) || text[position] == '-')) position++;
            var key = text[keyStart..position].ToLowerInvariant();
            while (position < text.Length && text[position] is ' ' or '\t') position++;
            string? value = null;
            if (position < text.Length && text[position] == '=')
            {
                position++; var data = new StringBuilder(); var quoted = false; var spaces = 0;
                while (position < text.Length)
                {
                    var c = text[position++];
                    if (c == '\n') { Parse(!quoted, "Unterminated .gitmodules value."); break; }
                    if (!quoted && c is '#' or ';') { SkipComment(); break; }
                    if (!quoted && c is ' ' or '\t') { if (data.Length > 0) spaces++; continue; }
                    if (c == '\\')
                    {
                        Parse(position < text.Length, "Incomplete .gitmodules escape."); c = text[position++];
                        if (c == '\n') continue;
                        Parse(c is 'n' or 't' or 'b' or '\\' or '"', "Invalid .gitmodules escape.");
                        c = c switch { 'n' => '\n', 't' => '\t', 'b' => '\b', _ => c };
                    }
                    else if (c == '"') { quoted = !quoted; continue; }
                    if (spaces > 0) { data.Append(' ', spaces); spaces = 0; }
                    data.Append(c);
                }
                Parse(!quoted, "Unterminated .gitmodules value."); value = data.ToString();
                // Git consumes NULs as value bytes and keeps parsing the config,
                // but its semantic callbacks see a NUL-terminated C string.
                // Truncate only after parsing all quotes, escapes and continuations.
                var nul = value.IndexOf('\0');
                if (nul >= 0) value = value[..nul];
            }
            else Parse(position == text.Length || text[position] is '\n' or '#' or ';', "Malformed .gitmodules assignment.");
            if (section == "submodule" && subsection is not null)
            {
                Require(subsection.Length > 0 && !subsection.Split('/', '\\').Contains(".."), "Disallowed submodule name.");
                if (key == "path" && value is not null) Require(!value.StartsWith('-'), "Disallowed submodule path.");
                if (key == "update" && value is not null) Require(!value.StartsWith('!'), "Disallowed submodule update command.");
                if (key == "url" && value is not null) Url(value);
            }
        }
        void SkipComment() { while (position < text.Length && text[position] != '\n') position++; }
    }

    private static void Url(string value)
    {
        Require(!value.StartsWith('-'), "Disallowed submodule URL.");
        var relative = value.StartsWith("./", StringComparison.Ordinal) || value.StartsWith("../", StringComparison.Ordinal) ||
            value.StartsWith(".\\", StringComparison.Ordinal) || value.StartsWith("..\\", StringComparison.Ordinal);
        if (relative || value.StartsWith("git://", StringComparison.Ordinal))
        {
            Require(!Uri.UnescapeDataString(value).Contains('\n'), "Newline in submodule URL.");
            var remaining = value; var parents = 0;
            while (Regex.IsMatch(remaining, @"\A\.\.?[/\\]", RegexOptions.CultureInvariant))
            {
                var length = remaining[1] == '.' ? 3 : 2; if (length == 3) parents++;
                remaining = remaining[length..];
            }
            Require(parents == 0 || remaining.Length == 0 || remaining[0] is not ':' and not '/', "Submodule URL escapes its root.");
        }
        else
        {
            foreach (var scheme in new[] { "http", "https", "ftp", "ftps" })
            {
                var url = value.StartsWith(scheme + "::", StringComparison.Ordinal) ? value[(scheme.Length + 2)..] : value;
                if (url == value && !value.StartsWith(scheme + "://", StringComparison.Ordinal)) continue;
                Require(Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Host.Length > 0 && !Uri.UnescapeDataString(url).Contains('\n'), "Malformed submodule transport URL.");
                break;
            }
        }
    }
}
