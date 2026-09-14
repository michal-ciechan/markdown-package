# markdown-package

A package for efficiently transporting markdown documents — including their revisions and
changes — between tools, agents, and reviewers, with reviewing specs and docs specifically in
mind.

## Problem

Markdown is the natural format for specs, plans, and docs, but moving a markdown document (or a
change to one) between a producer and a reviewer is usually ad hoc: pasted into a chat, diffed by
eye, or shipped as a whole new file with no record of what changed and why. That gets worse the
moment more than one revision is in flight, or the reviewer only cares about the delta.

## Goal

Make it cheap and reliable to package a markdown document plus its revision history in a form
that:

- transports efficiently (no re-sending the whole document for a one-line change),
- preserves enough context to review a change on its own merits (what changed, and why),
- stays plain markdown at the core, rather than inventing a new authoring format.

## Status

The first stable packages (**1.0.0**) implement **draft 2**, the breaking revision
of `markdown-package/1`. Default `pack` and browser delta reviews are history-free
snapshots with typed `{kind, id}` state. Snapshot creation and full validation need
no Git. Explicit `--history git`, history import, materialization and updates use
committed packages; `update --materialize` records a deterministic bootstrap origin,
and `update --tree` appends a successor while preserving that origin.

CLI, [Core](src/generator-cli/src/Mdpkg.Core/README.md),
[Reader](src/generator-cli/src/Mdpkg.Reader/README.md),
[Reviews](src/generator-cli/src/Mdpkg.Reviews/README.md) and the web viewer use the
same schema. Old string-valued manifests are rejected. Reviews can resolve an
original snapshot review against verified materialized history; the browser's
historical/origin backend remains unsupported. General squash/truncate construction
and `address` remain explicit exit-70 placeholders.

The first stable coordinated package version is **1.0.0**. Earlier published
previews use the incompatible pre-CARD-0052 format; there is no compatibility parser.
Use the source or a fresh local feed until the 1.0.0 public-feed gate succeeds.
See the [breaking release notes](docs/releases/draft-2.md) and
[integrated acceptance evidence](docs/investigations/2026-09-12-card-0052-integrated-acceptance.md).
NuGet publication is a separate release-workflow action.

## Repository layout

- [`docs/spec.md`](docs/spec.md) — the format specification;
  [`docs/spec/generator-cli.md`](docs/spec/generator-cli.md) is the tool reference for the
  generator CLI.
- [`src/web-viewer/`](src/web-viewer/) — the browser viewer, published to GitHub Pages.
- [`src/generator-cli/`](src/generator-cli/) — `mdpkg`, the .NET producer and validator.
- [`examples/`](examples/) — sample markdown covering the addressing edge cases.

## Getting started

### Install the published tool

After the **1.0.0** public-feed gate succeeds, install the stable tool without
building this repository:

```powershell
dotnet tool install --global mdpkg
mdpkg --version
mdpkg pack ./my-docs --out ./my-docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
mdpkg validate ./my-docs.mdpkg --format json
```

Requires .NET 10 SDK. Create `my-docs` with at least one `.md` file first; output
must be outside that directory. Default snapshots need no Git. Add the global
tool directory to PATH if needed (`%USERPROFILE%\.dotnet\tools` on Windows,
`$HOME/.dotnet/tools` on Linux/macOS). The install command selects the latest
stable release. To pin this release, add `--version 1.0.0`; to update an existing
installation, use `dotnet tool update --global mdpkg`.

### Build the local candidate

Requires .NET 10 SDK. Git is needed for explicit Git output, materialization,
updates and their deep validation. From the repository root:

```powershell
dotnet run --project src/generator-cli/src/Mdpkg.Cli -- pack examples/guide-and-notes --out guide.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
dotnet run --project src/generator-cli/src/Mdpkg.Cli -- validate guide.mdpkg --deep
dotnet run --project src/generator-cli/src/Mdpkg.Cli -- update guide.mdpkg --materialize --out guide-git.mdpkg
```

To exercise the installed candidate, build a fresh local feed:

```powershell
dotnet pack src/generator-cli/src/Mdpkg.Cli -c Release -o src/generator-cli/artifacts/package
dotnet tool install mdpkg --tool-path .antiphon/tools --version 1.0.0 --add-source src/generator-cli/artifacts/package
```

Use your own lowercase UUID for a new package lineage. See the [tool guide](src/generator-cli/README.md)
for options, implementation limits and tests, and the [release guide](docs/releases/mdpkg.md)
for publishing setup and verification. This repository is [MIT licensed](LICENSE).

## Examples

[`examples/`](examples/) has sample markdown covering the addressing edge cases
(nested headings, duplicate headings, Setext headings, headingless preambles)
that [`docs/spec.md`](docs/spec.md) and
[`docs/investigations/addressing.md`](docs/investigations/addressing.md) define.
