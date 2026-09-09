using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal;
using Mdpkg.Reader.Internal.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Reader;

/// <summary>Selective ZIP32 access. Dispose the archive, not the caller's stream. Instances are not thread-safe.</summary>
public sealed class PackageArchive : IDisposable
{
    private readonly Stream stream;
    private readonly bool ownsStream;
    private readonly Dictionary<string, ZipEntry> entries;
    private long decodedBytes;
    private bool disposed;
    internal Manifest Manifest { get; private set; } = null!;
    internal HistoryDetail History { get; private set; } = null!;
    public ReadLimits Limits { get; }
    public PackageIdentity Identity { get; private set; } = null!;
    public AddressingProfile Addressing { get; private set; } = null!;
    public JsonElement? Review { get; private set; }
    public ContainerStatus ContainerStatus { get; }
    public IReadOnlyList<PackageEntry> Entries { get; }
    public IReadOnlyList<PackageDiagnostic> Diagnostics { get; }
    public long PackageBytes => stream.Length;

    private PackageArchive(Stream stream, bool ownsStream, ReadLimits limits, ZipIndex index)
    {
        this.stream = stream; this.ownsStream = ownsStream; Limits = limits;
        entries = index.Members.ToDictionary(e => e.Name, StringComparer.Ordinal);
        Entries = Array.AsReadOnly(index.Members.Select(e => new PackageEntry(e.Name, e.CompressedSize, e.Size)).ToArray());
        Diagnostics = Array.AsReadOnly(index.Findings.Select(f => new PackageDiagnostic(f.Code, f.Message, f.Entry)).ToArray());
        ContainerStatus = index.Typed && index.Findings.Count == 0 ? ContainerStatus.Conforming : ContainerStatus.Recoverable;
    }

