# Inline comments, mockup A: the margin rail

Open `docs/design/inline-comments-mockup-a.html` directly in a browser. It is
self-contained: no build, no server, no data beyond the sample threads inside
it. The sample document is §2 and §4 of `docs/spec.md`; the six threads and
their authors are invented. This is one of two comparative takes requested by
CARD-0043 and deliberately does not try to be a synthesis.

## What the viewer does today

`src/web-viewer/src/ui/review-view.js` keeps every thread in a separate
"Review" panel under the document. A thread there is a heading button that
navigates to its locator, the exact source quote, a state select, and the
comments. Nothing in the rendered document shows that a passage has a thread
on it, and replying happens in the panel's editor, away from the text. The
CARD-0040 click-word toolbar builds a selection in place, but "Leave comment"
then jumps focus down into that same panel. The mockup keeps the toolbar and
the panel's vocabulary (comment, change request, open/resolved/obsolete,
"saved in this tab, prepare a review file") and moves the threads up next to
the text.

## The design decision: cards live in a margin, not in the flow

Threads are shown as cards in a rail to the right of the reading column, each
card vertically aligned with the text it quotes. The document itself never
reflows when a thread opens, which matters for a spec reader who is comparing
tables and code blocks: inline expansion (GitHub-style) pushes the passage
being discussed away from the passage that follows it, and a spec review is
mostly about those adjacencies. The rail is the Google Docs model, chosen
because the viewer already has a wide, centred reading column with unused
space beside it.

Three devices make the anchoring legible when the rail gets crowded:

- **Gutter dots.** Every visible thread puts a small dot in the gutter at the
  height of its first line, coloured by kind and state. Dots on the same line
  step sideways instead of stacking. This is the at-a-glance density signal:
  three dots beside one paragraph tells a reader that paragraph is contested
  before they read a single card.
- **Connector lines.** Hovering or opening a thread draws a curve from its
  gutter dot to its card. Cards get pushed down when several anchors are close
  together (the first paragraph of §4 has three), so alignment alone cannot say
  which card belongs to which highlight. The line can.
- **Pinning on open.** The open thread's card snaps to its anchor's exact
  height and the neighbours reflow around it, above and below. Closed cards are
  compact: kind, state, first author, two lines of the first comment, and a
  reply count. Only the open card shows the whole conversation, the reply box
  and the state control, so a rail with seven threads is still one screen of
  short cards.

## Comment versus change request

The distinction is carried by colour, icon and word together, everywhere the
thread appears: the highlight, the gutter dot, the card's left edge, the kind
label, and the compose card while typing. Comments are the viewer's existing
blue (the selection and link colour); change requests are the amber the viewer
already uses for a "flagged-changed" resolution, so amber consistently means
"something should change". A reply carries its own kind, as the schema allows,
and a change-request reply inside a comment thread shows its pencil icon on
the reply line so the escalation is visible without opening anything.

## Thread state

Open threads are the only saturated ones. A resolved thread keeps its place
but drops to a dotted grey underline in the text and a grey-edged card with a
green check pill, so it is discoverable without competing with open work.
Obsolete is the same weight with a dashed card border and a slashed-circle
pill; the mockup's obsolete thread explains in its last reply why it is
obsolete rather than resolved, because the distinction the schema draws
(nothing was changed in response) is exactly the one a reader needs. "Show
resolved and obsolete" hides both kinds of settled thread; opening one from
its highlight brings it back regardless of the filter.

Anchoring uses two shapes. A span thread is a `mark` in the text, translucent
so that overlapping spans darken naturally (the mockup nests a comment on
"byte 50" inside a change request on the whole clause). A whole-paragraph or
whole-section thread reuses the viewer's existing selected-section device, a
bar along the left edge, and its card names the scope ("Whole section:
2. Terminology") because there is no quote to read beside it.

## Leaving a new comment

The CARD-0040 flow is kept: click a word, expand through sentence, paragraph
and section, collapse back, then "Leave comment". Two things change. The
selection also produces a "Comment on selection" pill in the rail at the
selection's height, so the entry point exists where the result will appear.
And the compose card is that result: it appears in the rail aligned to the
selection, with a dashed draft highlight in the text that switches colour
live as the reviewer toggles Comment / Change request. On save the dashed
highlight becomes a solid one and the compose card becomes the thread card in
the same place, already open, with the viewer's own status line ("saved in
this tab, prepare a review file"). Nothing moves, so the new comment does not
feel like it was sent somewhere else. Cancel unwraps the draft and leaves the
text exactly as it was.

## Narrow panes

Below roughly 900px of reading-pane width the rail folds away. Each block with
threads gains a row of small chips under it (kind icon, first name, comment
count); tapping a chip or a highlight opens that one card inline under the
block, pushing content down. This is the only place the design accepts
inline expansion, because on a phone there is no margin to keep. Widening the
pane moves the cards straight back into the rail.

## Trade-offs to weigh against mockup B

The rail needs horizontal room, which the viewer has on desktop but not in a
narrow docked window; the fallback is functional but plainer. Nested
highlights resolve to the innermost thread on click, so the outer thread is
reached through its non-overlapping text or its card. The wide/narrow switch
is container-based, not a media query, so it would work if the real viewer
ever showed the document list in a collapsible drawer. Card positioning is
measured on every layout pass; in the real viewer it would need to re-run
after the renderer swaps documents and after any font load.
