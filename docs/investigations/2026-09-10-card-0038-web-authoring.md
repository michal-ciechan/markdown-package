# CARD-0038: web review authoring and export

Implemented beside the current viewer after confirming CARD-0037 was Done and
reading CARD-0038's full description and the CARD-0034 extraction plan.

## Result and decisions

The viewer now captures rendered/source text or whole sections, previews the
exact canonical source quote, authors v2 comments/change requests and replies,
sets thread state, emits a separate delta review snapshot, validates it and offers
download/file sharing. The original is only read. No backend source was changed.

Delta-only is the card's permitted initial return shape. Each tab uses a fresh
review namespace; each export has one parentless commit tracking only comments.
Per-comment kind and thread/comment IDs survive repeated exports. Replies keep
their own kind, sibling link and array order. Preparing and sharing are separate
gestures to preserve browser share activation. Mutation invalidates any prepared
file, including an in-flight result. Drafts are in memory with departure warnings.

Rendered selection uses CommonMark block positions and a unique text-node match,
then validates the candidate by perturbing source and re-rendering. Ambiguous or
transformed endpoints require explicit source-view selection. This also rejects
a normalized code literal whose only exact raw match is elsewhere in the block.
Ranges crossing child sections use their deepest common containing scope.
Offsets/context are UTF-16, canonical LF source, surrogate-safe. Existing live
ledger roots are reused, including birth overrides; reserved roots without a
birth override reject capture. Empty scopes cannot mint nonempty selectors.

Self-validation checks container typing, every payload CRC, allowed delta entries,
reviewed identity, canonical JSON, v2 schema and reply graph, original anchors and
selector evidence, one-snapshot history declarations and HEAD/main agreement.
It is structural validation, not browser-side proof of Git object/lineage claims.
The Git writer uses pinned isomorphic-git in an ephemeral private filesystem;
the ZIP writer is promoted from the browser probe. Raw DEFLATE falls back to
STORE if unsupported. Author labels are not inserted into Git headers.

## Acceptance evidence

The committed [browser-v2.mdpkg](../../src/web-viewer/tests/fixtures/browser-v2.mdpkg)
was downloaded by the built production UI in Chromium on Windows. Its provenance,
hashes and commands are in [the fixture README](../../src/web-viewer/tests/fixtures/README.md).

- Mdpkg.Reviews PackageReference consumer: 2/2 items extracted and resolved,
  `Conforming/Valid/Structural`, exact correlation, both `TargetIntact`;
  change request, reply link/order and resolved thread state preserved.
- Independent Python ZIP/native Git: 25 checks, zero failures, including strict
  fsck, one parentless commit, review-only tree and identical Git/current bytes.
- Existing CLI `validate --deep`: 23 checks, zero diagnostics, exit 0.
- Original fixture SHA-256 remains
  `66089e1aceae16eeb758ed827d0fb3f290aca9f90b26139d3f2270e5f8932984`.
- Automated tests cover selectors and malformed v2 data, live ledger roots,
  writer/CRC corruption and STORE fallback; actual DOM mapping, author/reply/state,
  download, share cancellation, untrusted text, unsaved navigation and stale exports.
  Final local run: 17 Node tests and 4 Chromium tests passed, zero failures.
- A 390 × 844 mobile viewport screenshot was inspected; no horizontal overflow.
  This is desktop browser emulation, not a real mobile-device claim.

The default build now uses the explicit `Review` branch of plan §4:
48,014 CommonMark + 52,363 Git-write baseline + 32,768 owned app allowance =
133,145 gzip bytes. The whole production graph, including the on-demand writer,
is charged to that ceiling; the measured build is 119,956 gzip bytes. M1–M6
ceilings and V-1 calibration remain unchanged;
M3+ still requires history components. Pages CI runs Node and browser tests plus
independent ZIP/Git validation before publication.

## Rerun and remaining scope

From `src/web-viewer`: `npm ci`, `npm test`, `npx playwright install chromium`,
`npm run test:browser`, then
`python tests/validate-export.py test-results/browser-review.mdpkg`.
The fixture README supplies .NET consumer and CLI deep-validation commands.

Bundled writing, v1 compatibility export, importing/editing returned reviews,
relocation against newer packages, retained-history browsing and durable drafts
are deferred. Real iOS/Android sharing, Firefox/WebKit engine sweeps and large
document selection performance remain unmeasured. The UI's source fallback is
intentional; no unsupported rendered mapping is silently accepted. No human
transport round trip, backend patch application or authenticated authorship is claimed.
