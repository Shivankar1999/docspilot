import { estimateTokens } from '../services/chunking';
import { NO_ANSWER } from '../services/prompt';
import {
  EMBEDDING_DIMENSIONS,
  type ChatRequest,
  type ChatResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  type LLMProvider,
  type StreamOptions,
} from './types';

// Free, offline providers for tests and local development: no API keys, no cost.

/**
 * Embeddings via the "hashing trick": each meaningful word adds weight to one of
 * 1024 slots (picked by hashing the word), then the vector is scaled to length 1.
 * Texts that share words get similar vectors, so search behaves sensibly; unlike
 * a real model it knows nothing about meaning ("refund" won't match "money back").
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock-hashing-v1';
  // Word-overlap scores run much lower than a real model's (one shared word in a
  // short question scores ~0.15), so the bar is lower too. Unrelated text scores ~0.
  readonly minSimilarity = 0.1;

  async embed(texts: string[]): Promise<EmbeddingResult> {
    return {
      embeddings: texts.map(embedText),
      tokens: texts.reduce((sum, text) => sum + estimateTokens(text), 0),
    };
  }
}

/**
 * A stand-in for Claude that answers by quoting the excerpt sentences sharing the
 * most words with the question, each with its [n] citation. It can't paraphrase or
 * reason, but it exercises the whole pipeline: retrieval, streaming, citations.
 */
export class MockChatProvider implements LLMProvider {
  readonly model = 'mock-extractive-v1';

  constructor(private readonly delayMsPerWord = 0) {}

  async stream(request: ChatRequest, { onText, signal }: StreamOptions): Promise<ChatResult> {
    const prompt = request.messages.at(-1)?.content ?? '';
    const answer = extractiveAnswer(prompt);

    for (const word of answer.split(/(?<= )/)) {
      if (signal?.aborted) throw new Error('Generation aborted');
      onText(word);
      if (this.delayMsPerWord) await new Promise((r) => setTimeout(r, this.delayMsPerWord));
    }

    return {
      text: answer,
      inputTokens: estimateTokens(request.system + prompt),
      outputTokens: estimateTokens(answer),
      stopReason: 'end_turn',
    };
  }
}

// Reads the question and excerpts back out of our own prompt template (services/prompt.ts).
function extractiveAnswer(prompt: string): string {
  const question = /<question>([\s\S]*?)<\/question>/.exec(prompt)?.[1] ?? '';
  const wanted = new Set(contentWords(question));

  const candidates: { sentence: string; excerpt: string; score: number }[] = [];
  for (const [, excerpt, body] of prompt.matchAll(/<excerpt id="(\d+)"[^>]*>([\s\S]*?)<\/excerpt>/g)) {
    // Sentences end at . ! ? or a line break (so a heading isn't glued to the next line).
    for (const sentence of body.trim().split(/(?<=[.!?])\s+|\n+/)) {
      // Headings and fragments ("# Warranty", "Refund policy") aren't answers.
      if (sentence.startsWith('#') || sentence.split(/\s+/).length < 4) continue;
      const score = new Set(contentWords(sentence).filter((w) => wanted.has(w))).size;
      if (score > 0 && !candidates.some((c) => c.sentence === sentence)) {
        candidates.push({ sentence, excerpt, score });
      }
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score).slice(0, 2); // stable: ties keep order
  if (best.length === 0) return NO_ANSWER;
  return best.map((c) => `${c.sentence} [${c.excerpt}]`).join(' ');
}

// Words too common to say anything about a text's topic.
const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from has have how i in is it my of on or our the this to was we what when where which who why will with you your'.split(
    ' ',
  ),
);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word))
    .map(singular);
}

function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of contentWords(text)) vector[fnv1a(word) % EMBEDDING_DIMENSIONS] += 1;

  const length = Math.hypot(...vector);
  // Text made only of stop words: return a fixed unit vector (a zero vector has no direction).
  if (length === 0) return vector.map((_, i) => (i === 0 ? 1 : 0));
  return vector.map((v) => v / length);
}

// Crude plural folding so "refunds" matches "refund". Good enough for a mock.
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

// FNV-1a: a tiny, fast, deterministic string hash.
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
