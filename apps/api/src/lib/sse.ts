import type { Response } from 'express';

/**
 * Opens a Server-Sent Events stream: one long-lived HTTP response that the server
 * keeps writing "event: …\ndata: …\n\n" frames to. Simpler than WebSockets for
 * one-way server → browser updates like streaming tokens, and plain HTTP throughout.
 */
export function openEventStream(res: Response) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform: proxies and compression must pass frames through, not buffer them.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // same request to nginx-style reverse proxies
  });
  res.flushHeaders();

  return {
    send(event: string, data: unknown) {
      if (res.writableEnded || res.destroyed) return; // client already gone
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}
