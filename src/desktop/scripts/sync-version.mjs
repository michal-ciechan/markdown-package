// Couples the desktop app's version to the shared <Version> in
// src/generator-cli/Mdpkg.Pack.props (docs/plans/2026-09-23-phase1-execution.md section 5).
// The props file is the only place a version is edited; this script copies it into
// tauri.conf.json, Cargo.toml and the app's own Cargo.lock entry.
//
//   node scripts/sync-version.mjs           write the props version into the three files
//   node scripts/sync-version.mjs --check   write nothing; exit 1 when any file has drifted
//   node scripts/sync-version.mjs --build   write, then exit 1 if anything changed
//
// --build is beforeBuildCommand's mode. The Tauri CLI reads tauri.conf.json before it runs
// beforeBuildCommand, so a build that synchronized mid-run would bundle the old version
// into the installer while compiling the new one into the executable. Failing makes the
// developer re-run the build against the synchronized files instead.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const defaultDesktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tauri requires semver; a four-part NuGet version would be accepted by NuGet but not here.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function readPropsVersion(props) {
  const matches = [...props.matchAll(/<Version>([^<]*)<\/Version>/g)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one <Version> in Mdpkg.Pack.props, found ${matches.length}`);
  }
  const version = matches[0][1].trim();
  if (!SEMVER.test(version)) {
    throw new Error(`<Version> "${version}" is not a semantic version, which Tauri requires`);
  }
  return version;
}

// Each target finds the one version string it owns and replaces only that, so the file's
// formatting and every other "version" key (dependencies, $schema) are left alone.
const targets = [
  {
    file: 'src-tauri/tauri.conf.json',
    // Top-level keys sit at the first indent; nested objects are indented further.
    pattern: /^((?: {2}|\t)"version"\s*:\s*")([^"]*)(")/m,
    verify: (text, version) => JSON.parse(text).version === version,
  },
  {
    file: 'src-tauri/Cargo.toml',
    pattern: /(^\[package\]\r?\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*")([^"]*)(")/m,
  },
  {
    file: 'src-tauri/Cargo.lock',
    pattern: /(^\[\[package\]\]\r?\nname = "mdpkg-viewer"\r?\nversion = ")([^"]*)(")/m,
  },
];

export async function syncVersion({desktopDir = defaultDesktopDir, write = false} = {}) {
  const propsPath = path.resolve(desktopDir, '../generator-cli/Mdpkg.Pack.props');
  const version = readPropsVersion(await readFile(propsPath, 'utf8'));
  const drift = [];
  for (const target of targets) {
    const file = path.join(desktopDir, target.file);
    const text = await readFile(file, 'utf8');
    const match = text.match(target.pattern);
    if (!match) throw new Error(`${target.file}: could not find the app's version field`);
    if (match[2] === version) continue;
    drift.push({file: target.file, from: match[2], to: version});
    if (!write) continue;
    const updated = text.replace(target.pattern, `$1${version}$3`);
    if (target.verify && !target.verify(updated, version)) {
      throw new Error(`${target.file}: rewrite did not produce version ${version}`);
    }
    await writeFile(file, updated);
  }
  return {version, drift};
}

export async function main(args, desktopDir = defaultDesktopDir) {
  const known = new Set(['--check', '--build']);
  const unknown = args.filter(arg => !known.has(arg));
  if (unknown.length > 0 || args.length > 1) {
    console.error('usage: node scripts/sync-version.mjs [--check | --build]');
    return 2;
  }
  const mode = args[0] ?? '--write';
  const {version, drift} = await syncVersion({desktopDir, write: mode !== '--check'});
  if (drift.length === 0) {
    console.log(`desktop version matches Mdpkg.Pack.props (${version})`);
    return 0;
  }
  for (const {file, from, to} of drift) {
    console.log(`${mode === '--check' ? 'drift' : 'synced'}: ${file} ${from} -> ${to}`);
  }
  if (mode === '--check') {
    console.error(`desktop version differs from Mdpkg.Pack.props (${version}); ` +
      'run "node scripts/sync-version.mjs" from src/desktop and commit the result');
    return 1;
  }
  if (mode === '--build') {
    console.error(`synchronized the desktop version to ${version}; ` +
      'the Tauri CLI had already read the old one, so re-run the build');
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => { console.error(error.message); process.exitCode = 1; });
}
