using System.Text.Json;
using System.Text.Json.Nodes;
using Mdpkg.Core.Internal.Git;
using Mdpkg.Core.Internal.Container;
using Mdpkg.Reader;

namespace Mdpkg.Core.Internal.Validation;

internal sealed record OriginState(PackageSnapshot Snapshot, JsonElement Header, Dictionary<string, byte[]> Files);
internal static class OriginVerifier
{
    internal static async Task<OriginState> VerifyAsync(Manifest manifest, HistoryDetail history, string commit,
        byte[] rawCommit, List<EntryData> files, Repository repo, string scratch, ResourceOptions resources, CancellationToken ct)
    {
        var origin = history.Origin!;
        void Require(bool valid, string reason)
        { if (!valid) throw new EngineException(Outcome.Nonconforming, "MDPK4002", "Invalid bootstrap origin: " + reason); }
        Require(origin["commit"]!.GetValue<string>() == "sha1-" + commit && !history.ShallowBoundaries.Contains("sha1-" + commit), "root mapping or shallow boundary");
        Require(files.All(e => e.Mode == "100644"), "original file mode");
        var header = origin["header"]!.AsObject();
        var node = new JsonObject { ["mdpkg"] = Profile.Magic, ["namespace"] = manifest.Namespace,
            ["current"] = new JsonObject { ["kind"] = "snapshot", ["id"] = origin["snapshot"]!.DeepClone() },
            ["addressing"] = header["addressing"]!.DeepClone(), ["history"] = new JsonObject { ["mode"] = "none" } };
        if (header["review"] is { } review) node["review"] = review.DeepClone();
        var snapshotManifest = FormatValidation.ReadManifest(node);
        FormatValidation.ValidateManifest(snapshotManifest, manifest.Namespace);
        Require(JsonNode.DeepEquals(SnapshotHash.Header(snapshotManifest), header), "semantic header");
        // C0 retains S0's semantic declarations; only a successor may change them.
        // Header deliberately excludes optional transport evidence from this comparison.
        if (manifest.Current.Id == origin["commit"]!.GetValue<string>())
            Require(CanonicalJson.Bytes(SnapshotHash.Header(manifest)).AsSpan().SequenceEqual(CanonicalJson.Bytes(header)),
                "current bootstrap semantic header differs from origin; a successor commit is required");
        // Native Git independently checks object hashes/reachability. Rebuilding the
        // regular-file tree also detects unrepresented empty directories and modes.
        var treeId = await repo.TreeAsync(files, ct);
        var expected = string.Join('\n', new[] { "tree " + treeId,
            "author mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000",
            "committer mdpkg bootstrap <bootstrap@mdpkg.invalid> 946684800 +0000", "", "mdpkg-bootstrap-v1",
            "namespace " + manifest.Namespace, "snapshot " + snapshotManifest.Current.Id, "" });
        Require(rawCommit.AsSpan().SequenceEqual(Profile.Utf8.GetBytes(expected)), "commit payload, parent or tree");
        // Validate S0 with the ordinary snapshot validator, over the root's files,
        // independently of the current ZIP view and of the bootstrap writer.
        var items = new List<EntryData> { new(Profile.Manifest, CanonicalJson.Bytes(snapshotManifest, true)) };
        items.AddRange(files);
        var path = Path.Combine(scratch, "origin-state.mdpkg");
        using (var output = File.Create(path))
            ZipContainer.Write(output, items, 6, false, ct, Math.Min(resources.MaxSpoolBytes, resources.ReadLimits.MaxInputBytes), resources.ReadLimits.MaxDirectoryBytes);
        var validation = await new PackageValidator().ValidateAsync(new(path, Resources: resources), ct);
        if (validation.ResourceExceeded)
            throw new ResourceLimitException("Original-state validation exceeded its resource limit.");
        Require(validation.Outcome == Outcome.Success, "original state: " + string.Join("; ", validation.Diagnostics.Select(d => d.Message)));
        using var input = File.OpenRead(path);
        var snapshot = await PackageSnapshot.ReadAsync(input, resources.ReadLimits, ct);
        snapshot.HasOriginalArchiveBytes = false;
        snapshot.Assurance = IdentityAssurance.SnapshotVerified;
        return new(snapshot, JsonSerializer.SerializeToElement(header), files.ToDictionary(e => e.Name, e => e.Bytes, StringComparer.Ordinal));
    }
}
