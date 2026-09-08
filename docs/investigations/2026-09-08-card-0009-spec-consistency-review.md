# CARD-0009: consistency review of docs/spec.md against its four sources

Status: review only. Nothing was redesigned, and no file outside this one was edited. Checked on
2026-09-08 at `cf496ab` (the tip after D-16/D-17/D-18 landed).

**Verdict: the specification is internally coherent on its architecture — every C1–C12 conflict is
actually resolved, every D-1…D-18 default is stated once and none is missing or duplicated, and the
worked example in §8 reproduces from `docs/spec/worked-example.json` byte for byte. The defects
found are localized: four numeric transcriptions that reverse or misattribute a measured percentage,
one normative rule (§5.4 `sourceCommits`) that contradicts the artifact the spec ships beside it,
one three-way scope disagreement introduced by D-17, several implementation gaps, and three source
investigations that were not annotated when D-16/D-17/D-18 landed (container.md was).**

What was read end to end: `docs/spec.md` (742 lines), `docs/investigations/compression.md`,
`history.md`, `addressing.md`, `container.md`, `docs/spec/worked-example.py` and
`docs/spec/worked-example.json`. Every measured figure quoted in spec.md §3, §4, §5, §6, §9 and §11
was traced back to the rendered table in the investigation that produced it; every §8 byte offset,
size, CRC, digest and hash was checked against `worked-example.json`.

---

## 1. Confirmed wrong: numbers

### F-1. `spec.md:41` and `spec.md:652` — the 2.44% figure belongs to a different experiment

C9 says "history.md measured that deflating the pack saves 2.44% on npm"; §9's rejected-alternatives
row repeats "2.44% npm saving". `history.md:80` measures two separate sensitivities in one
paragraph: the packing-window change (159,296 to 155,405, **2.44%**) and deflating every outer ZIP
entry (159,296 to 156,507, **1.75%**). The spec has attached the window number to the deflate row.
`spec.md:662` then legitimately uses 2.44% for the window-250 row, so the same figure now appears
twice for two different experiments.

Fix: `spec.md:41` and `spec.md:652` should read **1.75%** (2,789 bytes of 159,296). The direction and
the "Rust gets larger" clause are both correct.

### F-2. `spec.md:658` — bundle-versus-packed percentage is on the wrong basis

"Git bundle … 7.57% / 0.74% smaller than the packed repository." `history.md:229` states the
converse: packed Git "costs only **7.57% more** than B for npm and 0.74% for Rust". Restated as
"smaller than the packed repository" the basis changes: 11,216 / 159,296 = **7.04%**, and
24,346 / 3,312,849 = **0.73%**.

Fix: either **7.04% / 0.73% smaller than the packed repository**, or keep 7.57% / 0.74% and write
"the packed repository costs 7.57% / 0.74% more than a bundle".

### F-3. `spec.md:659` — flat-diff percentage is on the wrong basis and against the wrong comparator

"Flat base plus ordered diffs … 13.50% / 3.95% larger at 32 commits." `history.md:5` uses 13.50% /
3.95% for "the **bundle** is that much **smaller** than flat" (basis = flat). Flat is larger than
the bundle by 15.61% / 4.12%, and larger than the *adopted* packed repository by **7.47% / 3.35%**
(171,192 vs 159,296; 3,423,817 vs 3,312,849).

Fix: since §9 lists what was rejected in favour of the packed repository, use **7.47% / 3.35% larger
than the packed repository at 32 commits**.

### F-4. `spec.md:360` — timing attributed to work it does not include

"Parsing and hashing one document took 0.87 / 0.56 ms." `addressing.md` reports 0.87 / 0.56 ms as
the **parse-only** warm median, and **1.19 / 0.86 ms** for the full in-memory resolver, which is
what parse-plus-hash-plus-compare actually costs.

Fix: quote 0.87 / 0.56 ms as parse time, or quote 1.19 / 0.86 ms for the resolution.

---

## 2. Confirmed wrong: a normative rule contradicted by the shipped artifact

### F-5. `spec.md:253` — `sourceCommits` position rule is off by one against §8 and `worked-example.json`

§5.4 defines: "`sourceCommits` | Ordered source commit IDs; **position 0 is `base`**, ordinal *n* is
the *n*-th transition".

