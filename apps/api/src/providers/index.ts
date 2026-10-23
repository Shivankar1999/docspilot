import { config } from '../config';
import { AnthropicChatProvider } from './anthropic';
import { MockChatProvider, MockEmbeddingProvider } from './mock';
import type { EmbeddingProvider, LLMProvider } from './types';
import { VoyageEmbeddingProvider } from './voyage';

// Providers are picked by env vars and created once. Code elsewhere only sees the interfaces.

let embeddingProvider: EmbeddingProvider | undefined;
let chatProvider: LLMProvider | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  embeddingProvider ??= createEmbeddingProvider();
  return embeddingProvider;
}

export function getChatProvider(): LLMProvider {
  chatProvider ??= createChatProvider();
  return chatProvider;
}

function createEmbeddingProvider(): EmbeddingProvider {
  if (config.EMBEDDING_PROVIDER === 'voyage') {
    if (!config.VOYAGE_API_KEY) {
      throw new Error('VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage');
    }
    return new VoyageEmbeddingProvider(config.VOYAGE_API_KEY, config.VOYAGE_MODEL);
  }
  return new MockEmbeddingProvider();
}

function createChatProvider(): LLMProvider {
  if (config.LLM_PROVIDER === 'anthropic') {
    if (!config.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    }
    return new AnthropicChatProvider(config.ANTHROPIC_API_KEY, config.CHAT_MODEL);
  }
  // A small per-word delay makes the mock stream like a real model in the UI.
  return new MockChatProvider(config.NODE_ENV === 'test' ? 0 : 25);
}
