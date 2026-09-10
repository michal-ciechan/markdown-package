namespace Mdpkg.Core.Internal.IO;

internal sealed class TemporaryDirectory : IDisposable
{
    public string Path { get; }
    public TemporaryDirectory(string? parent = null)
    {
        Path = System.IO.Path.Combine(parent ?? System.IO.Path.GetTempPath(), "mdpkg-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }
    public void Dispose()
    {
        // Only our freshly created directory is owned here. Git objects can be read-only on Windows.
        foreach (var file in Directory.EnumerateFiles(Path, "*", SearchOption.AllDirectories)) File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(Path, true);
    }
}