The artifact does not do this. `worked-example.py:348` writes
`'sourceCommits': ['sha1-' + c1, 'sha1-' + c2]` — `base` (`c0`) is **not** in the array; it is
carried in the separate `base` field. `worked-example.py:341-344` builds `changedAt` with
`enumerate(..., start=1)` over the transition pairs, so ordinal *n* corresponds to
`sourceCommits[n-1]`. `spec.md:609` then reads `observedAt = c1` as "**position 1** in
`sourceCommits`" — correct against the artifact (1-based ordinal), and impossible under §5.4's rule,
which would put `c2` at position 1.

This is not cosmetic. An implementer following §5.4 literally prepends `base` to the array and every
ordinal in `changedAt` shifts by one, so the `(from, to]` touched query in §5.4 and §6.7 returns the
wrong answer at both endpoints. `addressing.md` states the intended rule correctly: "ordered full
source commit IDs with **1-based transition ordinals**. Base is position 0" — meaning ordinal 0
denotes the base *state*, not an array slot.

Fix: `spec.md:253` should read "Ordered source commit IDs, one per transition; `sourceCommits[n-1]`
is the commit produced by transition *n*. Ordinals are 1-based; ordinal 0 denotes the `base` state,
whose commit is in the `base` field and is not an element of this array."

Related, same table: `endpoints` (`spec.md:258`) is documented as "root → `{before, after}` digests"
without saying which roots appear. `worked-example.py:351` emits it only for `sorted(changed_at)`,
i.e. touched entities, matching `addressing.md`. Worth stating explicitly.

---

## 3. Confirmed wrong: presentation

### F-6. `spec.md:497,499` — two offset labels in the §8.2 typing hexdump are wrong

The dump was reflowed from `worked-example.json`'s `typing_hex` (fixed 16-byte rows) into semantic
groupings, but the original row labels were kept. Actual extents of the four printed lines are
0–17, 18–36, 37–49, 50–78; the labels read `000000`, `000010`, `000020`, `000032`. Read as hex
(`0x32` = 50, the only reading under which the last label is right) the second and third are off by
2 and by 5.

Fix: `000010` becomes `000012`, `000020` becomes `000025`. The byte content, the CRC annotation
(`de df 7a bd` = `bd7adfde`), the `21 00` = 1980-01-01 date note and the "magic begins exactly at
byte 50" claim are all correct.

### F-7. `spec.md:206` — SHA-256 config says "additionally" where it means "instead"

"`[core]\n\trepositoryformatversion = 0\n\tbare = false\n` (for SHA-256 repositories, **additionally**
`repositoryformatversion = 1` …)". A config cannot carry both values. Fix: "instead".

---

## 4. Real implementation gaps and ambiguities

### F-8. `spec.md:711` (D-17) contradicts `spec.md:52` (§2) about what the current view holds

D-17 scopes the write-time LF rule to "the content **the current view is defined to hold** — Markdown
documents and the JSON control files under `.mdpkg/` (§2, §4, §6.3)". §2 (`spec.md:52`) defines
container-level entries as exactly `.mdpkg/manifest.json`, `.mdpkg/history.json`,
`.mdpkg/history/bindings.json`, `.mdpkg/history/ranges/*.json` and `.mdpkg/history/patches/*.patch`
— the entries that are **not** tracked in Git and therefore by §2's own definition **not** in the
current view. Only `.mdpkg/address/overrides.json` (§6.3) is both under `.mdpkg/` and in the current
view.

There are now three different scope statements for one rule:

| Where | Scope claimed |
| --- | --- |
| `spec.md:147` (§3.6) | "Document *content* is normalized to LF" — documents only |
| `spec.md:711` (D-17) | documents plus the `.mdpkg/` JSON control files, called "current view" content |
| `spec.md:52` (§2) | those `.mdpkg/` JSON files are explicitly *not* current-view content |

Nothing anywhere states that `.git/**` is out of D-17's scope. That matters: D-17's justification for
needing no binary-detection heuristic is "Version 1 defines no mechanism for tracking an opaque or
binary entry in the current view" — true of the current view, but `.git/objects/pack/*.pack` and
`*.idx` are binary ZIP entries in every package, and a producer reading D-17's "so both ZIP entry
payloads and Git blobs hold only LF-terminated text" literally would corrupt them.

Fix (one line, no design change): restate D-17's scope as "every ZIP entry other than `.git/**`",
and drop the "current view" framing that §2 contradicts.

### F-9. D-17 forces blob rewriting on import, and nothing says so

