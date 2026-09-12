import {openContainer} from '../container/reader.js';
import {blobSource} from '../container/source.js';
import {isReserved} from '../container/conformance.js';
import {byteOrder} from '../format.js';
import {outline} from '../address/outline.js';
import {readLedger, resolveReference} from '../address/resolve.js';

// The one inbound boundary for file input, drag/drop, paste and future routes.
export async function openPackage(blob, options = {}) {
  const container = await openContainer(blobSource(blob), options);
  const documents = container.entries.filter(entry => !entry.directory && !isReserved(entry.name))
    .slice().sort((a, b) => byteOrder(a.name, b.name));
  // Retain only the active document. Navigation must not grow memory with every
  // file opened, and current addressing reads zero Git bytes.
  let cachedName, cachedDocument, ledger, previewName, previewDocument;
  const pkg = {
    ...container, get assurance() { return container.assurance; }, documents, name: blob.name || 'Untitled package',
    document(name) {
      if (!documents.some(document => document.name === name)) throw new Error('Not a package document: ' + name);
      if (cachedName !== name) {
        cachedName = name;
        cachedDocument = container.read(name).then(bytes => outline(bytes, name));
        cachedDocument.catch(() => {
          if (cachedName === name) { cachedName = undefined; cachedDocument = undefined; }
        });
      }
      return cachedDocument;
    },
    ledger() { return ledger ??= readLedger(container); },
    previewDocument(name) {
      const entry = documents.find(entry => entry.name === name), maximum = 2 * 1024 * 1024;
      if (!entry) throw new Error('Not a package document: ' + name);
      if (!/\.(md|markdown)$/i.test(name)) {
        const error = new Error('Preview is available for Markdown documents.'); error.code = 'preview-type'; throw error;
      }
      if (entry.compressedSize > maximum || entry.uncompressedSize > maximum) {
        const error = new Error('Document too large to preview'); error.code = 'preview-size'; throw error;
      }
      if (name === cachedName) return cachedDocument;
      if (previewName !== name) {
        previewName = name;
        const pending = container.read(name, maximum).then(bytes => outline(bytes, name));
        previewDocument = pending;
        pending.catch(() => { if (previewDocument === pending) pkg.releasePreview(); });
      }
      return previewDocument;
    },
    releasePreview() { previewName = undefined; previewDocument = undefined; },
    resolve(reference, context) { return resolveReference(pkg, reference, context); },
  };
  return pkg;
}
