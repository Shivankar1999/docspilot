import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Local dev reads the repo-root .env (same relative path from src/ and dist/).
// Docker and CI pass real environment variables, and tests set their own
// (see test/test-env.ts), so .env is never loaded there.
const envFile = path.resolve(__dirname, '../../../.env');
if (process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Vercel sets VERCEL=1. There the API is a serverless function (see vercel.json), so a
// few defaults change: no worker process, no shared disk, a 4.5 MB request body limit,
// and Vercel's proxy in front.
const onVercel = process.env.VERCEL === '1';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Signs session tokens. Anyone holding it can forge a login, so it must be long and secret.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // "mock" works offline with no API key (tests, local dev); "voyage" is the real model.
  EMBEDDING_PROVIDER: z.enum(['mock', 'voyage']).default('mock'),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default('voyage-4'),
  // "mock" answers for free by quoting your documents; "anthropic" uses Claude.
  LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().default('claude-opus-5-5'),
  // Overrides the embedding provider's own relevance threshold (see providers/types.ts).
  RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(0).max(1).optional(),
  // Chat rate limits (sliding 60-second windows).
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_TENANT_PER_MIN: z.coerce.number().int().positive().default(120),
  // How long a cached answer lives. Document changes invalidate it sooner (see services/cache.ts).
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
  // Which proxies may set X-Forwarded-For (Express "trust proxy"). The default trusts
  // only private networks (Next.js on localhost, Docker), so public clients can't spoof their IP.
  // A number trusts that many hops: on Vercel, 1 (its proxy sets the client IP).
  TRUST_PROXY: z
    .string()
    .default(onVercel ? '1' : 'loopback, linklocal, uniquelocal')
    .transform((value) => (/^\d+$/.test(value) ? Number(value) : value)),
  // Comma-separated emails of platform operators who can open the admin page.
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((list) => list.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  // Where uploaded files are stored. The API and the worker must share this directory.
  UPLOAD_DIR: z.string().default(path.resolve(__dirname, '../uploads')),
  // "local": UPLOAD_DIR on disk. "blob": private Vercel Blob storage (serverless file
  // systems are temporary and not shared between instances).
  STORAGE_DRIVER: z.enum(['local', 'blob']).default(onVercel ? 'blob' : 'local'),
  // "queue": BullMQ jobs run by the worker process (src/worker.ts). "inline": the API
  // runs ingestion itself in the background after answering the upload (serverless).
  INGEST_MODE: z.enum(['queue', 'inline']).default(onVercel ? 'inline' : 'queue'),
  // Largest accepted upload. Vercel Functions reject request bodies over 4.5 MB.
  MAX_UPLOAD_MB: z.coerce.number().positive().default(onVercel ? 4 : 10),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at startup with a readable message, instead of a confusing crash later.
  throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
}

export const config = parsed.data;
export type Config = typeof config;
