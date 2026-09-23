# The reload-and-reattach flake in `persistence.spec.js`

Status: **reopened 2026-09-23**. Closed on 2026-09-22 after the CARD-0065 fix
below; the failures came back at the same rate, and they are not confined to
WebKit. Originally titled *The WebKit reload-and-reattach flake*; the
WebKit-only framing is now known to be wrong and the title has been widened.
Measured throughout on the same Windows host the viewer's other browser
evidence uses, with `@playwright/test` 1.55.1 and the bundled engines.

The file carries two unrelated failure mechanisms. They were conflated in the
original investigation because they land in the same spec. Mechanism A is
fixed; mechanism B is open.

## Mechanism A -- a reading-position save racing a packages-table snapshot (fixed)

Two tests snapshot the whole `packages` table and compare a later read with
`toEqual`: `invalid candidate preserves editor, recents and current package`
and `cancelled enhanced picker leaves the active editor and history intact`.

`session.js` saves the reading position on a 250ms debounce with a 1s ceiling,
and `store.js`'s `position()` stamps a fresh `lastRead` on the package row. No
test awaits that write -- the CARD-0065 fix below deliberately moved storage
housekeeping off the reader's critical path -- so one can land between the
snapshot and the comparison. Observed on Firefox on 2026-09-23 with `lastRead`
1.19s ahead and every other field byte-identical, produced by the scroll the
test's own click caused.

This is **not** the engine stall of mechanism B. 1.19s is ordinary debounce plus
write latency, and the failure reproduces deterministically on both engines:
forcing a reading-position save between the snapshot and the comparison reddens
the old `toEqual` on firefox and webkit alike, with only `lastRead` differing.

Fixed in `1ea1d75` by comparing through a `samePackages` helper: every other
field, the row count and the row order stay exactly compared, and `lastRead`
gains two assertions of its own -- it must still be present or absent on the
same rows, and it must never move backwards. Mutating the position write to
perturb a non-`lastRead` field (`filename`) reddens the helper on both engines
at the exact-compare assertion, so nothing was weakened to buy the green.

## Mechanism B -- the engine stall (open)

### The original failure and fix (CARD-0065, 2026-09-22)

`persistence.spec.js:132` (`changed text under the same declared identity
preserves feedback for recovery`) failed roughly one WebKit run in thirty,
always inside the shared `reloadAttach` helper and never in the assertions the
test is about. Two distinct symptoms, both 5s expect timeouts, both on the page
that has just reloaded:

- `.document-title` still empty after `setInputFiles`, and
- no `Choose file again` button after `page.reload()`.

Baselines at the commit before that work, single test, WebKit, `--repeat-each`:
12 + 40 + 40 runs, 3 failures (3.3%).

Timings were taken by wrapping `store.js`'s `transaction()` and the `receive` /
`prepare` / `attach` boundaries in `console.log`, running 40 repeats and dumping
the console of each run. The instrumentation is not in the tree; it was reverted
before the fix was committed.

Two failing runs, post-reload attach:

| run | `openPackage` write | then |
|-----|--------------------|------|
| r26 | +2153ms            | the `prune` write never returned |
| r25 | +269ms             | `prune` +467ms, then the recents relist (3 readonly transactions) never returned |

`attach()` awaited four IndexedDB round trips -- `openPackage`, `saveHandle`,
`prune` and `refresh` -- and `receive()` in `main.js` renders the first document
only after attaching resolves. Any stall in the three maintenance steps
therefore left the reader blank. This is a tail, not a systematic cost: over 40
healthy WebKit attaches the whole `receive` -> rendered document path is 262ms
(p50; p90 298ms, max 344ms), of which the container open is 47ms, `prepare`
137ms and the package write 75ms, and the reload to the resume offer is 146ms
(p90 160ms, max 277ms). The failures are 20-40x those medians and land on reads
of object stores no concurrent write touches, so the stall is the engine's, not
extra work the viewer does.

What changed:

1. `session.js` `attach()` now awaits only `store.openPackage` -- it installs the
   package record every later save needs. `saveHandle`, `prune` and the recents
   relist continue in the background with the same error handling. Guarded by
   `storage housekeeping never delays the restored document or its saved draft`,
   which withholds completion of the prune write and requires the document, the
   restored draft and a further save to land while it is outstanding. Red in all
   three engines before the change (`.document-title` empty at 5s), green after.

