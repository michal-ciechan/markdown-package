# Draft-2 review and deferred-history fixtures

These active fixtures use the revised `markdown-package/1` schema: typed current
states and explicit history modes. They are CARD-0052 S1 documentation data;
product implementation and its test migration follow in S2–S6. Comment-document
versions 1/2 and selector/root/digest profiles are unchanged.

Python ZIP/native Git plumbing generates these files without a product writer.
`vectors.json` records lengths, hashes and expected archive acceptance. The shared
[state vectors](../../investigations/deferred-history/breaking-revision-vectors.json)
contain four exact state/bootstrap designs, one changed child, 46 invalid-input
recipes, 36 concrete operation requests with expected outcomes and 15 identity
mutations. Operation requests are follow-on test inputs, not claims of implemented commands.

### Recipe input contract

Fixture names resolve in this directory. Each operation's `input` supplies its
base/target archive, exact UTF-8 `sources`, reference, request arguments or proof
and verification-provider inputs. Omitted source edits preserve existing bytes;
`null` evidence means unavailable. `jsonEdits`, `manifestEdits` and
`sourceJsonEdits` apply in order to decoded JSON using `path` arrays (`remove`
deletes a key); write canonical JSON with a final LF. Source edits apply to the
proposed tree, while archive edits apply to the input package. These request
fields are fixture-adapter instructions, not new public API or CLI definitions.
`sourceGitFixture` supplies an extracted Git repository for the `source` operand;
`sources` supplies the `tree` operand. Publication state, prepared exports,
capabilities and cancellation points are explicit operation-harness inputs.

`rebuildCommit` supplies exact replacement commit bytes. With
`repairObjectBindings`, rebuild the pack/index and repair HEAD, refs,
`current.id` and descriptor endpoints/counts to the new object ID. The
missing-origin request removes the reserved bootstrap marker too, producing an
ordinary valid original root without a binding; it does not ask a resolver to
accept a malformed materialized package. Partial-coverage requests change both
manifest coverage and the descriptor range without changing the tracked tree.
Transform requests specify retained commits and the resulting origin/root policy.
Verification `checkResults` are simulated provider results for §7.1 obligations;
the consumer derives required checks from the actual archive. The skipped-check
case deliberately supplies a dishonest requirements mask and Full claim.

Review-manifest negatives replace only the manifest of
`delta-review-snapshot.mdpkg`, retaining its valid review document. Each starts
from that same unmodified base. Semantic edits include a repaired state hash
where the review header remains hashable; malformed reviewed-state shapes are
rejected before hashing. The namespace and extra-reviewed-key cases therefore
do not also fail because of an absent review document or stale snapshot hash.

| Fixtures | Meaning |
| --- | --- |
| `original.mdpkg`, `original-git.mdpkg` | Initial review-context S0 and deterministic C0 with origin |
| `changed.mdpkg`, `moved.mdpkg` | C0 children with changed content or confirmed move ledger; origin retained |
| `delta-v1.mdpkg`, `delta-v2.mdpkg` | History-free returns targeting S0, with distinct export namespaces |
| `delta-git-target-snapshot.mdpkg`, `delta-git-target-commit.mdpkg`, `delta-snapshot-target-commit.mdpkg` | Complete both delta state kinds × both reviewed kinds matrix |
| `bundled-v2.mdpkg`, `bundled-target-commit.mdpkg` | Git returns targeting S0/C0, parent C0 and review-only changes |
| `guide-snapshot.mdpkg`, `guide-materialized.mdpkg`, `guide-changed-child.mdpkg` | Minimal guide S0, C0 and changed C1 (§8.6) |
| `unicode-*.mdpkg` | Unicode byte ordering, nested paths, BOM and trailing whitespace |
| `ledger-*.mdpkg` | Initial authoritative ledger, retirement and reserved birth, then materialization |
| `delta-review-*.mdpkg` | Empty v2 delta from the supplied design vectors and its materialization |

Each family is an isolated example; reused illustrative namespaces across families
do not claim multiple initial publications in one lineage.

The four `invalid-bundled-*` archives fail parent, document/ledger changed-path or
origin obligations despite valid Git objects. `invalid-delta-history.mdpkg` now
specifically adds a forbidden history field to snapshot mode. Git-mode delta history
is no longer invalid merely because it contains multiple commits.
`comments-empty.json` is valid; `invalid-kind.json`, `invalid-cycle.json` and
`invalid-selector.json` remain invalid comment documents. Source-dependent selector
assurance remains separate from artifact integrity.

Python explicitly counts UTF-16 units for the emoji/combining-accent source;
JavaScript checks offsets, locator, root and scoped digest independently. A separate
JavaScript oracle constructs raw Git trees/commits and checks state mutation hashes.

Run from the repository root, in order:

```text
python docs/spec/worked-example.py
python docs/spec/deferred-history.py
python docs/spec/review-fixtures/generate.py
node docs/spec/verify-deferred-history.mjs
node docs/spec/review-fixtures/verify-unicode.mjs
python docs/spec/verify-operation-fixtures.py
python docs/spec/verify-fixtures.py
python docs/spec/render-worked-example.py
python docs/spec/verify-regeneration.py
```

Archive checks cover **20 accepted fixtures and 5 expected rejections**, including
native fsck/read-tree, complete current-file equality and origin reconstruction
from C0 rather than C1. JavaScript supplies **94 independent hash/encoding assertions**.
These are fixture checks, not a complete application conformance suite. Historical
investigation archives and measurements retain their original interpretation;
fixture sizes make no new performance claim.
