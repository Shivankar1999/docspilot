import { recordChatAnswer } from '../lib/metrics';
import { getChatProvider, getEmbeddingProvider } from '../providers';
import type { EmbeddingProvider, LLMProvider } from '../providers/types';
import { answerCacheKey, getCachedAnswer, setCachedAnswer } from './cache';
import { saveAnswer, type Citation, type Turn } from './conversations';
import {
  buildSystemPrompt,
  buildUserMessage,
  citedExcerptNumbers,
  MAX_ANSWER_TOKENS,
  NO_ANSWER,
} from './prompt';
import { retrieveChunks } from './retrieval';
import { recordUsage } from './usage';

/** What the client receives, in order: meta → sources → token… → done. */
export type ChatEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'sources'; sources: Citation[] }
  | { type: 'token'; text: string }
  | { type: 'done'; messageId: string; citations: Citation[]; answered: boolean; cached: boolean };

export interface Usage {
  embeddingTokens: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null; // null when no LLM was called (cache hit or no relevant chunks)
  cacheHit: boolean;
}

export interface AnswerResult {
  answer: string;
  citations: Citation[];
  usage: Usage;
}

interface Deps {
  embedder: EmbeddingProvider;
  llm: LLMProvider;
  signal?: AbortSignal;
}

/**
 * The answer step: cache lookup → (replay | retrieve → fallback or LLM) → save.
 * Each question is answered on its own from the documents; earlier turns are
 * saved for history but not sent to the model (see docs/AI_AND_RAG.md).
 */
export async function streamAnswer(
  turn: Turn,
  emit: (event: ChatEvent) => void,
  { embedder = getEmbeddingProvider(), llm = getChatProvider(), signal }: Partial<Deps> = {},
): Promise<AnswerResult> {
  const started = performance.now();
  emit({ type: 'meta', conversationId: turn.conversationId });

  const cacheKey = answerCacheKey(turn.tenantId, turn.docsVersion, llm.model, turn.question);
  const cached = await getCachedAnswer(cacheKey);

  let generated: { answer: string; sources: Citation[]; usage: Usage };
  if (cached) {
    // Same question, same documents: replay the stored answer (no embedding or LLM cost).
    emit({ type: 'sources', sources: cached.sources });
    emit({ type: 'token', text: cached.answer });
    generated = {
      ...cached,
      usage: { embeddingTokens: 0, inputTokens: 0, outputTokens: 0, model: null, cacheHit: true },
    };
  } else {
    generated = await generateAnswer(turn, emit, embedder, llm, signal);
    // Only complete answers reach this line (an aborted or failed stream throws first).
    await setCachedAnswer(cacheKey, { answer: generated.answer, sources: generated.sources });
  }

  // Report only the sources the answer actually cites.
  const cited = new Set(citedExcerptNumbers(generated.answer));
  const citations = generated.sources.filter((s) => cited.has(s.number));
  const messageId = await saveAnswer(turn, generated.answer, citations);
  const latencyMs = performance.now() - started;
  recordChatAnswer(generated.usage.cacheHit, latencyMs);
  await recordUsage({
    tenantId: turn.tenantId,
    kind: 'chat',
    ...generated.usage,
    embeddingModel: generated.usage.embeddingTokens > 0 ? embedder.model : null,
    latencyMs,
  });

  emit({
    type: 'done',
    messageId,
    citations,
    answered: !generated.answer.startsWith(NO_ANSWER),
    cached: Boolean(cached),
  });
  return { answer: generated.answer, citations, usage: generated.usage };
}

/** Retrieve → (fallback | prompt + stream). Emits sources and tokens as it goes. */
async function generateAnswer(
  turn: Turn,
  emit: (event: ChatEvent) => void,
  embedder: EmbeddingProvider,
  llm: LLMProvider,
  signal?: AbortSignal,
) {
  const { chunks, embeddingTokens } = await retrieveChunks(turn.tenantId, turn.question, embedder);
  const sources: Citation[] = chunks.map((chunk, i) => ({
    number: i + 1,
    documentId: chunk.documentId,
    filename: chunk.filename,
    chunkIndex: chunk.chunkIndex,
    similarity: Math.round(chunk.similarity * 1000) / 1000,
  }));
  emit({ type: 'sources', sources });

  const usage: Usage = { embeddingTokens, inputTokens: 0, outputTokens: 0, model: null, cacheHit: false };

  if (chunks.length === 0) {
    // Nothing relevant enough: don't let the model guess (and don't pay for a call).
    emit({ type: 'token', text: NO_ANSWER });
    return { answer: NO_ANSWER, sources, usage };
  }

  const result = await llm.stream(
    {
      system: buildSystemPrompt(turn.companyName),
      messages: [{ role: 'user', content: buildUserMessage(turn.question, chunks) }],
      maxTokens: MAX_ANSWER_TOKENS,
    },
    { onText: (text) => emit({ type: 'token', text }), signal },
  );
  return {
    answer: result.text,
    sources,
    usage: { ...usage, inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: llm.model },
  };
}
