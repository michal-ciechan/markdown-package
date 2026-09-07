"""Audit the saved container evidence and its continuity with CARD-0002/0003/0004."""
import io
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = ROOT / '.antiphon/container-work'
sys.path.insert(0, str(HERE.parent / 'compression'))
import benchmark as compression  # noqa: E402

COUNTS = {}
FAILURES = []


def check(name, condition, detail=''):
    COUNTS[name] = COUNTS.get(name, 0) + 1
    if not condition:
        FAILURES.append((name, detail))


def read(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


if __name__ == '__main__':
    build = read('container-results.json')
    reader = read('reader-results.json')
    tools = read('tools-results.json')

    for corpus in build['corpora']:
        for variant, pkg in corpus['packages'].items():
            path = WORK / corpus['corpus'] / (variant + '.mdpkg')
            data = path.read_bytes()
            check('package_hashes', compression.sha(data) == pkg['sha256'], str(path))
            check('package_sizes', len(data) == pkg['bytes'], str(path))
            rows = pkg['entries']
            check('manifest_first', rows[0]['name'] == build['manifest_name'], variant)
            check('manifest_stored', rows[0]['method'] == 0, variant)
            check('manifest_at_offset_zero', rows[0]['offset'] == 0, variant)
            check('no_data_descriptors', all(not (r['flags'] & 0x8) for r in rows), variant)
            check('methods_within_profile', all(r['method'] in (0, 8) for r in rows), variant)
            check('pack_is_stored', all(r['method'] == 0 for r in rows
                                        if r['name'].endswith(('.pack', '.idx'))), variant)
            check('reserved_prefix_respected',
                  all(r['name'].startswith(tuple(build['reserved_prefixes']))
                      or not r['name'].startswith('.')
                      for r in rows), variant)
            check('content_paths_avoid_reserved_prefixes',
                  not [r for r in rows if r['name'].startswith(tuple(build['reserved_prefixes']))
                       and r['name'].endswith('.md')], variant)
            check('entries_do_not_overlap',
                  all(a['end'] <= b['offset'] for a, b in zip(rows, rows[1:])), variant)
            check('directory_after_last_entry',
                  pkg['directory']['cd_offset'] >= max(r['end'] for r in rows), variant)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                check('zip_opens_with_a_stock_library', len(z.infolist()) == len(rows), variant)
                check('crc_verified_by_stock_library', z.testzip() is None, variant)
            check('typing_read_is_small', pkg['typing']['bytes_needed'] < 128, variant)
            check('typing_accepts', pkg['typing']['name_ok'] and pkg['typing']['magic_ok'], variant)

    for row in reader['access']:
        if row['expect_clean']:
            check('bounded_access_avoids_git', row['git_bytes_touched'] == 0, row['package'])
            check('bounded_access_avoids_other_documents',
                  row['other_document_bytes_touched'] == 0, row['package'])
            check('bounded_access_is_a_small_fraction',
                  row['bytes_read'] < row['package_bytes'], row['package'])
        check('warm_repeat_is_free', row['warm_repeat_bytes'] == 0, row['package'])
    dirty = [r for r in reader['access'] if not r['expect_clean']]
    check('comment_fallback_counterexample_recorded',
          bool(dirty) and all(r['git_bytes_touched'] > 0 for r in dirty))

    accepted = [r for r in reader['typing'] if r['accepted']]
    check('exactly_one_typing_input_accepted', len(accepted) == 1, str([r['input'] for r in accepted]))
    check('every_rejection_is_cheap', all(r['bytes_read'] <= 128 for r in reader['typing'] if not r['accepted']))

    for row in tools['paths']:
        check('path_extraction_recorded', 'landed' in row, row['case'])
    case = [r for r in tools['paths'] if r['case'] == 'case-pair']
    check('case_collision_loses_a_file_in_every_tool',
          bool(case) and all(r['files_on_disk'] == 1 for r in case))
    nfc = [r for r in tools['paths'] if r['case'] == 'unicode-nfc-nfd']
    check('nfc_nfd_pair_survives_on_this_host', bool(nfc) and all(r['files_on_disk'] == 2 for r in nfc))

    mdpkg = next(r for r in tools['git_paths'] if r['case'] == 'unreserved .mdpkg/ path')
    check('git_does_not_reserve_mdpkg', mdpkg['fsck_returncode'] == 0 and mdpkg['checkout_files'])
    for name in ('reserved .git/ path', 'reserved .GIT/ path'):
        row = next(r for r in tools['git_paths'] if r['case'] == name)
        check('git_reserves_dot_git', row['fsck_returncode'] != 0 and not row['checkout_files'], name)

    for row in tools['extraction']:
        check('extracted_head_matches_manifest', row['head_matches_manifest'], row['package'])
        check('extracted_worktree_is_clean_after_read_tree',
              row['worktree_clean_ignoring_container_metadata'] and row['read_tree_returncode'] == 0,
              row['package'])
        check('extracted_repository_passes_fsck', row['fsck_returncode'] == 0, row['package'])
        check('no_index_shipped', row['status_lines_before_read_tree'] > 1, row['package'])

    for row in tools['rewrites']:
        check('manifest_entry_content_survives_rewrites', row.get('manifest_content_preserved'),
              row['operation'])
    check('some_rewrite_breaks_fast_typing',
          any(row.get('readable') and not row.get('fast_typing_ok') for row in tools['rewrites']))

    out = dict(counts=COUNTS, total=sum(COUNTS.values()), failures=FAILURES)
    compression.save(HERE / 'verification.json', out)
    print(json.dumps(out, indent=1))
    if FAILURES:
        raise SystemExit(1)
