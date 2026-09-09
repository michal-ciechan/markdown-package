# `mdpkg` generator CLI — tool reference

A .NET global tool that emits and checks conforming `.mdpkg` packages. [`../spec.md`](../spec.md) is authoritative; every row below cites the section or decision it implements. Rows marked **G-*n*** are tool defaults filling a gap the spec leaves open (§11); they are the tool's choice, not a format rule.

Audience: coding agents driving the tool non-interactively. Implementation: [`src/generator-cli/`](../../src/generator-cli/), a .NET tool on System.CommandLine. `pack` and `validate` are implemented, including Git import, projection, depth, correspondence, controlled ZIP emission and shared post-write validation. `update` and `address` remain explicit `not implemented` actions (exit 70). Their sections below describe the intended contract. Tests read this file and fail when §1, §3, §4 or §10 change without the tool following. Distribution and publishing are separate work; run the project from source today.

---

## 1. Invocation

```text
mdpkg pack     <source-dir>  --out <file.mdpkg>   [options]   # fresh package
mdpkg update   <in.mdpkg>    --out <file.mdpkg>   [options]   # incremental update
mdpkg address  <in.mdpkg>    --out <file.mdpkg>   <op> ...    # sparse exception marking
mdpkg validate <in.mdpkg>                         [options]   # validation only, writes nothing
```

Install `dotnet tool install -g mdpkg`; also invokable as `dotnet mdpkg`. Requires `git` on `PATH` (§5.1 curates a real repository).

| Verb | Writes a package | Reads `.git/` pack | Mutates input | Spec path |
| --- | --- | --- | --- | --- |
| `pack` | yes | no (creates one) | no | §3, §4, §5, §6.3 |
| `update` | yes | yes | no — always a new file (§9, "atomic in-place update: not attempted; rewrite the file") | §5.3, §5.4, D-3 |
| `address` | yes | no | no | §6.3, D-12 |
| `validate` | no | on `--deep` | no | §4, §3.7 |

The extension is `.mdpkg` (D-13). No media type is emitted or assumed (§11.1 item 2).

---

## 2. Global options

| Option | Default | Behavior | Spec |
| --- | --- | --- | --- |
| `--out <path>` | required for writing verbs | Output package. Written to a temp sibling and renamed; a failed run leaves no partial file. Per writing verb, not global: it is an option of `pack`, `update` and `address` and must follow the verb; `validate --out` is a usage error (exit 1) | §9 (rewrite the file) |
| `--format text` / `--format json` | `text` | `json` prints one result object on stdout, nothing else; diagnostics move to stderr | G-1 |
| `--quiet` | off | Suppresses progress on stderr; diagnostics still emitted | G-1 |
| `--namespace <uuid>` | `pack`: required. Other verbs: taken from the input manifest | Lowercase UUID; a differing value on a non-`pack` verb is an error, never a rewrite | §4 `namespace`, §6.5 step 1 |
| `--anchor <id>` | `cm0312-trail-source-v1` | The only value version 1 defines | §4, §6.2, C7 |
| `--digest <id>` | `cm0312-source-lf-v1` | The only value version 1 defines | §4, §6.1, C7 |
| `--object-format <id>` | `sha1` | `sha256` is grammatical and unimplemented; rejected with `MDPK4001` | D-14, §5.2, §11.2 item 1 |
| `--compression-level <0-9>` | `6` | Producer policy only; readers accept any valid DEFLATE stream | §3.3 |
| `--data-descriptors` | off | Sets GP bit 3 on every entry except the manifest. Off by default: descriptors cost 1,459 bytes on the measured npm package | §3.4, D-10 |
| `--reverse-index` | off | Emits `.rev`. MAY be present, MUST NOT be required; the worked example omits it | D-8, C12 |
| `--strict-paths` | on | Cannot be disabled; the uniqueness and reservation rules are producer obligations | §3.6, D-11, D-16 |
| `--fail-on-warning` | off | Promotes every `warn` diagnostic to exit 3 | G-1 |

---

## 3. Exit codes

| Code | Meaning | Spec |
| --- | --- | --- |
| 0 | Success. A writing verb produced a package that passes §4's validator checks against itself | §4 |
| 1 | Usage: unknown option, missing argument, malformed UUID or qualified ID | §2 (qualified object ID) |
| 2 | Source rejected: a producer requirement on the input tree cannot be met | §3.6 |
| 3 | Package nonconforming: `validate` failed, or an input package failed its entry checks | §3.7, §4 |
| 4 | Producer obligation unmet: correspondence could not be confirmed and `--require-complete` was given | §6.3 |
| 5 | Environment: `git` absent or failing, IO error, output path unwritable | §5.1 |

