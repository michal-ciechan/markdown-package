# Distributing the native Windows viewer app: investigation and recommendation

Date: 2026-09-20 (brief-assigned filename keeps the 2026-09-19 stem). Investigate
task `2d7d115e`. Follow-on to `docs/plans/2026-09-18-native-viewer-shells.md`
(CARD-0059, decided) and `docs/plans/2026-09-19-phase0-windows-spike.md` (phase 0,
measured). Investigated at commit `f088f2a` (master). **No code changed; nothing
was published, submitted or registered by this task.**

Scope: how phase 1 (Windows) of the Tauri viewer reaches users, alongside the
distribution story this repository already has. Investigation and recommendation
only — the channel choice is the caller's to accept.

## 0. Recommendation in one line each

| # | Question | Answer |
| --- | --- | --- |
| Primary channel | How does phase 1 ship? | **GitHub Releases, published by `tauri-action`, with the Tauri updater's `latest.json` as a release asset.** It is the only channel the already-decided design (D4: unsigned + built-in updater) actually requires, the only one that can serve the updater, and it is the source every other Windows channel points at |
| Secondary, later | What is worth adding after v1 proves out? | **winget, once there is a second release and a real user asking for it.** No signing requirement blocks it (§4.2); the blockers are a per-release manifest chore and an unsigned-binary scan risk. Scoop `extras` is the cheapest distant third (§4.4) |
| Not recommended | Chocolatey | Moderation queue, a second packaging format to maintain, and no audience evidence (§4.3). Revisit only on request |
| Not recommended | Thin `dotnet tool` wrapper (`mdpkg-viewer`) | **Rejected.** It cannot deliver the thing phase 1 exists to deliver — file associations, "Open with", single-instance launch, Start Menu, updater — because those come from the NSIS installer, not from a binary on `PATH`. It adds a second install path, a second version number and a .NET runtime prerequisite for an app with no .NET in it (§4.5) |
| Not recommended | npm / npx | Wrong audience, wrong shape (GUI app, not a CLI), and `src/web-viewer/package.json` is `"private": true` with no npm presence to build on (§4.6) |
| Continuity constraint | Do existing `dotnet tool` users force a .NET-flavoured channel? | **No — and the evidence says there is no external user base to be continuous with** (§5). If that turns out to be wrong, the change is documentation (a pointer from the tool's README to the app), not a channel |

The repository's existing distribution story is unaffected: `mdpkg` stays a NuGet
global tool, the browser viewer stays on GitHub Pages, and the desktop app becomes
a third, independent artifact with its own version line.

## 1. What this repository distributes today (ground truth)

Read, not assumed. Evidence at `f088f2a`.

### 1.1 A .NET global tool exists, and it is published

`src/generator-cli/src/Mdpkg.Cli/Mdpkg.Cli.csproj:14-19` is the whole answer to
the brief's first question:

```xml
<PackAsTool>true</PackAsTool>
<ToolCommandName>mdpkg</ToolCommandName>
<PackageId>mdpkg</PackageId>
```

- **Package id:** `mdpkg`. **Install command:** `dotnet tool install --global mdpkg`
  (`README.md:63`). `AssemblyName` is also `mdpkg`, and `RollForward=Major` is set
  so the tool runs on any newer runtime.
- Three IDs are published from one coordinated version in
  `src/generator-cli/Mdpkg.Pack.props:5` (`<Version>1.0.0</Version>`): `mdpkg`,
  `Mdpkg.Reader`, `Mdpkg.Core`. `Mdpkg.Reviews` shares the version, is built and
  inspected, and is deliberately not pushed.
- Publication is `.github/workflows/publish-nuget.yml`: push to `master` touching
  `src/generator-cli/**`, NuGet Trusted Publishing (OIDC) in the `nuget`
  environment, then a `prove-nuget-org` matrix that installs from the public feed.
  **No git tags and no GitHub Releases are involved** — `docs/releases/mdpkg.md`
  says so explicitly ("No tags, CHANGELOG or GitHub Packages mirror are involved.
  This supersedes the older CARD-0033 tag proposal").
- Live on nuget.org, checked 2026-09-20 against the v3 flat-container and
  registration indexes:

  | Version | Published |
  | --- | --- |
  | `0.1.0-preview.1` | 2026-09-10 |
  | `0.1.0-preview.2` | 2026-09-10 |
  | `0.1.0-preview.3` | 2026-09-11 |
  | `1.0.0` | 2026-09-15 |

  `Mdpkg.Reader` has `0.1.0-preview.2`, `0.1.0-preview.3`, `1.0.0`.

  *Doc drift, noted not fixed:* `README.md:60` still reads "After the **1.0.0**
  public-feed gate succeeds, install the stable tool…". The gate succeeded on
  2026-09-15 (`publish-nuget.yml` run at `ef70683d`), so that sentence is stale.

### 1.2 The browser viewer is a GitHub Pages deployment

`.github/workflows/pages.yml` builds `src/web-viewer/dist/` and deploys it to
`https://michal-ciechan.github.io/markdown-package/`. `src/web-viewer/package.json`
is `"name": "mdpkg-viewer", "private": true` — **not** an npm package; npm is a
build toolchain here, not a distribution channel.

### 1.3 The repository has never cut a release artifact

```text
git tag                -> (empty, 0 tags)
gh release list        -> (empty, 0 releases)
gh repo view           -> public, 0 stars
```

Everything shipped so far has gone out through NuGet's version-on-push mechanism
or Pages. **Phase 1 is the first artifact this repo would publish as a downloadable
file, and therefore the first that needs a tag/release train at all.** That is new
process, and it is the same new process under every channel in §4, because every
Windows package manager wants a stable, hash-pinned URL to download from.

## 2. What is actually being distributed (measured, not estimated)

From `docs/plans/2026-09-19-phase0-windows-spike.md` §1 and §3, measured on Windows
10 Pro 19045 on 2026-09-19/20:

| Property | Measured value | Why distribution cares |
| --- | --- | --- |
| Artifact | NSIS `*-setup.exe`, `installMode: currentUser` | winget/Chocolatey/Scoop all support `nsis`; `currentUser` means no UAC prompt |
| Installer size | 1,680,210 bytes (1.60 MiB) | Trivial to host on a GitHub Release |
| Installed payload | `mdpkg-spike.exe` 5,212,672 bytes (4.97 MiB) + `uninstall.exe` 79,330 bytes in `%LOCALAPPDATA%\<App>` | Small; no runtime prerequisite beyond the WebView2 runtime |
| Silent install | `/S` completes in **3 s** | Satisfies winget's "installer supports non-interactive modes" and Chocolatey's silent-default rule |
| Silent uninstall | `uninstall.exe /S` returns 0; install directory and Start Menu entry gone | Satisfies winget's uninstall validation — **with one exception, below** |
| Uninstall residue | `HKCU\Software\Classes\.mdpkg` survives with an empty default and a stale `*_backup` value (spike §3.3 defect 2) | Exactly the shape of thing winget's `Validation-Uninstall-Error` looks for. Fix it in W4 regardless of channel |
| Release build cost | `npm run tauri build` **17 min 59 s** cold on this machine | Any channel that wants a per-release artifact inherits this; CI must cache `~/.cargo` and `target/` |
| Cold start | ≈1.9 s process start → first JS line | Not a distribution input; recorded because it is the user's first impression of a downloaded app |
| Signing | **None** (plan D4: unsigned for v1) | Drives SmartScreen (§3) and the winget scan risk (§4.2) |

Two further facts the spike established that constrain the channel choice:

1. **The installer is not optional.** `.mdpkg` association, the `.md`
   `OpenWithProgids` entry (D2), the icons and the uninstall/restore behaviour are
   all written by NSIS `installerHooks` at install time (spike §3, with the exact
   `.nsh` quoted). A user who merely obtains `mdpkg-viewer.exe` gets none of it.
2. **The updater is part of the product, not a channel.** Plan D4 ships
   `tauri-plugin-updater` against a `latest.json`, with artifacts signed by a
   minisign-style key generated by `tauri signer generate` (public key in
   `tauri.conf.json`, private key in CI secrets plus an offline copy; losing it
   means no further updates, ever).

## 3. The one thing every Windows channel inherits: SmartScreen

Decision D4 already accepted this, and it is not a reason to prefer one channel
over another — it follows the *binary*, not the delivery route:

- A browser-downloaded unsigned installer shows "Windows protected your PC";
  the user clicks More info → Run anyway. The README documents it (plan §2.5).
- SmartScreen reputation accrues per signing identity, and an unsigned binary has
  none, so reputation never builds. The remedy is a certificate (OV, or Azure
  Trusted/Artifact Signing if the publisher qualifies), revisited after v1.
- **Open and untested:** whether an *updater-launched* install (as opposed to a
  browser download, which carries the Mark of the Web) trips SmartScreen at all.
  The plan already books this as W4/R7 on a clean VM. It is still open after the
  phase 0 spike (spike §8: "Everything about signing, the updater and SmartScreen
  (D4, R7) — that is W4 on a clean VM, not this spike").
- The only channel that *removes* SmartScreen rather than documenting it is the
  Microsoft Store, which signs on the publisher's behalf (§4.7).

## 4. The options, compared

| Option | Effort for v1 | Per-release cost | Serves the updater? | Registers `.mdpkg` / "Open with"? | Signing needed? | Audience fit |
| --- | --- | --- | --- | --- | --- | --- |
| **A. GitHub Releases** | Low — one workflow (`tauri-action`) | Automatic, in the same workflow | **Yes — it is the endpoint** | Yes (runs the NSIS installer) | No | Everyone; it is where the repo already lives |
| **B. winget** | Medium — manifest + PR + moderation | A manifest PR per release (automatable) | No (points at A) | Yes | No, but unsigned raises a scan risk | Good for Windows devs who already `winget install` |
| **C. Chocolatey** | Medium-high — nuspec + PS scripts + moderation | A package push per release, plus moderator round-trips | No (points at A) | Yes | No | Narrow; ops/enterprise-flavoured |
| **D. Scoop (`extras`)** | Low-medium — one JSON manifest | Usually auto-bumped by Scoop's own checkver/autoupdate | No (points at A) | Only via `installer` block; awkward | No | Small, dev-heavy |
| **E. `dotnet tool` wrapper** | Medium — a new .NET project, a download/launch path, a cache | A version bump plus a second release train | No — would fight it | **No** | No | The repo's nominal audience, but see §4.5 |
| **F. npm / npx** | Medium | Per-release publish | No | No | No | Wrong audience entirely |
| **G. Microsoft Store** | High — MSIX repack, account, identity | Store submission per release | No — Store apps update via Store | Yes (MSIX declarations) | **Store signs for you** | Broad, but reverses D4 |

### 4.1 A. GitHub Releases — recommended primary

**What it is.** `tauri-apps/tauri-action` builds on a `windows-latest` runner,
uploads `*-setup.exe`, `*-setup.exe.sig` and `latest.json` to a GitHub Release, and
the updater's `endpoints` entry points at a stable URL such as
`https://github.com/michal-ciechan/markdown-package/releases/latest/download/latest.json`.
Tauri's updater docs confirm the static-JSON shape (`version`, `platforms`,
`<os>-<arch>` → `{url, signature}`, optional `notes`/`pub_date`), that HTTPS is
enforced in production, and that on Windows the app exits while the installer runs,
with `installMode` `passive` (default) / `basicUi` / `quiet`.

**Why it wins for phase 1.**

1. **It is already the decided design.** D4 says "GitHub Releases plus the updater";
   choosing anything else as *primary* would mean re-opening a settled decision.
2. **It is load-bearing.** Every other channel in this table downloads from it. Even
   if winget shipped on day one, the winget manifest's `InstallerUrl` would be a
   GitHub Release asset (evidence: `GitHub.cli` 2.99.0's winget manifest uses
   `https://github.com/cli/cli/releases/download/v2.99.0/...`). So A is not one of
   several options; it is the floor, and the real question is only what to add on top.
3. **Zero new gatekeepers.** No moderation queue, no third-party policy, no account
   provisioning reserved for the human. Phase 1 can ship, be found broken, and ship
   again the same day — which matters for a first native release with an untested
   updater.
4. **It is the only channel that can carry the `.sig`.** The updater needs the
   signature file beside the installer; package managers distribute the installer
   alone.
5. **It costs the release train the repo needs anyway** (§1.3), and nothing more.

**What it does not do.** No discoverability: nobody finds a GitHub Release by
searching. Users must arrive from the README, the Pages viewer, or a link. For a
0-star repository with no evidence of external users (§5), discoverability is not
yet the binding constraint; *shipping and self-updating correctly* is.

**New work this implies (not designed here, for the phase-1 plan stage):** a tag or
release-trigger convention, since the repo has none; a desktop-app version line
separate from `Mdpkg.Pack.props` (the app has nothing to do with the NuGet
version); `~/.cargo` and `target/` caching against the measured 18-minute release
build; and secure storage for the updater private key, whose loss is terminal.

### 4.2 B. winget — the one secondary worth planning for

**Requirement check, against Microsoft's own submission docs** (learn.microsoft.com,
"Submit your manifest to the repository", validation and policy sections):

| Requirement | Status for this app |
| --- | --- |
| Manifest complies with schema; path is `manifests/<letter>/<publisher>/<app>/<version>` | Straightforward; identifier would be e.g. `MichalCiechan.MarkdownPackageViewer` |
| `InstallerSha256` matches `InstallerUrl` | Automatable from the release asset |
| "The installer comes directly from the publisher's website"; redirectors rejected (`Validation-Indirect-URL`) | **Satisfied by GitHub Releases** — confirmed by reading a live manifest: `GitHub.cli` 2.99.0 uses `github.com/cli/cli/releases/download/...` |
| "The installer supports non-interactive modes" | **Satisfied and measured**: NSIS `/S` completes in 3 s (§2) |
| "Installs and uninstalls correctly for both administrators and non-administrators" | Per-user NSIS; declare `Scope: user`. Uninstall is clean except the orphan `.mdpkg` registry key (§2) — fix before submitting, since `Validation-Uninstall-Error` is exactly "did not clean up completely following uninstall" |
| Antivirus / Defender scan (`Binary-Validation-Error`, `Validation-Defender-Error`) | **The real risk.** Unsigned Rust/NSIS binaries with no reputation are the population false positives come from. Microsoft's own guidance is to submit to Defender for false-positive analysis and, failing that, the PR is rejected |
| Code signing | **Not required.** Microsoft's submission requirements list virus-freedom, silent install, clean uninstall and URL provenance — signing is not among them. MSIX is the format with a hard signing requirement; NSIS/MSI are hash-validated. Treat this as "documented absence of a requirement", not as an explicit permission |
| Review | Automated pipeline, then manual moderator approval; `Needs-Author-Feedback` closes the PR after 10 days of silence |

**Why later, not now.** Three reasons, in order of weight:

1. **A manifest per release is an ongoing obligation.** It can be automated (a
   release-triggered submission action, or `komac`), but that automation is itself
   phase-1-sized work with a third-party approval loop in the middle.
2. **It duplicates the updater.** The app self-updates (D4); winget also wants to
   own updates. In practice the app's own update rewrites the Add/Remove Programs
   entry, so `winget upgrade` reads the newer version and stays quiet — but the
   two mechanisms are not coordinated, and the interaction is *unverified here*. It
   needs its own W-level check before winget is offered as a supported route.
3. **No demand evidence** (§5). Submitting to a public catalogue an app that nobody
   has asked for buys a moderation relationship, not users.

**When to add it:** after v1 has shipped at least one real 0.1.0 → 0.1.1 update
through the updater (W4's exit criterion anyway), and ideally after a certificate
exists, which retires the scan risk and the SmartScreen paragraph at the same time.

### 4.3 C. Chocolatey — not recommended

Chocolatey's community-repository docs describe: an account, a nuspec needing
`ProjectUrl`, `LicenseUrl`, an icon on a CDN and vendor-attributed `Authors`; an
install script that downloads from the official source with silent defaults; a
~30-minute lag before automated review; three automated gates (validator ~76 rules,
verifier install/uninstall test, cleaner); and a 20-day + 15-day clock that
auto-rejects a package whose maintainer does not respond. Code signing is not
mentioned as a requirement.

None of that is prohibitive — it is simply a *second* moderated packaging format,
with its own PowerShell install script to maintain, serving an audience this project
has no evidence of. winget covers the same need for the same user with one format
fewer. Revisit only if a user asks by name.

### 4.4 D. Scoop — the cheap third, if discoverability ever matters

Not in the brief, included because it is strictly cheaper than Chocolatey for the
same "Windows dev package manager" slot: a single JSON manifest in the community
`extras` bucket, community moderation that is lighter than either winget's pipeline
or Chocolatey's queue, and `checkver`/`autoupdate` fields that let Scoop track new
GitHub Releases without a per-release PR. The catch is that Scoop's model is
portable-app extraction; running a real installer needs an `installer` block and the
app then lives outside Scoop's usual uninstall story. Worth one line in a future
plan, not a phase-1 commitment.

### 4.5 E. A thin `dotnet tool` wrapper — investigated properly, and rejected

This deserves more than a dismissal, because the premise is reasonable: the project's
only published artifact today is a .NET global tool (§1.1), so a
`dotnet tool install -g mdpkg-viewer` would land in a channel the audience already
has configured.

**It is technically possible, and more possible than it used to be.** .NET 10 added
RID-specific tool packages (`dotnet pack -r <RID>`, with an `any` fallback), and the
CLI picks the right package for the user's platform automatically. So a wrapper need
not even download at first run — it could carry the 1.6 MiB installer or the 4.97 MiB
`.exe` as content inside a `win-x64` tool package.

**It is still the wrong shape, for four reasons:**

1. **It cannot deliver phase 1's actual deliverable.** The Windows definition of done
   is: `.mdpkg` associated, `.md` under "Open with", double-click and drag-to-window
   opening files, single-instance forwarding, Start Menu entry, auto-update proven.
   Every one of those is written by the NSIS installer or depends on being an
   installed application. A `dotnet tool` produces a shim on `PATH` in
   `%USERPROFILE%\.dotnet\tools` — it registers nothing with Explorer. A wrapper
   that *ran* the NSIS installer would be a downloader wearing a tool's clothes, and
   the user would then have two uninstall paths (`dotnet tool uninstall`, and
   Add/Remove Programs) that know nothing about each other.
2. **It adds a .NET prerequisite to an app with no .NET in it.** The Tauri app needs
   only the WebView2 runtime. Installing it through `dotnet tool` would require a
   .NET 10 SDK/runtime purely as a delivery mechanism — strictly more prerequisite
   than downloading a 1.6 MiB installer.
3. **It creates a second version number and a second release train.** The NuGet
   packages share one coordinated `<Version>` by design
   (`docs/releases/mdpkg.md`: "Change the single `<Version>`… Tool, Reader, Core and
   local Reviews share that version"). The desktop app's version is driven by
   `tauri.conf.json` and the updater's `latest.json`. Forcing the app into that
   coordinated version would couple a GUI release to a CLI release for no benefit;
   keeping them separate means `mdpkg` 1.0.0 and `mdpkg-viewer` 0.1.0 coexisting on
   nuget.org, which is precisely the "confusing second install path" the brief
   worried about.
4. **It fights the updater.** The app updates itself from `latest.json`. A tool-
   installed copy would drift from the NuGet version immediately, and
   `dotnet tool update` would then have nothing coherent to do.

**The legitimate need underneath it** — "a .NET user who has `mdpkg` should be able
to find the viewer" — is a *documentation* need, and costs one README section and a
link from the tool's `--help` epilogue. That is the right answer, and it does not
require a package.

### 4.6 F. npm / npx — noted and rejected

Some Tauri projects publish per-platform binaries to npm with `optionalDependencies`,
and `npx` is a real distribution route — for **CLIs**. This is a GUI app whose whole
value is file associations and OS integration, which `npx` cannot provide; it would
be the §4.5 objection again with a different runtime prerequisite (Node instead of
.NET). There is also nothing to build on: `src/web-viewer/package.json` is
`"private": true` and no `mdpkg` package exists on npm. Rejected.

### 4.7 G. Microsoft Store — the option that changes a decision, not just a channel

Listed because it is the only route that *solves* SmartScreen rather than documenting
it: Store-distributed apps are signed by Microsoft, so the "Windows protected your PC"
paragraph disappears and reputation is not the publisher's problem. Tauri documents
Microsoft Store as a Windows distribution target.

The costs are real: an MSIX repack (a different bundle target from the NSIS installer
phase 0 measured), a developer account, package identity, Store certification, and an
update mechanism that is the Store's, not Tauri's — so the updater plugin would have
to be disabled for Store builds, which contradicts D4. That makes it a *decision
reversal*, not a secondary channel, and out of scope for phase 1. It is the right
thing to reconsider at the same time as the signing certificate.

## 5. Does the existing .NET tool audience constrain this? (No — with a caveat)

The brief asks what changes if this project already has `dotnet tool` users who would
expect continuity. Evidence gathered 2026-09-20:

| Signal | Value |
| --- | --- |
| nuget.org total downloads, `mdpkg`, all versions | **259** |
| nuget.org downloads, `mdpkg` 1.0.0 (published 2026-09-15, 5 days old) | **83** |
| GitHub stars | **0** |
| GitHub Releases | **0** |
| Git tags | **0** |
| Successful `publish-nuget.yml` runs | 11 of 22 (2 since 1.0.0 was published) |

Those download counts have an obvious alternative explanation: `publish-nuget.yml`'s
`prove-nuget-org (tool)` job installs `mdpkg` from the public feed on every successful
run, retrying up to 20 times 180 seconds apart, and `docs/releases/mdpkg.md` documents
running `prove-tool.py` without `--local-feed` by hand as well. NuGet's counter also
includes mirror and index traffic. So the counts are consistent with CI plus bots and
provide **no evidence of an external user base**.

**Stated honestly: download statistics cannot prove the absence of users.** What they
can do is tell you which risk is cheaper to be wrong about, and here it is one-sided:

- If there are no external users (what the evidence suggests), then optimising for
  continuity with a .NET channel buys nothing, and GitHub Releases is right.
- If a handful of .NET users exist, what they need is to *learn the app exists* — a
  README section and a line in `mdpkg --help`. They are, by construction, people
  comfortable running an installer; nobody is blocked by the app not being on NuGet.
- The scenario where a `dotnet tool` channel would genuinely be the right answer —
  a large installed base with a locked-down, NuGet-only software policy — is
  contradicted by every signal above, and would in any case be *worse* served by a
  wrapper that shells out to an unsigned downloader.

**The one thing that would change the recommendation** is not user count but user
*environment*: if the intended audience turns out to be on machines where arbitrary
`.exe` downloads are blocked by policy but `winget` (or an internal winget source) is
permitted, then winget moves from secondary to co-primary and the signing question
moves forward with it. That is worth a direct question to the caller (§8), not a guess.

## 6. Recommended sequencing

Stated as a recommendation to accept or reject, not as a design:

1. **Phase 1 (now):** GitHub Releases only, exactly as D4 already decided. Add the
   release/tag convention the repo lacks, the desktop-app version line, the Rust build
   caching, and the updater key handling. README gets a "Desktop app (Windows)" section
   covering the download link, the SmartScreen steps, and the `.md`/`.mdpkg` behaviour.
2. **Immediately after W4 (same phase):** fix the orphan `.mdpkg` registry key and
   quote the `fileAssociations` open command (spike §3.3, both already booked into W4).
   Both are correctness fixes on their own merits, *and* they are winget's uninstall
   and install validations, so doing them now keeps that door open at zero extra cost.
3. **After one real end-to-end update has shipped:** revisit winget. Decide then
   whether to submit unsigned (accepting scan risk) or to get a certificate first.
   A certificate retires the SmartScreen paragraph, the winget scan risk and part of
   the phase 2 macOS story in one purchase, so pricing it is the higher-value task.
4. **Never, unless asked:** Chocolatey, npm, `dotnet tool` wrapper. If discoverability
   becomes the binding constraint before a certificate exists, Scoop `extras` is the
   cheapest experiment.

## 7. Risks and unknowns specific to distribution

| # | Risk | Status |
| --- | --- | --- |
| DR1 | Updater private key loss means no further updates for every installed copy, ever | Known (plan §2.5). Needs a documented custody arrangement — CI secret **plus** an offline copy — before the first public release, not after |
| DR2 | Whether an updater-launched install trips SmartScreen | Open; booked as W4/R7 on a clean VM. Explicitly not answered by the phase 0 spike |
| DR3 | Unsigned NSIS/Rust binary flagged as PUA by winget's antivirus panel | Unmeasured. Only discoverable by submitting, which is a reason to submit *after* v1 rather than as part of it |
| DR4 | Self-updater and winget both claiming ownership of updates | Unverified interaction. Needs its own check before winget is advertised |
| DR5 | Orphan `HKCU\Software\Classes\.mdpkg` key after uninstall | Measured (spike §3.3). Harmless to users; a winget validation failure |
| DR6 | 18-minute cold release build makes the release workflow slow and cache-dependent | Measured (spike §1). Affects any channel needing a per-release artifact |
| DR7 | Three independent version lines (NuGet coordinated version, viewer/Pages, desktop app) with no stated relationship | New with phase 1. Worth deciding explicitly at plan stage, since the README will show all three |

## 8. Questions for the caller

1. **Is the audience environment constrained?** If the intended users are on machines
   where downloading an `.exe` is policy-blocked but a package manager is not, winget
   becomes co-primary and signing moves forward (§5).
2. **Is a code-signing certificate on the table, and at what budget?** It is the single
   purchase that improves the most distinct problems (SmartScreen, winget scan risk,
   part of phase 2). Everything in §6 step 3 hinges on the answer.
3. **Version line for the desktop app:** independent (recommended) or coupled to the
   coordinated NuGet `<Version>`? (DR7.)

## 9. Not done, noted

- **Not implemented, by design:** no workflow, manifest, tag, release, account,
  submission or registry change was made. Nothing was published anywhere.
- `README.md:60`'s "After the **1.0.0** public-feed gate succeeds" is stale — 1.0.0
  published 2026-09-15. One-line docs fix, out of scope for this task.
- Scoop's `installer` block semantics for a per-user NSIS installer were reasoned
  about from its documented model, not tested. Any Scoop work needs a real trial.
- The winget "unsigned is acceptable" conclusion rests on signing being **absent**
  from Microsoft's stated submission expectations, plus the observation that MSIX is
  the format with the hard signing requirement. A linked winget-pkgs discussion on
  exactly this question (`microsoft/winget-pkgs` #157365) is unanswered, so no
  authoritative statement was found either way. The only decisive test is a submission.
- The `winget upgrade` / self-updater interaction (DR4) was reasoned from how ARP
  entries are written, not measured.
- Download counts were interpreted, not attributed. No per-source breakdown is
  available from the public NuGet APIs.

## 10. Evidence and reproduction

Commands run on 2026-09-20 from the repository root at `f088f2a`:

```text
cat src/generator-cli/src/Mdpkg.Cli/Mdpkg.Cli.csproj    -> PackAsTool/ToolCommandName/PackageId = mdpkg
cat src/generator-cli/Mdpkg.Pack.props                  -> <Version>1.0.0</Version>
curl https://api.nuget.org/v3-flatcontainer/mdpkg/index.json
  -> ["0.1.0-preview.1","0.1.0-preview.2","0.1.0-preview.3","1.0.0"]
curl https://api.nuget.org/v3-flatcontainer/mdpkg.reader/index.json
  -> ["0.1.0-preview.2","0.1.0-preview.3","1.0.0"]
curl "https://azuresearch-usnc.nuget.org/query?q=packageid:mdpkg&prerelease=true"
  -> totalDownloads=259; 1.0.0 downloads=83
curl https://api.nuget.org/v3/registration5-gz-semver2/mdpkg/index.json
  -> 1.0.0 published 2026-09-15T05:49:21Z
git tag | wc -l            -> 0
gh release list            -> (no output)
gh repo view               -> public, stargazerCount 0
gh run list --workflow publish-nuget.yml --limit 30 -> 22 runs, 11 success / 11 failure
gh api repos/microsoft/winget-pkgs/contents/manifests/g/GitHub/cli/2.99.0
  -> GitHub.cli.installer.yaml uses InstallerUrl https://github.com/cli/cli/releases/download/...
head -20 src/web-viewer/package.json -> "name": "mdpkg-viewer", "private": true
```

External sources read on 2026-09-20:

- Microsoft Learn, *Submit your manifest to the repository* (winget-pkgs submission
  expectations, validation labels, binary/Defender scan, `Validation-Indirect-URL`,
  `Validation-Uninstall-Error`, `Validation-Unattended-Failed`).
- Chocolatey docs, *Community repository moderation* (submission requirements,
  validator/verifier/cleaner, 30-minute lag, 20+15-day clock).
- Tauri v2 docs, *Updater plugin* (static `latest.json` shape, endpoint variables,
  HTTPS enforcement, Windows `installMode` passive/basicUi/quiet, app exits during
  install) and *Windows installer* (NSIS vs WiX/MSI, `currentUser`/`perMachine`/`both`).
- Microsoft Learn, *Create RID-specific, self-contained, and AOT .NET tools*
  (.NET 10 RID-specific tool packages, `any` fallback, automatic platform selection).

Repository evidence reused rather than re-measured:
`docs/plans/2026-09-18-native-viewer-shells.md` §2.5 and §9 (D2, D4),
`docs/plans/2026-09-19-phase0-windows-spike.md` §1, §3.1–§3.4 and §8,
`docs/releases/mdpkg.md` (release mechanics, no tags),
`.github/workflows/publish-nuget.yml` and `.github/workflows/pages.yml`.
