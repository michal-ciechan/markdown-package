# CARD-0010: measuring D-17 and D-18 against a CRLF source and real extractors

Status: investigation complete; measured evidence for two rules that were decided on argument alone. Checked on 2026-09-08. This card closes the gap [spec.md](../spec.md) recorded at §11.1 item 4 and the F-9 finding of the [consistency review](2026-09-08-card-0009-spec-consistency-review.md). It changes no rule; two of its results are owner decisions, listed in the handoff.

**Verdict: D-17 is confirmed and costs more than it says; D-18 is confirmed for the ZIP unpack and refuted for the `git read-tree` half that §3.8 specifies alongside it.** A three-commit CRLF source projected under D-17 rewrote **7 of 10 blob slots, all 3 trees and all 3 commits** with no history transformation of any kind — `transform: []`, `coverage: complete`, every commit retained — while the same projection of an already-LF source was the exact identity. Nine real unpack invocations **added not one CR byte**, and 7 of 9 reproduced all 11 entries byte for byte. But the shipped `.git/config` declares no `core.autocrlf`, so the host's setting governs; under **Git for Windows' installer default `core.autocrlf=true`**, `git read-tree HEAD` and `git status` stay byte-exact and clean, and then the next `git checkout -- .` or `git clone` of the extraction rewrites **4 of 4 documents to CRLF**.

Four results changed what the specification claims rather than confirming it:

- **`unzip -a` is not the counterexample §2 names it as.** On a conforming package it is a byte-exact no-op. Info-ZIP converts only entries whose ZIP *internal file attributes* declare them text, and the producer writes that field as `0` (binary) on every entry. Set the bit and store CRLF and the same command strips **21 CR bytes from 3 of 4 documents**; set the bit on LF content and nothing happens. D-18's safety at the unpack layer rests on a container property spec.md never states.
- **`unzip -aa` damages the pack, not the prose.** Forcing text mode on every entry left all 4 documents and all 3 `.git/` text files untouched and stripped one CR byte each from the `.pack` and the `.idx`. `git fsck` exits 70 (`wrong index v2 file size`). The one extractor mode that does convert is dangerous to the region D-17 explicitly exempts, and harmless to the region it governs.
- **D-17 alone rewrites a lossless projection's whole commit graph.** D-17 says a CRLF source's blob IDs change "in addition to the commit and tree IDs a projection already rewrites". The control measurement says a projection does not already rewrite them: an LF source projected the same way produced byte-identical trees and commits at every ordinal. It is the EOL rule, not the projection, that severs the commit IDs.
- **The §4 validator obligation is exactly as load-bearing as §4 claims.** The conforming and CRLF-storing packages built from one source differ in size, in SHA-256, in `HEAD`, and in 3 of 4 document CRCs — and resolve to the **same 15 addressing digests**. Nothing but the EOL scan distinguishes them, and that scan costs 1,061 bytes of payload the validator has already decoded.

## 1. The fixture

A bare source repository with three first-parent commits, built with `core.autocrlf=false` so the authored bytes reach the blobs untouched — the CRLF is the fixture, not an artefact of Git's configuration. Four documents exercise the three cases D-17 names and one control:

| Document | Terminators | Role |
| --- | --- | --- |
| `guide.md` | CRLF throughout | The ordinary Windows-authored document; edited at each commit |
| `notes.md` | CRLF throughout | Unchanged across all three commits, so its blob slot repeats |
| `mixed.md` | CRLF, lone CR and LF in one file | D-17 normalizes lone CR as well as CRLF; added at the tip |
| `control.md` | LF only | Never rewritten; isolates what the rule actually touches |

Everything addressing-related — the digest profile, the anchor profile, the canonical JSON writer, the deterministic ZIP assembler and the curated-repository builder — is imported from `docs/spec/worked-example.py` unchanged, so this card cannot drift from the shipped worked example. That artifact is not regenerated and its byte figures are untouched.

