# Review comments below section granularity

Status: design investigation with executable evidence, complete. Checked on 2026-09-08. Task
`c2a0d307`. Nothing here is implemented beyond the probes in
[`review-comments/`](review-comments/); this document proposes semantics and prices them, and it
edits no other file. [`docs/spec.md`](../spec.md) is the accepted input and is authoritative
wherever it and this document disagree; §11 below lists what this design would change in it.

**Verdict.** Comments attach at a character range inside a section, and the identity of that
attachment is three separate things that must not be collapsed: the section **root** (§6.2/§6.3 of
spec.md, unchanged), the section **scoped digest** at review time (§6.1, unchanged), and a
**quote-plus-context selector** over the section's canonical source. Positional selectors are not
viable: a character offset is silently wrong on 5.28%–31.32% of anchors after real edits and a line
ordinal on 32.83%–49.30%, against 0.00%–0.06% for a quote with context over the same 96,051 scored
anchors. No new digest profile is needed, because the stored quote *is* the sub-section state
evidence and doubles as the relocation key. Review data belongs in a **second package**, not in the
reviewed one: writing it into the reviewed package would change the `current` the review points at.
The link back is `(namespace, current)` — already in the manifest, invariant under the re-emissions
that change the file's SHA-256, and different whenever the retained lineage differs. A package
content hash is worth carrying as corroborating evidence and is wrong as the identity key; a
package-instance GUID is unnecessary and is rejected with its reason in §7.3.

---

## 1. What already exists, and the gap this fills

spec.md addresses **entities**: a document, a document's permanent preamble, or a heading section
(§2). The finest addressable thing is a heading section, whose identity is a root (§6.2) and whose
reviewed state is a scoped digest (§6.1). Review state itself lives outside the package: §6.6 says
an `unconfirmed` result leaves "the review preserved externally", and §6.4 says the external review
record "SHOULD also keep `observedAt`". The format therefore already assumes an external review
layer and defines the hooks it hangs on; it just never says what that layer looks like, and it
stops one level above where a reviewer actually points.

Two gaps follow, and this card closes both:

1. **Granularity.** A reviewer marks a sentence, a clause, a table row, a line of a fenced block.
   §6 has no vocabulary below the section.
2. **Round trip.** Machine A sends a package; machine B, a different app and a different user,
   reads it, adds comments, and sends something back. spec.md never says what B sends, how it
   points at what A sent, or what A does with it when A's own copy has moved on. The refinement to
   this card makes that workflow the point, not a corollary, so it is §7 here and everything else
   is arranged around it.

Everything below reuses spec.md's existing machinery wherever it reaches. The one genuinely new
piece of format is a selector profile (§2.4). The rest is placement, shape and a link block.

---

## 2. Where a comment attaches

### 2.1 Three layers, kept apart

An anchor is a triple, and each layer answers a different question:

| Layer | Field | Answers | Defined by |
| --- | --- | --- | --- |
| Identity | `root` (+ `loc`) | *Which* entity was reviewed | spec.md §6.2, §6.3, unchanged |
| State | `expect` | *What that entity looked like* when the comment was written | spec.md §6.1, unchanged |
| Position | `select` | *Where inside it* the reviewer was pointing | new, §2.4 below |

This mirrors §6.4's existing separation — "`loc` is a navigation and default-root input, not
identity; `root` is identity; `expect` is the reviewed state" — and extends it by exactly one term.
The layering matters because the three fail independently: a heading rename breaks identity, a body
edit breaks state, and a reflow breaks position, and a reader that conflates them reports the wrong
thing in all three cases.

### 2.2 Resolution is four steps, and the third is usually skipped

Given a review record and a package:

1. Resolve `root` by spec.md §6.5 exactly as written. Anything other than `survives` or
   `flagged-changed` ends here: the comment is `unconfirmed` or `invalidated` and its position is
   never guessed. A resolver MUST NOT search the document for a detached quote.
2. If §6.5 returned `survives`, the section's canonical source is byte-identical to the reviewed
   state, so `select.start`/`select.end` are still exact. Use them and stop. **Measured: in 38,238
   resolutions where the section digest was equal, the stored offsets were still exact 38,238
   times and had moved 0 times** (§9.4). This is the common case: 84.87%–99.92% of threads on the
   corpora, depending on distance.
3. If §6.5 returned `flagged-changed`, the offsets are worthless and the selector re-anchors:
   search the section's canonical source for `select.quote`.
   - exactly one occurrence → `target-relocated` at that offset;
   - several → score each by the length of the agreeing run of `prefix` backwards and `suffix`
     forwards, take the strict winner; on a tie, refuse;
   - none, or a tie → `target-detached`.
4. Report the pair. The §6.6 status is unchanged and still governs the badge; the sub-section
   outcome refines it for display only. A `target-detached` comment stays attached to its section
   and is shown as text the reviewer pointed at that is no longer there — never moved, never
   dropped.

### 2.3 Word, line and character are one mechanism, not three

The probe measured two granularities separately: a whole source line, and a 40-character span taken
from the middle of a line at least 60 characters long — the shape a word- or phrase-level selection
produces. Under the quote-plus-context selector they behave the same. At k=1 on npm, 3,623 of 3,631
line anchors and 1,583 of 1,583 span anchors resolved right, with 0 misplacements in either; on
rust, 1 misplacement in 32,423 line anchors (0.003%) and 2 in 16,151 span anchors (0.012%). The
positional selectors separate them sharply — a line ordinal is *structurally* incapable of
addressing a sub-line span and misplaced 1,582 of 1,583 npm spans and 16,145 of 16,151 rust spans
at k=1, against 130 of 3,631 and 496 of 32,423 line anchors — but that is an argument against line
ordinals, not for a separate span mechanism.

