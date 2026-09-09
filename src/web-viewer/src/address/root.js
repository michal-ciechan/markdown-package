import {ANCHOR, canonicalJson} from '../format.js';
import {sha256} from './digest.js';

export const defaultRoot = (namespace, locator) => sha256(['mdpkg-default', ANCHOR, namespace, canonicalJson(locator)].join('\0'));
