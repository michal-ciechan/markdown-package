import {canonicalJson, utf8, UUID} from '../format.js';
import {sha256} from '../address/digest.js';
import {referenceFor} from '../address/resolve.js';
import {parseReference, decodeLocator} from '../address/reference.js';
import {makeSelector} from '../review/selector.js';
import {validateAnchors} from '../review/comments.js';
import {sourceDigest} from './position.js';

export const packageKey = manifest => canonicalJson([manifest.mdpkg, manifest.namespace,
  manifest.current, manifest.addressing.anchor, manifest.addressing.digest]);
export const databaseName = base => 'mdpkg-viewer:' + new URL('.', base).pathname;
export function recoveryText(value) {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text || text.length <= 12 * 1024 * 1024) return text ?? '';
  } catch { /* A malformed cyclic/deep record must not prevent opening a package. */ }
  return typeof value?.body === 'string' && value.body.length <= 256 * 1024 ? value.body :
    'This saved record cannot be displayed safely. It was retained in browser storage.';
}
export function envelope(value, maximum = 12 * 1024 * 1024) {
  if (!value || value.version !== 1 || utf8.encode(JSON.stringify(value)).length > maximum)
    throw new Error('Saved data has an unsupported version, invalid structure or exceeds its size limit.');
  return value;
}
export function validateDraft(draft) {
  envelope(draft, 8 * 1024 * 1024);
  if (!UUID.test(draft.namespace) || typeof draft.author !== 'string' || draft.author.length > 200 ||
      !['comment', 'change-request'].includes(draft.kind) || typeof draft.body !== 'string' ||
      utf8.encode(draft.body).length > 256 * 1024 || !Array.isArray(draft.target) ||
      (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 0)))
    throw new Error('Saved editor is invalid or too large. Copy its text for recovery.');
  return draft;
}
export async function encodeDraft(pkg, namespace, draft) {
  if (!draft) return undefined;
  const {context, author, kind, body} = draft;
  let target;
  if (context.thread) target = ['reply', namespace, context.thread.id, context.inReplyTo];
  else {
    const ref = parseReference(await referenceFor(pkg, context.model, context.anchor.scope));
    target = ['new', context.model.path, ref.loc, ref.root, ref.expect, context.anchor.select];
  }
  const result = validateDraft({version: 1, namespace, target: structuredClone(target), author, kind, body});
  const model = context.model ?? await pkg.document(decodeLocator(context.thread.loc)[1]);
  return {...result, targetKey: await sha256(canonicalJson(target)), documentDigest: await sourceDigest(model)};
}
export async function decodeDraft(pkg, draft, review, namespace) {
  validateDraft(draft);
  if (draft.namespace !== namespace || await sha256(canonicalJson(draft.target)) !== draft.targetKey)
    throw new Error('Saved editor target or review session does not match.');
  const t = draft.target;
  if (t[0] === 'reply') {
    const thread = review.threads.find(thread => thread.id === t[2]);
    if (t.length !== 4 || t[1] !== namespace || !thread?.comments.some(c => c.id === t[3]))
      throw new Error('The saved reply parent is missing.');
    if (draft.documentDigest !== await sourceDigest(await pkg.document(decodeLocator(thread.loc)[1]))) throw new Error('The saved draft document has changed.');
    return {path: decodeLocator(thread.loc)[1], context: {thread, inReplyTo: t[3]}};
  }
  if (t[0] !== 'new' || t.length !== 6 || decodeLocator(t[2])[1] !== t[1]) throw new Error('Invalid saved target.');
  const model = await pkg.document(t[1]), scope = model.find(decodeLocator(t[2]));
  if (draft.documentDigest !== await sourceDigest(model)) throw new Error('The saved draft document has changed.');
  if (!scope) throw new Error('The saved scope is missing.');
  const ref = parseReference(await referenceFor(pkg, model, scope));
  if (ref.loc !== t[2] || ref.root !== t[3] || ref.expect !== t[4] ||
      canonicalJson(makeSelector(model.source(scope), t[5].start, t[5].end)) !== canonicalJson(t[5]))
    throw new Error('The saved quote or source has changed.');
  return {path: model.path, context: {model, anchor: {scope, select: structuredClone(t[5])}}};
}
export async function validateReview(saved, pkg) {
  envelope(saved);
  if (!UUID.test(saved.namespace) || !Number.isSafeInteger(saved.revision) || saved.revision < 0)
    throw new Error('Invalid saved review session.');
  await validateAnchors(saved.review, pkg);
  for (const path of new Set(saved.review.threads.map(t => decodeLocator(t.loc)[1])))
    if (saved.sourceDigests?.[path] !== await sourceDigest(await pkg.document(path))) throw new Error('A saved review document has changed.');
  return saved;
}

// Both timers belong to one burst; continuous input cannot postpone maxWait.
export function debounce(callback, delay, maxWait, timers = globalThis) {
  let trailing, maximum, pending = false;
  const cancel = () => { timers.clearTimeout(trailing); timers.clearTimeout(maximum); trailing = maximum = undefined; pending = false; };
  const flush = () => { if (!pending) return; cancel(); return callback(); };
  return {schedule() {
    pending = true; timers.clearTimeout(trailing);
    trailing = timers.setTimeout(flush, delay);
    maximum ??= timers.setTimeout(flush, maxWait);
  }, flush, cancel};
}
