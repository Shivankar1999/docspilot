// Provider interfaces: the rest of the app depends on these, never on a vendor SDK,
// so swapping Voyage or Claude for another vendor means writing one new class.

/** Must match `vector(1024)` in migrations/001_init.sql. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Retrieval-tuned models (like Voyage) embed questions and documents slightly
 * differently, which improves search quality, so callers say which one they send.
 */
export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingResult {
  embeddings: number[][]; // one vector per input text, in the same order
  tokens: number; // billed tokens, for usage metering
}

export interface EmbeddingProvider {
  readonly model: string;
  /**
   * Cosine similarity below which a chunk counts as "not relevant". It belongs to
   * the model because every model spreads its scores differently.
   */
  readonly minSimilarity: number;
  embed(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export interface StreamOptions {
  onText: (text: string) => void; // called for each piece of the answer as it arrives
  signal?: AbortSignal; // aborts generation, e.g. when the user closes the chat
}

export interface LLMProvider {
  readonly model: string;
  stream(request: ChatRequest, options: StreamOptions): Promise<ChatResult>;
}