Exit 3 is the only code a `--fail-on-warning` promotion produces.

---

## 4. Diagnostics

Stable codes; `--format json` puts them in `diagnostics[]`. `sev` is the default severity for the writing verbs; `validate` reports every one as `error`.

| Code | sev | Meaning | Spec |
| --- | --- | --- | --- |
| `MDPK1001` | error | Two entry names collide under NFC plus simple case folding | §3.6, D-16 |
| `MDPK1002` | error | Tracked path under `.mdpkg/` or `.git/` after NFC and case folding, outside `.mdpkg/address/` | §3.6, D-11 |
| `MDPK1003` | error | Leading slash, `.` or `..` component, backslash or drive letter in an entry name | §3.6 |
| `MDPK1004` | warn on write, error on `validate` | CRLF or lone CR in an entry outside `.git/`; `pack` and `update` normalize and report, `validate` rejects | §3.6, D-17 |
| `MDPK1005` | error | Central-directory internal file attributes not `0` on some entry | §3.5, D-19 |
| `MDPK1006` | error | `.mdpkg/manifest.json` absent from offset 0, or not stored, or bit 3 set, or a non-empty extra field | §3.1, §3.2 rule 1, §3.4 |
| `MDPK1007` | error | The pack is not the last entry, or an entry a current resolution needs follows it | §3.2 rules 2–3 |
| `MDPK1008` | error | A central-directory method other than `0` or `8` | §3.3 |
| `MDPK1009` | warn | EOCD comment present. Any version token in it is a hint; disagreement with the manifest escalates to error, absence never does | §3.5, C1 |
| `MDPK1010` | error | ZIP64 sentinels present or required (G-2) | §11.1 item 1 |
| `MDPK1011` | error | Malformed ZIP structure, encrypted entry, CRC or decompression failure | §3.3–§3.5 |
| `MDPK2001` | error | `current` differs from the target of `refs/heads/main` | §4, §5.2, D-7 |
| `MDPK2002` | error | `addressing.overrides` names an absent entry, or is `null` while the tree carries a ledger, or names a ledger with zero entries | §4, §6.3, D-12 |
| `MDPK2003` | error | `history.transform` inconsistent with `history.json`'s `transformations` | §4, §5.3, D-3 |
| `MDPK2004` | error | `shallowBoundaries` differs from `.git/shallow`, or is non-empty while that file is absent | §5.3 |
| `MDPK2005` | error | A transformation carries a `summary` but `bindings.json` is absent or lacks its `emitted` commit | §5.4 |
| `MDPK2006` | error | An archived patch's bytes do not hash to the `sha256` that `history.json` binds | §5.5 |
| `MDPK2007` | error | Malformed or inconsistent manifest, profile, history or review declaration | §4, §5.3 |
| `MDPK3001` | warn, error under `--require-complete` | Correspondence over some range was not confirmed; `addressing.coverage` is written `partial` with the covered ranges | §4, §6.3 |
| `MDPK3002` | info | A new entity was born into a default root still held by a retired or moved entity; a fresh random root was minted | §6.3 (reserved-slot births) |
| `MDPK3003` | error | A rename candidate was supplied unconfirmed; heuristic guesses never become `to` entries | §6.3 (producer obligation) |
| `MDPK4001` | error | SHA-256 object format requested | D-14 |
| `MDPK4002` | error | The curated repository holds an entry §5.1 does not list: loose objects, an index, hooks, reflogs, remotes, `description`, `info/` or `packed-refs` | §5.1 |
| `MDPK4003` | error | A tracked entry is not decodable as UTF-8. Version 1 defines no mechanism for tracked binary content, so no binary heuristic is applied and the entry is rejected | D-17 (scope) |
| `MDPK5001` | error | Filesystem or native Git operation failed | CLI §3, exit 5 |

---

## 5. Inputs and outputs

### 5.1 Read

| Path | Verb | Role | Spec |
| --- | --- | --- | --- |
| `<source-dir>/**` | `pack` | Document tree to become the working tree of `current`. Ignores `.git/`; a real `.mdpkg/` directory outside `.mdpkg/address/` is rejected (`MDPK1002`) | §3.6, §6.3 |
| `<source-dir>/.mdpkg/address/overrides.json` | `pack` | Pre-existing ledger, carried through as a tracked file | §6.3 |
| `<in.mdpkg>` | `update`, `address`, `validate` | Input package. Must type at offset 0 unless `--accept-recoverable` | §3.1, §3.7 |
| `--correspondence <file.json>` | `pack`, `update` | Confirmed rename and lifecycle records (§7.1). Producer-confirmed only | §6.3 |

