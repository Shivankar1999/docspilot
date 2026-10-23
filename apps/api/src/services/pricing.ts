// List prices in USD per 1M tokens, used to *estimate* cost for dashboards and
// limits. They are not invoices: providers change prices, so check their pricing
// pages when you change models. Unknown models (including the free mocks) cost 0.

const CHAT_PRICES: Partial<Record<string, { input: number; output: number }>> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

const EMBEDDING_PRICES: Partial<Record<string, number>> = {
  'voyage-4-large': 0.12,
  'voyage-4': 0.06,
  'voyage-4-lite': 0.02,
};

export interface CostInput {
  model: string | null;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens, which are billed as output
  embeddingModel: string | null;
  embeddingTokens: number;
}

export function estimateCostUsd(usage: CostInput): number {
  const chat = usage.model ? CHAT_PRICES[usage.model] : undefined;
  const embedding = usage.embeddingModel ? EMBEDDING_PRICES[usage.embeddingModel] : undefined;
  const dollars =
    ((chat?.input ?? 0) * usage.inputTokens +
      (chat?.output ?? 0) * usage.outputTokens +
      (embedding ?? 0) * usage.embeddingTokens) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000; // matches numeric(12, 6)
}
