import {markdownRenderer} from './markdown-renderer.js';
import {tableControls} from './table-controls.js';
import {displayFor} from '../links/display.js';
import {destination} from '../links/destination.js';

export function bindLinks(host, source, onNavigate) {
  for (const link of host.querySelectorAll('a')) {
    const href = link.getAttribute('href'); link.removeAttribute('href');
    if (href === null || /[\u0000-\u001f\u007f]/.test(href)) continue;
    if (/^(?:https?:|mailto:)/i.test(href)) {
      link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; continue;
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) && !href.startsWith('mdpkg:')) continue;
    let ordinary = false;
    try { ordinary = destination(source, href).kind === 'ordinary'; } catch { /* disclose the lookup error */ }
    link.href = '#';
    if (!ordinary) {
      link.setAttribute('role', 'button'); link.setAttribute('aria-expanded', 'false');
      link.setAttribute('aria-controls', 'reference-preview'); link.setAttribute('aria-description', 'Preview');
      link.classList.add('preview-link');
    }
    let pointer;
    link.addEventListener('pointerdown', event => { pointer = {x: event.clientX, y: event.clientY}; });
    link.addEventListener('click', event => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.detail > 1 ||
          (pointer && event.detail && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) ||
          (event.detail && !document.getSelection()?.isCollapsed &&
            (link.contains(document.getSelection().anchorNode) || link.contains(document.getSelection().focusNode)))) return;
      onNavigate(href, link, source, ordinary);
    });
    if (!ordinary) link.addEventListener('keydown', event => {
      if (event.key === ' ') { event.preventDefault(); if (!event.repeat) onNavigate(href, link, source, false); }
    });
  }
}

export function markdownSurface(model, {html, onNavigate, states = new Map(), prefix = ''} = {}) {
  const template = document.createElement('template');
  template.innerHTML = html ?? markdownRenderer().render(displayFor(model).ast);
  tableControls(template.content, states, model);
  if (onNavigate) bindLinks(template.content, model.path, onNavigate);
  const display = displayFor(model);
  const headings = new Map(display.headings.map(h => [h.node.sourcepos[0][0], h]));
  for (const heading of template.content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const line = Number(heading.dataset.sourcepos?.split(':')[0]);
    const item = headings.get(line);
    if (item?.scope) heading.id = `${prefix}mdpkg-section-${item.index}`;
  }
  return template.content;
}

export const PREVIEW_UNITS = 16000;
export function boundedSource(text, limit = PREVIEW_UNITS) {
  let end = Math.min(limit, text.length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}

export function previewMarkup(model, scope) {
  const {ast, headings} = displayFor(model), source = model.source(scope);
  const fallback = () => ({source: boundedSource(source), excerpt: source.length > PREVIEW_UNITS, fallback: true});
  if (scope.kind === 'section' && !headings.some(h => h.scope === scope)) return fallback();
  const blocks = [];
  let units = 0, excerpt = false;
  for (let node = ast.firstChild; node; node = node.next) {
    const start = node.sourcepos[0][0] - 1, end = node.sourcepos[1][0];
    if (end <= scope.start || start >= scope.end) continue;
    if (start < scope.start || end > scope.end) return fallback();
    const size = model.lines.slice(start, end).join('\n').length + 1;
    if (units + size > PREVIEW_UNITS) { if (!blocks.length) return fallback(); excerpt = true; break; }
    units += size; blocks.push(markdownRenderer().render(node));
  }
  return {html: blocks.join(''), excerpt};
}
