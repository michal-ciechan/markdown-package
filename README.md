# markdown-package

> **[Open a `.mdpkg` package in the web viewer](https://michal-ciechan.github.io/markdown-package/)** — no installation required.

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

### View a package — no install

Open the [hosted web viewer](https://michal-ciechan.github.io/markdown-package/), then select
**Open package** (or drag, drop, or paste a local `.mdpkg` file). Packages stay on your device.

### Create a package with `mdpkg`

Install the CLI (requires the .NET 10 SDK), then package a directory containing at least one
Markdown file. The output must be outside the source directory:

```powershell
New-Item -ItemType Directory my-docs
Set-Content my-docs\README.md '# My docs'
dotnet tool install --global mdpkg
mdpkg pack ./my-docs --out ./my-docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
```

Use your own lowercase UUID for a new package lineage. Default snapshots need no Git.
Open `my-docs.mdpkg` in the [hosted viewer](https://michal-ciechan.github.io/markdown-package/)
to read and review it. Add the global tool directory to PATH if needed
(`%USERPROFILE%\.dotnet\tools` on Windows, `$HOME/.dotnet/tools` on Linux/macOS).

### Use the .NET libraries

Use `Mdpkg.Reader` for read-only access, or `Mdpkg.Core` to create and validate packages
(Core restores its matching Reader dependency):

```powershell
dotnet add package Mdpkg.Reader --version 1.0.0 --source https://api.nuget.org/v3/index.json
dotnet add package Mdpkg.Core --version 1.0.0 --source https://api.nuget.org/v3/index.json
```

### Desktop app (coming soon)

The Windows desktop viewer is in phase 1 and is not released yet. When available, its unsigned
Windows installer will be published through GitHub Releases. Until then, see the
[desktop README](src/desktop/README.md) to build it from source.

For CLI options, local builds, and release details, see the [tool guide](src/generator-cli/README.md)
and [release guide](docs/releases/mdpkg.md). This repository is [MIT licensed](LICENSE).

## Examples

[`examples/`](examples/) has sample markdown covering the addressing edge cases
(nested headings, duplicate headings, Setext headings, headingless preambles)
that [`docs/spec.md`](docs/spec.md) and
[`docs/investigations/addressing.md`](docs/investigations/addressing.md) define.
