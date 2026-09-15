const storageKey = 'mdpkg-viewer:author-name';

// This preference is independent of package-specific saved drafts and reviews.
export function authorName(input, button) {
  const label = input.closest('label');
  let remembered = '';
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && stored.length <= input.maxLength) remembered = stored.trim();
  } catch { /* Authoring remains available when browser storage is blocked. */ }

  function remember(value) {
    remembered = value.trim().slice(0, input.maxLength);
    try {
      if (remembered) localStorage.setItem(storageKey, remembered);
      else localStorage.removeItem(storageKey);
    } catch { /* Keep the preference for this tab when storage cannot be written. */ }
  }
  function display() {
    const name = input.value.trim();
    label.hidden = !!name;
    button.hidden = !name;
    button.textContent = name + ' · Edit';
  }
  button.addEventListener('click', () => {
    label.hidden = false; button.hidden = true;
    input.focus(); input.select();
  });
  input.addEventListener('input', () => remember(input.value));
  input.addEventListener('change', () => remember(input.value));
  input.addEventListener('blur', () => { remember(input.value); display(); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    remember(input.value); display();
    if (!button.hidden) button.focus();
  });
  return {
    remember,
    show(value = remembered) { input.value = value; display(); },
  };
}
