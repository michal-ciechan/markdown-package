# Phase 1 execution plan: Windows desktop app (Tauri v2)

Date: 2026-09-23. Card: CARD-0070. Status: decomposition of the master plan's Phase 1 into
tracked sub-cards; W1 dispatched the same day.

This document turns section 6 "Phase 1: Windows desktop" of the master plan
(`docs/plans/2026-09-18-native-viewer-shells.md`) into an executable sequence of milestones,
each with its own board card and a delegate-ready goal. It corrects the record where the
master plan and the card description have drifted from the code, and it records the working
defaults (naming, layout, versioning) that the milestones need but no earlier document decided.
It does not restate the master plan's design: the "why" behind each item lives there, in the
spike report (`docs/plans/2026-09-19-phase0-windows-spike.md`) and in the distribution plan
(`docs/plans/2026-09-19-native-app-distribution.md`).

Everything below rests on a repo and toolchain survey completed on 2026-09-23 (Antiphon task
02185ebe); the facts it established are folded in rather than cited one by one.

## 1. Corrections and clarifications to the record

| # | Topic | What the earlier text says | What is true now, and what this plan does about it |
|---|---|---|---|
| 1 | Test counts | "108 Playwright tests" in some older text | 14 Playwright spec files, about 229 executions across the three engines (`workers: 1`, no timeouts or retries configured); 13 Node test files, 84 tests. "Unchanged in the browser lane" means these counts and results hold |
| 2 | Dialog call sites | `main.js:121`, `session.js:63`, `session.js:189` | `src/web-viewer/src/main.js:152` (discard unsaved feedback on open), `src/web-viewer/src/persistence/session.js:70` (delete a recents entry's saved work), `src/web-viewer/src/persistence/session.js:196` (discard current drafts/review). Exactly three `window.confirm` calls, zero `alert`/`prompt`; the tests contain no real dialog calls. The item-F gate fails today (3 matches) |
| 3 | Item I (loose-document synthesizer) | W3 builds it | Already shipped by CARD-0062 as `src/web-viewer/src/inbound/loose.js`: `MAX_LOOSE_BYTES` (64 MiB), `looseNamespace(identity)`, `synthesizeLoose(bytes, name, {identity})`. `identity` is required and caller-supplied; the shell passes the absolute path. W3 wires it, it does not rebuild it |
| 4 | CI caching (item K) | Floating between milestones | Owned by W4a, deliberately: no Rust or cargo caching exists anywhere in `.github/workflows/` today, and a new `desktop.yml` must cache `~/.cargo` and `target/` from its first commit (cold release build about 18 min, cold debug build about 7 min) |
| 5 | Updater ownership | CARD-0070's description put the updater in W5 | W4 (here W4c) owns the updater. W5 is acceptance only |
| 6 | Phase 1.5 | Sometimes read as part of phase 1 | Separate phase (items L and M), after W5 and before phase 2. Tracked as CARD-0079 so it is not lost, not started before W5 is Done |
| 7 | Dialog plugin timing | W1 "native picker opens .mdpkg" reads as if it needs `tauri-plugin-dialog` | Registering that plugin before the item-F gate silently discards unsaved work (measured, master plan section 2.4). W1 and W2 therefore register NO dialog plugin; W1's "native picker" is whichever picker route the viewer already has that WebView2 serves natively (File System Access `showOpenFilePicker` or `<input type=file>`). The plugin is registered in W3a, in a commit after the gate commit |
| 8 | Association config vs installer quality | W4 lists the associations; W2's acceptance needs them | W2 adds the configuration only (`bundle.fileAssociations` for `.mdpkg`, the spike's `installer-hooks.nsh` for the `.md` "Open with" entry) so its own acceptance can be exercised with a local build. W4b owns installer quality: icons, the two spike NSIS defects, association restore on uninstall, README SmartScreen steps |
| 9 | Update test versions | W4 says "0.1.0 -> 0.1.1" | Superseded by the distribution decision that the desktop version couples to the shared `<Version>` in `src/generator-cli/Mdpkg.Pack.props` (1.0.0 today). W4c uses two consecutive coupled versions or pre-release builds; the mechanism is W4a's (section 5) |
| 10 | Adapter item A | Listed under W3 | W2 is the first milestone that needs it (launch files, open-file events, `readFile`), so W2 introduces the module with those members and W3a/W3b complete it (`confirm`, `message`, `saveFile`, `share`, `openExternal`, `onCloseRequested`) |
| 11 | Native material in git | None | True: no `src-tauri/`, no Rust, no branch. The phase 0 spike survives only as the gitignored `.spike-tauri/` in the main checkout (`C:\src\markdown-package\.spike-tauri\app\src-tauri\`): `Cargo.toml` with a release profile, `capabilities/default.json`, `installer-hooks.nsh`, icons, and a `lib.rs` whose six benchmark commands are throwaway. W1 copies the reusable pieces; nothing references the spike directory |

## 2. Preconditions (W0, folded into W1's first step)

The machine that runs W1 has the pieces but not the wiring:

- `cargo`/`rustc` 1.98.1 are installed under `%USERPROFILE%\.cargo\bin` but that directory is
  not on `PATH`. Target `x86_64-pc-windows-msvc` only.
- `tauri-cli` is not installed (`cargo install tauri-cli --version "^2" --locked`, resolving
  to 2.11.x at the time of writing).
- `makensis` exists only as Tauri's managed copy under `%LOCALAPPDATA%\tauri\NSIS\`.
- WebView2 runtime 153.x and MSVC build tools (VS2022 Community) are present.
- Node 24.6 / npm 11.5; `src/web-viewer` needs `npm install` in a fresh worktree because
  `build.mjs` hard-fails without `node_modules`.
- `gh` 2.93 is authenticated with `repo` and `workflow` scopes against
  `https://github.com/michal-ciechan/markdown-package.git` (needed from W4a on).

These are not a separate card: they are step 0 of CARD-0071 and get documented in the desktop
dev doc that W1 writes.

## 3. Milestones

Each milestone is one card. Every card's description carries the delegate-ready goal, scope,
acceptance and verification; this section is the map, the cards are the territory. Milestones
run through the ordinary pipeline (Code, Review, land) one at a time except where noted.

### 3.1 W1 Shell boots (CARD-0071)

Goal: `src/desktop/src-tauri/` in the repo, built from the spike's reusable pieces; the
viewer's `dist/` loads; a `.mdpkg` opens through the viewer's existing picker route;
IndexedDB persists across app restarts; the browser lane is unchanged.

Scope: toolchain step 0; scaffold from the spike (rename, drop benchmark commands, trim
capabilities to core, placeholder icons, commit `Cargo.lock`); `tauri.conf.json` with the
section 5 defaults, `dragDropEnabled: false`, no `useHttpsScheme`, a CSP that allows `blob:`,
NSIS `currentUser`; `lib.rs` with no plugins; a desktop dev doc; `.gitignore`.

Out: everything path-based (W2), every plugin (W2 onward), CI (W4a).

Acceptance: `cargo tauri build --debug` succeeds with times recorded; open from `examples/`
via the picker route WebView2 serves (record which); draft survives quit and relaunch; Node
and Playwright suites pass with unchanged counts.

### 3.2 W2 OS entry points (CARD-0072)

Goal: double-click, "Open with", drag onto the window, paste, and launch with a path all
open the file; a second launch forwards to the running instance and goes through the
existing unsaved-work confirm.

Scope: host adapter skeleton (item A: `detect`, `launchFiles`, `onOpenFile`, `readFile`)
behind a dynamic `import()` so the eager graph grows by a stub only (R9, `APP_BUDGETS`);
item B (`receive()` accepts `{blob, sourceKind: 'host', path, name}`); argv on startup via a
command the JS calls once booted; `tauri-plugin-single-instance` forwarding argv and cwd;
`tauri-plugin-fs` `readFile` (the spike's IPC choice) with a recorded scope; association
configuration (item 8 above); verification of the HTML5 drop and paste routes in WebView2.

Out: items C to G (W3), the NSIS fixes (W4b), the dialog plugin (W3a).

Acceptance: a manual matrix over every entry point with a locally built debug installer;
Node tests for the browser implementation and the host source; Playwright unchanged.

### 3.3 W3a Dialog gate, item F (CARD-0073) - phase 1 blocker

Goal: zero `window.confirm` / `window.alert` under `src/web-viewer/src`; the three guards go
through `host.confirm`; native close flushes then confirms; `tauri-plugin-dialog` is
registered only after the gate commit; a shell smoke proves Cancel cancels.

Scope: `confirm`/`message` on the adapter (the browser implementation is the only place that
touches the built-in, spelled `globalThis.confirm`); convert the three call sites and make
their callers async-safe; `CloseRequested` hook; the gate enforced by grep and by a Node
test; plugin registration in a separate, later commit with minimal capabilities; manual
smoke over the three guards and window close.

Acceptance: gate zero and tested; smoke recorded with its commit; suites green; the
registration commit is later than the gate commit.

### 3.4 W3b Loose .md and the rest of the adapter (CARD-0074)

Goal: a loose `.md` from any native route renders through the existing `loose.js` with the
absolute path as identity; recents reopen by path (item C); export through a native save
dialog (item D); share degrades gracefully (item E); external links through the opener
plugin (item G); a browser-lane Playwright case for loose `.md` (cite CARD-0062's if one
exists).

Acceptance: native Open-with on `.md` renders; edit and reopen keeps the namespace and
reattaches saved comments; recents reopen by path after a restart; export writes where the
dialog pointed; links open the default browser; a 65 MiB `.md` is refused cleanly; suites
green; budgets respected.

### 3.5 W4a CI caching, release workflow, version coupling (CARD-0075)

Goal: `.github/workflows/desktop.yml` on `windows-latest` with `~/.cargo` and `target/`
cached from its first commit; `tauri-action` producing an installer artifact on push/PR and a
draft GitHub Release on the release trigger; the desktop version derived from
`Mdpkg.Pack.props` (section 5).

Runs after W1 lands and may overlap W2/W3 when a Code slot is free: it touches `.github/`
and `src/desktop` only.

Acceptance: cold and warm CI runs recorded with minutes; a draft release produced and
recorded; the drift check demonstrated both ways.

### 3.6 W4b Installer quality (CARD-0076)

Goal: unsigned per-user NSIS installer with real icons; `.mdpkg` default handler and `.md`
"Open with" candidate only (D2); the two spike NSIS defects fixed (quote the program path in
`shell\open\command`; delete the orphan `HKCU\Software\Classes\.mdpkg` on uninstall); the
uninstaller restores the previous association; README SmartScreen steps.

Acceptance: registry diffs before install, after install, after uninstall recorded under
`docs/investigations/`; a path or account with a space exercised; sizes recorded.

### 3.7 W4c Updater (CARD-0077)

Goal: `tauri-plugin-updater` against
`https://github.com/michal-ciechan/markdown-package/releases/latest/download/latest.json`;
minisign private key held outside the repo (GitHub Actions secrets plus the owner's password
manager); `includeUpdaterJson` in `desktop.yml`; an update offer through `host.message` /
`host.confirm`; two consecutive real releases; the update performed on a clean Windows 10 VM
with the SmartScreen outcome recorded.

Acceptance: signatures and `latest.json` on a real release; A updates to B; SmartScreen
outcome and timings recorded; key custody and rotation documented.

### 3.8 W5 Acceptance (CARD-0078)

Goal: the manual checklist executed and recorded under `docs/investigations/`; a
`tauri-driver` smoke job on the Windows runner covering the adapter points (launch with a
path, cancelled confirm cancels, recents by path, export, external link via the opener); the
README desktop section finalised. W5 files Backlog cards for what it finds rather than fixing
unrelated defects.

Done for CARD-0070 means, per its description: installable Windows app; `.mdpkg` and `.md`
associations working; opens `.mdpkg` and loose `.md`; viewer features identical to the
browser; all spike-flagged defects fixed; dialog blocker resolved; a working unsigned
auto-update against a real GitHub Release.

### 3.9 Phase 1.5 placeholder (CARD-0079)

Items L (watch the parent directory of an opened loose `.md`, identity-gated notice with
Reload, the three handler rules from section 2.7) and M (unified Myers diff with three lines
of context, lazily imported). Low importance; split into L1 and L2 when picked up; not
before W5 is Done.

## 4. Order and dependencies

```
W1 (CARD-0071) ---> W2 (CARD-0072) ---> W3a (CARD-0073) ---> W3b (CARD-0074) ---> W5 (CARD-0078)
       |                  |                    |                                      ^
       |                  +---> W4b (CARD-0076) ------------------------------------+
       |                                       |                                      |
       +---> W4a (CARD-0075) ---> W4c (CARD-0077) <-----------------------------------+
                                                 (W4c also needs W3a's host.confirm)

Phase 1.5 (CARD-0079) after W5 is Done.
```

Hard edges: W2 needs W1's shell; W3a needs W2's adapter skeleton; W3b needs W3a's dialog
plugin for `saveFile`; W4a needs W1's `src/desktop`; W4b needs W2's association config; W4c
needs W4a's workflow and W3a's `host.confirm`; W5 needs everything.

Parallelism: W4a is the only milestone that can safely overlap the W2/W3 chain, because it
touches `.github/` and `src/desktop` only. Everything else serialises on
`src/web-viewer/src` and `src/desktop/src-tauri`. A milestone whose Code task touches the
same area as a Code task already in flight waits for that task to land.

## 5. Working defaults decided here

These were undecided anywhere; the milestones need them; the owner can override any of them
before the first release (W4a) at the cost of a rename.

| Decision | Default | Why |
|---|---|---|
| Location | `src/desktop/` with `src-tauri/` inside, `frontendDist` = `../../web-viewer/dist` | Matches the repo's `src/<component>` layout; the master plan's bare `src-tauri/` predates looking at the tree |
| Product name | `Markdown Package Viewer` | Names the thing; the CLI stays `mdpkg` |
| Bundle identifier | `net.codeperf.mdpkg` | Reverse-DNS of the owner's domain; the spike used `net.codeperf.mdpkgspike` |
| Binary name | `mdpkg-viewer` (`mainBinaryName`) | No spaces in the exe or the association command |
| Icons | Spike placeholders in W1; a generated v1 set in W4b with the source image committed | No icon asset exists; W4b's design is a placeholder the owner can swap |
| Version | `tauri.conf.json` `version` equals `<Version>` in `src/generator-cli/Mdpkg.Pack.props`; hand-set to `1.0.0` in W1; W4a adds a sync script run by `beforeBuildCommand` and CI plus a drift check; `Cargo.toml`'s version is not the source of truth | The distribution plan decided the coupling but not the mechanism |
| Tags | The release workflow creates `v<version>`; never by hand | GitHub Releases require a tag; the repo has never used one and `docs/releases/mdpkg.md` stays a single manual bump step |
| Release trigger | `workflow_dispatch` (build artifacts on every push/PR) | Mirrors the manual bump; avoids paying a release build per master push |
| Dialog plugin | Not before the W3a gate commit; `dialog:allow-message` at minimum, reconciled with the plugin's API in W3a | Master plan section 2.4 |
| Plugins in W1 | None | Keeps the boot milestone about the shell |
| `Cargo.lock` | Committed | It is an application |
| `.md` association | `OpenWithProgids` only, via `installer-hooks.nsh` | Decision D2 |
| Signing | Unsigned v1; minisign updater key only | Decision D4; no certificate budgeted |

## 6. Open questions for the owner (defaults apply until answered)

1. Naming: confirm or replace the product name, identifier and binary name above before W4a
   cuts the first release.
2. Windows 10 VM for W4c's update test: is one available to a delegate? If not, the test runs
   on this machine and the VM run becomes an owner step.
3. Minisign key custody: GitHub Actions secrets plus Bitwarden is the default; say if the key
   should live elsewhere.
4. Version bumps for the updater test: two consecutive coupled versions of the shared
   `<Version>`, or pre-release builds? W4c asks if unsure.
5. Icon: a placeholder design is generated in W4b; supply an image if you want the v1
   release to carry a real brand.

## 7. Tracking

| Card | Milestone | Importance | Depends on |
|---|---|---|---|
| CARD-0071 | W1 Shell boots (plus W0 toolchain) | High | - |
| CARD-0072 | W2 OS entry points | High | CARD-0071 |
| CARD-0073 | W3a Dialog gate (item F) | High | CARD-0072 |
| CARD-0074 | W3b Loose .md and adapter items C-E, G | High | CARD-0073 |
| CARD-0075 | W4a CI caching, release workflow, version coupling | Normal | CARD-0071 |
| CARD-0076 | W4b Installer quality | Normal | CARD-0072 (CARD-0075 preferred) |
| CARD-0077 | W4c Updater | Normal | CARD-0075, CARD-0073 |
| CARD-0078 | W5 Acceptance | Normal | all of the above |
| CARD-0079 | Phase 1.5 placeholder (L1, L2) | Low | CARD-0078 Done |

Parent: CARD-0070 moves to Review when CARD-0078 is Done.