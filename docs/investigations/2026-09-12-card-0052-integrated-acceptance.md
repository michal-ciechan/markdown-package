# CARD-0052 S6: integrated draft-2 acceptance

Date: 2026-09-12. Completes the integration/documentation slice of the
[approved plan](../superpowers/plans/2026-09-12-card-0052-deferred-history-breaking-spec-plan.md).
The source candidate is `0.1.0-preview.3`; this work does not publish NuGet packages
or activate CARD-0050's managed Git backend.

## Fresh pipeline and verification boundaries

[`prove-deferred-history.py`](../../src/generator-cli/tests/prove-deferred-history.py)
creates fresh CLI packages in both modes, rather than starting with committed
browser fixtures. Its native and browser phases can run separately on a shared
artifact directory. The acceptance run used Windows CLI/.NET and Linux Chromium:

1. CLI packs `guide.md` plus an unselected `hidden.txt`, once with default snapshot
   output and once with explicit Git output, and validates each.
2. The real browser opens each file, selects `target words`, authors a change
   request and downloads a fresh snapshot review. The browser reopens and fully
   verifies each export and records its actual manifest, comment IDs and target.
3. CLI and Core validate those exact downloaded files. Reviews reaches Full with
   all required checks, independently agrees with the browser/Core artifact state
   hash, and resolves the original selector against the exact CLI source. The
   typed target, authored body and UUID remain unchanged.
4. CLI materializes the original S0 into deterministic C0, appends C1, and also
   appends directly from S0. Direct and staged updates produce the same C1 state.
   Core's verified origin reconstructs the exact reviewed S0. Reviews obtains the
   same original range through supplied S0 and origin reconstruction, resolves the
   review onto C0, refuses implicit selection of C1 while retaining feedback, and
   resolves its surviving quote when C1 is explicitly selected.
5. A modified browser comments payload is repackaged with repaired ZIP CRCs but
   its original state claim. CLI full/deep validation rejects it with exit 3.

The two actual browser cases passed. The public-API acceptance consumer passed
**24 assertions**, in addition to the driver's CLI result/hash and negative checks.
No new product verification bypass was found by this integration pass.

The regular Reviews suite retains the single-schema mode matrix: snapshot and
Git delta artifacts each target snapshot and commit state; bundled Git reviews
target both kinds. It covers missing/forged origins, incomplete provider checks,
wrong contexts, selector failure and preserved feedback. Browser snapshot tests
cover opening/review/export/reload against both original modes; historical/origin
verification remains an explicit browser capability boundary.

## Generated artifacts and release documentation

- Corrected `tests/generate-links.mjs`: it previously regenerated an obsolete
  string-valued `current` even though the checked-in JSON had been corrected.
  A Node drift test now compares regenerated output to the shared typed fixture.
- Regenerated worked examples, deferred-history vectors and review fixtures.
  Active tracked package fixtures are already on the revised schema: **27 archives,
  zero old-manifest positive archives**. Historical investigation evidence remains
  historical; malformed string-current cases remain rejection tests.
- Added actual, reproducible CLI JSON projections for default packing, explicit
  Git packing and materialization. `generate-cli-examples.py --check` rejects drift.
  The guide snapshot and C0 IDs match the independent S1 vectors exactly.
- Updated root/CLI/Core/Reader/Reviews/browser/example READMEs, CLI help, public XML
  summaries and the CLI reference. Default snapshot validation does not require
  Git; committed updates/materialization are implemented. Obsolete unconditional
  Git and string-current descriptions were removed from the active tool examples.
- Added [one breaking release note](../releases/draft-2.md), with the unchanged `/1`
  token, coordinated typed contracts, fresh browser storage domain and remaining
  capability limits. Preview.2 publication is clearly historical, not evidence for
  draft 2. The example consumer now prints both typed identities explicitly.
- Release inspection checks breaking-draft README content and exact agreement with
  source, typed Reader XML documentation, dependency boundaries and symbols. The
  installed global-tool proof now checks default and explicit Git modes plus
  materialization. Core's installed consumer asserts the history-free default.
