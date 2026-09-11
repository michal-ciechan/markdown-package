import {markdownSurface} from './markdown-surface.js';
import {displayFor} from '../links/display.js';
import {selectionAnchor} from '../review/selection.js';
import {makeSelector} from '../review/selector.js';
import {selectionToolbar} from './selection-toolbar.js';

export function readerView(host, onNavigate, onScope, onComment, onChange = () => {}) {
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
  const tableStates = new Map();
  let surface;

  function draw() {
    onChange();
    toolbar?.reset();
    selection = undefined;
    surface?.abort();
    surface = undefined;
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
      surface = new AbortController();
      content.append(markdownSurface(model, {onNavigate, states: tableStates, signal: surface.signal}));
      const display = displayFor(model);
      const headings = new Map([...content.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h =>
        [Number(h.dataset.sourcepos?.split(':')[0]), h]));
      for (const [fragment, candidates] of display.fragments) {
        if (candidates.length !== 1) continue;
        const item = candidates[0];
        const heading = headings.get(item.node.sourcepos[0][0]);
        if (heading) fragments.set(fragment, heading);
        if (heading && item.scope) scopeElements.set(item.scope, heading);
      }
    }
  }

  function select(scope, scroll = true) {
    toolbar?.reset();
    if (scroll) {
      const live = document.getSelection();
      if (live?.rangeCount && (content.contains(live.anchorNode) || content.contains(live.focusNode))) live.removeAllRanges();
      selection = undefined;
    }
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
      const live = document.getSelection();
      if (!wholeScope && live?.rangeCount && !live.isCollapsed &&
          (!content.contains(live.anchorNode) || !content.contains(live.focusNode))) {
        throw new Error('Open section before reviewing preview text.');
      }
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
    select(scope, scroll = true) { select(scope, scroll); },
    capture(origin) { return {path: model?.path, locator: selected?.locator, sourceMode, scrollX, scrollY,
      linkIndex: [...content.querySelectorAll('a')].indexOf(origin)}; },
    restore(state) {
      if (sourceMode !== state.sourceMode) { sourceMode = state.sourceMode; draw(); }
      const scope = state.locator && model.find(state.locator);
      if (scope) select(scope, false);
      window.scrollTo(state.scrollX, state.scrollY);
      (content.querySelectorAll('a')[state.linkIndex] ?? content).focus({preventScroll: true});
    },
    fragment(fragment) {
      if (sourceMode) { sourceMode = false; draw(); }
      const element = fragments.get(fragment);
      if (!element) return false;
      const scope = [...scopeElements].find(([, target]) => target === element)?.[0];
      if (scope) select(scope);
      else element.scrollIntoView({block: 'start'});
      return true;
    },
    clear() { model = undefined; selected = undefined; tableStates.clear(); title.textContent = ''; sections.replaceChildren(); draw(); },
  };
}