D-17 says Git blobs hold only LF, without limiting that to the tip. Every retained historical blob in
the pack must therefore be LF too, so importing a source repository containing CRLF blobs cannot
preserve source blob bytes or source blob IDs. This is stated nowhere, and it directly contradicts
`history.md:22`, which characterises the projection as "**Source blobs remain byte-identical**"
while rewriting only commit and tree IDs. §5.3's `sourceRepository` / `sourceBase` / `sourceTip`
provenance is unaffected in shape but now means something weaker.

Fix: one sentence in §5.3 or D-17 saying that a projection from a CRLF source rewrites blobs, and
therefore blob IDs, and that `sourceBase` / `sourceTip` remain source-lineage identifiers only.

### F-10. D-16 and D-17 are producer-only MUSTs with no reader or validator behaviour

`spec.md:140` heads §3.6's constraints "Producer requirements:", and D-16's uniqueness rule and
D-17's LF rule live there. Neither appears in §4's validator rejection list (`current` mismatch,
`overrides` mismatch, `transform` mismatch), in §3.3's reader rejection rule (method not 0 or 8), or
in §3.7's conforming/recoverable tiering. So:

- A package with `README.md` and `readme.md` types as conforming at offset 0 and passes every stated
  validator check, and a reader that extracts it reproduces exactly the silent data loss
  container.md measured on all four extractors and on Git's own NTFS checkout.
- A package storing CRLF resolves *identically* to a conforming one, because §6.1 rule 1
  re-normalizes. Nothing defines it as nonconforming, and §6.1 explicitly anticipates such input
  ("well-defined over nonconforming input too") without any rule creating the category.

Fix: add both to §4's validator list, or state explicitly that they are unchecked producer
obligations.

### F-11. `spec.md:162` and D-18 bind a role §2 never defines

"a conforming **extractor** MUST NOT convert line endings on checkout". §2's terminology defines
producer, reader and validator only. §3.7 and §9 elsewhere rest the whole design on ordinary ZIP
tools the format cannot constrain, and Info-ZIP `unzip -a` is a real counterexample. As written the
MUST NOT has no conformance class and no addressee.

Fix: define "extractor" in §2, or reword as a property of the format ("the format defines no
checkout-time conversion; a tool that converts line endings is not producing the format's
extraction").

### F-12. `loc` is required by §6.5 but never declared mandatory in §6.4

`spec.md:352` step 2: "absent → if `root` equals the default root of `loc`, the target locator is
`loc`". Without `loc` a resolver cannot invert SHA-256 to recover the locator, so every
non-exceptional document or section reference is unresolvable. §6.4 shows `loc=` in the grammar but
describes it as "a navigation and default-root **hint**, not identity", which reads as optional.

Fix: state in §6.4 that `loc` is REQUIRED on `document` and `section` references.

### F-13. `profile` means two different things across reference kinds; §6.5 step 1 only handles one

§6.4: `document` and `section` refs carry `profile=<digestProfile>`; `diff` and `hunk` refs carry
`profile=git-myers-u3-v1`. §6.5 step 1 rejects "if `namespace`, `anchor` or `profile` differ from the
manifest" — the manifest has no diff profile, so the rule cannot be applied to diff or hunk
references as written.

Fix: scope step 1 to document and section references, or rename the diff parameter.

### F-14. `partial` coverage has no defined behaviour when `observedAt` is absent

`spec.md:185` (§4): under `partial`, "a resolution whose reviewed commit falls in an uncovered range
returns `unconfirmed`". `spec.md:351` (§6.5 step 1) hedges with "the review's `observedAt` (**when
supplied**)". But §6.4 is explicit that `observedAt` is "not part of the reference" — so in the
normal case the resolver does not have it, and neither section says what happens then.

Fix: say which way it falls (resolve normally, or return `unconfirmed / incomplete-correspondence`).

### F-15. `.mdpkg/history.json` is the only control file with no `version` field

The manifest carries `mdpkg`, `overrides.json` carries `"version":1`, `bindings.json` carries
`"version":1`, and range summaries carry `"version":1` (D-5). §5.3's field table defines none for
`history.json`, and `worked-example.json` confirms the emitted file has none.

Fix: either add `version` for consistency, or state that `history.json` is versioned by the manifest.

### F-16. §3.3 says the manifest is stored "always" without acknowledging §3.7's recoverable tier

