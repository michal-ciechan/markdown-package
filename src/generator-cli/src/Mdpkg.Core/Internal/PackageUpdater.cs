using Mdpkg.Core.Internal.Addressing;
using Mdpkg.Core.Internal.Container;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.IO;
using Mdpkg.Core.Internal.Sources;
using Mdpkg.Reader;
using Mdpkg.Reader.Internal.Addressing;
using System.Text.Json.Nodes;

namespace Mdpkg.Core.Internal;

internal sealed class PackageUpdater(EngineSettings settings)
{
    internal async Task<EngineResult> RunAsync(string inputPath, string destinationPath, string? sourceDirectory,
        SnapshotMetadata? metadata, Correspondence? correspondence, CreationOptions options, Guid? expectedNamespace, CancellationToken ct)
    {
        var resources = options.Resources; var findings = new List<Finding>(); string? staged = null;
        try
        {
            ct.ThrowIfCancellationRequested();
            var destination = Path.GetFullPath(destinationPath);
            for (var dir = new DirectoryInfo(Path.GetDirectoryName(destination)!); dir is not null; dir = dir.Parent)
                if (dir.Exists) SourceTree.RejectLink(dir.FullName);
            if (sourceDirectory is not null && destination.StartsWith(Path.GetFullPath(sourceDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                throw new EngineException(Outcome.InvalidSource, "MDPK1003", "Output must be outside the source directory.");
            using var temp = new TemporaryDirectory(settings.TemporaryDirectory ?? resources.ReadLimits.TemporaryDirectory);
            var captured = Path.Combine(temp.Path, "input.mdpkg");
            await using (var input = File.OpenRead(inputPath))
            await using (var output = File.Create(captured))
                await ResourceOptions.CopyAsync(input, output, Math.Min(resources.MaxSpoolBytes, resources.ReadLimits.MaxInputBytes), ct);
            var validator = new Validation.PackageValidator(settings);
            var verified = await validator.ValidateAsync(new(captured, Deep: true, Namespace: expectedNamespace?.ToString("D"), Resources: resources), ct);
            if (verified.Outcome != Outcome.Success) return verified with { Package = null };
            if (options.RequireComplete && verified.Manifest!.Addressing.Coverage != "complete" && sourceDirectory is null)
                return Failure(Outcome.Incomplete, "MDPK3001", "Complete correspondence is required.");
            var manifest = verified.Manifest!; var history = verified.History;
            List<EntryData> entries;
            using (var file = File.OpenRead(captured)) entries = ResourceGuard.Read(file, resources, ct).Members.Select(e => new EntryData(e.Name, e.Bytes)).ToList();
            var materialized = history is null; var minted = 0;
            string? bootstrap = history?.Origin?["commit"]?.GetValue<string>();
            List<EntryData> items;
            if (!materialized && sourceDirectory is null)
            {
                // Re-emit every validated control/current/Git entry, including supported
                // history evidence outside the narrower append capability.
                items = entries;
                if (options.ReverseIndex && !items.Any(e => e.Name.EndsWith(".rev", StringComparison.Ordinal)))
                {
                    var work = Path.Combine(temp.Path, "reemit"); Directory.CreateDirectory(work);
                    // index-pack cannot replace an existing index on Windows. The
                    // validated input index stays in the output; stage only the pack
                    // and repository controls while creating its optional reverse map.
                    foreach (var entry in entries.Where(e => e.Name.StartsWith(".git/", StringComparison.Ordinal) && !e.Name.EndsWith(".idx", StringComparison.Ordinal)))
                    {
                        var path = Path.Combine(work, entry.Name); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                        await File.WriteAllBytesAsync(path, entry.Bytes, ct);
                    }
                    var pack = items.Single(e => e.Name.EndsWith(".pack", StringComparison.Ordinal));
                    await new GitProcess(settings.GitExecutable, resources.MaxSpoolBytes).TextAsync(work, ct, "index-pack", "--strict", "--rev-index", Path.Combine(work, pack.Name));
                    var reverse = pack.Name[..^5] + ".rev";
                    items.Insert(items.IndexOf(pack), new(reverse, await File.ReadAllBytesAsync(Path.Combine(work, reverse), ct)));
                }
            }
            else
            {
                if (sourceDirectory is not null && history is not null &&
                    (manifest.History is not GitHistory { Coverage: "complete", Transform.Count: 0 } || history.Root is not ("original" or "materialized") ||
                     history.ShallowBoundaries.Length != 0 || history.Transformations.Length != 0 || history.Ranges.Length != 0 || history.Patches.Length != 0 ||
                     history.Bindings is not null || history.Scope is not null || history.SourceTip != manifest.Current.Id ||
                     history.SourceBase != "sha1-" + (verified.HistoryContext?.GetOldestCommit() ?? "")))
                    return Failure(Outcome.Incomplete, "MDPK2003", "This Git lineage is outside the supported append capability.");
                if (sourceDirectory is not null && manifest.Review is not null)
                    return Failure(Outcome.Incomplete, "MDPK2007", "Updating review content requires the review-authoring capability.");
                var controls = FormatValidation.ValidateInventory(manifest, history, entries.Select(e => (e.Name, e.Bytes.LongLength)));
                var current = entries.Where(e => !e.Name.EndsWith('/') && !e.Name.StartsWith(".git/", StringComparison.Ordinal) && !controls.Contains(e.Name)).ToList();
                var repoPath = Path.Combine(temp.Path, "repository.git"); Directory.CreateDirectory(repoPath);
                var repo = new Repository(new GitProcess(settings.GitExecutable, resources.MaxSpoolBytes), repoPath, resources);
                await repo.InitializeAsync(ct);
                string head;
                if (materialized)
                {
                    var tree = await repo.TreeAsync(current, ct);
                    head = await repo.ObjectAsync("commit", BootstrapSerializer.Serialize(tree, manifest.Namespace, manifest.Current.Id), ct);
                    bootstrap = "sha1-" + head;
                    var origin = new JsonObject { ["profile"] = "mdpkg-bootstrap-v1", ["snapshot"] = manifest.Current.Id,
                        ["commit"] = bootstrap, ["header"] = SnapshotHash.Header(manifest) };
                    history = new("first-parent", "materialized", bootstrap, bootstrap, 1, [], [], [], [], [new(bootstrap, bootstrap, "complete")], Origin: origin);
                    manifest = manifest with { Current = new("commit", bootstrap), History = new GitHistory("complete", [], Profile.History) };
                }
                else
                {
                    head = manifest.Current.Id[5..];
                    foreach (var entry in entries.Where(e => e.Name.StartsWith(".git/objects/pack/", StringComparison.Ordinal)))
                    {
                        var path = Path.Combine(repoPath, entry.Name[5..]);
                        await File.WriteAllBytesAsync(path, entry.Bytes, ct);
                    }
                }
                if (sourceDirectory is not null)
                {
                    var ledgerBytes = current.FirstOrDefault(e => e.Name == Profile.Ledger)?.Bytes;
                    var ledger = ledgerBytes is null ? LedgerEngine.Empty() : LedgerEngine.Read(ledgerBytes, Outcome.Nonconforming, resources.ReadLimits.MaxJsonDepth);
                    var previous = LedgerEngine.LiveRoots(ledger, Inventory.Snapshot(current, manifest.Namespace, ct), manifest.Namespace);
                    var next = await SourceTree.ReadAsync(sourceDirectory, findings, ct, resources);
                    if (next.Any(e => e.Name.StartsWith(".mdpkg/review/", StringComparison.Ordinal)))
                        throw new EngineException(Outcome.InvalidSource, "MDPK1002", "Ordinary update cannot author review files.");
                    if (next.FirstOrDefault(e => e.Name == Profile.Ledger) is { } supplied &&
                        (ledgerBytes is null || !supplied.Bytes.AsSpan().SequenceEqual(ledgerBytes) || findings.Any(f => f.Entry == Profile.Ledger && f.Code == "MDPK1004")))
                        throw new EngineException(Outcome.InvalidSource, "MDPK2002", "Source ledger conflicts with the base ledger; use correspondence.");
                    var explicitRoots = new HashSet<string>(StringComparer.Ordinal);
                    if (correspondence is not null)
                    {
                        var bytes = CorrespondenceCodec.Encode(correspondence);
                        foreach (var record in JsonNode.Parse(bytes)!.AsArray()) explicitRoots.Add(record!["root"]!.GetValue<string>());
                        LedgerEngine.ApplyCorrespondence(ledger, bytes);
                    }
                    var inventory = Inventory.Snapshot(next, manifest.Namespace, ct);
                    foreach (var root in previous)
                    {
                        if (!ledger.Entries.TryGetValue(root, out var record))
                        { if (!inventory.ContainsKey(root)) ledger.Entries[root] = new(Unknown: "unconfirmed-removal"); }
                        else if (record.To is not null && !inventory.ContainsKey(Inventory.Root(manifest.Namespace, record.To)) && !explicitRoots.Contains(root))
                            ledger.Entries[root] = new(Unknown: "unconfirmed-removal");
                    }
                    LedgerEngine.ValidateTargets(ledger, inventory, manifest.Namespace, Outcome.InvalidSource);
                    minted = LedgerEngine.MintReservedSlots(ledger, inventory, manifest.Namespace, findings);
                    var complete = LedgerEngine.CompleteTransition(previous, LedgerEngine.LiveRoots(ledger, inventory, manifest.Namespace), ledger);
                    LedgerEngine.Store(next, ledger);
                    var coverage = complete && manifest.Addressing.Coverage == "complete" ? "complete" : "partial";
                    if (coverage == "partial")
                    {
                        findings.Add(Findings.Create("MDPK3001", "Unresolved correspondence remains partial.", severity: options.RequireComplete ? "error" : "warn"));
                        if (options.RequireComplete) return Failure(Outcome.Incomplete, "MDPK3001", "Complete correspondence is required.");
                    }
                    if (options.Warnings == WarningPolicy.Fail && findings.Any(f => f.Severity == "warn")) return Failure(Outcome.Nonconforming, "MDPK3001", "Warnings prevent publication.");
                    var child = await repo.CommitAsync(await repo.TreeAsync(next, ct), head, metadata!.Message, ct, metadata);
                    var childId = "sha1-" + child;
                    history = history! with { SourceTip = childId, RetainedCommits = history.RetainedCommits + 1,
                        AddressingCoverage = coverage == "complete" ? [new(history.SourceBase, childId, "complete")]
                            : [.. history.AddressingCoverage, new("sha1-" + head, childId, complete ? "complete" : "partial")] };
                    manifest = manifest with { Current = new("commit", childId), Addressing = manifest.Addressing with { Coverage = coverage, Overrides = ledger.Entries.Count == 0 ? null : Profile.Ledger } };
                    current = next; head = child;
                }
                items = [new(Profile.Manifest, CanonicalJson.Bytes(manifest, true)), .. current.OrderBy(e => e.Name, Utf8Comparer.Instance), new(Profile.History, CanonicalJson.Bytes(history!))];
                items.AddRange(await repo.CurateAsync(head, options.ReverseIndex, ct));
            }
            staged = Path.Combine(Path.GetDirectoryName(destination)!, "." + Path.GetFileName(destination) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            await using (var output = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                ResourceGuard.Entries(items, resources);
                ZipContainer.Write(output, items, options.CompressionLevel, options.DataDescriptors, ct,
                    Math.Min(resources.MaxSpoolBytes, resources.ReadLimits.MaxInputBytes), resources.ReadLimits.MaxDirectoryBytes);
                await output.FlushAsync(ct); output.Flush(true);
            }
            var result = await validator.ValidateAsync(new(staged, Deep: true, Resources: resources), ct);
            if (result.Outcome != Outcome.Success) return result with { Package = null };
            ct.ThrowIfCancellationRequested(); File.Move(staged, destination, true); staged = null;
            return result with { Package = result.Package! with { Path = destination }, Materialized = materialized, BootstrapCommit = bootstrap,
                MintedRoots = minted, Diagnostics = [.. findings, .. result.Diagnostics] };
        }
        catch (ResourceLimitException ex) { return ApiSupport.Failure(ex); }
        catch (EngineException ex) { return Failure(ex.Outcome, ex.Code, ex.Message); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return ApiSupport.Failure(ex); }
        finally { if (staged is not null) File.Delete(staged); }
    }
    private static EngineResult Failure(Outcome outcome, string code, string message) => new(outcome, null, null, null, 0, 0, [], [Findings.Create(code, message, severity: "error")]);
}
