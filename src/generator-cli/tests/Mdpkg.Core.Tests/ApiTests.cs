using System.Text;
using Mdpkg.Core;
using Mdpkg.Reader;
using Mdpkg.EngineTests;
using Builder = Mdpkg.Core.PackageBuilder;
using Validator = Mdpkg.Core.PackageValidator;

namespace Mdpkg.ApiTests;

public class ApiTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static SnapshotPackageRequest Request(string text = "# X\n") => new(Guid.Parse(EngineFixture.Namespace),
        [new("x.md", Encoding.UTF8.GetBytes(text))]) { History = HistoryMode.Git };
    private static void Success(Core.PackageResult result) => Assert.True(result.Status == OperationStatus.Success,
        string.Join("; ", result.Diagnostics.Select(d => d.Code + ": " + d.Message)));

    [Fact]
    public async Task FullValidationHonorsRaisedJsonDepthWithoutGitAndFreezesReviewMetadata()
    {
        using var f = new EngineFixture();
        var entries = EngineFixture.Read(EngineFixture.RepoFile("docs/spec/review-fixtures/delta-git-target-snapshot.mdpkg"));
        var i = entries.FindIndex(e => e.Name == ".mdpkg/review/comments.json");
        var json = System.Text.Json.Nodes.JsonNode.Parse(entries[i].Bytes)!;
        System.Text.Json.Nodes.JsonNode extension = new System.Text.Json.Nodes.JsonObject { ["leaf"] = "value" };
        for (var depth = 0; depth < 70; depth++) extension = new System.Text.Json.Nodes.JsonObject { ["nested"] = extension };
        json["extension"] = extension;
        entries[i] = new(entries[i].Name, CanonicalJson.Bytes(json)); EngineFixture.Rewrite(f.Output, entries);
        var validator = new Validator(new("no-such-git-" + Guid.NewGuid()));
        var low = await validator.ValidateFileAsync(f.Output, new(), Ct); Assert.Equal(OperationStatus.Nonconforming, low.Status);
        using var input = File.OpenRead(f.Output);
        var high = await validator.ValidateAsync(input, new() { Resources = new() { ReadLimits = new() { MaxJsonDepth = 96 } } }, Ct);
        Success(high); Assert.True(input.CanRead); input.Dispose();
        Assert.Equal("delta", high.Manifest!.Review!.Value.GetProperty("shape").GetString());
    }
    [Fact]
    public async Task MissingGitAndPreCancelledCreationPublishNothing()
    {
        using var f = new EngineFixture(); var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        var builder = new Builder(new("no-such-git-" + Guid.NewGuid(), temp));
        using var output = new MemoryStream();
        var missing = await builder.CreateAsync(Request(), output, Ct);
        Assert.Equal(OperationStatus.EnvironmentFailure, missing.Status); Assert.Equal(0, output.Length);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => builder.CreateAsync(Request(), output, cancelled.Token));
        Assert.Empty(Directory.GetFileSystemEntries(temp));
    }
    [Fact]
    public void LibraryDependenciesPreserveAcceptedGraph()
    {
        var core = typeof(Builder).Assembly.GetReferencedAssemblies().Select(a => a.Name).ToArray();
        Assert.Contains("Mdpkg.Reader", core); Assert.DoesNotContain("Mdpkg.Reviews", core);
        Assert.DoesNotContain("mdpkg", core); Assert.DoesNotContain("System.CommandLine", core);
        var reader = typeof(PackageArchive).Assembly;
        Assert.DoesNotContain(reader.GetReferencedAssemblies(), a => a.Name is "Mdpkg.Core" or "mdpkg" or "System.Diagnostics.Process");
        var friends = reader.GetCustomAttributes(typeof(System.Runtime.CompilerServices.InternalsVisibleToAttribute), false)
            .Cast<System.Runtime.CompilerServices.InternalsVisibleToAttribute>().Select(a => a.AssemblyName).ToArray();
        Assert.Contains("Mdpkg.Core", friends); Assert.DoesNotContain("mdpkg", friends); Assert.DoesNotContain("Mdpkg.Cli.Tests", friends);
    }

    [Fact]
    public async Task DirectoryAndMemoryAreByteIdenticalAndMetadataIsExplicit()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        var time = new DateTimeOffset(2024, 2, 3, 4, 5, 6, TimeSpan.FromHours(5.5));
        var metadata = new SnapshotMetadata(new("Author é", "author@example.invalid", time),
            new("Committer", "committer@example.invalid", time.AddDays(1)), "Explicit message\n");
        var result = await new Builder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)) { History = HistoryMode.Git, Metadata = metadata }, f.Output, Ct);
        Success(result);
        using var output = new MemoryStream();
        var memory = await new Builder().CreateAsync(new(Guid.Parse(EngineFixture.Namespace), Request().Entries) { History = HistoryMode.Git, Metadata = metadata }, output, Ct);
        Success(memory); Assert.Null(memory.Package!.Path); Assert.True(output.CanWrite);
        Assert.Equal(File.ReadAllBytes(f.Output), output.ToArray());
        var extracted = Path.Combine(f.Root, "extract"); System.IO.Compression.ZipFile.ExtractToDirectory(f.Output, extracted);
        var commit = await new Core.Internal.Git.Repository(new Core.Internal.Git.GitProcess("git"), extracted)
            .ReadObjectAsync("commit", result.Manifest!.Current.Id[5..], Ct);
        var text = Encoding.UTF8.GetString(commit);
        Assert.Contains("Author é <author@example.invalid> " + time.ToUnixTimeSeconds() + " +0530", text, StringComparison.Ordinal);
        Assert.Contains("committer Committer <committer@example.invalid>", text, StringComparison.Ordinal);
        Assert.EndsWith("Explicit message\n", text, StringComparison.Ordinal);
    }
    [Fact]
    public async Task EntryCollectionsAndResultsAreIndependentlyOwned()
    {
        var bytes = "# X\n"u8.ToArray(); var entries = new List<PackageInputEntry> { new("x.md", bytes) };
        var request = new SnapshotPackageRequest(Guid.Parse(EngineFixture.Namespace), entries) { History = HistoryMode.Git };
        entries.Clear(); Assert.Single(request.Entries);
        using var output = new MemoryStream(); var result = await new Builder().CreateAsync(request, output, Ct); Success(result);
        bytes[0] = (byte)'!';
        Assert.Throws<NotSupportedException>(() => ((IList<ValidationCheck>)result.Checks).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<string>)((Mdpkg.Reader.GitHistory)result.Manifest!.History).Transform).Add("projected"));
        Assert.Throws<NotSupportedException>(() => ((IList<CoverageRangeMetadata>)result.History!.AddressingCoverage).Clear());
        output.Dispose(); Assert.StartsWith("sha1-", result.Identity!.Current.Id, StringComparison.Ordinal);
    }
    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task NonSeekableAndFileValidationHaveSameChecks(bool deep)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        Success(await new Builder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)) { History = HistoryMode.Git }, f.Output, Ct));
        var options = new ValidationOptions { Deep = deep };
        var validator = new Validator(); var file = await validator.ValidateFileAsync(f.Output, options, Ct);
        using var input = new NonSeekable(File.ReadAllBytes(f.Output)); var stream = await validator.ValidateAsync(input, options, Ct);
        Success(stream); Assert.True(input.CanRead); Assert.Null(stream.Package!.Path);
        Assert.Equal(file.Checks, stream.Checks); Assert.Equal(file.Package!.Sha256, stream.Package.Sha256);
        Assert.Equal(deep ? ValidationLevel.Deep : ValidationLevel.Full, stream.RequestedLevel);
        Assert.Equal(deep ? 0 : 2, stream.Checks.Count(c => c.Status == CheckStatus.Skipped));
    }
    [Theory]
    [InlineData("source")][InlineData("member")][InlineData("count")][InlineData("archive")][InlineData("aggregate")][InlineData("spool")][InlineData("manifest")]
    public async Task CreationLimitsPreserveDestinationAndCleanPrivateState(string limit)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n"); File.WriteAllText(f.Output, "prior");
        var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        var resources = limit switch
        {
            "source" => new ResourceOptions { MaxSourceBytes = 1 },
            "member" => new ResourceOptions { ReadLimits = new() { MaxDocumentBytes = 1 } },
            "count" => new ResourceOptions { ReadLimits = new() { MaxEntries = 1 } },
            "archive" => new ResourceOptions { ReadLimits = new() { MaxInputBytes = 1 } },
            "aggregate" => new ResourceOptions { ReadLimits = new() { MaxDecodedBytes = 1 } },
            "manifest" => new ResourceOptions { ReadLimits = new() { MaxManifestBytes = 1 } },
            _ => new ResourceOptions { MaxSpoolBytes = 1 }
        };
        var options = new CreationOptions { Resources = resources };
        var builder = new Builder(new(TemporaryDirectory: temp));
        var file = await builder.CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)) { History = HistoryMode.Git, Options = options }, f.Output, Ct);
        using var output = new MemoryStream(); var memory = await builder.CreateAsync(new(Guid.Parse(EngineFixture.Namespace), Request().Entries) { History = HistoryMode.Git, Options = options }, output, Ct);
        Assert.Equal(OperationStatus.ResourceLimitExceeded, file.Status); Assert.Equal(file.Status, memory.Status);
        Assert.Equal(0, output.Length); Assert.Equal("prior", File.ReadAllText(f.Output)); Assert.Empty(Directory.GetFileSystemEntries(temp));
        Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }
    [Theory]
    [InlineData("input")][InlineData("directory")][InlineData("count")][InlineData("document")][InlineData("aggregate")][InlineData("manifest")]
    public async Task ValidationLimitsApplyEquallyToFileAndStream(string limit)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        Success(await new Builder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace)) { History = HistoryMode.Git }, f.Output, Ct));
        var limits = limit switch
        {
            "input" => new ReadLimits { MaxInputBytes = 1 }, "directory" => new ReadLimits { MaxDirectoryBytes = 1 },
            "count" => new ReadLimits { MaxEntries = 1 }, "document" => new ReadLimits { MaxDocumentBytes = 1 },
            "aggregate" => new ReadLimits { MaxDecodedBytes = 1 }, _ => new ReadLimits { MaxManifestBytes = 1 }
        };
        var options = new ValidationOptions { Resources = new() { ReadLimits = limits } };
        var validator = new Validator(); var file = await validator.ValidateFileAsync(f.Output, options, Ct);
        using var input = new NonSeekable(File.ReadAllBytes(f.Output)); var stream = await validator.ValidateAsync(input, options, Ct);
        Assert.Equal(OperationStatus.ResourceLimitExceeded, file.Status); Assert.Equal(file.Status, stream.Status); Assert.True(input.CanRead);
    }
    [Fact]
    public async Task StreamSpoolCancellationAndFailuresCleanAndLeaveCallerStreamOpen()
    {
        using var f = new EngineFixture(); var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        using var input = new NonSeekable(new byte[100], () => cancel.Cancel());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new Validator(new(TemporaryDirectory: temp)).ValidateAsync(input, new(), cancel.Token));
        Assert.True(input.CanRead); Assert.Empty(Directory.GetFileSystemEntries(temp));
        using var tooBig = new NonSeekable(new byte[100]);
        var rejected = await new Validator(new(TemporaryDirectory: temp)).ValidateAsync(tooBig, new() { Resources = new() { MaxSpoolBytes = 1 } }, Ct);
        Assert.Equal(OperationStatus.ResourceLimitExceeded, rejected.Status); Assert.Empty(Directory.GetFileSystemEntries(temp));
    }
    [Theory]
    [InlineData(false, HistoryMode.None)][InlineData(true, HistoryMode.None)]
    [InlineData(false, HistoryMode.Git)][InlineData(true, HistoryMode.Git)]
    public async Task FailedOrCancelledFinalCopyLeavesPrefixAndNoSuccess(bool cancelCopy, HistoryMode history)
    {
        using var f = new EngineFixture(); var temp = Path.Combine(f.Root, "temp"); Directory.CreateDirectory(temp);
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        using var output = new InterruptedOutput(cancelCopy ? cancel : null);
        var request = new SnapshotPackageRequest(Guid.Parse(EngineFixture.Namespace), Request().Entries) { History = history };
        var task = new Builder(new(TemporaryDirectory: temp)).CreateAsync(request, output, cancel.Token);
        if (cancelCopy) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        else Assert.Equal(OperationStatus.EnvironmentFailure, (await task).Status);
        Assert.True(output.CanWrite); Assert.True(output.Length > 0); Assert.Empty(Directory.GetFileSystemEntries(temp));
    }
    [Fact]
    public async Task WarningPromotionAndRequireCompleteHappenBeforeStreamPublication()
    {
        using var output = new MemoryStream();
        var warning = new SnapshotPackageRequest(Guid.Parse(EngineFixture.Namespace), Request("# X\r\n").Entries)
        { History = HistoryMode.Git, Options = new() { Warnings = WarningPolicy.Fail } };
        Assert.Equal(OperationStatus.Nonconforming, (await new Builder().CreateAsync(warning, output, Ct)).Status); Assert.Equal(0, output.Length);
        var partial = new SnapshotPackageRequest(Guid.Parse(EngineFixture.Namespace), Request().Entries)
        { Correspondence = new([new UnconfirmedRecord(new(EngineFixture.RootId), "unconfirmed-removal")]), Options = new() { RequireComplete = true } };
        Assert.Equal(OperationStatus.ObligationUnmet, (await new Builder().CreateAsync(partial, output, Ct)).Status); Assert.Equal(0, output.Length);
    }
    [Fact]
    public async Task CorrespondenceCodecAndTypedMovesAgreeAndFreezeHeadingTrails()
    {
        var trail = new List<HeadingPart> { new("# X", 0) };
        var correspondence = new Correspondence([new ConfirmedMove(new(EngineFixture.RootId), new("section", "x.md", trail))]);
        trail.Clear();
        var decoded = CorrespondenceCodec.Decode(CorrespondenceCodec.Encode(correspondence));
        Assert.Equal(CorrespondenceCodec.Encode(correspondence), CorrespondenceCodec.Encode(decoded));
        var request = new SnapshotPackageRequest(Guid.Parse(EngineFixture.Namespace), Request().Entries) { History = HistoryMode.Git, Correspondence = decoded };
        using var output = new MemoryStream(); var result = await new Builder().CreateAsync(request, output, Ct); Success(result); Assert.Equal(1, result.OverrideCount);
        Assert.Throws<PackageFormatException>(() => CorrespondenceCodec.Decode(Encoding.UTF8.GetBytes("[{\"root\":\"" + EngineFixture.RootId + "\",\"confirmed\":false,\"to\":[\"document\",\"x.md\",[]]}]")));
        Assert.Throws<ArgumentException>(() => new Correspondence([new ConfirmedRetirement(new(EngineFixture.RootId), "invented")]));
    }
    [Fact]
    public async Task InvalidArgumentsThrowAndUnsupportedObjectFormatIsExplicit()
    {
        var builder = new Builder(); using var nonempty = new MemoryStream([1]);
        await Assert.ThrowsAsync<ArgumentException>(() => builder.CreateAsync(Request(), nonempty, Ct));
        using var readonlyOutput = new MemoryStream([], writable: false);
        await Assert.ThrowsAsync<ArgumentException>(() => builder.CreateAsync(Request(), readonlyOutput, Ct));
        using var empty = new MemoryStream();
        var invalid = new SnapshotPackageRequest(Guid.NewGuid(), []) { History = HistoryMode.Git, Options = new() { CompressionLevel = 10 } };
        await Assert.ThrowsAsync<ArgumentException>(() => builder.CreateAsync(invalid, empty, Ct));
        var unsupported = new SnapshotPackageRequest(Guid.NewGuid(), []) { History = HistoryMode.Git, Options = new() { ObjectFormat = "sha256" } };
        var rejected = await builder.CreateAsync(unsupported, empty, Ct); Assert.Equal(OperationStatus.SourceRejected, rejected.Status);
        Assert.Contains(rejected.Diagnostics, d => d.Code == "MDPK4001"); Assert.Equal(0, empty.Length);
    }
    [Theory]
    [InlineData("../outside.md")][InlineData(".git/config")][InlineData(".mdpkg/manifest.json")]
    public async Task MemoryPathsHaveNoSafetyEscapeHatch(string path)
    {
        using var output = new MemoryStream();
        var result = await new Builder().CreateAsync(new(Guid.NewGuid(), [new(path, "text"u8.ToArray())]), output, Ct);
        Assert.Equal(OperationStatus.SourceRejected, result.Status); Assert.Equal(0, output.Length);
    }
    private sealed class NonSeekable(byte[] bytes, Action? reading = null) : Stream
    {
        private readonly MemoryStream inner = new(bytes);
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException(); public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { reading?.Invoke(); cancellationToken.ThrowIfCancellationRequested(); return inner.ReadAsync(buffer, cancellationToken); }
        public override void Flush() { } public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException(); public override void Write(byte[] b, int o, int c) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }
    private sealed class InterruptedOutput(CancellationTokenSource? cancel) : MemoryStream
    {
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Write(buffer.Span[..Math.Min(10, buffer.Length)]);
            if (cancel is not null) { cancel.Cancel(); cancellationToken.ThrowIfCancellationRequested(); }
            throw new IOException("Injected copy failure");
        }
    }
}
