using System.ComponentModel;
using System.Diagnostics;
using Mdpkg.Reader.Internal.Format;

namespace Mdpkg.Core.Internal.Git;

/// <summary>Plumbing only; never a shell, checkout, fetch, hook, or source write.</summary>
internal sealed class GitProcess(string executable, long maximumOutputBytes = long.MaxValue)
{
    // Async-local instrumentation for acceptance tests, including availability probes.
    internal static readonly AsyncLocal<Action<ProcessStartInfo>?> BeforeStart = new();
    public async Task<byte[]> RunAsync(string directory, IEnumerable<string> arguments, byte[]? input, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var args = arguments.ToArray();
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var key in start.Environment.Keys.Where(k => k.StartsWith("GIT_", StringComparison.OrdinalIgnoreCase)).ToArray()) start.Environment.Remove(key);
        start.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        start.Environment["GIT_CONFIG_GLOBAL"] = OperatingSystem.IsWindows() ? "NUL" : "/dev/null";
        start.Environment["GIT_TERMINAL_PROMPT"] = "0";
        start.Environment["GIT_NO_REPLACE_OBJECTS"] = "1";
        start.Environment["GIT_NO_LAZY_FETCH"] = "1";
        start.Environment["GIT_OPTIONAL_LOCKS"] = "0";
        start.Environment["LC_ALL"] = "C";
        foreach (var setting in new[] { "core.autocrlf=false", "core.compression=6", "pack.threads=1", "pack.window=10", "pack.depth=50", "pack.writeReverseIndex=false", "core.hooksPath=", "credential.helper=", "protocol.allow=never", "gc.auto=0", "maintenance.auto=false", "core.useReplaceRefs=false", "core.quotePath=false" })
        { start.ArgumentList.Add("-c"); start.ArgumentList.Add(setting); }
        foreach (var arg in args) start.ArgumentList.Add(arg);
        BeforeStart.Value?.Invoke(start);
        using var process = new Process { StartInfo = start };
        try { process.Start(); }
        catch (Win32Exception ex) { throw new IOException("Cannot start Git ('" + executable + "'): " + ex.Message, ex); }
        using var cancel = ct.Register(() => { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
        using var output = new MemoryStream();
        var read = ResourceOptions.CopyAsync(process.StandardOutput.BaseStream, output, maximumOutputBytes, ct);
        var error = process.StandardError.ReadToEndAsync(ct);
        async Task Feed()
        {
            try { if (input is not null) await process.StandardInput.BaseStream.WriteAsync(input, ct); }
            catch (IOException) when (!ct.IsCancellationRequested) { /* Early Git failure; report its stderr below. */ }
            finally { process.StandardInput.Close(); }
        }
        var feed = Feed(); var wait = process.WaitForExitAsync(ct);
        try
        {
            var first = await Task.WhenAny(read, wait);
            await first;
            await Task.WhenAll(read, feed, wait);
        }
        finally
        {
            if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); }
            try { await Task.WhenAll(read, feed, error); } catch (Exception) when (read.IsFaulted || ct.IsCancellationRequested) { }
        }
        var errors = await error;
        ct.ThrowIfCancellationRequested();
        if (process.ExitCode != 0) throw new IOException($"git {args.FirstOrDefault()} failed ({process.ExitCode}): {errors.Trim()}");
        return output.ToArray();
    }
    public async Task<string> TextAsync(string directory, CancellationToken ct, params string[] args) =>
        Profile.Utf8.GetString(await RunAsync(directory, args, null, ct)).TrimEnd('\r', '\n');
}
