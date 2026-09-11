import {Parser, Node} from 'commonmark';

// A table-only extension of the pinned CommonMark 0.31.2 parser. Keep the
// addressing inventory on plain CommonMark; this parser is for display only.
// Use its container/block recognition and inline parser, including reference links.
function cells(line) {
  const parts = [];
  let start = 0, pipes = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    // GFM splits before inline parsing: even in code spans, only an
    // immediately preceding backslash protects a pipe (regardless of parity).
    if (char === '|' && line[index - 1] !== '\\') {
      parts.push({raw: line.slice(start, index), start, end: index});
      start = index + 1; pipes++;
    }
  }
  parts.push({raw: line.slice(start), start, end: line.length});
  if (pipes && !parts[0].raw.trim()) parts.shift();
  if (pipes && !parts.at(-1).raw.trim()) parts.pop();
  return {parts, pipes};
}

export function markdownParser() {
  const parser = new Parser({smart: false});
  const paragraph = parser.blocks.paragraph;
  const incorporateLine = parser.incorporateLine, addLine = parser.addLine;
  const finalize = parser.finalize, processInlines = parser.processInlines;
  parser.blocks = {...parser.blocks, paragraph: {...paragraph, continue(parser, block) {
    if (!parser.blank && !parser.indented && !block.tableRows && block.sourceLines?.length) {
      const headerLine = block.sourceLines.at(-1);
      const header = cells(headerLine.text);
      const delimiterText = parser.currentLine.slice(parser.nextNonspace);
      const delimiter = cells(delimiterText).parts;
      // Setext headings and list starts take precedence over the extension.
      // A pipe or colon in the delimiter can establish a one-column table.
      if (!/^-[ \t]/.test(delimiterText) && /[|:]/.test(delimiterText) &&
          header.parts.length && header.parts.length === delimiter.length &&
          delimiter.every(cell => /^:?-+:?$/.test(cell.raw.trim()))) {
        if (block.sourceLines.length > 1) {
          const previousLine = block.sourceLines.at(-2);
          const preceding = new Node('paragraph', [block.sourcepos[0],
            [previousLine.line, previousLine.column + previousLine.text.length - 1]]);
          preceding._open = false;
          preceding._string_content = block._string_content.slice(0, -(headerLine.text.length + 1));
          block.insertBefore(preceding);
          block.sourcepos[0] = [headerLine.line, headerLine.column];
          block.sourceLines = [headerLine];
        }
        block.tableAlignments = delimiter.map(cell => {
          const value = cell.raw.trim();
          return value.startsWith(':') ? (value.endsWith(':') ? 'center' : 'left') :
            value.endsWith(':') ? 'right' : undefined;
        });
        block.tableRows = block.sourceLines;
        block._type = 'custom_block';
        parser.lastLineLength = parser.currentLine.length;
        return 2; // delimiter consumed, before Setext/thematic-break recognition
      }
    }
    return paragraph.continue(parser, block);
  }}, custom_block: {...paragraph, continue(parser, block) {
    if (parser.blank || !cells(parser.currentLine.slice(parser.nextNonspace)).parts.length) return 1;
    // The pinned parser's line loop only tries block starts for paragraphs.
    // Restore the table type during those rules so all blocks can terminate it.
    block._type = 'paragraph';
    return 0;
  }}};
  parser.blockStarts = parser.blockStarts.map(start => (parser, block) => {
    if (!block.tableRows) return start(parser, block);
    block._type = 'custom_block';
    try {
      return start(parser, block);
    } finally {
      if (block._open) block._type = 'paragraph';
    }
  });
  parser.addLine = function () {
    if (this.tip.type === 'paragraph') {
      (this.tip.sourceLines ??= []).push({text: this.currentLine.slice(this.offset),
        line: this.lineNumber, column: this.offset + 1});
    }
    addLine.call(this);
  };
  parser.incorporateLine = function (line) {
    incorporateLine.call(this, line);
    if (this.tip?.tableRows) this.tip._type = 'custom_block';
  };
  parser.finalize = function (block, line) {
    if (block.tableRows) block._type = 'custom_block';
    finalize.call(this, block, line);
  };
  parser.processInlines = function (ast) {
    processInlines.call(this, ast);
    const walker = ast.walker();
    let event;
    while ((event = walker.next())) {
      const table = event.node;
      if (!event.entering || !table.tableRows) continue;
      table.tableTag = 'table';
      let body;
      for (const [index, row] of table.tableRows.entries()) {
        const group = index === 0 ? new Node('custom_block') : body ??= new Node('custom_block');
        group.tableTag = index === 0 ? 'thead' : 'tbody';
        if (!group.parent) table.appendChild(group);
        const tr = new Node('custom_block', [[row.line, row.column], [row.line, row.column + row.text.length]]);
        tr.tableTag = 'tr'; group.appendChild(tr);
        const values = cells(row.text).parts;
        for (let column = 0; column < table.tableAlignments.length; column++) {
          const value = values[column] ?? {raw: '', start: row.text.length, end: row.text.length};
          // Cell columns are exact UTF-16 source slices with an exclusive end;
          // selection.js uses them rather than CommonMark's visual tab columns.
          const cell = new Node('custom_inline', [[row.line, row.column + value.start], [row.line, row.column + value.end]]);
          cell.tableTag = index === 0 ? 'th' : 'td';
          cell.tableAlign = table.tableAlignments[column];
          // GFM unescapes pipes even inside code spans, before inline parsing.
          cell._string_content = value.raw.trim().replace(/\\\|/g, '|');
          this.inlineParser.parse(cell);
          tr.appendChild(cell);
        }
      }
      table._string_content = null;
    }
  };
  return parser;
}
