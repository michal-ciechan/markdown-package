using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Cli.Engine.Addressing;
using Mdpkg.Cli.Engine.Container;
using Mdpkg.Cli.Engine.Format;
using Mdpkg.Cli.Engine.Git;
using Mdpkg.Cli.Engine.IO;
using Mdpkg.Cli.Engine.Sources;

namespace Mdpkg.Cli.Engine.Validation;

internal sealed class PackageValidator(EngineSettings? settings = null)
{
    private readonly EngineSettings settings = settings ?? new();
    private static readonly string[] CheckCodes = ["MDPK1006", "MDPK1007", "MDPK1008", "MDPK1006", "MDPK1005", "MDPK1009", "MDPK1001", "MDPK1002", "MDPK1004", "MDPK2001", "MDPK2002", "MDPK2003", "MDPK2004", "MDPK2005", "MDPK2006", "MDPK4002", "MDPK4002", "MDPK2001", "MDPK1003", "MDPK1010", "MDPK1011", "MDPK2007", "MDPK4003"];
    public async Task<EngineResult> ValidateAsync(ValidateRequest request, CancellationToken ct = default)
    {
        var findings = new List<Finding>();
        var completed = new HashSet<string>(StringComparer.Ordinal);
        Manifest? manifest = null; HistoryDetail? history = null; PackageInfo? package = null; var overrideCount = 0;
        var deepRun = false; var deepSucceeded = false; var outcome = Outcome.Nonconforming;
        try
        {
            ct.ThrowIfCancellationRequested();
            if (request.ObjectFormat != "sha1") throw new EngineException(Outcome.Nonconforming, "MDPK4001", "SHA-256 object format is unsupported.");
            await using var file = new FileStream(request.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var archive = ZipContainer.Read(file, ct);
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
            manifest = CanonicalJson.Read<Manifest>(manifestBytes);
            ValidateManifest(manifest, request.Namespace);
            if (Profile.Utf8.GetString(Need(".git/refs/heads/main", "MDPK2001")) != manifest.Current[5..] + "\n") Fail("MDPK2001", "Manifest current differs from refs/heads/main.");
            completed.Add("MDPK2001");
            if (!manifestBytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(manifest, manifest: true))) Fail("MDPK2007", "Manifest is not canonical JSON.", Profile.Manifest);
            if (!archive.Typed && !request.AcceptRecoverable) Fail("MDPK1006", "Use --accept-recoverable to inspect a tier-2 package.", Profile.Manifest);
            var historyBytes = Need(manifest.History.Detail, "MDPK2003");
            history = CanonicalJson.Read<HistoryDetail>(historyBytes);
            ValidateHistory(manifest, history);
            completed.Add("MDPK2003");
            if (!historyBytes.AsSpan().SequenceEqual(CanonicalJson.Bytes(history))) Fail("MDPK2007", "History descriptor is not canonical JSON.", manifest.History.Detail);
            var control = new HashSet<string>(StringComparer.Ordinal) { Profile.Manifest, Profile.History };
            if (history.Bindings is not null) control.Add(history.Bindings);
            foreach (var range in history.Ranges) control.Add(range);
            foreach (var patch in history.Patches) control.Add(patch.Entry);
            foreach (var member in archive.Members)
            {
                if (!member.Name.StartsWith(".git/", StringComparison.Ordinal))
                {
                    try { Profile.Utf8.GetString(member.Bytes); }
                    catch (DecoderFallbackException) { Fail("MDPK4003", "Entry is not strict UTF-8.", member.Name); }
                    if (member.Bytes.Contains((byte)'\r')) Fail("MDPK1004", "Entry contains CR bytes.", member.Name);
                    if (SourceTree.Reserved(member.Name) && !control.Contains(member.Name)) Fail("MDPK1002", "Unrecognized reserved entry.", member.Name);
                }
            }
            var gitEntries = archive.Members.Where(m => m.Name.StartsWith(".git/", StringComparison.Ordinal)).ToArray();
            completed.UnionWith(["MDPK1002", "MDPK1004", "MDPK4003"]);
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
                !shallow.Order(StringComparer.Ordinal).SequenceEqual(history.ShallowBoundaries.Order(StringComparer.Ordinal))) Fail("MDPK2004", "Shallow boundaries disagree with .git/shallow.");
            if (sh is not null && shallow.Length == 0) Fail("MDPK2004", "An empty shallow file declares no genuine boundary.");
            completed.Add("MDPK2004");
            var view = archive.Members.Where(m => !m.Name.StartsWith(".git/", StringComparison.Ordinal) && !control.Contains(m.Name)).Select(m => new EntryData(m.Name, m.Bytes)).ToList();
            var ledger = LedgerEngine.Empty();
            if (manifest.Addressing.Overrides is not null)
            {
                ledger = LedgerEngine.Read(Need(manifest.Addressing.Overrides, "MDPK2002"), Outcome.Nonconforming);
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
            ValidateEvidence(manifest, history, entries);
            completed.UnionWith(["MDPK2002", "MDPK2005", "MDPK2006", "MDPK2007"]);
            if (request.Deep && !findings.Any(f => f.Code is "MDPK4002" or "MDPK1002" or "MDPK2001"))
            {
                deepRun = true;
                await DeepAsync(manifest, history, gitEntries, view, ct);
                deepSucceeded = true;
            }
            file.Position = 0;
            var hashBytes = await SHA256.HashDataAsync(file, ct);
            if (archive.Typed || request.AcceptRecoverable)
                package = new(System.IO.Path.GetFullPath(request.Path), file.Length, Convert.ToHexStringLower(hashBytes), entries.Count, archive.Typed ? "conforming" : "recoverable");
            outcome = findings.Count == 0 ? Outcome.Success : Outcome.Nonconforming;
        }
        catch (EngineException ex) { findings.Add(Findings.Create(ex.Code, ex.Message, ex.Entry, "error")); outcome = ex.Outcome; }
        catch (Exception ex) when (ex is JsonException or DecoderFallbackException or InvalidOperationException or ArgumentException or IndexOutOfRangeException or FormatException or OverflowException)
        { findings.Add(Findings.Create("MDPK2007", "Malformed package: " + ex.Message, severity: "error")); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { outcome = Outcome.Environment; findings.Add(Findings.Create("MDPK5001", ex.Message, severity: "error")); }
        var checks = CheckCodes.Select((code, i) => new Check(code,
            ((i == 16 || i == 17) && !deepRun) ? "skipped" : findings.Any(f => f.Code == code) ? "fail" :
            (i == 16 || i == 17) ? (deepSucceeded ? "pass" : "skipped") : completed.Contains(code) ? "pass" : "skipped")).ToArray();
        return new(outcome, package, manifest, history, overrideCount, 0, checks, findings);
    }
    private static void Reject(bool invalid, string message, string code = "MDPK2007")
    { if (invalid) throw new EngineException(Outcome.Nonconforming, code, message); }
    private static void ValidateManifest(Manifest m, string? expectedNamespace)
    {
        Reject(m.Mdpkg != Profile.Magic || !Guid.TryParseExact(m.Namespace, "D", out _) || m.Namespace != m.Namespace.ToLowerInvariant(), "Unsupported manifest version or namespace.");
        Reject(expectedNamespace is not null && expectedNamespace != m.Namespace, "Supplied namespace differs from package.");
        if (m.Current.StartsWith("sha256-", StringComparison.Ordinal)) throw new EngineException(Outcome.Nonconforming, "MDPK4001", "SHA-256 repositories are unsupported.");
        Reject(!Profile.Oid(m.Current), "Malformed current commit.");
        Reject(m.Addressing.Anchor != Profile.Anchor || m.Addressing.Digest != Profile.Digest || m.Addressing.Coverage is not ("complete" or "partial"), "Unknown addressing profile or coverage.");
        Reject(m.Addressing.Overrides is not null && m.Addressing.Overrides != Profile.Ledger, "Unsupported ledger path.", "MDPK2002");
        Reject(m.History.Coverage is not ("complete" or "truncated" or "unknown") || m.History.Detail != Profile.History || m.History.Transform.Any(t => t is not ("projected" or "squashed")), "Invalid history declaration.");
        if (m.Review is { } r)
        {
            var of = r["of"]?.AsObject() ?? throw new JsonException("Missing review.of.");
            var ns = of["namespace"]?.GetValue<string>();
            var shape = r["shape"]?.GetValue<string>();
            Reject(!Guid.TryParseExact(ns, "D", out _) || ns != ns.ToLowerInvariant() || !Profile.Oid(of["current"]?.GetValue<string>()) ||
                shape is not ("delta" or "bundled") || r["detail"]?.GetValue<string>() != ".mdpkg/review/comments.json", "Malformed review declaration.");
            Reject((shape == "bundled") != (ns == m.Namespace), "Review namespace disagrees with its shape.");
        }
    }
    private static void ValidateHistory(Manifest m, HistoryDetail h)
    {
        Reject(h.Walk != "first-parent" || h.Root is not ("original" or "synthetic") || h.RetainedCommits < 1 || !Profile.Oid(h.SourceBase) || !Profile.Oid(h.SourceTip), "Malformed history descriptor.");
        Reject(h.Root == "synthetic" && m.History.Coverage != "truncated", "Synthetic roots require truncated coverage.");
        Reject(h.Transformations.Any(t => t is null || t.Kind is not ("projected" or "squashed") || !Profile.Oid(t.SourceBase) || !Profile.Oid(t.SourceTip) || !Profile.Oid(t.Emitted)) ||
            !m.History.Transform.SequenceEqual(h.Transformations.Select(t => t.Kind)), "Manifest/history transformations disagree.", "MDPK2003");
        Reject(h.ShallowBoundaries.Any(s => !Profile.Oid(s)) || h.ShallowBoundaries.Distinct().Count() != h.ShallowBoundaries.Length, "Invalid shallow boundaries.", "MDPK2004");
        Reject(h.AddressingCoverage.Length == 0 || h.AddressingCoverage.Any(r => r is null || !Profile.Oid(r.From) || !Profile.Oid(r.To) || r.Coverage is not ("complete" or "partial")), "Invalid addressing coverage ranges.");
        Reject(h.Ranges.Any(r => r is null) || h.Patches.Any(p => p is null), "Null history evidence item.");
        Reject(m.Addressing.Coverage == "complete" && (h.AddressingCoverage.Length != 1 || h.AddressingCoverage[0].Coverage != "complete" || h.AddressingCoverage[0].To != m.Current), "Complete correspondence needs one range through current.");
        Reject(m.Addressing.Coverage == "partial" && h.AddressingCoverage.All(r => r.Coverage == "complete"), "Partial correspondence has no uncovered range.");
    }
    private static void ValidateEvidence(Manifest m, HistoryDetail h, Dictionary<string, ZipMember> entries)
    {
        JsonNode NeedJson(string name, string code)
        {
            Reject(!entries.ContainsKey(name), "Missing evidence: " + name, code);
            var bytes = entries[name].Bytes; var node = CanonicalJson.Parse(bytes);
            Reject(!bytes.AsSpan().SequenceEqual(Profile.Utf8.GetBytes(CanonicalJson.Text(node))), "Evidence is not canonical JSON: " + name, code);
            return node;
        }
        Reject(h.Ranges.Distinct().Count() != h.Ranges.Length || h.Patches.Select(p => p.Entry).Distinct().Count() != h.Patches.Length, "Duplicate history evidence.");
        foreach (var name in h.Ranges)
        {
            Reject(!name.StartsWith(".mdpkg/history/ranges/", StringComparison.Ordinal) || !name.EndsWith(".json", StringComparison.Ordinal) || !entries.ContainsKey(name), "Invalid/absent summary.", "MDPK2005");
            var sum = NeedJson(name, "MDPK2005");
            Reject(name != ".mdpkg/history/ranges/" + Profile.Hash(entries[name].Bytes) + ".json", "Summary hash differs from its name.", "MDPK2005");
            Reject(sum["version"]?.GetValue<int>() != 1 || sum["namespace"]?.GetValue<string>() != m.Namespace || sum["anchor"]?.GetValue<string>() != Profile.Anchor ||
                sum["profile"]?.GetValue<string>() != Profile.Digest || sum["walk"]?.GetValue<string>() != "first-parent", "Summary profiles disagree.", "MDPK2005");
        }
        JsonArray? bindings = null;
        if (h.Bindings is not null)
        {
            Reject(h.Bindings != ".mdpkg/history/bindings.json", "Invalid bindings path.", "MDPK2005");
            var doc = NeedJson(h.Bindings, "MDPK2005");
            Reject(doc["version"]?.GetValue<int>() != 1, "Unknown bindings version.", "MDPK2005");
            bindings = doc["bindings"]?.AsArray() ?? throw new JsonException("Missing bindings array.");
            foreach (var b in bindings)
            {
                var name = b?["summary"]?.GetValue<string>();
                Reject(name is null || !h.Ranges.Contains(name) || !Profile.Oid(b?["emitted"]?.GetValue<string>()), "Binding names an absent summary or malformed commit.", "MDPK2005");
                Reject(b!["hash"]?.GetValue<string>() != Profile.Hash(entries[name!].Bytes), "Binding hash disagrees.", "MDPK2005");
            }
        }
        foreach (var t in h.Transformations.Where(t => t.Summary is not null))
            Reject(!h.Ranges.Contains(t.Summary!) || bindings is null || !bindings.Any(b => b?["summary"]?.GetValue<string>() == t.Summary && b?["emitted"]?.GetValue<string>() == t.Emitted), "Transformation has no matching summary binding.", "MDPK2005");
        foreach (var patch in h.Patches)
            Reject(!Profile.Root(patch.Sha256) || patch.Entry != ".mdpkg/history/patches/" + patch.Sha256 + ".patch" || !entries.TryGetValue(patch.Entry, out var entry) || Profile.Hash(entry.Bytes) != patch.Sha256 ||
                !Profile.Oid(patch.From) || !Profile.Oid(patch.To) || !Profile.Root(patch.Document) || patch.Profile != "git-myers-u3-v1", "Archived patch binding/hash mismatch.", "MDPK2006");
        if (m.Review is not null) NeedJson(m.Review["detail"]!.GetValue<string>(), "MDPK2007");
    }
    private async Task DeepAsync(Manifest manifest, HistoryDetail history, ZipMember[] gitEntries, List<EntryData> view, CancellationToken ct)
    {
        using var temp = new TemporaryDirectory(settings.TemporaryDirectory);
        foreach (var entry in gitEntries)
        {
            var dest = System.IO.Path.Combine(temp.Path, entry.Name);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest)!);
            await File.WriteAllBytesAsync(dest, entry.Bytes, ct);
        }
        var git = new GitProcess(settings.GitExecutable);
        var repo = new Repository(git, temp.Path);
        try { await git.TextAsync(temp.Path, ct, "fsck", "--full", "--strict"); }
        catch (IOException ex) when (ex.InnerException is not System.ComponentModel.Win32Exception)
        { throw new EngineException(Outcome.Nonconforming, "MDPK4002", ex.Message); }
        var head = manifest.Current[5..];
        var commits = (await git.TextAsync(temp.Path, ct, "rev-list", "--first-parent", "--reverse", head)).Split('\n');
        Reject(commits.Length != history.RetainedCommits, "Retained commit count disagrees with the pack.");
        var indexes = commits.Select((c, i) => (Id: "sha1-" + c, Index: i)).ToDictionary(x => x.Id, x => x.Index);
        var coverage = new bool[Math.Max(1, commits.Length - 1)];
        var completeClaims = new bool[commits.Length];
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
        }
        Reject(commits.Length > 1 && coverage.Any(c => !c), "Coverage ranges leave undeclared gaps.");
        if (manifest.Addressing.Coverage == "complete") Reject(history.AddressingCoverage[0].From != "sha1-" + commits[0], "Complete coverage does not start at retained root.");
        foreach (var t in history.Transformations) Reject(!indexes.ContainsKey(t.Emitted), "Transformation emitted commit is absent.", "MDPK2003");
        var previousRoots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (commit, index) in commits.Select((commit, index) => (commit, index)))
        {
            var rawCommit = await repo.ReadObjectAsync("commit", commit, ct);
            Reject(CountParents(rawCommit) > 1, "Retained graph includes a merge second parent.");
            var tree = await repo.ReadTreeAsync(commit, null, [], normalize: false, ct);
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
                ledger = LedgerEngine.Read(historicalLedger.Bytes, Outcome.Nonconforming);
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
        if (manifest.Review is { } review)
        {
            if (review["shape"]!.GetValue<string>() == "delta") Reject(commits.Length != 1 || view.Any(e => !e.Name.StartsWith(".mdpkg/review/", StringComparison.Ordinal)), "Delta review must be a one-commit review-only lineage.");
            else
            {
                Reject(commits.Length < 2 || "sha1-" + commits[^2] != review["of"]!["current"]!.GetValue<string>(), "Bundled review parent differs from review.of.current.");
                var changed = await git.TextAsync(temp.Path, ct, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", commits[^2], head);
                Reject(changed.Split('\0', StringSplitOptions.RemoveEmptyEntries).Any(p => !p.StartsWith(".mdpkg/review/", StringComparison.Ordinal)), "Bundled review changes non-review paths.");
            }
        }
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
