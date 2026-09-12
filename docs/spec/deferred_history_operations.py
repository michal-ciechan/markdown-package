"""Concrete S1 operation requests. These are test data, not product behavior."""
import copy


def operation_inputs(vectors, transitions, w):
    guide = vectors[0]
    s0 = dict(kind='snapshot', id=guide['snapshotId'])
    c0 = dict(kind='commit', id=guide['bootstrapCommitId'])
    child = transitions[0]
    snapshot = 'guide-snapshot.mdpkg'
    materialized = 'guide-materialized.mdpkg'
    successor = 'guide-changed-child.mdpkg'
    sources = guide['sources']
    changed = child['sources']
    row = next(r for r in w.inventory('guide.md', sources['guide.md'].encode())
               if r['locator'] == ['section', 'guide.md', [['# Guide', 0]]])
    ref = w.reference(row['slot'], row)
    proof = dict(action='verify-origin', fixture=materialized,
                 claimedOrigin=guide['origin'], expectedCheckpoint=c0)

    def resolve(target=snapshot, **extra):
        return dict(targetFixture=target, reference=ref, **extra)

    def update(base=snapshot, **extra):
        return dict(baseFixture=base, sources=changed, **extra)

    # Check names are documentation obligation IDs from spec §7.1, not a
    # provider-controlled required mask. The adapter derives applicability.
    checks = dict(container='passed', modeManifest='passed', everyPayload='passed',
                  pathsUtf8Lf='passed', ledgerReview='passed', snapshotHash='passed',
                  gitIntegrityTree='not-applicable', bootstrapOrigin='not-applicable',
                  reviewShape='passed')
    full = dict(targetFixture='delta-v2.mdpkg', externalSourceFixture='original.mdpkg',
                requestAssurance='Full', checkResults=checks)
    skipped = copy.deepcopy(full)
    skipped['checkResults']['snapshotHash'] = 'skipped'
    skipped['providerRequiredChecks'] = [k for k in checks if k != 'snapshotHash']
    skipped['providerClaimedAssurance'] = 'Full'
    prepared = dict(fixture='delta-v2.mdpkg', published=True)
    export_change = dict(baseFixture='delta-v2.mdpkg', preparedExport=prepared,
                         jsonEdits=[dict(entry='.mdpkg/review/comments.json',
                                         path=['threads', 0, 'comments', 0, 'body'],
                                         value='Please clarify the target words.')],
                         namespaceCandidate='a1234567-1234-4321-8123-123456789abc')
    partial_edits = [dict(entry='.mdpkg/manifest.json', path=['addressing', 'coverage'], value='partial'),
                     dict(entry='.mdpkg/history.json', path=['addressingCoverage', 0, 'coverage'], value='partial')]
    result = {
        'initial-publication': dict(sources=sources, namespace=guide['namespace'], publishedStates=[], history='none'),
        'identical-resend': dict(baseFixture=snapshot, sources=sources, publishedStates=[s0]),
        'private-edit': dict(baseFixture=snapshot, sources=changed, publishedStates=[], publish=False),
        'changed-published-successor': update(publishedStates=[s0], originalSnapshotFixture=snapshot,
                                            commitMetadata=dict(message='Publish changed guide', unixTime=1700000400)),
        'missing-S0': dict(priorState=s0, namespace=guide['namespace'], originalSnapshotFixture=None,
                           sources=changed, destinationBefore='existing destination\n'),
        'committed-successor': update(materialized, commitMetadata=dict(message='Publish changed guide', unixTime=1700000400)),
        'snapshot-current-reference': resolve(),
        'snapshot-at-reference': resolve(referenceKind='section-at', at=c0['id']),
        'snapshot-touched': resolve(query='touched-since', observedAt=s0),
        'different-snapshot-observedAt': resolve(observedAt=dict(kind='snapshot', id=w_snapshot_changed(vectors, transitions))),
        'git-unverified-origin': resolve(materialized, observedAt=s0, originProof=dict(action='do-not-verify', suppliedProof=None)),
        'git-missing-origin': resolve(materialized, observedAt=s0,
                                      jsonEdits=[dict(entry='.mdpkg/history.json', path=['origin'], remove=True),
                                                 dict(entry='.mdpkg/history.json', path=['root'], value='original')],
                                      rebuildCommit=dict(commitBytes=guide['bootstrapCommitBytes'].split('\n\n')[0]+'\n\nInitial guide\n',
                                                         repairObjectBindings=True),
                                      originProof=dict(action='do-not-verify', suppliedProof=None)),
        'partial-without-observedAt': resolve(successor, jsonEdits=partial_edits, observedAt=None),
        'verified-origin': resolve(materialized, observedAt=s0, originProof=proof),
        'exact-at': resolve(materialized, at=child['manifest']['current']['id'], historyBackend=True,
                            originProof=proof),
        'newer-review-target': dict(reviewFixture='delta-v2.mdpkg', originalFixture='original.mdpkg',
                                    targetFixture='changed.mdpkg', explicitlySelectedNewerTarget=False),
        'delta-external-source-absent': dict(targetFixture='delta-v2.mdpkg', externalSourceFixture=None,
                                            requestAssurance='Full', checkResults=checks),
        'changed-delta-export': export_change,
        'unchanged-delta-retry': dict(baseFixture='delta-v2.mdpkg', preparedExport=prepared, jsonEdits=[]),
        'remove-C0': dict(baseFixture=successor, retainCommits=[child['manifest']['current']['id']],
                          transform='truncate', originPolicy='remove', outputHistoryRoot='synthetic',
                          outputHistoryCoverage='truncated', rewriteFirstRetainedAsParentless=True),
        'retained-C0-repack': dict(baseFixture=successor, retainCommits=[c0['id'], child['manifest']['current']['id']],
                                   transform='repack', originPolicy='retain'),
        'unchanged-tree-semantic-edit': dict(baseFixture='delta-review-materialized.mdpkg',
                                            sources=vectors[2]['sources'],
                                            manifestEdits=[dict(path=['review', 'of', 'current'], value=c0)],
                                            commitMetadata=dict(message='Retarget review to C0', unixTime=1700000400)),
        'snapshot-full': full,
        'required-check-skipped': skipped,
        'explicit-import': dict(sourceGitFixture=materialized, argv=['pack', '--from-git', 'source', '--history', 'none']),
        'scope-snapshot': dict(sources=sources, argv=['pack', '--history', 'none', '--scope', 'guide.md']),
        'depth-snapshot': dict(sources=sources, argv=['pack', '--history', 'none', '--depth', '1']),
        'reverse-snapshot': dict(sources=sources, argv=['pack', '--history', 'none', '--reverse-index']),
        'metadata-snapshot': dict(sources=sources, argv=['pack', '--history', 'none', '--message', 'text']),
        'partial-correspondence': dict(sources=changed, namespace=guide['namespace'], addressingCoverage='partial',
                                       correspondence=[dict(root=row['slot'], unknown='unconfirmed-removal')],
                                       argv=['pack', '--history', 'none']),
        'materialize-Git': dict(baseFixture=materialized, argv=['update', '--materialize']),
        'materialize-with-tree': dict(baseFixture=snapshot, sources=changed, argv=['update', '--materialize', '--tree', 'tree']),
        'unsupported-append-transform': dict(baseFixture=successor, sources={'guide.md': '# Guide\n\nSecond published change.\n'}, argv=['update', '--tree', 'tree'],
                                              producerCapabilities=dict(append=False)),
        'source-ledger-conflict': dict(baseFixture='ledger-materialized.mdpkg', sources=vectors[3]['sources'],
                                       sourceJsonEdits=[dict(entry=w.LEDGER, path=['entries', 'a'*64], value=dict(dead='deleted'))],
                                       correspondence=[dict(root='a'*64, to=['section', 'guide.md', [['# Guide', 0]]])],
                                       argv=['update', '--tree', 'tree']),
        'snapshot-native-export': dict(baseFixture=snapshot, format='native-git-working-tree'),
        'cancel-before-publication': update(destinationBefore='existing destination\n', cancelAt='before-atomic-replace'),
    }
    for request in result.values():
        if 'commitMetadata' in request:
            request['commitMetadata'].update(
                author=dict(name='Example Author', email='author@example.invalid'),
                committer=dict(name='Example Author', email='author@example.invalid'),
                timezone='+0000')
    return result


def w_snapshot_changed(vectors, transitions):
    """Exact alternate snapshot preimage, used only as external observed evidence."""
    import hashlib, json
    preimage = copy.deepcopy(vectors[0]['preimage'])
    data = transitions[0]['sources']['guide.md'].encode()
    preimage['entries'][0].update(bytes=len(data), digest='sha256-'+hashlib.sha256(data).hexdigest())
    raw = (json.dumps(preimage, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode()
    return 'sha256-'+hashlib.sha256(raw).hexdigest()
