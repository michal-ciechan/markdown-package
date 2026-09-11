import {markdownRenderer} from './markdown-renderer.js';

// Separate output and visible-text budgets: repeated reference destinations can
// amplify a tiny scope without adding any visible text. This is preview-only.
export const PREVIEW_HTML_UNITS = 64 * 1024;
const exceeded = Symbol('preview output budget');

export function renderPreviewBlock(node, maxHtml, maxText) {
  const renderer = markdownRenderer();
  const {esc, lit, tag} = renderer;
  let visibleUnits = 0;
  const htmlFits = length => { if (length > maxHtml - renderer.buffer.length) throw exceeded; };
  const textFits = length => { if (length > maxText - visibleUnits) throw exceeded; visibleUnits += length; };
  // Check escaped size before escapeXml's replace can allocate the expanded
  // string. This also bounds temporary href/title/class attribute strings.
  renderer.esc = function (text) {
    let length = text.length;
    htmlFits(length);
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      length += char === '&' ? 4 : char === '"' ? 5 : char === '<' || char === '>' ? 3 : 0;
      htmlFits(length);
    }
    return esc.call(this, text);
  };
  renderer.out = function (text) {
    textFits(text.length); // Includes the safe renderer's image placeholders.
    const escaped = this.esc(text);
    htmlFits(escaped.length);
    lit.call(this, escaped);
  };
  renderer.lit = function (text) {
    htmlFits(text.length);
    // In the pinned safe renderer, literal output is a newline/soft break or
    // this raw-HTML omission comment. Tags go through tag; user text through out.
    if (text !== '<!-- raw HTML omitted -->') textFits(text.length);
    lit.call(this, text);
  };
  renderer.tag = function (name, attrs, selfclosing) {
    if (this.disableTags > 0) return;
    let length = name.length + 2 + (selfclosing ? 2 : 0);
    for (const [key, value] of attrs ?? []) length += key.length + value.length + 4;
    htmlFits(length); // HtmlRenderer.tag writes directly to its buffer.
    tag.call(this, name, attrs, selfclosing);
  };
  try { return {html: renderer.render(node), visibleUnits}; }
  catch (error) { if (error !== exceeded) throw error; return undefined; }
}