## 2. D-17: what write-time normalization actually rewrites

Each row is one (commit, path) slot. `control.md` appears three times and keeps its blob ID all three times; every blob carrying a CR byte gets a new one.

<!-- OBJECTS_START -->

| Commit | Path | Source bytes / CR | Source blob | LF bytes | Projected blob | ID rewritten |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `control.md` | 66 / 0 | `eea992088c0b` | 66 | `eea992088c0b` | no |
| 0 | `guide.md` | 139 / 11 | `3f6c5d7b24ca` | 128 | `baa7cf3536e8` | **yes** |
| 0 | `notes.md` | 41 / 5 | `4a485f235ab6` | 36 | `143227537cf0` | **yes** |
| 1 | `control.md` | 66 / 0 | `eea992088c0b` | 66 | `eea992088c0b` | no |
| 1 | `guide.md` | 168 / 12 | `d590e8dfba37` | 156 | `f9695ad813be` | **yes** |
| 1 | `notes.md` | 41 / 5 | `4a485f235ab6` | 36 | `143227537cf0` | **yes** |
| 2 | `control.md` | 66 / 0 | `eea992088c0b` | 66 | `eea992088c0b` | no |
| 2 | `guide.md` | 175 / 12 | `87276b440fde` | 163 | `7e5cdaf1d079` | **yes** |
| 2 | `mixed.md` | 52 / 4 | `426356ab1bb7` | 50 | `71ff17bce81b` | **yes** |
| 2 | `notes.md` | 41 / 5 | `4a485f235ab6` | 36 | `143227537cf0` | **yes** |

<!-- OBJECTS_END -->

**7 of 10 slots rewritten, 6 distinct source blobs mapping to 6 distinct projected blobs, and 0 CR bytes anywhere in the projected content.** The three unrewritten slots are the LF control, which confirms the rule is content-driven and not a blanket re-hash.

The consequence for the commit graph is total, and the LF-source control is what makes it a consequence of D-17 rather than of projection in general:

<!-- GRAPH_START -->

| Object | Ordinal | From the CRLF source | In the package | Rewritten (CRLF source) | Rewritten (LF source control) |
| --- | --- | --- | --- | --- | --- |
| tree | 0 | `9f9e9720b0b5` | `f0f9c64bf664` | **yes** | no |
| tree | 1 | `365f0efd87e0` | `7ae9a3afb9fa` | **yes** | no |
| tree | 2 | `109af15f9b06` | `80121fe002f3` | **yes** | no |
| commit | 0 | `2bbac223cb78` | `60d3eba1a82a` | **yes** | no |
| commit | 1 | `22c645c6c83d` | `b76e72b469ad` | **yes** | no |
| commit | 2 | `d5b7ad758062` | `a315056f408a` | **yes** | no |

<!-- GRAPH_END -->

Every tree and every commit changed under the CRLF source; none changed under the LF source. The package's `history.json` declares `transform: []` and `coverage: complete`, and `retainedCommits` equals the source's commit count — this is a projection that drops nothing, reorders nothing and squashes nothing, and it still shares no commit ID with its source. §5.3's `sourceBase` and `sourceTip` are the only things tying the package to the repository it came from, which is what D-17's last-sentence caveat already says; the measurement is that the caveat applies to the ordinary case, not the transforming one.

## 3. The two packages a reader cannot tell apart

Both are built from the same source. `conforming-lf` normalizes on write per D-17; `nonconforming-crlf` stores the authored bytes.

<!-- PACKAGES_START -->

| Package | Bytes | SHA-256 | Entries | HEAD | Entries carrying CR | Section 4 EOL check | Payload bytes scanned |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `conforming-lf` | 4876 | `8e15967b32445c85…` | 11 | `a315056f408a` | 0 | passes | 1061 |
| `nonconforming-crlf` | 4910 | `32c0c0a68a40f36f…` | 11 | `d5b7ad758062` | 3 | **fails** | 1080 |

