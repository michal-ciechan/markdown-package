# CARD-0039: Reader/Core NuGet release integration

Implementation is committed and pushed at `cf6568a`; publication is complete.
`mdpkg`, `Mdpkg.Reader` and `Mdpkg.Core` are live on nuget.org at **0.1.0-preview.2**
and both public-feed proofs passed. The NuGet Trusted Publishing policy was
extended to explicitly authorize `mdpkg`, `Mdpkg.Reader` and `Mdpkg.Core`, then
workflow run 34516104021 was rerun successfully. No wildcard was used, deliberately
keeping `Mdpkg.Reviews` unauthorized and local-only.

The first attempt's Reader push returned HTTP 403 after successful OIDC login.
In that attempt only, no packages were pushed, Core/tool pushes were not reached,
and the public proofs were skipped. The policy extension resolved that historical
authorization failure; publication is now working.

## Evidence

- [Release run 34516104021](https://github.com/michal-ciechan/markdown-package/actions/runs/34516104021):
  after the policy extension and rerun, all five jobs passed: `verify (ubuntu-latest)`,
  `verify (windows-latest)`, `publish`, `prove-nuget-org (libraries)` and
  `prove-nuget-org (tool)`.
- [Ordinary CI run 34516104083](https://github.com/michal-ciechan/markdown-package/actions/runs/34516104083):
  Windows and Linux succeeded.
- Release tests: **1,064 passed per OS; 0 failed, 0 skipped**. Both builds had
  **0 warnings, 0 errors**. Local Windows verification also passed all 1,064 tests.
- Each release platform passed three existing external consumers, both Core README
  examples, two new Core/Reader consumers, installed-tool pack/deep-validation and
  isolated global tool installation/version/help/content/deep-validation.
- Four package manifests, Core XML documentation and portable symbols inspected.
  Five SHA-256 checksums generated per OS and verified again before Linux publication.
- actionlint 1.7.12: both changed workflows, 0 findings. `git diff --check`: 0 errors.
- Prepublication public-only library proof: 2 fresh-cache attempts, both failed with
  NU1101 for missing Reader/Core, as expected. No local fallback occurred. These
  historical prepublication results are superseded by the successful public-feed
  library and tool proofs in the rerun, confirming availability and working consumers.
- Development harness issues (duplicate solution project names and exact-range string
  formatting) were corrected before all final local/CI gates passed. Existing local
  artifacts with older versions prompted exact shared-version selection in the
  existing consumer verifier; no unrelated artifacts were deleted.

## Changes

- `.github/workflows/publish-nuget.yml`: inherited source filter covers Reader/Core
  and shared props; added spec/consumer fixture filters; pack and inspect all four
  products; preserve Core symbols/checksums; publish verified Linux Reader, Core,
  then tool with skip-duplicate and existing restricted nuget/OIDC configuration.
  Reviews stays local. Public proof now has tool and library matrix entries.
- `.github/workflows/generator-cli.yml`: run the same new library/metadata gates on
  pull requests and ordinary CI; retain checksums and Core symbols.
- `src/generator-cli/Mdpkg.Pack.props`: shared version `0.1.0-preview.2`, including
  local Reviews. Existing shared MIT/authors/repository/project metadata retained.
  Core's nuspec dependency remains exactly `[0.1.0-preview.2]` for Reader.
- `src/generator-cli/tests/prove-libraries.py`: external Core-only and Reader-only
  consumers; nuget.org-only default; new projects, CLI home and package/HTTP caches
  per retry; no fallback folders; exact versions, transitive pin, allowed dependency
  graph and public package provenance checked. Real Core create/deep-validate with
  Git, transitive Reader identity, standalone Reader content check without Git.
- `src/generator-cli/tests/inspect-release.py`: versions, IDs, MIT/README, provenance
  commit, exact Core/Reader dependency, Reader dependency boundary, notices and Core
  docs/symbols; checksum manifest for the verified artifacts.
- `src/generator-cli/tests/verify-consumers.py`: explicit local-feed argument and
  exact shared-version artifact selection; all prior consumer checks retained.
- Root, tool, Reader and Core READMEs plus `docs/releases/mdpkg.md`: install commands,
  coordinated versioning, release gates, scope setup, failure recovery and status.

The optional Public API analyzer pattern was reviewed and deferred to a dedicated
API baseline review for Reader/Core/Reviews. No public API signatures changed here;
automated API compatibility enforcement is not claimed. Rationale and follow-up
requirements are in the release guide.

## Completed policy correction and rerun

The first attempt exposed missing package authorization despite successful OIDC
token exchange. The policy was subsequently extended to the exact globs **mdpkg**,
**Mdpkg.Reader**, **Mdpkg.Core**, including initial-package and new-version pushes.
No unrestricted wildcard was added, so Reviews remains unauthorized. The existing
GitHub environment remains restricted to master, with these identity constraints:

| Field | Value |
| --- | --- |
| Repository owner | `michal-ciechan` |
| Repository | `markdown-package` |
| Workflow filename | `publish-nuget.yml` |
| Environment | `nuget` |
| GitHub deployment branch | `master` |
| NuGet profile/owner | Existing successful mdpkg publisher; Reader/Core access confirmed by publication |

Both library flat-container indexes returned 404 before release. This does not
prove package-ID ownership or reserve either ID. Do not silently rename packages.
Do not provision another persistent API key or authorize Reviews for this task.

After the policy correction, run 34516104021 was rerun and all five jobs passed.
Both `prove-nuget-org` matrix entries passed, satisfying the release-completion gate.
For a separate cold public-only verification from the repository root:

```powershell
python src/generator-cli/tests/prove-libraries.py --attempts 20 --retry-delay 180
python src/generator-cli/tests/prove-tool.py --attempts 20 --retry-delay 180
```

The implementation agent did not provision the account/policy; the subsequent
policy extension and successful rerun completed publication. No approval-review
rejection occurred.