- The actual browser export dependency graph is now a Node regression gate: zero
  Git, Buffer or external imports. The build remained **94,708 / 145,000 eager gzip
  bytes**. Pages CI runs the fresh integrated pipeline; .NET CI checks generated
  CLI output and the independent positive/negative fixtures.

## Four-shape mode measurements

The opt-in [`HistoryModeBenchmarks`](../../src/generator-cli/tests/Mdpkg.Core.Tests/HistoryModeBenchmarks.cs)
uses the exact CARD-0050 corpus generation: tiny is one file with 64 repeated
paragraphs; many-small is 20 such files; large is two files with 16,384 numbered
lines each; similar is 20 files with 2,048 common numbered lines and distinct final
lines. Both modes use the same normalized files and namespace. Explicit Git output
uses the existing native release backend, not the managed candidate.

[All raw samples](deferred-history/s6-mode-measurements.json) are committed.
Each OS/mode/shape records one first sample and three warm samples: **64 creations
and 64 separate full/deep validations**. Creation includes staging, writing and
post-write verification. Snapshot validation checks all current-file hashes; Git
Deep validation additionally proves repository integrity and exact current tree.

Package sizes agreed on Windows and Linux:

| Shape | Snapshot bytes | Explicit Git bytes | Size reduction |
| --- | ---: | ---: | ---: |
| tiny | 610 | 3,208 | 81.0% |
| many-small | 3,224 | 7,462 | 56.8% |
| large | 243,464 | 398,997 | 39.0% |
| similar | 299,794 | 319,078 | 6.0% |

Warm median times, milliseconds:

| OS | Shape | Snapshot creation / full validation | Git creation / deep validation |
| --- | --- | ---: | ---: |
| Windows | tiny | 29.69 / 1.64 | 2732.00 / 1450.68 |
| Windows | many-small | 50.50 / 9.39 | 11313.78 / 7939.37 |
| Windows | large | 544.52 / 246.23 | 8683.47 / 4403.11 |
| Windows | similar | 1043.80 / 352.72 | 20683.15 / 14655.27 |
| Linux | tiny | 65.44 / 1.57 | 180.95 / 72.92 |
| Linux | many-small | 122.42 / 51.91 | 670.15 / 422.74 |
| Linux | large | 1360.17 / 347.85 | 1432.87 / 680.68 |
| Linux | similar | 516.18 / 296.84 | 1355.79 / 697.46 |

These are **exploratory samples on a shared host**, including container/other
validation activity, without process or cache isolation. The first sample is not
a controlled cold run; three warm samples do not establish p95 or a performance
regression threshold. The especially noisy Windows/native samples must not be
turned into a production speedup promise. No RSS, process-tree peak memory or
cumulative temporary-I/O benefit is claimed. This is not completion of CARD-0050's
separate isolated performance/activation gate.

## Git absence and bounded reads

Every measured snapshot creation and validation used an invalid Git executable
plus an internal process-start counter: **zero calls**, and its archive contained
**zero Git payload bytes**, for every sample/shape/OS. Native Git creation calls
were 12/69/15/69 for tiny/many-small/large/similar; separate deep-validation calls
were 6/44/8/44. Installed absent-PATH and positively tested logging-poison Git
proofs separately establish that the installed default path does not launch Git.

Seekable selective Reader opening plus one document read consumed the following
source bytes, including repeated metadata reads. These are read totals, not
unique bytes or memory measurements:

| Shape | Snapshot bytes read | Git bytes read | Pack payload bytes read, both modes |
| --- | ---: | ---: | ---: |
| tiny | 693 | 1,814 | 0 |
| many-small | 2,461 | 3,582 | 0 |
| large | 122,144 | 123,264 | 0 |
| similar | 17,290 | 18,412 | 0 |