### 5.2 Written into the package

| Entry | Emitted by | Content rule | Spec |
| --- | --- | --- | --- |
| `.mdpkg/manifest.json` | every writing verb | Canonical JSON with `mdpkg` first and every other key sorted, so the magic lands at byte 50; O(1) in package size | §4, D-15, §3.1 |
| working-tree entries | `pack`, `update`, `address` | Bytewise path order (recommended, not required), LF-normalized | D-9, D-17 |
| `.mdpkg/address/overrides.json` | `address`, and `pack` / `update` when correspondence records exist | Tracked. Absent when it would have zero entries, with `overrides` then `null` | §6.3, D-12 |
| `.mdpkg/history.json` | every writing verb | Container-level, untracked, canonical JSON, no `version` key of its own | §5.3, D-4 |
| `.mdpkg/history/bindings.json` | `update --squash` | `{"version":1,"bindings":[...]}`; written after the squash commit exists | §5.4 |
| `.mdpkg/history/ranges/<sha256>.json` | `update --squash` | Range summary named by the SHA-256 of its own bytes, keyed by origin root | §5.4, D-5 |
| `.mdpkg/history/patches/<sha256>.patch` | `--retain-patches` | Exact patch bytes; regeneration across Git versions is not byte-stable | §5.5 |
| `.git/HEAD` | every writing verb | `ref: refs/heads/main` plus LF | §5.1, D-7 |
| `.git/config` | every writing verb | The 50-byte non-bare config of §5.1, exactly. No `core.autocrlf` is written, deliberately | §5.1, C3, D-18b |
| `.git/refs/heads/main` | every writing verb | The commit ID of `current` plus LF | §5.1, §5.2 |
| `.git/shallow` | genuine shallow clone only | Boundary commit IDs, one per line; MUST equal `shallowBoundaries` | §5.1, §5.3 |
| `.git/objects/pack/pack-*.pack`, `*.idx` | every writing verb | Exactly one pack and its index, byte for byte as Git wrote them | §5.1, D-17 (scope) |

### 5.3 Written outside the package

| Path | When | Content |
| --- | --- | --- |
| stdout | `--format json` | One result object (§6) |
| stderr | always unless `--quiet` | Progress and diagnostics |
| `--report <file.json>` | on request | The same result object, written even on a non-zero exit (G-1) |

---

## 6. Result object (`--format json`)

| Field | Type | Meaning |
| --- | --- | --- |
| `verb` | string | `pack`, `update`, `address` or `validate` |
| `exitCode` | integer | §3 |
| `package` | object or null | `path`, `bytes`, `sha256`, `entries`, `tier`; `tier` is `conforming` or `recoverable` (§3.7) |
| `manifest` | object or null | The manifest as written or read (§4) |
| `current` | qualified object ID or null | Equal to the target of `refs/heads/main` (D-7) |
| `addressing` | object | `coverage`, `overrideCount`, `mintedRoots`, `uncoveredRanges` (§4, §6.3) |
| `history` | object | `coverage`, `transform`, `retainedCommits`, `ranges`, `patches` (§4, §5.3) |
| `checks` | array | One `{code, status}` per §11 check: `pass`, `fail` or `skipped` |
| `diagnostics` | array | `{code, sev, entry, message, spec}`; `spec` is the citing section or decision |

---

## 7. Generation path 1 — fresh package (`pack`)

```text
mdpkg pack ./docs --out ./docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
```

| Option | Default | Behavior | Spec |
| --- | --- | --- | --- |
| `--from-git` | off | Import the source directory's own history instead of synthesising a single root commit | §5.3 `sourceRepository`, `scope` |
| `--scope <pathspec>` | whole tree | Path projection recorded in `history.json` as `scope`; sets `history.transform` to `["projected"]` | §4, §5.3, D-3 |
| `--depth <n>` | full | Retain the last *n* first-parent commits. Sets `history.coverage: truncated` and `root: synthetic` | §4, §5.3, D-3 |
| `--message <text>` | `Initial package` | Commit message for the synthesised root | §5.1 |
| `--require-complete` | off | Exit 4 rather than write `addressing.coverage: partial` | §4, §6.3 |