**Decision: version 1 defines one selector kind, a character range over the section's canonical
source.** "Comment on this word", "on this line", "on this sentence" are UI gestures that a
producer converts to a character range at review time. No `lineNumber`, no `wordIndex`, no
`kind: line | word | char` discriminator. This is the same move §6.2 already made when it chose a
heading trail over a line number, for the same measured reason.

### 2.4 The selector profile `cm0312-quote-context-v1`

Named and versioned like the two existing profiles, and pinned to them: it is defined only over the
canonical scope source that `cm0312-source-lf-v1` rule 5 produces, so it inherits LF normalization,
the trailing-whitespace rule and the exact-internal-bytes rule, and it is undefined over anything
else.

```json
{"start": 412, "end": 452,
 "quote": "the producer MUST reject it or relocate ",
 "occurrence": 0,
 "prefix": "reserved region is still needed. A producer ",
 "suffix": "the colliding paths and declare that it did."}
```

| Field | Rule |
| --- | --- |
| `start`, `end` | Character offsets, not byte offsets, into the canonical scope source of the entity `root` names. `0 <= start < end <= length`. Valid only while the scoped digest equals `expect`. |
| `quote` | The exact substring at `[start, end)` at review time. A producer MUST verify this before emitting. Length is producer policy; the probe used 40 characters (§12 item 1). |
| `occurrence` | Zero-based index of `quote` among its occurrences in the scope at review time. Present so a reader can tell a duplicated quote from a moved one; it is a tiebreak of last resort, after context. |
| `prefix`, `suffix` | Up to 40 characters of exact source either side, truncated at the scope boundary. Used only to disambiguate multiple matches. |

Three consequences worth stating because they are decisions, not accidents:

- **The quote is stored in plain text.** That is what lets a delta-only review package be read
  without the original (§7.4), and it is what removes the need for a second digest profile (§3.3).
  It also means a review package discloses the reviewed fragments; where the original is
  confidential the review package inherits that confidentiality. There is no cheaper alternative:
  a 32-byte `SHA-256(quote)` is smaller than a 40-character quote by 8 bytes and cannot search, so
  it can verify a candidate offset but cannot recover from a reflow — the exact case the selector
  exists for.
- **Offsets are retained even though step 3 never trusts them.** They cost 2 integers, they make
  step 2 O(1) in the overwhelmingly common `survives` case, and they record where the reviewer was
  looking when several identical quotes exist.
- **Anchors do not cross entity boundaries.** A selection spanning two sections is two anchors, or
  one anchor on the common ancestor section, which §6.1 rule 3 makes a real scope. Version 1
  defines no cross-entity range (§12 item 2).

---

## 3. Staleness

### 3.1 The digest already there is sound, and only that

The question "is this comment stale?" has a precise answer at section granularity and spec.md
already computes it: `expect` versus the current scoped digest. The probe asked whether that gate
is *sound* — whether the section digest can stay equal while the text a comment points at is
destroyed. Over 923 measurements in which the anchored character run did not survive intact, the
containing section's digest was unchanged **0 times**. That is not luck: §6.1 rule 3 scopes a
section over its whole source including descendants, so any edit to any character the anchor can
point at changes the digest by construction. The probe confirms the construction against real
edits rather than asserting it.

So the section digest is a sound staleness gate for sub-section comments, and no new digest is
needed for correctness.

### 3.2 It is also noisy, and the noise is the reason for the quote

Sound is not precise. The same probe counted anchors whose target survived byte-for-byte inside a
section whose digest nevertheless changed — comments a section-granular product would flag as
needing re-review when nothing the reviewer pointed at had moved:

| corpus | k | anchors whose target survived | section digest also changed | share |
| --- | --- | --- | --- | --- |
| npm | 1 | 5,162 | 642 | 12.44% |
| npm | 2 | 3,967 | 552 | 13.91% |
| npm | 4 | 2,885 | 618 | 21.42% |
| npm | 8 | 1,565 | 692 | 44.22% |
| rust | 1 | 48,314 | 5,447 | 11.27% |
| rust | 2 | 20,171 | 4,020 | 19.93% |
| rust | 4 | 7,062 | 2,434 | 34.47% |
| rust | 8 | 6,002 | 2,888 | 48.12% |

At one revision of separation, roughly one flagged comment in eight is flagged for an edit
elsewhere in the same section; at eight revisions, roughly one in two. The quote is what converts
that flag into a useful three-way answer — `target-intact` (the section changed around you),
`target-relocated` (your text moved), `target-detached` (your text is gone) — and it does so with
no stored state beyond the quote the selector needed anyway.

### 3.3 Why there is no second digest profile

The obvious alternative is a scoped digest over the anchored range, `cm0312-anchor-source-v1` or
similar, stored beside `expect`. It is rejected: it answers strictly less than the quote (equal or
not-equal, with no way to relocate), costs 32 bytes against the quote's 40, and would need its own
canonicalization rules, its own version, and its own row in every table in §6. The quote is the
sub-section state evidence, and comparing it is the digest comparison.

### 3.4 What stays unknown

§6.7's distinction is untouched and applies unchanged one level down. "Does the text I commented on
differ now?" is answered from the current snapshot. "Was the text I commented on edited at any
point after my comment?" is answered only from a range summary (§5.4) whose ordinals cover the
interval, and range summaries are keyed by root and carry per-entity digests, not per-anchor ones.
So the temporal query is answerable at section granularity and **returns `unknown` at sub-section
granularity** in version 1. An edit-then-revert inside a commented sentence leaves the section
digest equal, the quote intact, and the comment reported `survives / target-intact` — which is
correct for the net-change question and silent on the touched question. Do not upgrade it.

---

## 4. Threads and multiple comments

