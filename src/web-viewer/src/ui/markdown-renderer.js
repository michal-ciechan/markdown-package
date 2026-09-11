import {HtmlRenderer} from 'commonmark';
export function markdownRenderer() {
  const renderer = new HtmlRenderer({safe: true, sourcepos: true});
  function tableNode(node, entering) {
    if (!node.tableTag) return;
    const tag = node.tableTag;
    if (tag === 'table') {
      if (entering) {
        this.cr();
        this.tag('div', [...this.attrs(node), ['class', 'table-container']]);
        this.tag('div', [['class', 'table-scroll'], ['role', 'region'], ['aria-label', 'Table'], ['tabindex', '0']]);
      }
    }
    const attrs = this.attrs(node);
    if (node.tableAlign) attrs.push(['align', node.tableAlign]);
    if (tag === 'th') attrs.push(['scope', 'col']);
    this.tag(entering ? tag : '/' + tag, entering ? attrs : []);
    if (tag === 'table' && !entering) { this.tag('/div'); this.tag('/div'); this.cr(); }
  }
  renderer.custom_block = tableNode;
  renderer.custom_inline = tableNode;
  // No raw HTML or automatic image requests from opened packages.
  renderer.image = function (_node, entering) {
    if (entering) { this.out('[Image: '); this.disableTags++; }
    else { this.disableTags--; this.out(']'); }
  };
  return renderer;
}
