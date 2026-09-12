using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Mdpkg.Core;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Container;

namespace Mdpkg.EngineTests;

/// <summary>Exploratory S6 mode comparison on the exact CARD-0050 corpora.
/// Opt in with MDPKG_HISTORY_MODE_BENCHMARK. First sample plus three warm samples;
/// shared host, no cold-cache isolation or process-tree memory claim.</summary>
public class HistoryModeBenchmarks
{
    private sealed record Sample(double CreateMilliseconds, double FullValidationMilliseconds, int CreateGitCalls, int ValidationGitCalls);
    private sealed record Measurement(string Os, string Runtime, string Shape, string Mode, long SourceBytes,
        long PackageBytes, long GitPayloadBytes, long SelectiveReadBytes, long SelectiveGitPayloadBytes,
        long SelectivePackBytes, bool FullHashLimitRejected, Sample First, Sample[] Warm);

    [Fact]
    public async Task MeasureSnapshotAndExplicitGitModes()
    {
        var output = Environment.GetEnvironmentVariable("MDPKG_HISTORY_MODE_BENCHMARK");
        if (string.IsNullOrEmpty(output)) return;
        var ct = TestContext.Current.CancellationToken;
        var results = new List<Measurement>();
        foreach (var shape in new[] { "tiny", "many-small", "large", "similar" })
        {
            using var f = new EngineFixture();
            var count = shape == "tiny" ? 1 : shape == "large" ? 2 : 20;
            for (var i = 0; i < count; i++)
                f.Write($"file{i}.md", shape switch
                {
                    "large" => string.Concat(Enumerable.Range(0, 16384).Select(n => $"Document {i} line {n}: {n * 7919L:x16} some text.\n")),
                    "similar" => string.Concat(Enumerable.Range(0, 2048).Select(n => $"Line {n}: {n * 7919L:x16} common content.\n")) + $"Variant {i}\n",
                    _ => $"# File {i}\n" + string.Concat(Enumerable.Repeat("Snapshot paragraph.\n", 64))
                });
            foreach (var mode in new[] { HistoryMode.None, HistoryMode.Git })
            {
                var settings = new EngineSettings(mode == HistoryMode.None ? "absent-git-s6" : "git");
                var request = new DirectoryPackageRequest(f.Source, Guid.Parse(EngineFixture.Namespace)) { History = mode };
                var samples = new List<Sample>();
                for (var run = 0; run < 4; run++)
                {
                    var calls = 0;
                    GitProcess.BeforeStart.Value = _ => Interlocked.Increment(ref calls);
                    try
                    {
                        var watch = Stopwatch.StartNew();
                        var created = await new Core.PackageBuilder(settings).CreateFromDirectoryAsync(request, f.Output, ct);
                        watch.Stop();
                        Assert.Equal(OperationStatus.Success, created.Status);
                        var createMs = watch.Elapsed.TotalMilliseconds; var createCalls = calls;
                        calls = 0; watch.Restart();
                        var validated = await new PackageValidator(settings).ValidateFileAsync(f.Output, new() { Deep = true }, ct);
                        watch.Stop();
                        Assert.True(validated.IsConforming, string.Join("; ", validated.Diagnostics));
                        Assert.Equal(created.Identity, validated.Identity);
                        samples.Add(new(createMs, watch.Elapsed.TotalMilliseconds, createCalls, calls));
                        if (mode == HistoryMode.None) { Assert.Equal(0, createCalls); Assert.Equal(0, calls); }
                    }
                    finally { GitProcess.BeforeStart.Value = null; }
                }
                var bytes = File.ReadAllBytes(f.Output);
                using var raw = new MemoryStream(bytes);
                var index = ZipReader.Index(raw, new(), ct);
                var gitEntries = index.Members.Where(e => e.Name.StartsWith(".git/", StringComparison.Ordinal)).ToArray();
                using var counted = new CountedStream(bytes);
                using (var archive = await PackageArchive.OpenAsync(counted, cancellationToken: ct))
                {
                    Assert.Equal(IdentityAssurance.Declared, archive.Assurance);
                    Assert.Equal(File.ReadAllBytes(Path.Combine(f.Source, "file0.md")), archive.ReadEntry("file0.md", cancellationToken: ct));
                    Assert.Throws<ResourceLimitException>(() => archive.ReadEntry("file0.md", 1, ct));
                }
                long Overlap(IEnumerable<(long Offset, long Length)> ranges) => counted.Reads.Sum(read => ranges.Sum(range =>
                    Math.Max(0, Math.Min(read.Offset + read.Length, range.Offset + range.Length) - Math.Max(read.Offset, range.Offset))));
                var packRead = Overlap(gitEntries.Where(e => e.Name.EndsWith(".pack", StringComparison.Ordinal)).Select(e => (e.DataOffset, (long)e.CompressedSize)));
                Assert.Equal(0, packRead);
                var limitRejected = false;
                if (mode == HistoryMode.None)
                {
                    Assert.Empty(gitEntries);
                    using var input = new MemoryStream(bytes);
                    var manifestSize = index.Members.Single(e => e.Name == ".mdpkg/manifest.json").Size;
                    using var limited = await PackageArchive.OpenAsync(input, new() { MaxDecodedBytes = manifestSize + 1 }, cancellationToken: ct);
                    Assert.Throws<ResourceLimitException>(() => limited.VerifySnapshot(ct));
                    Assert.Equal(IdentityAssurance.Declared, limited.Assurance); limitRejected = true;
                }
                results.Add(new(System.Runtime.InteropServices.RuntimeInformation.OSDescription, Environment.Version.ToString(), shape,
                    mode == HistoryMode.None ? "snapshot" : "git-native", Directory.GetFiles(f.Source).Sum(p => new FileInfo(p).Length),
                    bytes.LongLength, gitEntries.Sum(e => e.Size), counted.Reads.Sum(r => r.Length),
                    Overlap(gitEntries.Select(e => (e.DataOffset, (long)e.CompressedSize))), packRead, limitRejected, samples[0], samples.Skip(1).ToArray()));
                await File.WriteAllTextAsync(output, JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }) + "\n", ct);
            }
        }
    }

    private sealed class CountedStream(byte[] bytes) : MemoryStream(bytes)
    {
        internal List<(long Offset, long Length)> Reads { get; } = [];
        public override int Read(byte[] buffer, int offset, int count)
        { var start = Position; var read = base.Read(buffer, offset, count); Reads.Add((start, read)); return read; }
        public override int Read(Span<byte> buffer)
        { var start = Position; var read = base.Read(buffer); Reads.Add((start, read)); return read; }
    }
}