2. That made relisting genuinely concurrent, and a repeated whole-file WebKit run
   found the consequence: `remove recents retains saved work` failed with the list
   still reading `original.mdpkg - Saved draft` and no `Saved work` -- a relist
   that read before the removal repainted the list after it. `refresh()` now skips
   its render when a later relist has started. Guarded by `a relist stalled by
   attaching cannot repaint the list over a newer one`, red in all three engines
   with exactly that text, green after.

3. The two waits in `reloadAttach` carry a 12s budget with the measurements above
   as the reason. The 30s test timeout still bounds an attach that never
   completes, and no other assertion in the file was touched.

Immediately after that work: unit lane 216 passed; chromium 153, firefox 63,
webkit 63 all passed; `persistence.spec.js` x4 on WebKit twice, 140 + 140 passed.

### Why it is reopened

The fix removed the part the viewer controls -- the reader no longer waits on
housekeeping -- but it did not remove the stall, and the stall lands on whichever
wait it overlaps. Only the two `reloadAttach` waits were given a budget, so every
other wait in the file is still exposed at 5s.

Recurrence evidence, all `persistence.spec.js`, firefox + webkit, `workers: 1`:

| source | source under test | executions | failures | rate |
|---|---|---|---|---|
| review debdd0b0, 5 runs | `40dd9ee` and base `a28c2d1` | 350 | 10 | 2.9% |
| this card, runs 1-2 | `325a51c`, before mechanism A was fixed | 210 | 2 | 0.95% |
| this card, run 3 | `1ea1d75` | 140 | 4 | 2.9% |
| this card, run 4 | `1ea1d75` | 140 | 0 | 0% |
| **pooled** | | **840** | **16** | **1.9%** |

Chromium does not reproduce it: 105 executions of the same file at `1ea1d75`,
0 failures. Run 3 and run 4 are the same command against the same commit on the
same host, so the stall is bursty at the scale of a whole run rather than a
property of any one test.

Three facts the 2026-09-22 investigation did not have:

- **Firefox is affected too.** Of debdd0b0's 10 failures, 4 were Firefox
  (`persistence.spec.js` lines 187, 504 and 595); removing 595, which was
  mechanism A, leaves 3 genuine Firefox stalls against 6 on WebKit. The original
  investigation assumed and fixed for WebKit only.

- **It is not confined to `reloadAttach`, or even to attaching.** Of run 3's four
  failures, two were inside the plain `open()` helper on a brand-new page. One of
  those is decisive: `locator('#package-file')` was not found for the full 30s
  test timeout, after `page.goto('/')` had already resolved on `load`. That
  element is written by `main.js`'s first synchronous statement, before any
  viewer IndexedDB work exists, so for that failure the viewer's attach path
  cannot be the cause. The other two were `.document-title` never reaching
  `guide.md`.

- **The 5s waits elsewhere in the file are exposed.** Run 1's single failure was
  `expect.poll` on `(await rows(page, 'drafts')).length` timing out at 5s after
  `Delete saved work`, with a third page's attach housekeeping in flight.

### What was deliberately not done

`playwright.config.js` sets no `retries`. Adding them is the obvious systemic
stopgap for an engine stall the viewer cannot remove, and it is a policy call for
the caller rather than one to take inside a fix card: retries would also mask a
real regression in this file, which is the one file whose assertions are about
not losing a reviewer's work. Widening individual waits the way `reloadAttach`
was widened is whack-a-mole -- the stall lands wherever it lands, including on a
navigation that has nothing to do with storage.

**Decision (caller, 2026-09-23):** accept the ~1.9% rate (across 840
firefox/webkit executions, both engines) as-is for now. No retries are added and
no new harness-level investigation is opened; revisit only if the rate worsens or
the stall starts blocking real work.

### Open lead

While building the mechanism A controls, a mutation that added `hasWork: false`
to `store.js`'s position write was not observable at the end of the test, though
`lastRead` from the same `put` was. Something wrote the package row again after
`.local-save-status` had already read `Saved in this browser`, which is the
signal `saved(page)` treats as the work queue being settled. Not chased;
recorded because a work save landing after its own completion signal would be
its own bug, and would give several of these tests a second unsynchronised
writer.
