import {newReview, newComment, newThread, validateComments} from '../review/comments.js';
import {decodeLocator} from '../address/reference.js';
import {emitReview} from '../review/emit.js';
import {reviewFile, markdownFile, downloadReview} from '../review/out.js';
import {reviewMarkdown} from '../review/markdown.js';
import {commentInterval} from './comment-anchor.js';
import {authorName} from './author-name.js';

// A review exported against a synthesized loose file names a (namespace,
// snapshot id) pair that exists nowhere: the recipient cannot obtain the
// original it claims to review. CARD-0062 decision 2 allows the export in v1
// provided every surface that offers it says so.
export const LOOSE_EXPORT_CAVEAT = 'This document was opened as a loose Markdown file. ' +
  'An exported review references a synthesized snapshot that exists only on this device, not a packaged .mdpkg the recipient can obtain.';

// Looseness belongs to the opened package, not to one call. persistence/session.js
// re-runs setPackage(getPackage()) after "Delete saved work" and after a recovery
// discard; a per-call argument defaulted to false there and silently took the
// export caveat away while the same synthesized package was still open
// (review 30af66b7, defect 1). Keying off the package object makes every call
// site preserve it, including ones written later.
const loosePackages = new WeakSet();
export function markLoose(pkg) { if (pkg) loosePackages.add(pkg); }

// D-2: reviewers do not comment top to bottom, so rank every thread by where it
// sits in the reviewed source rather than when it was authored. Gather the
// distinct paths first: pkg.document caches only the active document, so each
// path is read and outlined exactly once. Ranks, not raw offsets, because two
// documents both start at offset 0 and the renderer takes one numeric key.
async function documentOrder(pkg, review) {
  const position = new Map(pkg.documents.map((entry, index) => [entry.name, index]));
  const ranked = [];
  for (const path of new Set(review.threads.map(thread => decodeLocator(thread.loc)[1]))) {
    const model = await pkg.document(path);
    for (const thread of review.threads) {
      if (decodeLocator(thread.loc)[1] !== path) continue;
      ranked.push([thread.id, position.get(path) ?? 0, commentInterval(model, thread.loc, thread.select).start]);
    }
  }
  ranked.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  const ranks = new Map(ranked.map(([id], rank) => [id, rank]));
  return thread => ranks.get(thread.id);
}

