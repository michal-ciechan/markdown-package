# CARD-0037 review of 81d2d30

Changes required before closing CARD-0037: two reproduced defects in review parsing.
No implementation files were changed. The review used the full card, accepted R0–R4
plan, implementation report, source diff, packed libraries and independent fixture mutations.

## Confirmed defects

1. **P2 — A null comments-document root escapes the typed malformed-input contract.**
   `src/generator-cli/src/Mdpkg.Reviews/ReviewParser.cs:44` dereferences `value` with
   `AsObject()`. `CanonicalJson.Parse` returns a null JsonNode for canonical `null\n`,
   and `PackageArchive.ReadCanonicalJson` accepts those canonical bytes. Replacing
   only `.mdpkg/review/comments.json` in `delta-v2.mdpkg` with those five bytes (and
   rebuilding valid ZIP CRCs/sizes) makes the public `ExtractAsync` throw an uncaught
   `NullReferenceException`. It should return `Malformed`, `SchemaStatus.Malformed`
   and no items. This affects ordinary default extraction of an untrusted upload;
   a consumer following the packed example does not get the promised diagnostic.
   Add an explicit object-root check rather than broadly swallowing null-reference
   bugs. Cover null and other JSON root kinds through the public API.

2. **P2 — Extension copying ignores an explicitly raised JSON-depth limit.**
   `ReviewParser.cs:18–20` calls `JsonSerializer.SerializeToElement(p.Value)` with
   default serialization options. A valid, canonical review with a 70-level
   non-semantic extension is below `ReadLimits.MaxJsonDepth = 128` and all byte,
   thread and comment limits, yet extraction returns `Malformed/MalformedReview`
   with “The object or value could not be serialized.” No feedback is returned.
   The parser's bounded read accepts the depth, then extension copying applies the
   serializer's independent default depth ceiling. With default Reader limits the
   same fixture correctly returns `ResourceLimitExceeded`. Honor the configured
   depth throughout extension preservation, including document/thread/comment/selector
   extensions, and test below/at/above the configured limit. ReadLimits currently
   accepts positive depths through 256, so silently imposing 64 later is inconsistent.

## Confirmed working

- **Dependency boundary:** Reader's only package dependencies are Markdig and
  SharpZipLib; Reviews references Reader. Project references, restored assets,
  assembly references and reflected types show no CLI/Core/System.CommandLine,
  Git process or package writer dependency in the two libraries. Shared format
  serialization and reader-side ledger interpretation are present as intended.
- **Actual external consumers:** both the shipped isolated consumer verifier and a
  new Reviews-only PackageReference project restored from freshly packed artifacts.
  Assets contain package references only. Dependencies are exactly Mdpkg.Reviews,
  Mdpkg.Reader, Markdig and SharpZipLib. The exact C# snippet extracted from the
  *packed* Reviews README compiled with 0 warnings/errors and resolved both fixture
  comments as TargetIntact with Git absent from PATH. Reader-only restore does not
  include Reviews. Full-required without a provider returns VerificationUnavailable.
- **Schema:** v1 retains Unspecified/LegacyV1; v2 missing kind and duplicate keys
  are rejected. Independent mutations of comments-document version and selector
  profile return UnsupportedVersionOrProfile. Tests exercise duplicate IDs,
  malformed selectors, self/dangling/cross-thread/cyclic replies and source order.
- **Resolution:** independent false-quote and out-of-bounds selector probes return
  Invalidated for both exact and newer targets. A missing root stays Unconfirmed
  against both targets despite matching text. Valid exact and changed fixtures
  return Survives/TargetIntact and FlaggedChanged/TargetRelocated respectively.
  Code and passing tests preserve dead/successor navigation, constrain relocation
  to the live scope and refuse context ties without using occurrence as a fallback.
- **Bounded reading:** extraction indexes metadata and decodes selected manifest,
  history/reference and comments entries; it neither extracts filesystem paths nor
  loads every ZIP payload. Size/count/aggregate budgets, CRC/DEFLATE completion,
  non-seekable private spooling, stream ownership and cleanup tests pass. Token checks
  occur in decompression and JSON scans/validation. Full verification remains an
  explicit provider contract; structural success does not claim Git/lineage checks.
- **Docs:** spec §§4/6.8 and the JSON schema describe v2 authored kinds, UTF-16
  half-open offsets, surrogate restrictions and reply rules. Packed READMEs state
  the dependency, assurance and resource boundaries. The configurable-depth defect
  above is the observed mismatch with the resource API.

## Execution evidence and reproduction

- Windows Release suite: 912 passed, 0 failed, 0 skipped; Release build: 0 warnings,
  0 errors. This includes 815 CLI, 17 Reader and 80 Reviews tests.
- Linux Release suite in the local official .NET 10 SDK container: 912 passed,
  0 failed, 0 skipped, using a read-only source mount copied to native container storage.
- Fresh package-consumer verifier: 2 passed, 0 failed. Additional exact packed-README
  consumer: compiled and ran successfully without Git on PATH.
- JavaScript/Python UTF-16/root/digest/locator/v1-v2 vector verifier passed.

Reproduction files are in
`C:\src\markdown-package\.antiphon\review-981be5db\`:
`mutate.py`, `Probe.csproj`, `Program.cs`, `NuGet.Config`, `results.txt` and rebuilt
fixtures. The probe catches exceptions only to print review evidence; it does not
modify the library or turn an exception into a library result.

```powershell
Set-Location C:\src\markdown-package\.antiphon\review-981be5db
python mutate.py
dotnet restore Probe.csproj --configfile NuGet.Config --packages packages
dotnet run --no-restore --project Probe.csproj -- fixtures C:/src/markdown-package/docs/spec/review-fixtures
```

`null-comments.mdpkg` demonstrates the exception;
`depth-raised.mdpkg` is run with MaxJsonDepth 128;
`depth-default.mdpkg` demonstrates correct default-limit rejection. Mutation packages
retain the original Git pack: these probes exercise the deliberately structural
extraction path, with valid ZIP metadata/payload checks, and do not claim deep lineage.

Next: fix the two parser defects, add public-API regressions, rerun the suites and
request targeted verification. No commit or push was made by this review.
