import {openStore} from './store.js';
import {packageKey, databaseName, envelope, encodeDraft, decodeDraft, validateReview, debounce, recoveryText} from './model.js';
import {sourceDigest, capturePosition, restorePosition} from './position.js';
import {permission, allow, fromHandle, hasFilePicker, choosePackage} from '../inbound/file-access.js';
import {recentView} from '../ui/recent-view.js';
import {decodeLocator} from '../address/reference.js';

export async function persistence({host, reviews, reader, article, receive, navigate, getModel, getPackage, fileInput, enhanced, standardLabel}) {
  let store, active, pendingPick, pendingPosition, workQueue = Promise.resolve(), positionQueue = Promise.resolve();
  let dirty = false, failed = false, restoring = false, intent = 0, frame, recovery = [], workSequence = 0;
  const tabKey = databaseName(location.href) + ':resume';
  const tabRead = () => { try { const p = JSON.parse(sessionStorage.getItem(tabKey)); return p?.version === 1 ? p : undefined; } catch {} };
  const tabWrite = value => { try { sessionStorage.setItem(tabKey, JSON.stringify({version: 1, ...value})); } catch {} };
  const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
  function lossGuard(value) {
    dirty = value;
    window.removeEventListener('beforeunload', beforeUnload);
    if (value) window.addEventListener('beforeunload', beforeUnload);
  }
  function failure(error) { failed = true; ui.notice('Could not save; keep this tab open. ' + error.message, true); }
  async function refresh() {
    if (!store) return;
    try {
      const [packages, positions, conflicts] = await Promise.all(['packages', 'positions', 'conflicts'].map(name => store.all(name)));
      ui.list(packages.filter(p => p.version === 1), positions.filter(p => p.version === 1), conflicts);
      ui.recovery([...packages.filter(p => p.version !== 1).map(p => ({reason: 'Saved package data has an unsupported version; it was retained.', text: recoveryText(p)})),
        ...recovery, ...conflicts.map(c => ({reason: String(c.reason ?? 'Saved conflict'), text: recoveryText(c.snapshot),
        discard: async () => { await store.discardConflict(c.id); await refresh(); }}))]);
    } catch (error) { failure(error); }
  }
  async function reopen(p, documentPath, automatic = false) {
    let openingIntent = ++intent;
    if (getPackage() && active?.key === p.id) { await navigate(documentPath ?? p.documentPath, undefined, true); return; }
    let handle, grant;
    try { handle = (await store.read('handles', p.id))?.handle; grant = await permission(handle); } catch {}
    if (openingIntent !== intent) return;
    const choose = () => {
      pendingPick = {key: p.id, documentPath}; fileInput.click();
    };
    const fallback = reason => ui.offer(`${reason ?? ''} Choose ${p.filename || 'this package'} again to resume ${documentPath ?? p.documentPath ?? 'reading'}. Your position and saved draft will return once it is open.`,
      'Choose file again', choose);
    const load = async () => {
      try { const source = await fromHandle(handle); if (openingIntent === intent) await receive(source, p.id, documentPath); }
      catch { fallback('The saved file could not be read.'); }
    };
    if (grant === 'granted') { await load(); return; }
    if (grant === 'prompt') {
      ui.offer(`Allow read access to ${p.filename || 'this package'} to resume.`, 'Allow access', async () => {
        openingIntent = ++intent;
        const grant = await allow(handle);
        if (openingIntent !== intent) return;
        if (grant === 'granted') await load(); else fallback('Read access was not granted.');
      }, {label: 'Choose file again', action: choose});
    } else fallback();
  }
  const ui = recentView(host, {
    open: reopen,
    retry: async () => { try { store?.close(); store = await openStore(); } catch (e) { store = undefined; failure(e); return; }
      if (active && !active.record) { try { active.record = await store.openPackage(active.key, active.metadata); } catch (e) { failure(e); return; } }
      failed = false; await saveWork(); await flushPosition(); await refresh(); },
    remove: async p => { await store.removeRecent(p.id); if (tabRead()?.packageKey === p.id) tabWrite({}); ui.clearOffer(); await refresh(); },
    delete: async p => {
      if (!window.confirm(`Delete saved drafts and reviews for ${p.filename || 'this package'} from this browser?`)) return;
      if (active?.key === p.id) { workSequence++; workTimer.cancel(); await workQueue; }
      await store.deleteWork(p.id);
      if (active?.key === p.id) {
        active.record = await store.read('packages', p.id); active.expected = {review: 0, draft: 0}; active.pendingDraft = undefined;
        active.generation = active.record.generation;
        active.locked = false;
        reviews.setPackage(getPackage()); lossGuard(false); ui.notice('Saved work deleted.');
      }
      recovery = []; ui.clearOffer(); await refresh();
    },
  });
  function saveWork() {
    if (!active || !dirty) return workQueue;
    const session = active, sequence = workSequence, snapshot = reviews.snapshot();
    if (!snapshot.draft && session.pendingDraft) snapshot.draft = {context: session.pendingDraft.context, ...session.pendingDraft.fields};
    ui.exported(snapshot.dirty);
    workQueue = workQueue.catch(() => {}).then(async () => {
      if (sequence !== workSequence || session !== active) return;
      try {
        const draft = await encodeDraft(session.pkg, snapshot.namespace, snapshot.draft);
        const sourceDigests = Object.create(null);
        for (const path of new Set(snapshot.review.threads.map(t => decodeLocator(t.loc)[1]))) {
          if (!session.digests.has(path)) session.digests.set(path, session.pkg.document(path).then(sourceDigest));
          sourceDigests[path] = await session.digests.get(path);
        }
        if (sequence !== workSequence || session !== active) return;
        if (!store || !session.record) throw new Error('Browser storage is unavailable.');
        if (session.locked) throw new Error('Saved work needs recovery before it can be replaced. Copy or export your current work.');
        const result = await store.work(session.key, session.generation, {...snapshot, draft, sourceDigests}, session.expected);
        if (result.conflict) { session.locked = true; throw new Error('Another tab changed this work. Your version is available under saved recovery.'); }
        session.expected = result;
        if (sequence === workSequence && session === active) {
          failed = false; lossGuard(false); ui.notice('Saved in this browser');
          const pointer = tabRead(); tabWrite({...pointer, packageKey: session.key, activeDraftKey: draft?.targetKey});
        }
        await refresh();
      } catch (error) { failure(error); await refresh(); }
    });
    return workQueue;
  }
  const workTimer = debounce(saveWork, 400, 1500);
  reviews.subscribe(kind => {
    if (!active) return;
    if (kind === 'flush') { void workTimer.flush(); return; }
    intent++; restoring = false; workSequence++; lossGuard(true);
    ui.notice('Saving…'); ui.exported(reviews.snapshot().dirty);
    workTimer.schedule();
    if (['cancel', 'submit', 'state', 'export'].includes(kind)) void workTimer.flush();
  });
  function position() {
    if (!active || restoring || !getModel()) return;
    pendingPosition = {session: active, model: getModel(), value: capturePosition(article(), reader.capture())};
    positionTimer.schedule();
  }
  function flushPosition() {
    const pending = pendingPosition; pendingPosition = undefined;
    if (!pending) return positionQueue;
    positionQueue = positionQueue.catch(() => {}).then(async () => {
      try {
        if (!store || !pending.session.record || pending.session.protectedPositions.has(pending.model.path)) return;
        const value = {...pending.value, digest: await sourceDigest(pending.model)};
        await store.position(pending.session.key, pending.session.record.generation, value);
        if (active === pending.session) tabWrite({...tabRead(), packageKey: active.key, documentPath: value.documentPath});
      } catch (error) { failure(error); }
    });
    return positionQueue;
  }
  const positionTimer = debounce(flushPosition, 250, 1000);
  async function flush() {
    position(); workTimer.cancel(); positionTimer.cancel();
    await Promise.all([saveWork(), flushPosition()]);
  }
  // Input cancels a delayed layout restore before it can move the viewport.
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'input'])
    document.addEventListener(type, () => { intent++; if (active) restoring = false; }, {passive: true});
  document.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = undefined; position(); });
  }, {passive: true, capture: true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
  window.addEventListener('pagehide', () => { void flush(); });
  if (hasFilePicker()) {
    enhanced.hidden = false; standardLabel.textContent = 'Choose file (standard picker)';
    enhanced.addEventListener('click', () => {
      intent++; pendingPick = undefined;
      choosePackage().then(source => receive(source)).catch(error => {
        if (error.name !== 'AbortError') ui.offer('The enhanced picker could not open a file. Use the standard picker.', 'Choose file again', () => fileInput.click());
      });
    });
  }
  fileInput.addEventListener('cancel', () => { pendingPick = undefined; });
  standardLabel.parentElement.addEventListener('pointerdown', () => { pendingPick = undefined; });
  try { store = await openStore(); await refresh(); }
  catch (error) { failure(error); }
  return {
    position, flush, hasUnsaved: () => dirty,
    picked() { const expected = pendingPick; pendingPick = undefined; return expected; },
    mismatch(source) { ui.offer('This is a different package/version. Saved work for the expected package has been retained.',
      'Open as separate package', () => receive(source)); },
    async prepare(pkg, source) {
      const key = packageKey(pkg.manifest), result = {key, pkg, source, digests: new Map(), protectedPositions: new Set(), expected: {review: 0, draft: 0}, issues: []};
      if (!store) return result;
      let snapshot;
      try {
        snapshot = await store.restore(key);
        result.record = snapshot.record;
        if (!result.record) return result;
        envelope(result.record);
        const p = result.record;
        result.documentPath = tabRead()?.packageKey === key ? tabRead().documentPath : p.documentPath;
        if (p.reviewNamespace) {
          const saved = snapshot.review;
          if (saved) { result.savedReview = await validateReview(saved, pkg); result.expected.review = saved.revision; }
        }
        if (p.activeDraftKey) {
          const draft = snapshot.draft;
          result.expected.draftKey = p.activeDraftKey; result.expected.draft = draft?.revision ?? 0;
          if (draft && !draft.tombstone) {
            result.pendingDraft = {fields: draft, ...await decodeDraft(pkg, draft, result.savedReview?.review, result.savedReview?.namespace)};
          }
        }
      } catch (error) {
        result.locked = true;
        result.issues.push({reason: 'Saved work could not be restored: ' + error.message,
          text: recoveryText(snapshot?.draft || snapshot?.review || result.record),
          discard: async () => {
            if (!window.confirm('Delete the saved drafts and review for this package? Copy any recovery text you need first.')) return;
            await store.deleteWork(key);
            if (active?.key === key) {
              workSequence++; workTimer.cancel(); active.record = await store.read('packages', key);
              active.generation = active.record.generation;
              active.expected = {review: 0, draft: 0}; active.pendingDraft = undefined; active.locked = false;
              reviews.setPackage(getPackage()); lossGuard(false);
            }
            recovery = []; ui.clearOffer(); await refresh();
          }});
      }
      return result;
    },
    async attach(session) {
      intent++; workSequence++; workTimer.cancel(); positionTimer.cancel(); pendingPosition = undefined;
      active = session; restoring = true; failed = false; lossGuard(false); recovery = session.issues;
      session.generation = session.record?.generation ?? 0;
      session.metadata = {filename: session.pkg.name, size: session.source.blob.size, lastModified: session.source.blob.lastModified,
        namespace: session.pkg.manifest.namespace, current: session.pkg.manifest.current};
      if (session.savedReview && !session.locked) reviews.hydrate(session.savedReview);
      reviews.deferDraft(!!session.pendingDraft && !session.locked);
      ui.exported(reviews.snapshot().dirty); ui.clearOffer();
      if (session.pendingDraft && !session.locked) ui.offer(`Your saved draft belongs to ${session.pendingDraft.path}.`,
        `Resume draft in ${session.pendingDraft.path}`, () => navigate(session.pendingDraft.path));
      if (store) try {
        session.record = await store.openPackage(session.key, session.metadata);
        if (session.source.handle) try { await store.saveHandle(session.key, session.source.handle); }
        catch { ui.offer('This browser could not remember file access. Saved work can still resume after choosing the file again.'); }
        await store.prune();
      } catch (error) { failure(error); }
      await refresh();
    },
    async navigated(model, restore = false) {
      const session = active, generation = ++intent;
      if (!session) return;
      restoring = restore;
      if (restore) { positionTimer.cancel(); pendingPosition = undefined; }
      if (restore && store) try {
        const saved = await store.read('positions', [session.key, model.path]);
        if (saved) {
          envelope(saved, 32768);
          const message = await restorePosition(article(), reader, model, saved,
            () => active === session && intent === generation && getModel() === model);
          if (message) { session.protectedPositions.add(model.path); ui.offer(message); }
        }
      } catch (error) { session.protectedPositions.add(model.path); ui.offer('Reading position was retained for recovery: ' + error.message); }
      if (session !== active || getModel() !== model) return;
      if (generation !== intent) { restoring = false; position(); return; }
      restoring = false;
      const draft = session.pendingDraft;
      if (draft && !session.locked) {
        if (draft.path === model.path && !reviews.snapshot().draft) {
          reviews.restoreDraft(draft.context, draft.fields); session.pendingDraft = undefined;
          ui.clearOffer();
          ui.notice('Saved draft restored');
        } else if (draft.path !== model.path) ui.offer(`Your saved draft belongs to ${draft.path}.`, `Resume draft in ${draft.path}`, () => navigate(draft.path));
      }
      position(); await flushPosition();
      await refresh();
    },
    async startup() {
      if (!store || getPackage()) return;
      const generation = intent;
      try {
        const tab = tabRead(), snapshot = await store.restore(tab?.packageKey);
        const pointer = tab ?? snapshot.resume, p = snapshot.record;
        if (generation === intent && !getPackage() && p && !p.removed) await reopen(p, pointer.documentPath, true);
      } catch (error) { failure(error); }
    },
  };
}
