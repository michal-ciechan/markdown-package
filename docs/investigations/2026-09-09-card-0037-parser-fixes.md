# CARD-0037 parser review fixes

Task 829ca895 addresses the two defects recorded by review 981be5db against
`81d2d30`. Production changes are confined to `Mdpkg.Reviews/ReviewParser.cs`.

- The comments document must have a JSON object root. Null, array and scalar roots
  now return `Malformed`, `SchemaStatus.Malformed`, no feedback and the diagnostic
  `MalformedReview: Comments document root must be a JSON object.` The explicit
  guard avoids catching unrelated null-reference programming errors.
- Extension copying uses one serializer-options instance per document, with
  `MaxDepth` taken from the caller's `ReadLimits.MaxJsonDepth`. Document, thread,
  comment and selector extensions all use it. The existing whole-document depth
  check still rejects over-limit input as `ResourceLimitExceeded` before copying.

## Regression and acceptance evidence

`tests/Mdpkg.Reviews.Tests/ParserRegressionTests.cs` adds 46 public-API cases:
six non-object root values, plus 40 extension cases covering all four locations,
depth 70 with cap 128, and below/at/above caps 32, 128 and 256. Accepted results
preserve both comment bodies in order and the extension's deepest leaf. Rejections
return no threads or items.

Before the fix, the Reviews suite had 100 passes and 26 failures: the null-root
exception, five inconsistent root diagnostics and 20 rejected in-limit extensions.
After the fix:

| Environment | Full Release suite | Failures | Skipped |
| --- | ---: | ---: | ---: |
| Windows, .NET SDK 10.0.300 | 958 passed | 0 | 0 |
| Linux SDK container, .NET SDK 10.0.401 / Git 2.43.0 | 958 passed | 0 | 0 |

Each full run includes 815 CLI, 17 Reader and 126 Reviews tests. Linux used the
official `mcr.microsoft.com/dotnet/sdk:10.0` image, a read-only Windows source mount
and a copy to native container storage.

The Reviews preview package packed successfully. The reviewer's original probe and
three defect fixtures were copied to `.antiphon/task-829ca895-probe/`, restored from
the local feed into a fresh package cache, and run against that package:

- `null-comments.mdpkg`: `Malformed/Conforming/Malformed/Structural`, zero items,
  explicit object-root diagnostic; no exception.
- `depth-raised.mdpkg`: `Success/Conforming/Valid/Structural`, two items, no diagnostics.
- `depth-default.mdpkg`: `ResourceLimitExceeded`, zero items, nesting-limit diagnostic.

Rerun from the repository root:

```powershell
Set-Location src/generator-cli
dotnet test -c Release
dotnet pack src/Mdpkg.Reviews -c Release --no-build -o artifacts/package
```

No selector, identity, ZIP, provider, dependency or wire-schema behavior was changed.
The two outstanding historical review reports are committed unchanged alongside this
fix. The machine-generated Antiphon `CLAUDE.md` remains local, excluded through
`.git/info/exclude`; it was neither deleted nor added as repository instructions.

Next: targeted review of the explicit root guard, consistent depth propagation and
public-API regression matrix. The original review report remains a historical record
of the defects at `81d2d30`, not the verdict on these fixes.
