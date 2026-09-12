using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Mdpkg.Reader.Internal.Format;

internal static class Profile
{
    public const string Magic = "markdown-package/1";
    public const string Manifest = ".mdpkg/manifest.json";
    public const string History = ".mdpkg/history.json";
    public const string Ledger = ".mdpkg/address/overrides.json";
    public const string Anchor = "cm0312-trail-source-v1";
    public const string Digest = "cm0312-source-lf-v1";
    public const string Config = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n";
    public static readonly UTF8Encoding Utf8 = new(false, true);
    public static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    public static string Hash(string text) => Hash(Utf8.GetBytes(text));
    public static bool Root(string? value) => value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    public static bool Oid(string? value) => value is { Length: 45 } && value.StartsWith("sha1-", StringComparison.Ordinal) && value[5..].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    public static bool State(CurrentState? value) => value is not null && (value.Kind == "commit" ? Oid(value.Id) :
        value.Kind == "snapshot" && value.Id is { Length: 71 } && value.Id.StartsWith("sha256-", StringComparison.Ordinal) && Root(value.Id[7..]));
}

internal static class CanonicalJson
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowOutOfOrderMetadataProperties = true,
    };
    public static JsonNode Node<T>(T value) => Node(value, 64);
    public static JsonNode Node<T>(T value, int maxDepth) => JsonSerializer.SerializeToNode(value, DepthOptions(maxDepth))!;
    public static byte[] Bytes<T>(T value, bool manifest = false) => Bytes(value, manifest, 64);
    public static byte[] Bytes<T>(T value, bool manifest, int maxDepth)
    {
        var node = value is JsonNode json ? json : Node(value, maxDepth);
        // Null here is a positive declaration, not an optional field.
        if (value is Manifest m) node["addressing"]!["overrides"] = m.Addressing.Overrides;
        return Profile.Utf8.GetBytes(Text(node, manifest));
    }
    public static string Text(JsonNode? node, bool manifest = false)
    {
        var text = new StringBuilder();
        Write(text, node, manifest);
        return text.Append('\n').ToString();
    }
    private static void Write(StringBuilder b, JsonNode? node, bool manifest = false)
    {
        if (node is null) { b.Append("null"); return; }
        if (node is JsonObject obj)
        {
            b.Append('{');
            var keys = obj.Select(x => x.Key).Order(Utf8Comparer.Instance).ToList();
            if (manifest && keys.Remove("mdpkg")) keys.Insert(0, "mdpkg");
            for (var i = 0; i < keys.Count; i++)
            {
                if (i != 0) b.Append(',');
                Quote(b, keys[i]); b.Append(':'); Write(b, obj[keys[i]]);
            }
            b.Append('}');
        }
        else if (node is JsonArray array)
        {
            b.Append('[');
            for (var i = 0; i < array.Count; i++) { if (i != 0) b.Append(','); Write(b, array[i]); }
            b.Append(']');
        }
        else if (node is JsonValue value && value.TryGetValue<string>(out var s)) Quote(b, s);
        else b.Append(node.ToJsonString());
    }
    private static void Quote(StringBuilder b, string text)
    {
        // Utf8JsonWriter escapes some valid Unicode even with UnsafeRelaxedJsonEscaping.
        // The wire profile requires literal Unicode, including supplementary scalars.
        Profile.Utf8.GetByteCount(text);
        b.Append('"');
        foreach (var c in text)
            b.Append(c switch { '"' => "\\\"", '\\' => "\\\\", '\b' => "\\b", '\f' => "\\f", '\n' => "\\n", '\r' => "\\r", '\t' => "\\t", < ' ' => "\\u" + ((int)c).ToString("x4"), _ => c.ToString() });
        b.Append('"');
    }
    public static JsonNode Parse(byte[] bytes, int maxDepth = 64, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        using var doc = JsonDocument.Parse(Profile.Utf8.GetString(bytes), new JsonDocumentOptions { MaxDepth = maxDepth });
        Unique(doc.RootElement, ct);
        return JsonNode.Parse(doc.RootElement.GetRawText(), documentOptions: new JsonDocumentOptions { MaxDepth = maxDepth })!;
    }
    private static void Unique(JsonElement e, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (e.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in e.EnumerateObject()) { if (!names.Add(p.Name)) throw new JsonException("Duplicate JSON key: " + p.Name); Unique(p.Value, ct); }
        }
        else if (e.ValueKind == JsonValueKind.Array) foreach (var item in e.EnumerateArray()) Unique(item, ct);
    }
    private static JsonSerializerOptions DepthOptions(int maxDepth) => maxDepth == 64 ? Options : new(Options) { MaxDepth = maxDepth };
    public static T Read<T>(byte[] bytes) => Read<T>(bytes, 64);
    public static T Read<T>(byte[] bytes, int maxDepth) => Parse(bytes, maxDepth).Deserialize<T>(DepthOptions(maxDepth)) ?? throw new JsonException("Expected JSON object.");
}

internal sealed class Utf8Comparer : IComparer<string>
{
    public static readonly Utf8Comparer Instance = new();
    public int Compare(string? x, string? y) => Profile.Utf8.GetBytes(x ?? "").AsSpan().SequenceCompareTo(Profile.Utf8.GetBytes(y ?? ""));
}
