# Version 1.0.0: first stable release of the breaking draft-2 format

The first stable coordinated release is `1.0.0`. This revision updates the
existing `markdown-package/1` draft directly; the token, extension and 79-byte
typing prefix are unchanged. The earlier string-valued manifest is rejected.
There is one schema with two capability modes, with no compatibility parser,
downgrade writer or second positive-fixture matrix. Comments-document versions 1
and 2 remain separate, supported feedback grammars within this package schema.

## Behavior and public contracts

- `pack` defaults to `--history none`: an initial snapshot with `current.kind`
  `snapshot`, an exact SHA-256 state digest, and no Git/history entries or calls.
  Full validation hashes all current files, including hidden/non-Markdown text,
  the declared ledger and review comments. `validate --deep` needs no Git for it.
- `--history git` and `--from-git` emit typed `commit` state and a curated Git
  repository. Native Git remains the released Git backend; the separate
  CARD-0050 managed-writer activation gate is unchanged.
- `update --materialize` verifies the exact original S0 and emits deterministic
  C0 plus an origin proof. `update --tree ... --message ...` materializes when
  needed and appends a committed successor. Namespace, ledger roots and S0's
  identity remain meaningful; S0 and C0 have different typed current identities.
- Core/Reader identity is `PackageIdentity(Namespace, CurrentState(Kind, Id))`.
  Core source selection and output history mode are separate. CLI JSON exposes
  typed `current`, `mode`, `assurance`, `materialized` and optional
  `bootstrapCommit`; nonapplicable Git checks are explicit. The
  [generated examples](../spec/cli-output-examples.json) come from actual CLI runs.
- Selective Reader/browser opens report declared identity. Explicit snapshot
  verification reads every current file under resource budgets. Reviews Full
  assurance applies to the returned artifact; verified selector/location claims
  additionally need a verified reviewed source or a matching origin proof.
  Selecting a newer target is explicit and failures preserve authored feedback.
- Browser delta export is a two-file snapshot with a fresh namespace per prepared
  revision. Retries reuse the prepared bytes; changed revisions retain comment
  IDs and the typed reviewed target. Private drafts stay in the new
  `mdpkg-viewer:snapshot-draft2:` domain; older storage is neither migrated nor erased.

The browser supports current reading, links, previews and review export for both
original modes. Git/origin verification and historical review resolution are
explicitly unavailable there. General squash/truncate construction, address
editing and a general bundled-review writer remain outside the implemented API.
Readers and validators still check bundled artifacts supplied by capable producers.

## Acceptance and distribution

The [S6 report](../investigations/2026-09-12-card-0052-integrated-acceptance.md)
records the fresh CLI → actual browser → returned review → CLI/Core/Reviews →
materialization/update pipeline, both mode matrices, resource checks, regenerated
fixtures, installed tool/library proofs and measured sizes/costs. Exploratory
shared-host timing samples are not an isolated performance gate. No memory benefit
is claimed without process-tree measurement.

Use freshly built source/local 1.0.0 packages for acceptance until the public-feed
gate succeeds. Publication and proof belong to the coordinated
[release workflow](mdpkg.md). The published `0.1.0-preview.3` packages predate
CARD-0052 and use the incompatible string-valued manifest. Reusing that published
version cannot release the new format: `--skip-duplicate` leaves its bytes unchanged.
Version 1.0.0 is the first stable release of the revised format, with no backward
compatibility for those previews. Do not replace bytes
under an already published version. Reader, Core and the CLI must be released
together; Reviews shares the source version and remains a separately authorized
local package under the existing publishing policy.
