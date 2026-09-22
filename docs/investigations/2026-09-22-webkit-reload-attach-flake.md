# The WebKit reload-and-reattach flake in `persistence.spec.js`

Status: closed. Measured on 2026-09-22 on the same Windows host the viewer's other
browser evidence uses, with `@playwright/test` 1.55.1 and the bundled WebKit.

## The failure

`persistence.spec.js:132` (`changed text under the same declared identity preserves
feedback for recovery`) failed roughly one WebKit run in thirty, always inside the
shared `reloadAttach` helper and never in the assertions the test is about. Two
distinct symptoms, both 5s expect timeouts, both on the page that has just reloaded:

- `.document-title` still empty after `setInputFiles`, and
- no `Choose file again` button after `page.reload()`.

Baselines at the commit before this work, single test, WebKit, `--repeat-each`:
12 + 40 + 40 runs, 3 failures (3.3%).

## Where the time went

Timings were taken by wrapping `store.js`'s `transaction()` and the `receive` /
`prepare` / `attach` boundaries in `console.log`, running 40 repeats and dumping the
console of each run. The instrumentation is not in the tree; it was reverted before
the fix was committed.

Two failing runs, post-reload attach:

| run | `openPackage` write | then |
|-----|--------------------|------|
| r26 | +2153ms            | the `prune` write never returned |
| r25 | +269ms             | `prune` +467ms, then the recents relist (3 readonly transactions) never returned |

`attach()` awaited four IndexedDB round trips -- `openPackage`, `saveHandle`, `prune`
and `refresh` -- and `receive()` in `main.js` renders the first document only after
attaching resolves. Any stall in the three maintenance steps therefore left the reader
blank. This is a tail, not a systematic cost: over 40 healthy WebKit attaches the whole
`receive` -> rendered document path is 262ms (p50; p90 298ms, max 344ms), of which the
container open is 47ms, `prepare` 137ms and the package write 75ms, and the reload to
the resume offer is 146ms (p90 160ms, max 277ms). The failures are 20-40x those
medians and land on reads of object stores no concurrent write touches, so the stall
is WebKit's, not extra work the viewer does.

## What changed

1. `session.js` `attach()` now awaits only `store.openPackage` -- it installs the
   package record every later save needs. `saveHandle`, `prune` and the recents
   relist continue in the background with the same error handling. Guarded by
   `storage housekeeping never delays the restored document or its saved draft`,
   which withholds completion of the prune write and requires the document, the
   restored draft and a further save to land while it is outstanding. Red in all
   three engines before the change (`.document-title` empty at 5s), green after.

2. That made relisting genuinely concurrent, and a repeated whole-file WebKit run
   found the consequence: `remove recents retains saved work` failed with the list
   still reading `original.mdpkg · Saved draft` and no `Saved work` -- a relist that
   read before the removal repainted the list after it. `refresh()` now skips its
   render when a later relist has started. Guarded by `a relist stalled by attaching
   cannot repaint the list over a newer one`, red in all three engines with exactly
   that text, green after.

3. The two waits in `reloadAttach` carry a 12s budget with the measurements above as
   the reason. The engine stall is not something the viewer can remove; it lands on
   whichever wait it overlaps. The 30s test timeout still bounds an attach that never
   completes, and no other assertion in the file was touched.

## After

- Unit lane (`npm test`): 216 passed.
- Browser lanes: chromium 153, firefox 63, webkit 63 -- all passed.
- `persistence.spec.js` x4 on WebKit, twice: 140 + 140 passed, 0 failed.
  The same shape before the fix failed 3 of 136 and 2 of 136; at the base commit it
  passed 132 of 132.
