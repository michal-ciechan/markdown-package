import {nextExpansion, sameRange, wordAtPoint} from './selection-ranges.js';

export function selectionToolbar(host, {getModel, isSource, onRange, onComment}) {
  const toolbar = document.createElement('div');
  toolbar.className = 'selection-toolbar'; toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Text selection');
  toolbar.innerHTML = `<span class="selection-level" role="status" aria-live="polite"></span>
    <button type="button" data-selection="collapse" aria-label="Collapse selection" title="Collapse selection"><span aria-hidden="true">−</span></button>
    <button type="button" data-selection="expand" aria-label="Expand selection" title="Expand selection"><span aria-hidden="true">＋</span></button>
    <button type="button" data-selection="comment">Leave comment</button>`;
  host.after(toolbar);
  const button = name => toolbar.querySelector(`[data-selection="${name}"]`);
  const label = toolbar.querySelector('.selection-level');
  let active, history = [], level = 'Selection', next, pointer, dismissed, frame;

  function position() {
    if (!active || dismissed || !host.isConnected) { toolbar.hidden = true; return; }
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const rect = [...active.getClientRects()].find(rect => rect.width && rect.height &&
      rect.bottom > top && rect.top < top + height && rect.right > left && rect.left < left + width);
    if (!rect) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    toolbar.style.maxWidth = `${Math.max(0, width - 16)}px`;
    const bounds = toolbar.getBoundingClientRect();
    const x = Math.max(left + 8, Math.min(rect.left, left + width - bounds.width - 8));
    const above = rect.top - bounds.height - 8;
    const y = Math.max(top + 8, Math.min(above >= top + 8 ? above : rect.bottom + 8, top + height - bounds.height - 8));
    toolbar.style.left = `${x}px`; toolbar.style.top = `${y}px`;
  }
  function schedulePosition() {
    cancelAnimationFrame(frame); frame = requestAnimationFrame(position);
  }
  function refresh() {
    const focused = toolbar.contains(document.activeElement) ? document.activeElement : undefined;
    next = active && !isSource() ? nextExpansion(host, active, getModel()) : undefined;
    button('expand').disabled = !next;
    button('expand').title = next ? `Expand to ${next.level}` : 'Selection cannot expand further';
    button('collapse').disabled = !history.length;
    if (focused?.disabled) button(history.length ? 'collapse' : 'comment').focus({preventScroll: true});
    label.textContent = level;
    position();
  }
  function apply(range, name) {
    active = range.cloneRange(); level = name; dismissed = false;
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range.cloneRange());
    onRange(active.cloneRange()); refresh();
  }
  function reset() {
    active = undefined; history = []; dismissed = false;
    toolbar.hidden = true;
  }
  function dismiss() { dismissed = true; toolbar.hidden = true; }

  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed ||
      !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) {
      reset(); return;
    }
    const range = selection.getRangeAt(0);
    if (!sameRange(range, active)) {
      active = range.cloneRange(); history = []; level = 'Selection'; dismissed = false;
      onRange(active.cloneRange()); refresh();
    }
  });
  host.addEventListener('pointerdown', event => {
    pointer = event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey ?
      {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false} : undefined;
  });
  host.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) pointer.moved = true;
  });
  host.addEventListener('pointercancel', () => { pointer = undefined; });
  host.addEventListener('click', event => {
    const gesture = pointer; pointer = undefined;
    if (!gesture || gesture.moved || event.detail !== 1 || isSource() ||
      event.target.closest('a, button, input, select, textarea') ||
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) return;
    // Native drag, touch handles, shift-click and double/triple-click selections win.
    if (!document.getSelection()?.isCollapsed) return;
    const range = wordAtPoint(host, event.clientX, event.clientY);
    if (range) { history = []; apply(range, 'Word'); }
  });
  document.addEventListener('pointerdown', event => {
    if (!host.contains(event.target) && !toolbar.contains(event.target)) dismiss();
  });
  document.addEventListener('focusin', event => {
    if (!host.contains(event.target) && !toolbar.contains(event.target)) dismiss();
  });
  // Keep the native selection and reader's cached range when using mouse or touch.
  toolbar.addEventListener('pointerdown', event => event.preventDefault());
  toolbar.addEventListener('mousedown', event => event.preventDefault());
  button('expand').addEventListener('click', () => {
    if (!next) return;
    history.push({range: active.cloneRange(), level});
    const target = next;
    apply(target.range, target.level[0].toUpperCase() + target.level.slice(1));
  });
  button('collapse').addEventListener('click', () => {
    const previous = history.pop();
    if (previous) apply(previous.range, previous.level);
  });
  button('comment').addEventListener('click', () => {
    if (!active) return;
    onRange(active.cloneRange()); dismiss(); onComment();
  });
  toolbar.addEventListener('keydown', event => {
    const buttons = [...toolbar.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !toolbar.hidden) {
      dismiss();
      if (toolbar.contains(document.activeElement)) host.focus({preventScroll: true});
    }
  });
  document.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
  window.visualViewport?.addEventListener('resize', schedulePosition);
  window.visualViewport?.addEventListener('scroll', schedulePosition);
  return {reset};
}
