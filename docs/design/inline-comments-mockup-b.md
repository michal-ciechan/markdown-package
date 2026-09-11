# Mockup B: inline review folds

Open `inline-comments-mockup-b.html` directly in a browser. It is one self-contained file with inline CSS and JavaScript, no dependencies, no server, and no build step. Feedback and state changes are simulated in memory and reset on reload. The document text is taken from `docs/spec.md`, §§3.2–3.3; reviewer names and feedback are illustrative.

## Design rationale

This direction treats a conversation as an expandable part of the document. A compact strip of numbered thread buttons sits immediately below each annotated paragraph. Clicking a text mark or thread button opens a full-width fold at that location, pushing the following content down. Each paragraph shows one conversation at a time, while folds in different paragraphs may remain open together. This makes a deliberate tradeoff: longer reading distance when conversations are expanded, in exchange for keeping the text, original quote, replies, state control, and composer in one reading column. It needs no permanent comment sidebar or connectors across a margin. “Collapse folds” and the Read view recover uninterrupted reading.

Teal speech bubbles identify comments; amber edit icons identify change requests. Explicit type and state labels carry the distinction as well as color. Resolved threads retain a quiet solid underline and a check mark; obsolete threads use a dotted underline, dashed button, and history explanation. Hover or keyboard focus previews a comment and emphasizes its anchor without opening a fold. Click, Enter, or Space opens the conversation. The first paragraph deliberately contains four threads: two overlap on “bounded reads,” another targets an adjacent phrase, and one addresses the entire paragraph. Shared text uses a single combined underline, and its separate numbered buttons keep both conversations reachable. Repeated clicks on the shared text cycle between those threads.

Authoring happens below the selected paragraph in the same space as a posted thread. Drag-select text or click an unannotated word, expand to the paragraph or shrink back, then choose “Leave feedback.” The draft preserves its quote and blue text highlight. Paragraph + buttons offer a direct keyboard/touch alternative. Posting adds a numbered mark and opens the new thread exactly there. Replying, changing thread state, filtering by state, and switching between Read and Review work in the mockup. A draft is retained when browsing other threads or filters; starting a second draft returns focus to the first. Narrow layouts wrap the thread buttons and composer fields while retaining the same fold behavior.

## Current viewer findings

The checked-out `src/web-viewer/src/ui/review-view.js` renders the thread list, state selector, replies, and a shared authoring form inside a separate Review section. Thread headings navigate to their document/section; they do not decorate the corresponding rendered text. `reader-view.js` renders the markdown and section highlighting, while `selection-toolbar.js` supplies click-word selection, expand/collapse, and a Leave comment callback. `main.js` routes that callback to the Review section's “Review selected text” action. It also explicitly reports that imported review packages do not yet display their review threads. Mockup B demonstrates a proposed presentation for pre-existing threads; it does not imply that import support already exists.

## Comparison guide and limits

- The initial view opens change request #02. Hover #01 or #03; use the overlapping text mark and the individual thread buttons to compare access to nearby conversations.
- Open #04 to see a whole-paragraph anchor; use the Resolved and Obsolete filters to inspect #05 and #06. Return to All threads to see the full context.
- Add a reply, change its thread state, then select text in rule 2 and post a new comment or change request. The new thread appears beside its source paragraph.
- Use Read, Review, Collapse folds, or Reset demo to compare density and restore the specimen.

This is a design artifact, not an application integration. It does not load packages, resolve anchors against changed documents, export reviews, or persist feedback. Selection is intentionally limited to one paragraph; code blocks and table cells are rendered context rather than additional authoring surfaces. Obsolete is a manually selectable review state, not a simulated anchor-resolution result. Production integration would need the actual source-selector mapping, package/review loading, and export semantics already defined by the project.
