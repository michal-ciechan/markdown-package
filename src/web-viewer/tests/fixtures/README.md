# Actual browser return

`browser-v2.mdpkg` was downloaded by the production viewer in Playwright Chromium
on 2026-09-10, opening `docs/spec/review-fixtures/original.mdpkg`. It is a real
authoring/download artifact, not a manually assembled backend fixture.

- 4,645 bytes; SHA-256 `535affaee163200cda69d14977529f668d18428173b35095b7d471048b5ce94a`.
- Original SHA-256 `66089e1aceae16eeb758ed827d0fb3f290aca9f90b26139d3f2270e5f8932984`.
- One resolved thread, source quote `target words`, UTF-16 range `[28,40)`,
  path `guide.md`, section trail `[["# Guide",0]]`.
- Ordered change request `Explain these words.` and ordinary reply
  `This reply keeps source order.`; both authored by `Browser Reviewer`.
- Its own fresh namespace and parentless commit; eight ZIP entries with only
  `.mdpkg/review/comments.json` tracked by Git.

The existing PackageReference consumer returned `Success: Conforming/Valid/Structural`,
`Correlation: Exact`, and `TargetIntact` for both items with kinds/states preserved.
Independent Python/native Git validation passed 25 checks. The CLI's deep validator
passed 23 checks with zero diagnostics. Original bytes were preserved.

Rerun from the repository root (restore/build the local feed first if needed,
following `src/generator-cli/src/Mdpkg.Reviews/README.md`):

```powershell
python src/web-viewer/tests/validate-export.py src/web-viewer/tests/fixtures/browser-v2.mdpkg
dotnet run --no-restore --project examples/review-consumer -- src/web-viewer/tests/fixtures/browser-v2.mdpkg docs/spec/review-fixtures/original.mdpkg
dotnet run --no-restore --project src/generator-cli/src/Mdpkg.Cli -- validate src/web-viewer/tests/fixtures/browser-v2.mdpkg --deep --format json
```

`npm run test:browser` in `src/web-viewer/` produces a new
`test-results/browser-review.mdpkg`. IDs and timestamps intentionally vary; compare
the contract and resolved content, not whole-file equality. This proves the
automated browser-to-backend file workflow; real-device share destinations and a
human transport round trip have not been tested.
