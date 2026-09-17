# CARD-0058: CP437 mojibake when packing .mdpkg

Date: 2026-09-17. Investigate task `d4a351f9`. Source: [issue #3](https://github.com/michal-ciechan/markdown-package/issues/3).
Investigated at commit `479d700700fedc3a90bb0db0fccad0c48877c415`.

## Outcome

**Not reproduced in this repository.** Every producer path of `mdpkg` (snapshot
`pack`, `pack --from-git`, `pack --history git`, `update --tree`) copies the source
Markdown into the ZIP byte for byte, on a Windows machine whose OEM code page is 850
and whose ANSI code page is 1252. The published NuGet tool `mdpkg 1.0.0`
(`1.0.0+ef70683d3e81ba808184da75c3e0b4a8766ecf7c`) behaves the same. No production
source file in `src/generator-cli` decodes content with an implicit or console
encoding, and `git log -S` shows none ever did.

The byte pattern in the issue is produced by decoding UTF-8 bytes with **OEM code
page 850**, not 437, and then re-encoding as UTF-8. In .NET that decode happens only
on console-attached text streams: `Console.In`, and a child process's
`StandardOutput`/`StandardError` when `StandardOutputEncoding` is not set. It never
happens on `File.*` or `FileStream` reads. Both console mechanisms were reproduced
on this machine and yield exactly the issue's bytes (`C3 94 C3 87 C3 B6` for the em
dash, `C3 94 C3 AA C3 86` for the minus sign). When such text is written to a staging
directory and packed, `mdpkg pack` and `mdpkg validate --deep` accept it with zero
diagnostics, because the mojibake is valid strict UTF-8.

Conclusion: the corruption happens in the caller's pipeline before `mdpkg` reads the
source directory, in a host that obtained the Markdown text through a console or
child-process text stream under an OEM code page. The reporter's pipeline is not on
this machine and could not be identified (see Remaining uncertainties).

## Reproduction steps (all preserve bytes)

Fixture written with Python as raw UTF-8 bytes, no BOM (91 bytes):

```text
# Dash test

poll — not the greatest. Next request starts `watermark − 10 s`. 😀 ✅
```

```text
23 20 44 61 73 68 20 74 65 73 74 0a 0a 70 6f 6c 6c 20 e2 80 94 20 6e 6f 74 20 74 68 65
20 67 72 65 61 74 65 73 74 2e 20 4e 65 78 74 20 72 65 71 75 65 73 74 20 73 74 61 72 74
73 20 60 77 61 74 65 72 6d 61 72 6b 20 e2 88 92 20 31 30 20 73 60 2e 20 f0 9f 98 80 20
e2 9c 85 0a
```

Machine state at the time (from `chcp` and PowerShell): active console code page
850, `[Console]::OutputEncoding` 850, `[Console]::InputEncoding` 850, culture en-GB,
`TextInfo.OEMCodePage` 850, `TextInfo.ANSICodePage` 1252. This is the same class of
environment the issue describes (Windows, typographic dashes).

Build: `dotnet build -c Release src/Mdpkg.Cli` in `src/generator-cli` (0 warnings,
0 errors). Each run below was followed by reading the inner `dashes.md` entry with
Python `zipfile` and comparing it to the fixture bytes.

| Producer path | Command | Inner entry identical to source |
|---|---|---|
| Snapshot pack | `mdpkg pack src --out out.mdpkg --namespace c1b2d3e4-…` | yes |
| Git import | `git init/commit` the fixture, then `mdpkg pack gitsrc --out git.mdpkg --namespace … --from-git` | yes |
| Git output from snapshot source | `mdpkg pack src --out hist.mdpkg --namespace … --history git` | yes |
| Append | `mdpkg update out.mdpkg --tree src2 --message edit --out upd.mdpkg` (src2 adds a line with `—`, `−`, `😀`) | yes |
| Published tool | `dotnet tool install mdpkg --version 1.0.0 --tool-path …` then `mdpkg pack src …` | yes |
| Non-ASCII entry name | `café—notes.md` packed; ZIP name is UTF-8 with general-purpose bit 11 set (flag `0x800`) | yes |

Every `pack`/`update` reported `validated.` and exit 0. The snapshot identity of the
fixture was `sha256-df31b99e4b483406bd471018f720e9754ee4b11a4ad4438f6b09cf02a21cda3e`
from the fresh Release build and from the NuGet 1.0.0 tool alike.

## Reproduction of the issue's bytes (outside the tool)

Scripts run under a real CP850 console (Windows PowerShell 5.1 and pwsh 7.6.6
launched from a code page 850 console):