### 4.1 Shape

```json
{"version": 1,
 "anchor": "cm0312-trail-source-v1",
 "profile": "cm0312-source-lf-v1",
 "selector": "cm0312-quote-context-v1",
 "reviewOf": {"namespace": "c1b2d3e4-…", "current": "sha1-…",
              "packageDigest": "sha256-…", "packageBytes": 251778},
 "threads": [
   {"id": "7f1c…", "root": "<64 hex>", "loc": "<base64url(canonicalJson(locator))>",
    "expect": "<64 hex>", "state": "open",
    "select": {"start": 412, "end": 452, "quote": "…", "occurrence": 0,
               "prefix": "…", "suffix": "…"},
    "comments": [
      {"id": "a1…", "at": "2026-09-08T10:04:00Z", "author": "reviewer@example.invalid",
       "body": "This paragraph asserts a default the surrounding text never states."},
      {"id": "b2…", "at": "2026-09-08T11:20:00Z", "author": "other@example.invalid",
       "inReplyTo": "a1…", "body": "Agreed; §4 names it."}]}]}
```

Canonical JSON as §2 of spec.md defines it, so it is byte-stable and diffable, and it is a tracked
file (§6.2 below) so its own edit history is real Git history.

### 4.2 Rules, and why each one

- **The thread is the unit of attachment; comments are the unit of authorship.** One anchor per
  thread, fixed at creation. A reply never re-anchors. This is §6.6's rule — "the review badge MUST
  NOT be moved" — applied to the layer below it.
- **`id` is a random UUID minted at thread creation, not a content hash.** A content hash would
  change every time a reply is added, which breaks the one thing an id is for: a reply from a third
  machine (§7.6) naming the thread it answers.
- **`comments` array order is authoritative; `at` is display metadata.** Two machines with skewed
  clocks produce inconsistent orderings from timestamps, and the review package's own Git history
  already records the true order of edits.
- **Replies are flat with an optional `inReplyTo` naming a sibling.** Nesting is a rendering
  concern; the format stores the edge and not the tree, which keeps the file a list and keeps
  merges (§12 item 6) a list merge.
- **`state` is `open`, `resolved` or `obsolete`, and only the file's own producer sets it.** A
  reviewed party never edits the reviewer's file; it replies with its own review package (§7.6).
  Review packages are append-only artifacts, which is what makes the chain auditable.
- **Several threads may share a `root`, and several may share a `root` and an identical `select`.**
  Two reviewers pointing at the same clause is normal; they are distinct threads with distinct ids.

### 4.3 What a thread costs

Measured on real npm corpus sections, as canonical JSON before container compression:

| | per thread |
| --- | --- |
| Identity (`root` 64 + `expect` 64 + `loc`) | 348–374 bytes |
| Selector (`quote` + `prefix` + `suffix` + offsets + `occurrence`) | 183–195 bytes |
| Fixed overhead before any comment text | ≈ 540 bytes |
| One comment body in the probe | 163 bytes |

The fixed overhead dominates short comments by roughly three to one, and `loc` is the largest single
term: for 200 threads, identity was 70,744 bytes of which roots and digests account for
200 × 128 = 25,600, leaving 45,144 bytes — 19.2% of the whole review document — in base64url
locators. Dropping `loc` is discussed and rejected in §10.

---

## 5. Where review data lives

### 5.1 Four candidate homes

| Where | Verdict |
| --- | --- |
| Tracked inside the reviewed package, under a new path | **Rejected.** Adding a tracked file changes the tip tree, hence `current`, hence the identity every comment in the file points at. The artifact would invalidate its own references on write. |
| Container-level (untracked) entries in the reviewed package | **Rejected as the primary home.** It does not change `current`, which is worse: two byte-different packages would then share one `current`, breaking the correlation key §7.3 depends on. It also needs machine B to re-emit machine A's package, and §6.3's own argument against untracked sidecars applies — no history, does not survive squash as data. |
| A bare `review.json` beside the package | **Rejected as the interchange artifact.** It forfeits the entire container profile: 79-byte typing, central-directory integrity, the LF rule, the text-flag rule, and any history of its own. Measured price of not forfeiting it: a flat 2,613–2,615 bytes on npm scale (§5.2). Permitted as a raw transport payload; it is not what "sending review comments back" means. |
| **A second package, with its own manifest, namespace and curated repository** | **Accepted.** Everything in §3–§5 of spec.md applies to it unchanged, its comment edits are commits, and it can itself be reviewed. |

### 5.2 The price of being a package

Building the same review content as a standalone `.mdpkg` and as an increment folded into the
original, with the deterministic emitter from [`worked-example.py`](../spec/worked-example.py):

| corpus | threads | increment when folded in | standalone review package | standalone overhead |
| --- | --- | --- | --- | --- |
| fixture (2 documents) | 1 | 1,933 | 4,832 | 2,899 |
| fixture | 5 | 4,045 | 6,943 | 2,898 |
| fixture | 20 | 4,390 | 7,289 | 2,899 |
| npm (83 documents) | 1 | 2,484 | 5,098 | 2,614 |
| npm | 10 | 9,386 | 11,998 | 2,612 |
| npm | 50 | 34,850 | 37,463 | 2,613 |
| npm | 200 | 131,520 | 134,135 | 2,615 |

The overhead is flat in thread count to within 3 bytes: a manifest, a `history.json`, a one-commit
curated repository and a central directory. It is 51% of a one-thread review package and 1.9% of a
200-thread one. That is the whole cost of the decision, and it buys the container profile intact.

### 5.3 The path inside the package

