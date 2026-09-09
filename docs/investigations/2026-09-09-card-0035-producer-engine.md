# CARD-0035: real pack and validate engine

Implemented inside `src/generator-cli/src/Mdpkg.Cli/`, without adding a Core project
or changing package versioning/publication. `pack` and `validate` call the engine;
`update` and `address` retain explicit exit-70 actions.

## Review map

| Area | Implementation |
| --- | --- |
| Command/result mapping | `Commands/PackCommand.cs`, `ValidateCommand.cs`, `EngineAction.cs` |
| Build orchestration and atomic publication | `Engine/PackageBuilder.cs` |
| UTF-8, LF, source containment and Unicode 17 path checks | `Engine/Sources/` |
| Isolated native Git, imported commits, trees and curated pack | `Engine/Git/` |
| CommonMark inventory, roots/digests and sparse lifecycle records | `Engine/Addressing/` |
| Typed declarations and canonical UTF-8 JSON | `Engine/Models.cs`, `Engine/Format/` |
| ZIP32 writer, bounds/CRC/DEFLATE reader | `Engine/Container/ZipContainer.cs` |
| Shared structural/content and deep Git validation | `Engine/Validation/PackageValidator.cs` |
| Tests and independent fixtures | `src/generator-cli/tests/Mdpkg.Cli.Tests/` |

The root README, generator README and tool reference describe actual support and
producer defaults. The format spec's status line now links the implementation;
normative format rules are unchanged. CI adds Windows alongside Linux and includes
the worked-example/spec inputs in its path filters.

## Decisions made concrete

- Snapshot commits use fixed author/committer and timestamp. Import preserves raw
  author/committer/message bytes; changing a signed tree or parent removes signatures.
- Git import requires the repository root or a bare repository, walks first parents,
  normalizes all retained text blobs, applies native pathspec selection and truncates
  by synthesizing an oldest root. It never checks out or mutates source files/indexes.
- Output is outside source; linked source ancestors and output parent directories
  are rejected. Regular files use mode 100644 in both Git and ZIP. Strict UTF-8
  preserves BOMs; CRLF and lone CR normalize to LF with per-path diagnostics.
- Correspondence input is a JSON array. Supplied records are producer confirmations;
  `confirmed:false`, malformed records and absent move targets fail. Unconfirmed
  removals become persistent `unknown` records and partial transition coverage.
  Reserved-slot births get fresh random roots. No heuristic rename becomes authority.
- Numeric zlib levels 0–9 are real levels. The ZIP manifest and Git storage are stored;
  other entries use DEFLATE only when smaller. Data descriptors are optional on every
  entry except the manifest. Canonical JSON preserves literal supplementary Unicode.
- Warning promotion, incomplete coverage requirements and failed self-validation
  happen before destination replacement. Cancellation kills active Git and cleans
  owned staging. Reports cannot overwrite source/package/correspondence inputs or
  the package output.
- New diagnostics cover malformed ZIP/CRC/DEFLATE (`MDPK1011`), invalid JSON/profile/
  declarations (`MDPK2007`) and environment failures (`MDPK5001`). Existing codes keep
  their documented severity and meaning. Engine outcomes are mapped to exits only
  at the CLI boundary.

## Verification

Windows, .NET SDK 10.0.300/runtime 10.0.8, Git 2.50.1.windows.1:

- Release build: zero warnings or errors.
- Final .NET test run: 803 passed, zero failed, zero skipped.
- The suite includes all 652 CommonMark 0.31.2 examples, compared against committed
  independent JavaScript-parser inventories, locators, roots and digests. No Node or
  network is needed for ordinary .NET test execution.
- Every recorded worked-example root/digest and original Git commit ID agrees.
  Canonical manifest bytes, payload CRCs/sizes, header fields and layout agree;
  offsets account for valid compressor-dependent payload-length differences.
- Native `git fsck --full --strict`, current-view/tree comparison, ordinary ZIP
  extraction and `git read-tree HEAD` are exercised by tests. Source executable modes
  are normalized to match ZIP attributes, preventing spurious Unix mode changes.
- Tests cover projection/depth, historical LF rewriting, confirmed/unconfirmed
  records, reserved births, malformed paths/Unicode/UTF-8/JSON/ZIP, corrupted indexes,
  CRC/truncated DEFLATE, ZIP64 boundaries, failure preservation, report contracts,
  active cancellation/cleanup and caller-owned container streams.
- CLI smoke: `pack examples` followed by `validate --deep` returned 0, with 13 entries
  and no diagnostics. Package SHA-256:
  `f7a49fd33c500d23534df23ca7d3558f6c01792197882542c401fff01f10c012`.
- The separate JavaScript viewer opened that package, decoded all 13 entries and
  computed 25 entity digests, reporting zero conformance issues.

Rerun from `src/generator-cli/`:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
```

Local smoke files/reports are under `.antiphon/engine-work/` and are intentionally
not tracked. Tests reconstruct their own fixtures in owned temporary directories.

## Boundaries for the next review

The engine buffers entry payloads; an individual entry beyond Int32.MaxValue is an
environment/resource failure. ZIP64 is rejected separately. Repeatability assumes
the same Git/runtime/tool versions and excludes newly minted random roots. .NET's
ledger DEFLATE stream measured 161 bytes against the Python fixture's 160; both
decode to identical bytes, so cross-compressor archive identity is not claimed.

Review-package authoring, update/squash/address operations, a public library API,
NuGet versioning and publishing remain separate work. Validation does not prove that
upstream history was complete; it checks declared history against shipped evidence.
The Windows/Linux workflow is configured; local execution evidence above is Windows.
