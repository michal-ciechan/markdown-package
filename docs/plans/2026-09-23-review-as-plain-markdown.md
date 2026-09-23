# Exporting a review as plain Markdown: what a review carries, what it should look like, and the smallest first step

Date: 2026-09-23. Investigate task `8569f60b`. Investigated at commit `b0534f6`
(master). **No production code was changed.** Every rendering and measurement
below came from throwaway scripts in the session scratchpad that import the
shipped viewer modules by absolute path; nothing from those scripts is in the
repo.

**Status (2026-09-23, build task `dafabc9a`): BUILT.** All four decisions were
taken by the user as recommended — D-1 verbatim quotes capped at 600
characters, D-2 document order, D-3 base level `#` kept as a module option, D-4
every thread exported with its state printed — and §5's smallest first step is
closed out. `src/web-viewer/src/review/markdown.js` renders the §2.1 shape and
imports only `decodeLocator`; `tests/review-markdown.test.mjs` has 15 Node unit
cases; `Copy review as Markdown` and `Download as Markdown` sit in the review
panel's second action row (`ui/review-view.js`), the copy reusing the
writeText-with-textarea fallback and the download reusing `downloadReview` via
a new `markdownFile` in `review/out.js`; two Chromium cases were added to
`tests/review.spec.js`. **§3 re-confirmed against the shipped renderer**: it
reads no manifest, and unit case M14 plus the browser case assert the output
carries no `mdpkg://`, no 64-hex digest, no `sha256-` and no UUID, so
`LOOSE_EXPORT_CAVEAT` does not apply. Measured at that build: Node unit lane
231/231 (was 216 before this slice); `node build.mjs` V-1 and V-2 passed at
**98,407 / 145,000** eager gzip bytes, 1,650 over the 96,757 recorded in §0 and
46,593 under the ceiling; Playwright 281/281 across the three engines (155
Chromium, 126 Firefox + WebKit). §6's open items are unchanged and still open:
the export does not call `validateAnchors`, and it degrades to authoring order
rather than refusing when a stored quote no longer matches its source.

Scope: the browser web-viewer's reviewer-side export. This note is about adding
a **second, human-readable output** next to the existing `.mdpkg` delta review —
"here are my comments" as text you can paste into a PR description, a chat
message, an issue or an email. The `.mdpkg` export is not changed, not replaced,
and not deprecated by anything here.

---

## 0. Outcome

