import {openPackage} from './inbound/open.js';
import {documentList} from './ui/documents.js';
import {readerView} from './ui/reader-view.js';
import {reviewView} from './ui/review-view.js';
import {referenceFor} from './address/resolve.js';
import {destination, markdownLink} from './links/destination.js';
import {referencePreview} from './ui/reference-preview.js';
import {displayFor} from './links/display.js';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="app-header">
    <div><h1>Markdown Package</h1><p>Open a package. Read its documents. Follow a reference.</p></div>
    <div class="open-actions"><button id="enhanced-open" type="button" hidden>Open package</button>
    <label class="open-button"><span id="standard-open-label">Open package</span><input id="package-file" type="file"></label></div>
  </header>
  <main>
    <div id="activity" role="status" aria-live="polite">Choose a file, or drop or paste a package here. Files stay on this device.</div>
    <section id="saved-sessions" aria-label="Browser history and saved work"></section>
    <section id="package-details" hidden aria-label="Package details"></section>
    <details id="conformance" hidden><summary>Package conformance findings</summary><ul></ul></details>
    <form id="reference-form" hidden>
      <label for="reference">Addressing reference</label>
      <div class="reference-row"><input id="reference" type="text" spellcheck="false" placeholder="mdpkg://…" required><button type="submit">Resolve</button></div>
      <p id="resolution" role="status" aria-live="polite"></p>
    </form>
    <div id="browser" class="browser" hidden>
      <nav id="documents" aria-label="Package documents"></nav>
      <section class="reader-panel" aria-label="Document reader">
        <button id="back-reference" type="button" hidden>Back to reference</button>
        <div id="reader"></div>
        <div id="reference-tools" hidden>
          <button id="make-reference" type="button">Reference to selected section</button>
          <label id="generated-label" hidden>Reference <textarea id="generated-reference" rows="3" readonly spellcheck="false"></textarea></label>
          <button id="copy-reference" type="button" hidden>Copy reference</button>
          <label id="link-label-control" hidden>Link label <input id="link-label" type="text"></label>
          <button id="copy-markdown" type="button" hidden>Copy Markdown link</button>
          <label id="generated-markdown-label" hidden>Markdown link <textarea id="generated-markdown" rows="3" readonly spellcheck="false"></textarea></label>
        </div>
        <section id="review" aria-label="Review authoring"></section>
      </section>
    </div>
  </main>`;

const element = id => document.getElementById(id);
const activity = element('activity'), resolution = element('resolution');
let pkg, currentDocument, currentScope, openGeneration = 0, navigationGeneration = 0, returnLocation;
let savedSessions;
const documents = documentList(element('documents'), name => showDocument(name));
const preview = referencePreview({getPackage: () => pkg, onOpen: openPreview,
  onBrowse: () => element('documents').querySelector('button')?.focus(), onOrdinary: navigate});
const reader = readerView(element('reader'), (...args) => preview.activate(...args), scope => {
  currentScope = scope;
  clearGeneratedReference();
  savedSessions?.position();
}, () => element('review').querySelector('[data-action="text"]').click(), () => preview.close(false));
const reviews = reviewView(element('review'), whole => ({model: currentDocument, anchor: reader.anchor(whole)}), async locator => {
  await showDocument(locator[1]);
  const scope = currentDocument?.path === locator[1] && currentDocument.find(locator);
  if (scope) reader.select(scope);
});
// Keep persistence isolated from parsing and permission prompts. This optional
// capability chunk can fail without taking down in-memory reading/authoring.
const persistenceReady = import('./persistence/session.js').then(async ({persistence}) => {
  savedSessions = await persistence({host: element('saved-sessions'), reviews, reader,
    article: () => element('reader').querySelector('article'), receive, navigate: showDocument,
    getModel: () => currentDocument, getPackage: () => pkg, fileInput: element('package-file'),
    enhanced: element('enhanced-open'), standardLabel: element('standard-open-label')});
  void savedSessions.startup();
  return savedSessions;
}).catch(error => {
  element('saved-sessions').textContent = 'Browser saving is unavailable. Keep this tab open or export your review. ' + error.message;
  const guard = event => { event.preventDefault(); event.returnValue = ''; };
  reviews.subscribe(() => {
    window.removeEventListener('beforeunload', guard);
    if (reviews.hasUnsaved()) window.addEventListener('beforeunload', guard);
  });
});

function report(message, error = false) {
  activity.textContent = message;
  activity.className = error ? 'error' : '';
}
function clearGeneratedReference() {
  element('link-label-control').hidden = true;
  element('copy-markdown').hidden = true;
  element('generated-markdown-label').hidden = true;
  element('generated-markdown').value = '';
  element('generated-label').hidden = true;
  element('copy-reference').hidden = true;
  element('generated-reference').value = '';
}
function displayDocument(model, scope) {
  currentDocument = model;
  reader.show(model, scope);
  documents.select(model.path);
  element('reference-tools').hidden = false;
}

async function receive(source, expectedKey, documentPath) {
  if (source instanceof Blob) source = {blob: source, sourceKind: 'file'};
  const {blob} = source;
  const generation = ++openGeneration;
  report('Opening ' + (blob.name || 'package') + '…');
  try {
    const opened = await openPackage(blob);
    await persistenceReady;
    await savedSessions?.flush();
    const outgoingRevision = reviews.revision();
    const prepared = await savedSessions?.prepare(opened, source);
    if (generation !== openGeneration) return;
    if (outgoingRevision !== reviews.revision()) { report('Feedback changed while opening. The current package was kept; choose the new package again.'); return; }
    if (expectedKey && prepared?.key !== expectedKey) { savedSessions.mismatch(source); return; }
    if ((savedSessions ? savedSessions.hasUnsaved() : reviews.hasUnsaved()) &&
        !window.confirm('This tab has feedback that could not be saved in this browser. Discard the unsaved changes and open another package?')) return;
    preview.close(false); returnLocation = undefined; element('back-reference').hidden = true;
    const initialNavigation = ++navigationGeneration;
    pkg = opened;
    reviews.setPackage(pkg);
    currentDocument = undefined; currentScope = undefined; reader.clear(); clearGeneratedReference();
    element('reference').value = ''; resolution.className = ''; resolution.textContent = '';
    const attached = prepared ? savedSessions.attach(prepared) : Promise.resolve();
    const detail = element('package-details');
    detail.replaceChildren();
    const name = document.createElement('strong'), metadata = document.createElement('span');
    name.textContent = pkg.name;
    metadata.textContent = `${pkg.documents.length} documents · ${pkg.entries.length} entries · ${pkg.tier} typing tier`;
    const lineage = document.createElement('small');
    lineage.textContent = `Lineage ${pkg.manifest.namespace} · ${pkg.manifest.current}`;
    detail.append(name, metadata, lineage);
    detail.hidden = false;
    const findings = element('conformance');
    findings.hidden = !pkg.issues.length;
    findings.open = !!pkg.issues.length;
    findings.querySelector('ul').replaceChildren(...pkg.issues.map(issue => {
      const item = document.createElement('li');
      item.textContent = (issue.entry ? issue.entry + ': ' : '') + issue.message;
      return item;
    }));
    documents.setDocuments(pkg.documents);
    element('browser').hidden = false;
    element('reference-form').hidden = false;
    report(pkg.tier === 'recoverable' ? 'Package recovered. See the conformance findings below.' : 'Package opened.');
    await attached;
    // A later failed picker/open keeps this successfully installed package.
    // A successful replacement or explicit navigation owns the reader instead.
    if (pkg !== opened || navigationGeneration !== initialNavigation) return;
    const initialDocument = pkg.documents.find(entry => /\.(?:md|markdown)$/i.test(entry.name)) ?? pkg.documents[0];
    const remembered = documentPath ?? prepared?.documentPath;
    if (initialDocument) {
      const exists = remembered && pkg.documents.some(entry => entry.name === remembered);
      await showDocument(exists ? remembered : initialDocument.name, undefined, true);
      if (remembered && !exists) report('The saved document is missing. Its saved work was retained for recovery.', true);
    }
    else report(pkg.manifest.review ? 'Review package opened. It contains no ordinary documents; this viewer does not yet display review threads.' : 'Package opened; its current view has no documents.');
  } catch (error) {
    if (generation === openGeneration) report('Could not open package: ' + error.message, true);
  }
}

async function showDocument(name, fragment, resume = false) {
  if (!pkg) return;
  preview.close(false);
  const opened = pkg, generation = ++navigationGeneration;
  await savedSessions?.flush();
  if (opened !== pkg || generation !== navigationGeneration) return;
  resolution.className = '';
  resolution.textContent = '';
  report('Reading ' + name + '…');
  try {
    const model = await opened.document(name);
    if (opened !== pkg || generation !== navigationGeneration) return;
    displayDocument(model);
    report(name);
    if (fragment && !reader.fragment(fragment)) report('Document opened; heading fragment was not found: ' + fragment, true);
    await savedSessions?.navigated(model, resume && !fragment);
  } catch (error) {
    if (opened === pkg && generation === navigationGeneration) {
      currentDocument = undefined;
      currentScope = undefined;
      reader.clear();
      clearGeneratedReference();
      element('reference-tools').hidden = true;
      report('Could not read document: ' + error.message, true);
    }
  }
}

async function resolve(value) {
  if (!pkg) return;
  preview.close(false);
  const opened = pkg, generation = ++navigationGeneration;
  await savedSessions?.flush();
  if (opened !== pkg || generation !== navigationGeneration) return;
  resolution.className = '';
  resolution.textContent = 'Resolving…';
  const result = await opened.resolve(value);
  if (opened !== pkg || generation !== navigationGeneration) return;
  resolution.className = result.navigation ? 'resolution' : `resolution ${result.status}`;
  if (result.status === 'unsupported') {
    resolution.textContent = 'Historical references are not available in this viewer yet. This reference has not been resolved.';
    return;
  }
  resolution.textContent = result.navigation ?
    (result.detail ? 'Could not navigate: ' + result.detail : 'Navigation only; no reviewed state.') :
    `${result.status} / ${result.reason}${result.detail ? ': ' + result.detail : ''}`;
  if (result.actualDigest) resolution.textContent += ' · Current digest ' + result.actualDigest;
  if (result.successors?.length) resolution.textContent += ' · Successor roots: ' + result.successors.join(', ');
  if (result.document) {
    displayDocument(result.document, result.scope);
    reader.select(result.scope);
    report(result.document.path);
    await savedSessions?.navigated(result.document);
  }
}

async function navigate(href, source = currentDocument?.path) {
  if (!source) return;
  try {
    const target = destination(source, href);
    if (target.kind === 'identity') { element('reference').value = href; await resolve(href); }
    else if (target.path) await showDocument(target.path, target.fragment);
  } catch (error) { report(error.message, true); }
}

async function openPreview(result, origin) {
  const opened = pkg;
  const from = reader.capture(origin);
  const path = result.document?.path ?? result.target?.path;
  if (!path) return;
  const loading = showDocument(path), generation = navigationGeneration;
  await loading;
  if (pkg !== opened || generation !== navigationGeneration || currentDocument?.path !== path) return;
  const scope = result.scope && currentDocument.find(result.scope.locator);
  if (scope) reader.select(scope);
  returnLocation = from; element('back-reference').hidden = false;
}
element('back-reference').addEventListener('click', async () => {
  const state = returnLocation, opened = pkg;
  if (!state) return;
  const loading = showDocument(state.path), generation = navigationGeneration;
  await loading;
  if (pkg !== opened || generation !== navigationGeneration || currentDocument?.path !== state.path) return;
  reader.restore(state); returnLocation = undefined; element('back-reference').hidden = true;
});

// Deliberately no accept attribute: the iOS picker must include public.data.
element('package-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) { const expected = savedSessions?.picked(); receive(file, expected?.key, expected?.documentPath); }
});
document.addEventListener('dragover', event => {
  if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  if (event.dataTransfer.files.length !== 1) { report('Open one package at a time.', true); return; }
  receive(event.dataTransfer.files[0]);
});
document.addEventListener('paste', event => {
  if (!event.clipboardData.files.length) return;
  event.preventDefault();
  if (event.clipboardData.files.length !== 1) { report('Paste one package at a time.', true); return; }
  receive(event.clipboardData.files[0]);
});
element('reference-form').addEventListener('submit', event => { event.preventDefault(); resolve(element('reference').value.trim()); });
element('make-reference').addEventListener('click', async () => {
  if (!pkg || !currentDocument || !currentScope) return;
  const opened = pkg, model = currentDocument, scope = currentScope;
  try {
    const reference = await referenceFor(opened, model, scope);
    if (opened !== pkg || model !== currentDocument || scope !== currentScope) return;
    element('generated-reference').value = reference;
    element('generated-label').hidden = false;
    element('copy-reference').hidden = false;
    element('link-label').value = (displayFor(model).headings.find(h => h.scope === scope)?.title ?? scope.title).replace(/\n/g, ' ');
    element('link-label-control').hidden = false;
    element('copy-markdown').hidden = false;
  } catch (error) { if (opened === pkg) report('Could not create reference: ' + error.message, true); }
});
element('copy-reference').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(element('generated-reference').value); report('Reference copied.'); }
  catch {
    element('generated-reference').focus();
    element('generated-reference').select();
    report('Select and copy the reference from the text box.');
  }
});

element('copy-markdown').addEventListener('click', async () => {
  const text = markdownLink(element('link-label').value, element('generated-reference').value);
  try { await navigator.clipboard.writeText(text); report('Markdown link copied.'); }
  catch {
    element('generated-markdown-label').hidden = false;
    const field = element('generated-markdown'); field.value = text; field.focus(); field.select();
    report('Select and copy the Markdown link from the text box.');
  }
});
