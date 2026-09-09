using Markdig;
using Markdig.Syntax;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Reader.Internal.Addressing;

internal sealed record Entity(JsonArray Locator, string Root, string Digest, string Source, int SourceStart);
internal static class Inventory
{
    private sealed class Scope(string kind, int start, int end, int level, JsonArray trail)
    {
        public string Kind { get; } = kind;
        public int Start { get; } = start;
        public int End { get; set; } = end;
        public int Level { get; } = level;
        public JsonArray Trail { get; } = trail;
    }
    public static string CanonicalSource(string source)
    {
        var lines = source.Split('\n').ToList();
        while (lines.Count > 0 && lines[^1].All(c => c is ' ' or '\t')) lines.RemoveAt(lines.Count - 1);
        return lines.Count == 0 ? "" : string.Join('\n', lines) + "\n";
    }
    public static string Root(string ns, JsonArray locator) => Profile.Hash($"mdpkg-default\0{Profile.Anchor}\0{ns}\0{CanonicalJson.Text(locator)}");
    public static string Digest(string kind, string source) => Profile.Hash($"mdpkg\0{Profile.Digest}\0{kind}\0{CanonicalSource(source)}");
    public static List<Entity> Document(byte[] bytes, string path, string ns, CancellationToken ct = default)
    {
        var text = Profile.Utf8.GetString(bytes).Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var lines = text.Split('\n');
        var offsets = new List<int> { 0 };
        for (var i = 0; i < text.Length; i++) if (text[i] == '\n') offsets.Add(i + 1);
        int LineAt(int index) { var n = offsets.BinarySearch(Math.Max(0, index)); return n >= 0 ? n : ~n - 1; }
        var preamble = new Scope("preamble", 0, lines.Length, 0, []);
        var scopes = new List<Scope> { new("document", 0, lines.Length, 0, []), preamble };
        var stack = new Stack<Scope>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        // Default pipeline: no extensions or smart punctuation. Direct children only.
        foreach (var heading in Markdown.Parse(text).OfType<HeadingBlock>())
        {
            ct.ThrowIfCancellationRequested();
            // HeadingBlock.Line is the underline for Setext; Span.Start is the first source line.
            var start = LineAt(heading.Span.Start);
            if (scopes.Count == 2) preamble.End = start;
            while (stack.Count > 0 && stack.Peek().Level >= heading.Level) stack.Pop().End = start;
            var parent = stack.Count == 0 ? new JsonArray() : stack.Peek().Trail;
            var title = string.Join('\n', lines.Skip(start).Take(LineAt(heading.Span.End) - start + 1));
            var key = CanonicalJson.Text(new JsonArray(parent.DeepClone(), JsonValue.Create(title)));
            var occurrence = counts.GetValueOrDefault(key);
            counts[key] = occurrence + 1;
            var trail = (JsonArray)parent.DeepClone(); trail.Add(new JsonArray(title, occurrence));
            var scope = new Scope("section", start, lines.Length, heading.Level, trail);
            scopes.Add(scope); stack.Push(scope);
        }
        return scopes.Select(s =>
        {
            var locator = new JsonArray(s.Kind, path, s.Trail.DeepClone());
            ct.ThrowIfCancellationRequested();
            var source = CanonicalSource(string.Join('\n', lines.Skip(s.Start).Take(s.End - s.Start)));
            return new Entity(locator, Root(ns, locator), Digest(s.Kind, source), source, offsets[Math.Min(s.Start, offsets.Count - 1)]);
        }).ToList();
    }
    public static Dictionary<string, Entity> Snapshot(IEnumerable<EntryData> entries, string ns, CancellationToken ct)
    {
        var result = new Dictionary<string, Entity>(StringComparer.Ordinal);
        foreach (var entry in entries.Where(e => e.Name.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || e.Name.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase)))
        {
            ct.ThrowIfCancellationRequested();
            foreach (var entity in Document(entry.Bytes, entry.Name, ns, ct)) result.Add(entity.Root, entity);
        }
        return result;
    }
}