<!-- PACKAGES_END -->

They differ by 34 bytes, in SHA-256, in `HEAD`, and in the CRCs of `guide.md`, `notes.md` and `mixed.md` (`control.md`'s CRC is identical in both, being LF already). And **all 15 addressable entities — 4 documents, 4 preambles and 7 sections — resolve to identical digests**, because §6.1 rule 1 re-normalizes CRLF and lone CR to LF before hashing. A reader that resolves a reference against either package gets the same answer, the same `survives` verdict and the same source text. This is precisely the situation §4 describes when it makes the EOL check a validator obligation, and it is now measured rather than asserted.

The check itself is cheap and total: scanning every entry outside `.git/` for a CR byte costs **1,061 bytes on the conforming package** — 21.8% of the 4,876-byte archive, and every one of those bytes is payload the validator has already decompressed to verify a CRC. It flags 3 entries on the nonconforming package, including the two lone CRs in `mixed.md` that no CRLF-only test would catch.

## 4. D-18, first half: nine unpack invocations

The conforming package, extracted by every ZIP tool on this host, compared entry by entry against the stored bytes.

<!-- UNPACK_START -->

| Tool | Exit | Entries byte-identical | Documents | Pack + index | CR added | CR removed | `git fsck` after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Python zipfile extractall | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| Info-ZIP unzip -o | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| Info-ZIP unzip -a -o | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| Info-ZIP unzip -aa -o | 0 | 9 / 11 | 4 / 4 | 0 / 2 | 0 | 2 | **exit 70** |
| 7-Zip x | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| PowerShell Expand-Archive | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| bsdtar -xf | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |
| Windows Explorer, .mdpkg extension | 1 | 0 / 11 | 0 / 4 | 0 / 2 | 0 | 0 | n/a |
| Windows Explorer, renamed .zip | 0 | 11 / 11 | 4 / 4 | 2 / 2 | 0 | 0 | clean |

<!-- UNPACK_END -->

**No tool added a CR byte, in any region, in any invocation.** Seven of nine reproduced all 11 entries exactly and left a repository `git fsck --full --strict` accepts. Applying §6.1 to what each extractor left on disk resolves all 15 entities identically for every row whose document bytes survived, and for no row where they did not — the property D-18 exists to provide ("hashing it under §6.1 needs no reconstruction of what checkout did to it") holds wherever the bytes do.

The two failures are both worth recording and neither is an EOL failure of the kind D-18 anticipates:

- **`unzip -aa`** forces text mode on every entry regardless of what the archive declares. It left all 4 documents and all 3 `.git/` text files byte-identical, and truncated the `.pack` from 1,182 bytes to 1,177 and the `.idx` from 1,408 to 1,407, removing the single CR byte each happened to contain. `git fsck` then reports `wrong index v2 file size` and `packfile … index not opened`, exit 70. A package that survives this command with its prose intact has lost its history.
- **Windows Explorer refuses the `.mdpkg` extension.** `Shell.Application.NameSpace()` returns `E_FAIL` and nothing is written. The identical bytes copied to a `.zip` name extract all 11 entries perfectly. This is extension registration, not content — but it is the measured behaviour of the default Windows GUI extractor against a file named as this format names its files.

### 4.1 Why `unzip -a` is a no-op, and what that depends on

spec.md §2 names Info-ZIP `unzip -a` as a tool that "has not produced" a conforming extraction. Against a conforming package it produces exactly one. Info-ZIP applies its EOL conversion only to entries whose ZIP internal-file-attributes field has bit 0 set, and `docs/spec/worked-example.py`'s assembler leaves that field at `0` for every entry. Four combinations of stored content against that bit, all under `unzip -a`:

<!-- TEXTBIT_START -->

| Stored content | Text bit set | Documents byte-identical | CR removed | CR added | Converted |
| --- | --- | --- | --- | --- | --- |
| LF (conforming) | no | 4 / 4 | 0 | 0 | no |
| LF (conforming) | yes | 4 / 4 | 0 | 0 | no |
| CRLF (nonconforming) | no | 4 / 4 | 0 | 0 | no |
| CRLF (nonconforming) | yes | 1 / 4 | 21 | 0 | **yes** |

<!-- TEXTBIT_END -->

Conversion happens in exactly one cell: CRLF content that the archive itself declares to be text. A conforming package reaches neither condition — D-17 removes the CR bytes and the assembler declares everything binary — so it is doubly protected, and spec.md states neither protection. The text bit is not mentioned in §3 at all.

**Limitation, and it is the one that matters for this half.** The only Info-ZIP build on this host is the MSYS2 port shipped with Git for Windows (`C:/Program Files/Git/usr/bin/unzip.exe`, UnZip 6.00), whose native terminator is LF; its conversion direction is therefore CR *removal*, in both the `-a` and `-aa` rows. The LF→CRLF direction that would actually damage a conforming package could not be exercised at the unpack layer, because no native DOS-port `unzip` is installed. It was exercised at the Git layer, below, where it is both reachable and on by default.

## 5. D-18, second half: `git read-tree`, and what a consumer does next

§3.8 defines extraction as the unpack *plus* `git read-tree HEAD`. §5.1 fixes the exact bytes of the shipped `.git/config`, and those bytes declare no `core.autocrlf` — so the host's system or global setting governs the extracted repository. On this host that setting is `true`, from `C:/Program Files/Git/etc/gitconfig`: the Git for Windows **installer default**, not a user choice.

Each row extracts a fresh copy, runs `git read-tree HEAD`, then the two things a consumer does next — restore the working tree it edited, and clone the repository it was handed.

<!-- GITEOL_START -->

| Setting | After unpack | After `read-tree` | Modified files reported | After `checkout -- .` | After `clone` | CR added (checkout + clone) | `git fsck` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `core.autocrlf=false` | 4 / 4 | 4 / 4 | 0 | 4 / 4 | 4 / 4 | 0 | clean |
| `core.autocrlf=input` | 4 / 4 | 4 / 4 | 0 | 4 / 4 | 4 / 4 | 0 | clean |
| `core.autocrlf=true` | 4 / 4 | 4 / 4 | 0 | 0 / 4 | 0 / 4 | 50 | clean |
| counterfactual: `.git/config` pins `false` | 4 / 4 | 4 / 4 | 0 | 4 / 4 | 4 / 4 | 0 | clean |

<!-- GITEOL_END -->

**The extraction procedure as §3.8 literally writes it survives every setting.** `read-tree` writes only the index; the working tree is untouched under all four configurations, and `git status --untracked-files=all` reports 0 modified files and only `.mdpkg/history.json` and `.mdpkg/manifest.json` untracked, exactly as §3.8 predicts. Under `core.autocrlf=true` this is not luck: the clean filter converts CRLF to LF, the working tree is already LF, so the round trip is a fixed point and the package looks clean.

**The step after it does not survive.** With `core.autocrlf=true`, `git checkout -- .` rewrote all 4 documents to CRLF and `git clone` of the extracted repository checked out 0 of 4 byte-identical, 25 CR bytes added by each. Every converted file is exactly the stored bytes with LF replaced by CRLF, so §6.1 rule 1 re-normalizes and every digest still resolves — the addressing layer is unharmed. What is lost is the property D-18 is written to guarantee and §3.8 gives its rationale as: that the extracted file *is* the tracked blob, byte for byte, so a reader can hash the file on disk without reconstructing what checkout did to it. On a default Windows install, after one ordinary Git command, it cannot.

`core.autocrlf=false` and `core.autocrlf=input` both preserve every byte through checkout and clone, which is the `input`-like behaviour D-18 says the format mirrors. So does the counterfactual last row, which appends `autocrlf = false` to the shipped `.git/config` before running anything. That row is a measurement of what a repository-level pin would do, not a proposal; §5.1 fixes those bytes, so adopting it is a specification change and belongs to the owner.

## Handoff

1. **Owner decision — does `.git/config` pin `core.autocrlf`?** D-18 is stated as a MUST NOT on the extractor, but the layer where it actually breaks is Git's own checkout filter, driven by host configuration the package cannot see. The counterfactual is measured and works (row 4 of §5). Against it: §5.1 currently fixes `.git/config` to exact bytes and §3.8 rests on the package shipping *no* filter configuration, so a pin is a rule the format would be adding, not a default it would be restating. Not applied here.
2. **Owner decision — should §3 state the ZIP internal-attributes value?** The conforming package's immunity to `unzip -a` comes from that field being `0`, which no section of spec.md mentions and no validator check covers. Either state it (and check it) or accept that a re-emitted package from a text-flagging producer is `-a`-convertible. Not applied here.
3. **Wording, spec.md §2 and D-17.** §2's parenthetical "(Info-ZIP `unzip -a`, for one)" is not reproduced against a conforming package — the counterexample requires a package that already violates D-17. D-17's "in addition to the commit and tree IDs a projection already rewrites" presumes a rewrite the LF-source control shows does not happen. Both are one-line corrections, both change what the document asserts, and neither was applied by this card.
4. **Not measured:** any non-Windows host; a native DOS-port Info-ZIP, which is the only way to exercise LF→CRLF at the unpack layer; a source tree carrying its own `.gitattributes`; documents with a BOM or in UTF-16; packages large enough to need ZIP64; and `core.eol` / `core.safecrlf` in combination with the settings above.

## Reproduction and evidence

Run from `C:\src\markdown-package`. No dependencies beyond Git, Python and the tools named below; nothing from the other cards' corpora or virtual environments is needed. Generated repositories, packages and extraction directories stay under ignored `.antiphon/eol-work/`, and each `extractors.py` run uses a fresh subdirectory, so saved scratch paths change between runs.

```powershell
python docs/investigations/eol/fixture.py
python docs/investigations/eol/extractors.py
python docs/investigations/eol/verify_evidence.py
python docs/investigations/eol/render_tables.py
```

Run them in that order; `extractors.py` consumes `fixture.py`'s packages and `render_tables.py` consumes both result files. Environment: Windows 10 Pro 19045, Git 2.50.1.windows.1 (system `core.autocrlf=true`), Python 3.10.2, Info-ZIP UnZip 6.00 (the MSYS2 port under `C:/Program Files/Git/usr/bin/`), 7-Zip 21.07 x64, bsdtar 3.5.2, PowerShell `Expand-Archive`, and the Windows built-in compressed-folder shell handler. Object IDs and package bytes are deterministic for these pinned inputs and this Git version.

<!-- VALIDATION_START -->

Validation: **10** package structure and hash audits, **45** blob, tree and commit identity checks against re-derived object IDs, **12** addressing-digest equivalence and CRC checks, **3** section 4 validator checks, **20** unpack fidelity and `git fsck` checks over 9 tool invocations, **3** internal-attributes text-bit checks, and **27** Git checkout, clone and working-tree checks across four `core.autocrlf` settings. **120 checks in total, 0 unexpected failures.** The two recorded counterexamples — `unzip -aa` corrupting the pack, and `core.autocrlf=true` converting on checkout and clone — are measured limitations, not failed assertions.

<!-- VALIDATION_END -->

This card builds fixtures and probes tools; it implements no part of the format. `fixture.py` applies D-17 as a transformation over content it authors, and its packaging, digest and anchor code is imported from the shipped worked example rather than re-derived. No production validator exists; the §4 EOL check measured in §3 is a nine-line scan written to price the obligation, not to be one.

Raw evidence: [the CRLF fixture, the projection and the two packages](eol/fixture-results.json), [nine unpack invocations, the text-bit matrix and the Git half](eol/extractor-results.json), and [the audit](eol/verification.json).
