using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Tests;

namespace Mdpkg.Reader.Tests;

public class ReaderTests
{
    [Fact]
    public async Task IndependentUnicodeRootDigestAndScopeOffsetsMatch()
    {
        using var input = Fixtures.Stream("original.mdpkg");
        var snapshot = await PackageSnapshot.ReadAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        var expected = Fixtures.Json("vectors.json");
        var scope = snapshot.GetScopes("guide.md", TestContext.Current.CancellationToken).Single(s => s.Locator.Kind == "section" && s.Locator.HeadingTrail.Count == 1);
        Assert.Equal(expected["root"]!.GetValue<string>(), scope.Root); Assert.Equal(expected["expect"]!.GetValue<string>(), scope.Digest);
        Assert.Equal(expected["source"]!.GetValue<string>(), scope.CanonicalSource);
        Assert.Equal(expected["utf16SourceLength"]!.GetValue<int>(), scope.CanonicalSource.Length);
        Assert.Equal(0, scope.DocumentStart); Assert.True(input.CanRead);
    }
    [Fact]
    public void SourceScopesKeepBomNormalizeEolAndRecognizeOnlyDirectCommonMarkHeadings()
    {
        var source = "\ufeffpreamble\r\n\r\n# Top\r\n\r\n> # Quoted\r\n\r\nMulti\r\nline\r\n---\r\n😀 e\u0301\r\n## Same\r\nA\r\n## Same\r\nB\r\n";
        var scopes = Inventory.Document(Profile.Utf8.GetBytes(source), "x.md", "c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8", TestContext.Current.CancellationToken);
        Assert.Equal(6, scopes.Count); Assert.StartsWith("\ufeff", scopes[0].Source, StringComparison.Ordinal);
        Assert.DoesNotContain('\r', scopes[0].Source); Assert.Contains("Multi\nline\n---", scopes[3].Source, StringComparison.Ordinal);
        Assert.Equal(1, scopes[5].Locator[2]![1]![1]!.GetValue<int>());
        foreach (var scope in scopes) Assert.Equal(scope.Source, Inventory.CanonicalSource(scopes[0].Source[scope.SourceStart..].Substring(0, scope.Source.Length)));
    }
    [Theory]
    [InlineData("input")][InlineData("directory")][InlineData("entries")][InlineData("manifest")][InlineData("aggregate")]
    public async Task LimitsRejectRatherThanTruncate(string limit)
    {
        using var input = Fixtures.Stream();
        var limits = limit switch { "input" => new ReadLimits { MaxInputBytes = 100 }, "directory" => new() { MaxDirectoryBytes = 1 },
            "entries" => new() { MaxEntries = 1 }, "manifest" => new() { MaxManifestBytes = 1 }, _ => new() { MaxDecodedBytes = 1 } };
        await Assert.ThrowsAsync<ResourceLimitException>(() => PackageArchive.OpenAsync(input, limits, cancellationToken: TestContext.Current.CancellationToken));
        Assert.True(input.CanRead);
    }
    [Fact]
    public async Task SelectedPayloadLimitAndCrcAreEnforcedWithoutDecodingPack()
    {
        var bytes = Fixtures.Bytes("delta-git-target-snapshot.mdpkg");
        using (var original = new MemoryStream(bytes))
        using (var archive = await PackageArchive.OpenAsync(original, cancellationToken: TestContext.Current.CancellationToken))
            Assert.Throws<ResourceLimitException>(() => archive.ReadEntry(".mdpkg/review/comments.json", 10, TestContext.Current.CancellationToken));
        // Locate pack data from the independent central index and corrupt only that payload.
        var pack = Mdpkg.Reader.Internal.Container.ZipReader.Index(new MemoryStream(bytes), new(), TestContext.Current.CancellationToken).Members.Single(e => e.Name.EndsWith(".pack", StringComparison.Ordinal));
        bytes[pack.DataOffset] ^= 0x20;
        using var input = new MemoryStream(bytes);
        using var selected = await PackageArchive.OpenAsync(input, cancellationToken: TestContext.Current.CancellationToken);
        Assert.NotEmpty(selected.ReadEntry(".mdpkg/review/comments.json", cancellationToken: TestContext.Current.CancellationToken));
        Assert.Throws<PackageFormatException>(() => selected.ReadEntry(pack.Name, cancellationToken: TestContext.Current.CancellationToken));
    }
    [Theory]
    [InlineData("truncated")][InlineData("overlap")][InlineData("zip64")][InlineData("collision")][InlineData("unsafe")]
    public async Task InvalidDirectoryAndPathsAreRejected(string mutation)
    {
        var bytes = Fixtures.Bytes("original.mdpkg");
        if (mutation == "truncated") bytes = bytes[..^8];
        else if (mutation == "zip64") BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(bytes.Length - 12), ushort.MaxValue);
        else if (mutation == "overlap")
        {
            var cd = (int)BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(bytes.Length - 6));
            var next = cd + 46 + BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(cd + 28));
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(next + 42), 0);
        }
        else bytes = Fixtures.Rewrite(bytes, e => e.Add(mutation == "collision" ? "GUIDE.md" : "../evil.md", "x"u8.ToArray()));
        using var input = new MemoryStream(bytes);
        await Assert.ThrowsAsync<PackageFormatException>(() => PackageArchive.OpenAsync(input, cancellationToken: TestContext.Current.CancellationToken));
    }
    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task NonSeekableSpoolIsBoundedPrivateAndCleanedOnCancellation(bool cancel)
    {
        var temp = Path.Combine(Path.GetTempPath(), "mdpkg-reader-test-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temp);
        try
        {
            using var token = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            using var input = new NonSeekable(Fixtures.Stream(), cancel ? () => token.Cancel() : null);
            if (cancel) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => PackageArchive.OpenAsync(input, new() { TemporaryDirectory = temp }, cancellationToken: token.Token));
            else await Assert.ThrowsAsync<ResourceLimitException>(() => PackageArchive.OpenAsync(input, new() { TemporaryDirectory = temp, MaxInputBytes = 100 }, cancellationToken: token.Token));
            Assert.Empty(Directory.GetFiles(temp)); Assert.False(input.WasDisposed);
        }
        finally { Directory.Delete(temp); }
    }
    [Fact]
    public async Task NonSeekableSuccessAndNonzeroSeekableOriginLeaveInputsOpen()
    {
        using var input = new NonSeekable(Fixtures.Stream());
        using (var archive = await PackageArchive.OpenAsync(input, cancellationToken: TestContext.Current.CancellationToken)) Assert.NotEmpty(archive.Entries);
        Assert.False(input.WasDisposed);
        using var offset = new MemoryStream(new byte[17].Concat(Fixtures.Bytes("original.mdpkg")).ToArray()); offset.Position = 17;
        using (var archive = await PackageArchive.OpenAsync(offset, cancellationToken: TestContext.Current.CancellationToken)) Assert.Equal(Fixtures.Bytes("original.mdpkg").Length, archive.PackageBytes);
        Assert.True(offset.CanRead);
    }
    [Fact]
    public void ReaderAssemblyHasNoCliWriterOrGitProcessDependency()
    {
        var references = typeof(PackageArchive).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
        Assert.DoesNotContain("mdpkg", references); Assert.DoesNotContain("Mdpkg.Core", references); Assert.DoesNotContain("System.CommandLine", references);
        Assert.DoesNotContain("System.Diagnostics.Process", references);
    }
}
