# CARD-0044: author cross-references with in-place preview

Status: investigation and proposed implementation plan, under the defaults below.
No application code, package format, addressing profile or `docs/spec.md` changes
are part of this deliverable. Baseline inspected: `57a8350852924342703ca47682f6ad499f69d9f2`.
The full CARD-0044 description was read from the markdown-package board, card
`42ee8945-c3ff-4f6e-a127-65297e48d26b`, revision count 1, on 2026-09-11.

## Recommendation and decisions

Use ordinary CommonMark links. In the viewer, activating a link to a Markdown
document or section within the open package opens a contextual preview card;
**Open section/document** is an explicit action inside that card. Support both
easy-to-type relative destinations and the existing generated `mdpkg://` URI.
They offer different guarantees: a relative destination names a current place;
a generated URI carrying `root`, `loc` and `expect` can follow a confirmed entity
through the existing ledger. Do not describe relative links as rename-safe.

Reuse the existing addressing engine for identity, canonical scope boundaries,
digests and dispositions. Add a small link adapter and preview presentation layer,
not another identity map. A body edit is a usable live target with a changed-source
notice; an unresolved identity is never silently replaced by a similarly named
heading. Keep viewer resolution mandatory and add optional author linting through
Reader/Core integration in a later implementation slice.

| Card question | Proposed decision |
| --- | --- |
| Authoring syntax | Existing inline and reference-style Markdown links; no wikilink, directive, title sentinel or new URI parameter. Preview is the viewer's default for supported package-local targets. |
| Engine reuse | Yes, with explicit adapters for place-based navigation versus persisted identity. Retain `expect` on durable links and treat source change as information, not loss of target. |
| Cross-file/package | Relative paths resolve from the source document directory; canonical locators already contain package paths. Same-package documents, preambles and sections are supported. Cross-package loading and historical previews are deferred. |
| Preview UI | One click/tap/keyboard-opened card adjacent to the link on wide layouts, a bounded nonmodal bottom card on narrow layouts. Explicit open and close actions. Hover-triggered content is deferred. |
| Broken references | Preserve existing evidence statuses/reasons, distinguish navigation lookup failures from identity outcomes, and never infer deletion from absence. |
| Architecture | Both viewer-time resolution and optional authoring/build-time linting. Identity in Reader/browser addressing; correspondence production in Core; presentation in the viewer. |

These are proposed defaults for the follow-on build card. Product review should
accept the change from direct navigation to preview on local links, the two
authoring guarantees, and the card interaction. The plan can proceed without
choosing a winner for CARD-0043 or changing the format specification.

## 1. What already exists, and what must be added

