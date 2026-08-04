// Parser de markdown mínimo para o relatório de IA.
// Cobre só o que o modelo é instruído a produzir — títulos, listas, citação,
// parágrafos, negrito e código inline — e devolve blocos que o componente
// renderiza como elementos React (nada de innerHTML, então nada de XSS).

/** Quebra uma linha em spans → [{ text, bold?, code? }]. */
function parseInline(text) {
  const spans = [];
  // `código` tem precedência sobre **negrito** (o conteúdo é literal).
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let index = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > index) spans.push({ text: text.slice(index, match.index) });
    if (match[1] !== undefined) spans.push({ text: match[1], code: true });
    else spans.push({ text: match[2], bold: true });
    index = match.index + match[0].length;
  }
  if (index < text.length) spans.push({ text: text.slice(index) });
  return spans.length ? spans : [{ text: '' }];
}

/**
 * Markdown → [{ type: 'heading'|'list'|'quote'|'paragraph', ... }].
 * Tolera texto incompleto: é chamado a cada chunk enquanto o relatório chega.
 */
export function parseMarkdown(src) {
  const blocks = [];
  const lines = String(src ?? '').split('\n');

  let list = null; // itens acumulados da lista corrente
  let paragraph = []; // linhas acumuladas do parágrafo corrente

  const flushList = () => {
    if (list) blocks.push({ type: 'list', items: list });
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flush = () => {
    flushList();
    flushParagraph();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push({ type: 'quote', spans: parseInline(quote[1]) });
      continue;
    }

    const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      list = list ?? [];
      list.push(parseInline(item[1]));
      continue;
    }

    // Continuação de um item de lista (linha indentada logo abaixo dele).
    if (list && /^\s{2,}\S/.test(raw)) {
      const previous = list[list.length - 1];
      previous.push(...parseInline(` ${line.trim()}`));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
