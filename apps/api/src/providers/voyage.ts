import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingInputType,
  type EmbeddingProvider,
  type EmbeddingResult,
} from './types';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const BATCH_SIZE = 64; // texts per request, well under Voyage's per-request limits

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
}

/** Voyage AI embeddings over plain fetch (no SDK dependency needed for one endpoint). */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  // Starting point, not gospel: tune it on real questions (see docs/AI_AND_RAG.md).
  readonly minSimilarity = 0.35;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    const embeddings: number[][] = [];
    let tokens = 0;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const res = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: texts.slice(i, i + BATCH_SIZE),
          model: this.model,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        // Rate limits and 5xx are usually temporary; throwing lets the job retry with backoff.
        throw new Error(`Voyage API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }

      const body = (await res.json()) as VoyageResponse;
      // Sort by index so each vector lines up with its input text.
      body.data.sort((a, b) => a.index - b.index);
      embeddings.push(...body.data.map((d) => d.embedding));
      tokens += body.usage.total_tokens;
    }

    return { embeddings, tokens };
  }
}