export function reviewView(host, getContext, onNavigate) {
  host.className = 'review-panel';
  host.hidden = true;
  host.innerHTML = `<h2>Review</h2>
    <p>Select text in the reader, or review the selected section. Review files contain feedback; send them back with access to the original package.</p>
    <p class="review-memory">Browser saving and review export are separate. Download your review to return feedback.</p>
    <p class="review-loose" hidden></p>
    <div class="review-actions"><button type="button" data-action="text">Review selected text</button><button type="button" data-action="scope">Review selected section</button></div>
    <form class="review-editor" hidden>
      <p class="review-target"></p><pre class="review-quote"></pre>
      <label>Your name <input name="author" autocomplete="name" maxlength="200" required></label>
      <button type="button" class="review-author" aria-label="Edit name" hidden></button>
      <label>Kind <select name="kind" aria-label="Kind"><option value="comment">Comment</option><option value="change-request">Change request</option></select></label>
      <label>Feedback <textarea name="body" rows="4" required maxlength="65536"></textarea></label>
      <div class="review-actions"><button type="submit">Save comment</button><button type="button" data-action="cancel">Cancel</button></div>
    </form>
    <p class="review-status" role="status" aria-live="polite"></p>
    <div class="review-threads"></div>
    <div class="review-actions"><button type="button" data-action="prepare">Prepare review file</button><button type="button" data-action="download" hidden>Download review</button><button type="button" data-action="share" hidden>Share review</button></div>
    <div class="review-actions"><button type="button" data-action="copy-markdown">Copy review as Markdown</button><button type="button" data-action="download-markdown">Download as Markdown</button></div>
    <label class="review-markdown-label" hidden>Review as Markdown <textarea class="review-markdown" rows="6" readonly spellcheck="false"></textarea></label>`;
  const find = selector => host.querySelector(selector), action = name => find(`[data-action="${name}"]`);
  const form = find('form'), author = form.elements.author, kind = form.elements.kind, body = form.elements.body;
  const name = authorName(author, find('.review-author'));
  // namespace is the private editing workspace ID, never an exported namespace.
  let pkg, review = newReview(), namespace, composing, prepared, artifact, revision = 0, dirty = false, preparing = false, looseSource = false;
  let listener = () => {}, presentation = () => {}, exportRevision = 0, deferredDraft = false;
  const threadElements = new Map(), targetLabel = find('.review-target'), targetQuote = form.querySelector('.review-quote');
  const notify = kind => { listener(kind); presentation(kind); };
  // Scoped to the loose-file case only: a real .mdpkg export is unaffected.
  const caveat = message => looseSource ? message + ' ' + LOOSE_EXPORT_CAVEAT : message;
  const status = (message, error = false) => { find('.review-status').textContent = message; find('.review-status').classList.toggle('error', error); };
  function invalidate() {
    revision++; dirty = true; prepared = artifact = undefined;
    action('download').hidden = action('share').hidden = true;
    // The fallback holds a rendered snapshot, so every change to the review
    // makes it stale. Off HTTPS/localhost navigator.clipboard does not exist and
    // that box is the only copy path, so a stale one that is still visible and
    // still labelled gets copied: the reviewer returns an export silently
    // missing the change they just made (review dcdede68, defect 1). Hide it
    // here, not in draw() — the thread-state handler invalidates without
    // redrawing — and let the next Copy render it again.
    hideMarkdown();
  }
  function closeEditor() { composing = undefined; form.hidden = true; body.value = ''; }
  // Never leave a previous review's text in the manual-copy fallback.
  function hideMarkdown() { find('.review-markdown-label').hidden = true; find('.review-markdown').value = ''; }
  // Engines disagree on what focus() reveals: Chromium centres the field,
  // Firefox reveals its nearest edge, WebKit reveals only the caret line and
  // does so asynchronously. Reveal the editor explicitly once it is placed.
  function reveal() {
    body.focus({preventScroll: true});
    // A form taller than the viewport cannot fit; show its end (feedback and Save) rather than its header.
    form.scrollIntoView({block: form.getBoundingClientRect().height > innerHeight ? 'end' : 'nearest', inline: 'nearest'});
    body.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  function edit(target, fields, focus = true) {
    if (deferredDraft) { status('Resume or cancel your saved draft before starting another comment.', true); return; }
    if (composing) { presentation('edit'); reveal(); status('Save or cancel your current comment first.', true); return; }
    composing = target;
    form.hidden = false;
    name.show(fields?.author);
    kind.value = fields?.kind ?? 'comment'; body.value = fields?.body ?? '';
    targetLabel.textContent = target.thread ? 'Reply to this thread' :
      `${target.model.path} · ${target.anchor.scope.title.replace(/\n/g, ' ')} · Exact source quote`;
    targetQuote.textContent = target.thread?.select.quote ?? target.anchor.select.quote;
    if (focus) { revision++; prepared = artifact = undefined; action('download').hidden = action('share').hidden = true; notify('edit'); reveal(); }
    else presentation('restore');
  }
  function draw() {
    const list = find('.review-threads'); list.replaceChildren();
    threadElements.clear();
    for (const thread of review.threads) {
      const article = document.createElement('section'); article.className = 'review-thread';
      const heading = document.createElement('button'), locator = decodeLocator(thread.loc);
      heading.type = 'button'; heading.textContent = `${locator[1]} · ${locator[2].at(-1)?.[0] ?? locator[0]}`;
      heading.addEventListener('click', () => onNavigate(locator));
      const quote = document.createElement('pre'); quote.className = 'review-quote'; quote.textContent = thread.select.quote;
      const label = document.createElement('label'); label.textContent = 'Thread state ';
      const state = document.createElement('select'); state.setAttribute('aria-label', 'Thread state');
      for (const value of ['open', 'resolved', 'obsolete']) state.add(new Option(value, value));
      state.value = thread.state;
      state.addEventListener('change', () => { thread.state = state.value; invalidate(); notify('state'); status('Thread state saved. Prepare a new review file to include it.'); });
      label.append(state); article.append(heading, quote, label);
      for (const comment of thread.comments) {
        const entry = document.createElement('div'); entry.className = 'review-comment';
        const metadata = document.createElement('p');
        metadata.textContent = `${comment.kind === 'change-request' ? 'Change request' : 'Comment'} · ${comment.author} · ${comment.at}${comment.inReplyTo ? ' · Reply' : ''}`;
        const content = document.createElement('p'); content.className = 'review-body'; content.textContent = comment.body;
        const reply = document.createElement('button'); reply.type = 'button'; reply.textContent = 'Reply';
        reply.addEventListener('click', () => edit({thread, inReplyTo: comment.id}));
        entry.append(metadata, content, reply); article.append(entry);
      }
      list.append(article);
      threadElements.set(thread.id, article);
    }
    action('prepare').disabled = !review.threads.length || preparing;
    action('copy-markdown').disabled = action('download-markdown').disabled = !review.threads.length;
    presentation('draw');
  }
  for (const [name, whole] of [['text', false], ['scope', true]]) {
    action(name).addEventListener('mousedown', event => event.preventDefault());
    action(name).addEventListener('click', () => {
      try {
        const {model, anchor} = getContext(whole);
        edit({model, anchor});
      } catch (error) { status(error.message, true); }
    });
  }
  action('cancel').addEventListener('click', () => { closeEditor(); revision++; notify('cancel'); });
  const input = () => { prepared = artifact = undefined; revision++; action('download').hidden = action('share').hidden = true; notify('input'); };
  form.addEventListener('input', input); form.addEventListener('change', input);
  form.addEventListener('focusout', () => listener('flush'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!composing || !body.value.trim()) { status('Enter feedback before saving.', true); return; }
    const target = composing, opened = pkg, generation = revision;
    const comment = newComment(author.value.trim(), kind.value, body.value, target.inReplyTo);
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const thread = target.thread ?? await newThread(opened, target.model, target.anchor, comment);
      if (opened !== pkg || target !== composing || generation !== revision) return;
      const candidate = structuredClone(review);
      if (target.thread) candidate.threads.find(t => t.id === thread.id).comments.push(comment);
      else candidate.threads.push(thread);
      validateComments(candidate);
      review = candidate;
      name.remember(comment.author);
      closeEditor(); invalidate(); draw(); notify('submit'); status('Comment saved in this tab. Prepare a review file to export it.');
    } catch (error) { if (opened === pkg) status(error.message, true); }
    finally { submit.disabled = false; }
  });
  action('prepare').addEventListener('click', async () => {
    if (composing || deferredDraft) { status('Save or cancel your current comment before exporting.', true); return; }
    const opened = pkg, generation = revision;
    preparing = true; draw(); status('Building and validating review file…');
    try {
      const candidate = artifact ?? {namespace: crypto.randomUUID(), revision: generation,
        target: {namespace: opened.manifest.namespace, current: structuredClone(opened.manifest.current)}};
      // Persist plain bytes: some IndexedDB implementations cannot store Blobs.
      const bytes = candidate.bytes ?? (await emitReview(opened, review, {namespace: candidate.namespace})).slice().buffer;
      if (opened !== pkg || generation !== revision) { if (opened === pkg) status('Draft changed. Prepare the review file again.'); return; }
      artifact = {...candidate, bytes};
      await listener('prepare');
      if (opened !== pkg || generation !== revision) return;
      prepared = reviewFile(bytes, opened.name);
      action('download').hidden = false;
      action('share').hidden = !(navigator.canShare?.({files: [prepared]}) && navigator.share);
      status(caveat(`Review ready: ${review.threads.length} threads. Snapshot hash, payloads and selectors checked. Download or share the file.`));
    } catch (error) { if (opened === pkg) status('Could not prepare review: ' + error.message, true); }
    finally { preparing = false; draw(); }
  });
  action('download').addEventListener('click', () => {
    if (!prepared) return;
    try { downloadReview(prepared); dirty = false; exportRevision = revision; listener('export'); status(caveat('Review download requested. Keep the file to return your feedback.')); }
    catch (error) { status('Download failed: ' + error.message, true); }
  });
  // The Markdown export is a second, independent artifact: it writes no
  // manifest and makes no identity claim (plan §3), so it neither invalidates a
  // prepared .mdpkg nor counts as returning the review. Never touch prepared,
  // artifact, revision, dirty or exportRevision from here.
  async function markdown() {
    if (composing || deferredDraft) { status('Save or cancel your current comment before exporting.', true); return; }
    const opened = pkg, value = review;
    let order;
    // A stale quote makes only the ordering unavailable, not the export. Degrade
    // to authoring order rather than refusing to render stored comments.
    try { order = await documentOrder(opened, value); } catch { order = undefined; }
    if (opened !== pkg || value !== review) return;
    return reviewMarkdown(value, {packageName: opened.name, order});
  }
  action('copy-markdown').addEventListener('click', async () => {
    let text;
    try { text = await markdown(); } catch (error) { status('Could not render Markdown: ' + error.message, true); return; }
    if (text === undefined) return;
    try { await navigator.clipboard.writeText(text); hideMarkdown(); status(`Review copied as Markdown: ${review.threads.length} threads.`); }
    catch {
      // writeText needs a secure context and can be denied; the panel has no
      // other text field to fall back to, so reveal one (main.js:347-364).
      const field = find('.review-markdown');
      find('.review-markdown-label').hidden = false;
      field.value = text; field.focus(); field.select();
      status('Select and copy the Markdown from the text box.');
    }
  });
  action('download-markdown').addEventListener('click', async () => {
    let text;
    try { text = await markdown(); } catch (error) { status('Could not render Markdown: ' + error.message, true); return; }
    if (text === undefined) return;
    try { downloadReview(markdownFile(text, pkg.name)); status('Markdown download requested. It is a readable copy, not a review file.'); }
    catch (error) { status('Download failed: ' + error.message, true); }
  });
  action('share').addEventListener('click', async () => {
    const file = prepared, generation = revision, opened = pkg;
    if (!file) return;
    try { await navigator.share({files: [file]}); if (opened === pkg && generation === revision) { dirty = false; exportRevision = revision; listener('export'); status(caveat('Review shared.')); } }
    catch (error) { if (opened === pkg && generation === revision) status(error.name === 'AbortError' ? 'Sharing cancelled. Your review is ready to download.' : 'Sharing failed. Download the review file instead.', error.name !== 'AbortError'); }
  });
  return {
    display(listener) { presentation = listener; },
    view: () => ({review, composing, form, threadElements, home: host, list: find('.review-threads')}),
    subscribe(value) { listener = value; },
    revision: () => revision,
    snapshot() {
      return {namespace, review: structuredClone(review), revision, exportRevision, dirty, artifact: artifact && structuredClone(artifact),
        draft: composing ? {context: composing, author: author.value, kind: kind.value, body: body.value} : undefined};
    },
    hydrate(saved, draft) {
      review = structuredClone(saved.review); namespace = saved.namespace;
      revision = saved.contentRevision ?? 0; exportRevision = saved.exportRevision ?? -1;
      dirty = review.threads.length > 0 && exportRevision !== revision;
      closeEditor(); artifact = saved.artifact; prepared = artifact ? reviewFile(artifact.bytes, pkg.name) : undefined;
      action('download').hidden = !prepared;
      action('share').hidden = !prepared || !(navigator.canShare?.({files: [prepared]}) && navigator.share);
      draw();
      if (draft) edit(draft.context, draft.fields, false);
    },
    deferDraft(value) { deferredDraft = value; },
    restoreDraft(context, fields) { deferredDraft = false; edit(context, fields, false); },
    hasUnsaved: () => dirty || !!composing,
    setPackage(value) {
      pkg = value; review = newReview(); namespace = value ? crypto.randomUUID() : undefined;
      looseSource = !!value && loosePackages.has(value);
      find('.review-loose').textContent = looseSource ? LOOSE_EXPORT_CAVEAT : '';
      find('.review-loose').hidden = !looseSource;
      revision++; exportRevision = revision; dirty = false; prepared = artifact = undefined; deferredDraft = false; closeEditor(); hideMarkdown();
      action('download').hidden = action('share').hidden = true;
      host.hidden = !value; status(''); draw();
    },
  };
}
