# mdpkg generator CLI

The .NET global tool that [`docs/spec/generator-cli.md`](../../docs/spec/generator-cli.md)
describes: `mdpkg pack | update | address | validate`, emitting and checking `.mdpkg`
packages that conform to [`docs/spec.md`](../../docs/spec.md).

**Status: scaffold.** The verb tree, every option, the exit codes and the output contract
are wired and tested. No verb generates or checks a package yet: a well-formed invocation
prints `mdpkg <verb>: not implemented` on stderr and exits 70. Usage errors already exit 1
as the spec requires.

## Build, test, run

From `src/generator-cli/` (SDK pinned by `global.json` to the 10.0 feature band):

```powershell
dotnet build
dotnet test
dotnet run --project src/Mdpkg.Cli -- --help
dotnet run --project src/Mdpkg.Cli -- pack ./docs --out docs.mdpkg --namespace c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8
```

Build output goes under `artifacts/` (one tree for every project) and is ignored. The
built executable is `artifacts/bin/Mdpkg.Cli/debug/mdpkg.exe`.

To try it as the global tool the spec installs with `dotnet tool install -g mdpkg`:

```powershell
dotnet pack src/Mdpkg.Cli -c Release -o artifacts/package
dotnet tool install --tool-path artifacts/tools mdpkg --add-source artifacts/package --version 0.1.0-scaffold
artifacts/tools/mdpkg --help
```

The package is not published anywhere yet.

## Framework: System.CommandLine 2.0

[System.CommandLine](https://www.nuget.org/packages/System.CommandLine) 2.0.12, pinned in
`Directory.Packages.props`. It was chosen over Spectre.Console.Cli, CliFx and
McMaster.Extensions.CommandLineUtils because:

- **It is the library the `dotnet` CLI itself is built on**, maintained by the .NET team,
  and the 2.0 line is stable (GA, no more beta API churn). A tool installed with
  `dotnet tool install` should not drag a second CLI philosophy along.
- **The verb tree is data, not attributes.** `pack`, `update`, `address` with its five
  operations, and `validate` are `Command` objects with typed `Option<T>` and `Argument<T>`
  children, so the tree can be inspected by tests. `SpecConsistencyTests` walks it and
  compares it with the spec's own tables.
- **Recursive options** give the §2 global options for free: each is declared once on the
  root and accepted before or after any verb, which is how the spec writes them.
- **Validators and exit codes fit §3.** Parse and validation errors exit 1, and per-option
  or per-command validators express the spec's option rules (`--namespace` only required
  for `pack`, `--out` required for every `address` operation except `list`,
  `--strict-paths` accepted but never disableable) without hand-written argument parsing.
- **Help is generated from the tree**, so `mdpkg --help` and `mdpkg address --help` show
  the real verb tree, with every description citing the spec section it implements.
- **No rendering dependency.** Spectre.Console.Cli pulls in a terminal-rendering library;
  this tool's stdout is a machine channel (`--format json` prints one result object and
  nothing else), so plain writers are what is wanted.

Two defaults were changed: on a usage error the library would print help and typo
suggestions to stdout, and this tool suppresses both so stdout stays clean; and the
console is switched to UTF-8 because the Windows OEM code page mangles the `§` citations
in help and the UTF-8 entry names the result object will carry.

## Layout

```text
src/generator-cli/
  Mdpkg.slnx                      solution (both projects)
  global.json                     SDK 10.0.x, Microsoft.Testing.Platform test runner
  Directory.Build.props           net10.0, nullable, warnings as errors, artifacts output
  Directory.Packages.props        central package versions
  src/Mdpkg.Cli/                  the tool: PackAsTool, command name mdpkg, assembly mdpkg
    Program.cs                    entry point; UTF-8 console
    MdpkgCli.cs                   builds the root command; Invoke(args, stdout, stderr)
    GlobalOptions.cs              the §2 options plus --report
    ExitCode.cs                   §3 codes 0-5 plus the scaffold-only 70
    Commands/                     one file per verb; Stub.cs is the shared placeholder action
    Reporting/                    §6 result object, §4 diagnostic catalog, JSON writer
  tests/Mdpkg.Cli.Tests/          xunit.v3, runs the tree in-process with captured streams
```

## What is wired

| Surface | State |
| --- | --- |
| Verbs `pack`, `update`, `address {move, retire, unknown, mint, list}`, `validate` | parse; `--help` per verb |
| §2 global options, `--report` | parsed with the spec's defaults; `--format` and `--object-format` accept only their spec values; `--compression-level` is range-checked; `--namespace` must be a lowercase UUID; `--strict-paths false` is refused |
| Per-verb options of §7, §9, §10, §11 | parsed; `pack` requires `--namespace`; `update` enforces the `--tree` / `--message` / `--squash` / `--no-summary` rules; `address` operations require `--out` (except `list`), roots must be 64 lowercase hex digits, `retire --reason` accepts `split`, `merge` or `deleted` |
| Exit 1 (usage) | any parse or validation error; stderr only, plus a `--help` hint |
| Exit 5 (environment) | `--report` path unwritable |
| Exit 70 (scaffold) | every well-formed invocation; not a spec code, removed with the last stub |
| `--format json` | one §6 result object on stdout with `verb`, `exitCode` and null / empty fields |
| `--report <file>` | the same object, written even on a non-zero exit |
| Exit 0, 2, 3, 4 | defined in `ExitCode`, not yet produced by anything |
| `MDPK*` diagnostics | catalogued with default severity and spec citation in `DiagnosticCatalog`; none is emitted yet |

Deliberately not decided here: `--object-format sha256` parses today and the MDPK4001
rejection, with whichever exit code that diagnostic maps to, belongs to the slice that
implements the writing verbs.

## Tests

`dotnet test` runs 80 tests in about two seconds. Besides the help tree, every validator
and the stub's output contract, `SpecConsistencyTests` reads
`docs/spec/generator-cli.md` from the repository and checks that the verb tree matches §1,
the `address` operations match §10, the exit codes match §3, and the diagnostic catalog
matches the codes and default severities of §4. A verb, code or diagnostic added to the
spec fails the build here until the scaffold mirrors it; the CI workflow therefore also
runs on changes to that file.

To run one test method while iterating, call the test executable directly with xunit's
`-method` filter; it prints a `[FAIL]` line per failing case and a `Total:` summary:

```powershell
artifacts/bin/Mdpkg.Cli.Tests/debug/Mdpkg.Cli.Tests.exe -method Mdpkg.Cli.Tests.HelpTests.RootHelpListsTheFourVerbsInSpecOrder
```

## CI

[`.github/workflows/generator-cli.yml`](../../.github/workflows/generator-cli.yml) restores,
builds, tests and packs on every push or pull request touching `src/generator-cli/**` or
the spec file, and uploads the `.nupkg` as a workflow artifact. Nothing is published.
