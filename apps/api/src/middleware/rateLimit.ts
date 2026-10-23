import type { RequestHandler } from 'express';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { consumeRateLimit } from '../lib/rateLimit';
import { getAuth } from './auth';

const WINDOW_MS = 60_000;

const MESSAGES: Record<string, string> = {
  ip: 'Too many questions from your network. Please wait a moment.',
  tenant: 'This assistant is receiving too many questions right now. Please try again shortly.',
};

/**
 * Chat rate limits: per IP (one visitor can't flood the assistant) and per
 * tenant (one customer can't run up costs or starve others). Runs after auth.
 */
export const chatRateLimit: RequestHandler = async (req, res, next) => {
  const { tenantId } = getAuth(req);
  let result;
  try {
    result = await consumeRateLimit(
      [
        { scope: 'ip', key: `ratelimit:chat:ip:${req.ip ?? 'unknown'}`, limit: config.RATE_LIMIT_IP_PER_MIN },
        { scope: 'tenant', key: `ratelimit:chat:tenant:${tenantId}`, limit: config.RATE_LIMIT_TENANT_PER_MIN },
      ],
      WINDOW_MS,
    );
  } catch (err) {
    // Fail open: a Redis outage shouldn't take chat down with it.
    req.log.warn({ err }, 'rate limiter unavailable; allowing request');
    return next();
  }

  if (result.allowed) return next();

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  throw new AppError(429, 'RATE_LIMITED', MESSAGES[result.blockedBy.scope], {
    scope: result.blockedBy.scope,
    retryAfterSeconds,
  });
};
