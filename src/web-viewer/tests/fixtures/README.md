# Actual browser snapshot returns

These files were downloaded from the production S5 viewer in Playwright Chromium
on 2026-09-12. Both are two-file, history-free delta snapshots using the revised
`markdown-package/1` schema and version-2 comments. They replace the superseded
string-current browser fixture; no compatibility parser is retained.

| Artifact | Reviewed original | Bytes | Archive SHA-256 |
| --- | --- | ---: | --- |
| `browser-v2.mdpkg` | `docs/spec/review-fixtures/original.mdpkg` (snapshot) | 1,421 | `6b4d48eaccf01dcdc7175f2016884b045109329b98c24473f5984c6b20a7177f` |
| `browser-commit-target.mdpkg` | `docs/spec/review-fixtures/original-git.mdpkg` (commit) | 1,294 | `a66b94c55074fef51efe321110d6c9e1945722101590a0bc92ed4746fe78e32a` |

The first has one resolved thread quoting `target words`, UTF-16 range `[28,40)`,
path `guide.md`, section trail `[["# Guide",0]]`. It preserves an authored change
request `Explain these words.` and ordered comment reply `This reply keeps source
order.`, both by `Browser Reviewer`. The second has one open document thread with
comment `Preserve my IDs` by `Reviewer`.

Each has a fresh artifact namespace independent of its private editing workspace
and a typed reviewed target. Retry/reload tests compare the prepared ZIP bytes
exactly; changed revisions rotate the artifact namespace while preserving IDs.

`BrowserFixtureTests` uses both artifacts to assert Core deep conformance, Reviews
Full assurance and Exact/TargetIntact resolution. Snapshot original verification
uses Reader; committed original verification uses Core's explicit Git backend.
Independent Python ZIP/snapshot-hash validation passed 14 checks per artifact.

From `src/web-viewer`, rerun:

```powershell
npm run test:browser
python tests/validate-export.py tests/fixtures/browser-v2.mdpkg
python tests/validate-export.py tests/fixtures/browser-commit-target.mdpkg
```

The browser tests produce fresh actual downloads under `test-results/`. IDs and
timestamps vary between runs; only retries of the same prepared artifact must be
byte-identical. From `src/generator-cli`, rerun the committed-fixture acceptance:

```powershell
dotnet test -c Release --project tests/Mdpkg.Reviews.Tests/Mdpkg.Reviews.Tests.csproj --filter-class Mdpkg.Reviews.Tests.BrowserFixtureTests
```

These are automated browser-to-backend files. Native share destinations and a
human transport round trip have not been tested.
