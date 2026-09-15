# Remembered review name — Code 46fbc379

Original Code task / landing owner: `46fbc379`.
Base: `17f7d973a7d589941110daba46faf0cce7990c5e`.
Branch: `feat/username-46fbc379`.
Worktree: `C:\Antiphon\worktrees\card-task-46fbc379`.

The supplied implementation brief is the initial plan. No task-specific landed
plan, AGENTS.md or docs/testing-and-build.md exists in this repository. This
artifact records the implementation and bounded verification design. This is a
JavaScript viewer: fresh Node TAP and Playwright JSON replace .NET class/TRX
reports. Audit every selected file/project/method and require nonzero counts.

## Behavior

Remember the review editor's **Your name** using the stable localStorage key
`mdpkg-viewer:author-name`. A nonempty name appears as a compact native button
with an accessible edit label. Click/keyboard activation opens and focuses the
existing input. Input updates the preference; blur or Enter returns to compact
display. Enter saves the name without submitting feedback. Empty names show the
full input and remove only this preference. Preserve the 200-character limit.
Storage errors must leave in-memory authoring usable. Render names as text.

An existing draft's exact author, including an empty value, overrides the default
for that draft without changing the preference merely by restoring it. New
comments/replies use the remembered default. Existing submitted authors remain
unchanged. Document browser/profile/origin scope and clearing behavior.
Long names truncate visually to one line while retaining the complete accessible
name and hover title. Saving/cancelling while the input has focus must work.

## Ordinary verification / coverage-to-file list

Build once per changed production source state into the isolated worktree's
`src/web-viewer/dist`. Do not edit source during runs. Commit/push before long
verification. No suite widening, retries, assertion relaxation or timeout changes.

| ID | Command / bounded coverage | Expected cost |
| --- | --- | --- |
| V-1 | `npm test`: all `tests/*.test.mjs` Node unit tests | <1 min |
| V-2 | `npm run build`: installed pins, bundle graph/gzip budget, relative deployment paths | <1 min |
| V-3 | `npx playwright test username.spec.js --reporter=line,json`: first run, reload/new page, compact layout, click/keyboard edit, Enter/blur, edited-name persistence, empty reset, exact draft precedence, storage failure and literal names; Chromium/Firefox/WebKit | 1–2 min |
| V-4 | `git diff --check`, docs consistency, fresh report method/count audit, pushed clean state, owned output cleanup | <1 min |
| R-1 | `persistence.spec.js`: exact draft restore, cancellation, atomic submitted feedback, storage fallback; all configured browsers | 2–3 min |
| R-2 | `review.spec.js`: author/reply/state/export, validation and in-flight invalidation; Chromium | <1 min |
| R-3 | `inline-comments.spec.js` and `inline-comment-regressions.spec.js`: repeated composers, relocated form, retained drafts; configured browsers | 1–2 min |
| R-4 | `snapshot.spec.js`, `selection.spec.js`, `preview.spec.js`: typed snapshot author/export, selection toolbar and preview/draft interaction; configured browsers | 1–2 min |
| R-5 | `python tests/validate-export.py test-results/browser-review.mdpkg` and same for `browser-commit-target.mdpkg`: independent export validation | <1 min |

V-3 and R-1–R-4 may share one Playwright command naming exactly those eight
files. No full-assembly or namespace-equivalent sweep is needed. Native CLI
production code and contracts are unchanged; independent browser export checks
and snapshot integration cover the touched browser authoring boundary.

Platform refinement: the first Windows sweep selected 195 cases (193 passed,
two startup/restore failures). The exact Chromium checkpoint failure reproduced
at the unchanged base; the exact WebKit snapshot failure did not. For the final
state, run the same eight-file matrix in the existing Playwright 1.55.1 Noble
image (CI platform, about 3–6 minutes), reusing the producer's built assets with
read-only source, isolated Linux dependencies and external output. Also run
username.spec.js on Windows in all three browsers, plus the two previously
failing methods for diagnosis. Preserve failures; do not add retries or relax
timeouts. The focused-input action test adds three cases (198 total).

## Pending deliberate controls — post-land Mutation only

Mutation owns red/restore/green and missing-control discovery. No deliberate
mutants run during Code. All controls use exact methods in username.spec.js:

- PC-1 / write, read: `name persists across reload and a new page without a saved draft`;
  separately disable preference writes and preference reads.
- PC-2 / collapse, reopen: `saved name is compact and click to edit saves on Enter without posting`;
  separately disable compact rendering and edit-button activation.
- PC-3 / update: `edited name persists after blur and clearing restores the first-run input`;
  retain the original stored name when editing.
- PC-3 / clear: same method; suppress removal of the empty preference.
- PC-4 / draft precedence: `restoring a draft preserves its author without replacing the remembered default`;
  replace the restored author with the preference.
- PC-5 / storage fallback: `unavailable localStorage still allows comments and in-tab name reuse`;
  exact method suffixes `: getter` and `: write`; remove the corresponding
  storage exception handling in each variant.
- PC-6 / compact long names: `remembered names render literally and fit the mobile editor`;
  restore multiline wrapping in the compact name button.

Ten variants are pending. Multi-tab live synchronization is outside this card;
new page/reload persistence is covered. Mutation may identify further gaps.

## Handoff

Ordinary read-only Review next. Caller records the companion verification
obligation and lands original Code task `46fbc379`; Code does not merge or deploy.
After landing, check the exact commit's Pages workflow build/deploy success and
verify name persistence/editing on the live GitHub Pages site before card closure.
Explicitly commission SourceLanding Mutation after landing. Restart: none.
