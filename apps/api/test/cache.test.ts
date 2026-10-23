import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/pool';
import { redis } from '../src/lib/redis';
import { MockChatProvider, MockEmbeddingProvider } from '../src/providers/mock';
import { streamAnswer } from '../src/services/chat';
import { answerCacheKey, normalizeQuestion } from '../src/services/cache';
import { startTurn } from '../src/services/conversations';
import { ask, resetDatabase, signUp, uploadAndIngest } from './helpers';

const POLICY = 'Refunds are processed within 5 business days. Shipping takes 3 to 7 days.';

/** Counts calls, so tests can tell a cache hit (no calls) from a miss. */
class CountingEmbedder extends MockEmbeddingProvider {
  calls = 0;
  override embed(texts: string[]) {
    this.calls++;
    return super.embed(texts);
  }
}
class CountingLLM extends MockChatProvider {
  calls = 0;
  override stream(...args: Parameters<MockChatProvider['stream']>) {
    this.calls++;
    return super.stream(...args);
  }
}

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function askDirect(tenantId: string, question: string, embedder: CountingEmbedder, llm: CountingLLM) {
  const turn = await startTurn({ tenantId, question, source: 'dashboard' });
  return streamAnswer(turn, () => {}, { embedder, llm });
}

describe('normalizeQuestion', () => {
  it('treats case, spacing and trailing punctuation as the same question', () => {
    const variants = ['How long do refunds take?', '  how LONG do   refunds take??  ', 'how long do refunds take'];
    expect(new Set(variants.map(normalizeQuestion)).size).toBe(1);
    expect(normalizeQuestion('Refunds?')).not.toBe(normalizeQuestion('Shipping?'));
  });

  it('builds keys from tenant + docs version + model + question', () => {
    const key = answerCacheKey('t1', 3, 'model-a', 'Hi?');
    expect(key).toMatch(/^cache:answer:t1:3:[0-9a-f]{64}$/);
    expect(answerCacheKey('t1', 4, 'model-a', 'Hi?')).not.toBe(key);
    expect(answerCacheKey('t1', 3, 'model-b', 'Hi?')).not.toBe(key);
    expect(answerCacheKey('t2', 3, 'model-a', 'Hi?')).not.toBe(key);
  });
});

describe('answer cache', () => {
  it('serves a repeated question from cache: no embedding call, no LLM call', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    const embedder = new CountingEmbedder();
    const llm = new CountingLLM();

    const first = await askDirect(tenantId, 'How long do refunds take?', embedder, llm);
    const second = await askDirect(tenantId, 'how long do refunds take', embedder, llm);

    expect(llm.calls).toBe(1);
    expect(embedder.calls).toBe(1);
    expect(first.usage.cacheHit).toBe(false);
    expect(second.usage).toEqual({ embeddingTokens: 0, inputTokens: 0, outputTokens: 0, model: null, cacheHit: true });
    expect(second.answer).toBe(first.answer);
    expect(second.citations).toEqual(first.citations);
  });

  it('is invalidated when documents change (docs version bump)', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY, 'policy.txt');
    const embedder = new CountingEmbedder();
    const llm = new CountingLLM();

    await askDirect(tenantId, 'How long do refunds take?', embedder, llm);
    const documentId = await uploadAndIngest(agent, tenantId, 'Refunds for gift cards are not possible.', 'gifts.txt');
    const afterUpload = await askDirect(tenantId, 'How long do refunds take?', embedder, llm);
    await agent.delete(`/api/documents/${documentId}`).expect(204);
    await askDirect(tenantId, 'How long do refunds take?', embedder, llm);

    expect(llm.calls).toBe(3); // miss, miss after upload, miss after delete
    expect(afterUpload.usage.cacheHit).toBe(false);
  });

  it('never shares cached answers between tenants', async () => {
    const a = await signUp('Alpha');
    const b = await signUp('Bravo');
    await uploadAndIngest(a.agent, a.tenantId, POLICY);
    await uploadAndIngest(b.agent, b.tenantId, POLICY);
    const embedder = new CountingEmbedder();
    const llm = new CountingLLM();

    await askDirect(a.tenantId, 'How long do refunds take?', embedder, llm);
    await askDirect(b.tenantId, 'How long do refunds take?', embedder, llm);

    expect(llm.calls).toBe(2);
  });

  it('caches the "no information" reply too (repeated off-topic questions cost nothing)', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    const embedder = new CountingEmbedder();
    const llm = new CountingLLM();

    await askDirect(tenantId, 'Who painted the Mona Lisa?', embedder, llm);
    const second = await askDirect(tenantId, 'Who painted the Mona Lisa?', embedder, llm);

    expect(embedder.calls).toBe(1);
    expect(second.usage.cacheHit).toBe(true);
  });

  it('over HTTP: the done event says cached, and both turns are saved', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);

    const first = await ask(agent, 'How long do refunds take?');
    const second = await ask(agent, 'How long do refunds take?');

    expect(first.of('done')[0].cached).toBe(false);
    expect(second.of('done')[0].cached).toBe(true);
    expect(second.answer).toBe(first.answer);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM messages WHERE role = 'assistant'");
    expect(rows[0].n).toBe(2);
  });

  it('fails open: if Redis reads fail, the question is still answered', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    vi.spyOn(redis, 'get').mockRejectedValue(new Error('Connection is closed.'));

    const chat = await ask(agent, 'How long do refunds take?');

    expect(chat.status).toBe(200);
    expect(chat.answer).toContain('Refunds are processed');
  });
});
