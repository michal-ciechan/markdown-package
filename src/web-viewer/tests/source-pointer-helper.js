// Locator actions wait for stable layout, scroll into view and check the hit
// target. Raw viewport mouse coordinates can race a queued scroll event after
// collapsing a fold; that event intentionally dismisses comment previews.
export async function sourceTextPosition(paragraph, text, offset = 0, length = text.length) {
  return paragraph.evaluate((p, {text, offset, length}) => {
    const at = p.firstChild.data.indexOf(text);
    if (at < 0) throw new Error(`Source text not found: ${text}`);
    const range = document.createRange();
    range.setStart(p.firstChild, at + offset); range.setEnd(p.firstChild, at + offset + length);
    const rect = range.getBoundingClientRect(), block = p.getBoundingClientRect();
    return {x: rect.x + rect.width / 2 - block.x - p.clientLeft,
      y: rect.y + rect.height / 2 - block.y - p.clientTop};
  }, {text, offset, length});
}
