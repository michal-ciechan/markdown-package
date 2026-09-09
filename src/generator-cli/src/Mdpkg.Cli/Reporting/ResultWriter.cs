using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mdpkg.Cli.Reporting;

/// <summary>Serializes the §6 result object: camelCase keys, nulls written, one line, no trailing newline.</summary>
internal static class ResultWriter
{
    public static string ToJson(ResultObject result) =>
        JsonSerializer.Serialize(result, MdpkgJsonContext.Default.ResultObject);
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    WriteIndented = false)]
[JsonSerializable(typeof(ResultObject))]
internal sealed partial class MdpkgJsonContext : JsonSerializerContext;
