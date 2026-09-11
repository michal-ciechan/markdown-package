import {ANCHOR, DIGEST, HASH, OID, canonicalJson, isObject, parseCanonicalJson, hasOwn} from '../format.js';
import {defaultRoot} from './root.js';
import {parseReference, validateLocator, formatReference} from './reference.js';

export async function readLedger(container) {
  const path = container.manifest.addressing.overrides;
  if (path === null) return new Map();
  const value = parseCanonicalJson(await container.read(path));
  if (!isObject(value) || value.version !== 1 || value.anchor !== ANCHOR ||
      !isObject(value.entries) || !Object.keys(value.entries).length) throw new Error('Malformed override ledger');
  const ledger = new Map(), targets = new Set();
  for (const [root, entry] of Object.entries(value.entries)) {
    if (!HASH.test(root) || !isObject(entry)) throw new Error('Malformed override entry');
    const kinds = ['to', 'dead', 'unknown'].filter(key => hasOwn(entry, key));
    if (kinds.length !== 1) throw new Error('An override must have exactly one disposition');
    const disposition = kinds[0];
    const allowed = disposition === 'dead' ? ['dead', 'next'] : [disposition];
    if (Object.keys(entry).some(key => !allowed.includes(key))) throw new Error('Unknown override field');
    if (disposition === 'to') {
      validateLocator(entry.to);
      const target = canonicalJson(entry.to);
      if (targets.has(target)) throw new Error('Multiple roots claim one live locator');
      targets.add(target);
    } else if (disposition === 'dead') {
      if (!['split', 'merge', 'deleted'].includes(entry.dead) ||
          (entry.next !== undefined && (!Array.isArray(entry.next) || entry.next.some(root => !HASH.test(root))))) {
        throw new Error('Malformed retirement record');
      }
    } else if (typeof entry.unknown !== 'string' || !entry.unknown) throw new Error('Malformed unknown record');
    ledger.set(root, entry);
  }
  return ledger;
}

// Current-view evidence only. Historical refs are parsed strictly, then return
// an app capability result outside the §6.6 evidence statuses. A later history
// reader must prove snapshot availability, never fall forward to current.
export async function resolveReference(pkg, value, {observedAt, document: readDocument = name => pkg.document(name), propagateReadErrors = false} = {}) {
  let ref;
  try { ref = parseReference(value); }
  catch (error) { return {status: 'invalidated', reason: 'malformed-reference', detail: error.message}; }
  const {manifest} = pkg;
  if (ref.namespace !== manifest.namespace) return {status: 'invalidated', reason: 'wrong-lineage'};
  if (!['document', 'section'].includes(ref.kind) || (ref.at && ref.at !== manifest.current)) {
    return {status: 'unsupported', reason: 'history-reader-required', reference: ref};
  }
  if (ref.anchor !== manifest.addressing.anchor || ref.profile !== manifest.addressing.digest ||
      ref.anchor !== ANCHOR || ref.profile !== DIGEST) return {status: 'invalidated', reason: 'unsupported-profile'};
  // Without reviewed state, loc is only a navigation target. Do not consult
  // correspondence, the ledger, the root hash or scoped digests.
  if (ref.expect === undefined) {
    const locator = ref.locator;
    try {
      if (!pkg.documents.some(document => document.name === locator[1])) {
        return {navigation: true, detail: 'Document not found: ' + locator[1]};
      }
      const document = await readDocument(locator[1]);
      const scope = document.find(locator);
      if (!scope) return {navigation: true, detail: 'Section not found in ' + locator[1]};
      return {navigation: true, locator, document, scope};
    } catch (error) {
      if (propagateReadErrors) throw error;
      return {navigation: true, detail: error.message};
    }
  }
  if (observedAt !== undefined && !OID.test(observedAt)) return {status: 'invalidated', reason: 'malformed-observed-at'};
  // A loose reference has no observedAt. Establishing coverage of a historical
  // checkpoint requires the history slice; do not claim correspondence without
  // that evidence, even when the expected source happens to match.
  if (manifest.addressing.coverage === 'partial') {
    return {status: 'unconfirmed', reason: 'incomplete-correspondence'};
  }
  try {
    const ledger = await pkg.ledger();
    const override = ledger.get(ref.root);
    if (override?.dead) return {status: 'flagged-changed', reason: override.dead, successors: override.next ?? []};
    if (override?.unknown) return {status: 'unconfirmed', reason: override.unknown};
    if (!override && ref.root !== await defaultRoot(ref.namespace, ref.locator)) {
      return {status: 'unconfirmed', reason: 'missing-override'};
    }
    const locator = override?.to ?? ref.locator;
    validateLocator(locator, ref.kind);
    if (!override && [...ledger.values()].some(entry => entry.to && canonicalJson(entry.to) === canonicalJson(locator))) {
      return {status: 'unconfirmed', reason: 'reserved-slot'};
    }
    if (!pkg.documents.some(document => document.name === locator[1])) {
      return {status: 'unconfirmed', reason: 'possibly-renamed-moved-or-deleted'};
    }
    let document;
    try { document = await readDocument(locator[1]); }
    catch (error) { if (propagateReadErrors) return {resourceError: error}; throw error; }
    const scope = document.find(locator);
    if (!scope) return {status: 'unconfirmed', reason: 'possibly-renamed-moved-or-deleted'};
    const actualDigest = await document.digest(scope);
    return {status: actualDigest === ref.expect ? 'survives' : 'flagged-changed',
      reason: actualDigest === ref.expect ? 'same-source' : 'source-changed',
      locator, actualDigest, document, scope, root: ref.root};
  } catch (error) {
    return {status: 'invalidated', reason: 'malformed-package', detail: error.message};
  }
}

export async function referenceFor(pkg, document, scope) {
  const locator = scope.locator;
  const ledger = await pkg.ledger();
  const key = canonicalJson(locator);
  let root;
  for (const [candidate, entry] of ledger) if (entry.to && canonicalJson(entry.to) === key) root = candidate;
  root ??= await defaultRoot(pkg.manifest.namespace, locator);
  if (ledger.has(root) && canonicalJson(ledger.get(root).to) !== key) {
    throw new Error('The current locator occupies a reserved root without a birth override');
  }
  return formatReference(pkg.manifest.namespace, root, locator, await document.digest(scope));
}