Git-mode opening reads the branch-reference payload (40–41 compressed bytes);
it does not read the pack. Snapshot opening reads no Git bytes. The harness
rejects a one-byte per-entry budget in both modes and a manifest-plus-one-byte
aggregate full-hash budget in snapshot mode on every shape/OS. Failed verification
leaves assurance Declared. The full regression suites also cover cancellation,
unselected-file tampering, bounded spooling and failed-output preservation.

## Validation and rerun commands

All required final runs passed with **zero unexpected failures**:

| Run | Result |
| --- | --- |
| Windows Release .NET solution | 1,448 passed, 0 failed, 0 skipped |
| Linux Release .NET solution | 1,448 passed, 0 failed, 0 skipped |
| Node | 193 passed, 0 failed |
| Linux Playwright matrix | 189 passed: Chromium 107, Firefox 41, WebKit 41 |
| Fresh integrated pipeline | 2 browser cases and 24 public-API assertions passed; CLI stages and repaired-CRC rejection passed |
| Independent fixture verification | 20 accepted, 5 expected rejections, 748 checks; 0 unexpected failures |
| Operation fixtures | 6 isolated negatives, 36 operation inputs, 176 assertions passed |
| Independent JavaScript state/tree/commit/origin vectors | 94 assertions passed; Unicode cross-language checks passed |
| Generated CLI examples, each OS | 3 examples matched actual output |
| Installed global tool, each OS | Both modes, full/deep validation and materialization passed |
| Isolated public library gate, each OS | 2 consumers passed |
| External consumer gate, each OS | 3 consumers, 2 Core README examples and installed append smoke passed |
| Installed default snapshot proof, each OS | 26 assertions passed with absent/poison Git; 0 eligible-path calls |
| Installed private managed-Git candidate, each OS | 12 assertions passed; activation policy unchanged |
| Final release inspection, each OS | 4 package manifests and Core symbols verified; 5 checksums; packaged READMEs matched source |

Benchmark compilation and the new release check's tool-README path were corrected
before their final passing runs. No product regression or intermittent suite
failure occurred in the final runs.

From `src/generator-cli` on Windows or Linux:

```powershell
dotnet test -c Release --no-progress --output Normal
dotnet pack src/Mdpkg.Reader -c Release -o artifacts/package
dotnet pack src/Mdpkg.Core -c Release -o artifacts/package
dotnet pack src/Mdpkg.Reviews -c Release -o artifacts/package
dotnet pack src/Mdpkg.Cli -c Release -o artifacts/package
python tests/inspect-release.py artifacts/package
python tests/prove-tool.py --local-feed artifacts/package
python tests/prove-libraries.py --local-feed artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --history-free --local-feed artifacts/package
python ../../docs/spec/generate-cli-examples.py --check
```

From `src/web-viewer`: `npm ci`, `npm test`, and `npm run test:browser`, with the
pinned Playwright runtimes installed. From the repository root:

```powershell
python src/generator-cli/tests/prove-deferred-history.py --work .antiphon/integrated-acceptance
python docs/spec/worked-example.py .antiphon/worked-example
python docs/spec/deferred-history.py
python docs/spec/review-fixtures/generate.py
python docs/spec/verify-fixtures.py
python docs/spec/verify-operation-fixtures.py
node docs/spec/verify-deferred-history.mjs
node docs/spec/review-fixtures/verify-unicode.mjs
```

Benchmark opt-in from `src/generator-cli` (Linux uses `export` instead):

```powershell
$env:MDPKG_HISTORY_MODE_BENCHMARK = 'C:\temp\history-modes.json'
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-class '*HistoryModeBenchmarks' --no-progress --output Normal
Remove-Item Env:MDPKG_HISTORY_MODE_BENCHMARK
```

The managed Git candidate stays private: build with
`-p:MdpkgManagedSnapshotCandidate=true` into a separate artifacts/feed directory,
then run `tests/prove-managed-snapshot.py --local-feed <candidate-feed>` without
`--history-free`. Never publish that candidate feed as the release backend.
