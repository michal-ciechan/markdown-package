export function documentList(host, onOpen) {
  const label = document.createElement('label');
  label.textContent = 'Documents';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Filter documents';
  search.setAttribute('aria-label', 'Filter documents');
  const count = document.createElement('p');
  count.className = 'muted document-count';
  const list = document.createElement('ul');
  list.className = 'document-list';
  host.append(label, search, count, list);
  let entries = [], selected;
  function draw() {
    const matches = entries.filter(entry => entry.name.toLowerCase().includes(search.value.toLowerCase()));
    count.textContent = `${matches.length} of ${entries.length} documents`;
    list.replaceChildren();
    for (const entry of matches) {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.name;
      button.title = entry.name;
      if (entry.name === selected) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => onOpen(entry.name));
      row.append(button);
      list.append(row);
    }
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.textContent = entries.length ? 'No matching documents.' : 'This package has no documents in its current view.';
      empty.className = 'muted';
      list.append(empty);
    }
  }
  search.addEventListener('input', draw);
  return {
    setDocuments(value) { entries = value; selected = undefined; search.value = ''; draw(); },
    select(name) { selected = name; draw(); },
  };
}