`.mdpkg/review/comments.json`, tracked. This needs one change to spec.md §3.6, which today reserves
`.mdpkg/` for container-level entries "except the tracked addressing paths under `.mdpkg/address/`".
`.mdpkg/review/` becomes the second such exception, for the same reason the first one exists: the
data must be tracked so that it has history and survives squash as data, and it must be under the
reserved prefix so it can never collide with a document.

---

## 6. The reviewed side: what machine A ships to make review possible

Nothing. A conforming package is already reviewable: §6.5's resolution reads the manifest, the
ledger when present, and one document, and that is everything the four steps in §2.2 need. No
review-specific entry, field or index is added to the reviewed package, and §4's rule that a
manifest field must be needed before a reader can do anything else is not touched.

One property of the reviewed package does matter, and it is already required: the current view must
be the working tree of `current` (§2, §3.8), because the selector's offsets are into the canonical
scope of the *stored* bytes. D-17 and D-18a are what make that true across machines — a reviewer on
Windows extracting the package gets the same LF bytes the digest was computed over, so an offset
minted on machine B lands on the same character on machine A. Had `core.autocrlf=true` been in
scope for the unpack, every offset would have been off by one per preceding line.

---

## 7. The round trip

### 7.1 The workflow, stated once

1. **A produces** package `P` from its own content. `P` carries namespace `N` and `current = C_A`.
2. **A sends** `P` to B by any transport. The format defines nothing about the transport.
3. **B opens** `P`. B may hold local state about `N` from previous packages — which roots it has
   already reviewed, at which digests. That state lives on B, outside every package, exactly as
   §6.6 says.
4. **B comments**, producing threads whose `root`, `loc` and `expect` are read out of `P`.
5. **B emits** a review package `R` and sends it back. `R` links to `P` (§7.3) and comes in one of
   two shapes (§7.4), B's choice.
6. **A consumes** `R`. A resolves every thread against whatever A's copy of `N` looks like *now*,
   which may be `C_A` or may be many commits later (§7.5).

Steps 4–6 are the only ones the format has to say anything about.

### 7.2 The identity question, measured

What identifies "the exact package B reviewed"? Four candidates, tested with the deterministic
emitter:

| Probe | Result |
| --- | --- |
| Two production runs, identical inputs | Same `current`, byte-identical package, same SHA-256 `66ac4efb…` |
| Same tip tree, different retained history (full lineage vs. truncated to a synthetic root) | Tip trees equal; **`current` differs** (`1a68a3b5…` vs `931c9979…`); 3,812 vs 3,490 bytes |
| Re-emitted at DEFLATE level 9, identical entry payloads and order | **Same `current`, different file**: 251,778 → 251,753 bytes, SHA-256 `67f504a8…` → `19a61433…` |
| Identical content committed one second apart with real timestamps | Tip trees equal; **`current` differs** (`1a68a3b5…` vs `6e8af916…`) |

Read together:

- **The file's content hash is not identity.** It changes under a re-emission that changes nothing
  a reader can observe — a different compression level, and by §3.7's five measured rewrites, any
  ordinary archive tool touching the file. A key that changes when nothing changed will report a
  false mismatch on a correlation that is in fact exact.
- **`current` is identity, and it is finer than the current view.** It differs when the retained
  history differs even though the working tree is identical, and it differs when the same content
  is committed at a different time. It is a manifest field already, it is O(1), and §5.2 already
  makes it equal to the branch target so a validator checks it for free.
- **`(namespace, current)` is the pair, not `current` alone.** §6.4 already rejects a reference from
  a foreign namespace before resolving anything; the same rule must gate a review package, or a
  40-hex collision of intent across two unrelated lineages resolves against the wrong documents.

### 7.3 Decision: `(namespace, current)` is the key, the content hash is evidence, and there is no instance id

```json
"reviewOf": {"namespace": "c1b2d3e4-…", "current": "sha1-…",
             "packageDigest": "sha256-…", "packageBytes": 251778}
```

- `namespace` and `current` are the **correlation key**. Required. A reader matches on the pair and
  on nothing else.
- `packageDigest` and `packageBytes` are **corroborating evidence**, optional but recommended. When
  they match, A knows B held those exact bytes. When `current` matches and `packageDigest` does not,
  A knows B held the same lineage state re-emitted or repacked — which is a fact worth reporting and
  is not an error. When `current` does not match, the digest is irrelevant. This is the same
  identity/evidence split §5.5 already makes for archived patches (bind the hash, prefer the
  archived artifact) and §6.4 makes for `root` versus `expect`.
- **A package-instance GUID is rejected.** Four reasons, in order of weight:
  1. It answers no question the key does not. The correlation question is "which state of which
     lineage did B review", and `(namespace, current)` answers it exactly, including telling apart
     two packages whose working trees are identical but whose retained histories differ — measured
     above.
  2. It would be an unverifiable claim. Two byte-identical packages are, by construction,
     indistinguishable to the receiver: B cannot check an id that corresponds to nothing in the
     bytes it holds. spec.md's existing rule for such things is §5.3's — a claim is checked for
     internal consistency or it is not carried — and an instance id fails that test where every
     other manifest field passes it.
  3. §4's admission rule excludes it. A manifest field earns its place if "a reader needs it before
     it can do anything else". No reader needs an instance id to read anything.
  4. Wall-clock time already distinguishes instances for any producer that does not fix its dates:
     the same content one second apart got a different `current`.
- **The residual case, stated honestly.** A producer that fixes commit dates — as
  [`worked-example.py`](../spec/worked-example.py) does and as the generator CLI's determinism
  section requires — *can* emit two byte-identical packages at different times, and no
  content-derived identifier can tell them apart. If A needs to know *which send* a review answers
  ("the copy I sent Monday, not Tuesday's"), that information is not in the package and no format
  field can conjure it. It belongs to the transport: A supplies a dispatch token with the file, and
  `R` echoes it back in an optional `reviewOf.dispatch` string that the format stores and never
  interprets. Naming it as transport metadata rather than package identity is the point; putting it
  in the manifest would be putting an unverifiable sender-side claim into the one file every reader
  must trust.

