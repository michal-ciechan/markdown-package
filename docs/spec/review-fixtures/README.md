# Draft-2 review and deferred-history fixtures

These active fixtures use the revised `markdown-package/1` schema: typed current
states and explicit history modes. They are CARD-0052 S1 documentation data;
product implementation and its test migration follow in S2–S6. Comment-document
versions 1/2 and selector/root/digest profiles are unchanged.

Python ZIP/native Git plumbing generates these files without a product writer.
`vectors.json` records lengths, hashes and expected archive acceptance. The shared
[state vectors](../../investigations/deferred-history/breaking-revision-vectors.json)
contain four exact state/bootstrap designs, one changed child, 46 invalid-input
recipes, 36 operation expectations and 15 identity mutations. Operation expectations
are follow-on test inputs, not claims of implemented commands.

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
python docs/spec/verify-fixtures.py
python docs/spec/render-worked-example.py
```

Archive checks cover **20 accepted fixtures and 5 expected rejections**, including
native fsck/read-tree, complete current-file equality and origin reconstruction
from C0 rather than C1. JavaScript supplies **94 independent hash/encoding assertions**.
These are fixture checks, not a complete application conformance suite. Historical
investigation archives and measurements retain their original interpretation;
fixture sizes make no new performance claim.
