import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Separate database and Redis DB index, so tests never touch development data.
    // .env is not loaded in tests; CI overrides these via TEST_* variables.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://docspilot:docspilot@localhost:5433/docspilot_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
      JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters',
      EMBEDDING_PROVIDER: 'mock',
      LLM_PROVIDER: 'mock',
      // Small limits so rate-limit tests stay fast; Redis is flushed before each test.
      RATE_LIMIT_IP_PER_MIN: '5',
      RATE_LIMIT_TENANT_PER_MIN: '8',
      ADMIN_EMAILS: 'admin@platform.test',
      UPLOAD_DIR: path.join(tmpdir(), 'docspilot-test-uploads'),
    },
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // All test files share one database, so run them one at a time for predictable state.
    fileParallelism: false,
  },
});
