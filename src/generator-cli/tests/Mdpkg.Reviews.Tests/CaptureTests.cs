using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Container;
using Mdpkg.Tests;

namespace Mdpkg.Reviews.Tests;

public class CaptureTests
{
    [Theory]
    [InlineData("declared")][InlineData("verified")][InlineData("review")]
    public async Task SnapshotAndFullReviewUsePrivateDiskCaptureFromCurrentPosition(string operation)
    {
        var temp = CreateTemp();
        try
        {
            var bytes = Fixtures.Bytes(operation == "review" ? "delta-v2.mdpkg" : "original.mdpkg");
            using var input = new ObservedInput(new byte[17].Concat(bytes).ToArray(), temp);
            input.Position = 17;
            var limits = new ReadLimits { TemporaryDirectory = temp, MaxInputBytes = bytes.Length };
            if (operation == "review")
            {
                var result = await new ReviewExtractor().ExtractAsync(input,
                    new() { Limits = limits, VerificationProvider = new ReviewVerificationProvider() }, TestContext.Current.CancellationToken);
                Assert.Equal(VerificationLevel.Full, result.VerificationLevel);
                Assert.Equal(2, result.Items.Count);
            }
            else
            {
                var snapshot = await PackageSnapshot.ReadAsync(input, limits, TestContext.Current.CancellationToken, operation == "verified");
                Assert.Equal(operation == "verified" ? IdentityAssurance.SnapshotVerified : IdentityAssurance.Declared, snapshot.Assurance);
                Assert.NotEmpty(snapshot.GetScopes("guide.md", TestContext.Current.CancellationToken));
                Assert.Equal(bytes.Length, snapshot.PackageBytes);
            }
            Assert.True(input.ReadCalls > 1);
            Assert.True(input.CanRead);
            Assert.Empty(Directory.GetFiles(temp));
        }
        finally { Directory.Delete(temp); }
    }

    [Theory]
    [InlineData("declared", "limit")][InlineData("verified", "limit")][InlineData("review", "limit")]
    [InlineData("declared", "io")][InlineData("verified", "io")][InlineData("review", "io")]
    [InlineData("declared", "cancel")][InlineData("verified", "cancel")][InlineData("review", "cancel")]
    public async Task CaptureFailureCleansSpoolAndLeavesCallerOpen(string operation, string failure)
    {
        var temp = CreateTemp();
        try
        {
            using var cancel = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            using var input = new ObservedInput(Fixtures.Bytes(operation == "review" ? "delta-v2.mdpkg" : "original.mdpkg"), temp,
                failure == "limit", failure == "io", failure == "cancel" ? cancel : null);
            var limits = new ReadLimits { TemporaryDirectory = temp, MaxInputBytes = failure == "limit" ? 129 : 128 * 1024 * 1024 };
            async Task Read()
            {
                if (operation == "review")
                {
                    var result = await new ReviewExtractor().ExtractAsync(input,
                        new() { Limits = limits, VerificationProvider = new ReviewVerificationProvider() }, cancel.Token);
                    Assert.Equal(failure == "limit" ? ReviewOutcome.ResourceLimitExceeded : ReviewOutcome.EnvironmentFailure, result.Outcome);
                    Assert.NotEqual(VerificationLevel.Full, result.VerificationLevel);
                }
                else await PackageSnapshot.ReadAsync(input, limits, cancel.Token, operation == "verified");
            }
            if (failure == "cancel") await Assert.ThrowsAnyAsync<OperationCanceledException>(Read);
            else if (operation == "review") await Read();
            else if (failure == "limit") await Assert.ThrowsAsync<ResourceLimitException>(Read);
            else await Assert.ThrowsAsync<IOException>(Read);
            Assert.True(input.ReadCalls >= 2);
            Assert.True(input.CanRead);
            Assert.Empty(Directory.GetFiles(temp));
        }
        finally { Directory.Delete(temp); }
    }

    [Fact]
    public async Task DiskCaptureCopiesLargeInputInBoundedChunks()
    {
        var temp = CreateTemp();
        try
        {
            var bytes = new byte[200_000]; new Random(42).NextBytes(bytes);
            using var input = new ObservedInput(bytes, temp);
            using (var captured = await InputSpool.CaptureAsync(input, new() { TemporaryDirectory = temp, MaxInputBytes = bytes.Length }, TestContext.Current.CancellationToken))
            {
                Assert.IsType<FileStream>(captured);
                Assert.Equal(bytes.Length, captured.Length);
                var buffer = new byte[4096]; var offset = 0;
                int read;
                while ((read = await captured.ReadAsync(buffer, TestContext.Current.CancellationToken)) != 0)
                {
                    Assert.Equal(bytes.AsSpan(offset, read).ToArray(), buffer.AsSpan(0, read).ToArray());
                    offset += read;
                }
                Assert.Equal(bytes.Length, offset);
            }
            Assert.True(input.CanRead);
            Assert.Empty(Directory.GetFiles(temp));
        }
        finally { Directory.Delete(temp); }
    }

    private static string CreateTemp()
    {
        var temp = Path.Combine(Path.GetTempPath(), "mdpkg-capture-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp); return temp;
    }

    private sealed class ObservedInput(byte[] bytes, string temp, bool nonSeekable = false,
        bool fail = false, CancellationTokenSource? cancel = null) : MemoryStream(bytes)
    {
        public int ReadCalls { get; private set; }
        public override bool CanSeek => !nonSeekable;
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            ReadCalls++;
            Assert.InRange(buffer.Length, 1, 65536);
            var path = Assert.Single(Directory.GetFiles(temp));
            if (!OperatingSystem.IsWindows())
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
            if (ReadCalls == 2)
            {
                if (fail) throw new IOException("Injected read failure.");
                cancel?.Cancel();
            }
            return base.ReadAsync(buffer[..Math.Min(128, buffer.Length)], cancellationToken);
        }
    }
}