### 7.4 Two shapes of review package, both first-class

The requester wants both outcomes pickable. They are pickable at emit time by B, declared in the
manifest, and are the same file format inside.

**`delta` — the review alone.**

- Namespace: a fresh one, B's. `current`: B's own one-commit lineage over `.mdpkg/review/comments.json`.
- The threads' `root` and `expect` values are in `reviewOf.namespace`, *not* in the review package's
  own namespace. This is the one place the two namespaces coexist in a file and the rule must be
  written down: **a thread's `root`, `loc` and `expect` are read in `reviewOf.namespace`.**
- Measured: 5,098 bytes for 1 thread, 11,998 for 10, 37,463 for 50, 134,135 for 200 — against an
  original of 251,778. A 50-thread review travels at 14.9% of the artifact it reviews.
- Use when A already holds the original, which is the normal case, since A produced it.

**`bundled` — the review plus the whole original.**

- Namespace: **`reviewOf.namespace`**, unchanged. The review package is a *continuation of A's
  lineage*: it carries A's curated repository and adds one commit on top, so its `current`'s parent
  is literally `reviewOf.current` and the correlation is structural rather than declared.
- Because it continues A's lineage, B is briefly a producer in A's namespace, and one rule keeps
  that safe: **a review commit MUST change only paths under `.mdpkg/review/`.** No document edits,
  no ledger edits, so no addressing exception is created, every root stays valid, the ledger is
  copied with the tree, and a validator can check the whole claim by diffing the tip tree against
  its parent. This is why bundling is safe for B to do without confirmation authority under §6.3.
- Measured: 254,262 bytes for 1 thread, 261,164 for 10, 286,628 for 50, 383,298 for 200 — that is
  the original plus an increment of 2,484 / 9,386 / 34,850 / 131,520 bytes.
- Use when A cannot be assumed to still hold `reviewOf.current` — an archival hand-off, a third
  party, or a producer that has since squashed the state B reviewed out of existence (§7.5).

Manifest, in the review package only:

```json
"review": {"of": {"namespace": "c1b2d3e4-…", "current": "sha1-…", "packageDigest": "sha256-…"},
           "shape": "delta",
           "detail": ".mdpkg/review/comments.json"}
```

O(1), fixed key set, and it is genuinely read-before-anything-else: it is how a reader tells a
review package from an ordinary one and decides whether it must go and find the original.

### 7.5 When the original moved on

This is not a new problem and it does not get new mechanics. A thread is a §6.4 current reference
without `at`; resolving it against a later state of `N` is §6.5 verbatim, and its outcomes are
§6.6's four statuses. Measured over the real corpus histories, with one thread on every anchorable
section of the base snapshot resolved against a snapshot *k* revisions later:

| corpus | k | threads | survives | flagged-changed | root missing | document gone |
| --- | --- | --- | --- | --- | --- | --- |
| npm | 1 | 641 | 639 (99.69%) | 2 | 0 | 0 |
| npm | 4 | 641 | 638 (99.53%) | 3 | 0 | 0 |
| npm | 16 | 641 | 597 (93.14%) | 37 | 1 | 6 |
| npm | 32 | 641 | 544 (84.87%) | 79 | 5 | 13 |
| rust | 1 | 8,967 | 8,960 (99.92%) | 0 | 7 | 0 |
| rust | 4 | 8,967 | 8,960 (99.92%) | 0 | 7 | 0 |
| rust | 16 | 8,967 | 8,952 (99.83%) | 8 | 7 | 0 |
| rust | 32 | 8,967 | 8,948 (99.79%) | 12 | 7 | 0 |

Thirty-two producer revisions after the review was written, 84.87% of npm threads still resolve
`survives` and their stored offsets are still exact; 12.32% are `flagged-changed` and go to the
selector; 0.78% resolve `unconfirmed` because the default root is gone with no ledger entry, and
2.03% because the document is gone. Inside the `flagged-changed` set the selector earns its keep:
of 79 npm threads at k=32, the quote put 77 in the right place, 2 in the wrong place and refused
none, while a stored character offset got 48 right and 31 wrong.

Squash and truncation need no new thinking either, and §6.6's matrix already contains the answers:

| Producer operation between send and return | What happens to a thread |
| --- | --- |
| Repack, re-ZIP, re-emit at another level | `survives`. Identity is `current`, not the file's bytes (§7.2). |
| New commits | Per the table above: `survives` if the digest is equal, else `flagged-changed` into the selector. |
| Squash of the range containing `reviewOf.current` | `survives` if the entity and the ledger are retained; the ledger is copied with the tree. The *thread* is unaffected because it carries no `at`. |
| Truncation past `reviewOf.current` | Same. `unconfirmed / incomplete-correspondence` only where `addressing.coverage` is `partial` and the review falls in an uncovered range. |
| A document or heading rename A confirmed | `survives` via the ledger's `to` binding, exactly as for a section reference. |
| A rename A did *not* confirm | `unconfirmed / possibly-renamed-moved-or-deleted`. The comment is preserved and shown as unreviewed; it is never transferred. |

One thing the review package buys that a bare reference cannot. §6.5 step 1 says that when
`addressing.coverage` is `partial` and `observedAt` was not supplied, the resolver "cannot establish
which range the review was made in" and must return `unconfirmed`. `reviewOf.current` **is** the
`observedAt` of every thread in the file, carried once for the whole review rather than 45 bytes at
a time per thread. So a review package makes the coverage check possible where a loose reference
leaves it unanswerable — and it makes §6.7's touched query answerable for the whole review from one
range-summary lookup per root.

