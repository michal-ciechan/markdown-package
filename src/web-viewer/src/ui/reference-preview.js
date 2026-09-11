import {resolveDestination} from '../links/resolve.js';
import {markdownSurface, previewMarkup, boundedSource} from './markdown-surface.js';
import {displayFor} from '../links/display.js';

function message(result) {
  if (result.reason === 'source-changed' && result.scope) return 'Content changed since this link was copied.';
  if (result.scope) return '';
  if (result.reason === 'document-too-large') return 'Document too large to preview.';
  if (result.reason === 'unsupported-target') return 'Preview is available for Markdown documents.';
  if (result.reason === 'choose-section') return 'Choose a section. Open the document and use its section picker to copy a Markdown link.';
  if (result.category === 'resource') return 'Could not read this target. You can retry.';
  if (result.status === 'unsupported') return 'Historical preview is not available.';
  if (['deleted', 'split', 'merge'].includes(result.reason)) return `The ledger declares this target retired (${result.reason}).`;
  if (result.status === 'unconfirmed') return 'The target cannot be confirmed.';
  if (result.status === 'invalidated' || result.reason === 'invalid-destination') return 'This reference could not be resolved.';
  return 'Target not found.';
}

// One card, one in-flight lookup, and only the newest pending activation.
// Generation checks invalidate work; the queue also bounds unabortable I/O.
export function referencePreview({getPackage, onOpen, onBrowse, onOrdinary}) {
  const card = document.createElement('section'); card.id = 'reference-preview';
  card.className = 'reference-preview'; card.hidden = true;
  card.setAttribute('aria-labelledby', 'reference-preview-title');
  card.innerHTML = `<header><h2 id="reference-preview-title" tabindex="-1"></h2><button type="button" class="preview-close">Close</button></header>
    <p class="preview-status" role="status" aria-live="polite"></p><div class="preview-content markdown"></div><div class="preview-actions"></div><details><summary>Reference details</summary><p></p></details>`;
  document.body.append(card);
  const title = card.querySelector('h2'), status = card.querySelector('.preview-status');
  const content = card.querySelector('.preview-content'), actions = card.querySelector('.preview-actions');
  const details = card.querySelector('details p');
  let origin, activeLink, activeHref, generation = 0, pending, busy = false, activePackage;
  let surface;
  function clearContent() {
    surface?.abort();
    surface = undefined;
    content.replaceChildren();
  }
  function close(restore = true) {
    generation++; pending = undefined; card.hidden = true;
    origin?.setAttribute('aria-expanded', 'false'); origin?.classList.remove('preview-origin');
    if (restore && origin?.isConnected) origin.focus({preventScroll: true});
    origin = undefined; activeLink = undefined; activeHref = undefined;
    clearContent(); actions.replaceChildren(); details.textContent = ''; title.textContent = '';
    // An unabortable read keeps its single cache slot until drain settles it;
    // a newer link to that same document can then reuse the pending result.
    if (!busy) activePackage?.releasePreview?.();
    activePackage = undefined;
  }
  function position() {
    if (card.hidden) return;
    if (!origin?.isConnected) { close(false); return; }
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const rect = origin.getBoundingClientRect();
    const scale = card.getBoundingClientRect().width / card.offsetWidth || 1;
    card.style.maxWidth = `${Math.max(0, width - 16) / scale}px`;
    card.style.maxHeight = `${height / 2 / scale}px`;
    const box = card.getBoundingClientRect();
    if (width / scale <= 600) {
      card.style.left = `${(left + 8) / scale}px`; card.style.top = `${(top + height - box.height - 8) / scale}px`; return;
    }
    if (rect.bottom < top || rect.top > top + height || rect.right < left || rect.left > left + width) { close(false); return; }
    const x = rect.right + box.width + 16 <= left + width ? rect.right + 8 :
      rect.left - box.width - 8 >= left ? rect.left - box.width - 8 : rect.left;
    const y = x === rect.left ? (rect.bottom + box.height + 8 < top + height ? rect.bottom + 8 : rect.top - box.height - 8) : rect.top;
    card.style.left = `${Math.max(left + 8, Math.min(x, left + width - box.width - 8)) / scale}px`;
    card.style.top = `${Math.max(top + 8, Math.min(y, top + height - box.height - 8)) / scale}px`;
  }
  function action(label, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', callback); actions.append(button);
  }
  async function drain() {
    if (busy) return;
    busy = true;
    try {
      while (pending) {
        const request = pending; pending = undefined;
        const result = await resolveDestination(request.pkg, request.source, request.href,
          name => request.pkg.previewDocument(name));
        if (request.generation !== generation || request.pkg !== getPackage()) {
          if (!pending || pending.pkg !== request.pkg) request.pkg.releasePreview?.();
          continue;
        }
        function label(heading = result.scope?.title ?? 'Document') {
          const text = result.document ? `${result.document.path} · ${heading}` : 'Reference preview';
          title.textContent = boundedSource(text, 240) + (text.length > 240 ? '…' : '');
        }
        label();
        status.textContent = message(result);
        details.textContent = [result.category, result.status, result.reason, result.detail,
          result.successors?.length ? 'Successor roots: ' + result.successors.join(', ') : ''].filter(Boolean).join(' / ');
        clearContent(); actions.replaceChildren();
        if (result.scope) {
          try {
            const markup = previewMarkup(result.document, result.scope);
            label(displayFor(result.document).headings.find(h => h.scope === result.scope)?.title);
            if (markup.fallback) {
              const label = document.createElement('p'), pre = document.createElement('pre');
              label.textContent = markup.excerpt ? 'Canonical source excerpt' : 'Canonical source (display boundary differs)';
              pre.textContent = markup.source; content.append(label, pre);
            } else {
              surface = new AbortController();
              content.append(markdownSurface(result.document, {html: markup.html, prefix: 'preview-', onNavigate: activate, signal: surface.signal}));
            }
            if (markup.excerpt) status.textContent += ' Preview excerpt. Open the target for the full content.';
          } catch (error) { status.textContent = 'Could not render this preview. Open the target to read it.'; details.textContent += ' / ' + error.message; }
        }
        // A loose identity with no established scope never gets a guessed Open.
        if (result.scope || (result.category === 'navigation' && result.document) ||
            (result.target?.kind === 'location' && !result.target.fragment && result.reason === 'document-too-large')) {
          action(result.scope && result.scope.kind !== 'document' ? 'Open section' : 'Open document', () => {
            const from = origin; close(false); onOpen(result, from);
          });
        }
        if (!result.scope) action('Browse documents', () => { close(false); onBrowse(); });
        if (result.category === 'resource') action('Retry', () => activate(request.href, origin, request.source, false, true));
        position();
      }
    } finally { busy = false; }
  }
  function activate(href, link, source, ordinary = false, retry = false) {
    if (ordinary) { close(false); onOrdinary(href, source); return; }
    const pkg = getPackage(); if (!pkg) return;
    if (!retry && link === activeLink && href === activeHref && !card.hidden) { close(); return; }
    const nested = card.contains(link);
    if (!nested && !retry) {
      origin?.setAttribute('aria-expanded', 'false'); origin?.classList.remove('preview-origin'); origin = link;
    }
    if (!origin) return;
    activeLink = link; activeHref = href; activePackage = pkg;
    origin.setAttribute('aria-expanded', 'true'); origin.classList.add('preview-origin');
    clearContent(); actions.replaceChildren(); details.textContent = '';
    title.textContent = 'Reference preview'; status.textContent = 'Loading preview…'; card.hidden = false;
    pending = {pkg, href, source, generation: ++generation};
    position(); if (card.hidden) return;
    title.focus({preventScroll: true}); void drain();
  }
  card.querySelector('.preview-close').addEventListener('click', () => close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !card.hidden) { event.preventDefault(); close(); } });
  document.addEventListener('pointerdown', event => {
    if (!card.hidden && !card.contains(event.target) && !origin?.contains(event.target)) close(false);
  });
  document.addEventListener('focusin', event => {
    if (!card.hidden && !card.contains(event.target) && !origin?.contains(event.target)) close(false);
  });
  const observer = new MutationObserver(() => { if (origin && !origin.isConnected) close(false); });
  observer.observe(document.body, {childList: true, subtree: true});
  document.addEventListener('scroll', position, true); window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
  return {activate, close};
}
