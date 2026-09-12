using System.Text.Json.Nodes;
using Mdpkg.Core;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Reader;
using Updater = Mdpkg.Core.PackageUpdater;
using Validator = Mdpkg.Core.PackageValidator;

namespace Mdpkg.EngineTests;

public class MaterializationTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Fixture(string name) => EngineFixture.RepoFile("docs/spec/review-fixtures/" + name + ".mdpkg");
    private static JsonNode Data => JsonNode.Parse(File.ReadAllText(EngineFixture.RepoFile("docs/investigations/deferred-history/breaking-revision-vectors.json")))!;
    private static JsonNode Vector(string name) => Data["vectors"]!.AsArray().Single(v => v!["name"]!.GetValue<string>() == name)!;
    private static void Success(Core.PackageResult result) => Assert.True(result.Status == OperationStatus.Success, string.Join("; ", result.Diagnostics.Select(d => d.Message)));

    [Theory]
    [InlineData("guide")][InlineData("unicode")][InlineData("ledger")][InlineData("delta-review")]
    public async Task ExactBootstrapMatchesS1AndReconstructsEveryOriginalFile(string name)
    {
        using var f = new EngineFixture(); var vector = Vector(name); var input = Fixture(name + "-snapshot");
        var originalBytes = File.ReadAllBytes(input);
        var result = await new Updater().MaterializeAsync(new(input), f.Output, Ct); Success(result);
        Assert.True(result.Materialized); Assert.Equal(vector["bootstrapCommitId"]!.GetValue<string>(), result.Identity!.Current.Id);
        Assert.Equal(result.Identity.Current.Id, result.BootstrapCommit);
        var entries = EngineFixture.Read(f.Output);
        Assert.Equal(vector["materializedManifestCanonical"]!.GetValue<string>(), Profile.Utf8.GetString(entries[0].Bytes));
        Assert.Equal(vector["materializedHistoryCanonical"]!.GetValue<string>(), Profile.Utf8.GetString(entries.Single(e => e.Name == Profile.History).Bytes));
        Assert.Equal(vector["bootstrapCommitBytes"]!.GetValue<string>(), Profile.Utf8.GetString(BootstrapSerializer.Serialize(vector["treeId"]!.GetValue<string>()[5..], vector["namespace"]!.GetValue<string>(), vector["snapshotId"]!.GetValue<string>())));
        var proof = result.HistoryContext!;
        Assert.Equal(vector["snapshotId"]!.GetValue<string>(), proof.OriginalSnapshot!.Identity.Current.Id);
        Assert.False(proof.OriginalSnapshot.HasOriginalArchiveBytes);
        foreach (var file in vector["sources"]!.AsObject()) Assert.Equal(file.Value!.GetValue<string>(), Profile.Utf8.GetString(proof.ReadOriginalEntry(file.Key)));
        var reemitted = Path.Combine(f.Root, "again.mdpkg");
        var again = await new Updater().MaterializeAsync(new(f.Output), reemitted, Ct); Success(again);
        Assert.False(again.Materialized); Assert.Equal(result.Identity, again.Identity);
        Assert.Equal(originalBytes, File.ReadAllBytes(input));
    }

    [Fact]
    public async Task ChangedChildMatchesS1AndProofCannotBeReusedOnReemittedBytes()
    {
        using var f = new EngineFixture(); var transition = Data["transitions"]![0]!;
        f.Write("guide.md", transition["sources"]!["guide.md"]!.GetValue<string>());
        var identity = new CommitIdentity("Example Author", "author@example.invalid", DateTimeOffset.FromUnixTimeSeconds(1700000400));
        var result = await new Updater().UpdateAsync(new(Fixture("guide-snapshot"), f.Source, new(identity, identity, "Publish changed guide")), f.Output, Ct); Success(result);
        Assert.Equal(transition["manifest"]!["current"]!["id"]!.GetValue<string>(), result.Identity!.Current.Id);
        var proof = result.HistoryContext!; Assert.Equal("# Guide\n", Profile.Utf8.GetString(proof.ReadOriginalEntry("guide.md")));
        using var input = File.OpenRead(f.Output); var current = await PackageSnapshot.ReadAsync(input, cancellationToken: Ct);
        var original = proof.OriginalSnapshot!; var scope = original.GetScopes("guide.md", Ct).First();
        Assert.Equal(IdentityStatus.Unconfirmed, current.Resolve(original.Identity, scope.Root, scope.Digest, scope.Locator, Ct).Status);
        Assert.Equal(IdentityStatus.FlaggedChanged, current.Resolve(original.Identity, scope.Root, scope.Digest, scope.Locator, Ct, proof).Status);
        using var archiveInput = File.OpenRead(f.Output); using var archive = await PackageArchive.OpenAsync(archiveInput, cancellationToken: Ct);
        Assert.True((await new GitHistoryBackend().VerifyAsync(archive, Ct)).Matches(current));
        var reemitted = Path.Combine(f.Root, "reencoded.mdpkg");
        Success(await new Updater().MaterializeAsync(new(f.Output) { Options = new() { CompressionLevel = 0 } }, reemitted, Ct));
        using var differentInput = File.OpenRead(reemitted); var different = await PackageSnapshot.ReadAsync(differentInput, cancellationToken: Ct);
        Assert.Equal(current.Identity, different.Identity); Assert.False(proof.Matches(different));
        Assert.Equal("verification-context-mismatch", different.Resolve(original.Identity, scope.Root, scope.Digest, scope.Locator, Ct, proof).Reason);
    }

    public static IEnumerable<object[]> BadOrigins => Data["invalidCases"]!.AsArray().Where(c => c!["target"]!.GetValue<string>() == "origin")
        .Select(c => new object[] { c!["name"]!.GetValue<string>(), c["value"]!.ToJsonString() });
    [Theory]
    [MemberData(nameof(BadOrigins))]
    public async Task S1OriginMutationsCannotProduceProof(string name, string json)
    {
        using var f = new EngineFixture(); var entries = EngineFixture.Read(Fixture("guide-materialized"));
        var at = entries.FindIndex(e => e.Name == Profile.History); var history = JsonNode.Parse(entries[at].Bytes)!;
        history["origin"] = JsonNode.Parse(json); entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(history) };
        EngineFixture.Rewrite(f.Output, entries);
        var result = await new Validator().ValidateFileAsync(f.Output, new() { Deep = true }, Ct);
        Assert.True(result.Status == OperationStatus.Nonconforming, name + ": " + result.Status); Assert.Null(result.HistoryContext);
    }

    [Theory]
    [InlineData("metadata")][InlineData("tree")][InlineData("parent")][InlineData("namespace")][InlineData("mode")]
    public async Task RepairedObjectIdsCannotHideAlteredBootstrap(string mutation)
    {
        using var f = new EngineFixture(); var vector = Vector("guide");
        var repo = new Repository(new GitProcess("git"), f.Source); await repo.InitializeAsync(Ct);
        var files = new List<EntryData> { new("guide.md", Profile.Utf8.GetBytes(mutation == "tree" ? "# Altered\n" : "# Guide\n"), mutation == "mode" ? "100755" : "100644") };
        var tree = await repo.TreeAsync(files, Ct);
        var payload = vector["bootstrapCommitBytes"]!.GetValue<string>().Replace(vector["treeId"]!.GetValue<string>()[5..], tree, StringComparison.Ordinal);
        if (mutation == "metadata") payload = payload.Replace("946684800", "946684801", StringComparison.Ordinal);
        if (mutation == "namespace") payload = payload.Replace(EngineFixture.Namespace, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", StringComparison.Ordinal);
        if (mutation == "parent")
        {
            var parent = await repo.CommitAsync(tree, null, "prior", Ct);
            payload = payload.Insert(payload.IndexOf('\n') + 1, "parent " + parent + "\n");
        }
        var commit = "sha1-" + await repo.ObjectAsync("commit", Profile.Utf8.GetBytes(payload), Ct);
        var manifest = JsonNode.Parse(vector["materializedManifestCanonical"]!.GetValue<string>())!; manifest["current"]!["id"] = commit;
        var history = JsonNode.Parse(vector["materializedHistoryCanonical"]!.GetValue<string>())!;
        history["sourceBase"] = commit; history["sourceTip"] = commit; history["origin"]!["commit"] = commit;
        history["addressingCoverage"]![0]!["from"] = commit; history["addressingCoverage"]![0]!["to"] = commit;
        List<EntryData> entries = [new(Profile.Manifest, CanonicalJson.Bytes(manifest, true)), .. files, new(Profile.History, CanonicalJson.Bytes(history))];
        entries.AddRange(await repo.CurateAsync(commit[5..], false, Ct)); EngineFixture.Rewrite(f.Output, entries);
        var result = await new Validator().ValidateFileAsync(f.Output, new() { Deep = true }, Ct);
        Assert.Equal(OperationStatus.Nonconforming, result.Status); Assert.Null(result.HistoryContext);
    }

    [Theory]
    [InlineData("missing")][InlineData("tampered")][InlineData("ledger")][InlineData("cancel")][InlineData("limit")][InlineData("reserved-message")]
    public async Task FailedMaterializationOrAppendPreservesDestination(string failure)
    {
        using var f = new EngineFixture(); File.WriteAllText(f.Output, "prior"); f.Write("guide.md", "# Guide\n");
        var input = Path.Combine(f.Root, "base.mdpkg"); File.Copy(Fixture("guide-snapshot"), input);
        if (failure == "missing") input = Path.Combine(f.Root, "missing.mdpkg");
        if (failure == "tampered")
        {
            var entries = EngineFixture.Read(input); entries[1] = entries[1] with { Bytes = "different\n"u8.ToArray() }; EngineFixture.Rewrite(input, entries);
        }
        if (failure == "ledger") f.Write(Profile.Ledger, "{}\n");
        var options = failure == "limit" ? new CreationOptions { Resources = new() { MaxSpoolBytes = 1 } } : new CreationOptions();
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct); if (failure == "cancel") cancel.Cancel();
        var request = new UpdatePackageRequest(input, f.Source, SnapshotMetadata.CliDefault with { Message = failure == "reserved-message" ? "mdpkg-bootstrap-v1" : "append" }) { Options = options };
        if (failure == "cancel") await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new Updater().UpdateAsync(request, f.Output, cancel.Token));
        else Assert.NotEqual(OperationStatus.Success, (await new Updater().UpdateAsync(request, f.Output, Ct)).Status);
        Assert.Equal("prior", File.ReadAllText(f.Output)); Assert.Empty(Directory.GetFiles(f.Root, "*.tmp"));
    }

    [Fact]
    public async Task AppendCarriesExceptionalRootsAndPreservesPartialIntervals()
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n");
        var exceptional = new EntityRoot(new string('a', 64));
        var initialPath = Path.Combine(f.Root, "initial.mdpkg");
        Success(await new Core.PackageBuilder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace))
        { Correspondence = new([new ConfirmedMove(exceptional, new("section", "guide.md", [new("# Guide", 0)]))]) }, initialPath, Ct));
        using var initialInput = File.OpenRead(initialPath); var original = await PackageSnapshot.ReadAsync(initialInput, cancellationToken: Ct);
        var moves = original.GetScopes("guide.md", Ct).Select(s => new ConfirmedMove(
            s.Locator.HeadingTrail.Count > 0 ? exceptional : new EntityRoot(s.Root), s.Locator with { DocumentPath = "moved.md" }));
        File.Move(Path.Combine(f.Source, "guide.md"), Path.Combine(f.Source, "moved.md"));
        var moved = await new Updater().UpdateAsync(new(initialPath, f.Source, SnapshotMetadata.CliDefault) { Correspondence = new(moves) }, f.Output, Ct);
        Success(moved); Assert.Equal("complete", moved.Manifest!.Addressing.Coverage); Assert.Equal(0, moved.MintedRoots);
        var originalLedger = EngineFixture.Read(initialPath).Single(e => e.Name == Profile.Ledger).Bytes;
        Assert.Equal(originalLedger, moved.HistoryContext!.ReadOriginalEntry(Profile.Ledger));
        var ledger = JsonNode.Parse(EngineFixture.Read(f.Output).Single(e => e.Name == Profile.Ledger).Bytes)!;
        Assert.Equal("moved.md", ledger["entries"]![exceptional.Value]!["to"]![1]!.GetValue<string>());
        f.Write("moved.md", "# New heading\n");
        var partialPath = Path.Combine(f.Root, "partial.mdpkg");
        var partial = await new Updater().UpdateAsync(new(f.Output, f.Source, SnapshotMetadata.CliDefault), partialPath, Ct); Success(partial);
        Assert.False(partial.Materialized); Assert.Equal("partial", partial.Manifest!.Addressing.Coverage);
        Assert.Equal(3, partial.History!.RetainedCommits); Assert.Equal(2, partial.History.AddressingCoverage.Count);
        Assert.Equal("complete", partial.History.AddressingCoverage[0].Coverage); Assert.Equal("partial", partial.History.AddressingCoverage[1].Coverage);
        Assert.Equal(CheckpointStatus.IncompleteCorrespondence, partial.HistoryContext!.GetRelationship(original.Identity.Current).Status);
        var next = Path.Combine(f.Root, "after-partial.mdpkg");
        var continued = await new Updater().UpdateAsync(new(partialPath, f.Source, SnapshotMetadata.CliDefault), next, Ct); Success(continued);
        Assert.Equal("partial", continued.Manifest!.Addressing.Coverage); Assert.Equal(4, continued.History!.RetainedCommits);
        Assert.Equal(partial.History.AddressingCoverage.Take(2), continued.History.AddressingCoverage.Take(2));
        Assert.Equal(moved.History!.Origin!.Value.GetRawText(), continued.History.Origin!.Value.GetRawText());
    }

    [Fact]
    public async Task UnsupportedAppendStillAllowsIdentityPreservingGitReemission()
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n");
        Success(await new Core.PackageBuilder().CreateFromDirectoryAsync(new(f.Source, Guid.Parse(EngineFixture.Namespace))
        { History = HistoryMode.Git, Depth = 1 }, f.Output, Ct));
        var target = Path.Combine(f.Root, "next.mdpkg"); File.WriteAllText(target, "prior");
        var rejected = await new Updater().UpdateAsync(new(f.Output, f.Source, SnapshotMetadata.CliDefault), target, Ct);
        Assert.Equal(OperationStatus.ObligationUnmet, rejected.Status); Assert.Contains(rejected.Diagnostics, d => d.Message.Contains("append capability", StringComparison.Ordinal));
        Assert.Equal("prior", File.ReadAllText(target));
        var accepted = await new Updater().MaterializeAsync(new(f.Output), target, Ct); Success(accepted); Assert.False(accepted.Materialized);
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task StreamOperationsLeaveInputsOpenAndMatchFileOperations(bool append)
    {
        using var f = new EngineFixture(); f.Write("guide.md", "# Guide\n\nSuccessor\n");
        using var input = File.OpenRead(Fixture("guide-snapshot")); using var output = new MemoryStream();
        var updater = new Updater();
        var result = append ? await updater.UpdateAsync(input, output, f.Source, SnapshotMetadata.CliDefault, cancellationToken: Ct)
            : await updater.MaterializeAsync(input, output, cancellationToken: Ct); Success(result);
        Assert.Null(result.Package!.Path); Assert.True(input.CanRead); Assert.True(output.CanWrite);
        var file = append ? await updater.UpdateAsync(new(Fixture("guide-snapshot"), f.Source, SnapshotMetadata.CliDefault), f.Output, Ct)
            : await updater.MaterializeAsync(new(Fixture("guide-snapshot")), f.Output, Ct); Success(file);
        Assert.Equal(File.ReadAllBytes(f.Output), output.ToArray());
    }

    [Theory]
    [InlineData("spool")][InlineData("document")][InlineData("cancel")]
    public async Task ExplicitBackendHonorsResourceAndCancellationLimits(string failure)
    {
        using var input = File.OpenRead(Fixture("guide-changed-child")); using var archive = await PackageArchive.OpenAsync(input, cancellationToken: Ct);
        var policy = failure == "spool" ? new ResourceOptions { MaxSpoolBytes = 1 } :
            failure == "document" ? new ResourceOptions { ReadLimits = new() { MaxDocumentBytes = 1 } } : new();
        using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct); if (failure == "cancel") cancel.Cancel();
        var backend = new GitHistoryBackend(resources: policy);
        if (failure == "cancel") await Assert.ThrowsAnyAsync<OperationCanceledException>(() => backend.VerifyAsync(archive, cancel.Token));
        else await Assert.ThrowsAsync<ResourceLimitException>(() => backend.VerifyAsync(archive, Ct));
    }

    [Theory]
    [InlineData(false)][InlineData(true)]
    public async Task FailedFinalStreamCopyNeverReturnsSuccess(bool cancelCopy)
    {
        using var f = new EngineFixture(); var scratch = Path.Combine(f.Root, "scratch"); Directory.CreateDirectory(scratch);
        using var input = File.OpenRead(Fixture("guide-snapshot")); using var cancel = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        using var output = new InterruptedOutput(cancelCopy ? cancel : null);
        var task = new Updater(new(TemporaryDirectory: scratch)).MaterializeAsync(input, output, cancellationToken: cancel.Token);
        if (cancelCopy) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        else Assert.Equal(OperationStatus.EnvironmentFailure, (await task).Status);
        Assert.True(output.Length > 0); Assert.True(output.CanWrite); Assert.True(input.CanRead); Assert.Empty(Directory.GetFileSystemEntries(scratch));
    }
    private sealed class InterruptedOutput(CancellationTokenSource? cancel) : MemoryStream
    {
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Write(buffer.Span[..Math.Min(10, buffer.Length)]);
            if (cancel is not null) { cancel.Cancel(); cancellationToken.ThrowIfCancellationRequested(); }
            throw new IOException("Injected final-copy failure.");
        }
    }

    [Fact]
    public async Task MissingRootBlobCannotProduceOriginProof()
    {
        using var f = new EngineFixture(); var git = new GitProcess("git"); var repo = new Repository(git, f.Source); await repo.InitializeAsync(Ct);
        var vector = Vector("guide"); var tree = await repo.TreeAsync([new("guide.md", "# Guide\n"u8.ToArray())], Ct);
        var commit = await repo.ObjectAsync("commit", Profile.Utf8.GetBytes(vector["bootstrapCommitBytes"]!.GetValue<string>()), Ct);
        // Explicit object enumeration deliberately omits the referenced blob. Index
        // the pack without --strict so full validation must discover the missing object.
        var bytes = await git.RunAsync(f.Source, ["pack-objects", "--stdout"], Profile.Utf8.GetBytes(commit + "\n" + tree + "\n"), Ct);
        var stem = "pack-" + Convert.ToHexStringLower(bytes.AsSpan(bytes.Length - 20));
        var path = Path.Combine(f.Source, "objects", "pack", stem + ".pack"); File.WriteAllBytes(path, bytes);
        await git.TextAsync(f.Source, Ct, "index-pack", path);
        var entries = EngineFixture.Read(Fixture("guide-materialized")); entries.RemoveAll(e => e.Name.StartsWith(".git/objects/pack/", StringComparison.Ordinal));
        entries.Add(new(".git/objects/pack/" + stem + ".idx", File.ReadAllBytes(Path.ChangeExtension(path, ".idx"))));
        entries.Add(new(".git/objects/pack/" + stem + ".pack", bytes)); EngineFixture.Rewrite(f.Output, entries);
        var result = await new Validator().ValidateFileAsync(f.Output, new() { Deep = true }, Ct);
        Assert.Equal(OperationStatus.Nonconforming, result.Status); Assert.Null(result.HistoryContext);
        Assert.Contains(result.Diagnostics, d => d.Code == "MDPK4002");
    }

    [Fact]
    public async Task GitReemissionCanAddRequestedReverseIndex()
    {
        using var f = new EngineFixture();
        var result = await new Updater().MaterializeAsync(new(Fixture("guide-materialized")) { Options = new() { ReverseIndex = true } }, f.Output, Ct);
        Success(result); Assert.False(result.Materialized);
        Assert.Single(EngineFixture.Read(f.Output), e => e.Name.EndsWith(".rev", StringComparison.Ordinal));
    }

    [Fact]
    public async Task OverlappingPartialCoverageCannotGrantCheckpointProof()
    {
        using var f = new EngineFixture(); var entries = EngineFixture.Read(Fixture("guide-changed-child"));
        var at = entries.FindIndex(e => e.Name == Profile.History); var history = JsonNode.Parse(entries[at].Bytes)!;
        var partial = history["addressingCoverage"]![0]!.DeepClone(); partial["coverage"] = "partial";
        history["addressingCoverage"]!.AsArray().Add(partial); entries[at] = entries[at] with { Bytes = CanonicalJson.Bytes(history) };
        var manifest = JsonNode.Parse(entries[0].Bytes)!; manifest["addressing"]!["coverage"] = "partial";
        entries[0] = entries[0] with { Bytes = CanonicalJson.Bytes(manifest, true) }; EngineFixture.Rewrite(f.Output, entries);
        var result = await new Validator().ValidateFileAsync(f.Output, new() { Deep = true }, Ct); Success(result);
        Assert.Equal(CheckpointStatus.IncompleteCorrespondence, result.HistoryContext!.GetRelationship(result.HistoryContext.OriginalSnapshot!.Identity.Current).Status);
    }

    [Theory]
    [InlineData("bundled-v2", true)][InlineData("bundled-target-commit", true)]
    [InlineData("invalid-bundled-origin", false)][InlineData("invalid-bundled-parent", false)]
    [InlineData("invalid-bundled-document", false)][InlineData("invalid-bundled-ledger", false)]
    public async Task BundledFixtureParentRequiresVerifiedOriginalContext(string fixture, bool valid)
    {
        var result = await new Validator().ValidateFileAsync(Fixture(fixture), new() { Deep = true }, Ct);
        Assert.Equal(valid ? OperationStatus.Success : OperationStatus.Nonconforming, result.Status);
        Assert.Equal(valid, result.HistoryContext is not null);
    }
}
