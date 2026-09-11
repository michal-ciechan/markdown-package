import {markdownRenderer} from './markdown-renderer.js';
import {selectionAnchor} from '../review/selection.js';
import {makeSelector} from '../review/selector.js';
import {selectionToolbar} from './selection-toolbar.js';

export function readerView(host, onNavigate, onScope, onComment) {
  const title = document.createElement('h2');
  title.className = 'document-title';
  const controls = document.createElement('div');
  controls.className = 'reader-controls';
  const label = document.createElement('label');
  label.textContent = 'Section ';
  const sections = document.createElement('select');
  sections.setAttribute('aria-label', 'Document section');
  label.append(sections);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'View source';
  toggle.setAttribute('aria-pressed', 'false');
  const content = document.createElement('article');
  content.className = 'markdown';
  content.tabIndex = -1;
  controls.append(label, toggle);
  host.append(title, controls, content);
  let model, sourceMode = false, selected, selection;
  const toolbar = onComment ? selectionToolbar(content, {
    getModel: () => model, isSource: () => sourceMode,
    onRange: range => { selection = range; }, onComment,
  }) : undefined;
  document.addEventListener('selectionchange', () => {
    const value = document.getSelection();
    if (value?.rangeCount && !value.isCollapsed && content.contains(value.anchorNode) && content.contains(value.focusNode)) {
      selection = value.getRangeAt(0).cloneRange();
    } else if (value?.anchorNode && content.contains(value.anchorNode)) selection = undefined;
  });
  const scopeElements = new Map(), fragments = new Map();

  function draw() {
    toolbar?.reset();
    selection = undefined;
    content.replaceChildren();
    scopeElements.clear();
    fragments.clear();
    toggle.textContent = sourceMode ? 'View rendered' : 'View source';
    toggle.setAttribute('aria-pressed', String(sourceMode));
    if (!model) return;
    if (sourceMode) {
      const pre = document.createElement('pre'), code = document.createElement('code');
      code.textContent = model.text;
      pre.append(code);
      content.append(pre);
    } else {
      // Only trusted renderer markup reaches innerHTML; raw HTML is disabled.
      const template = document.createElement('template');
      template.innerHTML = markdownRenderer().render(model.ast);
      for (const link of template.content.querySelectorAll('a')) {
        const href = link.getAttribute('href');
        link.removeAttribute('href');
        if (!href || /[\u0000-\u0020\u007f]/.test(href)) continue;
        if (/^(?:https?:|mailto:)/i.test(href)) {
          link.setAttribute('href', href);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        } else if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) || href.startsWith('mdpkg:')) {
          link.setAttribute('href', '#');
          link.addEventListener('click', event => { event.preventDefault(); onNavigate(href); });
        }
      }
      content.append(template.content);
      const headings = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')];
      const slugs = new Map();
      for (const heading of headings) {
        const base = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s+/g, '-');
        const occurrence = slugs.get(base) ?? 0;
        slugs.set(base, occurrence + 1);
        const slug = base + (occurrence ? '-' + occurrence : '');
        fragments.set(slug, heading);
        const line = Number(heading.dataset.sourcepos?.split(':')[0]) - 1;
        const scope = model.scopes.find(scope => scope.kind === 'section' && scope.start === line);
        if (scope) {
          const index = model.scopes.indexOf(scope);
          heading.id = `mdpkg-section-${index}`;
          fragments.set(heading.id, heading);
          scopeElements.set(scope, heading);
        }
      }
    }
  }

  function select(scope, scroll = true) {
    toolbar?.reset();
    selected = scope;
    sections.value = String(model.scopes.indexOf(scope));
    for (const element of content.querySelectorAll('.selected-section')) element.classList.remove('selected-section');
    const element = scopeElements.get(scope) ?? content;
    element.classList.add('selected-section');
    if (scroll) element.scrollIntoView({block: 'start'});
    onScope(scope);
  }
  sections.addEventListener('change', () => select(model.scopes[Number(sections.value)]));
  toggle.addEventListener('click', () => {
    sourceMode = !sourceMode;
    draw();
    if (selected) select(selected, false);
  });
  return {
    anchor(wholeScope = false) {
      if (!model) throw new Error('Open a document first.');
      return wholeScope ? {scope: selected, select: makeSelector(model.source(selected), 0, model.source(selected).length)} :
        selectionAnchor(model, content, selection, sourceMode);
    },
    show(value, scope = value.scopes[0]) {
      model = value;
      title.textContent = value.path;
      sections.replaceChildren(...value.scopes.map((scope, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = scope.kind === 'document' ? 'Whole document' : scope.title.replace(/\n/g, ' ');
        return option;
      }));
      draw();
      select(scope, false);
    },
    select(scope) { select(scope); },
    fragment(fragment) {
      if (sourceMode) { sourceMode = false; draw(); }
      const element = fragments.get(fragment);
      if (!element) return false;
      const scope = [...scopeElements].find(([, target]) => target === element)?.[0];
      if (scope) select(scope);
      else element.scrollIntoView({block: 'start'});
      return true;
    },
    clear() { model = undefined; selected = undefined; title.textContent = ''; sections.replaceChildren(); draw(); },
  };
}