The measurement above is also the argument against the alternative design of resolving a review
package by *replaying* it onto the original state and then forward — there is nothing to replay.
The threads are references; the package they point at is either still resolvable or it is not, and
`bundled` shape exists precisely for the case where B could not assume it would be.

### 7.6 Chains: A replies to B

`R` is an ordinary package with a namespace and a `current`. A's reply is therefore a review package
whose `reviewOf` names `R`, and whose threads' roots address entities of `R` — or, more usefully in
practice, a review package that re-reviews `P` and carries `inReplyTo`-style linkage by thread `id`.
Version 1 should permit the first (it falls out of the design with no new rules) and define nothing
for the second beyond the stable thread `id` in §4.2, which is what makes it possible later. Merging
two review packages into one is out of scope (§12 item 6).

---

## 8. Awkward cases

| Case | Behaviour |
| --- | --- |
| The commented text is deleted outright | §6.5 says `flagged-changed`; the selector says `target-detached`. Thread stays on the section, marked as pointing at text that is gone. |
| The section is renamed and A confirmed it | `survives` via the ledger; the offsets are still checked against the digest, so a rename that also edited the body correctly falls through to the selector. |
| The section was split (`dead: split`) | `flagged-changed` with successors, per §6.3. The selector is **not** run against the successors: a quote search across a successor set is precisely the "silently transfer a review" behaviour §6.3 forbids. Offer the successors as navigation; leave the thread where it is. |
| Reserved-slot birth — a new section at the old locator | The old root is held by the ledger, the newcomer has a fresh random root, and the comment cannot attach to the replacement. §6.3 already guarantees this and the selector never gets a chance to undo it. |
| Duplicate identical quotes in one section | `occurrence` at review time, context scoring at read time, refusal on a tie. Measured cost of refusing: 0.15%–0.43% of anchors resolve `target-detached` that a guess would have placed correctly. |
| A whole-document mechanical reformat | Measured on rust: at k=1, 8,973 of 17,639 sections in changed documents lost their default root, and 8,796 of those 8,973 are recovered by ignoring heading rank alone — a `#`→`##` demotion sweep, with 611 of 1,102 revision pairs losing every section at an unchanged section count. Without a ledger this is `unconfirmed` for every comment in the document; with confirmed exceptions it is a bulk `to` binding. This is not a review-comment problem and this card adds nothing to it, but it is the largest single source of lost comments in the measurement and the strongest argument that a producer performing a mechanical sweep must confirm it. |
| A comment on a fenced code block or an HTML block | Works. §6.1 rule 2 keeps heading-like text inside them from opening sections, but the characters are still in the enclosing section's scope, so a character range addresses them normally. |
| A comment on the preamble | Works unchanged; the preamble is an entity with a permanent identity (§6.1 rule 4). |
| A comment on a document-level scope | Works, but the offsets are into the whole document, so almost any edit changes `expect` and sends every such comment to the selector. Prefer the narrowest containing section. |
| Machine B's clock is wrong | Nothing depends on it. `at` is display metadata (§4.2). |

---

## 9. Method and its limits

### 9.1 Corpora and populations

Two probes over two bodies of real Markdown:

- **Anchor stability** ([`measure_anchors.mjs`](review-comments/measure_anchors.mjs)) over 1,152
  real modification pairs pulled from the corpus repositories' first-parent history
  (`npm-cli docs/lib/content`, `rust-lang/rfcs text`), assembled into per-document revision chains:
  25 npm documents over 75 revisions, 630 rust documents over 1,732 revisions. Anchors are placed at
  revision *i* and re-resolved at *i+k* for k ∈ {1, 2, 4, 8}: 96,051 scored anchors in total, four
  per section as whole lines and two as 40-character mid-line spans, chosen by a hash of their
  offset so the selection is deterministic and unrelated to what was later edited.
- **The return trip** ([`measure_return.mjs`](review-comments/measure_return.mjs)) over the 33
  snapshot histories the addressing card already pinned, with one thread on every anchorable
  section of snapshot 0 (641 npm, 8,967 rust) resolved at snapshots 1, 4, 16 and 32.
- **Round trip and sizes** ([`roundtrip.py`](review-comments/roundtrip.py)) reusing
  [`worked-example.py`](../spec/worked-example.py)'s Git and ZIP writers unchanged, so every byte
  count comes from the emitter §8 of the spec measured.

### 9.2 Ground truth

A patience-style line diff with a bounded character-level LCS inside each unmatched run. An anchor's
target "survives" when every character of it maps contiguously into the later revision and the
mapped text is byte-identical. The ground truth sees both revisions; every selector sees only the
stored anchor and the later section. That asymmetry is the point of the experiment, and it is also
its main limitation: the ground truth is itself a diff heuristic, so a case where patience diff and
a human would disagree about "the same text" is scored against the diff.

### 9.3 What conditioning was applied

Selector outcomes are measured **conditional on the section being found by its heading trail**,
because a section that is not found never reaches step 3 of §2.2 — it is `unconfirmed` at step 1 and
its comment is preserved untouched. Sections lost to a changed trail are counted separately and
reported in §8. The probe runs without an override ledger, so the trail-loss figure is the
worst case, not the format's behaviour: in a real package a confirmed rename is a `to` binding and
the section is found.

### 9.4 Headline numbers

Silently wrong = the selector returned a position and it was not the right one, or it returned a
position where the target no longer exists. Refused = it returned nothing where the target survived.