| Evidence in this checkout | Consequence |
| --- | --- |
| [Spec §§6.1–6.6](../spec.md#6-addressing) defines canonical source, exact occurrence-counted heading trails, roots, sparse ledger records and dispositions. | A section is its heading through the next heading of equal or shallower level, including descendants. A preview must use that scope, not “the next paragraph.” |
| [Browser outline](../../src/web-viewer/src/address/outline.js), `outline`, `find`, `source`, `digest` | The browser already inventories documents/preambles/top-level ATX and Setext sections using unextended CommonMark. |
| [Browser references](../../src/web-viewer/src/address/reference.js), `parseReference`, `formatReference`; [resolver](../../src/web-viewer/src/address/resolve.js), `resolveReference`, `referenceFor` | Strict v2 URI parsing, ledger-first resolution with `expect`, and ledger-aware reference generation already exist. Historical targets return an application capability result. |
| [Reader addressing](../../src/generator-cli/src/Mdpkg.Reader/Addressing.cs), `DocumentLocator`, `PackageSnapshot.GetScopes`, `PackageSnapshot.Resolve` | .NET exposes the same current-view model, but its public resolver takes a reviewed `PackageIdentity` and an expected digest, not a loose URI. `SourceScope.Root` is the **default** root, not necessarily the live ledger root. |
| [Core correspondence](../../src/generator-cli/src/Mdpkg.Core/Correspondence.cs), `ConfirmedMove`, `ConfirmedRetirement`, `UnconfirmedRecord` | Confirmed editorial correspondence can already be supplied to the producer. The resolver does not discover moves. |
| [Main viewer](../../src/web-viewer/src/main.js), `navigate`, `resolve`, `showDocument` | Relative links and `mdpkg:` links currently navigate. Relative paths can cross documents; `resolve` currently couples evidence lookup to replacing the main reader. |
| [Reader view](../../src/web-viewer/src/ui/reader-view.js), `draw`, `fragment` | Fragment slugs are currently derived from displayed heading text and held in a DOM map. There is no reusable offscreen fragment-to-scope resolver or preview surface. |
| [Package opening](../../src/web-viewer/src/inbound/open.js), `openPackage` | Documents are read on demand, one document promise and one ledger are cached, and current addressing does not need Git. A preview of a second file must not become main-document navigation. |
| [Selection verification](../../src/web-viewer/src/review/selection.js), `verifyEndpoint` | It compares the entire rendered article's text to a perturbed render. Adding preview text inside that article would corrupt source selection checks. |
| [Table investigation](2026-09-11-card-0045-tables.md), [display parser](../../src/web-viewer/src/ui/markdown-parser.js), [safe renderer](../../src/web-viewer/src/ui/markdown-renderer.js) | Display supports tables while addressing stays unextended CommonMark. Raw HTML and automatic image fetching are disabled. Preview must retain both boundaries. |

The implementation languages remain separate: the browser reuses its JavaScript
addressing modules; .NET consumers reuse `Mdpkg.Reader`. There is no reason to ship
.NET/WASM or call a server for preview. Shared fixtures, not a second identity
algorithm in the UI, establish parity.

The I/O models differ: `PackageSnapshot.ReadAsync` loads the bounded current
Markdown view and ledger and hashes the archive, whereas the browser reads
documents on demand. Reusing Reader does not give its current snapshot API the
spec's one-target-document read cost. Use existing Reader limits for linting;
selective .NET snapshot construction is a separate optimization, not a preview
dependency.

## 2. Authoring syntax, with examples

### 2.1 Handwritten links: current locations

Given these package entries:

```text
guide.md
reference/storage.md
reference/network.md
```

An author writes in `guide.md`:

```markdown
# Guide

Read about [retry limits](#retry-limits) before changing the
[storage policy](reference/storage.md#retention-policy).
The [network reference](reference/network.md) has the full background.

## Retry limits

Retries stop after three attempts.
```

And in `reference/storage.md`:

```markdown
# Storage

## Retention policy

Keep successful results for seven days. See the [guide](../guide.md).
```

The storage link resolves to the exact locator:

```json
["section","reference/storage.md",[["# Storage",0],["## Retention policy",0]]]
```

The fragment is a convenience for obtaining this current locator. It is not the
root and cannot be recovered from the root hash. A file-only link obtains
`["document","reference/network.md",[]]`. Preambles remain selectable through
generated section URIs with a `preamble` locator; do not invent a slug for them.

Reference-style links also work, keeping prose readable and a shared destination
in one place:

```markdown
Use the [storage policy][retention] for expiry decisions.

[retention]: reference/storage.md#retention-policy "Storage retention policy"
```

Inline destinations and reference definitions are existing CommonMark syntax;
link titles keep their ordinary descriptive meaning. Parse link nodes, never
regex-replace occurrences of a word. Repeated unlinked words, code spans, fences
and raw HTML are not implicit cross-references. See the
[CommonMark 0.31.2 link rules](https://spec.commonmark.org/0.31.2/#links).

### 2.2 Generated links: persistent identity

For a link that should follow editorial moves, select the target section in the
viewer and use its existing reference-generation flow. The follow-on UI adds
**Copy Markdown link** (inline form) and **Copy reference** (the existing URI),
with the current section title as an editable link label. Escape the label as
Markdown; do not concatenate arbitrary heading text into link syntax unchecked.

For example, this complete URI from [spec §8.3](../spec.md#83-addressing-three-reviews-at-c1-resolved-against-package-2)
records Guide / Setup from the earlier worked-example snapshot:

```markdown
Read the [setup instructions][setup].

[setup]: mdpkg://c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8/v2/section/b6564987b603d69de8b0f48998ed1b8df6a052bae15caf3aacbf614f47047984?anchor=cm0312-trail-source-v1&profile=cm0312-source-lf-v1&expect=2078ef26101467257c9b4d35e4c617b96c9f4e719b460088f4f78e4d927d0264&loc=WyJzZWN0aW9uIiwiZ3VpZGUubWQiLFtbIiMgR3VpZGUiLDBdLFsiIyMgU2V0dXAiLDBdXV0K
```

This is tied to the example namespace; generate the actual URI from the author's
package. The example's confirmed rename to Installation follows the ledger and
returns `flagged-changed / source-changed`, with the current scope available.
The preview shows Installation and “Content changed since this link was copied.”
It does not call the link broken or change its authored label automatically.

The generated URI has no `at`, so it selects the current target. Keep `expect`:
the existing browser deliberately treats a URI without it as locator-only
navigation and bypasses the ledger. Removing it would lose move-following
semantics. Do not add `observedAt`, `preview`, selectors or other parameters to
the strict URI grammar.

These URIs are verbose and require a stable package namespace; ordinary Markdown
tools can parse the link but may not open the custom scheme. Relative links have
better portability. Offer both, name their guarantees plainly, and do not require
a full Markdown editor inside the viewer. Authors can copy a link from a built
snapshot and paste it into their source editor before rebuilding.

### 2.3 Why not a new syntax or an automatic binding file?

| Option | Assessment |
| --- | --- |
| `[phrase](path#fragment)` and reference-style equivalents | Familiar and portable; already parsed and routed. Recommended for handwritten current-location links. |
| `[phrase](mdpkg://...)` | Existing exact identity and ledger semantics; copyable rather than comfortably handwritten. Recommended when move survival matters. |
| `[[file#Some Heading]]` | Requires a syntax extension, escaping/label rules and tooling support; still cannot establish historical identity from a heading name. No first-version benefit sufficient to justify it. |
| Directive or special link title | Adds a separate authoring convention and competes with real title text. Preview presentation can be decided by the viewer without changing source grammar. |
| Automatically persist bindings for every relative link | Needs a stable identity for each source-link occurrence, migration when source prose moves, and update/ambiguity rules. It would create a new format concern, not merely reuse the sparse target ledger. Deferred. |

No package-building pass rewrites authored links or stamps new `expect` values.
A link inserted into its own target scope changes that scope's source digest;
mutually referring scopes can also change one another's digest inputs. Treating
`expect` as the historical copied checkpoint avoids a self-hash fixed-point
problem. The warning can remain for a self-reference; live identity still works.
Any future “accept updated source” action must be explicit and cannot promise
that self-containing references will become digest-equal.
If inserting a link changes a heading or ancestor heading's source, it also
changes the locator; that requires confirmed correspondence just like any heading
edit. Prefer body text and ordinary reference definitions for such links.

## 3. Resolution, cross-file rules and the living-link difference

### 3.1 One adapter, two kinds of evidence

The proposed link adapter accepts the package instance, source document path and
parsed link destination. It returns a navigation target **or** the existing
identity result, plus presentation data such as title and canonical source span.
Keep these outcomes distinguishable; do not manufacture `survives` for a slug.

For a relative destination, normalize the path, load the named current document,
resolve its fragment and obtain its canonical scope. Use inventory/locator lookup
for the resulting section. Computing a fresh root and expected digest at this
moment would prove only that the current section matches itself; it adds no
evidence about the author's intended historical target. Therefore no such
synthetic review reference is persisted or reported as durable resolution.

For a `mdpkg://` destination, use strict parsing and the existing current resolver.
Only a result with an established live scope may become a confirmed preview.
`survives / same-source` and `flagged-changed / source-changed` both display the
current content. The latter also displays the changed-source notice. Retirement
is also `flagged-changed`, so checking the status alone is insufficient: require
the live scope and inspect the reason.

The differences from review comments are deliberate: an author link wants the
live section, has no quoted subrange or comment state, and has no review package
supplying `review.of.current`. Reuse the entity resolver, not `Mdpkg.Reviews`'
thread correlation, quote relocation or export machinery. Existing review
outcomes must remain unchanged.

### 3.2 Path and fragment contract

Resolve a relative path from the **source document's directory**, never from
the web page URL. Inside a preview, the source is the previewed document. A
leading single `/` means package root, consistent with today's viewer. Empty
path plus a fragment means the same document; an empty destination or `#` means
its whole document. No fragment means whole document.

Decode percent escapes once, reject malformed escapes, and apply package path
validation after decoding and dot-segment normalization. Preserve exact path
case and Unicode spelling; do not guess a nearby filename. Reject traversal
above package root, reserved `.git`/`.mdpkg` paths, backslashes, controls,
protocol-relative `//...`, and query-bearing relative links. Encoded separators
must not bypass those checks. For first-version previews accept `.md` and
`.markdown` targets; other ordinary entries stay on the existing navigation/error
path with no new binary preview support.

Extract the current slug rule from `reader-view.js`: displayed heading text is
lowercased; characters other than Unicode letters/numbers, `_`, `-` and whitespace
are removed; whitespace becomes `-`; repeated bases get `-1`, `-2`, etc. in
document order. Preserve normal existing fragments and their case-sensitive
lookup. Keep `mdpkg-section-N` as a legacy navigation alias, not author guidance.
This is an application fragment convention, not the addressing profile or a
claim of compatibility with every Markdown host.

Use a multimap for generated slug candidates. The present `Map.set` can overwrite
a collision such as headings `Foo`, another `Foo`, and `Foo-1`; the planned
adapter reports that destination as ambiguous instead of selecting whichever
heading was last. An exact suffix such as `#foo-1` is usable only when it has one
candidate. Empty slug bases and headings that cannot map to one canonical scope
are also not eligible for a section preview. Offer the document plus section
picker and **Copy Markdown link** to disambiguate.

Only direct-child headings define addressable sections. A displayed heading
inside a list/blockquote can retain its existing navigation behavior but cannot
silently become a new §6 entity. Where GFM display parsing disagrees with the
inventory, use the generated locator and source-view fallback described below.
Do not change `address/outline.js`'s dialect to make a visual heading fit.

Cross-file identity needs no new scheme: the ledger's `to` locator can name a
different document. It succeeds only if the producer confirmed that move and
the target is included in this package. Scope projection can leave a reference
unresolved; the viewer does not search files outside the archive.

Cross-package references are explicitly deferred. A foreign namespace produces
the existing `invalidated / wrong-lineage` answer. A link to another `.mdpkg`
does not auto-open it, fetch it or replace the current package. External HTTPS
and mail links retain ordinary explicit navigation and have no fetched preview.

### 3.3 Required parity work before promising durable links

There are two concrete differences between the implementations to close in the
follow-on build; this investigation found them by code inspection, not a new
runtime test:

1. `PackageSnapshot.Resolve` requires `PackageIdentity reviewed`. With partial
   coverage it permits the current-commit case and otherwise returns
   `history-required`. Loose URIs have no `observedAt`; the browser conservatively
   returns `unconfirmed / incomplete-correspondence` for every such URI carrying
   `expect` under partial coverage. Add a narrow **loose-reference** adapter/API
   to Reader that enforces the same conservative rule and delegates ledger/scope
   work to a shared internal routine. Never pretend the link was observed at
   `snapshot.Identity.Current` to bypass coverage. Do not use `at` as observation
   evidence: it selects the target snapshot. Preserve the existing review API.
2. Reader rejects an absent default-root record when another root owns that
   locator (`unconfirmed / reserved-slot`). The browser resolver currently has
   no equivalent reverse-ownership check, although `referenceFor` handles live
   root selection and reserved-root births when generating links. Add the check
   in the shared browser resolver and cover both languages with an explicit
   fixture before using identity for previews. This prevents a forged/stale
   default root from attaching to a replacement entity.

The eventual .NET URI adapter must also validate version, namespace, supported
profiles, parameter uniqueness, kind/locator agreement and current versus
historical capability just as the browser does. Reuse `DocumentLocator.Decode`
and the existing identity logic. If .NET later generates author links, expose
ledger-aware live-root selection rather than serializing `SourceScope.Root`.
Initial author-link generation can remain browser-only.

Do not conflate resource/IO errors with evidence statuses in a common UI wrapper.
Preserve existing resolver results and offer a separate retry/size explanation
where the application could not attempt the lookup. History is still an
application limitation: the browser's `unsupported / history-reader-required`
does not prove the target commit is absent. An `at` equal to the actual current
qualified commit can use the existing current path; historical `at` never falls
forward.

## 4. Preview behavior

### 4.1 Chosen interaction and CARD-0043 relationship

Choose a click-opened contextual card, with a header naming the target document
and heading, the content, any resolution notice, **Open section/document**, and
**Close**. Keep one card open at a time. A second link replaces it; repeated
activation of the same link closes it. Opening a card leaves the main document,
selected section, document-list selection and scroll position intact.

On a wide viewport position the card beside the phrase where space permits,
otherwise immediately above/below it, within the viewport. On a narrow viewport
use the same nonmodal card at the bottom with bounded height and its own scrolling;
the triggering phrase remains highlighted and the card retains the document/
heading label. It must not become a permanent sidebar or resize the reading
column. Desktop width default: at most 32rem; content height: at most 50dvh;
retain viewport gutters. Validate these defaults with zoom and mobile widths.

The alternatives are meaningful: a hover tooltip is fast but poor for reading
long sections or touch; an inline fold keeps proximity but shifts following
content; a permanent slide-out panel consumes width and separates the preview
from its phrase. The transient card trades possible occlusion for unchanged
document layout, explicit dismissal and small first-version scope.

CARD-0043's locally available mockup A proposes an anchored margin rail and B
proposes inline folds. Their rationale files were read in `docs/design/`; they
were concurrent, untracked design artifacts at investigation start, not shipped
UI or an accepted decision. Borrow the shared contextual title, visible anchor,
quiet border, explicit status and close controls. A later chosen comment UI can
share card styling/placement utilities, but reference previews remain distinct
from authored review threads and require no comment import implementation.

### 4.2 Keyboard, pointer and reader continuity

In the rendered viewer, enhance eligible local links into disclosure controls,
preserving their visible phrase and text nodes. Use button semantics, focusability,
`aria-expanded` and `aria-controls`; Enter and Space toggle the card. Keep actual
navigation inside its explicitly named Open action. A small CSS/SVG cue and
accessible description identify “Preview”; do not insert helper text into the
source-selection article. This follows the interaction and state requirements
of the [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

On activation, focus the card's labelled heading with `preventScroll`, then let
Tab reach its controls and content in ordinary order. The nonmodal card does not
trap focus. Escape and Close dismiss it and restore focus to the origin without
scrolling. Outside pointer activation dismisses it without stealing focus from
the newly clicked control. Focus leaving both origin and card can dismiss it
without moving focus. The card has no hover-only content in version one.

Preserve drag selection, touch selection handles and modified/multi-click
selection gestures. Opening preview must not trigger click-to-select-word or
start a review. Source mode remains literal source. Close/invalidate preview on
source/render change, main-document navigation, package replacement, or origin
removal. Reposition on viewport resize and relevant scrolling; close a desktop
card whose anchor leaves the viewport. Closing a card never discards review
drafts or moves the main reader.

**Open section/document** is the only primary navigation action. Record a single
return location (source document, scope, scroll and origin), navigate through the
existing reader, and provide **Back to reference**. Clear this transient return
state on package replacement; do not persist it into the package. Preview-only
actions must not alter URL history or load Git. Announce loading/failure briefly
through a polite status region, not by announcing the full preview content.

If hover preview is added later, it needs keyboard equivalence and dismissible,
hoverable, persistent content; it must not replace click/tap access. These are
the relevant constraints from
[WCAG's hover/focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).

### 4.3 Rendering, limits and nested links

Render from the target document's complete display parse, retaining its reference
definitions, then select blocks belonging to the canonical target scope. Do not
parse `scope.source` alone as the normal rich preview: a link definition outside
that section would otherwise disappear or resolve differently. Retain exact
source positions when mapping display blocks to the unextended inventory.
If a display block crosses the scope boundary, show labelled canonical source
for that scope instead of guessing which visual text belongs to it.

The preview is a sibling/overlay **outside** the main article used by
`selectionAnchor` and `verifyEndpoint`. Do not instantiate a second full
`readerView` with its global selection listeners. Reuse a factored safe Markdown
surface and table rendering. Prefix preview DOM IDs, avoid contaminating the
main heading/fragment map, and scope any table controls to the preview. Text can
be selected/copied there; commenting on it requires Open section first.

Apply the same link policy, disabled raw HTML, image placeholders and table
overflow rules as the main reader. A link inside the card is resolved relative
to the target document. Internal preview links replace the single card after
explicit activation; no recursive auto-expansion or prefetch occurs. Retain the
original main-reader origin for closing/back. Self-links and cycles therefore
cost one deliberate lookup at a time, not unbounded nested DOM.

Proposed preview-only budgets: inspect entry metadata before reading; skip rich
preview when either compressed or decoded target document exceeds 2 MiB. Display
“Document too large to preview” without claiming an identity result that
was never evaluated. Offer Browse documents when identity was not established;
only enable Open section for an established live scope. For a location-only file
link, explicit Open document remains available without an identity claim.
Enforce the cap on the actual read as well, including reads
triggered through the resolver; do not silently relax the container limits.
For allowed documents, show at most 16,000 UTF-16 units of scope content, rounded
down to whole rendered blocks. If the first block alone exceeds that limit,
show a clearly labelled bounded source excerpt without splitting surrogate pairs.
Always identify excerpts and offer the full target via Open. These are UI limits,
not format limits, and need measurement in the build slice.

Retain at most the active document and one preview target/model, with one
in-flight preview read; deduplicate requests for the same target. Use package,
main-navigation and preview generation tokens to discard stale asynchronous
results. Replace/release old preview state rather than keeping an unbounded
per-link cache. Abort obsolete reads where supported; otherwise invalidate their
result and bound concurrent work. No eager scan of all linked documents and no
Git/dependency import merely to show a current-view preview.
If an obsolete read cannot be aborted, keep only the newest pending request and
start it after the old read finishes; generation guards alone do not limit I/O.

## 5. Missing, changed and uncertain targets

Use the resolver's raw status/reason in diagnostics; translate it into plain
reader-facing text. UI lookup errors are not new format dispositions.

| Result/evidence | Reader behavior | Author/build lint |
| --- | --- | --- |
| Relative path/fragment found uniquely | Preview the current scope; details say it is a location link if identity information is requested. | Pass location lookup; no rename-survival claim. |
| Relative file or heading absent | Show “Target not found”; offer document browsing where available. Do not say deleted. | Warning with source document, location and destination. |
| Relative slug collision or no canonical section | Show “Choose a section”; do not choose a candidate automatically. | Ambiguity/unsupported-target warning; recommend generated URI. |
| `survives / same-source` with scope | Show current content without a warning. | Resolved. |
| `flagged-changed / source-changed` with scope | Show current content and changed-source notice. | Informational by default; not a dangling-link error. |
| `flagged-changed / deleted`, `split`, `merge` | Explain the declared retirement; no old-entity preview. List explicitly supplied successors separately. | Dangling/retired warning; author chooses a replacement. |
| `unconfirmed / incomplete-correspondence`, `unknown`, `missing-override`, `reserved-slot`, or `possibly-renamed-moved-or-deleted` | Explain that the target cannot be confirmed. No automatic preview from the old locator and no similarity/quote fallback. | Unconfirmed warning with exact reason, not “missing = deleted.” |
| `invalidated`, e.g. malformed URI/package, wrong lineage/profile | Inline failure explanation; keep the reader usable. No URI launched through the OS. | Malformed link or unavailable-evidence diagnostic; distinguish package corruption from link typo. |
| `unsupported / history-reader-required` | “Historical preview is not available”; do not substitute current. | Capability diagnostic, not proof that the historical target is missing. |
| Read/decode/resource limitation | Bounded error/size message and appropriate explicit open/retry action. | Separate resource/environment outcome, not false success. |

Successor roots are not locators. Offer a successor preview only if a bounded
lookup can establish its live scope; otherwise display the supplied roots as
details without inventing a URI from the retired target's locator. Clicking a
successor is explicitly choosing another entity, never a repaired original link.
Generic Browse documents remains available even when identity cannot be proved.
Choosing a replacement does not rewrite source or ledger inside this viewer.

## 6. Architectural ownership and implementation slices

All paths below describe future work, not files changed by this investigation.

| Layer | Responsibility |
| --- | --- |
| `src/web-viewer/src/address/` | Existing strict URI parsing and identity/ledger resolver; reserved-slot parity fix; canonical outline unchanged. |
| Proposed `src/web-viewer/src/links/` | Pure destination classification/path normalization, fragment-to-scope index, and adapter combining navigation with existing identity outcomes. Reusable by navigation and preview. |
| `ui/reader-view.js`, `ui/markdown-renderer.js`, proposed `ui/reference-preview.js` | Safe shared display surface; disclosure bindings; card layout, focus, lifecycle, notices and explicit navigation. No ledger mutation or identity heuristics here. |
| `inbound/open.js`, `main.js` | Bounded preview document access; independent generation guards; orchestration and return navigation. Evidence resolution separated from `displayDocument`. |
| `Mdpkg.Reader` | Loose URI contract/parsing and current-view identity reuse, plus exact scope access. Preserve existing review-oriented API and bounded reads. No dependency on Core, Reviews, CLI or browser UI. |
| `Mdpkg.Core` / CLI | Optional author link lint orchestration against the produced/projected package; existing correspondence production remains authoritative. No automatic source rewrite. |
| `Mdpkg.Reviews` | No new responsibility. Regression coverage proves comment identity, selectors and exports remain unchanged. |

### Slice A — executable contract and addressing parity

Create shared fixtures for ordinary destinations, full generated URIs, reserved
births, moves, retirement and partial coverage. Add the browser reverse-ownership
guard and Reader's loose-reference adapter, keeping review callers unchanged.
Define the distinct navigation/identity/capability outputs. Acceptance: a relative
link never gains historical identity; both loose resolvers agree on the supported
current URI cases; a reserved replacement cannot steal an old/default identity.

### Slice B — destination adapter and author copy flow

Extract path/fragment lookup out of main-reader DOM navigation; build the multimap
and canonical scope mapping. Support inline/reference-style links in rendered
prose, headings and table cells; source mode remains unchanged. Add Copy Markdown
link beside existing reference generation, using `referenceFor` for live roots.
Acceptance: worked examples resolve across directories; duplicate/Setext/Unicode
cases are explicit; copied links round-trip through strict parsing without new
URI parameters or source mutations.

### Slice C — in-place preview and continuity

Factor the safe display surface, add the bounded preview controller/card and
separate resolution from navigation. Implement focus/selection isolation, mobile
layout, source fallback, changed/broken states, nested-link context, Open and
Back to reference. Acceptance: all previews are local, opening/closing preserves
reader state, stale loads never resurrect a dismissed/replaced card, and full
document context preserves reference definitions.

### Slice D — optional author linting

Add a separately reported link-check operation/API and an opt-in CLI switch,
for example `pack --check-links` and `validate --check-links`; these names are
proposals, not existing commands. Run on the final projected view, after ledger
construction and before successful pack publication. Resolve generated URIs
through Reader; keep per-link findings separate from format conformance. A broken
author link does not make an otherwise valid v1 package nonconforming.

Default findings are warnings except changed-source notices, which are
informational. An explicit strict-link policy can reject publication for
unresolved/malformed/retired/unsupported targets; report resource-limited checking
as incomplete, never as a pass. Give source path, enclosing block line/column or
exact span when available, destination, status/reason and remediation. Never
claim precise inline positions from block-only metadata.

Use a display-compatible link/heading projection for handwritten-link linting,
without enabling GFM extensions in Reader's addressing inventory. Cross-language
fixtures must cover table link destinations, reference definitions, display text
and Unicode slug rules. If exact display parity cannot be achieved in this slice,
report those cases as unchecked with a reason; do not ship a “checked all links”
claim. Core keeps its existing Reader-only dependency direction; no Reviews
dependency or native Git requirement is added to link resolution itself.

### Slice E — integration acceptance and documentation

Update viewer/producer user documentation with copy workflow, preview behavior,
relative-versus-identity guarantees and limits. Run the applicable checks below,
measure preview memory and bundle cost, and record physical-device testing
separately from emulation. Slices A–C form the first viewer release; D is the
author lint follow-up and should be tracked explicitly rather than implied to
ship with preview. E applies to each release boundary.

## 7. Acceptance matrix and follow-on commands

These are planned acceptance checks; they were not run in this design-only task.

| Area | Cases and observable acceptance |
| --- | --- |
| Syntax | Inline, full/collapsed reference links, titles, escaped labels, code examples and tables; only parsed links activate. Same-file, parent-relative, package-root and file-only examples work. |
| Scope | Top-level ATX, multiline Setext, preamble, duplicate heading sources under different parents, Unicode/emoji, nested sections, headingless files and GFM/inventory disagreements. Full-document reference definitions remain effective in a section preview. |
| Identity lifecycle | Body edit, confirmed heading/ancestor/file/cross-file move, move-back, split/merge/deleted, unknown, missing overrides, absent target, reserved-slot birth and new namespace. Identical words never establish identity. |
| Coverage/capability | Complete/partial coverage with absent observation context; missing/empty/malformed `expect`; malformed/foreign URI and duplicates; historical `at`, current-commit `at`, commit/diff/hunk references. No history fallback or invented current observation. |
| Paths/safety | Percent-encoded spaces/Unicode, malformed escapes, encoded traversal/separators, reserved paths, schemes, protocol-relative destinations and omitted scoped files. No external image/network request on preview. Unsafe HTML remains disabled. |
| UI | Mouse, tap, Enter/Space, Escape, Tab, outside dismissal, long content, 390px viewport, 200% zoom, table overflow and origin visibility. Main document/scope/scroll/selection and drafts stay intact; Open/Back restores the origin. |
| Isolation | Original-source selection and exported quote remain exact with preview open; selected preview text cannot create a comment against the main document. No duplicate IDs, heading-map contamination or review-export bytes changed by preview. |
| Lifecycle/resources | Rapid A/B links, same-target dedupe, close/navigation/package switch during read, target errors, large compressed/decoded entry, oversized block, nested self/cyclic links. Bounded caches/concurrency and zero Git reads for current previews. |
| Lint | Same diagnostic targets as viewer, independent format conformance, informational source changes, strict publication behavior, cancellation/resource incompleteness and final-scope omission. |

From `src/web-viewer/`, use the existing scripts for the applicable build slices:

```powershell
npm ci
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

`test:browser` already builds. Keep the existing V-1/V-2 checks and Review ceiling
of 133,145 eager gzip bytes; do not raise it merely because preview exceeds the
budget. Record the actual before/after bundle report at implementation time, since
other viewer work is concurrent. Do not add a preview library without measuring
the cost. Browser emulation does not establish physical iOS acceptance.

For Reader/Core changes, run from `src/generator-cli/` so its `global.json` applies:

```powershell
dotnet test -c Release
```

If Reader's public API changes, also run the repository's package/consumer gates
as described in [Reader/Reviews acceptance](2026-09-09-card-0037-reader-reviews.md)
and [release guidance](../releases/mdpkg.md). Include shared loose-reference
fixtures in Node and .NET acceptance; keep the existing review consumer working.

## 8. Validation of this investigation and handoff

This plan is grounded in the full card, the current spec and the implementation
paths linked above. The default syntax was checked against CommonMark 0.31.2,
and disclosure/hover guidance against W3C primary sources. CARD-0043 rationale
was used as provisional interaction context, not as an accepted implementation.
No application tests/builds or runtime preview experiments were run: no executable
behavior is being delivered. Documentation checks cover whitespace, cited local
paths and agreement of the complete URI example with the existing spec.

The next decision is whether to authorize a follow-on build under these defaults:
preview-first supported package links, relative destinations without historical
guarantees, generated identity links retaining an advisory `expect`, and a
click-opened contextual card. If approved, begin with Slice A's parity fixtures
and conservative loose-reference contract, then B/C. Track author linting as
Slice D and keep automatic bindings, cross-package loading, history previews,
hover activation and source editing out of the first build.
