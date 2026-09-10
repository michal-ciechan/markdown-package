# CARD-0033: rejected-history result mapping fix

Fixed the null-history regression reported by review task `0a051588` against
`b376d66`. Malformed but parseable history returns `Nonconforming` through Core's
file/stream APIs and exit 3 with diagnostic JSON through the CLI.

## Change

`PackageResult` was dereferencing null transformation, patch and addressing-coverage
records after the internal validator had already rejected their history. The mapper
now omits null entries from the five history collections while preserving the parsed
scalars, non-null records, immutable collection ownership, outcome, checks and diagnostics.
Null strings in `ranges` and `shallowBoundaries` are omitted too; they previously
escaped into nominally non-null public collections.

`HistoryMetadata.DeclaredRangeCount` and `DeclaredPatchCount` retain the original
array lengths, including omitted nulls. The CLI uses those counts in its existing
summary, preserving the parent's report exactly (for example, rejected `patches:
[null]` still reports `history.patches: 1`). No placeholder record is invented, and
omitting unavailable metadata does not turn rejection into success.

Production changes are confined to `Mdpkg.Core/Contracts.cs` and the history-count
mapping in `Mdpkg.Cli/Commands/EngineAction.cs`. Validation rules, creation behavior,
Reader/Reviews, resource policies and packaging are unchanged.

## Regression coverage

Added 72 cases: 36 public Core cases and 36 CLI cases. The shared fixture helper
uses ordinary ZIP APIs to make CRC-correct mutations of the independent committed
`docs/spec/review-fixtures/original.mdpkg`; it does not call the Core producer.

The matrix covers transformations, patches, addressing coverage, ranges, shallow
boundaries and all five together; null-only arrays and nulls before/after a retained
record; and full/deep validation. Every Core case exercises both `ValidateFileAsync`
and `ValidateAsync(Stream)`, checking typed rejection, original diagnostics/checks,
retained metadata, null omission, immutable results, input ownership and unchanged
package bytes. CLI cases verify exit 3, JSON field shape, declared counts, exact
diagnostic text/spec/severity, skipped deep checks, and report-file/stdout equality.

Before the fix, the 36 new Core cases failed: transformation/patch/coverage cases
reproduced the null dereference, and string-list cases exposed retained nulls.
After the fix, all 72 new cases pass in the full suites.

## Acceptance

- Windows: 1,063 passed, zero failed/skipped.
- Linux: 1,063 passed, zero failed/skipped; eight-project Release build had zero
  warnings/errors. Linux used `mcr.microsoft.com/dotnet/sdk:10.0`, SDK 10.0.401 and
  Git 2.43.0, with a read-only source mount copied to native container storage.
- The review's public API probe now returns `Nonconforming` for all three crash
  fixtures. Its unrelated depth probes retain their previous outcomes.
- The review's comparison script retains 28/28 exact matches for the 14 committed
  package fixtures in full/deep modes.
- Direct parent/fixed comparisons of transformations `[null]` and patches `[null]`
  match exit code, entire stdout JSON and stderr exactly in both full and deep modes:
  4/4 comparisons. Reports match stdout. Null addressing coverage, which already
  crashed before extraction, now returns exit 3 and `MDPK2007` in both modes.

The parent is the retained detached `b907bc9` checkout under
`.antiphon/review-0a051588/baseline`. The exact reviewer commands were rerun:

```powershell
dotnet run --project .antiphon/review-0a051588/Probe.csproj
python .antiphon/review-0a051588/parity.py
```

Additional full/deep/report comparison evidence is saved in
`.antiphon/task-9f046a70-parity.json`; full suite logs are
`.antiphon/task-9f046a70-windows.log` and `.antiphon/task-9f046a70-linux.log`.

Rerun the committed tests from `src/generator-cli`:

```powershell
dotnet test --project tests/Mdpkg.Core.Tests -c Release --filter-class Mdpkg.ApiTests.MalformedHistoryTests
dotnet test --project tests/Mdpkg.Cli.Tests -c Release --filter-class Mdpkg.Cli.Tests.MalformedHistoryTests
dotnet test -c Release
```

Next: review the null-safe projection, declared-count preservation and regression
evidence. No additional implementation or release scope was included.
