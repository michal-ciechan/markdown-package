import {sha256} from '../address/digest.js';
import {HASH} from '../format.js';
const digests = new WeakMap();
export function sourceDigest(model) {
  if (!digests.has(model)) digests.set(model, sha256(model.text));
  return digests.get(model);
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function capturePosition(article, state) {
  const rect = article.getBoundingClientRect();
  const blocks = [...article.querySelectorAll('[data-sourcepos]')].filter(b =>
    !b.matches('.table-toolbar *, .table-toolbar') && getComputedStyle(b).display !== 'inline');
  const block = blocks.filter(b => { const r = b.getBoundingClientRect(); return r.top <= 0 && r.bottom > 0; })
    .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top).at(0) ??
    blocks.find(b => b.getBoundingClientRect().top >= 0);
  const pre = state.sourceMode && article.querySelector('pre');
  return {documentPath: state.path, locator: state.locator, sourceMode: state.sourceMode,
    anchor: block?.dataset.sourcepos, offset: block ? -block.getBoundingClientRect().top : -rect.top,
    fraction: clamp(-rect.top / Math.max(1, rect.height), 0, 1), sourceLeft: pre?.scrollLeft ?? 0};
}
export async function restorePosition(article, reader, model, saved, current) {
  if (!HASH.test(saved.digest) || typeof saved.sourceMode !== 'boolean' || !Number.isFinite(saved.offset) ||
      !Number.isFinite(saved.fraction) || saved.fraction < 0 || saved.fraction > 1 ||
      !Array.isArray(saved.locator) || (saved.anchor !== undefined && typeof saved.anchor !== 'string'))
    throw new Error('Saved position is invalid.');
  if (saved.digest !== await sourceDigest(model)) {
    if (current()) { reader.resumeMode(false); article.scrollIntoView({block: 'start'}); }
    return 'Source changed; exact reading position was not restored.';
  }
  if (!current()) return;
  reader.resumeMode(saved.sourceMode === true);
  const scope = saved.locator && model.find(saved.locator);
  if (scope) reader.select(scope, false);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!current()) return;
  const block = saved.anchor && [...article.querySelectorAll('[data-sourcepos]')].find(b => b.dataset.sourcepos === saved.anchor);
  const rect = article.getBoundingClientRect();
  const target = block ?? (saved.sourceMode ? article.querySelector('pre') : undefined);
  let y;
  if (target) y = scrollY + target.getBoundingClientRect().top + clamp(saved.offset ?? 0, -innerHeight, target.getBoundingClientRect().height);
  else if (scope && saved.locator?.[0] !== 'document') { reader.select(scope); return; }
  else y = scrollY + rect.top + clamp(saved.fraction ?? 0, 0, 1) * rect.height;
  window.scrollTo(0, clamp(y, 0, Math.max(0, document.scrollingElement.scrollHeight - innerHeight)));
  if (saved.sourceMode) article.querySelector('pre').scrollLeft = Math.max(0, saved.sourceLeft ?? 0);
}
