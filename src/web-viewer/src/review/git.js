import {init, writeBlob, writeTree, writeCommit, packObjects, indexPack} from 'isomorphic-git';
import {memoryFs} from './memory-fs.js';

export async function reviewRepository(bytes, timestamp) {
  const fs = memoryFs(), dir = '/review';
  await init({fs, dir, defaultBranch: 'main'});
  const blob = await writeBlob({fs, dir, blob: bytes});
  const tree = async (path, oid, type) => writeTree({fs, dir,
    tree: [{mode: type === 'blob' ? '100644' : '040000', path, oid, type}]});
  const review = await tree('comments.json', blob, 'blob');
  const mdpkg = await tree('review', review, 'tree');
  const root = await tree('.mdpkg', mdpkg, 'tree');
  // Comment authors stay in comments.json; a fixed producer identity avoids
  // treating free-form author labels as Git header syntax or authentication.
  const author = {name: 'Markdown Package Reviewer', email: 'reviewer@example.invalid', timestamp, timezoneOffset: 0};
  const commit = await writeCommit({fs, dir, commit: {tree: root, parent: [], author, committer: author, message: 'Review snapshot\n'}});
  const {packfile, filename} = await packObjects({fs, dir, oids: [commit, root, mdpkg, review, blob]});
  const filepath = '.git/objects/pack/' + filename;
  await fs.promises.writeFile(dir + '/' + filepath, packfile);
  await indexPack({fs, dir, filepath});
  const index = await fs.promises.readFile(dir + '/' + filepath.replace(/\.pack$/, '.idx'));
  return {commit, pack: new Uint8Array(packfile), index, stem: filename.replace(/\.pack$/, '')};
}