    /// <summary>Reads from the caller's current position. Non-seekable input is privately spooled within MaxInputBytes.</summary>
    public static async Task<PackageArchive> OpenAsync(Stream input, ReadLimits? limits = null, bool acceptRecoverable = false, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!input.CanRead) throw new ArgumentException("A readable stream is required.", nameof(input));
        limits ??= new(); limits.Validate(); cancellationToken.ThrowIfCancellationRequested();
        Stream? source = null; PackageArchive? archive = null;
        try
        {
            if (input.CanSeek)
                source = new RelativeStream(input);
            else
            {
                var path = Path.Combine(limits.TemporaryDirectory ?? Path.GetTempPath(), "mdpkg-read-" + Guid.NewGuid().ToString("N") + ".tmp");
                var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite, Share = FileShare.None,
                    Options = FileOptions.Asynchronous | FileOptions.DeleteOnClose };
                if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
                source = new FileStream(path, options);
                var buffer = new byte[65536]; long length = 0;
                while (true)
                {
                    var n = await input.ReadAsync(buffer, cancellationToken);
                    if (n == 0) break;
                    length += n;
                    if (length > limits.MaxInputBytes) throw new ResourceLimitException("Non-seekable input exceeds its spool limit.");
                    await source.WriteAsync(buffer.AsMemory(0, n), cancellationToken);
                }
                source.Position = 0;
            }
            var index = ZipReader.Index(source, limits, cancellationToken);
            if (index.Findings.Any(f => f.Code != "MDPK1006") || (!acceptRecoverable && (!index.Typed || index.Findings.Count > 0)))
                throw new PackageFormatException(index.Findings.FirstOrDefault()?.Code ?? "MDPK1006", "ZIP profile checks failed.");
            archive = new(source, true, limits, index);
            var manifestBytes = archive.ReadEntry(Profile.Manifest, limits.MaxManifestBytes, cancellationToken);
            var node = archive.ReadCanonicalJson(manifestBytes, manifest: true, cancellationToken);
            if (node["mdpkg"]?.GetValue<string>() != Profile.Magic || node["addressing"]?["anchor"]?.GetValue<string>() != Profile.Anchor ||
                node["addressing"]?["digest"]?.GetValue<string>() != Profile.Digest || node["current"]?.GetValue<string>()?.StartsWith("sha256-", StringComparison.Ordinal) == true)
                throw new PackageFormatException("UnsupportedVersionOrProfile", "Unsupported package version, object format or addressing profile.");
            if (node["review"] is { } declaration && declaration["detail"]?.GetValue<string>() is { } detail && detail != ".mdpkg/review/comments.json")
                throw new PackageFormatException("UnsupportedVersionOrProfile", "Unsupported review detail path: " + detail);
            archive.Manifest = node.Deserialize<Manifest>(CanonicalJson.Options) ?? throw new JsonException("Expected manifest.");
            FormatValidation.ValidateManifest(archive.Manifest, null);
            var m = archive.Manifest;
            archive.Identity = new(m.Namespace, m.Current);
            archive.Addressing = new(m.Addressing.Anchor, m.Addressing.Digest, m.Addressing.Coverage, m.Addressing.Overrides);
            if (m.Review is not null) archive.Review = JsonSerializer.SerializeToElement(m.Review).Clone();
            var historyBytes = archive.ReadEntry(m.History.Detail, limits.MaxManifestBytes, cancellationToken);
            archive.History = archive.ReadCanonicalJson(historyBytes, false, cancellationToken).Deserialize<HistoryDetail>(CanonicalJson.Options) ?? throw new JsonException("Expected history.");
            FormatValidation.ValidateHistory(m, archive.History);
            if (Profile.Utf8.GetString(archive.ReadEntry(".git/refs/heads/main", 64, cancellationToken)) != m.Current[5..] + "\n")
                throw new PackageFormatException("MDPK2001", "Manifest current differs from the branch reference.");
            if ((m.Addressing.Overrides is null) == archive.Contains(Profile.Ledger))
                throw new PackageFormatException("MDPK2002", "Manifest and ledger presence disagree.");
            var controls = new HashSet<string>(archive.History.Ranges, StringComparer.Ordinal) { Profile.Manifest, Profile.History };
            if (archive.History.Bindings is { } binding) controls.Add(binding);
            foreach (var patch in archive.History.Patches) controls.Add(patch.Entry);
            foreach (var entry in archive.Entries)
                if (!entry.Name.StartsWith(".git/", StringComparison.Ordinal) && SourceRules.Reserved(entry.Name) && !controls.Contains(entry.Name))
                    throw new PackageFormatException("MDPK1002", "Unrecognized reserved entry.", entry.Name);
            return archive;
        }
        catch (EngineException ex) { archive?.Dispose(); source?.Dispose(); throw new PackageFormatException(ex.Code, ex.Message, ex.Entry); }
        catch (Exception ex) when (ex is JsonException or DecoderFallbackException or InvalidOperationException or ArgumentException or FormatException)
        { archive?.Dispose(); source?.Dispose(); throw new PackageFormatException("MDPK2007", "Malformed package: " + ex.Message); }
        catch { archive?.Dispose(); source?.Dispose(); throw; }
    }

    public bool Contains(string name) => entries.ContainsKey(name);
    public byte[] ReadEntry(string name, long? maximumBytes = null, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this); cancellationToken.ThrowIfCancellationRequested();
        if (!entries.TryGetValue(name, out var entry)) throw new PackageFormatException("MissingEntry", "Required entry is absent.", name);
        if (decodedBytes + entry.Size > Limits.MaxDecodedBytes) throw new ResourceLimitException("Aggregate decoded entry budget exceeded.");
        try
        {
            var bytes = ZipReader.ReadMember(stream, entry, maximumBytes ?? Limits.MaxDocumentBytes, cancellationToken);
            decodedBytes += bytes.Length;
            return bytes;
        }
        catch (EngineException ex) { throw new PackageFormatException(ex.Code, ex.Message, ex.Entry); }
    }
    internal JsonNode ReadCanonicalJson(byte[] bytes, bool manifest, CancellationToken ct)
    {
        if (bytes.Contains((byte)'\r')) throw new JsonException("JSON must use LF.");
        var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { MaxDepth = 257 });
        while (reader.Read())
        {
            ct.ThrowIfCancellationRequested();
            if (reader.CurrentDepth >= Limits.MaxJsonDepth && reader.TokenType is JsonTokenType.StartArray or JsonTokenType.StartObject)
                throw new ResourceLimitException("JSON nesting depth exceeds its limit.");
        }
        var node = CanonicalJson.Parse(bytes, Limits.MaxJsonDepth, ct);
        if (!bytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(node, manifest))) throw new JsonException("JSON is not canonical.");
        return node;
    }
    public async Task<string> ComputeDigestAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this); stream.Position = 0;
        return "sha256-" + Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken));
    }
    /// <summary>Copies package bytes for an explicitly requested verification provider; never closes the destination.</summary>
    public async Task CopyToAsync(Stream destination, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed, this); stream.Position = 0;
        await stream.CopyToAsync(destination, cancellationToken);
    }
    public void Dispose() { if (!disposed && ownsStream) stream.Dispose(); disposed = true; }

    private sealed class RelativeStream(Stream inner) : Stream
    {
        private readonly long origin = inner.Position;
        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => inner.Length - origin;
        public override long Position { get => inner.Position - origin; set => inner.Position = checked(origin + value); }
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override int Read(Span<byte> buffer) => inner.Read(buffer);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => inner.ReadAsync(buffer, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) { Position = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => Position + offset, _ => Length + offset }; return Position; }
        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
