import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/services/chunking';

const MAX_CHARS = 500 * 4; // CHUNK_TOKENS × ~4 chars per token

// ~16k characters of paragraphs: long enough for several chunks.
const longText = Array.from(
  { length: 30 },
  (_, i) => `Section ${i}. ` + 'Refunds are accepted within thirty days of purchase. '.repeat(10),
).join('\n\n');

describe('chunkText', () => {
  it('returns no chunks for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n\n \t ')).toEqual([]);
  });

  it('keeps short text as one chunk, with whitespace normalized', () => {
    expect(chunkText('Hello   world.\r\n\r\n\r\n\r\nSecond  paragraph.')).toEqual([
      'Hello world.\n\nSecond paragraph.',
    ]);
  });

  it('splits long text into chunks that never exceed the size limit', () => {
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  it('overlaps consecutive chunks so boundary sentences are not lost', () => {
    const chunks = chunkText(longText);
    for (let i = 1; i < chunks.length; i++) {
      const start = chunks[i].slice(0, 60);
      expect(chunks[i - 1]).toContain(start);
    }
  });

  it('is deterministic (required for idempotent re-ingestion)', () => {
    expect(chunkText(longText)).toEqual(chunkText(longText));
  });

  it('slices a single enormous word instead of exceeding the limit', () => {
    const chunks = chunkText('x'.repeat(10_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
  });
});
