using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Mdpkg.Cli.Commands;

/// <summary>Protect package/source bytes before running a command and again before publishing its report.</summary>
internal static class ReportDestination
{
    private static readonly StringComparison Comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    public static string? Error(string? report, IEnumerable<string?> protectedFiles, string? source = null)
    {
        if (report is null) return null;
        try
        {
            var resolved = ResolvePath(report);
            var identity = Identity(report);
            foreach (var input in protectedFiles.Where(p => p is not null))
                if (string.Equals(resolved, ResolvePath(input!), Comparison) ||
                    (identity is not null && identity == Identity(input!)))
                    return "--report must not overwrite or alias a package, output, or correspondence input.";
            if (source is not null)
            {
                var sourcePath = ResolvePath(source);
                if (string.Equals(resolved, sourcePath, Comparison) ||
                    resolved.StartsWith(Path.TrimEndingDirectorySeparator(sourcePath) + Path.DirectorySeparatorChar, Comparison))
                    return "--report must be outside the source directory, including linked directories.";
                // A hard link outside the tree still names source bytes. Include hidden Git files;
                // do not recurse through directory links (the source reader rejects those).
                if (identity is not null && Directory.Exists(source))
                {
                    var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint, IgnoreInaccessible = false };
                    foreach (var file in Directory.EnumerateFiles(source, "*", options))
                        if (identity == Identity(file)) return "--report must not alias a file in the source directory.";
                }
            }
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        { return "Cannot verify --report destination safety: " + ex.Message; }
    }

    private static string ResolvePath(string path, int depth = 0)
    {
        if (depth > 64) throw new IOException("Too many filesystem links.");
        var full = Path.GetFullPath(path);
        var current = Path.GetPathRoot(full)!;
        foreach (var part in full[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.LinkTarget is not null)
                current = ResolvePath(info.ResolveLinkTarget(returnFinalTarget: true)!.FullName, depth + 1);
        }
        return Path.TrimEndingDirectorySeparator(current);
    }

    private readonly record struct FileIdentity(ulong Volume, ulong Low, ulong High);
    private static FileIdentity? Identity(string path)
    {
        SafeFileHandle handle;
        try { handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException) { return null; }
        using (handle)
        {
            if (OperatingSystem.IsWindows())
            {
                if (!GetFileInformationByHandleEx(handle, 18 /* FileIdInfo */, out var id, 24))
                    throw new IOException("Cannot read file identity: " + path, new Win32Exception(Marshal.GetLastPInvokeError()));
                return new(id.Volume, id.Low, id.High);
            }
            if (OperatingSystem.IsLinux())
            {
                var status = Statx(handle.DangerousGetHandle().ToInt32(), "", 0x1000 /* AT_EMPTY_PATH */, 0x100 /* STATX_INO */, out var id);
                GC.KeepAlive(handle);
                if (status != 0 || (id.Mask & 0x100) == 0)
                    throw new IOException("Cannot read file identity: " + path, new Win32Exception(Marshal.GetLastPInvokeError()));
                return new(((ulong)id.DeviceMajor << 32) | id.DeviceMinor, id.Inode, 0);
            }
            throw new PlatformNotSupportedException("Report identity checks require Windows or Linux.");
        }
    }

    // FILE_ID_INFO includes the volume serial and full 128-bit ID (including ReFS IDs).
    [StructLayout(LayoutKind.Sequential)]
    private struct WindowsIdentity { public ulong Volume; public ulong Low; public ulong High; }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int informationClass, out WindowsIdentity information, uint size);

    // Linux statx has a fixed, architecture-independent ABI; unused fields remain reserved.
    [StructLayout(LayoutKind.Explicit, Size = 256)]
    private struct LinuxIdentity
    {
        [FieldOffset(0)] public uint Mask;
        [FieldOffset(32)] public ulong Inode;
        [FieldOffset(136)] public uint DeviceMajor;
        [FieldOffset(140)] public uint DeviceMinor;
    }
    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int Statx(int directory, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, out LinuxIdentity information);

    public static void Write(string report, string json)
    {
        // Never truncate an existing inode: even an alias introduced after the safety check
        // must not modify other hard links. CreateNew also protects the staging file.
        var staged = Path.Combine(Path.GetDirectoryName(report)!, "." + Path.GetFileName(report) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var file = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(file)) writer.Write(json);
            File.Move(staged, report, overwrite: true);
        }
        finally { File.Delete(staged); }
    }
}
