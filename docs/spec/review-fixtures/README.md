# Review interoperability fixtures

These are complete, canonical v1/v2 comment documents and separate-return packages,
produced by `generate.py` using Python standard-library ZIP and native Git plumbing,
independently of the .NET implementation. The code and frozen bytes are versioned
together; `vectors.json` records producer description, Git version, hashes, lengths,
source, locator, root, digest and expected selector. The .NET tests assert parsed
comment bodies, original timestamp text, source order, replies, kinds and declared paths.

`original.mdpkg`, `changed.mdpkg` and `moved.mdpkg` provide actual Git history and
confirmed move evidence. `delta-v1.mdpkg`, `delta-v2.mdpkg` and `bundled-v2.mdpkg` are
valid separate returns. Bundled continues the original commit and changes only review
paths. Delta has one review-only commit in a distinct namespace.

`comments-empty.json` is a successful empty review. `invalid-kind.json`,
`invalid-cycle.json` and `invalid-selector.json` are deliberately invalid, canonical
documents; the cycle is a prose/graph constraint beyond JSON Schema's vocabulary.
Tests derive further malformed fixtures without changing these originals.

`invalid-bundled-parent.mdpkg`, `invalid-bundled-document.mdpkg`,
`invalid-bundled-ledger.mdpkg` and `invalid-delta-history.mdpkg` have valid Git objects
but violate review lineage/changed-path obligations. Structural extraction must label
its limited assurance; native deep CLI validation independently rejects these fixtures.

The source includes a supplementary emoji before the quote and a combining accent.
Python explicitly counts UTF-16 units; `verify-unicode.mjs` independently checks those
offsets with JavaScript string indexing, locator encoding and SHA-256. .NET Reader and
Reviews tests consume the same vectors. Historical probe examples used abbreviated IDs
and scalar offsets; these fixtures replace those illustrative examples as the current
interoperability contract. No shipped web authoring implementation is being migrated.

From the repository root:

```text
python docs/spec/review-fixtures/generate.py
node docs/spec/review-fixtures/verify-unicode.mjs
cd src/generator-cli
dotnet test --project tests/Mdpkg.Reviews.Tests -c Release
```

Fixture measurements: packages are 3,229–5,663 bytes (valid fixtures: 3,229–5,192),
with two comments per review. The default
8 MiB comments budget and 128 MiB package/decoded budgets leave room for backend batches;
they are configurable service caps, not observed format limits. Tests exercise smaller
caps, long bodies, JSON depth, compressed expansion and aggregate rejection. Large-production
capacity claims require deployment-specific measurements.
