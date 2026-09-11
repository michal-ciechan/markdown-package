export function recentView(host, actions) {
  host.innerHTML = `<details><summary>Recently opened</summary><div class="recent-list"></div></details>
    <p class="persistence-note">This browser keeps filenames, reading positions, names, selected quotes and feedback on this device/profile. Package contents are not copied. Site-data clearing or eviction can remove saved work.</p>
    <p class="local-save-status" role="status" aria-live="polite"></p><p class="export-status"></p>
    <button type="button" class="retry-save" hidden>Retry browser save</button>
    <div class="resume-offer"></div><div class="saved-recovery"></div>`;
  const find = selector => host.querySelector(selector);
  let recoverySignature;
  function button(parent, label, action) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { Promise.resolve(action()).catch(error => notice(error.message, true)); }); parent.append(b); return b;
  }
  function notice(text, failed = false) {
    const status = find('.local-save-status');
    if (status.textContent !== text) status.textContent = text;
    find('.retry-save').hidden = !failed;
  }
  find('.retry-save').addEventListener('click', () => actions.retry());
  return {notice,
    exported(dirty) { find('.export-status').textContent = dirty ? 'Review not exported' : ''; },
    list(packages, positions, conflicts) {
      const list = find('.recent-list'); list.replaceChildren();
      const recent = packages.filter(p => !p.removed).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 20);
      const recovery = packages.filter(p => !recent.includes(p) && (p.hasWork || p.unexported || conflicts.some(c => c.packageKey === p.id)));
      if (!recent.length && !recovery.length) list.textContent = 'No recently opened packages.';
      for (const p of [...recent, ...recovery]) {
        const row = document.createElement('section'); row.className = 'recent-package';
        button(row, `${p.filename || 'Untitled package'}${p.activeDraftKey ? ' · Saved draft' : ''}${p.removed ? ' · Saved work' : ''}`, () => actions.open(p));
        const info = document.createElement('small');
        const position = positions.find(x => x.packageKey === p.id && x.documentPath === p.documentPath);
        const trail = position?.locator?.[2];
        const section = (Array.isArray(trail) ? trail.at(-1)?.[0] : undefined) ?? position?.locator?.[0] ?? '';
        info.textContent = `${p.documentPath ?? ''} ${section} · ${new Date(p.lastRead ?? p.lastOpened).toLocaleString()} · ${p.namespace ?? ''} · ${p.current ?? ''}`;
        row.append(info);
        for (const position of positions.filter(x => x.packageKey === p.id).sort((a, b) => b.lastViewed - a.lastViewed).slice(0, 20))
          button(row, position.documentPath, () => actions.open(p, position.documentPath));
        button(row, 'Remove from recents', () => actions.remove(p));
        if (p.hasWork || p.unexported || conflicts.some(c => c.packageKey === p.id)) button(row, 'Delete saved work', () => actions.delete(p));
        list.append(row);
      }
    },
    offer(message, label, action, secondary) {
      const host = find('.resume-offer'); host.replaceChildren();
      const p = document.createElement('p'); p.textContent = message; host.append(p);
      if (label) button(host, label, action);
      if (secondary) button(host, secondary.label, secondary.action);
    },
    clearOffer() { find('.resume-offer').replaceChildren(); },
    recovery(items) {
      const signature = JSON.stringify(items.map(item => [item.reason, item.text]));
      if (signature === recoverySignature) return;
      recoverySignature = signature;
      const host = find('.saved-recovery'); host.replaceChildren();
      for (const item of items) {
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = item.reason; details.append(summary);
        const text = document.createElement('textarea'); text.readOnly = true; text.value = item.text;
        text.setAttribute('aria-label', 'Saved text for recovery'); details.append(text);
        button(details, 'Copy saved text', async () => {
          try { await navigator.clipboard.writeText(item.text); } catch { text.focus(); text.select(); }
        });
        if (item.discard) button(details, 'Discard saved recovery', item.discard);
        host.append(details);
      }
    },
  };
}
