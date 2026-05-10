// Greedy character-based chunker with overlap. Within each window's last
// 100 characters we look for a clean break point (paragraph > sentence >
// newline > whitespace), falling back to the hard size limit if none
// exists. Good enough for KB-grade PDFs without pulling in a tokenizer.

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 200;
const BREAK_LOOKBACK = 100;

const BREAKERS = [/\n\n/g, /\.\s/g, /\n/g, /\s/g];

export function chunkText(text, size = DEFAULT_SIZE, overlap = DEFAULT_OVERLAP) {
  if (!text) return [];
  // Normalize newlines + collapse runs of blank lines to keep paragraphs
  // recognizable but compact.
  const t = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return [];
  if (t.length <= size) return [t];

  const chunks = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);

    if (end < t.length) {
      const window = t.slice(end - BREAK_LOOKBACK, end);
      for (const re of BREAKERS) {
        re.lastIndex = 0;
        const matches = [...window.matchAll(re)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          end = end - BREAK_LOOKBACK + last.index + last[0].length;
          break;
        }
      }
    }

    const piece = t.slice(i, end).trim();
    if (piece.length > 0) chunks.push(piece);

    if (end >= t.length) break;
    // Always advance at least 1 char to guarantee termination.
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}
