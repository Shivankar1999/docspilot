import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { recordRequest } from '../lib/metrics';

// Accept a caller's request ID (e.g. from a proxy) only if it looks safe to log.
const SAFE_ID = /^[\w-]{1,64}$/;

/**
 * Gives every request an ID and a child logger, and logs one line when the
 * response finishes. The ID is returned in x-request-id so a user-reported
 * error can be matched to its log lines.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader('x-request-id', req.id);

  const start = performance.now();
  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - start);
    // Probes would drown out real traffic in the request metrics.
    if (req.path !== '/health' && req.path !== '/metrics') recordRequest(res.statusCode, durationMs);
    // req.log is read here (not captured above) so fields added later,
    // like tenantId from the auth middleware, appear in this line too.
    req.log.info(
      { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs },
      'request completed',
    );
  });

  next();
};
