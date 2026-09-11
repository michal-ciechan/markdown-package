export function tableControls(host, states, model) {
  // The reader clears these preferences on package changes. Keep only paths and
  // positions, so visiting documents does not retain their full source or DOM.
  let tables = states.get(model.path);
  if (!tables) states.set(model.path, tables = new Map());
  for (const [index, container] of [...host.querySelectorAll('.table-container')].entries()) {
    const key = container.dataset.sourcepos;
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Wrap table ${index + 1} text`);
    // No UI text nodes in the article: exact rendered-selection verification
    // compares its textContent with a fresh render of perturbed source.
    button.innerHTML = '<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M3 10h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4"/></svg>';
    const scroll = container.querySelector('.table-scroll');
    scroll.setAttribute('aria-label', `Table ${index + 1}`);
    function apply() {
      const wrapped = tables.get(key) !== false;
      container.classList.toggle('table-nowrap', !wrapped);
      button.setAttribute('aria-pressed', String(wrapped));
      button.title = wrapped ? 'Turn off wrapping (scroll horizontally)' : 'Wrap cell text';
    }
    button.addEventListener('click', () => {
      tables.set(key, tables.get(key) === false);
      apply();
    });
    toolbar.append(button); container.prepend(toolbar); apply();
  }
}