§3.3's table gives `.mdpkg/manifest.json` method "`0` (stored) always". §3.7 tier 2 is entered
precisely when a rewrite has deflated the manifest (measured: `Compress-Archive` and fflate both
do), and permits recovery from its decoded bytes. Consistent in intent, but the "always" needs a
"(conforming tier; see §3.7)".

### F-17. §5.5 uses a result token §6.6 does not define

`spec.md:270`: "if both are absent, the reference is **unavailable**". §6.6's status table defines
only `survives`, `flagged-changed`, `unconfirmed` and `invalidated`; the corresponding §6.5 token is
`invalidated / history-unavailable`. Fix: use the defined token.

---

## 5. Stale open questions and section placement

### F-18. `spec.md:742` — §11.2 item 15 is not an open question

"**Whether ordinary ZIP readers must be able to browse current Markdown** was answered *yes* by
adopting the working tree (C4)". §11.2 is titled "Raised by the investigations and **never closed**".
The item's own text says it was closed. It belongs in §1.2 beside C4, or in §9 as the standing
fallback.

### F-19. `spec.md:720` — the §11.1 preamble is false for its own item 3

"These were deferred by container.md and are **not** decided here." Item 3 now reads "The
NFC-plus-case-fold uniqueness rule itself **is decided** (D-16); what remains open is verifying
it…". Fix: "These were deferred by container.md; except where noted, none is decided here."

### F-20. D-17 and D-18 were decided with no measurement and §11 does not record it

D-16's evidence gap is recorded (§11.1 item 3). D-17 and D-18 have no equivalent entry, yet:

