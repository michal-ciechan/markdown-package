import {destination} from './destination.js';
import {fragmentScope} from './display.js';
import {resolveReference} from '../address/resolve.js';

export async function resolveDestination(pkg, source, href, readDocument = name => pkg.document(name)) {
  let target;
  try { target = destination(source, href); }
  catch (error) { return {category: 'navigation', reason: 'invalid-destination', detail: error.message}; }
  try {
    if (target.kind === 'identity') {
      const result = await resolveReference(pkg, href, {document: readDocument, propagateReadErrors: true});
      if (result.resourceError) throw result.resourceError;
      return {...result, category: result.navigation ? 'navigation' : result.status === 'unsupported' ? 'capability' : 'identity'};
    }
    if (target.kind !== 'location') return {category: target.kind, target};
    if (!pkg.documents.some(entry => entry.name === target.path)) return {category: 'navigation', reason: 'target-not-found', target};
    const document = await readDocument(target.path);
    const match = target.fragment ? fragmentScope(document, target.fragment) : {scope: document.scopes[0]};
    return {category: 'navigation', target, document, ...match, locator: match.scope?.locator};
  } catch (error) {
    if (error.code === 'preview-type') return {category: 'capability', reason: 'unsupported-target', detail: error.message, target};
    return {category: 'resource', reason: error.code === 'preview-size' ? 'document-too-large' : 'read-failed', detail: error.message, target};
  }
}
