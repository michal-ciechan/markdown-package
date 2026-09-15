# Stable 1.0.0 preparation and ordinary verification — c40cf169

**1.0.0 is prepared and locally verified. Publication is pending Review and
caller landing.** The governing Code-stage contract prohibits this stage from
landing or deploying; it requires ordinary read-only Review first. No direct
NuGet push, master update or workflow dispatch was performed.

Follow-up Code task: `c40cf169`. Original Code task / landing owner: `9474e409`.
Branch: `feat/task-9474e409-mdpkg-tool`.
Exact worktree: `C:\src\markdown-package`. Restart: **none**.
Starting commit: `5aa6d85ec38588f0f317495d1feb5ecee18d6466`.
All builds/packages/ordinary tests verified
`427ad4871808e35d2549da693908b7604d81a878`; the subsequent commit records evidence
only. Plan: [stable release verification design](../superpowers/plans/2026-09-14-mdpkg-stable-1.0.0.md).

## Changes and findings

- Bumped the one shared version in `src/generator-cli/Mdpkg.Pack.props` from
  `0.1.0-preview.3` to **1.0.0**. Reader/Core/tool are the publish scope; Reviews
  shares the build version and remains local-only.
- Updated root/CLI/library READMEs, CLI reference, specification status and release
  docs for the first stable version, stable install/update commands, and the
  breaking typed format with no backward compatibility for older previews.
- Corrected the standalone review consumer's two hard-coded preview references
  to 1.0.0 and renamed its `local-preview` source label to `local`.
- Confirmed `publish-nuget.yml` is byte-for-byte unchanged. Its version parser
  accepts 1.0.0, no `--prerelease` option is used, the exact publish list is
  Reader/Core/tool, and public proofs consume the exact shared version. Existing
  `--skip-duplicate` cannot replace an old published version's bytes; the new
  version resolves that release problem without changing workflow policy.
- No production `.cs` files, test assertions, retries or timeouts changed.