| corpus | k | scored anchors | selector | right | silently wrong | refused |
| --- | --- | --- | --- | --- | --- | --- |
| npm | 1 | 5,214 | line ordinal | 67.11% | 32.83% | 0.06% |
| npm | 1 | 5,214 | char offset | 92.87% | 6.87% | 0.27% |
| npm | 1 | 5,214 | quote + occurrence | 99.94% | 0.06% | 0.00% |
| npm | 1 | 5,214 | quote + context | 99.85% | 0.00% | 0.15% |
| npm | 8 | 1,627 | line ordinal | 62.57% | 37.43% | 0.00% |
| npm | 8 | 1,627 | char offset | 74.12% | 25.08% | 0.80% |
| npm | 8 | 1,627 | quote + occurrence | 99.82% | 0.18% | 0.00% |
| npm | 8 | 1,627 | quote + context | 99.57% | 0.00% | 0.43% |
| rust | 1 | 48,574 | line ordinal | 65.74% | 34.26% | 0.00% |
| rust | 1 | 48,574 | char offset | 94.67% | 5.28% | 0.04% |
| rust | 1 | 48,574 | quote + occurrence | 99.99% | 0.01% | 0.00% |
| rust | 1 | 48,574 | quote + context | 99.69% | 0.01% | 0.30% |
| rust | 8 | 6,174 | line ordinal | 50.58% | 49.30% | 0.11% |
| rust | 8 | 6,174 | char offset | 68.51% | 31.32% | 0.16% |
| rust | 8 | 6,174 | quote + occurrence | 99.94% | 0.06% | 0.00% |
| rust | 8 | 6,174 | quote + context | 99.64% | 0.06% | 0.29% |

k = 2 and k = 4 rows are in [`anchor-results.json`](review-comments/anchor-results.json) and follow
the same monotone pattern: positional selectors decay with distance, the quote does not.

**Occurrence versus context is a real choice and it goes to context.** Occurrence matching is right
slightly more often overall; it is wrong 3–5 times per corpus and never refuses. Context matching is
wrong 0–4 times and refuses 7–147 times. The design takes context, with occurrence only as a
last-resort tiebreak, because §6.6's stated principle is that an uncertain result must not move the
badge, and a refusal is a visible `target-detached` while a misplacement is invisible. The price is
0.15%–0.43% of anchors marked detached that a guess would have placed correctly.

---

## 10. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Line number, or line ordinal within the section, as the anchor | Silently wrong on 32.83%–49.30% of anchors after real edits; structurally cannot address a sub-line span |
| Character offset alone as the anchor | Silently wrong on 5.28%–31.32%, rising with distance; correct only while the digest is equal, which is exactly when the quote is not needed |
| A stored digest of the anchored range | Answers strictly less than the quote (equal / not equal, no relocation), costs 32 bytes against the quote's 40, and needs its own profile, version and canonicalization |
| Storing `SHA-256(quote)` instead of the quote | 8 bytes smaller and cannot search; recovers nothing after a reflow |
| Separate `line` / `word` / `char` selector kinds | Measured indistinguishable under quote-plus-context matching (0.003% wrong for line anchors, 0.012% for span anchors at k=1); one character range covers all three |
| Re-anchoring across a `dead: split` successor set | A quote search over successors is the silent review transfer §6.3 forbids |
| Review data tracked inside the reviewed package | Changes the tip tree, hence `current`, hence the identity every comment points at |
| Review data as untracked container-level entries in the reviewed package | Two byte-different packages would share one `current`; no history; §6.3's argument against untracked sidecars applies unchanged |
| A bare `review.json` as the interchange artifact | Forfeits typing, CRCs, the LF and text-flag rules, and any history, to save a flat 2,613–2,615 bytes |
| Package file content hash as the correlation key | Measured unstable under a conforming re-emission: same `current` and same entry payloads, 251,778 → 251,753 bytes, different SHA-256. Retained as corroborating evidence, not identity |
| A package-instance GUID in the manifest | Answers no question `(namespace, current)` does not; unverifiable by the receiver; fails §4's admission rule; wall-clock time already separates instances for any producer that does not fix dates. Dispatch tracking belongs to the transport (§7.3) |
| `current` alone, without the namespace | §6.4 already rejects foreign namespaces before resolving; a review key must do the same |
| Dropping `loc` from threads in `bundled` shape, deriving roots by scanning the bundled tree | Real and measured: 45,144 bytes for 200 threads, 19.2% of the review document. Rejected because it makes `delta` and `bundled` structurally different files and contradicts §6.4's "`loc` is REQUIRED"; reconsider only if review volume becomes a measured problem (§12 item 4) |
| A new `mdpkg://` reference kind for a comment target | The URI grammar addresses entities the package defines; a comment target is not one. The anchor lives in the review file and the grammar stays frozen |
| Per-thread `observedAt` | `reviewOf.current` is the same value carried once for the whole file; §6.4 already keeps `observedAt` out of the reference key |
| A review package replaying its threads onto the original state and forward | There is nothing to replay: threads are `at`-less references and §6.5 resolves them against the current state directly |

---

## 11. What this implies for spec.md, and what stays out

### 11.1 Changes implied

Each is small, and each names the section it lands in. This card edits none of them.

1. **§3.6** — add `.mdpkg/review/` to the tracked-path exceptions beside `.mdpkg/address/`, with the
   same justification (must be tracked to have history and survive squash as data).
2. **§4** — an optional manifest object `review = {of: {namespace, current, packageDigest?,
   dispatch?}, shape: "delta" | "bundled", detail}`, present only in a review package. O(1), fixed
   key set, read before a reader can decide whether to look for the original. Plus two validator
   obligations: a `bundled` review package's namespace MUST equal `review.of.namespace` and its tip
   commit MUST change only paths under `.mdpkg/review/`; a `delta` review package's namespace MUST
   differ from it.
