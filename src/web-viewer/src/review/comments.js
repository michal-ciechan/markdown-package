import {ANCHOR, DIGEST, UUID, HASH, utf8, decode, canonicalJson, parseCanonicalJson} from '../format.js';
import {decodeLocator, validateLocator, parseReference} from '../address/reference.js';
import {referenceFor} from '../address/resolve.js';
import {makeSelector} from './selector.js';

export const DETAIL = '.mdpkg/review/comments.json';
export const SELECTOR = 'cm0312-quote-context-v1';
export const newReview = () => ({version: 2, anchor: ANCHOR, profile: DIGEST, selector: SELECTOR, threads: []});
const text = value => typeof value === 'string' && decode(utf8.encode(value)) === value;

export function newComment(author, kind, body, inReplyTo) {
  return {id: crypto.randomUUID(), at: new Date().toISOString(), author, kind,
    body: body.replace(/\r\n?/g, '\n'), ...(inReplyTo ? {inReplyTo} : {})};
}

export async function newThread(pkg, model, anchor, comment) {
  const ref = parseReference(await referenceFor(pkg, model, anchor.scope));
  return {id: crypto.randomUUID(), root: ref.root, loc: ref.loc, expect: ref.expect,
    state: 'open', select: anchor.select, comments: [comment]};
}

export function validateComments(value, {reading = false} = {}) {
  const fail = message => { throw new Error('Invalid review: ' + message); };
  if (!(value?.version === 2 || reading && value?.version === 1) || value.anchor !== ANCHOR || value.profile !== DIGEST || value.selector !== SELECTOR ||
      !Array.isArray(value.threads)) fail('unsupported comments document');
  if (value.threads.length > 5000) fail('too many threads (maximum 5,000)');
  const ids = new Set();
  const unique = id => { if (typeof id !== 'string' || !UUID.test(id) || ids.has(id)) fail('invalid or duplicate ID'); ids.add(id); };
  let count = 0;
  for (const thread of value.threads) {
    unique(thread.id);
    if (typeof thread.root !== 'string' || typeof thread.expect !== 'string' || !HASH.test(thread.root) || !HASH.test(thread.expect) || !['open', 'resolved', 'obsolete'].includes(thread.state)) fail('thread anchor or state');
    validateLocator(decodeLocator(thread.loc));
    const s = thread.select;
    if (!s || !Number.isSafeInteger(s.start) || !Number.isSafeInteger(s.end) || s.start < 0 || s.end <= s.start ||
        !text(s.quote) || s.quote.length !== s.end - s.start || !Number.isSafeInteger(s.occurrence) || s.occurrence < 0 ||
        !text(s.prefix) || !text(s.suffix) || s.prefix.length > 40 || s.suffix.length > 40) fail('selector');
    if (!Array.isArray(thread.comments) || !thread.comments.length) fail('empty thread');
    const siblings = new Map(thread.comments.map(comment => [comment.id, comment]));
    for (const comment of thread.comments) {
      unique(comment.id);
      if (++count > 20000) fail('too many comments (maximum 20,000)');
      if ((value.version === 2 ? !['comment', 'change-request'].includes(comment.kind) : comment.kind !== undefined) || !text(comment.author) || !text(comment.body) || !comment.body.length ||
          utf8.encode(comment.body).length > 65536) fail('comment kind, author or body (maximum 64 KiB)');
      // Read RFC 3339, including the S1 seconds-only fixtures. Authoring still
      // emits ISO timestamps with milliseconds; reject normalized invalid dates.
      const date = typeof comment.at === 'string' && /^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(comment.at);
      if (!date || +date[1] === 0 || +date[2] < 1 || +date[2] > 12 || +date[3] < 1 ||
          +date[3] > new Date(Date.UTC(+date[1], +date[2], 0)).getUTCDate() || !Number.isFinite(Date.parse(comment.at))) fail('timestamp');
      const visited = new Set([comment.id]);
      for (let next = comment.inReplyTo; next !== undefined; next = siblings.get(next).inReplyTo) {
        if (!siblings.has(next) || visited.has(next)) fail('dangling, cross-thread or cyclic reply');
        visited.add(next);
      }
    }
  }
  if (utf8.encode(canonicalJson(value)).length > 8 * 1024 * 1024) fail('comments exceed 8 MiB');
  return value;
}

export async function validateAnchors(value, pkg) {
  validateComments(value);
  for (const thread of value.threads) {
    const locator = decodeLocator(thread.loc), model = await pkg.document(locator[1]), scope = model.find(locator);
    if (!scope) throw new Error('Review scope is no longer available.');
    const ref = parseReference(await referenceFor(pkg, model, scope));
    if (thread.root !== ref.root || thread.expect !== ref.expect || thread.loc !== ref.loc) throw new Error('Review anchor does not match the opened package.');
    const expected = makeSelector(model.source(scope), thread.select.start, thread.select.end);
    if (canonicalJson(expected) !== canonicalJson(thread.select)) throw new Error('Review quote or context does not match its source.');
  }
}

export const readComments = bytes => validateComments(parseCanonicalJson(bytes), {reading: true});
