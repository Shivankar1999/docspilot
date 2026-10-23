import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResult, LLMProvider, StreamOptions } from './types';

/**
 * Claude's safety classifiers occasionally decline a request. With
 * `fallbacks: "default"` the API re-runs a declined request on Anthropic's
 * recommended fallback model instead of returning a refusal. Haiku has no
 * server-side fallback, so the parameter is left off there.
 */
export function fallbackParams(model: string) {
  if (model.startsWith('claude-haiku')) return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
}

export class AnthropicChatProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // The SDK retries rate limits (429) and server errors (5xx) twice by default.
    this.client = new Anthropic({ apiKey });
  }

  async stream(request: ChatRequest, { onText, signal }: StreamOptions): Promise<ChatResult> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        // Answers are short lookups in provided text: low effort keeps them fast and cheap.
        output_config: { effort: 'low' },
        ...fallbackParams(this.model),
      },
      { signal },
    );
    stream.on('text', (text) => onText(text));

    const message = await stream.finalMessage();
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    return {
      text: text.join(''),
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      stopReason: message.stop_reason ?? 'end_turn',
    };
  }
}
