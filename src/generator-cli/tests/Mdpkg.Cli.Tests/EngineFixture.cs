using Mdpkg.Core;

namespace Mdpkg.Cli.Tests;

internal sealed class EngineFixture : IDisposable
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "mdpkg-cli-test-" + Guid.NewGuid().ToString("N"));
    public string Source => Path.Combine(Root, "source");
    public string Output => Path.Combine(Root, "test.mdpkg");
    public EngineFixture() => Directory.CreateDirectory(Source);
    public DirectoryPackageRequest Request => new(Source, Guid.Parse(CliRunner.Namespace))
    { Options = new() { Resources = ResourceOptions.ProducerCompatibility } };
    public void Write(string path, string text)
    {
        var full = Path.Combine(Source, path); Directory.CreateDirectory(Path.GetDirectoryName(full)!); File.WriteAllText(full, text);
    }
    public static void Success(PackageResult result) => Assert.True(result.Status == OperationStatus.Success,
        string.Join("; ", result.Diagnostics.Select(d => d.Code + ": " + d.Message)));
    public void Dispose() => Directory.Delete(Root, recursive: true);
}