- No corpus, fixture or worked example in this repository contains a single CR byte
  (`compression.md:259` states the corpus is "real Markdown from git blobs, **without line-ending
  normalization**", and `worked-example.py:45` forces `core.autocrlf=false`).
- `container.md:218` says outright that the platform-native-checkout alternative "was **not
  measured** because it does not exist for this container as specified".

So the format's only content-mutating rule and its extraction counterpart rest entirely on argument.
That is defensible, but §11 is where this document records exactly that kind of gap, and it is
silent.

Fix: add a §11.1 or §11.2 item — "D-17/D-18 EOL behaviour is unmeasured: no CRLF fixture exists, and
no extractor was tested for checkout-time conversion (Info-ZIP `unzip -a` is the obvious probe)."

### F-21. `spec.md:627` — §9's completeness claim no longer holds after D-17/D-18

"**Every** alternative any of the four investigations measured or argued against, in one place."
Three alternatives argued against in the D-16/D-17/D-18 work are absent from §9:

- platform-native checkout, i.e. `core.autocrlf=true` plus a shipped `.gitattributes` (argued
  against at `spec.md:162` and `container.md:218`);
- digest-time-only EOL normalization, i.e. the D-17 shape that commit `15e6beb` reversed;
- case-sensitive entry names, i.e. Git's own laxer rule that D-16 tightens.

Fix: three rows in a new "EOL and paths" block in §9, or soften the sentence.

---

## 6. Source investigations not updated for D-16/D-17/D-18

`container.md` was revised in place: `container.md:189` cites D-16 and spec.md §11.1, `:195` cites
D-17, `:218` cites D-18. The other three were not, and two of them now lead with a headline the
specification overturns. spec.md is authoritative and says so, but a reader who opens the source
first is misled.

| File | Line | Stale text | Suggested fix |
| --- | --- | --- | --- |
| `addressing.md` | 5 | "**Current verdict under the refined no-table requirement: zero identity/rename metadata…**" — the design spec.md §9 lists as rejected | Add a one-line status banner: "Superseded by spec.md §6 and C5: confirmed sparse exceptions are final; the no-table refinement below is the rejected alternative in spec.md §9." |
| `addressing.md` | 7 | "The refinement **explicitly excludes even the sparse table** previously recommended at `d0590d0`." | Same banner covers it; spec.md C5 already records the reversal |
| `compression.md` | 5, 150 | "…and **optionally mirror it in a short EOCD comment**" / "optionally mirror `MDPKG/<version>` in EOCD" — rejected by C1 in both its variable and fixed forms | One-line note pointing at spec.md §3.5 and C1 |
| `compression.md` | 259 | "Source data is real Markdown from git blobs, **without line-ending normalization**" | Not wrong — it describes the corpus, not a rule — but it now reads as a policy statement next to D-17; a clause noting it is a measurement input would remove the ambiguity |
| `history.md` | 22 | "Source blobs remain byte-identical" | Now conditional under D-17; see F-9 |
| `container.md` | 63 | Example manifest still shows `"addressing":{"coverage":"confirmed","overrides":null}` with no `anchor` or `digest` | Superseded by D-1 and D-2 (C6, C7); spec.md records both, so a pointer is enough |

`container.md`'s Handoff item 1 also still describes CARD-0004's status as an open owner decision
("leaves the choice between a confirmed-exception ledger and zero identity metadata"), which C5
closed.

---

## 7. Checked and clean

Verified correct, so a later reviewer does not re-derive them:

- **C1–C12 to resolution.** Each of the twelve conflicts names a real disagreement between two named
  sources and is resolved in a numbered section. No conflict is stated and then left unresolved.
- **D-1…D-18.** All eighteen present, numbered consecutively, none duplicated, none missing. Every
  D-*n* that cites a conflict cites the right one (D-1 to C6, D-2 to C7, D-6 to C10, D-7 to C11,
  D-8 to C12). D-1 to D-5, D-9, D-10, D-11, D-13 and D-15 are stated only in §10 and never cited
  from the section they govern, while D-6 to D-8, D-12, D-14 and D-16 to D-18 are cited from the
  body — an inconsistent citation habit, not an error.
- **Section cross-references.** Every `§n.m` in the document resolves to a section that exists. No
  dangling reference to a removed section.
- **§8 arithmetic.** Every row of the entry table (offsets, methods, csize, usize, CRC32) matches
  `worked-example.json`; 12 entries, EOCD `n=12`, central directory 930 bytes at offset 5,370, total
  6,322 bytes, SHA-256 `b6fb3f23…5ca9`. Package 1: 4,986 bytes, 10 entries, SHA-256 `7d55bbf9…6c45`,
  manifest 366 bytes (376 minus the 10 characters of `"squashed"`). Extraction check 10 status lines
  to 4 untracked for Package 2 and 2 for Package 1. The `loc` base64url decodes to canonical JSON
  with the required trailing LF. All three review roots, expected digests and post-resolution
  digests match.
- **§3–§7 measured figures against the investigations.** 79-byte typing; 1,459-byte descriptor cost;
  158,993 / 3,312,561-byte no-`.git` span; 6/10,369 and 6/54,440 without ledger, 8/12,312 and
  8/85,447 with; 57,797 / 14,715 EOCD-comment fallback; 2-of-5 and 5-of-5 rewrite survival; 83 / 650
  tracked files; 9,043 / 63,610-byte index; 159,296 / 3,312,849 vs 148,080 / 3,288,503 vs 171,192 /
  3,423,817; 48 / 23 blob deltas of 333 / 767 objects; 69.82% / 17.36% and 118.41% / 57.73%;
  6.94% / 1.55%; 28.48% / 7.06%; 176.75% / 118.92%; 45.8% / 5.9% and 60.5% dictionary gap closure;
  2,112-byte fflate gzip; 100,236 / 82,410-byte WASM decoders; Chrome 103 / Firefox 113 / Safari
  16.4 for `deflate-raw`; +42, +3,527 / +22,228, +9,086 / +65,776 manifest deltas; +1,328 / +10,400
  `content/` prefix; +2.32% / +0.99% and +7.12% / +3.77% sparse ledger; +31.60% / +17.21% and
  +41.16% / +20.19% full maps; +1.96% / +0.33% sparse at zero injected events; +53.38% / +30.67%
  stored digests; 58.65% fixed-256 sharding; 27,769 / 321,136-byte ledger blob; 4 wrong matches per
  192 queries at both thresholds; 2.76 MB and about 10.1 s for the full 512-transition walk; 10
  correct / 1 wrong / 4 missed hybrid detection; 1,955 plus 169-byte summary; 141–667 ms
  `indexPack`; 53,773 gzipped isomorphic-git bytes. All correct as stated. The four exceptions are
  F-1 to F-4.
- **Hash constructions.** §6.1 rule 6 and §6.2's default root match `addressing.md` byte for byte,
  including separator placement, and match `worked-example.py`.
- **§11 numbering.** §11.1 has 3 items, §11.2 has 15, none duplicated. Only the two placement
  problems in F-18 and F-19 and the omission in F-20.

## Not done, noted

Not attempted, and out of scope for a review stage: the fixes themselves. If they are wanted, F-1 to
F-7 and F-17 are single-token edits; F-8 to F-16 are one- or two-sentence normative additions that a
plan stage should size, because F-8, F-10 and F-14 change what a validator must do.
