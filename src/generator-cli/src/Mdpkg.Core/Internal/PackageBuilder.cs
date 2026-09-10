using System.Text;
using Mdpkg.Core.Internal.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Core.Internal.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.IO;
using Mdpkg.Core.Internal.Sources;
using Mdpkg.Reader.Internal.Sources;
using Mdpkg.Core.Internal.Validation;

namespace Mdpkg.Core.Internal;

internal sealed class PackageBuilder(EngineSettings? settings = null)
{
    private readonly EngineSettings settings = settings ?? new();
    public async Task<EngineResult> PackAsync(PackRequest request, CancellationToken ct = default)
    {
        var findings = new List<Finding>();
        var resources = request.Resources ?? ResourceOptions.ProducerCompatibility;
        string? stagedOutput = null;
        try
        {
            ct.ThrowIfCancellationRequested();
            if (request.ObjectFormat != "sha1") throw new EngineException(Outcome.InvalidSource, "MDPK4001", "SHA-256 Git object format is not implemented.");
            if (request.Anchor != Profile.Anchor || request.Digest != Profile.Digest || !Guid.TryParseExact(request.Namespace, "D", out _) ||
                request.Namespace != request.Namespace.ToLowerInvariant() || request.Depth is < 1 || request.CompressionLevel is < 0 or > 9)
                throw new EngineException(Outcome.Usage, "MDPK2007", "Invalid namespace, profile or creation options.");
            var sourcePath = Path.GetFullPath(request.Source);
            var destination = Path.GetFullPath(request.Destination);
            for (var dir = new DirectoryInfo(Path.GetDirectoryName(destination)!); dir != null; dir = dir.Parent)
                if (dir.Exists) SourceTree.RejectLink(dir.FullName);
            var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (destination.StartsWith(sourcePath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison))
                throw new EngineException(Outcome.InvalidSource, "MDPK1003", "Output must be outside the source directory to avoid packaging prior output.", destination);
            var correspondence = request.CorrespondenceBytes ?? (request.Correspondence is null ? null : await File.ReadAllBytesAsync(request.Correspondence, ct));
            using var temp = new TemporaryDirectory(settings.TemporaryDirectory);
            var git = new GitProcess(settings.GitExecutable, resources.MaxSpoolBytes);
            var work = Path.Combine(temp.Path, "repository.git"); Directory.CreateDirectory(work);
            var repo = new Repository(git, work, resources);
            await repo.InitializeAsync(ct);
            string[] sourceCommits = [];
            Repository? sourceRepo = null;
            var truncated = request.Depth is not null;
            if (request.FromGit)
            {
                for (var dir = new DirectoryInfo(sourcePath); dir != null; dir = dir.Parent) SourceTree.RejectLink(dir.FullName);
                if (await git.TextAsync(sourcePath, ct, "rev-parse", "--is-bare-repository") != "true")
                {
                    var top = Path.GetFullPath(await git.TextAsync(sourcePath, ct, "rev-parse", "--show-toplevel"));
                    if (!string.Equals(top.TrimEnd(Path.DirectorySeparatorChar), sourcePath.TrimEnd(Path.DirectorySeparatorChar), comparison))
                        throw new EngineException(Outcome.InvalidSource, "MDPK1003", "--from-git requires the repository root; select a subtree with --scope.", sourcePath);
                }
                var format = await git.TextAsync(sourcePath, ct, "rev-parse", "--show-object-format");
                if (format != "sha1") throw new EngineException(Outcome.InvalidSource, "MDPK4001", "Source repository is not SHA-1.");
                if (await git.TextAsync(sourcePath, ct, "rev-parse", "--is-shallow-repository") == "true") truncated = true;
                sourceCommits = (await git.TextAsync(sourcePath, ct, "rev-list", "--first-parent", "--reverse", "HEAD")).Split('\n', StringSplitOptions.RemoveEmptyEntries);
                if (sourceCommits.Length == 0) throw new IOException("Source repository has no commits.");
                if (request.Depth is { } depth) sourceCommits = sourceCommits.TakeLast(depth).ToArray();
                sourceRepo = new(git, sourcePath, resources);
            }
            var snapshots = request.FromGit ? sourceCommits.Length : 1;
            var retained = new List<string>(); var ranges = new List<CoverageRange>();
            var ledger = LedgerEngine.Empty(); var previousRoots = new HashSet<string>(StringComparer.Ordinal);
            List<EntryData> currentEntries = [];
            string? head = null; var minted = 0; long sourceBytes = 0;
            for (var i = 0; i < snapshots; i++)
            {
                ct.ThrowIfCancellationRequested();
                List<EntryData> entries;
                if (sourceRepo is not null) entries = await sourceRepo.ReadTreeAsync(sourceCommits[i], request.Scope, findings, normalize: true, ct);
                else
                {
                    entries = request.InputEntries is null ? await SourceTree.ReadAsync(sourcePath, findings, ct, resources)
                        : SourceTree.FromMemory(request.InputEntries, findings, ct, resources);
                    if (request.Scope is not null)
                    {
                        var unprojected = await repo.TreeAsync(entries, ct);
                        entries = await repo.ReadTreeAsync(unprojected, request.Scope, findings, normalize: true, ct);
                    }
                }
                foreach (var entry in entries) ResourceGuard.Source(entry.Name, entry.Bytes.LongLength, ref sourceBytes, resources);
                if (entries.Any(e => e.Name.StartsWith(".mdpkg/review/", StringComparison.Ordinal)))
                    throw new EngineException(Outcome.InvalidSource, "MDPK1002", "Review-package authoring is not supported by pack; review paths require a review manifest.");
                var suppliedRoots = new HashSet<string>(StringComparer.Ordinal);
                if (entries.FirstOrDefault(e => e.Name == Profile.Ledger) is { } inputLedger)
                {
                    var incoming = LedgerEngine.Read(inputLedger.Bytes, Outcome.InvalidSource, resources.ReadLimits.MaxJsonDepth);
                    foreach (var record in incoming.Entries) { ledger.Entries[record.Key] = record.Value; suppliedRoots.Add(record.Key); }
                }
                if (i == snapshots - 1 && correspondence is not null) LedgerEngine.ApplyCorrespondence(ledger, correspondence);
                var inventory = Inventory.Snapshot(entries, request.Namespace, ct);
                // Preserve unconfirmed removals as reserved roots too. A later birth at the
                // old locator must not silently inherit the former entity's reviews.
                foreach (var root in previousRoots)
                {
                    if (!ledger.Entries.TryGetValue(root, out var record))
                    {
                        if (!inventory.ContainsKey(root)) ledger.Entries[root] = new(Unknown: "unconfirmed-removal");
                    }
                    else if (record.To is not null && !inventory.ContainsKey(Inventory.Root(request.Namespace, record.To)) &&
                        !suppliedRoots.Contains(root) && !(i == snapshots - 1 && correspondence is not null))
                        ledger.Entries[root] = new(Unknown: "unconfirmed-removal");
                }
                LedgerEngine.ValidateTargets(ledger, inventory, request.Namespace, Outcome.InvalidSource);
                minted += LedgerEngine.MintReservedSlots(ledger, inventory, request.Namespace, findings);
                var roots = LedgerEngine.LiveRoots(ledger, inventory, request.Namespace);
                var complete = i == 0 ? ledger.Entries.Values.All(r => r.Unknown is null) : LedgerEngine.CompleteTransition(previousRoots, roots, ledger);
                LedgerEngine.Store(entries, ledger);
                var tree = await repo.TreeAsync(entries, ct);
                string commit;
                if (sourceRepo is null) commit = await repo.CommitAsync(tree, null, request.Message, ct, request.Metadata);
                else
                {
                    var original = await sourceRepo.ReadObjectAsync("commit", sourceCommits[i], ct);
                    commit = await repo.ObjectAsync("commit", RewriteCommit(original, tree, head), ct);
                }
                if (i == 0) ranges.Add(new("sha1-" + commit, "sha1-" + commit, complete ? "complete" : "partial"));
                else ranges.Add(new("sha1-" + head, "sha1-" + commit, complete ? "complete" : "partial"));
                retained.Add(commit); head = commit; previousRoots = roots; currentEntries = entries;
            }
            var coverage = ranges.All(r => r.Coverage == "complete") ? "complete" : "partial";
            if (coverage == "complete") ranges = [new("sha1-" + retained[0], "sha1-" + head, "complete")];
            else
            {
                findings.Add(Findings.Create("MDPK3001", "Unconfirmed entity removals or unknown records leave correspondence partial.", severity: request.RequireComplete ? "error" : "warn"));
                if (request.RequireComplete) return Failed(Outcome.Incomplete, findings);
            }
            if (request.FailOnWarning && findings.Any(d => d.Severity == "warn")) return Failed(Outcome.Nonconforming, findings);
            var sourceBase = "sha1-" + (request.FromGit ? sourceCommits[0] : retained[0]);
            var sourceTip = "sha1-" + (request.FromGit ? sourceCommits[^1] : head);
            var transformed = request.Scope is not null;
            var manifest = new Manifest(Profile.Magic, request.Namespace, "sha1-" + head,
                new(Profile.Anchor, Profile.Digest, coverage, ledger.Entries.Count == 0 ? null : Profile.Ledger),
                new(truncated ? "truncated" : "complete", transformed ? ["projected"] : [], Profile.History));
            var history = new HistoryDetail("first-parent", truncated ? "synthetic" : "original", sourceBase, sourceTip,
                retained.Count, [], transformed ? [new("projected", sourceBase, sourceTip, manifest.Current)] : [], [], [], ranges.ToArray(),
                request.FromGit ? sourcePath.Replace('\\', '/') : null, request.Scope);
            var items = new List<EntryData> { new(Profile.Manifest, CanonicalJson.Bytes(manifest, manifest: true)) };
            items.AddRange(currentEntries.OrderBy(e => e.Name, Utf8Comparer.Instance));
            items.Add(new(Profile.History, CanonicalJson.Bytes(history)));
            items.AddRange(await repo.CurateAsync(head!, request.ReverseIndex, ct));
            stagedOutput = Path.Combine(Path.GetDirectoryName(destination)!, "." + Path.GetFileName(destination) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            await using (var file = new FileStream(stagedOutput, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                ResourceGuard.Entries(items, resources);
                ZipContainer.Write(file, items, request.CompressionLevel, request.DataDescriptors, ct,
                    Math.Min(resources.MaxSpoolBytes, resources.ReadLimits.MaxInputBytes), resources.ReadLimits.MaxDirectoryBytes);
                if (file.Length > resources.MaxSpoolBytes || file.Length > resources.ReadLimits.MaxInputBytes)
                    throw new Mdpkg.Reader.ResourceLimitException("Created archive exceeds its byte limit.");
                await file.FlushAsync(ct);
                file.Flush(flushToDisk: true);
            }
            var validated = await new Validation.PackageValidator(settings).ValidateAsync(new(stagedOutput, Deep: true, Resources: resources), ct);
            findings.AddRange(validated.Diagnostics);
            if (validated.Outcome != Outcome.Success) return validated with { Diagnostics = findings, Package = null };
            ct.ThrowIfCancellationRequested();
            File.Move(stagedOutput, destination, overwrite: true);
            stagedOutput = null;
            return validated with { Package = validated.Package! with { Path = destination }, Diagnostics = findings, MintedRoots = minted };
        }
        catch (Mdpkg.Reader.ResourceLimitException ex) { return ApiSupport.Failure(ex); }
        catch (EngineException ex) { findings.Add(Findings.Create(ex.Code, ex.Message, ex.Entry, "error")); return Failed(ex.Outcome, findings); }
        catch (DecoderFallbackException ex)
        { findings.Add(Findings.Create("MDPK1003", "Git returned a non-UTF-8 path: " + ex.Message, severity: "error")); return Failed(Outcome.InvalidSource, findings); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { findings.Add(Findings.Create("MDPK5001", ex.Message, severity: "error")); return Failed(Outcome.Environment, findings); }
        finally { if (stagedOutput is not null) File.Delete(stagedOutput); }
    }
    private static EngineResult Failed(Outcome outcome, List<Finding> findings, string? error = null) => new(outcome, null, null, null, 0, 0, [], findings, error);
    internal static byte[] RewriteCommit(byte[] original, string tree, string? parent)
    {
        // Latin1 is a byte-preserving transport here, not the source text decoder.
        var text = Encoding.Latin1.GetString(original); var split = text.IndexOf("\n\n", StringComparison.Ordinal);
        if (split < 0) throw new EngineException(Outcome.InvalidSource, "MDPK2007", "Malformed source commit.");
        var headers = text[..split].Split('\n');
        var oldParents = headers.Where(l => l.StartsWith("parent ", StringComparison.Ordinal)).Select(l => l[7..]).ToArray();
        if (headers[0] == "tree " + tree && oldParents.SequenceEqual(parent is null ? [] : new[] { parent })) return original;
        var result = new StringBuilder("tree " + tree + "\n");
        if (parent is not null) result.Append("parent ").Append(parent).Append('\n');
        var skip = false;
        foreach (var line in headers)
        {
            if (!line.StartsWith(' ')) skip = line.StartsWith("tree ", StringComparison.Ordinal) || line.StartsWith("parent ", StringComparison.Ordinal) || line.StartsWith("gpgsig ", StringComparison.Ordinal) || line.StartsWith("gpgsig-sha256 ", StringComparison.Ordinal) || line.StartsWith("mergetag ", StringComparison.Ordinal);
            if (!skip) result.Append(line).Append('\n');
        }
        result.Append('\n').Append(text[(split + 2)..]);
        return Encoding.Latin1.GetBytes(result.ToString());
    }
}
