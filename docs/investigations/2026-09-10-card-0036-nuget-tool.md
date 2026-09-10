# CARD-0036: mdpkg NuGet tool release foundation

Implemented the repository deliverable against CARD-0036's full live description
and `C:/src/Antiphon/.github/workflows/publish-nuget.yml`. Actual NuGet publication
remains pending human account/policy/secret setup. The setup and rerun commands
are in [the release guide](../releases/mdpkg.md).

## Result

- Root MIT LICENSE, shared `Mdpkg.Pack.props` version `0.1.0-preview.1` and package
  metadata, inherited by CLI/Core/Reader/Reviews. Only one `<Version>` remains.
- Complete tool description, tags, repository provenance, packed README, MIT
  LICENSE and retained Unicode notice. Invariant globalization is not enabled.
- `publish-nuget.yml`: master push/path filters and manual dispatch; Windows/Linux
  build/test/local global-install gates; publish the verified Linux artifact using
  `NuGet/login@v1` in environment `nuget`, with job-local OIDC permission and
  `--skip-duplicate`. Only `mdpkg` is pushed to NuGet.org.
- Separate public proof globally installs the exact version with nuget.org as its
  sole feed, empty caches and an isolated CLI home; up to 20 attempts, 180 seconds
  apart. Version/help, pack, archived Markdown bytes and deep validation are checked.
- Both READMEs now include preview installation, usage and release-guide links.
  Ordinary CI also runs the global-install gate and retains read-only permissions.

## Verification

| Check | Result |
| --- | --- |
| Windows Release build | 0 warnings, 0 errors |
| Windows tests | 1,064 passed, 0 failed, 0 skipped |
| Linux Release build in .NET 10 SDK container | 0 warnings, 0 errors |
| Linux tests | 1,064 passed, 0 failed, 0 skipped |
| Windows/Linux tool pack | Both succeeded |
| Global install + version/help + pack/content/deep validate | Passed on Windows and Linux, 0 failures |
| Four local package manifests | Shared version/MIT verified; Core still pins Reader exactly |
| actionlint 1.7.12, both affected workflows | 0 findings |
| Public-only proof, 2 attempts with no delay | Expected failure: mdpkg preview not found on nuget.org; no local fallback |
| Public package-ID check | Package page and flat-container index both HTTP 404 on 2026-09-10 |

Linux tests and packing used a source copy on native container storage. The final
Linux global-install smoke used the same portable nupkg already installed on
Windows, mounted read-only. The first local Linux harness lacked Python, and a
second harness had CRLF in its final argument; these harness issues were corrected
before the successful smoke. GitHub jobs explicitly set up Python.

No credentials were provisioned and no NuGet package was pushed during local
verification. At inspection, GitHub had no Actions repository secrets and only the
`github-pages` environment. A passing public proof after owner setup is still
required before claiming the tool is published.

## Handoff

Review the pipeline, shared metadata and isolated proof. The owner must configure
the NuGet policy/package owner, GitHub `nuget` environment restricted to master,
and `NUGET_USER` profile-name secret. Pin repository owner `michal-ciechan`,
repository `markdown-package`, workflow filename **`publish-nuget.yml`**, environment
**`nuget`**, and package glob **`mdpkg`**, with new-package/new-version push scopes.
Renaming the workflow requires a matching policy update. No persistent API key is
needed. Then run `gh workflow run publish-nuget.yml --ref master` and require the
`prove-nuget-org` job to pass. Separate library publication remains CARD-0039.
