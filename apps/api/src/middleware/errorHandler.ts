import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

// Every error leaves the API in one shape: { error: { code, message, details? } }.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Headers already sent (e.g. mid SSE stream): let Express close the connection.
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
    });
    return;
  }

  // Body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (isClientError(err)) {
    res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    return;
  }

  // Unknown errors: log the details, but never leak internals to the client.
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};

function isClientError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== 'object' || err === null || !('status' in err)) return false;
  const { status } = err;
  return typeof status === 'number' && status >= 400 && status < 500;
}
