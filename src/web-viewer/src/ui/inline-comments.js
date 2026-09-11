import {commentInterval, commentAnchor} from './comment-anchor.js';
import {scopeOffset} from '../review/selector.js';

const kind = thread => thread.comments[0]?.kind === 'change-request' ? 'change' : 'comment';
const label = thread => kind(thread) === 'change' ? 'Change request' : 'Comment';
const button = (text, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); return b; };
function icon(node, thread) {
  const span = document.createElement('span');
  span.innerHTML = `<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${kind(thread) === 'change' ? 'M11 4H3v13h13V9M8 12l1-4 7-6 3 3-7 6-4 1Z' : 'M3 3h14v11H8l-5 3V3ZM6 7h8M6 10h5'}"/></svg>`;
  node.prepend(span);
}

export function inlineComments(host, reader, reviews) {
  const bar = document.createElement('div'); bar.className = 'inline-controls';
  const mode = button('Read', () => { reading = !reading; update(); });
  mode.setAttribute('aria-label', 'Read without comments'); mode.setAttribute('aria-pressed', 'false');
  const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Filter threads');
  for (const state of ['all', 'open', 'resolved', 'obsolete']) filter.add(new Option(state === 'all' ? 'All threads' : state, state));
  filter.addEventListener('change', () => update());
  bar.append(mode, filter, button('Collapse folds', () => { active.clear(); update(); }));
  host.insertBefore(bar, host.querySelector('article'));
  const layer = document.createElement('div'); layer.className = 'inline-layer'; host.append(layer);
  // Blur can flush storage and reflow the page between mouse down/up in WebKit.
  // Keep inline button gestures together; keyboard focus remains native.
  layer.addEventListener('mousedown', e => { if (e.button === 0 && e.target.closest('button')) e.preventDefault(); });
  const peek = document.createElement('div'); peek.className = 'comment-peek'; peek.id = 'comment-peek'; peek.hidden = true; peek.setAttribute('role', 'tooltip'); document.body.append(peek);
  let surface, groups = [], marks = [], reading = false, frame, hoverTimer, hoverTarget, gesture, reopen = new Set();
  const active = new Map(), known = new Set(), cache = new Map();
  const highlightNames = ['comment', 'change', 'resolved', 'obsolete', 'mixed', 'linked', 'draft'];
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  ro?.observe(host);
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = undefined; layout(); }); }
  function layout() {
    const root = host.getBoundingClientRect(), scale = root.width / host.offsetWidth || 1;
    for (const g of groups) {
      g.node.style.width = g.spacer.getBoundingClientRect().width / scale + 'px';
      g.spacer.style.height = (g.node.hidden ? 0 : g.node.getBoundingClientRect().height / scale) + 'px';
    }
    for (const g of groups) {
      const rect = g.spacer.getBoundingClientRect();
      g.node.style.left = (rect.left - root.left) / scale + 'px'; g.node.style.top = (rect.top - root.top) / scale + 'px';
    }
  }
  function paint(linked = []) {
    if (!globalThis.Highlight || !CSS.highlights) return;
    for (const name of highlightNames) {
      const ranges = reading ? [] : marks.filter(m => m.range && (name === 'linked' ? linked.includes(m.id) || [...active.values()].includes(m.id) : m.type === name)).map(m => m.range);
      if (name === 'mixed' && !reading) for (const a of marks.filter(m => m.type === 'comment')) for (const b of marks.filter(m => m.type === 'change')) {
        if (!a.range || !b.range) continue;
        const start = a.range.compareBoundaryPoints(Range.START_TO_START, b.range) > 0 ? a.range : b.range;
        const end = a.range.compareBoundaryPoints(Range.END_TO_END, b.range) < 0 ? a.range : b.range;
        const overlap = document.createRange(); overlap.setStart(start.startContainer, start.startOffset); overlap.setEnd(end.endContainer, end.endOffset);
        if (!overlap.collapsed) ranges.push(overlap);
      }
      CSS.highlights.set('review-' + name, new Highlight(...ranges));
    }
  }
  function hidePeek() {
    clearTimeout(hoverTimer); peek.hidden = true;
    hoverTarget?.removeAttribute('aria-describedby'); hoverTarget = undefined; paint();
  }
  function preview(items, target, rect) {
    hidePeek(); if (reading || !items.length || !document.getSelection()?.isCollapsed) return;
    paint(items.map(i => i.thread.id));
    hoverTimer = setTimeout(() => {
      if (!target.isConnected) return;
      const {thread, number} = items[0], first = thread.comments[0];
      peek.textContent = `${label(thread)} #${number} · ${thread.state} · ${first.author}\n${first.body.slice(0, 180)}${first.body.length > 180 ? '…' : ''}${items.length > 1 ? `\n${items.length} overlapping threads — click to cycle` : ''}`;
      peek.hidden = false; hoverTarget = target; target.setAttribute('aria-describedby', peek.id);
      const scale = peek.getBoundingClientRect().width / peek.offsetWidth || 1;
      peek.style.maxWidth = (innerWidth - 16) / scale + 'px'; peek.style.maxHeight = (innerHeight - 16) / scale + 'px';
      const box = peek.getBoundingClientRect();
      peek.style.left = Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)) / scale + 'px';
      peek.style.top = Math.max(8, Math.min(rect.bottom + 8, innerHeight - box.height - 8)) / scale + 'px';
    }, 250);
  }
  peek.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
  peek.addEventListener('pointerleave', hidePeek);
  function clear() {
    hidePeek();
    const view = reviews.view(); view.home.append(view.form);
    for (const node of view.threadElements.values()) {
      node.hidden = false; node.classList.remove('comment-fold');
      node.querySelectorAll('.fold-title,.fold-close,[data-inline-note]').forEach(n => n.remove());
      view.list.append(node);
    }
    view.form.classList.remove('inline-composer');
    for (const g of groups) { ro?.unobserve(g.node); g.spacer.remove(); g.block.classList.remove('comment-block'); g.block.style.removeProperty('--review-color'); }
    groups = []; marks = []; layer.replaceChildren(); paint();
  }
  function update(reason) {
    if (reason === 'input') { schedule(); return; }
    if (reason === 'edit' || reason === 'restore') reading = false;
    mode.textContent = reading ? 'Review' : 'Read'; mode.setAttribute('aria-pressed', String(reading));
    mode.setAttribute('aria-label', reading ? 'Review comments' : 'Read without comments');
    const focus = document.activeElement, caret = focus?.selectionStart, focusedThread = focus?.dataset.threadId;
    clear();
    const view = reviews.view();
    if (!view.review.threads.length) { active.clear(); known.clear(); }
    if (!surface) { bar.hidden = true; return; }
    bar.hidden = false;
    const {model, content, sourceMode} = surface;
    const byBlock = new Map();
    const group = block => {
      if (!block) return;
      if (byBlock.has(block)) return byBlock.get(block);
      const spacer = document.createElement('div'); spacer.className = 'comment-space'; spacer.setAttribute('aria-hidden', 'true'); block.after(spacer);
      const node = document.createElement('section'); node.className = 'inline-group'; node.hidden = reading;
      const tabs = document.createElement('div'); tabs.className = 'comment-tabs'; tabs.setAttribute('aria-label', 'Threads on this block'); node.append(tabs); layer.append(node);
      const key = JSON.stringify([model.path, block.dataset.sourcepos ?? 'source']);
      const g = {key, block, spacer, node, tabs, items: []}; byBlock.set(block, g); groups.push(g); ro?.observe(node); return g;
    };
    for (const [index, thread] of view.review.threads.entries()) {
      const article = view.threadElements.get(thread.id);
      if (!article || index >= 200) continue; // Keep additional threads in the existing navigable list.
      let anchor;
      try {
        const signature = JSON.stringify([thread.loc, thread.select]);
        if (cache.get(thread.id)?.signature === signature) anchor = cache.get(thread.id).anchor;
        else { anchor = commentAnchor(model, content, commentInterval(model, thread.loc, thread.select), sourceMode); cache.set(thread.id, {signature, anchor}); }
      } catch { continue; } // Different document or unavailable original: retain the existing navigable list.
      const g = group(anchor.block); if (!g) continue;
      const item = {thread, number: index + 1, anchor, group: g};
      if (!known.has(thread.id) || reopen.has(thread.id)) { active.set(g.key, thread.id); known.add(thread.id); }
      article.classList.add('comment-fold'); article.dataset.kind = kind(thread); article.dataset.state = thread.state;
      article.id = 'inline-thread-' + thread.id;
      // Existing state, reply and export handlers stay attached to these nodes.
      const heading = article.querySelector('button');
      heading.setAttribute('aria-label', `Open source of thread ${index + 1}`);
      const title = document.createElement('strong'); title.className = 'fold-title'; title.textContent = `${label(thread)} #${index + 1} · ${thread.state}`; icon(title, thread);
      article.querySelector('.fold-title')?.remove(); article.prepend(title);
      const visible = filter.value === 'all' || filter.value === thread.state;
      if (visible) {
        g.items.push(item);
        marks.push({id: thread.id, range: anchor.range, type: thread.state === 'open' ? kind(thread) : thread.state, item});
        const tab = button(`${index + 1} · ${label(thread)} · ${thread.state}`, () => toggle(item)); icon(tab, thread);
        tab.className = 'comment-chip'; tab.dataset.kind = kind(thread); tab.dataset.state = thread.state;
        tab.dataset.threadId = thread.id;
        tab.setAttribute('aria-expanded', String(active.get(g.key) === thread.id)); tab.setAttribute('aria-controls', article.id);
        tab.addEventListener('pointerenter', () => preview([item], tab, tab.getBoundingClientRect()));
        tab.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(hidePeek, 150); });
        tab.addEventListener('focus', () => requestAnimationFrame(() => {
          if (document.activeElement === tab) preview([item], tab, tab.getBoundingClientRect());
        })); tab.addEventListener('blur', hidePeek);
        g.tabs.append(tab);
      }
      article.hidden = !visible || active.get(g.key) !== thread.id;
      g.node.append(article);
      article.querySelectorAll('[data-inline-note]').forEach(n => n.remove());
      if (!anchor.range) { const note = document.createElement('p'); note.dataset.inlineNote = ''; note.textContent = 'Block location only. Use View source for the exact original quote.'; article.append(note); }
      if (thread.state === 'obsolete') { const note = document.createElement('p'); note.dataset.inlineNote = ''; note.textContent = 'Marked obsolete; retained as review history.'; article.append(note); }
      const close = button('Collapse thread', () => { active.delete(g.key); update(); groups.find(x => x.key === g.key)?.tabs.querySelector('button')?.focus(); });
      close.className = 'fold-close'; article.querySelector('.fold-close')?.remove(); article.append(close);
    }
    const draft = view.composing;
    if (draft) {
      let anchor;
      try {
        if (draft.thread) anchor = cache.get(draft.thread.id)?.anchor;
        else if (draft.model === model) {
          const offset = scopeOffset(model, draft.anchor.scope), select = draft.anchor.select;
          anchor = commentAnchor(model, content, {start: offset + select.start, end: offset + select.end}, sourceMode);
        }
      } catch { /* Keep the original editor available below the document. */ }
      if (anchor?.block) {
        const g = group(anchor.block); g.node.append(view.form); view.form.classList.add('inline-composer');
        marks.push({range: anchor.range, type: 'draft'});
      }
    }
    for (const g of groups) {
      g.node.hidden = reading || (!g.items.length && !g.node.contains(view.form)); g.block.classList.toggle('comment-block', !g.node.hidden);
      const thread = (g.items.find(i => i.thread.id === active.get(g.key)) ?? g.items[0])?.thread;
      const color = !thread ? '#285ac5' : thread.state !== 'open' ? '#83738b' : kind(thread) === 'change' ? '#b66b21' : '#168177';
      g.block.style.setProperty('--review-color', color);
    }
    paint(); layout();
    reopen.clear();
    if (focus?.isConnected && focus !== document.body) { focus.focus({preventScroll: true}); if (typeof caret === 'number') focus.setSelectionRange(caret, caret); }
    else if (focusedThread) layer.querySelector(`[data-thread-id="${focusedThread}"]`)?.focus({preventScroll: true});
  }
  function toggle(item) { hidePeek(); active.set(item.group.key, active.get(item.group.key) === item.thread.id ? undefined : item.thread.id); update(); }
  function hits(event) {
    if (reading || !surface?.content.contains(event.target) || event.target.closest('a,button,input,textarea,select') || !document.getSelection()?.isCollapsed) return [];
    return marks.filter(m => m.item && m.range && [...m.range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)).map(m => m.item);
  }
  host.addEventListener('pointerdown', e => { gesture = {x: e.clientX, y: e.clientY}; });
  host.addEventListener('click', e => {
    if (!gesture || e.detail !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 4) return;
    const items = hits(e); if (!items.length) return;
    e.stopImmediatePropagation(); e.preventDefault(); hidePeek();
    const next = items[(items.findIndex(i => active.get(i.group.key) === i.thread.id) + 1) % items.length];
    active.set(next.group.key, next.thread.id); update();
  }, true);
  host.addEventListener('pointermove', e => { if (e.buttons) return; const items = hits(e); if (items.length) { if (hoverTarget !== e.target) preview(items, e.target, items[0].anchor.range.getBoundingClientRect()); } else if (surface?.content.contains(e.target)) hidePeek(); });
  host.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(hidePeek, 150); });
  document.addEventListener('pointerdown', e => { if (!peek.contains(e.target)) hidePeek(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePeek(); });
  document.addEventListener('scroll', () => { hidePeek(); schedule(); }, {capture: true, passive: true});
  window.addEventListener('resize', () => { hidePeek(); schedule(); });
  reader.display(value => {
    if (!value) reopen = new Set(active.values());
    clear(); cache.clear(); surface = value; if (value) update(); else bar.hidden = true;
  });
  reviews.display(update);
  surface = reader.surface(); update();
}