The original [run 34718037115](https://github.com/michal-ciechan/markdown-package/actions/runs/34718037115)
at master SHA `3a6637f18590a553439f53efaccf57a93e6dbe05` has successful Windows/Linux
verification and `publish`, but **both public proof jobs failed**. This is an
older preview run, not a 1.0.0 publication result. Its job states are retained in
`prior-publish-run.json`.

## Ordinary results

Every command completed in the foreground. Eight solution projects were built
once into producer-owned isolated outputs; packing used `--no-build`. Independent
package consumers compiled their own temporary projects. The recorded checks
passed, but V-4 missed stale release wording as corrected below.

| ID | Actual outcome | Evidence under `.antiphon/task-c40cf169/` |
| --- | --- | --- |
| V-1 | Eight-project Release build; 0 warnings/errors; 11.18 seconds. | `build.log`, `verified-commit.txt` |
| V-2 | Four manifests at 1.0.0, Core symbols, exact Core→Reader `[1.0.0]`, notices, packaged READMEs and source SHA verified; five checksums written. | `pack.log`, `inspect-release.log`, `feed/SHA256SUMS` |
| V-3 | Global local-feed install and eight subsequent commands passed; typed manifest, real Markdown, snapshot/Git validation and materialization verified. Three resulting archives are byte-for-byte identical to prior task 9474e409 output. | `tool-proof.log`, `tool-proof/proof.json`, `package-docs-audit.json` |
| V-4 | Eight active install/release docs, their prose links, shared/example versions, workflow version parsing and exact publish list checked; diff clean. The initial audit missed two current-state preview claims in the Reviews README, found by Review 204e2409 as F1. Follow-up c7a1ff79 corrects them: Reviews shares stable 1.0.0 but is deliberately excluded from the workflow's Reader/Core/mdpkg NuGet publish list and requires a local feed. | `evidence-audit.log`, `package-docs-audit.json`, `diff-check.log`; correction evidence under `.antiphon/task-c7a1ff79/` |
| R-1 | 57 unit cases passed; 0 failures/skips. | Shared `ordinary.trx`, `tests.log`, `trx-summary.json` |
| R-2 | 24 affected integration cases passed; 0 failures/skips. | Same command/TRX as R-1 |
| R-3 | Default local global-tool verifier invocation passed without evidence option. | `tool-default.log` |
| R-4 | Two independent exact-version Reader/Core consumers restored, built, and created/fully validated/read without Git; 0 failures. | `libraries.log` |
| R-5 | Four package inspections, three external consumers, both Core README examples, origin/native integration and installed-tool pack/materialize/append/deep-validate smoke passed; 0 failures. | `consumers.log` |

R-1/R-2 used one direct xUnit run selecting precisely these fully qualified
`-class` filters, with `-preEnumerateTheories` and `-result-trx`. All **32 intended
methods** appeared in a fresh TRX after the recorded start time, expanded to
**81 cases**. No unintended classes, missing methods, zero-count selections,
failures or skips were present. Runner time: 9.016 seconds.

| Filter | Expanded passed cases |
| --- | ---: |
| `Mdpkg.Cli.Tests.HelpTests` | 8 |
| `Mdpkg.Cli.Tests.OptionValidationTests` | 46 |
| `Mdpkg.Cli.Tests.SpecConsistencyTests` | 3 |
| `Mdpkg.Cli.Tests.HistoryModeTests` | 9 |
| `Mdpkg.Cli.Tests.ProducerTests` | 3 |
| `Mdpkg.Cli.Tests.ApiParityTests` | 4 |
| `Mdpkg.Cli.Tests.UpdateTests` | 8 |

No namespace/full-assembly run or deliberate mutant was used. Full per-method
counts, exact filters, provenance and checksum validation are retained in the
JSON evidence and `audit-evidence.py`. All eight `bin-c40cf169` output directories
were removed using `dotnet clean` followed by nonrecursive cleanup of the known
runner DLLs and empty directories. Ignored intermediate/publish data stays inside
the evidence root; no daemon output was touched.

## Artifacts and rerun commands

Evidence root: `C:\src\markdown-package\.antiphon\task-c40cf169\`.
Verified feed: `C:\src\markdown-package\.antiphon\task-c40cf169\feed\`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `mdpkg.1.0.0.nupkg` | 757614 | `a00ae07bd956b4fe319e985cde8fd34eb260caa265bc140781d9cd3812ae67d3` |
| `Mdpkg.Core.1.0.0.nupkg` | 108314 | `531e6666f10e6439380a81a0f5cd3fa0f473992434b41e5e80855358731cbaa7` |
| `Mdpkg.Reader.1.0.0.nupkg` | 80569 | `272c515eb5820504fc728c4ab25ed5f0c63f6b010490ce30d050deb218002176` |
| `Mdpkg.Reviews.1.0.0.nupkg` (local only) | 50835 | `6f26d8276930ddfb53a928c46a4d04d0de480d43078c164cd83420b976493ee3` |
| `Mdpkg.Core.1.0.0.snupkg` | 86812 | `d4203a7c8e58e0dbec42089a8e92d02aab709d8803234f043f918f6b155b1827` |

From `C:\src\markdown-package`, use a fresh evidence directory when rerunning:

```powershell
dotnet build src/generator-cli/Mdpkg.slnx -c Release --property:OutputPath=bin-c40cf169/ --artifacts-path C:/src/markdown-package/.antiphon/task-c40cf169/build
# Repeat for Mdpkg.Reader, Mdpkg.Core, Mdpkg.Reviews and Mdpkg.Cli:
dotnet pack src/generator-cli/src/Mdpkg.Cli/Mdpkg.Cli.csproj --no-build -c Release --property:OutputPath=bin-c40cf169/ --artifacts-path C:/src/markdown-package/.antiphon/task-c40cf169/build -o C:/src/markdown-package/.antiphon/task-c40cf169/feed
python src/generator-cli/tests/inspect-release.py .antiphon/task-c40cf169/feed --commit (git rev-parse HEAD)
dotnet src/generator-cli/tests/Mdpkg.Cli.Tests/bin-c40cf169/Mdpkg.Cli.Tests.dll -class Mdpkg.Cli.Tests.HelpTests -class Mdpkg.Cli.Tests.OptionValidationTests -class Mdpkg.Cli.Tests.SpecConsistencyTests -class Mdpkg.Cli.Tests.HistoryModeTests -class Mdpkg.Cli.Tests.ProducerTests -class Mdpkg.Cli.Tests.ApiParityTests -class Mdpkg.Cli.Tests.UpdateTests -preEnumerateTheories -noColor -result-trx C:/src/markdown-package/.antiphon/task-c40cf169/ordinary.trx
python src/generator-cli/tests/prove-tool.py --local-feed .antiphon/task-c40cf169/feed --evidence-dir .antiphon/task-c40cf169/tool-proof
python src/generator-cli/tests/prove-tool.py --local-feed .antiphon/task-c40cf169/feed
python src/generator-cli/tests/prove-libraries.py --local-feed .antiphon/task-c40cf169/feed
python src/generator-cli/tests/verify-consumers.py --local-feed .antiphon/task-c40cf169/feed
```

## Publication and Mutation handoff

At `2026-09-14T22:02:41Z`, the NuGet v3 indexes for mdpkg/Core/Reader contained
only previews through `0.1.0-preview.3`; **1.0.0 was absent**. See
`public-versions-before-landing.json`. The verified source commit has **no**
`publish-nuget` run (`runs-for-verified-commit.json` is an empty array); master
remains `3a6637f18590a553439f53efaccf57a93e6dbe05`. No green 1.0.0 public proof is
claimed. These remote reads do not publish anything.

Next is ordinary read-only **Review**. The caller then lands original Code task
`9474e409`, including this follow-up `c40cf169`. The existing master-push workflow
performs OIDC publication. Record the actual landed SHA/run URL and require
`publish`, `prove-nuget-org (tool)` and `prove-nuget-org (libraries)` all green.
There is no need to guess at a manual dispatch or supply a persistent API key.

**Zero PC-n rows/variants** are specified; none executed. The caller must record
the companion verification obligation and explicitly commission post-land
SourceLanding Mutation, including missing-control discovery for version drift
and packaging. Remaining coverage gaps: local runs are Windows only; Linux and
public-feed acceptance await CI. The optional evidence failure-path controls
noted by the original Code task remain untested here.

Restart: **none**. Original landing owner: **9474e409**.

## F1 documentation correction and ordinary verification — c7a1ff79

Review `204e2409` correctly found two stale current-state release claims in the
packaged Reviews README. The README now contains no "preview" wording and states
that Reviews shares coordinated stable **1.0.0** with Reader/Core/mdpkg, but is
deliberately excluded from the workflow's NuGet publish list and needs a local
feed. Only this README and this evidence document changed; runtime/test code,
the shared version and the publish workflow are unchanged.

The earlier V-4 row is corrected above. Another task owns
`.antiphon/task-204e2409/docs-workflow-audit.json`; it accurately records the
original finding and is preserved. The correction is recorded in
`.antiphon/task-c7a1ff79/docs-workflow-audit.json`, including the earlier audit's
SHA-256 for provenance.

All fresh ordinary results below verify the pushed implementation commit
`746a2fdc82391ae4d578b1574b15452d29e034a4`. The subsequent commit adds this evidence
only; the docs/link/diff audit is repeated on that final state. Evidence root:
`C:\src\markdown-package\.antiphon\task-c7a1ff79\`.

| ID | Actual outcome | Evidence in the new root |
| --- | --- | --- |
| V-1 | Eight-project isolated Release build, once; 0 warnings/errors, 16.43 seconds. | `build.log`, `verified-commit.txt` |
| V-2 | Four 1.0.0 package manifests and Core symbols verified; five checksums; packaged Reviews README matches the corrected source. | `pack.log`, `inspect-release.log`, `feed/SHA256SUMS` |
| V-3 | Retained local-feed global tool proof: all nine commands passed; all three generated archives match original task 9474e409 bytes. | `tool-proof.log`, `tool-proof/proof.json`, `package-docs-audit.json` |
| V-4 | Audited 22 consumer-facing documents from 81 tracked Markdown documents; checked five HTML files for release wording, eight active release docs, 36 local link targets, versions, workflow policy and diff. No stale consumer-facing release wording remains. | `docs-audit.log`, `docs-workflow-audit.json`, `diff-check.log` |
| R-1 | 57 unit cases passed; 0 failures/skips. | Shared `ordinary.trx`, `tests.log`, `trx-summary.json` |
| R-2 | 24 affected integration cases passed; 0 failures/skips. | Same command/TRX as R-1 |
| R-3 | Default local global-tool proof passed without retained evidence. | `tool-default.log` |
| R-4 | Two isolated exact-version Reader/Core consumers passed without Git. | `libraries.log` |
| R-5 | Four package inspections, three external consumers, both Core README examples and installed-tool/native integration smoke passed. | `consumers.log` |

R-1/R-2 used the seven exact `-class` filters shown earlier, with
`-preEnumerateTheories` and a fresh `-result-trx`. All 32 intended methods appeared
with nonzero counts, expanding to 81 passing cases in 7.151 seconds. Per-class
counts: `HelpTests` 8, `OptionValidationTests` 46, `SpecConsistencyTests` 3,
`HistoryModeTests` 9, `ProducerTests` 3, `ApiParityTests` 4, `UpdateTests` 8.
All classes are in `Mdpkg.Cli.Tests`. No unexpected classes, missing methods,
zero-count selections, failures or skips were present.

The remaining 32 consumer Markdown lines mentioning "preview" describe historical
releases or viewer features. One static HTML design mockup names a sample document
`docs/releases/preview.3.md`; it makes no current release claim. Historical plan
and investigation records remain historical. This is a local documentation/link
audit, not a fresh public-feed publication check.

Rerun the commands above with `c40cf169` replaced by `c7a1ff79`, using a fresh
evidence root. The retained scripts `audit-evidence.py` and `audit-docs.py` audit
the TRX/package/proof provenance and the F1 docs correction respectively.
All owned commands finished. All eight `bin-c7a1ff79` directories were removed
using `dotnet clean` and nonrecursive removal of four leftover runner DLLs and
empty directories; see `clean.log` and `cleanup.json`.

Next: ordinary read-only **Review**, before caller landing. Original Code task /
landing owner: **9474e409-5479-4405-910a-f3d858dbf6df**. Branch:
`feat/task-9474e409-mdpkg-tool`; exact worktree: `C:\src\markdown-package`.
Restart: **none**. Zero PC-n rows/variants are specified and none were executed;
the caller must preserve and explicitly commission post-land SourceLanding
Mutation, including missing-control discovery. Existing coverage gaps remain:
Windows-only local verification, pending Linux/public-feed CI acceptance and the
original optional evidence failure-path controls. No landing or deployment was
performed.
