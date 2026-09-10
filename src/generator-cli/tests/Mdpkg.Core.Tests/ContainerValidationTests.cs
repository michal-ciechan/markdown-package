using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Mdpkg.Core.Internal;
using Mdpkg.Core.Internal.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Core.Internal.Validation;

namespace Mdpkg.EngineTests;

public class ContainerValidationTests
{
    [Fact]
    public void ContainerStreamsRemainCallerOwnedOnSuccessAndCancellation()
    {
        using var stream = new MemoryStream();
        ZipContainer.Write(stream, [new("x.md", "text"u8.ToArray())], 6, false, TestContext.Current.CancellationToken);
        Assert.True(stream.CanWrite);
        ZipContainer.Read(stream, TestContext.Current.CancellationToken);
        Assert.True(stream.CanRead);
        using var canceled = new CancellationTokenSource(); canceled.Cancel();
        Assert.ThrowsAny<OperationCanceledException>(() => ZipContainer.Write(stream, [], 6, false, canceled.Token));
        Assert.True(stream.CanWrite);
    }
    private static uint U32(byte[] b, int p) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(p));
    private static ushort U16(byte[] b, int p) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(p));
    private static void Put32(byte[] b, int p, uint n) => BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(p), n);
    private static void Put16(byte[] b, int p, ushort n) => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(p), n);
    private static int Central(byte[] bytes, string name)
    {
        var p = (int)U32(bytes, bytes.Length - 6);
        while (U32(bytes, p) == 0x02014b50)
        {
            if (Profile.Utf8.GetString(bytes, p + 46, U16(bytes, p + 28)) == name) return p;
            p += 46 + U16(bytes, p + 28) + U16(bytes, p + 30) + U16(bytes, p + 32);
        }
        throw new InvalidOperationException("Missing central entry.");
    }
    [Theory]
    [InlineData("attributes", "MDPK1005")][InlineData("method", "MDPK1008")]
    [InlineData("crc", "MDPK1011")][InlineData("deflate", "MDPK1011")]
    [InlineData("truncated-deflate", "MDPK1011")][InlineData("extent", "MDPK1011")]
    [InlineData("zip64", "MDPK1010")][InlineData("encryption", "MDPK1011")]
    [InlineData("manifest-crc", "MDPK1006")][InlineData("local-name", "MDPK1011")]
    public async Task CorruptContainerFailsWithStableDiagnostic(string mutation, string expected)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n" + new string('a', 3000));
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var bytes = File.ReadAllBytes(f.Output); var cd = Central(bytes, "x.md"); var local = (int)U32(bytes, cd + 42);
        var data = local + 30 + U16(bytes, local + 26) + U16(bytes, local + 28);
        switch (mutation)
        {
            case "attributes": Put16(bytes, cd + 36, 1); break;
            case "method": Put16(bytes, cd + 10, 99); break;
            case "crc": Put32(bytes, cd + 16, U32(bytes, cd + 16) ^ 1); break;
            case "deflate": bytes[data] = 0xff; break;
            case "truncated-deflate": Put32(bytes, cd + 20, U32(bytes, cd + 20) - 1); break;
            case "extent": Put32(bytes, cd + 42, (uint)bytes.Length + 1); break;
            case "zip64": Put32(bytes, cd + 24, uint.MaxValue); break;
            case "encryption": Put16(bytes, cd + 8, 1); break;
            case "manifest-crc": Put32(bytes, 14, 0); break;
            case "local-name": bytes[local + 30] = (byte)'y'; break;
        }
        File.WriteAllBytes(f.Output, bytes);
        var result = await new PackageValidator().ValidateAsync(new(f.Output), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, result.Outcome);
        Assert.Contains(result.Diagnostics, d => d.Code == expected);
    }
    [Theory]
    [InlineData("current", "MDPK2001")][InlineData("ledger", "MDPK2002")]
    [InlineData("transform", "MDPK2003")][InlineData("shallow", "MDPK2004")]
    [InlineData("summary", "MDPK2005")][InlineData("patch", "MDPK2006")]
    [InlineData("config", "MDPK4002")][InlineData("hook", "MDPK4002")]
    [InlineData("reserved", "MDPK1002")][InlineData("crlf", "MDPK1004")]
    [InlineData("utf8", "MDPK4003")][InlineData("profile", "MDPK2007")]
    [InlineData("pack-last", "MDPK1007")]
    public async Task InternallyInconsistentPackageFails(string mutation, string expected)
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var entries = EngineFixture.Read(f.Output);
        var manifest = CanonicalJson.Parse(entries[0].Bytes, ct: TestContext.Current.CancellationToken);
        var historyIndex = entries.FindIndex(e => e.Name == Profile.History);
        var history = CanonicalJson.Parse(entries[historyIndex].Bytes, ct: TestContext.Current.CancellationToken);
        switch (mutation)
        {
            case "current": manifest["current"] = "sha1-" + new string('0', 40); break;
            case "ledger": manifest["addressing"]!["overrides"] = Profile.Ledger; break;
            case "transform": manifest["history"]!["transform"] = new JsonArray("squashed"); break;
            case "shallow": history["shallowBoundaries"] = new JsonArray("sha1-" + new string('0', 40)); break;
            case "summary": history["ranges"] = new JsonArray(".mdpkg/history/ranges/" + new string('0', 64) + ".json"); break;
            case "patch": history["patches"] = new JsonArray(new JsonObject { ["entry"] = ".mdpkg/history/patches/" + new string('0', 64) + ".patch", ["sha256"] = new string('0', 64), ["from"] = manifest["current"]!.DeepClone(), ["to"] = manifest["current"]!.DeepClone(), ["document"] = new string('0', 64), ["profile"] = "git-myers-u3-v1" }); break;
            case "config": entries[entries.FindIndex(e => e.Name == ".git/config")] = new(".git/config", "[core]\n\tbare = true\n"u8.ToArray()); break;
            case "hook": entries.Insert(2, new(".git/hooks/post-checkout", "bad"u8.ToArray())); break;
            case "reserved": entries.Insert(2, new(".MDPKG/secret.md", "bad"u8.ToArray())); break;
            case "crlf": entries[1] = new("x.md", "# X\r\n"u8.ToArray()); break;
            case "utf8": entries[1] = new("x.md", [0xff]); break;
            case "profile": manifest["addressing"]!["anchor"] = "unknown"; break;
            case "pack-last": (entries[^1], entries[^2]) = (entries[^2], entries[^1]); break;
        }
        entries[0] = new(Profile.Manifest, CanonicalJson.Bytes(manifest, true));
        historyIndex = entries.FindIndex(e => e.Name == Profile.History);
        entries[historyIndex] = new(Profile.History, CanonicalJson.Bytes(history));
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new PackageValidator().ValidateAsync(new(f.Output), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == expected);
    }
    [Fact]
    public async Task RecoverableIsReportedButStillFailsConformance()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var entries = EngineFixture.Read(f.Output); (entries[0], entries[1]) = (entries[1], entries[0]);
        EngineFixture.Rewrite(f.Output, entries);
        var validator = new PackageValidator();
        var rejected = await validator.ValidateAsync(new(f.Output), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, rejected.Outcome); Assert.Null(rejected.Package);
        var recovered = await validator.ValidateAsync(new(f.Output, AcceptRecoverable: true), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, recovered.Outcome); Assert.Equal("recoverable", recovered.Package!.Tier);
    }
    [Fact]
    public async Task DeepCheckFindsValidZipPayloadThatDoesNotMatchTheGitTree()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var entries = EngineFixture.Read(f.Output); entries[1] = new("x.md", "# Altered\n"u8.ToArray());
        EngineFixture.Rewrite(f.Output, entries);
        var validator = new PackageValidator();
        EngineFixture.Success(await validator.ValidateAsync(new(f.Output), TestContext.Current.CancellationToken));
        var result = await validator.ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == "MDPK2001");
    }
    [Fact]
    public void Zip64ProducerBoundariesRejectSentinelValues()
    {
        ZipContainer.CheckLimits(uint.MaxValue - 1L, ushort.MaxValue - 1L);
        Assert.Equal("MDPK1010", Assert.Throws<EngineException>(() => ZipContainer.CheckLimits(uint.MaxValue, 1)).Code);
        Assert.Equal("MDPK1010", Assert.Throws<EngineException>(() => ZipContainer.CheckLimits(0, ushort.MaxValue)).Code);
    }
    [Fact]
    public async Task BrokenIndexFailsNativeGitFsck()
    {
        using var f = new EngineFixture(); f.Write("x.md", "# X\n");
        EngineFixture.Success(await new PackageBuilder().PackAsync(f.Request, TestContext.Current.CancellationToken));
        var entries = EngineFixture.Read(f.Output); var index = entries.FindIndex(e => e.Name.EndsWith(".idx", StringComparison.Ordinal));
        entries[index].Bytes[8] ^= 0x80; EngineFixture.Rewrite(f.Output, entries);
        var result = await new PackageValidator().ValidateAsync(new(f.Output, Deep: true), TestContext.Current.CancellationToken);
        Assert.Equal(Outcome.Nonconforming, result.Outcome); Assert.Contains(result.Diagnostics, d => d.Code == "MDPK4002");
    }
}
