// Splits extracted text into overlapping chunks: the unit we embed, search and cite.
//
// ~500 tokens per chunk: big enough to hold a complete answer (a few paragraphs),
// small enough that search lands on a specific passage and citations stay precise.
// ~75 tokens (15%) of overlap: a sentence cut by a chunk boundary still appears
// whole in at least one chunk.
export const CHUNK_TOKENS = 500;
export const OVERLAP_TOKENS = 75;

// Rule of thumb for English: ~4 characters per token. Exact counts differ per model
// tokenizer; this estimate is only for sizing chunks. Billing uses the provider's count.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface Piece {
  text: string;
  joiner: string; // how this piece attaches to the previous one in a chunk
}

/** Deterministic: the same text always yields the same chunks (needed for idempotent ingestion). */
export function chunkText(
  text: string,
  { maxTokens = CHUNK_TOKENS, overlapTokens = OVERLAP_TOKENS } = {},
): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;
  // Keeping pieces below (max - overlap) guarantees "overlap + piece" always fits a chunk.
  const pieces = splitIntoPieces(normalize(text), maxChars - overlapChars);

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) {
      current = piece.text;
    } else if (current.length + piece.joiner.length + piece.text.length <= maxChars) {
      current += piece.joiner + piece.text;
    } else {
      chunks.push(current);
      const overlap = tail(current, overlapChars);
      current = overlap ? `${overlap} ${piece.text}` : piece.text;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Paragraphs first (they're natural topic boundaries); a paragraph that is too long
// is split into sentences, and a sentence that is still too long into words.
function splitIntoPieces(text: string, maxChars: number): Piece[] {
  const pieces: Piece[] = [];
  for (const paragraph of text.split('\n\n')) {
    if (!paragraph) continue;
    if (paragraph.length <= maxChars) {
      pieces.push({ text: paragraph, joiner: '\n\n' });
      continue;
    }
    let joiner = '\n\n';
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      for (const part of wrapWords(sentence, maxChars)) {
        pieces.push({ text: part, joiner });
        joiner = ' ';
      }
    }
  }
  return pieces;
}

function wrapWords(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    // A single "word" longer than a chunk (e.g. a giant URL) gets sliced.
    for (let i = 0; i < word.length; i += maxChars) {
      const slice = word.slice(i, i + maxChars);
      if (line && line.length + 1 + slice.length > maxChars) {
        parts.push(line);
        line = slice;
      } else {
        line = line ? `${line} ${slice}` : slice;
      }
    }
  }
  if (line) parts.push(line);
  return parts;
}

/** The last ~n characters of text, starting at a word boundary. */
function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const space = text.indexOf(' ', text.length - n);
  return space === -1 ? '' : text.slice(space + 1);
}
