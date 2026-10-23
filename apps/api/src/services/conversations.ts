import { withTenant } from '../db/pool';
import { AppError } from '../lib/errors';

export type ChatSource = 'dashboard' | 'widget' | 'api';

/** One question being answered, with what the answer step needs to know. */
export interface Turn {
  tenantId: string;
  conversationId: string;
  companyName: string;
  docsVersion: number; // part of the answer-cache key
  question: string;
}

export interface Citation {
  number: number; // the [n] marker used in the answer
  documentId: string;
  filename: string;
  chunkIndex: number;
  similarity: number;
}

/**
 * Starts a turn: continues the given conversation (404 if it doesn't exist for
 * this tenant) or creates one, and saves the user's question.
 */
export function startTurn(input: {
  tenantId: string;
  question: string;
  conversationId?: string;
  source: ChatSource;
}): Promise<Turn> {
  return withTenant(input.tenantId, async (db) => {
    let conversationId = input.conversationId;
    if (conversationId) {
      const found = await db.query('SELECT 1 FROM conversations WHERE id = $1', [conversationId]);
      if (found.rowCount === 0) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
    } else {
      const created = await db.query<{ id: string }>(
        'INSERT INTO conversations (tenant_id, source) VALUES ($1, $2) RETURNING id',
        [input.tenantId, input.source],
      );
      conversationId = created.rows[0].id;
    }

    await db.query(
      `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [input.tenantId, conversationId, input.question],
    );
    const tenant = await db.query<{ name: string; docsVersion: number }>(
      'SELECT name, docs_version AS "docsVersion" FROM tenants WHERE id = $1',
      [input.tenantId],
    );
    return {
      tenantId: input.tenantId,
      conversationId,
      companyName: tenant.rows[0].name,
      docsVersion: tenant.rows[0].docsVersion,
      question: input.question,
    };
  });
}

/** Saves the assistant's answer with the sources it cited. Returns the message id. */
export function saveAnswer(turn: Turn, answer: string, citations: Citation[]): Promise<string> {
  return withTenant(turn.tenantId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO messages (tenant_id, conversation_id, role, content, citations)
       VALUES ($1, $2, 'assistant', $3, $4) RETURNING id`,
      [turn.tenantId, turn.conversationId, answer, JSON.stringify(citations)],
    );
    return rows[0].id;
  });
}
