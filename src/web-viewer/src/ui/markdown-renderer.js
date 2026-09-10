import {HtmlRenderer} from 'commonmark';
export function markdownRenderer() {
  const renderer = new HtmlRenderer({safe: true, sourcepos: true});
  // No raw HTML or automatic image requests from opened packages.
  renderer.image = function (_node, entering) {
    if (entering) { this.out('[Image: '); this.disableTags++; }
    else { this.disableTags--; this.out(']'); }
  };
  return renderer;
}
