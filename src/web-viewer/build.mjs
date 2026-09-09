// Production build and slice-0 gates, using the investigation's esbuild/gzip
// method. The isolated git-read measurement is never a deployable app asset.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build, version as esbuildVersion} from 'esbuild';

const root = await fs.realpath(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, 'dist');
const evidenceDir = path.join(root, '../../docs/investigations/viewer-app');
const slash = value => value.replace(/\\/g, '/');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const measure = bytes => ({bytes: bytes.length, gzip_bytes: gzipSync(bytes, {level: 9}).length,
  sha256: createHash('sha256').update(bytes).digest('hex')});
const dependencies = ['buffer', 'commonmark', 'fflate', 'isomorphic-git', 'esbuild'];

// Plan §4 fixes both components of each milestone's ceiling. Library baselines
// use bundle-results.json's commonmark-parse-render (48,014), git-read (53,773)
// and git-write-review (52,363) rows. Owned reader/writer code belongs solely
// to the app allowance; M5/M6 retain the independent Git-slice upper bound.
// Later milestones must be selected deliberately, not inferred from size.
const LIBRARY_BUDGETS = {M1: 48014, M2: 48014, M3: 101787, M4: 101787, M5: 154150, M6: 154150};
const APP_BUDGETS = {M1: 12 * 1024, M2: 16 * 1024, M3: 24 * 1024,
  M4: 32 * 1024, M5: 40 * 1024, M6: 48 * 1024};
const options = {milestone: 'M2', report: false};
for (const arg of process.argv.slice(2)) {
  if (arg === '--report') options.report = true;
  else if (/^--milestone=M[1-6]$/.test(arg)) options.milestone = arg.slice('--milestone='.length);
  else throw new Error(`Unknown build option: ${arg}. Use --report or --milestone=M1…M6.`);
}

async function cleanDist() {
  // Resolve and check the actual target before recursive deletion, including
  // Windows junctions. Never follow a redirected dist directory out of src/web-viewer/.
  const stat = await fs.lstat(outdir).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat) {
    if (stat.isSymbolicLink() || path.relative(root, await fs.realpath(outdir)) !== 'dist') {
      throw new Error(`Refusing to clean a redirected output directory: ${outdir}`);
    }
    await fs.rm(outdir, {recursive: true, force: true});
  }
}

function staticClosure(start, records) {
  const reached = new Set();
  function visit(file) {
    if (reached.has(file)) return;
    const record = records.get(file);
    if (!record) throw new Error(`Unresolved internal chunk in build graph: ${file}`);
    reached.add(file);
    for (const imported of record.imports ?? []) {
      if (!imported.external && imported.kind !== 'dynamic-import') visit(slash(imported.path));
    }
    if (record.cssBundle) visit(slash(record.cssBundle));
  }
  for (const file of start) visit(file);
  return reached;
}

