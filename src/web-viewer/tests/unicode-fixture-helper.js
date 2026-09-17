// CARD-0058 / issue #3 regression support: pack a Unicode fixture with the real
// mdpkg CLI so tests can prove its bytes survive packing and browser rendering.
// Every non-ASCII character is spelled as an escape so the test itself cannot be
// corrupted by an editor or checkout re-encoding this file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cliRoot = fileURLToPath(new URL('../../generator-cli/', import.meta.url));
const cli = path.join(cliRoot, 'artifacts', 'bin', 'Mdpkg.Cli', 'release', 'mdpkg.dll');
export const namespace = 'c1b2d3e4-5f60-4a71-8b92-a3b4c5d6e7f8';
export const entryName = 'unicode.md';
// Code point, visible form and the exact UTF-8 bytes the fixture must contain.
export const characters = [
  {name: 'em dash', text: '—', bytes: [0xe2, 0x80, 0x94]},          // —
  {name: 'minus sign', text: '−', bytes: [0xe2, 0x88, 0x92]},       // −
  {name: 'grinning face', text: '\u{1F600}', bytes: [0xf0, 0x9f, 0x98, 0x80]}, // 😀
  {name: 'check mark button', text: '✅', bytes: [0xe2, 0x9c, 0x85]}, // ✅
  {name: 'e acute', text: 'é', bytes: [0xc3, 0xa9]},                // é
  {name: 'i diaeresis', text: 'ï', bytes: [0xc3, 0xaf]},            // ï
  {name: 'nihongo', text: '日本語', bytes: [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e]}, // 日本語
];
const [dash, minus, grin, check, eAcute, iDiaeresis, nihongo] = characters.map(c => c.text);
export const heading = 'Unicode round trip';
// The first paragraph is the line quoted in issue #3.
export const paragraphs = [
  `poll ${dash} not the greatest. Next request starts \`watermark ${minus} 10 s\`. ${grin} ${check}`,
  `Accents: caf${eAcute}, na${iDiaeresis}ve. Non-Latin: ${nihongo}.`,
];
export const text = `# ${heading}\n\n${paragraphs.join('\n\n')}\n`;
// Rendered paragraph text: the code span keeps its text and loses its backticks.
export const rendered = paragraphs.map(p => p.replaceAll('`', ''));
// Signatures of the source UTF-8 decoded with CP850 (the issue), CP437 or CP1252,
// plus the replacement character a strict decoder would emit.
export const mojibake = ['ÔÇö', 'ÔêÆ', 'ΓÇö', 'ΓêÆ',
  'â€”', 'âˆ’', '├®', '�'];

function dotnet(args, cwd) {
  try {
    return execFileSync('dotnet', args, {cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024});
  } catch (error) {
    throw new Error(`dotnet ${args.join(' ')} failed (${error.status ?? error.code}):\n${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  }
}
let built = false;
// Builds the CLI from the current source once per process; a stale binary would
// prove nothing about the checked-out producer.
export function buildCli() {
  if (!built) { dotnet(['build', '-c', 'Release', '--nologo', '-v', 'q'], cliRoot); built = true; }
  return cli;
}
// Writes the fixture as UTF-8 without BOM with LF line endings, packs it with the
// actual CLI and returns the source bytes and the package path for the callers.
export async function packFixture() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'mdpkg-unicode-'));
  const source = path.join(work, 'source');
  await fs.mkdir(source);
  const sourceBytes = Buffer.from(text, 'utf8');
  await fs.writeFile(path.join(source, entryName), sourceBytes);
  const output = path.join(work, 'unicode.mdpkg');
  const report = JSON.parse(dotnet([buildCli(), 'pack', source, '--out', output, '--namespace', namespace, '--format', 'json'], cliRoot));
  return {work, sourceBytes, output, report, cleanup: () => fs.rm(work, {recursive: true, force: true})};
}
