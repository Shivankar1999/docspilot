import { Router } from 'express';
import { z } from 'zod';
import { openEventStream } from '../lib/sse';
import { getAuth, requireChatAuth } from '../middleware/auth';
import { messageQuota } from '../middleware/quota';
import { chatRateLimit } from '../middleware/rateLimit';
import { streamAnswer } from '../services/chat';
import { startTurn } from '../services/conversations';

export const chatRouter = Router();

const ChatBody = z.object({
  message: z.string().trim().min(1, 'Ask a question').max(2000, 'Questions are limited to 2000 characters'),
  conversationId: z.uuid('Invalid conversation id').optional(),
});

// POST (not GET) because the question travels in the body; the browser reads the
// SSE frames from the fetch() response stream instead of using EventSource.
const SOURCES = { session: 'dashboard', secret_key: 'api', widget: 'widget' } as const;

// Order: who are you (session, secret key or widget key) → are you going too fast
// (cheap Redis check) → is your plan used up (DB).
chatRouter.post('/api/chat', requireChatAuth, chatRateLimit, messageQuota, async (req, res) => {
  const { message, conversationId } = ChatBody.parse(req.body);
  const auth = getAuth(req);

  // Everything that can fail with a normal JSON error (validation, unknown
  // conversation) happens before the stream opens.
  const turn = await startTurn({
    tenantId: auth.tenantId,
    question: message,
    conversationId,
    source: SOURCES[auth.via],
  });

  const stream = openEventStream(res);
  // If the client disconnects mid-answer, stop generating (and paying for) tokens.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  try {
    await streamAnswer(turn, ({ type, ...data }) => stream.send(type, data), { signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      req.log.error({ err }, 'chat answer failed');
      stream.send('error', { message: 'Something went wrong while answering. Please try again.' });
    }
  } finally {
    stream.end();
  }
});
