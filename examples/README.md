# Examples

The current source uses the single breaking draft 2 schema: typed snapshot/commit
state, default history-free creation, and explicit materialization before published
successors. See [the release notes](../docs/releases/draft-2.md).

Realistic markdown content exercising the addressing edge cases from
[`docs/investigations/addressing.md`](../docs/investigations/addressing.md) and
[`docs/spec.md`](../docs/spec.md) section 6 (Addressing).

- [`guide-and-notes/`](guide-and-notes/) — a two-document package (`guide.md`,
  `notes.md`) with nested ATX headings (`# Guide` > `## Setup` / `## Usage`).
  This is the exact base fixture (`GUIDE_0` / `NOTES_0`) that
  [`docs/spec/worked-example.py`](../docs/spec/worked-example.py) packages,
  renames, and squashes to produce the worked example in spec.md section 8; it
  is reused here verbatim rather than duplicated with different content.
- [`duplicate-headings.md`](duplicate-headings.md) — nested headings (`# Section 1`
  with children `## Other` and two identical `## Repeat` headings), matching the
  "two identical `Repeat` headings" case in addressing.md's "Concrete awkward
  cases" table. Occurrence-counted trails (spec.md section 6.2) are what tell
  the two `Repeat` sections apart.
- [`setext-headings.md`](setext-headings.md) — top-level and level-2 headings
  written in Setext form (`===` / `---` underlines) rather than ATX (`#`),
  covering spec.md section 6.1 rule 2's "ATX and Setext both count."
- [`no-heading-preamble.md`](no-heading-preamble.md) — a document with no
  heading at all, so the whole file is the permanent preamble scope (spec.md
  section 6.1 rule 4).

None of these are packaged `.mdpkg` files; they are the plain markdown inputs
an addressing implementation should resolve correctly. See
`docs/spec/worked-example.py` for how the guide/notes fixture is turned into
real `.mdpkg` archives with a rename, a squash, and resolved references.