| # | Step | Spec |
| --- | --- | --- |
| 1 | Enumerate the source tree; reject reserved prefixes, unsafe components and NFC-plus-case-fold collisions before anything is written | §3.6, D-11, D-16 |
| 2 | Normalize CRLF and lone CR to LF in every entry that will live outside `.git/`; report `MDPK1004` per entry rewritten | §3.6, D-17 |
| 3 | Write blobs, trees and commits from the normalized bytes. A CRLF source therefore gets new blob, tree and commit IDs; `sourceBase` and `sourceTip` name the source lineage and imply no byte identity | D-17, §5.3 |
| 4 | Compute the inventory: default root and scoped digest per entity of every Markdown document, under the declared anchor and digest profiles | §6.1, §6.2 |
| 5 | Emit the ledger from `--correspondence` records only, or omit it and write `overrides: null` | §6.3, D-12 |
| 6 | Build the curated repository: `git pack-objects --revs --delta-base-offset`, then `index-pack`, then strip everything §5.1 does not list | §5.1, §5.2 |
| 7 | Assemble the ZIP under §8's invariants | §3.2–§3.6 |
| 8 | Re-open the staged file and run every §11 check, including deep Git checks; a failure deletes staging and exits 3, preserving an existing destination | §4 |

Manifest written by `pack` with no history transform and no exceptions:

```json
{"mdpkg":"markdown-package/1","addressing":{"anchor":"cm0312-trail-source-v1","coverage":"complete","digest":"cm0312-source-lf-v1","overrides":null},"current":"sha1-...","history":{"coverage":"complete","detail":".mdpkg/history.json","transform":[]},"namespace":"..."}
```

### 7.1 `--correspondence` file

Producer-confirmed records only. A similarity score is a candidate, never authority (§6.3; §9 rejects `git diff -M` and section-similarity as identity authority).

The file is a JSON array of the records below. Supplying a record is the producer's confirmation; optional `"confirmed": true` is accepted and `false` is rejected with `MDPK3003`. Unknown fields, duplicate roots, malformed records and absent move targets are rejected. Records apply to the tip. An existing source ledger supplies historical confirmations; records are retained across imported commits. Unconfirmed removals create `unknown` records, reserve their former roots, and leave the corresponding retained transition `partial`. No similarity or Git rename score becomes confirmation. Exact default locators continue under §6.2; every removed live root must have a confirmed move or retirement for a transition to be complete. `--require-complete` fails with exit 4, and `--fail-on-warning` fails with exit 3, before publishing any output.

| Record | Shape | Becomes | Spec |
| --- | --- | --- | --- |
| move | `{"root": ..., "to": [scopeKind, path, trail]}` | `{"to": ...}`, chains flattened to the current locator | §6.3 |
| retire | `{"root": ..., "dead": "split", "next": [...]}`; `dead` is `split`, `merge` or `deleted` | `{"dead": ..., "next": ...}` | §6.3 |
| unconfirmed | `{"root": ..., "unknown": "unconfirmed-removal"}` | `{"unknown": ...}` | §6.3 |

---

## 8. Emitter invariants (all writing verbs)

| Invariant | Value | Spec |
| --- | --- | --- |
| First entry | `.mdpkg/manifest.json` at offset 0, stored, true sizes and CRC in the local header, bit 3 clear, extra field length 0 | §3.1, §3.2 rule 1, §3.4 |
| Last entry | the `.pack` | §3.2 rule 2 |
| Ordering | manifest, working tree, container-level `.mdpkg/history*`, `.git/` metadata, `.rev`, `.idx`, `.pack`; every entry a current resolution can need precedes the pack | §3.2 rule 3, §7.2 |
| Method, manifest | `0` — readable with no decoder | §3.3 |
| Method, `.pack` / `.idx` / `.rev` | `0` — internal offsets stay valid; DEFLATE saves 1.75% on npm only by forcing whole-member inflation and makes Rust larger | §3.3, C9 |
| Method, everything else | `8` at level 6, or `0` when the DEFLATE output is not smaller | §3.3 |
| Any other method | never emitted | §3.3 |
| Internal file attributes | `0` on every central-directory record | §3.5, D-19 |
| External file attributes | `0o100644 << 16` | §8.2 |
| EOCD comment length | `0` | §3.5, C1 |
| Extra fields, entry comments, archive comment | none written; they carry no format meaning and rewrites drop them | §3.4 |
| Non-ASCII entry names | UTF-8 with GP bit 11 set | §3.6 |
| Entry content outside `.git/` | LF only | §3.6, D-17 |
| `.git/` entry content | byte for byte as Git wrote it; §5.1 fixes the three text files | §5.1, D-17 (scope) |
| Timestamps | fixed 1980-01-01 in every local and central record (G-3) | §8.2 |

Consequence, not an option: extraction of the result is a Git working tree after `git read-tree HEAD`, and the unpack is byte-exact on every platform (D-18a). What a consumer's Git does afterwards follows the host's own `core.autocrlf`; the tool pins nothing in `.git/config` (D-18b, §5.1, §9).

