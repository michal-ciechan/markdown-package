using System.IO.Compression;
using System.Text;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.Validation;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.EngineTests;

public class SnapshotDeltaTests
{
    [Theory]
    [InlineData("similar")][InlineData("shifted")][InlineData("lines")]
    public async Task CrossFileDeltasRetainIdentityAndMatchNativeIndex(string shape)
    {
        using var f = new EngineFixture(); var ct = TestContext.Current.CancellationToken;
        for (var i = 0; i < 4; i++)
        {
            var text = string.Concat(Enumerable.Range(0, 4096).Select(n => $"Line {n}: {n * 7919L:x16} content {(shape == "lines" ? i : 0)}\n"));
            f.Write($"{i}.txt", (shape == "shifted" ? new string('a', i * 19) : "") + text + $"Variant {i}\n");
        }
        var native = await new PackageBuilder().PackAsync(f.Request, ct); EngineFixture.Success(native);
        GitProcess.BeforeStart.Value = _ => throw new InvalidOperationException("Git invoked by managed delta creation");
        var builder = new PackageBuilder(new("missing-git") { ManagedSnapshots = true });
        EngineResult managed;
        try { managed = await builder.PackAsync(f.Request with { ReverseIndex = true }, ct); }
        finally { GitProcess.BeforeStart.Value = null; }
        EngineFixture.Success(managed); Assert.Equal(native.Manifest!.Current, managed.Manifest!.Current);
        var first = File.ReadAllBytes(f.Output);
        EngineFixture.Success(await builder.PackAsync(f.Request with { ReverseIndex = true }, ct)); Assert.Equal(first, File.ReadAllBytes(f.Output));
        var extracted = Path.Combine(f.Root, "extracted"); ZipFile.ExtractToDirectory(f.Output, extracted);
        var git = new GitProcess("git"); var pack = Directory.GetFiles(Path.Combine(extracted, ".git", "objects", "pack"), "*.pack").Single();
        var objects = await git.TextAsync(extracted, ct, "verify-pack", "-v", Path.ChangeExtension(pack, ".idx"));
        var deltas = objects.Split('\n').Select(l => l.Split(' ', StringSplitOptions.RemoveEmptyEntries)).Where(p => p.Length == 7).ToArray();
        Assert.Equal(3, deltas.Length); Assert.All(deltas, p => Assert.Equal("1", p[5]));
        await git.TextAsync(extracted, ct, "fsck", "--full", "--strict"); await git.TextAsync(extracted, ct, "read-tree", "HEAD");
        var index = Path.Combine(f.Root, "oracle.idx");
        await git.TextAsync(extracted, ct, "index-pack", "--strict", "--rev-index", "-o", index, pack);
        Assert.Equal(File.ReadAllBytes(index), File.ReadAllBytes(Path.ChangeExtension(pack, ".idx")));
        Assert.Equal(File.ReadAllBytes(Path.ChangeExtension(index, ".rev")), File.ReadAllBytes(Path.ChangeExtension(pack, ".rev")));
        EngineFixture.Success(await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), ct));
    }

    [Fact]
    public void MatchingHandlesUnrelatedDataBoundsAndCancellation()
    {
        var ct = TestContext.Current.CancellationToken; var random = new Random(7401);
        var source = new byte[200000]; random.NextBytes(source);
        var matcher = new SnapshotDelta(source, ct);
        for (var i = 0; i < 20; i++)
        {
            var start = random.Next(source.Length / 2); var count = random.Next(1000, source.Length - start);
            var target = new byte[count + 137]; random.NextBytes(target);
            source.AsSpan(start, count).CopyTo(target.AsSpan(67));
            var instructions = matcher.Encode(target, target.Length, ct);
            Assert.NotNull(instructions); Assert.Equal(target, SnapshotDeltaDecoder.Apply(instructions, source, target.Length, ct));
        }
        Assert.Null(matcher.Encode(source, 1, ct));
        var unrelated = new byte[source.Length]; random.NextBytes(unrelated);
        Assert.Null(matcher.Encode(unrelated, unrelated.Length, ct));
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(() => matcher.Encode(source, source.Length, cancelled.Token));
        Assert.ThrowsAny<OperationCanceledException>(() => new SnapshotDelta(source, cancelled.Token));
    }

    [Fact]
    public void IndependentDecoderHonorsImplicit64KiBCopyAndHighOffsetBytes()
    {
        var ct = TestContext.Current.CancellationToken; var source = Enumerable.Range(0, 131072).Select(i => (byte)i).ToArray();
        byte[] instructions = [0x80, 0x80, 8, 0x80, 0x80, 4, 0x84, 1];
        Assert.Equal(source[65536..], SnapshotDeltaDecoder.Apply(instructions, source, 65536, ct));
        Assert.Throws<Mdpkg.Reader.ResourceLimitException>(() => SnapshotDeltaDecoder.Apply(instructions, source, 65535, ct));
        Assert.Throws<EngineException>(() => SnapshotDeltaDecoder.Apply([0x80, 0x80, 8, 1, 0x88, 0xff], source, 100, ct));
    }
}