1. `.NET Process` reading child output with no explicit encoding:
   `ProcessStartInfo("cmd.exe", "/c type src\dashes.md")` with
   `RedirectStandardOutput = true`, then `StandardOutput.ReadToEnd()`.
   `StandardOutput.CurrentEncoding` reported **850**. Re-encoding the string as UTF-8
   gave `c3 94 c3 87 c3 b6 20 6e 6f 74 …` for `— not`: the issue's bytes exactly.
   Under a UTF-8 console (`CurrentEncoding` 65001) the same code preserved `e2 80 94`.
2. `Console.In` in a .NET host fed the file on stdin:
   `type src\dashes.md | powershell -File stdin.ps1` with `[Console]::In.ReadToEnd()`.
   `Console.InputEncoding` reported 850 and the re-encoded bytes were
   `C3 94 C3 87 C3 B6`.
3. Redirecting native output in a shell: pwsh 7.6.6 `git show HEAD:dashes.md > file`
   preserved the bytes (PowerShell 7.4+ passes native byte streams through to files).
   Windows PowerShell 5.1 wrote UTF-16LE instead, a different corruption.

Then: the CP850-decoded, UTF-8 re-encoded fixture was written to `mojibake/dashes.md`
and packed. `mdpkg pack mojibake --out mojibake.mdpkg … --format json` and
`mdpkg validate mojibake.mdpkg --deep --format json` both returned exit 0,
`tier: conforming`, every check `pass`, `diagnostics: []`. The packed entry reads
`poll ÔÇö not the greatest. Next request starts `watermark ÔêÆ 10 s`. ­ƒÿÇ Ô£à`,
which is the issue's packed line. The tool therefore reproduces the symptom only when
handed already-corrupted bytes, and it cannot tell them apart from intended text.

## Why this exact pattern: CP850, not CP437

Decoding the source UTF-8 sequences with each candidate code page and re-encoding
as UTF-8 (computed with `System.Text.Encoding` on this machine):

| Source | UTF-8 | cp437 decode → UTF-8 | cp850 decode → UTF-8 | cp1252 decode → UTF-8 |
|---|---|---|---|---|
| `—` U+2014 | `E2 80 94` | `ΓÇö` → `CE 93 C3 87 C3 B6` | `ÔÇö` → `C3 94 C3 87 C3 B6` | `â€”` → `C3 A2 E2 82 AC E2 80 9D` |
| `−` U+2212 | `E2 88 92` | `ΓêÆ` → `CE 93 C3 AA C3 86` | `ÔêÆ` → `C3 94 C3 AA C3 86` | `âˆ’` → `C3 A2 CB 86 E2 80 99` |

Only code page 850 maps byte `E2` to `Ô` (U+00D4); 437 maps it to `Γ` (U+0393).
The issue's bytes begin with `C3 94`, so the decoder was CP850, the OEM code page of
en-GB Windows. That rules out the ANSI code page (1252) and therefore rules out
`File.ReadAllText`/`StreamReader`-style file reads in any .NET runtime, which never
default to an OEM code page. The only .NET APIs that default to the OEM code page are
`Console.InputEncoding`/`Console.OutputEncoding` and child `Process` stdio without an
explicit `StandardOutputEncoding`/`StandardErrorEncoding`. PowerShell's own native
command capture (`$x = git show …`) uses `[Console]::OutputEncoding` and shows the
same signature.

The 4-byte emoji in the fixture becomes `­ƒÿÇ` (with a soft hyphen for `F0`), so an
emoji in the reporter's document would appear as four Latin letters, consistent with
the same mechanism.

## Source audit: every read and write in the packing path

Grep of `src/generator-cli/src` for `ReadAllText|ReadAllLines|StreamReader|StreamWriter|WriteAllText|Encoding\.|Console\.(In|Out|Error)|OpenText|ReadToEnd|GetString\(|GetBytes\(`:

- `src/generator-cli/src/Mdpkg.Core/Internal/Sources/SourceTree.cs:173-179`
  reads each source file with `File.OpenRead` into a `MemoryStream` (bytes only) and
  calls `Normalize`. `Normalize` (`:120-129`) decodes with `Profile.Utf8` (strict,
  throws `DecoderFallbackException` → `MDPK4003`), returns the **original bytes**
  unchanged when no `\r` is present, and otherwise re-encodes with `Profile.Utf8`.
  `FromMemory` (`:184-196`) takes `ReadOnlyMemory<byte>` from
  `PackageInputEntry(string Path, ReadOnlyMemory<byte> Content)`
  (`src/Mdpkg.Core/Contracts.cs:137`); no string overload exists.
- `src/generator-cli/src/Mdpkg.Core/Internal/Git/GitProcess.cs:38` reads child stdout
  from `process.StandardOutput.BaseStream` (raw bytes) into a `MemoryStream`; the
  only text decode is `:39` `StandardError.ReadToEndAsync` for error messages, which
  never reach package content. `Repository.ReadTreeAsync`
  (`src/Mdpkg.Core/Internal/Git/Repository.cs:36-70`) fetches blobs via
  `cat-file blob` bytes and passes them to `SourceTree.Normalize`.