---

## 9. Generation path 2 — incremental update (`update`)

```text
mdpkg update ./docs.mdpkg --out ./docs-2.mdpkg --tree ./docs --message "Revise the setup section"
```

| Option | Default | Behavior | Spec |
| --- | --- | --- | --- |
| `--tree <dir>` | required unless `--squash` is given alone | New working-tree state; becomes one commit on `refs/heads/main` | §5.1, §5.2 |
| `--message <text>` | required with `--tree` | Commit message | §5.1 |
| `--squash <base>..<tip>` | off | Collapse a first-parent range into one emitted commit. Appends `squashed` to `history.transform` | §4, D-3 |
| `--no-summary` | off | Squash without a range summary. Every touched-since query over the collapsed range then answers `unknown`, never "untouched" | §5.4, §6.7 |
| `--truncate <base>` | off | Drop history before `base`. Sets `history.coverage: truncated` and `root: synthetic`; writes `.git/shallow` only for a genuine shallow clone | §5.3, D-3 |
| `--retain-patches` | off | Archive the exact patch bytes behind every hunk reference the producer has published | §5.5 |
| `--require-complete` | off | As `pack` | §4, §6.3 |

| # | Step | Spec |
| --- | --- | --- |
| 1 | Type the input at offset 0; fall back to the central directory only under `--accept-recoverable`, and always re-emit in conforming form | §3.1, §3.7 |
| 2 | Load the pack, `HEAD` and the tracked ledger from the input package | §5.1, §6.3 |
| 3 | Apply steps 1–3 of §7 to `--tree`, then commit onto the existing tip | §3.6, D-17 |
| 4 | With `--squash`: compute the range summary **before** discarding the intermediate revisions. Ordinals are 1-based over `sourceCommits`; ordinal 0 is the `base` state. Endpoint comparison alone cannot see an edit-then-revert | §5.4, §6.7 |
| 5 | Write the summary as `.mdpkg/history/ranges/<sha256 of its own bytes>.json`, then `bindings.json`, which can only be written once the emitted commit exists | §5.4 |
| 6 | Update `history.json`: `transformations`, `ranges`, `patches`, `retainedCommits`, `addressingCoverage`, `shallowBoundaries` | §5.3, D-4 |
| 7 | Repack, reassemble, re-check as §7 step 8. Repacking changes offsets and delta bases but no object ID, so no format identity depends on pack layout | §5.1, §4 |

The ledger is carried forward as an ordinary tree copy and survives the squash unchanged; roots are origin roots, so a summary stays valid across recorded renames (§5.4, §6.3).

Squash is declared, never inferred: a squash commit and an ordinary one-parent commit with the same tree, parent, author, committer and message have the identical object ID. The absence of `.git/shallow` likewise proves nothing about completeness — a synthetic root repacks as a normal repository (§5.3, §9).

In-place update of an existing package is a possible future CLI affordance and is not yet designed. It is a tool question, not a format one: `update` today always writes a new file (§1, §2, §13), which is what spec §9 "atomic in-place update: not attempted; rewrite the file" leaves a producer with. Nothing above changes until such a design exists.

---

## 10. Generation path 3 — sparse addressing exception marking (`address`)

```text
mdpkg address ./docs.mdpkg --out ./docs-2.mdpkg move --root b6564987... --to "section:guide.md:# Guide/0,## Installation/0"
```

Records producer-confirmed exceptions in the tracked ledger `.mdpkg/address/overrides.json` and commits the change. Because the ledger is tracked it appears at every retained commit that had exceptions, survives squash as an ordinary tree copy, and is a plain ZIP entry in the current view (§6.3).

| Operation | Ledger record | Resolution effect | Spec |
| --- | --- | --- | --- |
| `move --root --to` | `{"to": [scopeKind, path, trail]}` | The reference resolves at the recorded locator. Bindings go origin root → **current** locator; chains are flattened on update | §6.3, §6.5 step 2 |
| `retire --root --reason <split\|merge\|deleted> [--next ...]` | `{"dead": ..., "next": [...]}` | `flagged-changed` with reason and successors; never a silent transfer | §6.3, §6.6 |
| `unknown --root --reason <text>` | `{"unknown": ...}` | `unconfirmed`; the review is preserved externally and the badge is not moved | §6.3, §6.6 |
| `mint --locator <loc>` | fresh random root plus `{"to": <locator>}` | Reserved-slot birth: the newcomer does not inherit the retired holder's root, and an old review cannot attach to it. Emits `MDPK3002` | §6.3 |
| `list` | none | Prints the ledger; writes no package | §6.3 |

