"""Regenerate evidence tables; narrative conclusions remain reviewable Markdown."""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPORT = HERE.parent / 'container.md'


def read(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


def n(v):
    return f'{v:,}'


def yes(v):
    return 'yes' if v else 'no'


def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(headers) + ' |',
                      '| ' + ' | '.join(['---'] * len(headers)) + ' |']
                     + ['| ' + ' | '.join(map(str, r)) + ' |' for r in rows])


def replace(name, value):
    global text
    text = re.sub(r'<!-- ' + name + r'_START -->.*?<!-- ' + name + r'_END -->',
                  lambda _: f'<!-- {name}_START -->\n\n{value}\n\n<!-- {name}_END -->',
                  text, flags=re.S)


if __name__ == '__main__':
    text = REPORT.read_text(encoding='utf-8')
    build, reader, tools = read('container-results.json'), read('reader-results.json'), read('tools-results.json')
    verify = read('verification.json')
    npm = next(c for c in build['corpora'] if c['corpus'] == 'npm')
    rust = next(c for c in build['corpora'] if c['corpus'] == 'rust')

    rows = []
    for r in npm['packages']['no-overrides']['regions']:
        rows.append([r['region'], n(r['entries']) if r['entries'] else '—',
                     n(r['first']), n(r['last']), n(r['bytes'])])
    replace('LAYOUT', table(['Region, in file order', 'Entries', 'First byte', 'Last byte', 'Bytes'], rows))

    rows = []
    for c in (npm, rust):
        p, q = c['packages']['no-overrides'], c['packages']['sparse-overrides']
        rows.append([c['corpus'], n(c['documents']), n(c['document_bytes']), n(len(p['entries'])),
                     n(p['manifest_bytes']), n(p['bytes']), n(q['bytes']),
                     f"{q['ledger_records']} of {n(q['headings'])}"])
    replace('SIZES', table(['Corpus', 'Documents', 'Raw document bytes', 'ZIP entries', 'Manifest bytes',
                            'Package bytes', 'With an override ledger', 'Ledger records'], rows))

    rows = []
    for v in npm['variants']:
        w = next(x for x in rust['variants'] if x['variant'] == v['variant'])
        rows.append([v['variant'], n(v['bytes']), n(w['bytes']),
                     v['typing_bytes'] or 'directory walk',
                     n(v['without_git']), n(w['without_git'])])
    replace('VARIANTS', table(['Layout variant', 'npm bytes', 'Rust bytes', 'Typing read',
                               'npm no-.git span', 'Rust no-.git span'], rows))

    rows = [[m['variant'], n(m['bytes']), n(next(x for x in rust['manifests']
                                                 if x['variant'] == m['variant'])['bytes'])]
            for m in npm['manifests']]
    replace('MANIFEST', table(['Manifest content', 'npm bytes', 'Rust bytes'], rows))

    rows = []
    for r in reader['access']:
        rows.append([r['package'], r['mode'], n(r['requests']), n(r['bytes_read']),
                     n(r['payload_bytes']), n(r['git_bytes_touched']),
                     n(r['other_document_bytes_touched'])])
    replace('ACCESS', table(['Package / initial tail request', 'Read', 'Requests', 'Bytes read',
                             'Payload bytes', '.git bytes touched', 'Other-document bytes'], rows))

    rows = [[r['input'], n(r['input_bytes']), yes(r['accepted']), n(r['bytes_read']),
             r['reason'] or '—', r['directory_fallback'] or '—'] for r in reader['typing']]
    replace('TYPING', table(['Input', 'Input bytes', 'Accepted', 'Bytes read to decide',
                             'Rejection reason', 'Central-directory fallback'], rows))

    order = ['Python zipfile', '7-Zip', 'Info-ZIP unzip', 'Windows Explorer']
    rows = []
    for case in ['case-pair', 'unicode-nfc-nfd', 'non-ascii-single', 'backslash-in-name']:
        got = [r for r in tools['paths'] if r['case'] == case]
        first = got[0]
        rows.append([case, n(first['entries'])]
                    + [f"{next(r for r in got if r['tool'] == t)['files_on_disk']} file(s), "
                       f"{'all preserved' if next(r for r in got if r['tool'] == t)['preserved'] else 'content lost'}"
                       for t in order])
    replace('PATHS', table(['Fixture', 'ZIP entries'] + order, rows))

    rows = []
    for r in tools['git_paths']:
        if 'fsck_returncode' not in r:
            continue
        rows.append([r['case'], r['path'], yes(r['plumbing_update_index']),
                     'accepts' if r['fsck_returncode'] == 0 else f"rejects (exit {r['fsck_returncode']})",
                     ', '.join(r['checkout_files']) or 'nothing written'])
    last = next(r for r in tools['git_paths'] if 'files_on_disk' in r)
    rows.append([last['case'], last['path'], yes(last['plumbing_update_index']), 'n/a',
                 ', '.join(last['files_on_disk'])])
    replace('GITPATHS', table(['Case', 'Path', 'update-index accepts', 'git fsck --strict',
                               'Files after checkout-index on NTFS'], rows))

    rows = [[r['package'], n(r['entries']), n(r['tracked_files']),
             n(r['status_lines_before_read_tree']), n(r['status_lines']),
             ', '.join(r['untracked_entries']), n(r['index_bytes_if_shipped']),
             'clean' if r['fsck_returncode'] == 0 else 'failed'] for r in tools['extraction']]
    replace('EXTRACT', table(['Extracted package', 'ZIP entries', 'Tracked files',
                              'status lines before read-tree', 'after read-tree', 'Remaining untracked',
                              '.git/index bytes if it were shipped', 'fsck'], rows))

    rows = [[r['operation'], yes(r.get('readable')), yes(r.get('manifest_content_preserved')),
             r.get('first_entry', '—'), yes(r.get('manifest_stored')), yes(r.get('fast_typing_ok'))]
            for r in tools['rewrites']]
    replace('REWRITE', table(['Operation', 'Still opens', 'Manifest bytes preserved', 'First entry',
                              'Manifest stored', 'Offset-0 typing still works'], rows))

    cm = build['comment']
    rows = [[r['tier'], r['field_bytes'], r['comment_bytes'], n(r['first_version']),
             n(r['last_version']), n(r['versions']), '`' + r['first_encoding'] + '`',
             '`' + r['last_encoding'] + '`'] for r in cm['tiers']]
    replace('COMMENTTIERS', table(['Tier', 'Field bytes', 'Comment bytes', 'First version',
                                   'Last version', 'Versions', 'First encoding', 'Last encoding'], rows))

    rows = [[n(r['value']), r['escalating'], r['leb128'], r['utf8'] or 'not encodable',
             r['protobuf_varint']] for r in cm['prior_art']]
    rows += [[f"{a['encoding']} field, whole range to {n(a['max_version'])}",
              a['comment_bytes'] - len('MDPKG'), '—', '—', '—']
             for a in cm['fixed_width_alternatives']]
    replace('PRIORART', table(['Version value, or whole-field alternative', 'Field bytes',
                               'LEB128', 'UTF-8', 'protobuf varint'], rows))

    rows = [[r['corpus'], r['package'], r['route'], yes(r['decided']),
             r['version'] if r['version'] is not None else '—',
             n(r['requests']), n(r['bytes_read']), r['reason'] or '—']
            for r in reader['version_probes']]
    replace('VERSIONPROBE', table(['Corpus', 'Package', 'Route', 'Decides', 'Version',
                                   'Requests', 'Bytes read', 'Why not'], rows))

    def cost(v):
        return n(v) + ' B' if v else 'unavailable'

    rows = [[r['operation'], n(r['comment_bytes']) if r.get('readable') else '—',
             r.get('outcome', r.get('error', '—')), cost(r.get('tail_typing_bytes')),
             cost(r.get('offset0_typing_bytes')), cost(r.get('directory_typing_bytes'))]
            for r in tools['comment_rewrites']]
    replace('COMMENTREWRITE', table(['Operation', 'Comment bytes after', 'Outcome',
                                     '34-byte tail route', '79-byte offset-0 route',
                                     'Recoverable directory walk'], rows))

    c = verify['counts']

    def s(*keys):
        return sum(c.get(k, 0) for k in keys)

    groups = [
        ('package structure checks (manifest first, stored, offset zero, no data descriptors, '
         'methods in profile, packs stored, entries non-overlapping, directory placement, '
         'reserved prefixes)', s('manifest_first', 'manifest_stored', 'manifest_at_offset_zero',
                                 'no_data_descriptors', 'methods_within_profile', 'pack_is_stored',
                                 'entries_do_not_overlap', 'directory_after_last_entry',
                                 'reserved_prefix_respected', 'content_paths_avoid_reserved_prefixes')),
        ('package hash/size/stock-library CRC audits', s('package_hashes', 'package_sizes',
                                                         'zip_opens_with_a_stock_library',
                                                         'crc_verified_by_stock_library')),
        ('bounded-access boundary assertions', s('bounded_access_avoids_git',
                                                 'bounded_access_avoids_other_documents',
                                                 'bounded_access_is_a_small_fraction',
                                                 'warm_repeat_is_free')),
        ('typing accept/reject decisions', s('typing_read_is_small', 'typing_accepts',
                                             'exactly_one_typing_input_accepted',
                                             'every_rejection_is_cheap')),
        ('real-tool path extractions', s('path_extraction_recorded')),
        ('Git path-reservation cases', s('git_does_not_reserve_mdpkg', 'git_reserves_dot_git')),
        ('extraction / working-tree checks', s('extracted_head_matches_manifest',
                                               'extracted_worktree_is_clean_after_read_tree',
                                               'extracted_repository_passes_fsck', 'no_index_shipped')),
        ('archive-rewrite cases', s('manifest_entry_content_survives_rewrites')),
        ('fixed-length EOCD comment checks (tier encoding, comment bytes, version routes, '
         'tail-typed access, comment rewrite survival)',
         s('version_tiers_are_contiguous_and_unique', 'version_tier_widths_grow',
           'escalating_field_beats_leb128_below_the_first_escape',
           'escalating_field_loses_to_leb128_above_the_first_escape',
           'fixed_comment_costs_its_own_length', 'fixed_comment_bytes_are_the_declared_bytes',
           'fixed_comment_package_still_types_at_offset_zero',
           'tail_route_decides_only_for_the_fixed_comment',
           'offset_zero_route_decides_for_every_package',
           'tail_route_reads_less_than_the_offset_zero_route',
           'tail_typed_access_costs_no_extra_requests', 'tail_typed_access_reads_fewer_bytes',
           'tail_typed_access_reports_the_version', 'comment_rewrites_recorded',
           'comment_is_never_replaced_by_a_foreign_comment',
           'comment_is_stripped_by_at_least_one_rewrite',
           'comment_rescues_exactly_one_rewrite_from_a_directory_walk',
           'some_rewrite_leaves_only_the_directory_walk',
           'comment_survives_fewer_rewrites_than_the_manifest_entry')),
        ('recorded counterexamples (EOCD-comment fallback, case collision, NFC/NFD survival, '
         'rewrite breaking fast typing)', s('comment_fallback_counterexample_recorded',
                                            'case_collision_loses_a_file_in_every_tool',
                                            'nfc_nfd_pair_survives_on_this_host',
                                            'some_rewrite_breaks_fast_typing')),
    ]
    body = ', '.join(f'**{n(v)}** {label}' for label, v in groups)
    replace('VALIDATION', f'Validation: {body}. **{n(verify["total"])} checks in total, '
                          f'{len(verify["failures"])} unexpected failures in final evidence.** '
                          'The recorded counterexamples are deliberate measured limitations, '
                          'not failed assertions.')

    REPORT.write_text(text, encoding='utf-8')
    print('rendered', REPORT)