**Q1. What does a review carry that a flat Markdown rendering has to
represent?** Seven things per thread and five per comment, and exactly one of
them is an open design question (the quoted source excerpt). Full inventory in
§1, with the one item that is *not* in the review document (the reviewed
package's identity) called out in §1.3 because it decides §3.

**Q2. What shape?** Recommended: **grouped by document, then by section, with
the quoted source in a fenced code block and each comment blockquoted beneath
it, replies nested by blockquote depth.** Rendered end-to-end and parsed back
through the viewer's own CommonMark in §2. Two rejected alternatives, both
rendered and both with a measured defect, are in §2.3 and §2.4.

**Q3. Does CARD-0062's loose-file caveat apply?** **No — confirmed, with one
condition.** The review document itself is identity-free: `newThread`
(`src/web-viewer/src/review/comments.js:16-20`) keeps only `root`, `loc`,
`expect` and the selector, and drops the namespace the reference was built
from. A plain Markdown export therefore makes no continuity or obtainability
claim *provided it does not print* `pkg.manifest.namespace`,
`manifest.current.id`, or an `mdpkg://` reference — `formatReference`
(`src/web-viewer/src/address/reference.js:72-76`) embeds the namespace in every
URL it makes. Details and the converse case in §3.

**Q4. Smallest first step?** A pure `src/web-viewer/src/review/markdown.js`
(~90 lines) with Node unit tests, plus one **Copy as Markdown** button in the
review panel reusing the clipboard pattern already in
`src/web-viewer/src/main.js:347-364`. The `.md` download is three extra lines
because `downloadReview` already takes any `File`. §5.

**Budget:** not a constraint. The eager gzip budget measured **96,757 / 145,000
bytes** at `b0534f6` (`node build.mjs`, V-2 passed) — 48,243 bytes of headroom
for a module that should cost well under 1,000.

### Decisions for the caller

Four, in descending order of how much they change the output. §4 has the
evidence for each.

- **D-1 (real, please decide): are quoted source excerpts included verbatim?**
  Recommended **yes, with a per-quote character cap**. Verbatim is what makes
  the export standalone — the recipient does not need the package. But
  "Review selected section" quotes the *entire section source including its
  subsections*: measured on this repo's own `docs/spec.md`, the median section
  is **3,137 characters** and a top-level section is **146,418** — the whole
  document. Uncapped, one section-level comment turns a five-comment review
  into a 150 KB paste. Recommended cap: 600 characters with a
  `…quote truncated (N characters total).` marker.
- **D-2: thread order.** Authoring order and document order differ in practice
  (measured, §2.5). Recommended **document order**, which costs one
  `pkg.document(path)` per distinct path and reuses the existing
  `commentInterval` (`src/web-viewer/src/ui/comment-anchor.js:6-12`).
- **D-3: heading base level.** The export starts at `#`. Pasted into a PR
  description that is itself `##`-based, that inverts the hierarchy.
  Recommended: emit `#` by default and keep the base level a module option, so
  a "copy as a fragment" variant is a one-argument change later.
- **D-4: which threads.** Everything, or only what the inline filter currently
  shows (`all` / `open` / `resolved` / `obsolete`,
  `src/web-viewer/src/ui/inline-comments.js:18`)? Recommended **everything**,
  with the state printed per thread, because a silently filtered export is a
  misleading artifact. Cheap to revisit.

---

## 1. What a review actually carries

### 1.1 The review document

`newReview()` (`review/comments.js:8`) produces
`{version: 2, anchor, profile, selector, threads: []}`. The three profile
strings are format constants (`cm0312-trail-source-v1`, `cm0312-source-lf-v1`,
`cm0312-quote-context-v1`) and carry nothing a human reader wants. Everything
else lives in `threads`.

Per **thread** (`comments.js:16-20`, validated at `comments.js:30-38`):

| Field | What it is | Needed in flat Markdown? |
| --- | --- | --- |
| `id` | UUID | No. Nothing in a flat export links to it. |
| `loc` | base64url `[kind, path, trail]` | **Yes**, decoded. This is the only "where". |
| `root`, `expect` | 64-hex scope digests | No. Content digests, not identity; meaningless to a reader. |
| `state` | `open` / `resolved` / `obsolete` | **Yes.** Authored, and `obsolete` changes how a reader should treat the comment. |
| `select.quote` | exact source text selected | **The D-1 decision.** |
| `select.prefix` / `suffix` | up to 40 chars of context either side (`review/selector.js:11`) | Optional. Useful for a one-line quote; noise for a section-sized one. |
| `select.start` / `end` / `occurrence` | UTF-16 offsets within the scope | No, except as a sort key (D-2). |

Per **comment** (`comments.js:11-14`, validated at `comments.js:40-55`):

| Field | What it is | Needed? |
| --- | --- | --- |
| `author` | free text, ≤64 KiB, from the remembered name | **Yes** |
| `at` | RFC 3339, display metadata, leap seconds preserved | **Yes** |
| `kind` | `comment` or `change-request` (v2); absent in v1 | **Yes** — the distinction is the point of a review |
| `body` | prose, LF-normalized, ≤64 KiB | **Yes** |
| `inReplyTo` | sibling comment id | **Yes**, as nesting |
| `id` | UUID | Only to resolve `inReplyTo` |

`kind` is `undefined` only in a version-1 document, which `readComments`
accepts when reading (`comments.js:24`). Nothing in the viewer authors v1, and
the viewer does not yet display an imported review at all
(`src/web-viewer/src/main.js:203`), so in practice the renderer always sees v2 —
but treating a missing `kind` as an unlabelled comment costs one `??` and
keeps the module honest if imported-review display ever lands.

### 1.2 Decoding `loc` into something readable

`decodeLocator(thread.loc)` yields `[kind, path, trail]` where `kind` is
`document` / `preamble` / `section`, `path` is the package-relative document
path, and `trail` is `[[title, occurrence], ...]` from root heading down.

The trap: `title` is the **raw heading source**, not display text
(`src/web-viewer/src/address/outline.js:20`). For an ATX heading that is
`"## Rolling out"`; for a Setext heading it is two lines,
`"Title\n====="`. Rendering it unprocessed puts `## Rolling out` inside the
export's own heading, i.e. `### ## Rolling out`. The renderer needs ~4 lines to
strip ATX markers and fold a Setext underline. `occurrence > 0` means a
repeated heading and needs a disambiguator (`Setup (2)`).

The panel today does something cruder — `review-view.js:86` prints
`` `${locator[1]} · ${locator[2].at(-1)?.[0] ?? locator[0]}` ``, which shows
the raw `## Rolling out` and only the last trail element. A flat export wants
the full trail: `Deployment guide › Rolling out › Rollback`.

### 1.3 What the review document does *not* carry

Not in `comments.json` at all: the reviewed package's **namespace** and
**current snapshot id**. `newThread` builds a full reference via `referenceFor`
and then keeps only `{root, loc, expect}` — the `namespace` component is parsed
and discarded (`comments.js:17-19`). The identity lives solely in the manifest
that `emitReview` writes (`review/emit.js:13-16`).

That is the fact §3 turns on: a Markdown renderer that reads only the review
document *cannot* accidentally emit a lineage claim. It can only do so if
someone deliberately reaches for `pkg.manifest` or `formatReference`.

### 1.4 The existing `.mdpkg` path, for contrast

`emitReview(pkg, comments, {namespace})` (`review/emit.js:8-23`) clones the
comments, re-verifies every anchor against the open package
(`validateAnchors`, `comments.js:62-72`: each thread's scope must still exist,
its reference must still match, and `makeSelector` must reproduce the stored
quote and context byte for byte), writes a two-entry container, and then
re-opens and re-validates its own output (`validateExport`, `emit.js:25-37`).
`reviewFile`/`downloadReview` (`review/out.js`) name it `<stem>-review.mdpkg`
and click a hidden link.

A plain Markdown export shares none of that machinery and needs none of it: it
has no container, no snapshot id and no addressing claim to defend. Whether it
should still run `validateAnchors` first is a genuine question — see §6.

---

## 2. The rendering, measured

All three shapes below were rendered from the same authored review (4 threads
across 2 documents, 6 comments, one 3-deep reply chain, one whole-section
quote, one change request, states `open`/`resolved`/`obsolete`, and one comment
body deliberately containing `## Not a heading in the host document,
hopefully`), then parsed back through the viewer's own CommonMark
(`commonmark@0.31.2`) to see what structure a recipient's renderer actually
receives.

### 2.1 Recommended: grouped, fenced quote, blockquoted comments

````markdown
# Review of ingest-runbook.mdpkg

4 threads (2 open, 1 resolved, 1 obsolete), 6 comments by Priya, Sam. Exported 2026-09-23.

## guide.md

### Deployment guide › Prerequisites

```
## Prerequisites

You need the deploy key and an approved change ticket. The key lives in the
vault under `ops/deploy`.
```

**Comment** — Priya, 2026-09-23T00:05:50.320Z · _resolved_

> This section is out of date: the key moved to `ops/deploy-v2` last month.

### Deployment guide › Rolling out

```
deploy --stage all
```

**Change request** — Priya, 2026-09-23T00:05:50.315Z

> Promoting to all stages in one step is too coarse.
>
> Split this into 25% / 100% and name the metric you gate on.

>> **Comment** — Sam, 2026-09-23T00:05:50.319Z
>>
>> Agreed. The gate metric should be the 5xx rate, not the error rate.
````

Why each part:

- **Fenced code for the quote, not a blockquote.** The quote is *source text*.
  Fenced, it renders literally and cannot inject anything. Measured through
  CommonMark, a quote containing ` ``` `, `---`, `# Injected H1`,
  `<script>alert(1)</script>` and a Setext underline all came out as escaped
  `<pre><code>` content. The fence length is computed from the longest backtick
  run inside the quote (`'`'.repeat(max(3, longest + 1))`), so an embedded
  triple-fence does not terminate it — verified.
- **Blockquote for the comment body.** Bodies are authored prose and people do
  write lists and code in them, so the Markdown should still render. Blockquote
  keeps it rendering *and* contains it: measured, a body containing `## Injected`
  produces `<blockquote>…<h2>Injected</h2></blockquote>` — an `h2` element, but
  nested inside the blockquote rather than a sibling of the export's own
  headings. Compare §2.4, where the same body restructures the host document's
  outline.
- **Replies nested by blockquote depth** (`>`, `>>`, `>>>`). Verified to nest
  correctly to depth 3+.
- **Metadata line above each body**, not inside it, so the body stays a clean
  quotable block.

Residual, worth stating rather than fixing: a heading inside a body is still a
heading element and will appear in a GitHub anchor list or TOC. Demoting `#`
runs inside bodies is possible but rewrites the reviewer's own words; not
recommended for v1.

### 2.2 The reply-indentation trap (found by measurement, avoid it)

The obvious way to nest replies — indent by two spaces per level — **breaks at
depth 2**. Measured:

```text
""      -> <blockquote><p>reply body</p></blockquote>
"  "    -> <blockquote><p>reply body</p></blockquote>
"    "  -> <pre><code>&gt; reply body</code></pre>
```

Four spaces is an indented code block, so the third comment in a reply chain
silently turns into source. The first draft of the prototype did exactly this
and produced a spurious code block containing `**Comment** — Priya, …`.
Blockquote depth has no such cliff. Nested list items are the other safe option
(verified: 4-space continuation inside a list item stays list content) but
combine awkwardly with a blockquoted body.

### 2.3 Rejected: flat bullet list

```markdown
- **guide.md › Deployment guide › Rolling out** — “deploy --stage all”
  - Change request (Priya): Promoting to all stages in one step is too coarse. Split this into 25% / 100% …
  - Comment (Sam): Agreed. The gate metric should be the 5xx rate, not the error rate.
```

Compact (1,096 characters vs 1,353 for the same review) and it injects nothing —
zero code blocks and one heading in the whole output, because every quote and
body is flattened to a single line. That flattening is the problem: a
change-request body that says "split this into 25% / 100%" survives, a body with
a bulleted list of three required changes does not. Good candidate for a
*second* mode ("copy as a summary") once the main one exists; wrong as the only
one.

### 2.4 Rejected: quote and body both as plain Markdown

Rendering the quote as a `>` blockquote and the body as bare paragraphs reads
nicely and is the most "native" looking, but it is unsafe in both directions.
Measured on the same review: the body containing `## Not a heading in the host
document, hopefully` produced an `<h2>` **as a sibling of the export's own
`## guide.md` and `## notes.md` headings**, silently restructuring the pasted
document's outline. The blockquoted section excerpt additionally rendered its
own `## Prerequisites` as a heading inside the quote. Nine headings came out of
a review that should have had four.

### 2.5 Ordering is a real choice

Same review, same renderer, two orders:

```text
authoring order: Rolling out | Rolling out › Rollback | Prerequisites | On-call
document order : Prerequisites | Rolling out | Rolling out › Rollback | On-call
```

Reviewers do not comment top to bottom. `commentInterval(model, loc, select)`
(`ui/comment-anchor.js:6-12`) already maps a thread to an absolute source
offset and is already used by the inline-comment layer, so document order costs
a sort plus one `pkg.document(path)` per distinct path. Note that
`pkg.document` caches only the *active* document (`inbound/open.js:15-28`), so
a multi-document review re-reads and re-outlines each path once; gather the
distinct paths first and it is one pass.

---

## 3. Relationship to the `.mdpkg` export, and the CARD-0062 caveat

**They coexist with no interaction.** Different outputs, different buttons,
different file extensions, no shared state. The Markdown renderer reads the same
in-memory `review` object the panel already holds and writes a string; it does
not touch `prepared`, `artifact`, `dirty` or `exportRevision`, so it cannot
disturb the prepare/download/share state machine. The one thing to get right is
the `revision`/`invalidate()` discipline: copying Markdown should **not**
invalidate a prepared `.mdpkg`, and preparing a `.mdpkg` should not clear a
Markdown button — they are independent.

**The CARD-0062 caveat does not apply. Confirmed.**
`LOOSE_EXPORT_CAVEAT` (`ui/review-view.js:11-12`) exists for one reason, stated
in its own comment: the exported `.mdpkg`'s manifest names a
`(namespace, snapshot id)` pair that exists only on the reviewer's device, so
the recipient cannot obtain the original the file *claims* to review. A plain
Markdown export writes no manifest, so it makes no such claim. Two supporting
facts, both checked in source:

1. The review document is namespace-free (§1.3, `comments.js:16-20`). A
   renderer over `review.threads` has nothing to leak.
2. With verbatim quotes (D-1 = yes), the recipient does not need the original
   at all — the excerpt is in the message. The obtainability problem the caveat
   warns about does not arise.

**The condition.** Three things would put a claim back in and bring the caveat
with it:

- printing `pkg.manifest.namespace` or `pkg.manifest.current.id` in the header;
- emitting `mdpkg://…` references per thread — `formatReference`
  (`address/reference.js:72-76`) embeds the namespace in the URL;
- printing `thread.root`/`thread.expect` as if they identified a retrievable
  state (they are scope content digests, but they look like identity).

None of those is in the recommended shape. If D-1 is answered **no** (reference
only, no verbatim excerpts), the export stops being standalone and *does* need
a line telling the recipient they need the source document — but that is a
different, milder note than `LOOSE_EXPORT_CAVEAT`, and it is needed for packaged
`.mdpkg` sources too, not just loose ones.

A separate point worth a decision if the export ever grows an identity header:
the reviewed *file name* (`pkg.name`, from `blob.name`,
`inbound/open.js:17`) is fine to print. It is a label, not a lineage claim.

---

## 4. Evidence behind the four decisions

**D-1, quote size.** Measured with `outline()` over this repo's own
`docs/spec.md` (146,418 characters, 47 sections):

| Section | Quote length if "Review selected section" is used |
| --- | --- |
| `# markdown-package format specification` (top level) | 146,418 |
| `## 6. Addressing` | 31,638 |
| `### 6.8 Sub-section anchors: the selector` | 16,288 |
| median of 47 sections (`### 6.3 The override ledger`) | 3,137 |

A section scope runs to the start of the next sibling heading
(`address/outline.js:17`), so a section quote *includes every subsection*. The
UI does not warn about this — the editor shows the full quote in a `<pre>`
(`review-view.js:32`) — and the `.mdpkg` export does not care, because the
recipient's tool re-anchors rather than reads. Flat Markdown is the first
consumer for which quote size is a usability problem. Note the cap is a
*display* cap in the Markdown only: the review document and the `.mdpkg`
export keep the full quote, which they must, because `validateAnchors`
re-derives and compares it.

**D-2, ordering.** §2.5.

**D-3, heading base.** The recommended shape uses `#` for the title, `##` per
document and `###` per section. Pasted into a GitHub PR description that is
itself organised with `##`, the review's `#` outranks everything around it.
Making the base level a parameter costs one argument and no complexity.

**D-4, which threads.** The inline layer already has a thread-state filter
(`ui/inline-comments.js:18`) and a Read/Review mode. Honouring the filter in an
export means the artifact's completeness depends on invisible UI state. Export
everything, print the state.

---

## 5. Smallest first step

Modelled directly on how `inbound/loose.js` landed (CARD-0062): a pure module
with Node unit tests first, UI wiring second.

**Step 1 — `src/web-viewer/src/review/markdown.js`, pure, no DOM.**

```js
export function reviewMarkdown(review, {packageName, now, quoteLimit = 600, base = 1, order} = {})
```

Imports only `decodeLocator` from `address/reference.js`. Responsibilities:
heading-source → display text (§1.2), fence computation, quote capping,
grouping, blockquote nesting by reply depth. Returns a string. Roughly 90 lines
— the prototype that produced §2.1 is 70 before the D-3/D-4 options.

**Step 2 — `src/web-viewer/tests/review-markdown.test.mjs`**, following
`tests/loose.test.mjs`. The cases that matter are the ones measurement already
found: ATX and Setext heading titles; `occurrence > 0`; a quote containing a
triple fence; a body containing `## heading`, `---`, raw HTML and a Setext
underline; a 3-deep reply chain (the §2.2 trap — assert the depth-2 reply is
**not** a code block by parsing the output back through CommonMark, which is
already a dependency); a `document`- and a `preamble`-kind locator; a missing
`kind` (v1); quote capping at the boundary; and an empty review.

**Step 3 — one button.** `Copy review as Markdown` in the review panel's action
row (`review-view.js:41`), using the clipboard pattern already proven in
`main.js:347-364`: `navigator.clipboard.writeText`, and on rejection reveal a
readonly `<textarea>`, focus and select it, and tell the user to copy manually.
That fallback is not optional — `writeText` needs a secure context and can be
denied, and the review panel has no existing textarea to fall back to.

**Step 4 (optional, three lines) — `Download review as Markdown`.**
`downloadReview` (`review/out.js:6`) already takes any `File`, so this is
`downloadReview(new File([text], stem + '-review.md', {type: 'text/markdown'}))`
with the stem logic lifted from `reviewFile` (`out.js:1-4`). Worth doing in the
same slice: mobile Safari's clipboard is the least reliable surface and a file
is the escape hatch. Note `navigator.share` with a `text/markdown` file is a
third option and a natural fit for the phone case, but it needs its own
`canShare` probe like the existing share button (`review-view.js:157`).

**Not in the first step:** document ordering (D-2) if the caller wants to defer
it — the module takes an `order` option so it can be added without touching the
renderer; a "summary" mode (§2.3); anything on the recipient side.

**Verification profile for the build stage:** Node unit tests for the module,
and one Chromium case in `tests/review.spec.js` that authors two threads, clicks
Copy, reads the clipboard back (`navigator.clipboard.readText` works in
Chromium under Playwright with clipboard permissions) and asserts the quote and
both bodies are present. Cross-engine clipboard behaviour is already
characterised in
`docs/investigations/2026-09-17-card-0057-paste-from-clipboard-button.md`;
reuse its conclusions rather than re-probing.

---

## 6. Not done, noted

- **Should the Markdown export re-verify anchors first?** `emitReview` runs
  `validateAnchors` before emitting, so an `.mdpkg` export fails loudly if the
  open package no longer matches. A Markdown export renders stored quotes and
  would happily print a quote that no longer exists in the document. Since the
  panel's review is always authored against the currently open package this can
  only diverge in exotic cases, but "quotes may be stale" is a claim worth
  either defending (call `validateAnchors`, refuse on mismatch) or disclosing.
  Not investigated; a one-line fix idea is to call `validateAnchors` and degrade
  to a warning line rather than refusing.
- **Recipient-side rendering is a different feature.** The viewer still cannot
  display an imported review package (`main.js:203`). A Markdown renderer over
  a *read* review document would make `mdpkg → Markdown` possible in the CLI
  too (`Mdpkg.Reviews` already extracts the same model in .NET), but that is a
  separate consumer and a separate slice.
- **Not measured: very large reviews.** The format caps are 5,000 threads,
  20,000 comments, 64 KiB per body and 8 MiB per comments document
  (`comments.js:26,42,44,58`). A worst-case Markdown render is therefore in the
  tens of megabytes, which no clipboard should be handed. A thread count above
  which the copy button offers the download instead would be prudent; no number
  measured.
- **`select.prefix`/`suffix` are unused by the recommended shape.** For a
  short quote, rendering `…prefix **quote** suffix…` reads better than a bare
  fenced word. Attractive, needs care (the context is source text too, so it
  needs the same escaping), and it is additive to the module.
- **Author identity.** The export prints whatever was typed in *Your name*.
  There is no verification and the plain-Markdown form makes that even less
  evident than the `.mdpkg` form does. Worth one sentence in the README rather
  than any code.

---

## 7. Evidence and reproduction

Scripts live in the session scratchpad (not the repo) and import the shipped
modules by absolute `file:///` URL. Run from `src/web-viewer` with
`node_modules` installed:

```text
# Shapes §2.1/§2.3/§2.4 rendered from a 4-thread, 2-document authored review
node <scratchpad>/run.mjs

# Parse each rendering back through commonmark@0.31.2: heading inventory,
# code-block inventory, the §2.2 indentation probe, and adversarial bodies
node <scratchpad>/verify.mjs
node <scratchpad>/verify2.mjs

# §4 section-quote sizes, from this repo's own docs/spec.md
#   outline(docs/spec.md) -> 47 sections, largest 146,418, median 3,137 chars

# Budget headroom at b0534f6
node build.mjs
#   V-1 passed; V-2 passed: 96757/145000 eager gzip bytes (Review).
```

Source facts cited above, for re-checking without the scripts:

| Claim | Where |
| --- | --- |
| Thread stores no namespace | `src/web-viewer/src/review/comments.js:16-20` |
| Heading trail titles are raw source, Setext included | `src/web-viewer/src/address/outline.js:20` |
| A section scope runs to the next sibling heading | `src/web-viewer/src/address/outline.js:17` |
| Selector context is ≤40 chars either side | `src/web-viewer/src/review/selector.js:11` |
| Review size caps | `src/web-viewer/src/review/comments.js:26,42,44,58` |
| `emitReview` validates anchors then self-validates the container | `src/web-viewer/src/review/emit.js:8-37` |
| `downloadReview` accepts any `File` | `src/web-viewer/src/review/out.js:6-16` |
| Clipboard-write with textarea fallback | `src/web-viewer/src/main.js:347-364` |
| Loose caveat and its rationale | `src/web-viewer/src/ui/review-view.js:7-12` |
| `formatReference` embeds the namespace | `src/web-viewer/src/address/reference.js:72-76` |
| Thread → absolute source offset | `src/web-viewer/src/ui/comment-anchor.js:6-12` |
| Thread-state filter in the inline layer | `src/web-viewer/src/ui/inline-comments.js:18` |
| Imported review packages are not displayed | `src/web-viewer/src/main.js:203` |