| Rule | Behavior | Spec |
| --- | --- | --- |
| Retention | A record survives even if a later edit restores the default locator, because a review may have been issued against the intermediate one | §6.3 |
| Emptiness | Removing the last entry deletes the file and sets `overrides` to `null` in the same commit | §6.3, D-12 |
| Confirmation | `--from-candidates <file>` loads suggestions for review and writes none of them without an explicit `--confirm <root>`. The best measured section-projection hybrid got 10 right, 1 wrong and 4 missed of 14 required mappings, including a false `R099` on unrelated boilerplate | §6.3, §9 |
| Coverage | Ranges left unconfirmed set `addressing.coverage: partial` and are enumerated in `history.json`'s `addressingCoverage` | §4, §5.3, §6.5 step 1 |
| Key space | Ledger keys are origin roots (64 lowercase hex); abbreviated hashes are never valid | §6.2, §2 |
| Missing entry | A reference claiming an exception the package does not confirm resolves `unconfirmed / missing-override`, so an omitted record is not a silent pass | §6.5 step 2 |

---

## 11. Generation path 4 — validation only (`validate`)

```text
mdpkg validate ./docs.mdpkg --deep
```

Writes no package. Every writing verb runs the same check set against its own output before exiting 0 (§7 step 8).

| Option | Default | Behavior | Spec |
| --- | --- | --- | --- |
| `--deep` | off | Additionally reads the pack: hashes every current-view entry as a Git blob (`"blob " length 0x00 bytes`, SHA-1) and compares with the tip tree | §7.1, §11.2 item 13 |
| `--accept-recoverable` | off | Accepts tier 2 and reports `tier: recoverable`; the package still fails conformance and SHOULD be re-emitted | §3.7 |

| Check | Code on failure | Bytes needed | Spec |
| --- | --- | --- | --- |
| 79-byte typing read at offset 0 | `MDPK1006` | 79 | §3.1 |
| Pack last; every resolution entry before it | `MDPK1007` | central directory | §3.2 |
| Only methods `0` and `8` | `MDPK1008` | central directory | §3.3 |
| Manifest local header: true sizes, CRC, bit 3 clear, extra length 0 | `MDPK1006` | 79 | §3.4 |
| Internal file attributes `0` on every record | `MDPK1005` | central directory | §3.5, D-19 |
| EOCD comment zero-length | `MDPK1009` | 22 | §3.5, C1 |
| Entry-name uniqueness under NFC plus simple case folding | `MDPK1001` | central directory | §4, §3.6, D-16 |
| Reserved-prefix rule after NFC and case folding | `MDPK1002` | central directory | §4, §3.6, D-11 |
| LF-only content in every entry outside `.git/` | `MDPK1004` | payload already decoded for CRC | §4, §3.6, D-17 |
| `current` equals the target of `refs/heads/main` | `MDPK2001` | manifest plus one entry | §4, §5.2, D-7 |
| `overrides` presence agrees with the tree | `MDPK2002` | manifest plus ledger | §4, §6.3, D-12 |
| `transform` consistent with `history.json` | `MDPK2003` | two entries | §4, §5.3 |
| `shallowBoundaries` equals `.git/shallow` | `MDPK2004` | two entries | §5.3 |
| Every summary named by the SHA-256 of its own bytes; every binding present | `MDPK2005` | summary entries | §5.4 |
| Every archived patch matches its bound hash | `MDPK2006` | patch entries | §5.5 |
| Curated repository holds nothing §5.1 omits | `MDPK4002` | central directory | §5.1 |
| `git fsck --full --strict` on the extracted repository | `MDPK4002` | `--deep` only | §3.8, §8.4 |
| Current view equals the tip tree, blob for blob | `MDPK2001` | `--deep` only | §7.1 |
| Unsafe entry names and UTF-8 names | `MDPK1003` | central directory | §3.6 |
| No ZIP64 sentinels, locator or extra field | `MDPK1010` | directory/local headers/EOCD | G-2 |
| Entry extents, CRC32, complete DEFLATE streams, single disk and no encryption | `MDPK1011` | directory and payloads | §3.3–§3.5 |
| Canonical JSON, supported profiles, history and coverage declarations; deep validation substantiates complete correspondence against retained inventories/ledgers | `MDPK2007` | JSON entries and retained trees (deep) | §4, §5.3 |
| Strict UTF-8 outside `.git/` and in retained blobs on deep validation | `MDPK4003` | decoded payloads | D-17 |

