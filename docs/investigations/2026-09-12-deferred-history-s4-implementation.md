# Deferred history S4 implementation and review handoff

S4 completes Reviews consumption using typed state identities, mode-specific full
verification obligations and S3's archive-bound history proof. It consumes and validates
bundled fixtures; it does not add a general bundled-review writer or an authoring UI.

## Verification contract

`IReviewVerificationProvider.VerifyAsync` now receives the bounded archive and required
check mask derived by Reviews from its parsed mode, review declaration and origin.
The unconditional `VerificationChecks.Full` mask is removed. Required checks are:

| Package | Checks in addition to all payloads, current view and review lineage |
| --- | --- |
| Snapshot | SnapshotIdentity |
| Git without origin | GitIntegrity |
| Git with origin | GitIntegrity and BootstrapOrigin |

`ReviewExtractionResult` exposes RequiredChecks, CompletedChecks and NotApplicableChecks.
Full requires acceptance, every applicable check, no claimed nonapplicable checks, and
independent evidence. For snapshots, the borrowed Reader archive must actually have
passed `VerifySnapshot`. For Git, the report must carry an S3 `VerifiedHistoryContext`
matching the archive's typed identity, length and computed SHA-256. A provider cannot
earn Full by echoing the mask, omitting a required check, using a proof for other bytes,
or silently skipping an unavailable Git repository. A declared origin is never an alias.

`ReviewVerificationProvider` implements the snapshot branch with Reader and accepts an
explicit `IHistoryVerificationBackend` for Git. Core's `GitHistoryBackend` supplies the
S3 implementation. Reviews still has only Reader as its package dependency. Delta
namespace and payload restrictions are checked in the parsed format; native full Git
proof checks retained review-only delta trees and bundled parent/complete tree-diff
rules, including documents and ledger. Snapshot-targeted bundles require verified C0.

Full extraction first captures private bounded archive bytes so feedback parsing and
provider verification see the same input even if the caller changes its stream. Default
selective extraction remains structural. The private copy uses the input byte cap;
decoded reads and backend work retain their independent resource/cancellation limits.
These service limits are not a total process-memory quota.

## Source and selector contract

`ReviewedPackageContext` replaces the caller-set ContextVerification flag with
ReviewedHistory and TargetHistory proof objects. Source Git proofs must match the
actual selected archive bytes. A snapshot source must have passed the explicit
`PackageSnapshot.ReadAsync(..., verifySnapshot: true)` path, which captures, verifies
all current files (including unselected non-Markdown files), and returns owned scopes
with SnapshotVerified assurance. S3's verified reconstructed original also carries that
assurance. Default Reader reads remain selective.

An original S0 can be supplied directly or reconstructed through verified origin.
Original selectors then produce the same source identity, locator, digest and UTF-16
range. Reconstruction reports Reconstructed correlation and OriginalArchiveUnavailable:
it has not recovered the old ZIP encoding or optional digest/length/dispatch evidence.
Materialized C0 is a different target key and still requires UseNewerTarget. NewerTarget
correlation additionally requires verified checkpoint continuity. Partial or missing
continuity cannot be upgraded by a matching quote or endpoint digest.

Wrong/missing origins, wrong archive binding, unverified source, non-selected targets
and unresolved correspondence keep the feedback and explicit failure statuses. Source
verification and review-artifact verification are separate: a valid delta can receive
Full without its external source, while an invalid or unverified original selector has
no verified location. The anchor, authored-kind, reply-order and selector algorithms
are unchanged; no dispatch field is opened as a path or URL.

## Consumer example and verification

The standalone review-consumer example explicitly references coordinated Reviews and
Core packages. `--full` verifies the artifact; `--git` opts into Core's native backend.
`--target file --newer --git` selects a verified successor and permits origin
reconstruction. Missing source or failed verification still prints the authored feedback.
The Reviews README also provides a Reader-only snapshot example needing no Git.

New tests cover both delta modes against both reviewed kinds, both bundled target
kinds, forged parent/document/ledger/origin, every omitted required check, masks without
proof, missing Git/backend, exact/reconstructed selector equivalence, C0 selection,
relocation and moves, unverified source, reemitted proof rejection, deleted/wrong origin,
corrupt packs, resource failures, late cancellation and caller-stream mutation.

Linux Release (.NET SDK 10.0.401, disposable Docker copy with a read-only host mount)
passed all 1,424 tests with zero failures or skips. Windows Release (.NET SDK 10.0.300)
also passed all 1,424 with zero failures or skips. Installed-package checks passed:
four package inspections, three isolated external consumers, both Core README examples,
the separate Reviews native-bridge example and installed-tool pack/materialize/append/Deep
validation. The 26 history-free and 12 managed-Git assertions passed with zero native
Git invocations for eligible snapshots. `git diff --check` passed. Two initial new-test failures were
assertion issues (collection reference equality and quote length); both were corrected.

From `src/generator-cli`, rerun:

```powershell
dotnet test -c Release --solution Mdpkg.slnx
dotnet pack -c Release --no-build -o artifacts/package
python tests/verify-consumers.py
python tests/prove-managed-snapshot.py --local-feed artifacts/package --history-free
dotnet pack src/Mdpkg.Cli/Mdpkg.Cli.csproj -c Release -p:MdpkgManagedSnapshotCandidate=true --artifacts-path artifacts/managed-candidate -o artifacts/managed-candidate-feed
python tests/prove-managed-snapshot.py --local-feed artifacts/managed-candidate-feed
```

The consumer proof checks Reviews without a Core dependency first, then explicitly
adds Core for the native bridge example. It exercises full snapshot verification with
Git absent, selected and non-selected materialized targets, and a forged bundle while
checking feedback preservation. Packages are built locally; no NuGet publication is
part of S4. Browser integration remains S5 and integrated release acceptance remains S6.

Review focus: independently audit the required-mask/evidence gates, target archive
binding, original-state versus old-archive distinction, explicit C0/newer selection,
and the separation of artifact Full assurance from source-dependent selector claims.
