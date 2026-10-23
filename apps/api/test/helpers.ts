import request from 'supertest';
import { createApp } from '../src/app';
import { pool, withTenant } from '../src/db/pool';
import { redis } from '../src/lib/redis';
import { MockEmbeddingProvider } from '../src/providers/mock';
import { ingestDocument } from '../src/services/ingestion';

export const app = createApp();
export const PASSWORD = 'correct-horse-battery';
type TestAgent = ReturnType<typeof request.agent>;

/**
 * Empties all tenant data (deleting tenants cascades to every tenant-owned table)
 * and the test Redis database (rate-limit windows, cached answers, queue jobs).
 */
export async function resetDatabase() {
  await pool.query('TRUNCATE tenants CASCADE');
  await redis.flushdb();
}

let counter = 0;

/** Signs up a new tenant and returns a Supertest agent that keeps its session cookie. */
export async function signUp(companyName = 'Acme', email = `owner-${++counter}@${companyName.toLowerCase()}.test`) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/signup')
    .send({ companyName, email, password: PASSWORD })
    .expect(201);
  return { agent, email, tenantId: res.body.user.tenantId as string };
}

/** Uploads a text document and runs ingestion right away (no worker needed). */
export async function uploadAndIngest(
  agent: TestAgent,
  tenantId: string,
  text: string,
  filename = 'doc.txt',
): Promise<string> {
  const res = await agent.post('/api/documents').attach('file', Buffer.from(text), filename).expect(202);
  const documentId: string = res.body.document.id;
  await ingestDocument(
    { documentId, tenantId },
    { embedder: new MockEmbeddingProvider(), attempt: 1, maxAttempts: 1 },
  );
  return documentId;
}

export interface SSEEvent {
  event: string;
  data: any;
}

/** Splits a Server-Sent Events body into { event, data } frames. */
export function parseSSE(body: string): SSEEvent[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim())
    .map((frame) => ({
      event: /^event: (.*)$/m.exec(frame)?.[1] ?? 'message',
      data: JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? 'null'),
    }));
}

/**
 * POSTs a chat question and returns the parsed SSE frames plus the joined answer text.
 * `ip` simulates the client's address via X-Forwarded-For (tests run on loopback, a trusted proxy).
 */
export async function ask(
  agent: TestAgent,
  message: string,
  { conversationId, ip, headers = {} }: { conversationId?: string; ip?: string; headers?: Record<string, string> } = {},
) {
  const res = await agent
    .post('/api/chat')
    .set(ip ? { 'X-Forwarded-For': ip, ...headers } : headers)
    .send({ message, conversationId })
    .buffer(true)
    .parse((stream, done) => {
      let body = '';
      stream.on('data', (chunk: Buffer) => (body += chunk.toString()));
      stream.on('end', () => done(null, body));
    });
  const isStream = String(res.headers['content-type']).startsWith('text/event-stream');
  const events = isStream ? parseSSE(res.body) : [];
  const of = (name: string) => events.filter((e) => e.event === name).map((e) => e.data);
  return {
    status: res.status,
    headers: res.headers,
    json: isStream ? null : JSON.parse(res.body),
    events,
    of,
    answer: of('token').map((t) => t.text).join(''),
  };
}

/** Polls until fn returns something truthy (or times out). For async work like queue jobs. */
export async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 10_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** A minimal valid one-page PDF containing `text`, so PDF extraction is tested without fixtures. */
export function makePdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Inserts a document row for a tenant (through RLS, like the app does). */
export function insertDocument(tenantId: string, filename: string): Promise<string> {
  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, filename, mime_type, size_bytes, storage_path)
       VALUES ($1, $2, 'text/plain', 10, $3) RETURNING id`,
      [tenantId, filename, `test/${filename}`],
    );
    return rows[0].id;
  });
}