The four content checks — uniqueness, reservation, LF, text flag — are validator obligations precisely because a reader cannot detect the damage itself: a `README.md` / `readme.md` pair loses one file in every tested extractor and in Git's own NTFS checkout, and a CRLF-storing package resolves to the same digests as its conforming twin because §6.1 rule 1 re-normalizes (§4).

Passing `validate` is not proof that no upstream history was omitted. "Complete" is a producer claim checked for internal consistency against a declared scope and walk (§5.3).

---

## 12. Determinism

| Property | Guarantee | Spec |
| --- | --- | --- |
| Repeat runs | Byte-identical output for the same inputs, Git/runtime/tool versions, except fresh random reserved-slot births; two runs of the worked example produced byte-identical packages | §8 |
| Pinned Git settings | `core.autocrlf=false`, `core.compression=6`, `pack.threads=1`, `pack.window=10`, `pack.depth=50` | §8, [`worked-example.py`](worked-example.py) line 45 |
| Snapshot commit metadata | Fixed author/committer `mdpkg <mdpkg@example.invalid>`, timestamp `946684800 +0000` (2000-01-01); message from `--message`. Imported commits retain author, committer and message bytes. Signatures are removed when their signed tree/parents change | G-4 |
| Reserved-slot births | Fresh random roots deliberately make such runs non-identical; persist the resulting tracked ledger to reuse those roots | §6.3 |
| Not guaranteed | Byte identity across Git versions or across `--compression-level`. The pack is a storage choice and no format identity depends on its layout | §5.1 |
| Not guaranteed | Byte identity with a package rewritten by an ordinary archive tool. Of five real rewrites, manifest-first order survived two and the manifest's bytes survived all five; a repack that preserves payload bytes is not a format-preserving package rewrite | §3.7 |

This tool reproduces the output shape of [`worked-example.py`](worked-example.py), which is example machinery for §8 and not a format implementation: its ATX-only outline scanner is not the CommonMark 0.31.2 resolver §6.1 requires.

The implementation uses Markdig's plain CommonMark pipeline, with source spans for multiline Setext headings and direct-document children only. It uses the viewer's Unicode 17.0.0 C+S folding table after NFC, with normal .NET globalization enabled. ZIP compression uses .NET's numeric zlib levels 0–9; decoding checks stream completion, declared sizes and CRCs. Canonical JSON preserves Unicode and orders keys by UTF-8 bytes.

Deep validation checks each declared complete correspondence transition against the retained entity inventories and ledgers. Unknown records or removals without a retained binding/retirement contradict complete coverage and fail with `MDPK2007`, even if a later commit confirms them. This checks evidence shipped in the package, not whether upstream history was omitted. Git commit headers are parsed structurally as bytes; imported author/committer/message metadata may use legacy encodings such as ISO-8859-1. Strict UTF-8 still applies to document blobs and package JSON.

Report safety checks on Windows and Linux resolve filesystem links (including parent directories) and compare file identities to detect hard links to protected inputs or output. Unsafe `--report` destinations are usage errors (exit 1) before the engine runs. Safety is checked again before publication; a newly unsafe or unwritable report fails with exit 5. Reports are written through a unique sibling file and replacement, never by truncating an existing destination inode. No report is written for a rejected destination.

Source policy (G-5): snapshot input ignores the exact root `.git` entry and rejects symlinks/reparse points, including linked source ancestors. Output must be outside the source tree and its existing parent directories cannot be links/reparse points. A report must also be outside source and must not overwrite package or correspondence inputs or the package output. Names containing colons or control characters are rejected for portable staging. A snapshot may use `--scope`; selection uses native Git pathspecs over the staged tree. `--from-git` requires a repository root (or bare repository) and reads committed `HEAD` history, not dirty/untracked working-tree changes. Use `--scope` to select a subtree. Every retained tree is normalized and checked; Git links and submodules are rejected. Regular files are committed as mode `100644`, including executable source files, to agree with the fixed ZIP attributes; this can also rewrite imported tree/commit IDs. `--depth` and shallow-source imports produce a synthetic root and `truncated` coverage, without shipping `.git/shallow`. `--message` applies only to synthesized snapshots. Review-package authoring is outside `pack`; source `.mdpkg/review/` entries are rejected because they need a review manifest.

Git runs through argument lists in isolated temporary repositories. System/global Git configuration, hooks, credential helpers, replace refs, lazy fetching and remote protocols are disabled. No source checkout, index write or fetch occurs. Cancellation kills active Git subprocesses and removes staging. Native Git on PATH and temporary disk space are required. Entry payloads are buffered in memory; an individual entry above `Int32.MaxValue` is refused as an environment/resource error. ZIP32 sentinel limits are checked separately (`MDPK1010`).

