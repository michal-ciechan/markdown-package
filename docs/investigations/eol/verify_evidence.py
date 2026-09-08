"""Audit the saved CARD-0010 evidence: re-derive every number the write-up quotes."""
import hashlib
import importlib.util
import json
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
WORK = ROOT / '.antiphon/eol-work'

_s = importlib.util.spec_from_file_location('fx', HERE / 'fixture.py')
fx = importlib.util.module_from_spec(_s)
_s.loader.exec_module(fx)

COUNTS = {}
FAILURES = []


def check(name, condition, detail=''):
    COUNTS[name] = COUNTS.get(name, 0) + 1
    if not condition:
        FAILURES.append((name, detail))


def read(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


if __name__ == '__main__':
    f = read('fixture-results.json')
    e = read('extractor-results.json')

    # --- the two packages are on disk exactly as recorded ------------------
    for label, pkg in f['packages'].items():
        data = Path(pkg['path']).read_bytes()
        check('package_hashes', hashlib.sha256(data).hexdigest() == pkg['sha256'], label)
        check('package_sizes', len(data) == pkg['bytes'], label)
        with zipfile.ZipFile(pkg['path']) as z:
            check('zip_opens_with_a_stock_library', len(z.infolist()) == len(pkg['entries']), label)
            check('crc_verified_by_stock_library', z.testzip() is None, label)
            check('manifest_first_and_stored',
                  z.infolist()[0].filename == fx.MANIFEST
                  and z.infolist()[0].compress_type == 0
                  and z.infolist()[0].header_offset == 0, label)

    # --- D-17 as written, re-applied to the fixture content ----------------
    for r in f['blob_rewrites']:
        snap = fx.SNAPSHOTS_CRLF[r['ordinal']]
        src = snap[r['path']]
        lf = fx.to_lf(src)
        check('blob_oid_recomputed',
              hashlib.sha1(b'blob %d\0' % len(src) + src).hexdigest() == r['source_oid'], r['path'])
        check('projected_blob_oid_recomputed',
              hashlib.sha1(b'blob %d\0' % len(lf) + lf).hexdigest() == r['projected_oid'], r['path'])
        check('rewrite_flag_matches_content',
              r['rewritten'] == (src != lf), r['path'])
        check('projection_leaves_no_cr', r['projected_cr_bytes'] == 0, r['path'])

    check('every_crlf_blob_was_rewritten',
          all(r['rewritten'] for r in f['blob_rewrites'] if r['source_cr_bytes']))
    check('every_lf_blob_kept_its_id',
          all(not r['rewritten'] for r in f['blob_rewrites'] if not r['source_cr_bytes']))
    check('every_tree_rewritten', all(r['rewritten'] for r in f['tree_rewrites']))
    check('every_commit_rewritten', all(r['rewritten'] for r in f['commit_rewrites']))
    check('lf_source_projection_is_identity',
          not any(r['rewritten'] for r in f['identity_control']['trees'])
          and not any(r['rewritten'] for r in f['identity_control']['commits']))

    # --- the addressing layer cannot tell the two packages apart -----------
    check('all_digests_identical', all(r['identical'] for r in f['digest_equivalence']),
          str(len(f['digest_equivalence'])))
    check('but_the_bytes_differ',
          f['packages']['conforming-lf']['sha256'] != f['packages']['nonconforming-crlf']['sha256'])
    changed_crc = [r for r in f['entry_crc'] if r['lf_crc'] != r['crlf_crc']]
    check('crlf_entries_have_different_crcs', len(changed_crc) == 3, str(len(changed_crc)))

    # --- the section 4 validator check does what section 4 claims ----------
    check('validator_passes_conforming', f['packages']['conforming-lf']['eol_scan']['conforms'])
    check('validator_flags_nonconforming',
          not f['packages']['nonconforming-crlf']['eol_scan']['conforms'])
    check('validator_scan_is_payload_only',
          f['packages']['conforming-lf']['eol_scan']['payload_bytes_scanned']
          < f['packages']['conforming-lf']['bytes'])

    # --- the unpack half of D-18 -------------------------------------------
    preserving = [r for r in e['unpack'] if r['identical'] == r['entries']]
    check('unpack_rows_recorded', len(e['unpack']) == 9, str(len(e['unpack'])))
    check('most_unpack_tools_preserve_every_byte', len(preserving) == 7, str(len(preserving)))
    for r in e['unpack']:
        check('no_unpack_tool_added_a_cr', r['cr_added'] == 0, r['tool'])
        if r['identical'] == r['entries']:
            check('preserving_tools_leave_a_valid_repository',
                  r['git_fsck'] and r['git_fsck']['returncode'] == 0, r['tool'])
    aa = next(r for r in e['unpack'] if '-aa' in r['tool'])
    check('unzip_aa_damages_only_the_binary_region',
          all(c['region'] == 'git-binary' for c in aa['changed']) and len(aa['changed']) == 2)
    check('unzip_aa_breaks_fsck', aa['git_fsck']['returncode'] != 0)
    for r in e['digests_after_extraction']:
        row = next(u for u in e['unpack'] if u['tool'] == r['tool'])
        check('digests_survive_exactly_when_bytes_do',
              r['all_match'] == (row['regions']['document']['identical']
                                 == row['regions']['document']['entries']), r['tool'])

    # --- the text bit is what gates Info-ZIP's conversion ------------------
    check('produced_package_flags_every_entry_binary', e['text_bit']['all_entries_flagged_binary'])
    converted = [r for r in e['text_bit']['rows'] if r['converted']]
    check('only_crlf_plus_text_bit_converts', len(converted) == 1, str(len(converted)))
    if converted:
        check('conversion_is_cr_removal_on_this_build',
              converted[0]['cr_removed'] > 0 and converted[0]['cr_added'] == 0)

    # --- the git half of D-18 ----------------------------------------------
    by = {r['autocrlf']: r for r in e['git_checkout']}
    check('git_rows_recorded', len(by) == 4, str(len(by)))
    for name, r in by.items():
        check('unpack_is_always_byte_exact', r['identical_after_unpack'] == r['documents'], name)
        check('read_tree_never_touches_the_worktree',
              r['identical_after_read_tree'] == r['documents'], name)
        check('read_tree_leaves_a_clean_worktree', r['modified_after_read_tree'] == 0, name)
        check('fsck_clean_after_the_git_half', r['fsck']['returncode'] == 0, name)
        check('shipped_config_declares_no_autocrlf',
              not r['shipped_config_declares_autocrlf']
              or name == 'shipped-config-plus-false', name)
    check('autocrlf_true_converts_on_checkout',
          by['true']['identical_after_checkout'] == 0 and by['true']['cr_added_by_checkout'] > 0)
    check('autocrlf_true_converts_on_clone',
          by['true']['identical_after_clone'] == 0 and by['true']['cr_added_by_clone'] > 0)
    check('autocrlf_true_conversion_is_exactly_lf_to_crlf',
          by['true']['all_became_crlf_on_checkout'])
    for name in ('false', 'input', 'shipped-config-plus-false'):
        check('other_settings_preserve_bytes_through_checkout_and_clone',
              by[name]['identical_after_checkout'] == by[name]['documents']
              and by[name]['identical_after_clone'] == by[name]['documents'], name)

    total = sum(COUNTS.values())
    out = dict(counts=COUNTS, total=total, failures=FAILURES,
               summary=dict(
                   unpack_tools=len(e['unpack']),
                   unpack_tools_preserving_every_byte=len(preserving),
                   blobs_rewritten=f['blobs_rewritten'],
                   blob_slots=len(f['blob_rewrites']),
                   trees_rewritten=sum(r['rewritten'] for r in f['tree_rewrites']),
                   commits_rewritten=sum(r['rewritten'] for r in f['commit_rewrites']),
                   digests_identical=sum(r['identical'] for r in f['digest_equivalence']),
                   digest_entities=len(f['digest_equivalence'])))
    (HERE / 'verification.json').write_text(json.dumps(out, indent=1) + '\n', encoding='utf-8')
    print(json.dumps(dict(total=total, failures=FAILURES), indent=1))
    for k, v in sorted(COUNTS.items()):
        print('%4d  %s' % (v, k))
