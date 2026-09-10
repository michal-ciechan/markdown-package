# mdpkg releases (CARD-0036)

The tool release pipeline is implemented. The first public release still requires
the owner setup below and a successful `prove-nuget-org` job. Local installation
does not establish NuGet.org availability. Library publication is CARD-0039.

## One-time owner setup

1. Sign in to or create the NuGet.org account that will own `mdpkg`. Choose that
   individual or an organization you administer as the policy/package owner.
   The existing Antiphon workflow uses profile `MichalCiechan`; use it here only
   if that is the intended publishing account. Confirm the package ID is available
   or already owned by that account. Both the `mdpkg` package page and flat-container
   version index returned HTTP 404 on 2026-09-10; this finds no public conflict but
   does not reserve the ID or rule out a reservation/unlisted ownership conflict.
   If the first push reports a conflict, stop and resolve ownership; do not rename silently.
2. In GitHub repository `michal-ciechan/markdown-package`, create the environment
   **`nuget`**, restrict its deployment branches to **`master`**, and add environment
   secret **`NUGET_USER`** containing the NuGet **profile name**, not the email address.
   A repository secret of that name also works, but the environment secret keeps
   the release setup together. No long-lived `NUGET_API_KEY` secret is needed.
3. On NuGet.org, create a GitHub Trusted Publishing policy with these exact values:

   | Field | Value |
   | --- | --- |
   | Policy name | `mdpkg-publish` (descriptive name) |
   | Package owner | The individual/organization selected in step 1 |
   | Repository owner | `michal-ciechan` |
   | Repository | `markdown-package` |
   | Workflow file | **`publish-nuget.yml`** (filename only) |
   | Environment | **`nuget`** |
   | Package glob | **`mdpkg`** |
   | Scopes | Push new packages and new versions, including the initial package |

   **The policy pins the owner, repository and workflow filename. Renaming
   `.github/workflows/publish-nuget.yml` breaks authentication until the policy is
   updated.** Keep the environment name synchronized too.

   A newly created policy may show **Pending** with a message such as "Use within
   7 days to keep it permanently active." It can authenticate and publish during
   this window; a successful push makes the policy permanently active. This worked
   for `mdpkg`'s first publish. If the window expires, use **Activate for 7 days**
   to restart it, then publish within that window.
4. Run the workflow on master:

   ```powershell
   gh workflow run publish-nuget.yml --ref master
   gh run list --workflow publish-nuget.yml --limit 5
   gh run watch <run-id> --exit-status
   ```

The setup follows [NuGet Trusted Publishing](https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing)
and [NuGet/login](https://github.com/NuGet/login). The workflow requests a temporary
key immediately before pushing; only the `publish` job has `id-token: write`.
Ordinary CI, local verification and the public proof have `contents: read` only.

## Releasing and recovering

Change the single `<Version>` in `src/generator-cli/Mdpkg.Pack.props`, commit and
push to master. The initial version is `0.1.0-preview.1`. The tool and local libraries
share this version; only the **mdpkg** nupkg is pushed. Source/props changes under
`src/generator-cli/**`, the root LICENSE and the workflow itself trigger the release
workflow. It also supports manual dispatch. No tags, CHANGELOG or GitHub Packages
mirror are involved. This supersedes the tag/CHANGELOG/API-key-fallback proposal
in the older CARD-0033 plan, sections 5–6.

Windows and Linux restore, build, test, pack, and globally install the local tool.
The publish job downloads the verified Linux artifact from that same run; it does
not repack different bytes. Both packages are retained as workflow artifacts.
`--skip-duplicate` allows retrying an already published version. A source change
without a version bump cannot replace that immutable package: bump the version
when changed behavior should reach users.

The separate **`prove-nuget-org`** job is the release-complete signal. It downloads
no build artifact and does not build a project. It installs the exact props version
globally in a new `DOTNET_CLI_HOME`, with a config containing only nuget.org and
new package/HTTP caches on each attempt. It checks the global registration and
version/help, packs a UTF-8 Markdown document, checks its archived bytes, and runs
deep validation through the installed shim. It retries failed installs up to 20
times, 180 seconds apart (57 minutes of waits plus command time). Smoke failures
after installation fail immediately.

If login fails, check the profile secret, policy owner, filename and environment.
If push succeeds but proof fails to install, check NuGet validation/indexing status
and retry the workflow once the package is available. If installed-tool checks fail,
fix the issue and bump the version. A green push alone does not close publication.

## Local verification

From `src/generator-cli` with .NET 10 SDK, Git and Python 3 on PATH:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
dotnet pack src/Mdpkg.Cli --no-build -c Release -o artifacts/release
python tests/prove-tool.py --local-feed artifacts/release
```

The temporary global installation leaves the developer's existing tools untouched.
To rerun the public proof after release, omit `--local-feed` and use
`--attempts 20 --retry-delay 180`. The package includes README, MIT LICENSE and
the existing Unicode notice; no invariant-globalization setting is introduced.

For CARD-0039, extend this workflow and the policy scopes for the separate libraries
and their public consumers. Consider Public API analyzers there; they are not part
of this tool-only release.
