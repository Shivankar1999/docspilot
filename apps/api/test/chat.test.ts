import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { getIngestQueue } from '../src/jobs/ingest';
import { MockEmbeddingProvider } from '../src/providers/mock';
import type { LLMProvider } from '../src/providers/types';
import { streamAnswer, type ChatEvent } from '../src/services/chat';
import { startTurn } from '../src/services/conversations';
import { NO_ANSWER } from '../src/services/prompt';
import { app, ask, resetDatabase, signUp, uploadAndIngest } from './helpers';
import request from 'supertest';

const POLICY = `Refund policy

Refunds are processed within 5 business days after we receive the returned item.

Shipping usually takes 3 to 7 days. Express shipping is available at checkout.`;

beforeEach(async () => {
  await resetDatabase();
  await getIngestQueue().obliterate({ force: true });
});

describe('POST /api/chat', () => {
  it('streams a grounded answer: meta → sources → tokens → done, with citations', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY, 'refund-policy.txt');

    const chat = await ask(agent, 'How long do refunds take?');

    expect(chat.status).toBe(200);
    expect(chat.events.map((e) => e.event)[0]).toBe('meta');
    expect(chat.events.at(-1)?.event).toBe('done');
    expect(chat.of('token').length).toBeGreaterThan(3); // streamed in pieces, not one blob

    const [sources] = chat.of('sources');
    expect(sources.sources[0]).toMatchObject({ number: 1, filename: 'refund-policy.txt' });

    expect(chat.answer).toContain('Refunds are processed within 5 business days');
    expect(chat.answer).toContain('[1]');
    const [done] = chat.of('done');
    expect(done.answered).toBe(true);
    expect(done.citations).toEqual([expect.objectContaining({ number: 1, filename: 'refund-policy.txt' })]);
  });

  it(`replies "${NO_ANSWER}" when the documents don't cover the question`, async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);

    const chat = await ask(agent, 'What is the capital of France?');

    expect(chat.answer).toBe(NO_ANSWER);
    expect(chat.of('sources')[0].sources).toEqual([]);
    expect(chat.of('done')[0]).toMatchObject({ answered: false, citations: [] });
  });

  it("never retrieves another tenant's documents", async () => {
    const owner = await signUp('Alpha');
    await uploadAndIngest(owner.agent, owner.tenantId, POLICY);
    const other = await signUp('Bravo');

    const chat = await ask(other.agent, 'How long do refunds take?');

    expect(chat.answer).toBe(NO_ANSWER);
    expect(chat.of('sources')[0].sources).toEqual([]);
  });

  it('saves the conversation, and continues it when given conversationId', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);

    const first = await ask(agent, 'How long do refunds take?');
    const conversationId = first.of('meta')[0].conversationId;
    const second = await ask(agent, 'How long does shipping take?', { conversationId });

    expect(second.of('meta')[0].conversationId).toBe(conversationId);
    const { rows } = await pool.query(
      `SELECT role, content, citations FROM messages WHERE conversation_id = $1 ORDER BY created_at`,
      [conversationId],
    );
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(rows[0].content).toBe('How long do refunds take?');
    expect(rows[1].content).toBe(first.answer);
    expect(rows[1].citations[0]).toMatchObject({ filename: 'doc.txt', chunkIndex: 0 });
    const conversation = await pool.query('SELECT source FROM conversations WHERE id = $1', [conversationId]);
    expect(conversation.rows[0].source).toBe('dashboard');
  });

  it('returns JSON errors (not a stream) for bad input, unknown conversations and no auth', async () => {
    const { agent } = await signUp('Acme');

    const empty = await ask(agent, '   ');
    expect(empty.status).toBe(400);
    expect(empty.json.error.code).toBe('VALIDATION_ERROR');

    const unknown = await ask(agent, 'Hello?', { conversationId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(404);

    await request(app).post('/api/chat').send({ message: 'hi' }).expect(401);
  });

  it('works with a secret API key and records the conversation as "api"', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    const key = (await agent.post('/api/tenant/secret-key')).body.secretKey;

    const chat = await ask(request.agent(app).set('Authorization', `Bearer ${key}`), 'refund time?');

    expect(chat.answer).toContain('Refunds are processed');
    const { rows } = await pool.query('SELECT source FROM conversations');
    expect(rows[0].source).toBe('api');
  });
});

describe('answer step (service level)', () => {
  /** Records whether the model was called at all. */
  class SpyLLM implements LLMProvider {
    readonly model = 'spy';
    calls = 0;
    async stream() {
      this.calls++;
      return { text: 'spy answer [1]', inputTokens: 10, outputTokens: 3, stopReason: 'end_turn' };
    }
  }

  it('does not call the LLM at all when nothing relevant is retrieved', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    const turn = await startTurn({ tenantId, question: 'Who won the 1998 World Cup?', source: 'dashboard' });
    const llm = new SpyLLM();
    const events: ChatEvent[] = [];

    const result = await streamAnswer(turn, (e) => events.push(e), {
      embedder: new MockEmbeddingProvider(),
      llm,
    });

    expect(llm.calls).toBe(0);
    expect(result.answer).toBe(NO_ANSWER);
    expect(result.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, model: null });
  });

  it('calls the LLM once when relevant chunks exist, and reports usage', async () => {
    const { agent, tenantId } = await signUp('Acme');
    await uploadAndIngest(agent, tenantId, POLICY);
    const turn = await startTurn({ tenantId, question: 'How long do refunds take?', source: 'dashboard' });
    const llm = new SpyLLM();

    const result = await streamAnswer(turn, () => {}, { embedder: new MockEmbeddingProvider(), llm });

    expect(llm.calls).toBe(1);
    expect(result.citations).toHaveLength(1);
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 3, model: 'spy' });
    expect(result.usage.embeddingTokens).toBeGreaterThan(0);
  });
});
