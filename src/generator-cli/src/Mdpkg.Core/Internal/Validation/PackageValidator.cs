using Mdpkg.Reader.Internal.Container;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Core.Internal.Addressing;
using Mdpkg.Reader.Internal.Addressing;
using Mdpkg.Core.Internal.Container;
using Mdpkg.Reader.Internal.Format;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.IO;
using Mdpkg.Core.Internal.Sources;
using Mdpkg.Reader.Internal.Sources;

namespace Mdpkg.Core.Internal.Validation;

internal sealed class PackageValidator(EngineSettings? settings = null)
{
    private readonly EngineSettings settings = settings ?? new();
    private static readonly string[] CheckCodes = ["MDPK1006", "MDPK1007", "MDPK1008", "MDPK1006", "MDPK1005", "MDPK1009", "MDPK1001", "MDPK1002", "MDPK1004", "MDPK2001", "MDPK2002", "MDPK2003", "MDPK2004", "MDPK2005", "MDPK2006", "MDPK4002", "MDPK4002", "MDPK2001", "MDPK1003", "MDPK1010", "MDPK1011", "MDPK2007", "MDPK4003"];
    public async Task<EngineResult> ValidateAsync(ValidateRequest request, CancellationToken ct = default, bool managedSnapshot = false)
    {
        var findings = new List<Finding>();
        var completed = new HashSet<string>(StringComparer.Ordinal);
        Manifest? manifest = null; HistoryDetail? history = null; PackageInfo? package = null; var overrideCount = 0;
        var assurance = Mdpkg.Reader.IdentityAssurance.Declared;
        (string[] Commits, bool[] Complete, OriginState? Origin)? proof = null;
        var deepRun = false; var deepSucceeded = false; var outcome = Outcome.Nonconforming;
        try
        {
            ct.ThrowIfCancellationRequested();
            if (request.ObjectFormat != "sha1") throw new EngineException(Outcome.Nonconforming, "MDPK4001", "SHA-256 object format is unsupported.");
            await using var file = new FileStream(request.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var resources = request.Resources ?? ResourceOptions.ProducerCompatibility;
            var archive = ResourceGuard.Read(file, resources, ct);
            completed.UnionWith(["MDPK1001", "MDPK1003", "MDPK1005", "MDPK1006", "MDPK1008", "MDPK1009", "MDPK1010", "MDPK1011"]);
            findings.AddRange(archive.Findings);
            var entries = archive.Members.ToDictionary(m => m.Name, StringComparer.Ordinal);
            byte[] Need(string name, string code)
            {
                if (!entries.TryGetValue(name, out var member)) throw new EngineException(Outcome.Nonconforming, code, "Required entry is absent.", name);
                return member.Bytes;
            }
            void Fail(string code, string message, string? name = null) => findings.Add(Findings.Create(code, message, name, "error"));
            var manifestBytes = Need(Profile.Manifest, "MDPK1006");
            manifest = FormatValidation.ReadManifest(CanonicalJson.Parse(manifestBytes, resources.ReadLimits.MaxJsonDepth, ct));
            FormatValidation.ValidateManifest(manifest, request.Namespace);
            if (manifest.History is Mdpkg.Reader.GitHistory && Profile.Utf8.GetString(Need(".git/refs/heads/main", "MDPK2001")) != manifest.Current.Id[5..] + "\n") Fail("MDPK2001", "Manifest current differs from refs/heads/main.");
            completed.Add("MDPK2001");
            if (!manifestBytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(manifest, manifest: true, maxDepth: resources.ReadLimits.MaxJsonDepth))) Fail("MDPK2007", "Manifest is not canonical JSON.", Profile.Manifest);
            if (!archive.Typed && !request.AcceptRecoverable) Fail("MDPK1006", "Use --accept-recoverable to inspect a tier-2 package.", Profile.Manifest);
            if (manifest.History is Mdpkg.Reader.GitHistory gitHistory)
            {
                var historyBytes = Need(gitHistory.Detail, "MDPK2003");
                history = FormatValidation.ReadHistory(CanonicalJson.Parse(historyBytes, resources.ReadLimits.MaxJsonDepth, ct));
                FormatValidation.ValidateHistory(manifest, history);
                completed.Add("MDPK2003");
                if (!historyBytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(history))) Fail("MDPK2007", "History descriptor is not canonical JSON.", gitHistory.Detail);
            }
            var control = FormatValidation.ValidateInventory(manifest, history, archive.Members.Select(e => (e.Name, (long)e.Size)));
            foreach (var member in archive.Members)
            {
                if (!member.Name.StartsWith(".git/", StringComparison.Ordinal))
                {
                    try { Profile.Utf8.GetString(member.Bytes); }
                    catch (DecoderFallbackException) { Fail("MDPK4003", "Entry is not strict UTF-8.", member.Name); }
                    if (member.Bytes.Contains((byte)'\r')) Fail("MDPK1004", "Entry contains CR bytes.", member.Name);
                }
            }
            var gitEntries = archive.Members.Where(m => m.Name.StartsWith(".git/", StringComparison.Ordinal)).ToArray();
            completed.UnionWith(["MDPK1002", "MDPK1004", "MDPK4003"]);
            if (manifest.History is Mdpkg.Reader.GitHistory)
            {
                var pack = gitEntries.Where(m => m.Name.EndsWith(".pack", StringComparison.Ordinal)).ToArray();
                string? packStem = pack.Length == 1 ? pack[0].Name[..^5] : null;
                var allowed = new HashSet<string>(StringComparer.Ordinal) { ".git/HEAD", ".git/config", ".git/refs/heads/main", ".git/shallow" };
                if (packStem is not null)
                {
                    if (!packStem.StartsWith(".git/objects/pack/pack-", StringComparison.Ordinal)) throw new EngineException(Outcome.Nonconforming, "MDPK4002", "Invalid pack filename.", packStem);
                    var hash = packStem[".git/objects/pack/pack-".Length..];
                    if (!Profile.Oid("sha1-" + hash)) Fail("MDPK4002", "Invalid pack filename.", packStem);
                    allowed.UnionWith([packStem + ".pack", packStem + ".idx", packStem + ".rev"]);
                    if (!entries.ContainsKey(packStem + ".idx")) Fail("MDPK4002", "Pack index is absent.");
                    if (pack[0].Offset != archive.Members.Max(m => m.Offset)) Fail("MDPK1007", "The Git pack must be the last physical entry.", pack[0].Name);
                    var packBytes = pack[0].Bytes;
                    if (packBytes.Length < 32 || !packBytes.AsSpan(0, 4).SequenceEqual("PACK"u8) ||
                        Convert.ToHexStringLower(packBytes.AsSpan(packBytes.Length - 20)) != hash ||
                        !SHA1.HashData(packBytes.AsSpan(0, packBytes.Length - 20)).AsSpan().SequenceEqual(packBytes.AsSpan(packBytes.Length - 20)))
                        Fail("MDPK4002", "Pack trailer/name/checksum mismatch.", pack[0].Name);
                }
                else Fail("MDPK4002", "Exactly one Git pack is required.");
                foreach (var entry in gitEntries) if (!allowed.Contains(entry.Name)) Fail("MDPK4002", "Entry is not in the curated Git allowlist.", entry.Name);
                if (Profile.Utf8.GetString(Need(".git/HEAD", "MDPK4002")) != "ref: refs/heads/main\n") Fail("MDPK4002", "HEAD must be symbolic to refs/heads/main.");
                if (Profile.Utf8.GetString(Need(".git/config", "MDPK4002")) != Profile.Config) Fail("MDPK4002", "Curated Git config bytes differ from §5.1.");
                completed.UnionWith(["MDPK1007", "MDPK4002"]);
                var shallow = entries.TryGetValue(".git/shallow", out var sh) ? Profile.Utf8.GetString(sh.Bytes).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(s => "sha1-" + s).ToArray() : [];
                if (shallow.Distinct(StringComparer.Ordinal).Count() != shallow.Length || shallow.Any(s => !Profile.Oid(s)) ||
                    !shallow.Order(StringComparer.Ordinal).SequenceEqual(history!.ShallowBoundaries.Order(StringComparer.Ordinal))) Fail("MDPK2004", "Shallow boundaries disagree with .git/shallow.");
                if (sh is not null && shallow.Length == 0) Fail("MDPK2004", "An empty shallow file declares no genuine boundary.");
                completed.Add("MDPK2004");
            }
            var view = archive.Members.Where(m => !m.Name.EndsWith('/') && !m.Name.StartsWith(".git/", StringComparison.Ordinal) && !control.Contains(m.Name)).Select(m => new EntryData(m.Name, m.Bytes)).ToList();
            var ledger = LedgerEngine.Empty();
            if (manifest.Addressing.Overrides is not null)
            {
                ledger = LedgerEngine.Read(Need(manifest.Addressing.Overrides, "MDPK2002"), Outcome.Nonconforming, resources.ReadLimits.MaxJsonDepth);
                overrideCount = ledger.Entries.Count;
                if (overrideCount == 0) Fail("MDPK2002", "Empty ledger must be absent.");
                if (!entries[Profile.Ledger].Bytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(ledger))) Fail("MDPK2002", "Ledger is not canonical JSON.");
            }
            else if (entries.ContainsKey(Profile.Ledger)) Fail("MDPK2002", "Manifest declares no overrides while a ledger is present.");
            if (manifest.Addressing.Coverage == "complete" && ledger.Entries.Values.Any(r => r.Unknown is not null))
                Fail("MDPK2007", "Complete correspondence contradicts unknown ledger records.");
            if (!findings.Any(f => f.Code == "MDPK4003"))
            {
                var inventory = Inventory.Snapshot(view, manifest.Namespace, ct);
                LedgerEngine.ValidateTargets(ledger, inventory, manifest.Namespace, Outcome.Nonconforming);
                var targets = ledger.Entries.Values.Where(r => r.To is not null).Select(r => Inventory.Root(manifest.Namespace, r.To!)).ToHashSet(StringComparer.Ordinal);
                if (inventory.Keys.Any(root => ledger.Entries.ContainsKey(root) && !targets.Contains(root))) Fail("MDPK2002", "Reserved-slot birth lacks a fresh binding.");
            }
            if (history is not null) FormatValidation.ValidateEvidence(manifest, history, entries, resources.ReadLimits.MaxJsonDepth);
            else
            {
                if (manifest.Review is { } review)
                {
                    var bytes = Need(review["detail"]!.GetValue<string>(), "MDPK2007");
                    var node = CanonicalJson.Parse(bytes, resources.ReadLimits.MaxJsonDepth, ct);
                    Reject(!bytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(node)), "Review document is not canonical JSON.");
                }
                var captured = view.ToDictionary(e => e.Name, e => e.Bytes, StringComparer.Ordinal);
                Reject(SnapshotHash.Compute(manifest, captured.Keys, name => captured[name], ct) != manifest.Current.Id, "Snapshot state digest differs from current files.", "MDPK2001");
                if (findings.Count == 0) assurance = Mdpkg.Reader.IdentityAssurance.SnapshotVerified;
            }
            completed.UnionWith(["MDPK2002", "MDPK2005", "MDPK2006", "MDPK2007"]);
            if (request.Deep && history is not null && !findings.Any(f => f.Code is "MDPK4002" or "MDPK1002" or "MDPK2001"))
            {
                deepRun = true;
                if (managedSnapshot) ManagedSnapshotVerifier.Verify(manifest, history, gitEntries, view, resources, ct);
                else proof = await DeepAsync(manifest, history, gitEntries, view, resources, ct);
                deepSucceeded = true;
                assurance = Mdpkg.Reader.IdentityAssurance.GitVerified;
            }
            file.Position = 0;
            var hashBytes = await SHA256.HashDataAsync(file, ct);
            if (archive.Typed || request.AcceptRecoverable)
                package = new(System.IO.Path.GetFullPath(request.Path), file.Length, Convert.ToHexStringLower(hashBytes), entries.Count, archive.Typed ? "conforming" : "recoverable");
            outcome = findings.Count == 0 ? Outcome.Success : Outcome.Nonconforming;
        }
        catch (Mdpkg.Reader.ResourceLimitException ex) { return ApiSupport.Failure(ex); }
        catch (EngineException ex) { findings.Add(Findings.Create(ex.Code, ex.Message, ex.Entry, "error")); outcome = ex.Outcome; }
        catch (Exception ex) when (ex is JsonException or DecoderFallbackException or InvalidOperationException or ArgumentException or IndexOutOfRangeException or FormatException or OverflowException)
        { findings.Add(Findings.Create("MDPK2007", "Malformed package: " + ex.Message, severity: "error")); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { outcome = Outcome.Environment; findings.Add(Findings.Create("MDPK5001", ex.Message, severity: "error")); }
        var checks = CheckCodes.Select((code, i) => new Check(code,
            manifest?.History is Mdpkg.Reader.SnapshotHistory && i is 1 or 11 or 12 or 13 or 14 or 15 or 16 or 17 ? "not-applicable" :
            ((i == 16 || i == 17) && !deepRun) ? "skipped" : findings.Any(f => f.Code == code) ? "fail" :
            (i == 16 || i == 17) ? (deepSucceeded ? "pass" : "skipped") : completed.Contains(code) ? "pass" : "skipped")).ToArray();
        var context = outcome == Outcome.Success && package is not null && manifest is not null && proof is { } verified
            ? new Mdpkg.Reader.VerifiedHistoryContext(new(manifest.Namespace, manifest.Current), "sha256-" + package.Sha256, package.Bytes,
                verified.Commits, verified.Complete, verified.Origin?.Snapshot, verified.Origin?.Header, verified.Origin?.Files) : null;
        return new(outcome, package, manifest, history, overrideCount, 0, checks, findings, Assurance: outcome == Outcome.Success ? assurance : Mdpkg.Reader.IdentityAssurance.Declared,
            HistoryContext: context);
    }
    private static void Reject(bool invalid, string message, string code = "MDPK2007")
    { if (invalid) throw new EngineException(Outcome.Nonconforming, code, message); }
    private async Task<(string[] Commits, bool[] Complete, OriginState? Origin)> DeepAsync(Manifest manifest, HistoryDetail history, ZipMember[] gitEntries, List<EntryData> view, ResourceOptions resources, CancellationToken ct)
    {
        OriginState? origin = null;
        using var temp = new TemporaryDirectory(settings.TemporaryDirectory);
        long spooled = 0;
        foreach (var entry in gitEntries)
        {
            if (entry.Size > resources.MaxSpoolBytes - spooled) throw new Mdpkg.Reader.ResourceLimitException("Deep Git staging exceeds its byte limit.");
            spooled += entry.Size;
            var dest = System.IO.Path.Combine(temp.Path, entry.Name);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest)!);
            await File.WriteAllBytesAsync(dest, entry.Bytes, ct);
        }
        var git = new GitProcess(settings.GitExecutable, resources.MaxSpoolBytes);
        var repo = new Repository(git, temp.Path, resources);
        try { await git.TextAsync(temp.Path, ct, "fsck", "--full", "--strict"); }
        catch (IOException ex) when (ex is not Mdpkg.Reader.ResourceLimitException && ex.InnerException is not System.ComponentModel.Win32Exception)
        { throw new EngineException(Outcome.Nonconforming, "MDPK4002", ex.Message); }
        var head = manifest.Current.Id[5..];
        var commits = (await git.TextAsync(temp.Path, ct, "rev-list", "--first-parent", "--reverse", head)).Split('\n');
        Reject(commits.Length != history.RetainedCommits, "Retained commit count disagrees with the pack.");
        var indexes = commits.Select((c, i) => (Id: "sha1-" + c, Index: i)).ToDictionary(x => x.Id, x => x.Index);
        var coverage = new bool[Math.Max(1, commits.Length - 1)];
        var completeClaims = new bool[commits.Length];
        var partialClaims = new bool[commits.Length];
        completeClaims[0] = manifest.Addressing.Coverage == "complete";
        foreach (var range in history.AddressingCoverage)
        {
            Reject(!indexes.ContainsKey(range.From) || !indexes.ContainsKey(range.To) || indexes[range.From] > indexes[range.To], "Coverage endpoints are not in retained first-parent order.");
            for (var i = indexes[range.From]; i < indexes[range.To]; i++) coverage[i] = true;
            if (range.Coverage == "complete")
            {
                // A range covers transitions after From, through To. A root-only
                // range asserts the initial ledger; later confirmation cannot repair it.
                for (var i = indexes[range.From] + 1; i <= indexes[range.To]; i++) completeClaims[i] = true;
                if (indexes[range.From] == 0 && indexes[range.To] == 0) completeClaims[0] = true;
            }
            else
                for (var i = indexes[range.From] + 1; i <= indexes[range.To]; i++) partialClaims[i] = true;
        }
        Reject(commits.Length > 1 && coverage.Any(c => !c), "Coverage ranges leave undeclared gaps.");
        if (manifest.Addressing.Coverage == "complete") Reject(history.AddressingCoverage[0].From != "sha1-" + commits[0], "Complete coverage does not start at retained root.");
        foreach (var t in history.Transformations) Reject(!indexes.ContainsKey(t.Emitted), "Transformation emitted commit is absent.", "MDPK2003");
        var previousRoots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (commit, index) in commits.Select((commit, index) => (commit, index)))
        {
            var rawCommit = await repo.ReadObjectAsync("commit", commit, ct);
            if (index != 0 || history.Origin is null) CommitProtocol.RejectUnverifiedBootstrap(rawCommit);
            Reject(CountParents(rawCommit) > 1, "Retained graph includes a merge second parent.");
            var tree = await repo.ReadTreeAsync(commit, null, [], normalize: false, ct);
            if (index == 0 && history.Origin is not null)
                origin = await OriginVerifier.VerifyAsync(manifest, history, commit, rawCommit, tree, repo, temp.Path, resources, ct);
            if (manifest.Review?["shape"]?.GetValue<string>() == "delta")
                Reject(tree.Any(e => e.Name != ".mdpkg/review/comments.json"), "Delta review retains non-review files.");
            foreach (var e in tree)
            {
                try { Profile.Utf8.GetString(e.Bytes); }
                catch (DecoderFallbackException) { throw new EngineException(Outcome.Nonconforming, "MDPK4003", "Retained blob is not strict UTF-8.", e.Name); }
                Reject(e.Bytes.Contains((byte)'\r'), "Retained blob contains CR: " + e.Name, "MDPK1004");
            }
            var inventory = Inventory.Snapshot(tree, manifest.Namespace, ct);
            var ledger = LedgerEngine.Empty();
            if (tree.FirstOrDefault(e => e.Name == Profile.Ledger) is { } historicalLedger)
            {
                ledger = LedgerEngine.Read(historicalLedger.Bytes, Outcome.Nonconforming, resources.ReadLimits.MaxJsonDepth);
                Reject(ledger.Entries.Count == 0, "A retained tree carries an empty ledger.", "MDPK2002");
                LedgerEngine.ValidateTargets(ledger, inventory, manifest.Namespace, Outcome.Nonconforming);
            }
            var roots = LedgerEngine.LiveRoots(ledger, inventory, manifest.Namespace);
            Reject(completeClaims[index] && !LedgerEngine.CompleteTransition(previousRoots, roots, ledger),
                "Complete correspondence coverage contradicts retained history evidence at sha1-" + commit + ".");
            previousRoots = roots;
            if (commit == head)
            {
                var tip = tree.ToDictionary(e => e.Name, StringComparer.Ordinal);
                Reject(view.Count != tip.Count || view.Any(e => !tip.TryGetValue(e.Name, out var blob) || !blob.Bytes.AsSpan().SequenceEqual(e.Bytes)), "Current view differs from the tip tree.", "MDPK2001");
            }
        }
        if (manifest.Review is { } review && review["shape"]!.GetValue<string>() == "bundled")
        {
            var reviewed = review["of"]!["current"]!;
            var parent = reviewed["kind"]!.GetValue<string>() == "snapshot"
                ? origin?.Snapshot.Identity.Current.Id == reviewed["id"]!.GetValue<string>() ? history.Origin!["commit"]!.GetValue<string>() : null
                : reviewed["id"]!.GetValue<string>();
            Reject(commits.Length < 2 || "sha1-" + commits[^2] != parent, "Bundled review parent differs from review.of.current or verified origin.");
            var changed = await git.TextAsync(temp.Path, ct, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", commits[^2], head);
            Reject(changed.Split('\0', StringSplitOptions.RemoveEmptyEntries).Any(p => !p.StartsWith(".mdpkg/review/", StringComparison.Ordinal)), "Bundled review changes non-review paths.");
        }
        return (commits, completeClaims.Select((complete, index) => complete && !partialClaims[index]).Skip(1).ToArray(), origin);
    }

    private static int CountParents(ReadOnlySpan<byte> commit)
    {
        // Git metadata is verbatim binary storage: only ASCII structural header
        // prefixes matter here. Author names and messages need not be UTF-8.
        var count = 0;
        while (!commit.IsEmpty)
        {
            var end = commit.IndexOf((byte)'\n');
            if (end <= 0) break;
            if (commit[..end].StartsWith("parent "u8)) count++;
            commit = commit[(end + 1)..];
        }
        return count;
    }
}
