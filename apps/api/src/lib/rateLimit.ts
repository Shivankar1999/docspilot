import { randomUUID } from 'node:crypto';
import { redis } from './redis';

/**
 * Sliding-window log, one sorted set per limit: each member is a request, scored
 * by its timestamp. To decide, drop entries older than the window and count the rest.
 * Unlike fixed windows (e.g. "per calendar minute"), this never lets a burst of 2×
 * the limit straddle a window boundary.
 *
 * It runs as one Lua script, so the check-then-record is atomic (no race between
 * parallel requests) and all-or-nothing across limits: a request blocked by one
 * limit isn't counted against the others. It uses Redis's clock, so every API
 * instance agrees on the time.
 *
 * KEYS = one sorted set per limit; ARGV = window ms, request id, then each key's limit.
 * Returns {0, 0} if allowed, else {index of the blocking key (1-based), ms until a slot frees}.
 */
const SLIDING_WINDOW_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= tonumber(ARGV[i + 2]) then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    return {i, tonumber(oldest[2]) + window - now}
  end
end
for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[2])
  redis.call('PEXPIRE', key, window)
end
return {0, 0}`;

export interface RateLimitRule {
  scope: string; // e.g. "ip" or "tenant", reported back when it blocks
  key: string;
  limit: number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; blockedBy: RateLimitRule; retryAfterMs: number };

/** Records one request against every rule, unless any rule is already at its limit. */
export async function consumeRateLimit(rules: RateLimitRule[], windowMs: number): Promise<RateLimitResult> {
  const [blocked, retryAfterMs] = (await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    rules.length,
    ...rules.map((r) => r.key),
    windowMs,
    randomUUID(),
    ...rules.map((r) => r.limit),
  )) as [number, number];

  if (blocked === 0) return { allowed: true };
  return { allowed: false, blockedBy: rules[blocked - 1], retryAfterMs };
}
