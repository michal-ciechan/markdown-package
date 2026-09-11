import {newReview, newComment, newThread, validateComments} from '../review/comments.js';
import {decodeLocator} from '../address/reference.js';
import {emitReview} from '../review/emit.js';
import {reviewFile, downloadReview} from '../review/out.js';

export function reviewView(host, getContext, onNavigate) {
  host.className = 'review-panel';
  host.hidden = true;
  host.innerHTML = `<h2>Review</h2>
    <p>Select text in the reader, or review the selected section. Review files contain feedback; send them back with access to the original package.</p>
    <p class="review-memory">Browser saving and review export are separate. Download your review to return feedback.</p>
    <div class="review-actions"><button type="button" data-action="text">Review selected text</button><button type="button" data-action="scope">Review selected section</button></div>
    <form class="review-editor" hidden>
      <p class="review-target"></p><pre class="review-quote"></pre>
      <label>Your name <input name="author" autocomplete="name" maxlength="200" required></label>
      <label>Kind <select name="kind" aria-label="Kind"><option value="comment">Comment</option><option value="change-request">Change request</option></select></label>
      <label>Feedback <textarea name="body" rows="4" required maxlength="65536"></textarea></label>
      <div class="review-actions"><button type="submit">Save comment</button><button type="button" data-action="cancel">Cancel</button></div>
    </form>
    <p class="review-status" role="status" aria-live="polite"></p>
    <div class="review-threads"></div>
    <div class="review-actions"><button type="button" data-action="prepare">Prepare review file</button><button type="button" data-action="download" hidden>Download review</button><button type="button" data-action="share" hidden>Share review</button></div>`;
  const find = selector => host.querySelector(selector), action = name => find(`[data-action="${name}"]`);
  const form = find('form'), author = form.elements.author, kind = form.elements.kind, body = form.elements.body;
  let pkg, review = newReview(), namespace, composing, prepared, revision = 0, dirty = false, savedAuthor = '', preparing = false;
  let listener = () => {}, presentation = () => {}, exportRevision = 0, deferredDraft = false;
  const threadElements = new Map(), targetLabel = find('.review-target'), targetQuote = form.querySelector('.review-quote');
  const notify = kind => { listener(kind); presentation(kind); };
  const status = (message, error = false) => { find('.review-status').textContent = message; find('.review-status').classList.toggle('error', error); };
  function invalidate() {
    revision++; dirty = true; prepared = undefined;
    action('download').hidden = action('share').hidden = true;
  }
  function closeEditor() { composing = undefined; form.hidden = true; body.value = ''; }
  function edit(target, fields, focus = true) {
    if (deferredDraft) { status('Resume or cancel your saved draft before starting another comment.', true); return; }
    if (composing) { body.focus(); status('Save or cancel your current comment first.', true); return; }
    composing = target;
    form.hidden = false;
    author.value = fields?.author ?? savedAuthor;
    kind.value = fields?.kind ?? 'comment'; body.value = fields?.body ?? '';
    targetLabel.textContent = target.thread ? 'Reply to this thread' :
      `${target.model.path} · ${target.anchor.scope.title.replace(/\n/g, ' ')} · Exact source quote`;
    targetQuote.textContent = target.thread?.select.quote ?? target.anchor.select.quote;
    if (focus) { revision++; notify('edit'); body.focus(); }
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
  const input = () => { prepared = undefined; revision++; action('download').hidden = action('share').hidden = true; notify('input'); };
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
      savedAuthor = comment.author;
      closeEditor(); invalidate(); draw(); notify('submit'); status('Comment saved in this tab. Prepare a review file to export it.');
    } catch (error) { if (opened === pkg) status(error.message, true); }
    finally { submit.disabled = false; }
  });
  action('prepare').addEventListener('click', async () => {
    if (composing || deferredDraft) { status('Save or cancel your current comment before exporting.', true); return; }
    const opened = pkg, generation = revision;
    preparing = true; draw(); status('Building and validating review file…');
    try {
      const bytes = await emitReview(opened, review, {namespace});
      if (opened !== pkg || generation !== revision) { if (opened === pkg) status('Draft changed. Prepare the review file again.'); return; }
      prepared = reviewFile(bytes, opened.name);
      action('download').hidden = false;
      action('share').hidden = !(navigator.canShare?.({files: [prepared]}) && navigator.share);
      status(`Review ready: ${review.threads.length} threads. Structural checks passed. Download or share the file.`);
    } catch (error) { if (opened === pkg) status('Could not prepare review: ' + error.message, true); }
    finally { preparing = false; draw(); }
  });
  action('download').addEventListener('click', () => {
    if (!prepared) return;
    try { downloadReview(prepared); dirty = false; exportRevision = revision; listener('export'); status('Review download requested. Keep the file to return your feedback.'); }
    catch (error) { status('Download failed: ' + error.message, true); }
  });
  action('share').addEventListener('click', async () => {
    const file = prepared, generation = revision;
    if (!file) return;
    try { await navigator.share({files: [file]}); if (generation === revision) { dirty = false; exportRevision = revision; listener('export'); status('Review shared.'); } }
    catch (error) { if (generation === revision) status(error.name === 'AbortError' ? 'Sharing cancelled. Your review is ready to download.' : 'Sharing failed. Download the review file instead.', error.name !== 'AbortError'); }
  });
  return {
    display(listener) { presentation = listener; },
    view: () => ({review, composing, form, threadElements, home: host, list: find('.review-threads')}),
    subscribe(value) { listener = value; },
    revision: () => revision,
    snapshot() {
      return {namespace, review: structuredClone(review), revision, exportRevision, dirty,
        draft: composing ? {context: composing, author: author.value, kind: kind.value, body: body.value} : undefined};
    },
    hydrate(saved, draft) {
      review = structuredClone(saved.review); namespace = saved.namespace;
      revision = saved.contentRevision ?? 0; exportRevision = saved.exportRevision ?? -1;
      dirty = review.threads.length > 0 && exportRevision !== revision;
      closeEditor(); prepared = undefined; draw();
      if (draft) edit(draft.context, draft.fields, false);
    },
    deferDraft(value) { deferredDraft = value; },
    restoreDraft(context, fields) { deferredDraft = false; edit(context, fields, false); },
    hasUnsaved: () => dirty || !!composing,
    setPackage(value) {
      pkg = value; review = newReview(); namespace = value ? crypto.randomUUID() : undefined;
      revision++; exportRevision = revision; dirty = false; prepared = undefined; deferredDraft = false; closeEditor();
      action('download').hidden = action('share').hidden = true;
      host.hidden = !value; status(''); draw();
    },
  };
}
