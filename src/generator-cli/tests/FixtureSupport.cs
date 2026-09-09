using System.IO.Compression;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Tests;

internal static class Fixtures
{
    public static string Repo(string path)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, path))) return Path.Combine(dir.FullName, path);
        throw new FileNotFoundException(path);
    }
    public static byte[] Bytes(string name) => File.ReadAllBytes(Repo("docs/spec/review-fixtures/" + name));
    public static MemoryStream Stream(string name = "delta-v2.mdpkg") => new(Bytes(name));
    public static JsonNode Json(string name = "comments-v2.json") => JsonNode.Parse(Bytes(name))!;
    public static string Id(int n) => $"00000000-0000-4000-8000-{n:000000000000}";
    public static byte[] Rewrite(byte[] package, Action<Dictionary<string, byte[]>> change)
    {
        var entries = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        using (var source = new ZipArchive(new MemoryStream(package), ZipArchiveMode.Read))
            foreach (var entry in source.Entries)
            { using var s = entry.Open(); using var m = new MemoryStream(); s.CopyTo(m); entries.Add(entry.FullName, m.ToArray()); }
        change(entries);
        using var result = new MemoryStream();
        using (var zip = new ZipArchive(result, ZipArchiveMode.Create, true))
            foreach (var (path, bytes) in entries)
            {
                var entry = zip.CreateEntry(path, CompressionLevel.NoCompression); entry.LastWriteTime = new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);
                entry.ExternalAttributes = unchecked((int)0x81a40000);
                using var s = entry.Open(); s.Write(bytes);
            }
        return result.ToArray();
    }
    public static byte[] Review(Action<JsonNode> change, string name = "delta-v2.mdpkg") => Rewrite(Bytes(name), entries =>
    {
        var node = JsonNode.Parse(entries[".mdpkg/review/comments.json"])!; change(node);
        entries[".mdpkg/review/comments.json"] = CanonicalJson.Bytes(node);
    });
    public static byte[] Manifest(Action<JsonNode> change, string name = "delta-v2.mdpkg") => Rewrite(Bytes(name), entries =>
    {
        var node = JsonNode.Parse(entries[Profile.Manifest])!; change(node); entries[Profile.Manifest] = CanonicalJson.Bytes(node, true);
    });
}

internal sealed class NonSeekable(Stream inner, Action? reading = null) : Stream
{
    public bool WasDisposed { get; private set; }
    public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count) { reading?.Invoke(); return inner.Read(buffer, offset, count); }
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    { reading?.Invoke(); cancellationToken.ThrowIfCancellationRequested(); return inner.ReadAsync(buffer, cancellationToken); }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing) { WasDisposed = true; base.Dispose(disposing); }
}
