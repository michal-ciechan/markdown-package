import {envelope, databaseName} from './model.js';

const stores = ['packages', 'handles', 'positions', 'reviews', 'drafts', 'resume', 'conflicts'];
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
export async function openStore(base = location.href, factory = globalThis.indexedDB) {
  const db = await new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('Browser storage is unavailable.')); return; }
    const opening = factory.open(databaseName(base), 1);
    let failed = false;
    const fail = error => { failed = true; reject(error); };
    opening.onupgradeneeded = () => { for (const name of stores) opening.result.createObjectStore(name, {keyPath: 'id'}); };
    opening.onblocked = () => fail(new Error('Browser storage upgrade is blocked. Close other viewer tabs and retry.'));
    opening.onerror = () => fail(opening.error);
    opening.onsuccess = () => { if (failed) opening.result.close(); else resolve(opening.result); };
  });
  db.onversionchange = () => db.close();
  async function transaction(names, mode, action) {
    const tx = db.transaction(names, mode);
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error ?? new Error('Browser save was aborted.'));
      tx.onerror = () => {}; // onabort is the transaction's authoritative outcome.
    });
    const access = name => ({get: id => request(tx.objectStore(name).get(id)),
      all: () => request(tx.objectStore(name).getAll()),
      put: value => request(tx.objectStore(name).put(value)), delete: id => request(tx.objectStore(name).delete(id))});
    try { const value = await action(access); await completed; return value; }
    catch (error) { try { tx.abort(); } catch {} await completed.catch(() => {}); throw error; }
  }
  const read = (name, id) => transaction([name], 'readonly', s => s(name).get(id));
  const all = name => transaction([name], 'readonly', s => s(name).all());
  // Capture related pointers and envelopes before asynchronous source validation.
  // A concurrent writer cannot interleave with this transaction's reads.
  const restore = packageKey => transaction(['packages', 'reviews', 'drafts', 'resume'], 'readonly', async s => {
    const resume = await s('resume').get('last');
    const record = await s('packages').get(packageKey ?? resume?.packageKey ?? '');
    const review = record?.reviewNamespace && await s('reviews').get([record.id, record.reviewNamespace]);
    const draft = record?.activeDraftKey && await s('drafts').get([record.id, record.activeDraftKey]);
    return {record, review, draft, resume};
  });
  async function prune(aggressive = false) {
    return transaction(['packages', 'positions', 'handles'], 'readwrite', async s => {
      const packages = (await s('packages').all()).filter(p => p.version === 1 && !p.removed)
        .sort((a, b) => b.lastOpened - a.lastOpened);
      const pruned = new Set();
      for (const p of packages.slice(aggressive ? 0 : 20)) if (!p.hasWork && !p.unexported) {
        await s('packages').put({...p, removed: true}); await s('handles').delete(p.id);
        pruned.add(p.id);
      }
      if (aggressive) for (const handle of await s('handles').all()) if (handle.version === 1) await s('handles').delete(handle.id);
      const groups = new Map();
      for (const position of await s('positions').all()) {
        if (position.version !== 1) continue;
        if (pruned.has(position.packageKey)) { await s('positions').delete(position.id); continue; }
        const group = groups.get(position.packageKey) ?? []; group.push(position); groups.set(position.packageKey, group);
      }
      for (const group of groups.values()) for (const p of group.sort((a, b) => b.lastViewed - a.lastViewed).slice(20)) await s('positions').delete(p.id);
    });
  }
  async function write(action) {
    try { return await action(); }
    catch (error) { if (error.name !== 'QuotaExceededError') throw error; await prune(true); return action(); }
  }
  const known = value => { if (value) envelope(value); return value; };
  async function openPackage(packageKey, metadata) {
    return write(() => transaction(['packages', 'resume'], 'readwrite', async s => {
      const previous = known(await s('packages').get(packageKey));
      if (previous && (!Number.isSafeInteger(previous.generation) || previous.generation < 0)) throw new Error('Saved package generation is invalid.');
      const p = {...previous, ...metadata, version: 1, id: packageKey, packageKey,
        generation: previous?.generation ?? 0, removed: false, lastOpened: Date.now()};
      await s('packages').put(p);
      const resume = known(await s('resume').get('last'));
      await s('resume').put({...resume, version: 1, id: 'last', packageKey,
        documentPath: p.documentPath, activeDraftKey: p.activeDraftKey});
      return p;
    }));
  }
  async function work(packageKey, generation, snapshot, expected) {
    return write(() => transaction(['packages', 'reviews', 'drafts', 'resume', 'conflicts'], 'readwrite', async s => {
      const p = known(await s('packages').get(packageKey));
      const reviewId = [packageKey, snapshot.namespace];
      const previous = await s('reviews').get(reviewId);
      const draftId = snapshot.draft && [packageKey, snapshot.draft.targetKey];
      const oldDraftId = expected.draftKey && [packageKey, expected.draftKey];
      const nextDraft = draftId && await s('drafts').get(draftId);
      const oldDraft = oldDraftId && await s('drafts').get(oldDraftId);
      const mismatch = !p || p.generation !== generation ||
        p.activeDraftKey !== expected.draftKey ||
        (p.reviewNamespace && p.reviewNamespace !== snapshot.namespace) ||
        (previous && previous.version !== 1) || (previous?.revision ?? 0) !== expected.review ||
        (oldDraft && oldDraft.version !== 1) || (oldDraft?.revision ?? 0) !== expected.draft ||
        (nextDraft && nextDraft.id[1] !== expected.draftKey && (!nextDraft.tombstone || nextDraft.version !== 1));
      if (mismatch) {
        await s('conflicts').put({version: 1, id: crypto.randomUUID(), packageKey, at: Date.now(),
          reason: 'Another tab saved or deleted this work. Your version was preserved for recovery.', snapshot});
        return {conflict: true};
      }
      const revision = expected.review + 1;
      await s('reviews').put({version: 1, id: reviewId, packageKey, namespace: snapshot.namespace,
        revision, review: snapshot.review, sourceDigests: snapshot.sourceDigests,
        exportRevision: snapshot.exportRevision, contentRevision: snapshot.revision, artifact: snapshot.artifact});
      let draftRevision = 0;
      if (oldDraftId && (!draftId || oldDraftId[1] !== draftId[1]))
        await s('drafts').put({version: 1, id: oldDraftId, packageKey, revision: expected.draft + 1, tombstone: true});
      if (draftId) {
        draftRevision = (nextDraft?.revision ?? 0) + 1;
        await s('drafts').put({...snapshot.draft, id: draftId, packageKey, revision: draftRevision, updated: Date.now()});
      }
      await s('packages').put({...p, reviewNamespace: snapshot.namespace, activeDraftKey: snapshot.draft?.targetKey,
        hasWork: !!snapshot.draft || !!snapshot.review.threads.length,
        unexported: snapshot.review.threads.length > 0 && snapshot.exportRevision !== snapshot.revision});
      const resume = known(await s('resume').get('last'));
      if (resume?.packageKey === packageKey) await s('resume').put({...resume, activeDraftKey: snapshot.draft?.targetKey});
      return {review: revision, draft: draftRevision, draftKey: snapshot.draft?.targetKey};
    }));
  }
  return {read, all, restore, openPackage, work, prune, close: () => db.close(),
    saveHandle: (packageKey, handle) => transaction(['handles'], 'readwrite', s =>
      s('handles').put({version: 1, id: packageKey, packageKey, handle, at: Date.now()})),
    position: (packageKey, generation, position) => write(() => transaction(['packages', 'positions', 'resume'], 'readwrite', async s => {
      envelope({...position, version: 1}, 32768);
      const p = known(await s('packages').get(packageKey));
      if (!p || p.generation !== generation || p.removed) return;
      const id = [packageKey, position.documentPath];
      known(await s('positions').get(id));
      await s('positions').put({...position, version: 1, id, packageKey, lastViewed: Date.now()});
      const recent = (await s('positions').all()).filter(row => row.version === 1 && row.packageKey === packageKey)
        .sort((a, b) => b.lastViewed - a.lastViewed);
      for (const old of recent.slice(20)) await s('positions').delete(old.id);
      await s('packages').put({...p, documentPath: position.documentPath, lastRead: Date.now()});
      const resume = known(await s('resume').get('last'));
      await s('resume').put({...resume, version: 1, id: 'last', packageKey,
        documentPath: position.documentPath, activeDraftKey: p.activeDraftKey});
    })),
    removeRecent: packageKey => transaction(['packages', 'handles', 'positions', 'resume'], 'readwrite', async s => {
      const p = known(await s('packages').get(packageKey));
      if (p) await s('packages').put({...p, removed: true});
      await s('handles').delete(packageKey);
      for (const row of await s('positions').all()) if (row.packageKey === packageKey) await s('positions').delete(row.id);
      if ((await s('resume').get('last'))?.packageKey === packageKey) await s('resume').delete('last');
    }),
    deleteWork: packageKey => transaction(['packages', 'drafts', 'reviews', 'conflicts', 'resume'], 'readwrite', async s => {
      const p = known(await s('packages').get(packageKey));
      if (p) await s('packages').put({...p, generation: p.generation + 1, hasWork: false, unexported: false,
        reviewNamespace: undefined, activeDraftKey: undefined});
      for (const store of ['drafts', 'reviews', 'conflicts']) for (const row of await s(store).all())
        if (row.packageKey === packageKey) await s(store).delete(row.id);
      const resume = known(await s('resume').get('last'));
      if (resume?.packageKey === packageKey) await s('resume').put({...resume, activeDraftKey: undefined});
    }),
    discardDraft: (packageKey, targetKey, revision) => transaction(['packages', 'drafts', 'resume'], 'readwrite', async s => {
      const id = [packageKey, targetKey], d = known(await s('drafts').get(id));
      if (!d || d.revision !== revision) throw new Error('This draft changed in another tab. Reopen recovery.');
      await s('drafts').put({version: 1, id, packageKey, revision: revision + 1, tombstone: true});
      const p = known(await s('packages').get(packageKey));
      if (p?.activeDraftKey === targetKey) await s('packages').put({...p, activeDraftKey: undefined});
      const r = known(await s('resume').get('last'));
      if (r?.packageKey === packageKey && r.activeDraftKey === targetKey) await s('resume').put({...r, activeDraftKey: undefined});
    }),
    discardConflict: id => transaction(['conflicts'], 'readwrite', s => s('conflicts').delete(id)),
  };
}
