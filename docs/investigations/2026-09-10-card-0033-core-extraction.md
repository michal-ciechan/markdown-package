# CARD-0033: Mdpkg.Core S0-S4 extraction

Implemented the engine extraction, public creation/validation API, ownership split,
documentation and local package acceptance. S5 remains CARD-0039; no publishing,
account configuration, release tags, shared version source, LICENSE or CHANGELOG
foundation was added.

## Reconciliation and scope

Implementation started from `b907bc9` on master. The full current CARD-0033 description
(2026-09-10 scope update) explicitly authorizes S0-S4 before CARD-0036. CARD-0035 and
CARD-0037 were confirmed Done through the board; CARD-0036 was Backlog. This supersedes
the plan's older all-three-prerequisites requirement for local extraction only.

The existing Windows baseline was 958 tests: 958 passed, zero failed/skipped. MIT,
NuGet.org-only distribution, coordinated SemVer and the gated release workflow remain
the recorded release decisions. No package-id availability or public-feed publication
claim is made by this work. The existing local library version `0.1.0-preview.1` and
tool version `0.1.0-scaffold` are retained pending the release cards.

## Delivered slices

| Slice | Outcome |
| --- | --- |
| S0 | Reconciled current card, checkout, prerequisite states, release boundary and test baseline. |
| S1 | Eight projects; `CLI -> Core -> Reader`, `Reviews -> Reader`. All former CLI engine files moved to Core internals. Reader grants Core/Core.Tests friendship and removes mdpkg/Cli.Tests friendship. CLI calls public contracts only. |
| S2 | Directory and in-memory snapshots, file and stream validation/output, explicit metadata, typed correspondence, immutable owned results, cancellation, resource profiles and actionable typed failures. |
| S3 | Tests moved by owner, all original regression assertions retained; independent CommonMark fixture moved once to Reader.Tests. CLI/API parity and new resource/ownership/failure tests added. README examples compile and run from packages. |
| S4 | Reader/Core/Reviews/tool packed locally; exact Reader dependency, metadata, XML docs, portable symbols, Unicode notice and tool runtime contents inspected. Isolated consumers and installed-tool pack/deep-validation smoke execute on Windows and Linux. |

The engine keeps snapshot defaults (mdpkg identity, 2000-01-01 UTC, Initial package),
source normalization and path rules, native Git isolation/cancellation, legacy commit
bytes, projection/depth, sparse correspondence, random reserved births, numeric
compression, ZIP32 layout, warning/completeness gates and deep self-validation before
atomic file replacement. Update/address remain exit-70 stubs.

CLI owns correspondence-file I/O, report alias guards/rechecks, report JSON mapping,
terminal output and exit codes. Core owns all creation/full/deep orchestration; Reader
structural opening has not replaced full validation. Reviews schema validation remains
separate. The Core package pins the actual coordinated Reader project version through
an inspected exact NuGet constraint, currently `[0.1.0-preview.1]`.

## API and resource decisions

`PackageBuilder` and `PackageValidator` are sealed services with constructor Git/temp
settings. Public requests/results contain no internal Reader models, JsonObject/JsonArray,
parser ASTs or process objects. Results use typed status/severity/check enums, Reader
identity/locator/profile types, read-only copied collections and an independently owned
immutable JsonElement for an optional review declaration. Invalid arguments throw,
cancellation propagates, and expected environment/resource failures return typed results.

`CorrespondenceCodec` translates the original JSON grammar into confirmed moves,
confirmed retirements and unknown evidence; it does not read files. Requests copy
collection structure (including locator trails). Caller content buffers remain borrowed
until completion. Coverage is calculated from actual records and retained history.

Public resource defaults reuse Reader service limits, with explicit source/spool caps.
CLI chooses the historical producer compatibility profile, verified with a document
larger than Reader's 16 MiB service default. Validation indexes the archive and reads
bounded members through Reader, checks all CRCs and cumulative declared decoded sizes,
and retains current-view data needed for inventory validation. It does not eagerly
materialize the complete archive, but does not promise constant memory. JSON depth is
propagated into parsing; existing Reader internal method overloads remain available
for previously compiled friend assemblies.

Stream input is privately spooled from its current position, even when seekable, for a
single ownership and limit policy. Input/output stay open. Output must be initially
empty where measurable. Creation deep-validates privately before copy; a failed or
cancelled final copy can leave a prefix and never reports success. Private spools and
file staging are cleaned on failures/cancellation. Limits bound source staging, archive
copies, ZIP emission and Git output/staging operations; native Git object generation
and simultaneously live workspaces consume additional resources. These are not
whole-process memory/disk quotas.

## Verification

- Windows and Linux: 991 tests passed, zero failures or skips; 33 additional cases over
  the 958-test baseline. All original tests remain represented after the ownership move.
- Release builds: eight projects, zero warnings/errors.
- Four local NuGet packages plus Core portable symbols produced. Core has exactly
  one NuGet dependency, Reader at `[0.1.0-preview.1]`; the tool carries Core, Reader,
  Markdig, SharpZipLib and System.CommandLine runtime assemblies. Reader and the bundled
  tool retain the Unicode notice; Core includes a packed README, XML API documentation,
  repository metadata and portable symbols with embedded sources.
- Three fresh package-reference consumers execute: Reader-only and Reviews-only with
  Git removed from PATH; Core-only with Git, with no CLI/Reviews/System.CommandLine
  dependencies. Both Core README examples compile and run. Full-required Reviews
  extraction without a provider still rejects as expected.
- A separately installed local-feed tool executes pack and deep validate.
- The independent JavaScript/Python Unicode, UTF-16 selector, root, digest and locator
  vector probe passes.

Linux acceptance uses `mcr.microsoft.com/dotnet/sdk:10.0` (SDK 10.0.401, Git 2.43.0),
a read-only Windows source mount and a copy to native container storage. These are
local Linux results, not a claim about a completed hosted GitHub Actions run. Ordinary
CI now packs Core and runs the expanded isolated-consumer/installed-tool gate while
retaining Windows/Linux testing and the Unicode probe. Pages is unchanged.

The package verifier initially exposed Windows case-insensitive glob overlap and
different NuGet manifest XML namespaces; both verifier defects were fixed. They were
not package runtime failures. Final acceptance uses the corrected verifier.

Rerun from `src/generator-cli`:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
dotnet pack src/Mdpkg.Reader --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Core --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Reviews --no-build -c Release -o artifacts/package
dotnet pack src/Mdpkg.Cli --no-build -c Release -o artifacts/package
python tests/verify-consumers.py
node ../../docs/spec/review-fixtures/verify-unicode.mjs
```

Use a feed with one version of each local package. The verifier checks this, uses
fresh package caches and source mapping, and never publishes. Local artifacts are
under `src/generator-cli/artifacts/package/` and are intentionally ignored by Git.

Next: review the extraction/public API/resource behavior and CLI parity before closing
CARD-0033. Public release integration and compatible Reader publication remain CARD-0039,
after CARD-0036's foundation and owner account/policy setup.
