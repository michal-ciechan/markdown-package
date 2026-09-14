# Stable 1.0.0 release preparation — c40cf169

Follow-up Code task: `c40cf169`; original Code task / landing owner: `9474e409`.
Continue branch `feat/task-9474e409-mdpkg-tool` in `C:/src/markdown-package` from
`5aa6d85ec38588f0f317495d1feb5ecee18d6466`. Restart: none.

The owner selected **1.0.0**, the first stable CLI/Reader/Core release of the
breaking CARD-0052 draft-2 format. The already-published preview.3 bytes predate
that format. Change the one shared version in `Mdpkg.Pack.props`, synchronize
active install/release documentation and the standalone example's references,
and preserve Reviews as a local-only package. Do not rewrite historical evidence.
Check the unchanged OIDC workflow's version parsing, duplicate handling and exact
publish list. Stable-version support must not alter format/runtime behavior.

The Code stage prohibits landing/deployment and requires ordinary read-only
Review first. Prepare and push the branch; the caller must land original Code
task `9474e409` after Review, then observe the push-triggered publication and
both public-feed proof jobs for that landed SHA. No direct NuGet push or workflow
dispatch is performed in this task.

## Ordinary verification and coverage-to-class list

Build the complete eight-project solution once in Release with
`--property:OutputPath=bin-c40cf169/` and isolated artifacts under
`.antiphon/task-c40cf169/build`. Pack the four products using `--no-build` into
`.antiphon/task-c40cf169/feed`; Reviews is inspected locally, never published.
External package-only consumers necessarily compile their own temporary projects.
Remove the eight owned `bin-c40cf169` outputs at completion with the build system's
clean target and nonrecursive removal of any remaining files/empty directories.

| ID | Obligation | Expected cost |
| --- | --- | --- |
| V-1 | Rebuild all eight solution projects; 0 warnings/errors. | 1–3 minutes |
| V-2 | Pack Reader/Core/Reviews/tool; `inspect-release.py` proves all versions 1.0.0, exact Core→Reader pin, metadata/readmes/notices/source SHA, Core symbols and checksums. | Under 1 minute |
| V-3 | Local-only global tool installation with retained evidence; exact version, real Markdown, typed manifest, snapshot/Git validation and materialization. | 1–2 minutes |
| V-4 | Active docs and example references agree on stable 1.0.0; local links and diff check pass; workflow parsing/publish list remain compatible. | Under 1 minute |
| R-1 | Unit: `Mdpkg.Cli.Tests.HelpTests`, `OptionValidationTests`, `SpecConsistencyTests`. | Under 1 minute |
| R-2 | Integration: `Mdpkg.Cli.Tests.HistoryModeTests`, `ProducerTests`, `ApiParityTests`, `UpdateTests`; native Git/typed identity/materialization/report and API parity. | 1–2 minutes |
| R-3 | Default local `prove-tool.py` invocation remains green without retained evidence. | 1–2 minutes |
| R-4 | `prove-libraries.py --local-feed`: exact Reader/Core 1.0.0 restores into two independent consumers, create/full-validate/read without Git. | 1–2 minutes |
| R-5 | `verify-consumers.py --local-feed`: four package inspections, packaged public examples, Reader/Reviews/Core isolation, installed tool and origin-aware native integration. | 2–4 minutes |

R-1/R-2 share one direct xUnit run with seven exact `-class` filters and a fresh
`-result-trx` file. Match all expected methods and expand theories; prior baseline
is 81 passing cases, 57 unit and 24 integration. Report actual counts, not the
baseline expectation. No namespace/full-assembly test run is required: no
cross-cutting runtime invariant or unbounded class is changed by the version bump.
`docs/testing-and-build.md` and TUnit are absent here; use the supported xUnit flags.

## Mutation and release handoff

Zero deliberate PC-n rows/variants are specified; execute no mutants in Code.
Post-land SourceLanding Mutation still owns missing-control discovery, including
version drift and packaging controls. The caller records the companion obligation
and explicitly commissions it after ordinary Review and landing.

Local coverage is Windows only; Linux and the public-feed proof require the
existing CI workflow after caller landing. Record the actual publication run URL,
SHA and status if the caller subsequently supplies or lands it; a local green
build is not evidence that 1.0.0 is live. Public `publish` and both
`prove-nuget-org` matrix entries must pass before declaring the release published.
