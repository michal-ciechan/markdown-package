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

The format spec is drafted, the web viewer browses packages, and the .NET generator creates
and validates real packages. `pack` supports snapshots, Git history, path projection, depth
and confirmed addressing exceptions. `validate --deep` checks native Git integrity and
current-view agreement, and substantiates complete correspondence against retained history.
Git imports preserve legacy-encoded commit metadata. Report destinations are checked for
filesystem aliases to protect inputs and package output. `update` and `address` remain
explicit exit-70 placeholders.

The .NET solution also provides [Mdpkg.Reader](src/generator-cli/src/Mdpkg.Reader/README.md)
and [Mdpkg.Reviews](src/generator-cli/src/Mdpkg.Reviews/README.md): bounded read-only package
access and typed v1/v2 review-feedback extraction/resolution. Structural extraction and
current-view resolution require no native Git; full verification is an injected capability.
The [external consumer](examples/review-consumer/) restores Reviews from local preview
packages. Web comment authoring/export and public-feed publication remain separate work.

## Repository layout

- [`docs/spec.md`](docs/spec.md) — the format specification;
  [`docs/spec/generator-cli.md`](docs/spec/generator-cli.md) is the tool reference for the
  generator CLI.
- [`src/web-viewer/`](src/web-viewer/) — the browser viewer, published to GitHub Pages.
- [`src/generator-cli/`](src/generator-cli/) — `mdpkg`, the .NET producer and validator.
- [`examples/`](examples/) — sample markdown covering the addressing edge cases.

## Getting started

Requires .NET 10 and Git on PATH. From the repository root:

```powershell
dotnet run --project src/generator-cli/src/Mdpkg.Cli -- pack examples/guide-and-notes --out guide.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
dotnet run --project src/generator-cli/src/Mdpkg.Cli -- validate guide.mdpkg --deep
```

Use your own lowercase UUID for a new package lineage. See the [tool guide](src/generator-cli/README.md)
for options, implementation limits and tests. Publication as an installable tool is separate work.

## Examples

[`examples/`](examples/) has sample markdown covering the addressing edge cases
(nested headings, duplicate headings, Setext headings, headingless preambles)
that [`docs/spec.md`](docs/spec.md) and
[`docs/investigations/addressing.md`](docs/investigations/addressing.md) define.
