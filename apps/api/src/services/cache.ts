import { createHash } from 'node:crypto';
import { config } from '../config';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import type { Citation } from './conversations';

export interface CachedAnswer {
  answer: string;
  sources: Citation[]; // everything retrieved; the cited subset is derived from the answer
}

/** "  How long do REFUNDS take?? " and "how long do refunds take" are the same question. */
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s?!.]+$/, '');
}

/**
 * cache:answer:<tenant>:<docs version>:<hash of model + normalized question>
 *
 * The tenant's docs_version goes up whenever its documents change (a document
 * becomes ready, or is deleted). Because it's part of the key, every old answer
 * becomes unreachable at once: invalidation is O(1), with no keys to hunt down.
 * Orphaned entries simply expire via their TTL. The model is in the key so that
 * switching models never serves answers written by the previous one.
 */
export function answerCacheKey(tenantId: string, docsVersion: number, model: string, question: string): string {
  const hash = createHash('sha256').update(`${model}\n${normalizeQuestion(question)}`).digest('hex');
  return `cache:answer:${tenantId}:${docsVersion}:${hash}`;
}

// Both helpers fail open: if Redis is unavailable, chat still works, just uncached.

export async function getCachedAnswer(key: string): Promise<CachedAnswer | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as CachedAnswer) : null;
  } catch (err) {
    logger.warn({ err }, 'answer cache read failed');
    return null;
  }
}

export async function setCachedAnswer(key: string, value: CachedAnswer): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', config.CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, 'answer cache write failed');
  }
}
