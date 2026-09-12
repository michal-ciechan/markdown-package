using System.Diagnostics;
using System.Text.Json;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Git;

namespace Mdpkg.EngineTests;

/// <summary>Opt-in measurement harness. Set MDPKG_SNAPSHOT_BENCHMARK to an output JSON path.
/// Run this class alone in Release; the first run is recorded separately from ten warm runs.
/// Memory is sampled host RSS (not child-process RSS); temporary bytes are peak live bytes,
/// not cumulative I/O. Neither measure is a whole-process resource quota.</summary>
public class ManagedSnapshotBenchmarks
{
    private sealed record Sample(double Milliseconds, int Processes, long PeakHostRss, long PeakTemporaryBytes, long PackageBytes, long PackBytes);
    private sealed record Measurement(string Os, string Runtime, string Shape, string Backend, long SourceBytes, Sample First, Sample[] Warm);

    [Fact]
    public async Task MeasureManagedAndNativeSnapshots()
    {
        var output = Environment.GetEnvironmentVariable("MDPKG_SNAPSHOT_BENCHMARK");
        if (string.IsNullOrEmpty(output)) return;
        var measurements = new List<Measurement>();
        var ct = TestContext.Current.CancellationToken;
        var shapes = Environment.GetEnvironmentVariable("MDPKG_SNAPSHOT_BENCHMARK_SHAPES")?.Split(',') ?? ["tiny", "many-small", "large", "similar"];
        Assert.All(shapes, shape => Assert.Contains(shape, new[] { "tiny", "many-small", "large", "similar" }));
        foreach (var shape in shapes)
        {
            using var f = new EngineFixture();
            var count = shape == "tiny" ? 1 : shape == "large" ? 2 : 20;
            for (var i = 0; i < count; i++)
            {
                var content = shape switch
                {
                    "large" => string.Concat(Enumerable.Range(0, 16384).Select(n => $"Document {i} line {n}: {n * 7919L:x16} some text.\n")),
                    "similar" => string.Concat(Enumerable.Range(0, 2048).Select(n => $"Line {n}: {n * 7919L:x16} common content.\n")) + $"Variant {i}\n",
                    _ => $"# File {i}\n" + string.Concat(Enumerable.Repeat("Snapshot paragraph.\n", 64))
                };
                f.Write($"file{i}.md", content);
            }
            var sourceBytes = Directory.GetFiles(f.Source).Sum(p => new FileInfo(p).Length);
            foreach (var managed in new[] { false, true })
            {
                var temp = Path.Combine(f.Root, "temporary"); Directory.CreateDirectory(temp);
                var builder = new PackageBuilder(new(TemporaryDirectory: temp) { ManagedSnapshots = managed });
                var samples = new List<Sample>();
                for (var run = 0; run < 11; run++)
                {
                    var processes = 0; long peakRss = 0, peakTemporary = 0;
                    GitProcess.BeforeStart.Value = _ => Interlocked.Increment(ref processes);
                    using var stop = new CancellationTokenSource();
                    var monitor = Task.Run(async () =>
                    {
                        using var host = Process.GetCurrentProcess();
                        while (!stop.IsCancellationRequested)
                        {
                            host.Refresh(); peakRss = Math.Max(peakRss, host.WorkingSet64);
                            long bytes = 0;
                            try
                            {
                                foreach (var file in Directory.EnumerateFiles(temp, "*", SearchOption.AllDirectories).Concat(Directory.EnumerateFiles(f.Root, "*.tmp")))
                                    try { bytes += new FileInfo(file).Length; } catch (IOException) { }
                            }
                            catch (IOException) { }
                            peakTemporary = Math.Max(peakTemporary, bytes);
                            await Task.Delay(5, CancellationToken.None);
                        }
                    }, CancellationToken.None);
                    var clock = Stopwatch.StartNew();
                    EngineResult result;
                    try { result = await builder.PackAsync(f.Request, ct); }
                    finally { clock.Stop(); stop.Cancel(); await monitor; GitProcess.BeforeStart.Value = null; }
                    EngineFixture.Success(result);
                    var packBytes = EngineFixture.Read(f.Output).Single(e => e.Name.EndsWith(".pack", StringComparison.Ordinal)).Bytes.LongLength;
                    samples.Add(new(clock.Elapsed.TotalMilliseconds, processes, peakRss, peakTemporary, new FileInfo(f.Output).Length, packBytes));
                    if (managed) Assert.Equal(0, processes);
                }
                measurements.Add(new(System.Runtime.InteropServices.RuntimeInformation.OSDescription, Environment.Version.ToString(), shape,
                    managed ? "managed" : "native", sourceBytes, samples[0], samples.Skip(1).ToArray()));
                await File.WriteAllTextAsync(output, JsonSerializer.Serialize(measurements, new JsonSerializerOptions { WriteIndented = true }), ct);
            }
        }
    }
}