- `src/generator-cli/src/Mdpkg.Core/Internal/Container/ZipContainer.cs:214-241`
  writes `entry.Bytes` through a `BinaryWriter(stream, Profile.Utf8)`; names are
  `Profile.Utf8.GetBytes(entry.Name)` with bit 11 set for non-ASCII (`:232`).
- `src/generator-cli/src/Mdpkg.Cli/Program.cs:11` sets `Console.OutputEncoding` to
  UTF-8 without BOM for the tool's own output; the CLI never reads `Console.In`.
- `src/generator-cli/src/Mdpkg.Cli/Commands/PackCommand.cs:87-104` passes only paths
  and the correspondence file bytes (`File.ReadAllBytesAsync`) to the builder.
- The two `Encoding.Latin1` uses in `src/Mdpkg.Core/Internal/PackageBuilder.cs:213,227`
  operate on Git commit object bytes (metadata rewrite), not on Markdown content.
- `src/Mdpkg.Cli/Commands/ReportDestination.cs:112` uses `new StreamWriter(file)`
  (UTF-8 without BOM by .NET default) for the `--report` JSON, not package content.

History: `git log -S` over `src/generator-cli/src` for `StreamReader`, `ReadAllText`,
`Console.In`, `Encoding.Default`, `OpenText`, `ReadToEnd()` and
`StandardOutput.ReadToEnd` returns no commits. No revision ever had a text-based
content read.

## Reader and unpack paths

- `src/generator-cli/src/Mdpkg.Reader/Internal/Addressing/Inventory.cs:29` decodes
  entry bytes with `Profile.Utf8` (strict) for inventories; `PackageArchive.ReadEntry`
  returns bytes. No console or default-encoding decode exists in `Mdpkg.Reader` or
  `Mdpkg.Reviews` (no `Encoding`/`GetString` matches in `Mdpkg.Reviews`).
- Web viewer: `src/web-viewer/src/format.js:11` decodes with
  `TextDecoder('utf-8', {fatal: true, ignoreBOM: true})`; `container/reader.js:115`
  uses it for entry names, and `container/writer.js:6` encodes names with
  `TextEncoder`. `reader.js:81` uses `latin1` only for the ZIP archive comment.
  Nothing in the viewer can introduce an OEM decode.

So the unpack/reader paths show the packed bytes faithfully. A viewer displaying
`ÔÇö` is displaying what the package contains.

## Existing test coverage

`tests/Mdpkg.Core.Tests/ProducerTests.cs:103-121`
(`SnapshotIsDeterministicAndDeepValidatesWithNormalizedSourceUnchanged`) already
round-trips `café.md` with `# Héllo` (2-byte UTF-8) through the library and asserts
the packed bytes. Any OEM decode in the library path would fail it (`C3 A9` decodes
under CP850 to `├®`). There is no test that runs the `mdpkg.exe` process itself under
an OEM console with 3-byte and 4-byte sequences, but this investigation found no
code path where that could matter.

## Remaining uncertainties

- The reporter's actual packing pipeline is unknown. No repository under `C:\src`
  references `mdpkg` as a consumer (Antiphon, ClaudeBot, the orchestrator workspace
  and the Claude skills directory were searched), and the issue's source line
  (`not the greatest`) exists in no file on this machine. The corrupted `.mdpkg` and
  its source were not attached to the issue.
- Which console mechanism the reporter's host used (child-process capture versus
  stdin versus PowerShell variable capture) cannot be distinguished from the bytes;
  all three produce the same CP850 signature.
- `mdpkg --version` on the reporter's machine is unknown; 1.0.0 and the current
  source were verified here, and `0.1.0-preview.*` used the same byte-based
  `SourceTree` (no history hit for a text read).

What would resolve it: the exact command or host code that produced the corrupted
`.mdpkg`, together with `mdpkg --version`, the packed file and its source. In
particular, whether the directory handed to `mdpkg pack` was populated by a process
that captured `git show`/`type`/stdin text under an OEM console.

## Not done, noted

- Fix idea (one line): nothing in this repo to change for the reported mechanism;
  the caller's host must set `StandardOutputEncoding`/`Console.InputEncoding` to
  UTF-8 or pass bytes, and mdpkg could at most add an optional heuristic warning for
  CP850/CP437 signatures (`Ô` + `Ç`/`ê` pairs, `­ƒ` prefixes) in source text.
- Regression test idea (one line): a `Mdpkg.Cli.Tests` process-level test that runs
  `mdpkg.exe pack` under `chcp 850` on a fixture with `—`, `−` and an emoji and
  asserts the inner entry is byte-identical to the source.
