import {openPackage} from './inbound/open.js';
import {documentList} from './ui/documents.js';
import {readerView} from './ui/reader-view.js';
import {referenceFor} from './address/resolve.js';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="app-header">
    <div><h1>Markdown Package</h1><p>Open a package. Read its documents. Follow a reference.</p></div>
    <label class="open-button">Open package<input id="package-file" type="file"></label>
  </header>
  <main>
    <div id="activity" role="status" aria-live="polite">Choose a file, or drop or paste a package here. Files stay on this device.</div>
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
        <div id="reader"></div>
        <div id="reference-tools" hidden>
          <button id="make-reference" type="button">Reference to selected section</button>
          <label id="generated-label" hidden>Reference <textarea id="generated-reference" rows="3" readonly spellcheck="false"></textarea></label>
          <button id="copy-reference" type="button" hidden>Copy reference</button>
        </div>
      </section>
    </div>
  </main>`;

const element = id => document.getElementById(id);
const activity = element('activity'), resolution = element('resolution');
let pkg, currentDocument, currentScope, openGeneration = 0, navigationGeneration = 0;
const documents = documentList(element('documents'), name => showDocument(name));
const reader = readerView(element('reader'), href => navigate(href), scope => {
  currentScope = scope;
  clearGeneratedReference();
});

function report(message, error = false) {
  activity.textContent = message;
  activity.className = error ? 'error' : '';
}
function clearGeneratedReference() {
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

async function receive(blob) {
  const generation = ++openGeneration;
  navigationGeneration++;
  pkg = undefined;
  currentDocument = undefined;
  currentScope = undefined;
  reader.clear();
  clearGeneratedReference();
  for (const id of ['browser', 'package-details', 'conformance', 'reference-form', 'reference-tools']) element(id).hidden = true;
  element('reference').value = '';
  resolution.className = '';
  resolution.textContent = '';
  report('Opening ' + (blob.name || 'package') + '…');
  try {
    const opened = await openPackage(blob);
    if (generation !== openGeneration) return;
    pkg = opened;
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
    if (pkg.documents.length) await showDocument(pkg.documents[0].name);
    else report(pkg.manifest.review ? 'Review package opened. It contains no ordinary documents; this viewer does not yet display review threads.' : 'Package opened; its current view has no documents.');
  } catch (error) {
    if (generation === openGeneration) report('Could not open package: ' + error.message, true);
  }
}

async function showDocument(name, fragment) {
  if (!pkg) return;
  const opened = pkg, generation = ++navigationGeneration;
  resolution.className = '';
  resolution.textContent = '';
  report('Reading ' + name + '…');
  try {
    const model = await opened.document(name);
    if (opened !== pkg || generation !== navigationGeneration) return;
    displayDocument(model);
    report(name);
    if (fragment && !reader.fragment(fragment)) report('Document opened; heading fragment was not found: ' + fragment, true);
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
  const opened = pkg, generation = ++navigationGeneration;
  resolution.className = '';
  resolution.textContent = 'Resolving…';
  const result = await opened.resolve(value);
  if (opened !== pkg || generation !== navigationGeneration) return;
  resolution.className = `resolution ${result.status}`;
  if (result.status === 'unsupported') {
    resolution.textContent = 'Historical references are not available in this viewer yet. This reference has not been resolved.';
    return;
  }
  resolution.textContent = `${result.status} / ${result.reason}${result.detail ? ': ' + result.detail : ''}`;
  if (result.actualDigest) resolution.textContent += ' · Current digest ' + result.actualDigest;
  if (result.successors?.length) resolution.textContent += ' · Successor roots: ' + result.successors.join(', ');
  if (result.document) {
    displayDocument(result.document, result.scope);
    reader.select(result.scope);
    report(result.document.path);
  }
}

async function navigate(href) {
  if (href.startsWith('mdpkg:')) { element('reference').value = href; await resolve(href); return; }
  if (!currentDocument) return;
  try {
    // Package-relative navigation is a convenience, not review evidence.
    if (href.startsWith('//')) throw new Error('Protocol-relative external links are not package paths');
    const hash = href.indexOf('#');
    const path = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
    if (path.includes('?') || path.includes('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) throw new Error('Unsupported package link');
    const parts = path.startsWith('/') ? [] : currentDocument.path.split('/').slice(0, -1);
    if (!path) { if (fragment && !reader.fragment(fragment)) throw new Error('Heading fragment not found'); return; }
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) throw new Error('Link leaves the package'); parts.pop(); }
      else parts.push(part);
    }
    await showDocument(parts.join('/'), fragment);
  } catch (error) { report(error.message, true); }
}

// Deliberately no accept attribute: the iOS picker must include public.data.
element('package-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) receive(file);
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