Internal engine results carry outcomes and diagnostics; only the command adapter assigns process exit codes and writes stdout/stderr/reports. SHA-256 creation requests emit `MDPK4001` and exit 2. Invalid source text emits `MDPK4003` and exit 2. Malformed package content exits 3; missing files, failing Git or unwritable output exit 5. `--accept-recoverable` enables inspection and a `recoverable` result tier but still exits 3 for failed conformance. Shallow validation skips the two deep checks; `pack` always runs them before replacement.

Read-only format/ZIP/addressing code is shared with `Mdpkg.Reader`; creation and native Git orchestration remain in the CLI pending Core extraction. For review returns, this CLI checks the manifest declaration, canonical review JSON, and (with `--deep`) delta/bundled Git lineage restrictions. Thread/comment/selector schema validation and authored v2 kind extraction belong to `Mdpkg.Reviews`, which depends only on Reader. CLI validation alone is not a review-feedback schema check; full feedback assurance combines Reviews' schema checks with an explicitly supplied full-verification provider.

---

## 13. Non-goals

| Not done by this tool | Why, and where it belongs | Spec |
| --- | --- | --- |
| Resolving references, or returning `survives` / `flagged-changed` / `unconfirmed` / `invalidated` | A reader's job; resolution reads the manifest, the ledger and one document, and never the pack | §6.5, §6.6 |
| Rendering Markdown, or reviewing rendered meaning | Out of scope for `cm0312-source-lf-v1`; needs its own context digest and invalidation policy | §6.1, §11.2 item 10 |
| Deciding renames automatically | `git diff -M` detects file pairs, not heading sections; candidates reduce producer work and are never authority | §6.3, §9, §11.2 item 8 |
| Storing per-entity digests, a document index, a codec declaration, entry counts or a package self-hash | Each duplicates ZIP or Git state and can disagree with it; measured at +9,086 / +65,776 and +3,527 / +22,228 bytes | §4, §9 |
| Emitting `.git/index` | `git read-tree HEAD` rebuilds it; shipping it costs 9,043 / 63,610 bytes and binds host stat data | §3.8, §9 |
| Pinning `core.autocrlf`, shipping `.gitattributes`, or any smudge/clean filter | Measured and working, rejected by requester decision; the host keeps its own EOL policy | §3.8, §5.1, D-18b, §9 |
| Converting line endings on extraction, or emitting CRLF anywhere | Nothing to convert: LF is the stored form and the text flag stays clear | D-17, D-18a, D-19 |
| In-place mutation of an existing package | Atomic in-place update was not attempted; rewrite the file | §9 |
| Re-emitting a foreign archive as a format-preserving rewrite | Once files change, only a package-aware producer can regenerate the ledger, digests and history sidecars | §3.7 |
| Retaining merge second parents or original upstream commit IDs | Version 1 retains a first-parent projection with new commit IDs | §5.3 `walk`, §11.2 item 4 |
| Shipping tags, notes refs, remote-tracking refs, replace refs or more than one branch | Local overlays, not portable evidence; exactly one branch ref with `HEAD` symbolic to it | §5.2, D-7, §9 |
| SHA-256 packages | Grammatical in the reference form, unexercised | D-14, §11.2 item 1 |
| ZIP64; solid, dictionary, Brotli, zstd or xz codecs | Open, or rejected on measurement | §11.1 item 1, §9 |
| Tracked binary content | Version 1 defines no mechanism for it, so no binary-detection heuristic is specified or applied | D-17 (scope) |
| Registering a media type or file extension | Open; `.mdpkg` is the working extension only | §11.1 item 2, D-13 |
| Bounding tombstone retention | Undefined; bounded entity coverage would need its own declaration shape | §11.2 item 11 |

---

## 14. Tool defaults not fixed by the spec

| Marker | Default | Open question it fills |
| --- | --- | --- |
| **G-1** | `--format text`; machine output only under `--format json` or `--report`; `--fail-on-warning` off | None — CLI surface, outside the format |
| **G-2** | Refuse ZIP64 on read and write; hard producer limits of 4 GiB and 65,535 entries. The evidence reader's only tested behavior is rejection, and nothing in the corpora approaches the limits | §11.1 item 1 |
| **G-3** | Fixed 1980-01-01 ZIP timestamps, matching the worked example | None — the format constrains no timestamp |
| **G-4** | Fixed snapshot author/committer and timestamp; preserve imported metadata where possible | Deterministic commit metadata is producer policy |
| **G-5** | Source containment/link policy and portable staging restrictions described in §12 | Filesystem traversal is producer policy |
