# Coordinated mdpkg, Reader and Core releases (CARD-0036/CARD-0039)

`mdpkg` 0.1.0-preview.1 passed the public install gate in
[run 34513663424](https://github.com/michal-ciechan/markdown-package/actions/runs/34513663424).
The next coordinated version is **0.1.0-preview.2**: `Mdpkg.Reader`, `Mdpkg.Core`,
then `mdpkg`. Library availability requires the owner policy extension below and
both `prove-nuget-org` matrix entries to pass. `Mdpkg.Reviews` is built and checked
locally but is not pushed.

## One-time owner setup

1. Use the existing `mdpkg` owner/profile and confirm it may publish **Mdpkg.Reader**
   and **Mdpkg.Core**. Their public v3 version indexes returned HTTP 404 on
   2026-09-10 before this release; this does not reserve the IDs or prove they are
   free of ownership restrictions. Resolve any conflict without silently renaming.
   The task explicitly reserves NuGet account/policy provisioning for the human.
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
   | Package globs | **`mdpkg`**, **`Mdpkg.Reader`**, **`Mdpkg.Core`** |
   | Scopes | Push new packages and new versions, including the initial package |

   Extend the existing policy to authorize all three exact IDs, including initial
   creation of Reader/Core. If the UI exposes one glob per policy, add matching
   policies for `Mdpkg.Reader` and `Mdpkg.Core` with the same identity fields. Do not
   authorize Reviews or an unrestricted `*` as part of this release. Keep the
   existing `NUGET_USER` secret; no new persistent API key is needed.

   **The policy pins the owner, repository and workflow filename. Renaming
   `.github/workflows/publish-nuget.yml` breaks authentication until the policy is
   updated.** Keep the environment name synchronized too.

   A newly created policy may show **Pending** with a message such as "Use within
   7 days to keep it permanently active." It can authenticate and publish during
   this window; a successful push makes the policy permanently active. This worked
   for `mdpkg`'s first publish. If the window expires, use **Activate for 7 days**
   to restart it, then publish within that window.

   After successful authentication, the policy binds to the permanent numeric
   GitHub owner and repository IDs; deleting and recreating the repository under
   the same name breaks authentication and requires reconfiguring the policy for
   the new repository ID.

   NuGet's indexes become available in order: the gallery page
   (`https://www.nuget.org/packages/<id>`) returns HTTP 200 within about a minute
   of a successful push, then the v3 flat-container version index
   (`https://api.nuget.org/v3-flatcontainer/<id>/index.json`) follows a few minutes
   later. The flat-container index is what `dotnet restore` and `dotnet tool install`
   read. The search index, used by NuGet.org's search box and some tooling, lags
   both and can still return zero hits after installation already works. For
   availability checks, poll the v3 flat-container index for the published version,
   not the gallery page or search index: a cold search index is not evidence of a
   failed or incomplete publish.
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
push to master. Tool, Reader, Core and local Reviews share that version. Core's
NuGet dependency is **exactly** `[ReaderVersion]` because it uses Reader internals.
Never publish a new Core against different Reader bytes bearing the same version.

The workflow triggers on `src/generator-cli/**` (including Reader/Core and shared
props), LICENSE, its own workflow, and external consumer/spec fixtures used by its
gates. Manual dispatch remains available. No tags, CHANGELOG or GitHub Packages
mirror are involved. This supersedes the older CARD-0033 tag proposal.

Windows and Linux build/test, pack all four products, inspect manifests, and run
all local consumer gates plus global tool installation. `inspect-release.py` checks
shared versions, IDs, license/README, source commit, dependency boundaries, the
exact Core-to-Reader pin, Core XML documentation/symbols and Unicode notices. Each
platform uploads its packages, Core symbols and `SHA256SUMS`. The publish job
verifies the Linux checksums and pushes those same bytes, Reader first, then Core,
then mdpkg. Core's adjacent snupkg is pushed by `dotnet nuget push` automatically.
Reviews remains an inspected artifact only. Only the publish job has OIDC permission.

`--skip-duplicate` supports recovery from partial publication. If Reader succeeded
and Core failed, correct policy/ownership and rerun the same commit/version. Never
change source and use a successful duplicate skip as evidence that those new bytes
were released. Any change intended for consumers requires a new shared version.

The **`prove-nuget-org` matrix** is the release-complete signal:

- `tool`: installs the exact props version globally in a temporary CLI home; checks
  registration/version/help, packs UTF-8 Markdown, checks content and deep-validates.
- `libraries`: creates external Core-only and Reader-only PackageReference projects
  outside the checkout. Each retry has new projects, CLI home, package/HTTP caches,
  an explicit nuget.org-only config and no fallback folders. It verifies package
  provenance, exact resolved versions and the Core/Reader dependency. The dependency
  graph must contain only Core (for that consumer), Reader, Markdig and SharpZipLib.
  It builds only these consumers, creates with Core, deep-validates with native Git,
  checks Reader identity/content and runs standalone Reader without Git on PATH.

Neither public entry downloads build artifacts or receives publishing credentials.
Each retries install/restore up to 20 times, 180 seconds apart, with a 120-second
command timeout. Smoke/assertion failures after restore fail immediately. Check
flat-container indexes, not search, for indexing progress. A successful push alone
is insufficient. Policy failures need the owner; indexing failures need a retry;
installed behavior failures need a fix and new shared version.

## Local verification

From `src/generator-cli` with .NET 10 SDK, Git and Python 3 on PATH:

```powershell
dotnet restore
dotnet build --no-restore -c Release
dotnet test --no-build -c Release
dotnet pack src/Mdpkg.Reader --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Core --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Reviews --no-build -c Release -o artifacts/release
dotnet pack src/Mdpkg.Cli --no-build -c Release -o artifacts/release
python tests/verify-consumers.py --local-feed artifacts/release
python tests/prove-libraries.py --local-feed artifacts/release
python tests/prove-tool.py --local-feed artifacts/release
python tests/inspect-release.py artifacts/release --commit (git rev-parse HEAD)
```

For the public proofs, omit `--local-feed` and use `--attempts 20 --retry-delay 180`
with both `prove-libraries.py` and `prove-tool.py`. No invariant-globalization
setting is introduced.

## Public API analyzer decision

CARD-0039's optional analyzer suggestion was considered against Antiphon's
`Messaging.Pack.props` pattern (`Microsoft.CodeAnalysis.PublicApiAnalyzers`,
`PrivateAssets=all`, shipped/unshipped baselines, RS0016/RS0017 build errors).
Defer baseline adoption to a dedicated API review covering Reader, Core and Reviews:
this release changes packaging and consumer proof, not public signatures, and Reviews
is not yet published. Before the next API change, establish reviewed nullable-aware
baselines for all three libraries, fail additions/removals without an explicit
baseline update, and keep analyzer assets out of consumer dependencies. This release
does **not** claim automated public API compatibility enforcement.
