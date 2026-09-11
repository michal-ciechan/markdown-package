# Table wrap toggle in the left gutter (CARD-0047 mockup)

Open `docs/design/table-wrap-gutter-mockup.html` directly in a browser. It is
self-contained: no build, no server. The sample document is §3.3, §6.6, §7.2
and §8.2 of `docs/spec.md`; the comment threads are invented. This is a design
mockup for review before implementation; it does not touch `src/web-viewer/`.

## What the viewer does today

`src/web-viewer/src/ui/table-controls.js` (CARD-0045) prepends a
`.table-toolbar` to every `.table-container`. The toolbar reuses the floating
selection-toolbar chrome (border, shadow, 44px button) and sits in the flow
above the table, right-aligned, so each table carries a ~52px band above it.
The mockup keeps that module's behaviour to the letter: the same icon, the same
`Wrap table N text` accessible name, `aria-pressed` for the wrapping state, the
same title text, the per-table preference keyed by source position, the same
DOM order (toggle, then the focusable scroll region).

## The design decision: the article owns a gutter column

The `.markdown` article reserves a column on its left with `padding-left`, and
its `max-width` grows by the same amount so the text column stays 84ch. Every
margin control lives in that column, on one vertical axis, and follows one
rule: **a control aligns to the first row or line of the block it belongs to.**

For the wrap toggle that means the toolbar leaves the flow
(`position: absolute` inside the `position: relative` table container), is
pinned to the table's top edge at `left: calc(-1 * var(--gutter))`, and spans
the first row's height so the button is centred on the header row. The
height comes from a `ResizeObserver` on the first `tr`, published as
`--first-row` on the container; that is the only JavaScript the change adds to
`tableControls`. Without the variable the CSS degrades to top alignment, which
the "Centre on first row" option in the mockup lets you compare. Either way the
table itself does not move: removing the in-flow toolbar actually restores the
vertical rhythm between a heading and the table that follows it.

The proposal is the CSS block labelled "2. CARD-0047 proposal" in the file. It
overrides the toolbar chrome the `.selection-toolbar, .table-toolbar` shared
rule sets; a real implementation would split that rule rather than override it.

### Proportions

| | Desktop | Phone (existing 700px breakpoint) |
|---|---|---|
| Control box | 44px (the current touch target, unchanged) | 36px |
| Gap to the reading edge | 12px | 6px |
| Gutter width | 56px | 42px |
| Hit target | 44px | 44px, through a `::before` that extends 4px past the box |

The gutter's width is set by the largest control it must hold, which today is
the toggle. Mockup B of CARD-0043 used a 29px square at 2.9rem; mockup A used
dots at 14px from the text. A 24px marker sits comfortably on the same axis as
a 44px toggle, so the column does not need to grow when comment markers arrive.
The focus ring (3px outline, 3px offset) stays inside the 12px gap.

The "Control size" option shows a 32px control with the same 44px hit target.
It is quieter on a page with many tables but reads as a smaller target on
touch devices; that is a decision for review, not one the mockup makes.

## Sharing the column with comment markers

CARD-0043's direction is not chosen, so the round markers are placeholders:
they borrow mockup B's per-block count control and mockup A's kind colours
(blue comment, amber change request). They are here only to show the column
hosting two kinds of control without a second column or any inline chrome.
The collision cases the layout has to survive are in the sample:

- **A thread on a paragraph** puts its marker at the first line, centred on the
  gutter axis. Pure CSS.
- **A thread on a body cell** (§6.6, the `unconfirmed` row) puts its marker at
  that row's height, below the toggle. The row is measured; that is CARD-0043's
  job when it lands, and the mockup only shows where the answer goes.
- **A thread on the whole table** (§6.6, second table) would want the first-row
  slot. The slot belongs to the toggle, so a block-level marker stacks directly
  under it with a 6px gap. Table controls always take the first-row slot;
  markers take the next one.

The existing selected-section bar (`box-shadow: -4px 0 0` on the heading) sits
at the reading edge, to the right of the gutter, so the two devices do not
compete; pick a section in the reader's select to see them together.

## Pressed style

Today pressed (wrapping, the default) is filled navy. In a gutter that means a
navy square beside every table on the page. The "Pressed style" option offers
the alternative: the default state plain, and the non-default scroll state
tinted the way the current document is tinted in the sidebar. It keeps
`aria-pressed` semantics unchanged and only moves the visual weight to the
state the reader chose. Both are shown so the decision can be made by looking.

## Phones

Below 700px the gutter narrows to 42px and the control to 36px, keeping the
44px hit target through the `::before`. The reading column loses 42px of a
358px panel. The alternative is to fall back to the CARD-0045 placement above
the table on phones, which the card's wording ("not above or inside it")
argues against but which keeps the column at full width; the mockup shows the
gutter version and the "Narrow pane" option simulates it at desktop size. The
nine-column §8.2 table wrapped at phone width is the existing CARD-0045
behaviour and the reason the toggle needs to be reachable there; changing that
default is out of scope for this card.

## What a real implementation changes

- `styles.css`: the proposal block; split the shared toolbar rule; delete the
  `.table-toolbar { width: fit-content; margin: 0 0 .5rem auto }` line.
- `table-controls.js`: observe the first `tr` and set `--first-row` on the
  container (one `ResizeObserver` shared across tables); disconnect it when the
  reader redraws.
- `tests/tables.spec.js`: the existing tests locate the button by accessible
  name and check `aria-pressed`, so they keep passing. A new layout test should
  assert the button's right edge is left of the table's left edge and its
  vertical centre is within 1px of the first row's, on desktop and at 390px,
  plus the 44px hit target on phones through `elementFromPoint`.
- `README.md` "Tables (CARD-0045)": "The wrap icon above each table" becomes
  "The wrap icon in the left margin, level with each table's header row".

## Open questions for review

1. 44px or 32px control on desktop.
2. Filled-when-wrapping or quiet pressed style.
3. Gutter on phones, or fall back to the above-table placement below 700px.
4. Whether the toggle should stick to the viewport while a long table scrolls
   (a `position: sticky` variant needs the toolbar in flow inside a grid
   column; not attempted here).
