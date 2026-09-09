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

Early — this repo exists to start shaping the design. Nothing is implemented yet.

## Getting started

Not yet — check back once the initial design lands.

## Examples

[`examples/`](examples/) has sample markdown covering the addressing edge cases
(nested headings, duplicate headings, Setext headings, headingless preambles)
that [`docs/spec.md`](docs/spec.md) and
[`docs/investigations/addressing.md`](docs/investigations/addressing.md) define.
