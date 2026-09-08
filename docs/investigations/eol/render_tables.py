"""Render the CARD-0010 tables from the saved evidence into the write-up."""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOC = HERE.parent / '2026-09-08-card-0010-eol-evidence.md'


def read(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


def table(header, rows):
    out = ['| ' + ' | '.join(header) + ' |',
           '| ' + ' | '.join('---' for _ in header) + ' |']
    for r in rows:
        out.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    return '\n'.join(out)


def yn(v):
    return 'yes' if v else 'no'


def objects_table(f):
    rows = []
    for r in f['blob_rewrites']:
        rows.append([r['ordinal'], '`%s`' % r['path'],
                     '%d / %d' % (r['source_bytes'], r['source_cr_bytes']),
                     '`%s`' % r['source_oid'][:12],
                     r['projected_bytes'], '`%s`' % r['projected_oid'][:12],
                     '**yes**' if r['rewritten'] else 'no'])
    return table(['Commit', 'Path', 'Source bytes / CR', 'Source blob', 'LF bytes',
                  'Projected blob', 'ID rewritten'], rows)


def graph_table(f):
    rows = []
    for kind, key in (('tree', 'tree_rewrites'), ('commit', 'commit_rewrites')):
        for r in f[key]:
            ctrl = f['identity_control']['trees' if kind == 'tree' else 'commits'][r['ordinal']]
            rows.append([kind, r['ordinal'], '`%s`' % r['source'][:12],
                         '`%s`' % r['projected'][:12],
                         '**yes**' if r['rewritten'] else 'no',
                         '**yes**' if ctrl['rewritten'] else 'no'])
    return table(['Object', 'Ordinal', 'From the CRLF source', 'In the package',
                  'Rewritten (CRLF source)', 'Rewritten (LF source control)'], rows)


def packages_table(f):
    rows = []
    for label in ('conforming-lf', 'nonconforming-crlf'):
        p = f['packages'][label]
        s = p['eol_scan']
        rows.append(['`%s`' % label, p['bytes'], '`%s…`' % p['sha256'][:16], len(p['entries']),
                     '`%s`' % p['head'][:12], len(s['offending_entries']),
                     'passes' if s['conforms'] else '**fails**',
                     s['payload_bytes_scanned']])
    return table(['Package', 'Bytes', 'SHA-256', 'Entries', 'HEAD', 'Entries carrying CR',
                  'Section 4 EOL check', 'Payload bytes scanned'], rows)


def unpack_table(e):
    rows = []
    for r in e['unpack']:
        doc = r['regions']['document']
        binr = r['regions']['git-binary']
        rows.append(['%s' % r['tool'], r['returncode'],
                     '%d / %d' % (r['identical'], r['entries']),
                     '%d / %d' % (doc['identical'], doc['entries']),
                     '%d / %d' % (binr['identical'], binr['entries']),
                     r['cr_added'], r['cr_removed'],
                     'n/a' if not r['git_fsck'] else
                     ('clean' if r['git_fsck']['returncode'] == 0
                      else '**exit %d**' % r['git_fsck']['returncode'])])
    return table(['Tool', 'Exit', 'Entries byte-identical', 'Documents', 'Pack + index',
                  'CR added', 'CR removed', '`git fsck` after'], rows)


def textbit_table(e):
    rows = []
    for r in e['text_bit']['rows']:
        rows.append([r['content'], yn(r['internal_attr_text_bit']),
                     '%d / %d' % (r['documents_identical'], r['documents']),
                     r['cr_removed'], r['cr_added'],
                     '**yes**' if r['converted'] else 'no'])
    return table(['Stored content', 'Text bit set', 'Documents byte-identical',
                  'CR removed', 'CR added', 'Converted'], rows)


def git_table(e):
    rows = []
    label = {'false': '`core.autocrlf=false`', 'input': '`core.autocrlf=input`',
             'true': '`core.autocrlf=true`',
             'shipped-config-plus-false': 'counterfactual: `.git/config` pins `false`'}
    for r in e['git_checkout']:
        n = r['documents']
        rows.append([label[r['autocrlf']],
                     '%d / %d' % (r['identical_after_unpack'], n),
                     '%d / %d' % (r['identical_after_read_tree'], n),
                     r['modified_after_read_tree'],
                     '%d / %d' % (r['identical_after_checkout'], n),
                     '%d / %d' % (r['identical_after_clone'], n),
                     r['cr_added_by_checkout'] + r['cr_added_by_clone'],
                     'clean' if r['fsck']['returncode'] == 0 else 'exit %d' % r['fsck']['returncode']])
    return table(['Setting', 'After unpack', 'After `read-tree`', 'Modified files reported',
                  'After `checkout -- .`', 'After `clone`', 'CR added (checkout + clone)',
                  '`git fsck`'], rows)


def validation_text(v):
    c = v['counts']
    total = v['total']
    return ('Validation: **%d** package structure and hash audits, **%d** blob, tree and commit '
            'identity checks against re-derived object IDs, **%d** addressing-digest equivalence '
            'and CRC checks, **%d** section 4 validator checks, **%d** unpack fidelity and '
            '`git fsck` checks over 9 tool invocations, **%d** internal-attributes text-bit '
            'checks, and **%d** Git checkout, clone and working-tree checks across four '
            '`core.autocrlf` settings. **%d checks in total, 0 unexpected failures.** The two '
            'recorded counterexamples — `unzip -aa` corrupting the pack, and `core.autocrlf=true` '
            'converting on checkout and clone — are measured limitations, not failed assertions.'
            % (sum(c.get(k, 0) for k in ('package_hashes', 'package_sizes',
                                         'zip_opens_with_a_stock_library',
                                         'crc_verified_by_stock_library',
                                         'manifest_first_and_stored')),
               sum(c.get(k, 0) for k in ('blob_oid_recomputed', 'projected_blob_oid_recomputed',
                                         'rewrite_flag_matches_content', 'projection_leaves_no_cr',
                                         'every_crlf_blob_was_rewritten',
                                         'every_lf_blob_kept_its_id', 'every_tree_rewritten',
                                         'every_commit_rewritten',
                                         'lf_source_projection_is_identity')),
               sum(c.get(k, 0) for k in ('all_digests_identical', 'but_the_bytes_differ',
                                         'crlf_entries_have_different_crcs',
                                         'digests_survive_exactly_when_bytes_do')),
               sum(c.get(k, 0) for k in ('validator_passes_conforming',
                                         'validator_flags_nonconforming',
                                         'validator_scan_is_payload_only')),
               sum(c.get(k, 0) for k in ('unpack_rows_recorded',
                                         'most_unpack_tools_preserve_every_byte',
                                         'no_unpack_tool_added_a_cr',
                                         'preserving_tools_leave_a_valid_repository',
                                         'unzip_aa_damages_only_the_binary_region',
                                         'unzip_aa_breaks_fsck')),
               sum(c.get(k, 0) for k in ('produced_package_flags_every_entry_binary',
                                         'only_crlf_plus_text_bit_converts',
                                         'conversion_is_cr_removal_on_this_build')),
               sum(c.get(k, 0) for k in ('git_rows_recorded', 'unpack_is_always_byte_exact',
                                         'read_tree_never_touches_the_worktree',
                                         'read_tree_leaves_a_clean_worktree',
                                         'fsck_clean_after_the_git_half',
                                         'shipped_config_declares_no_autocrlf',
                                         'autocrlf_true_converts_on_checkout',
                                         'autocrlf_true_converts_on_clone',
                                         'autocrlf_true_conversion_is_exactly_lf_to_crlf',
                                         'other_settings_preserve_bytes_through_checkout_and_clone')),
               total))


if __name__ == '__main__':
    f, e, v = read('fixture-results.json'), read('extractor-results.json'), read('verification.json')
    blocks = {
        'OBJECTS': objects_table(f),
        'GRAPH': graph_table(f),
        'PACKAGES': packages_table(f),
        'UNPACK': unpack_table(e),
        'TEXTBIT': textbit_table(e),
        'GITEOL': git_table(e),
        'VALIDATION': validation_text(v),
    }
    text = DOC.read_text(encoding='utf-8')
    for name, body in blocks.items():
        pattern = re.compile(r'<!-- %s_START -->.*?<!-- %s_END -->' % (name, name), re.S)
        if not pattern.search(text):
            raise SystemExit('missing marker block: ' + name)
        block = '<!-- %s_START -->\n\n%s\n\n<!-- %s_END -->' % (name, body, name)
        text = pattern.sub(lambda m, b=block: b, text)
    DOC.write_text(text, encoding='utf-8', newline='\n')
    print('rendered %d blocks into %s' % (len(blocks), DOC))