async function run() {
  await cleanDist();
  const [manifest, investigation, baseline] = await Promise.all([
    readJson(path.join(root, 'package.json')),
    readJson(path.join(evidenceDir, 'package.json')),
    readJson(path.join(evidenceDir, 'bundle-results.json')),
  ]);
  const declared = {...manifest.dependencies, ...manifest.devDependencies};
  const versions = {}, versionChecks = [];
  for (const name of dependencies) {
    const installed = (await readJson(path.join(root, 'node_modules', name, 'package.json'))).version;
    const expected = investigation.dependencies[name];
    const recorded = name === 'esbuild' ? baseline.esbuild : baseline.versions[name];
    versions[name] = installed;
    versionChecks.push({name, declared: declared[name], installed, expected, recorded,
      passed: !!expected && declared[name] === expected && installed === expected && recorded === expected});
  }
  const failures = versionChecks.filter(check => !check.passed).map(check =>
    `V-1 ${check.name}: expected ${check.expected}; declared ${check.declared}, installed ${check.installed}, evidence ${check.recorded}`);
  if (esbuildVersion !== versions.esbuild) failures.push('V-1 loaded esbuild differs from its installed package version');
  const common = {absWorkingDir: root, bundle: true, minify: true, format: 'esm',
    platform: 'browser', target: 'es2020', metafile: true, write: false};

  const result = await build({...common, entryPoints: ['src/main.js'], outdir, splitting: true});
  // V-1: same exports, direct ESM input and Buffer injection as build_web.mjs.
  // A virtual shim keeps all calibration artifacts out of dist and the source tree.
  const calibration = await build({...common,
    stdin: {contents: "export { log, readBlob } from './node_modules/isomorphic-git/index.js';\n",
      resolveDir: root, sourcefile: 'git-read-entry.js'},
    inject: ['v1-buffer-shim'],
    plugins: [{name: 'v1-buffer-shim', setup(builder) {
      builder.onResolve({filter: /^v1-buffer-shim$/}, () => ({path: 'buffer-shim.js', namespace: 'v1'}));
      builder.onLoad({filter: /.*/, namespace: 'v1'}, () => ({
        contents: "export { Buffer } from './node_modules/buffer/index.js';\n", resolveDir: root,
      }));
    }}],
  });
  const expected = baseline.assets.find(asset => asset.name === 'git-read');
  if (!expected) throw new Error('V-1 git-read baseline is absent from bundle-results.json');
  const actual = measure(calibration.outputFiles[0].contents);
  const differences = ['bytes', 'gzip_bytes', 'sha256'].filter(key => actual[key] !== expected[key]);
  if (differences.length) failures.push('V-1 git-read differs from bundle-results.json: ' +
    differences.map(key => `${key} ${actual[key]} (expected ${expected[key]})`).join(', '));

  const outputs = new Map(Object.entries(result.metafile.outputs).map(([file, meta]) => [slash(file), meta]));
  const chunks = result.outputFiles.map(file => {
    const name = slash(path.relative(root, file.path)), meta = outputs.get(name);
    return {file: name, ...measure(file.contents), entryPoint: meta.entryPoint,
      inputs: Object.entries(meta.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([name]) => slash(name)),
      imports: meta.imports.map(imported => ({...imported, path: slash(imported.path)})),
      ...(meta.cssBundle ? {cssBundle: slash(meta.cssBundle)} : {})};
  });
  const main = chunks.find(chunk => slash(chunk.entryPoint ?? '') === 'src/main.js' && chunk.file.endsWith('.js'));
  if (!main) throw new Error('V-2 cannot find the main application entry point');
  const boot = staticClosure([main.file], outputs);
  const isGit = input => /(?:^|\/)node_modules\/isomorphic-git\//.test(input);
  const gitChunks = chunks.filter(chunk => chunk.inputs.some(isGit));
  const eagerGit = gitChunks.filter(chunk => boot.has(chunk.file));
  if (eagerGit.length) failures.push('V-2 / R-8 isomorphic-git is in the eager graph: ' + eagerGit.map(chunk => chunk.file).join(', '));

  // Locate the source-level dynamic imports whose target's static dependency
  // graph includes Git. Counting output edges alone can hide duplicate sites.
  const inputs = new Map(Object.entries(result.metafile.inputs).map(([file, meta]) => [slash(file), meta]));
  const gitImportSites = [];
  for (const [from, meta] of inputs) for (const imported of meta.imports) {
    if (imported.kind !== 'dynamic-import' || imported.external) continue;
    const target = slash(imported.path);
    if ([...staticClosure([target], inputs)].some(isGit)) gitImportSites.push({from, to: target});
  }
  const bootInputs = new Set(chunks.filter(chunk => boot.has(chunk.file)).flatMap(chunk => chunk.inputs));
  const components = {
    commonmark: [...bootInputs].some(input => /(?:^|\/)node_modules\/commonmark\//.test(input)),
    reader: bootInputs.has('src/container/reader.js'),
    historyDescriptor: bootInputs.has('src/history/descriptor.js'),
  };
  if (!components.commonmark || !components.reader) failures.push('V-2 eager graph must include CommonMark and the container reader');
  const historyRequired = Number(options.milestone.slice(1)) >= 3;
  if (historyRequired && (!components.historyDescriptor || !gitChunks.length)) {
    failures.push('V-2 M3+ requires an eager history descriptor and a separate Git chunk');
  }
  if (gitChunks.length) {
    if (gitImportSites.length !== 1) {
      failures.push(`V-2 / R-8 Git must have exactly one dynamic import site; found ${gitImportSites.length}`);
    } else if (!bootInputs.has(gitImportSites[0].from)) {
      failures.push(`V-2 / R-8 Git dynamic import site is outside the eager graph: ${gitImportSites[0].from} -> ${gitImportSites[0].to}`);
    }
  }

  // Git remains a separate chunk, but D-3 requires loading it on package open.
  // Include that closure in the transfer budget whenever it is shipped.
  const onOpenRoots = chunks.flatMap(chunk => chunk.imports.filter(imported =>
    !imported.external && imported.kind === 'dynamic-import' &&
    [...staticClosure([imported.path], outputs)].some(file => gitChunks.some(git => git.file === file)))
    .map(imported => imported.path));
  const eager = staticClosure([main.file, ...onOpenRoots], outputs);
  const eagerChunks = chunks.filter(chunk => eager.has(chunk.file));
  const eagerBytes = eagerChunks.reduce((total, chunk) => total + chunk.gzip_bytes, 0);
  const libraryBudget = LIBRARY_BUDGETS[options.milestone], appBudget = APP_BUDGETS[options.milestone];
  const budget = libraryBudget + appBudget;
  if (eagerBytes > budget) failures.push(`V-2 ${options.milestone} eager gzip ${eagerBytes} exceeds ${budget} bytes: ` +
    eagerChunks.map(chunk => `${chunk.file} (${chunk.gzip_bytes})`).join(', '));

  // dist/ is the deployable root on its own. A GitHub Pages project site is
  // served from /<repo>/, so the published page keeps every asset path
  // relative and drops the ./dist/ prefix that only src/web-viewer/ as the root needs.
  const page = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const deployPage = page.replaceAll('"./dist/', '"./');
  const assetPaths = [...deployPage.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(match => match[1]);
  const nonRelative = assetPaths.filter(value => value.startsWith('/') || value.includes('dist/'));
  if (nonRelative.length) failures.push('D-1 published index.html needs subpath-safe relative asset paths: ' + nonRelative.join(', '));

  const report = {
    node: process.version, esbuild: esbuildVersion, versions, chunks,
    v1: {passed: versionChecks.every(check => check.passed) && !differences.length && esbuildVersion === versions.esbuild,
      dependencies: versionChecks,
      gitRead: {name: 'git-read', ...actual, expected: {bytes: expected.bytes, gzip_bytes: expected.gzip_bytes, sha256: expected.sha256}, differences}},
    deploy: {passed: !nonRelative.length, page: 'index.html', assetPaths},
    v2: {passed: !failures.some(failure => failure.startsWith('V-2')), milestone: options.milestone,
      library_budget_gzip_bytes: libraryBudget, app_budget_gzip_bytes: appBudget,
      budget_gzip_bytes: budget, eager_gzip_bytes: eagerBytes,
      bootChunks: [...boot], eagerOnOpenChunks: [...eager], components,
      gitChunks: gitChunks.map(chunk => chunk.file), gitImportSites,
      historyRequired},
    passed: !failures.length, failures,
  };
  await fs.mkdir(outdir, {recursive: true});
  // A failed gate leaves its report but no deployable bundle, and never leaves
  // a previous build looking like the output of this failed invocation.
  if (!failures.length) {
    for (const file of result.outputFiles) await fs.writeFile(file.path, file.contents);
    await fs.writeFile(path.join(outdir, 'index.html'), deployPage);
  }
  await fs.writeFile(path.join(outdir, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (options.report) console.log(JSON.stringify(report, null, 2));
  else {
    console.table(chunks.map(({file, bytes, gzip_bytes}) => ({file, bytes, gzip_bytes})));
    console.log(`V-1 ${report.v1.passed ? 'passed' : 'failed'}; V-2 ${report.v2.passed ? 'passed' : 'failed'}: ${eagerBytes}/${budget} eager gzip bytes (${options.milestone}).`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  }
}

await run();
