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
  let cachedName, cachedDocument, ledger;
  const pkg = {
    ...container, documents, name: blob.name || 'Untitled package',
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
    resolve(reference, context) { return resolveReference(pkg, reference, context); },
  };
  return pkg;
}
