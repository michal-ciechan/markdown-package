# CARD-0050: .gitmodules NUL parsing fix

Date: 2026-09-12. Addresses review task `daf0a8c4`.

The managed snapshot verifier now detects disallowed submodule settings after
an embedded NUL in a config value. The original fixture (`foo = NUL` followed
by `update = !evil` in `[submodule "lib"]`) is rejected with `MDPK4002`, and an
existing destination remains intact. Native Git remains the production default.

## Change

`SnapshotGitRules.cs` no longer raises a config syntax exception for a literal
NUL inside a value. It consumes the complete value, including quotes, escapes,
comments and continuations, then passes only the prefix before the first NUL
to its semantic checks. Parsing continues with subsequent settings and sections.

This follows Git's [config parser](https://github.com/git/git/blob/v2.50.1/config.c):
`parse_value` accumulates NUL bytes, while the callback consumes a C string.
Actual syntax errors still follow the existing informational `gitmodulesParse`
behavior; the change does not attempt to recover past invalid escapes or
unterminated quotes.

## Regression coverage

`ManagedSnapshotTests.GitmodulesValuesAfterNulMatchNative` adds 13 differential
cases against Git 2.50.1.windows.1:

- Disallowed update, path and URL settings after NULs, including quoted values,
  multiple NULs, comments, continuations and a subsequent section.
- A forbidden update prefix before a NUL, and safe prefixes whose ignored
  suffix contains a command or URL newline.
- Safe later settings and genuine syntax errors after a NUL.

Native rejections assert the specific `gitmodulesUpdate`, `gitmodulesPath` or
`gitmodulesUrl` diagnostic. Managed rejections assert `Nonconforming` /
`MDPK4002`, destination preservation and temporary-file cleanup. Every managed
creation runs with an unavailable Git executable and a fail-on-invocation seam.
Accepted cases compare native/managed commit identities and pass native deep
validation of the managed package.

Before the fix, the new tests had 8 failures and 5 passes: all eight failures
were managed false acceptances after native rejection. After the fix, all 13
pass, with 0 failures and 0 skips.

Run from `C:\src\markdown-package\src\generator-cli`:

```powershell
dotnet test --project tests/Mdpkg.Core.Tests/Mdpkg.Core.Tests.csproj -c Release --filter-method '*GitmodulesValuesAfterNulMatchNative*' --no-progress --output Normal
dotnet test -c Release --no-progress --output Normal
```

Full-suite result on Windows: **1,220 passed, 0 failed, 0 skipped** across Core,
CLI, Reader and Reviews (Release; 2m 06s). This is the previous 1,207 tests plus
the 13 new differential cases. `git diff --check` also passes.

The writer, pack/index/delta implementation, backend defaults and performance
gates are unchanged. Isolated Windows/Linux timing, process-tree memory and
broader performance input coverage remain separate follow-on work.