3. **§6, new subsection** — the selector profile `cm0312-quote-context-v1` (§2.4 here), the
   four-step resolution (§2.2), and the sub-section outcome triple `target-intact` /
   `target-relocated` / `target-detached` as a refinement of, never a replacement for, §6.6's four
   statuses.
4. **§6.6** — one sentence, not a new row: a review-package thread has exactly the stability of the
   document/section row it is anchored in, because it *is* such a reference.
5. **§6.5 step 1** — a note that `reviewOf.current` supplies the `observedAt` the step says is
   otherwise unavailable, so the `partial`-coverage check is decidable for a review package.
6. **§9** — the twelve rejected alternatives in §10 above, with their measured reasons.
7. **§10** — new D-numbers for: one selector kind rather than three; quote-plus-context over
   occurrence-only; no sub-section digest profile; the review package as a separate package; the
   two shapes; `(namespace, current)` as the correlation key with the content hash as evidence; no
   instance id.
8. **§11.2** — the open questions in §12 below.
9. **`docs/spec/generator-cli.md`** — a `review` verb and its non-goals row, once the above lands.
   Not designed here.

### 11.2 Explicitly out of scope

- **Rendered-output review.** Already §11.2 item 10 of spec.md and unchanged by this card: a comment
  on how something renders needs a context digest this selector does not provide.
- **Comments anchored to a diff or a hunk.** §6.4 has `diff` and `hunk` reference kinds and a
  comment could in principle attach to one. Version 1 does not define it; the anchor here is over a
  section's source, not over a patch.
- **Authenticity.** `packageDigest` is integrity, not a signature. §5.4 already says summary hashes
  are "not signatures or proof of producer honesty"; the same applies to every hash in a review
  package. Signing is a layer above this format.
- **Attachments in comments.** Version 1 defines no mechanism for tracked binary content (D-17
  scope), so an image in a comment has nowhere to live.
- **Merging two review packages**, or reconciling conflicting threads from two reviewers.
- **The transport.** How `P` reaches B and `R` reaches A, and what a dispatch token looks like.
- **Review UI.** Which gesture produces which character range, how a badge is drawn, how a
  `target-detached` thread is presented.
- **Editing spec.md.** This card's brief forbids it and it has not been touched.

---

## 12. Open questions

1. **Quote length.** 40 characters is a probe constant with no optimum behind it. The trade is
   ambiguity (shorter quotes match in more places) against fragility (longer quotes are broken by
   more edits) against size (roughly 3 bytes per thread per character, counting prefix and suffix).
   A sweep over 16/24/40/64/96 on the same corpora would settle it and was not run.
2. **Anchors spanning entity boundaries.** Undefined in version 1. The probe saw 0–6 anchors per
   run whose target left its section entirely; that is a related signal, not this question.
3. **Unicode.** §6.1 deliberately does not normalize Unicode, so a selector minted over NFC source
   will not match NFD source. Whether that ever happens in practice, and whether the selector should
   say anything about it, is unmeasured — and it sits next to §11.1 item 3 of spec.md, the untested
   NFC/NFD filesystem collision.
4. **Volume.** 200 threads measured. The ≈540-byte fixed cost per thread means 5,000 threads is
   about 2.7 MB before any comment text, which is the same shape of problem as §11.2 item 6's ledger
   density and probably wants the same answer. Unmeasured.
5. **Reply chains three deep.** `R` reviewing `R'` reviewing `P` falls out of the design with no new
   rules and has not been built.
6. **Merging review packages.** Two reviewers, two `R`s, one A. A can consume both independently;
   producing a single merged review artifact is undefined.
7. **Whether `bundled` should ever be allowed to carry ledger changes.** The rule in §7.4 forbids
   it, which is safe and may be too strict for a reviewer who legitimately confirms a rename.
8. **Cost of the selector on a cold reader.** §6.5's measured resolution reads the manifest, the
   ledger and one document; the selector adds a substring search over one section and no I/O. Not
   separately timed.

---

## 13. Reproduction and evidence

Everything below runs from the repository root and reuses the corpus checkouts the compression and
addressing cards already pinned under `.antiphon/`.

```
python docs/investigations/review-comments/prepare_pairs.py       # real revision pairs from both repos
node   docs/investigations/review-comments/npm_targets.mjs        # real npm roots, digests, anchors
node   docs/investigations/review-comments/measure_anchors.mjs     # selector comparison, ~2 min
node   docs/investigations/review-comments/measure_return.mjs      # the return trip
node   docs/investigations/review-comments/measure_trail_loss.mjs  # why default roots vanish in rust
python docs/investigations/review-comments/roundtrip.py            # identity probes and package sizes
python docs/investigations/review-comments/render_tables.py        # every table quoted above
python docs/investigations/review-comments/verify_evidence.py      # 161 checks, 0 failures
```

| File | What it holds |
| --- | --- |
| [`anchors.mjs`](review-comments/anchors.mjs) | The four selectors and the diff-based ground truth |
| [`anchor-results.json`](review-comments/anchor-results.json) | 96,051 scored anchors, by corpus, distance and granularity |
| [`return-results.json`](review-comments/return-results.json) | 9,608 threads resolved at four distances |
| [`trail-loss-results.json`](review-comments/trail-loss-results.json) | Default roots lost to heading-trail change, and how many are a rank sweep |
| [`roundtrip-results.json`](review-comments/roundtrip-results.json) | Six package-identity probes and both review-package shapes at four thread counts |

Environment: Windows 10, Git 2.50.1, Python 3.10.2, Node v24.6.0, commonmark 0.31.2. The anchor and
return probes are pure functions of the stored corpora and are deterministic; the package sizes
depend on the Git version, exactly as [`generator-cli.md`](../spec/generator-cli.md) §12 says.
