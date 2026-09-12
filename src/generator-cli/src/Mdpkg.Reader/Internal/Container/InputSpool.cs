namespace Mdpkg.Reader.Internal.Container;

/// <summary>Private disk capture with bounded memory, byte limits and delete-on-close ownership.</summary>
internal static class InputSpool
{
    internal static async Task<FileStream> CaptureAsync(Stream input, ReadLimits limits, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!input.CanRead) throw new ArgumentException("A readable stream is required.", nameof(input));
        limits.Validate(); ct.ThrowIfCancellationRequested();
        if (input.CanSeek && input.Length - input.Position > limits.MaxInputBytes)
            throw new ResourceLimitException("Package input exceeds its spool limit.");
        var path = Path.Combine(limits.TemporaryDirectory ?? Path.GetTempPath(), "mdpkg-read-" + Guid.NewGuid().ToString("N") + ".tmp");
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite, Share = FileShare.None,
            Options = FileOptions.Asynchronous | FileOptions.DeleteOnClose };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        var spool = new FileStream(path, options);
        try
        {
            var buffer = new byte[65536]; long length = 0;
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                var read = await input.ReadAsync(buffer, ct);
                if (read == 0) break;
                if (read > limits.MaxInputBytes - length) throw new ResourceLimitException("Package input exceeds its spool limit.");
                length += read;
                await spool.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            ct.ThrowIfCancellationRequested();
            spool.Position = 0;
            return spool;
        }
        catch { await spool.DisposeAsync(); throw; }
    }
}
